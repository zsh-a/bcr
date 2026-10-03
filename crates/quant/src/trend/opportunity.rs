//! Native research observer: identical market detector, independent of account
//! positions, cash, cooldown and daily risk. It never submits or simulates orders.
use super::background::Background;
use super::config::Config;
use super::indicators::Indicators;
use super::model::*;
use super::signals::entry_directions;
use super::structured_pullback::StructuredPullback;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyGeometry {
    pub price: f64,
    pub depth: f64,
    pub tolerance_depth: f64,
    pub reachable: bool,
    pub valid: bool,
    pub retested: bool,
}
#[derive(Clone, Copy, Debug, Serialize)]
pub struct KeyGeometries {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pivot: Option<KeyGeometry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ema: Option<KeyGeometry>,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opportunity {
    pub side: Side,
    pub entry_signal: EntrySignal,
    pub checks: EntryGates,
    /// The four market gates passed. Account availability and trading costs
    /// are intentionally absent; this is not an executable order eligibility.
    pub screen_passed: bool,
    pub key_geometry: KeyGeometries,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub counts: BTreeMap<String, usize>,
    pub opportunities: Vec<Opportunity>,
}
pub struct Observer {
    config: Config,
    indicators: Indicators,
    background: Background,
    detector: StructuredPullback,
    start: u64,
    end: u64,
    expected: u64,
    diagnostics: Diagnostics,
}
impl Observer {
    pub fn new(config: Config, start: u64, end: u64, warmup: u64) -> Result<Self, String> {
        config.validate()?;
        if config.version < 10
            || config.strategy.entry != "structured-pullback"
            || warmup > start
            || start >= end
        {
            return Err(
                "opportunity observer requires a v10 structured strategy and valid window".into(),
            );
        }
        Ok(Self {
            config,
            indicators: Indicators::default(),
            background: Background::default(),
            detector: StructuredPullback::default(),
            start,
            end,
            expected: warmup,
            diagnostics: Diagnostics::default(),
        })
    }
    pub fn advance(&mut self, bar: Bar) -> Result<(), String> {
        if bar.time != self.expected || bar.time >= self.end {
            return Err("opportunity input must be continuous and inside its window".into());
        }
        self.expected += MINUTE;
        let strategy = &self.config.strategy;
        if strategy.filter == "background" {
            self.background.close(bar, strategy.trade_minutes);
        }
        self.detector.observe_minute(bar, strategy.trade_minutes);
        let Some(close) = self.indicators.close(bar, strategy).trade else {
            return Ok(());
        };
        let background = [Side::Long, Side::Short].map(|side| {
            strategy.filter != "background"
                || self
                    .background
                    .decide(
                        close.time,
                        close.bar.close,
                        side,
                        close.atr,
                        &self.config.execution,
                        strategy.trade_minutes,
                    )
                    .allowed
        });
        let directions = entry_directions(strategy, self.indicators.direction(), background);
        let mut events = vec![];
        self.detector.close(
            close,
            self.indicators.ready(),
            close.bar.time >= self.start,
            directions,
            strategy,
            &self.config.execution,
            &mut events,
        );
        for event in events {
            *self
                .diagnostics
                .counts
                .entry(format!("{}:{}", event.kind, event.reason))
                .or_default() += 1;
            if event.reason != "sp-first-break" {
                continue;
            }
            let signal = event.entry_signal.expect("structured first-break snapshot");
            let Some(EntryTrigger::StructuredPullback(t)) = signal.trigger else {
                unreachable!("structured trigger");
            };
            let checks = t.gates.expect("v10 parallel gates");
            let amplitude = event.side.sign() * (t.impulse_extreme - t.impulse_start_price);
            let tolerance_depth = 0.25 * t.reference_atr / amplitude;
            let geometry = |price, valid, retested| {
                let depth = event.side.sign() * (t.impulse_extreme - price) / amplitude;
                KeyGeometry {
                    price,
                    depth,
                    tolerance_depth,
                    reachable: depth + tolerance_depth >= 0.2 && depth - tolerance_depth <= 0.5,
                    valid,
                    retested,
                }
            };
            self.diagnostics.opportunities.push(Opportunity {
                side: event.side,
                entry_signal: signal,
                checks,
                screen_passed: checks.passed(),
                key_geometry: KeyGeometries {
                    pivot: t
                        .pivot
                        .map(|p| geometry(p.price, p.valid, p.retest_time.is_some())),
                    // A moving EMA's geometry describes this signal timestamp only.
                    ema: t
                        .ema
                        .map(|p| geometry(p.value, p.valid, p.retest_time.is_some())),
                },
            });
        }
        Ok(())
    }
    pub fn drain(&mut self) -> Diagnostics {
        std::mem::take(&mut self.diagnostics)
    }
    pub fn finish(&self) -> Result<(), String> {
        if self.expected == self.end {
            Ok(())
        } else {
            Err("incomplete opportunity window".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trend::config::{
        CandlePolicy, ConfirmationPolicy, KeyLevelPolicy, KeyRole, ShapePolicy,
        StructuredPullback as Policy,
    };
    use crate::trend::engine::Engine;
    const BASE: u64 = 1_704_067_200_000;
    fn config() -> Config {
        let mut c = Config::default();
        c.strategy.entry = "structured-pullback".into();
        c.strategy.management = "chandelier".into();
        c.strategy.filter = "none".into();
        c.strategy.direction = "both".into();
        c.strategy.trade_minutes = 30;
        c.strategy.stop_atr = 20.0;
        c.strategy.trailing_atr = 20.0;
        c.strategy.structured_pullback = Some(Policy {
            key_level: KeyLevelPolicy::None,
            shape: ShapePolicy::None,
            candle: CandlePolicy::None,
            confirmation: Some(ConfirmationPolicy::BeforeBreakout),
            key_role: Some(KeyRole::PullbackRetest),
        });
        c.execution.tick_size = 0.01;
        c.execution.min_notional = 1.0;
        c.risk.daily_loss_pct = 0.0;
        c
    }
    fn rows(short: bool) -> Vec<Bar> {
        let mut out = vec![];
        let mut previous: f64 = 100.0;
        for i in 0..110 {
            let base = if i < 90 { 100.0 } else { 102.8 };
            let n = if i < 90 { i - 60_i32 } else { i - 90 };
            let (p, h, l) = match n {
                0 => (0.6, 0.7, -0.1),
                1 => (1.2, 1.3, 0.5),
                2 => (1.8, 1.9, 1.1),
                3 => (2.4, 2.5, 1.7),
                4 => (2.0, 2.1, 1.8),
                5 => (1.9, 2.1, 1.5),
                6 => (2.6, 2.7, 2.0),
                n if n > 6 => (2.8, 3.3, 2.3),
                _ => (0., 0.5, -0.5),
            };
            let (p, h, l) = (base + p, base + h, base + l);
            for j in 0..30 {
                let open = previous + (p - previous) * j as f64 / 30.;
                let close = previous + (p - previous) * (j + 1) as f64 / 30.;
                let mut b = Bar {
                    time: BASE + out.len() as u64 * MINUTE,
                    open,
                    close,
                    high: if j == 0 { h.max(open) } else { open.max(close) },
                    low: if j == 0 { l.min(open) } else { open.min(close) },
                    volume: 1.,
                };
                if short {
                    b = Bar {
                        open: 200. - b.open,
                        close: 200. - b.close,
                        high: 200. - b.low,
                        low: 200. - b.high,
                        ..b
                    };
                }
                out.push(b);
            }
            previous = p;
        }
        out
    }
    fn run(c: Config, bars: &[Bar], partition: usize) -> Diagnostics {
        let mut observer = Observer::new(
            c,
            BASE + 50 * 30 * MINUTE,
            BASE + bars.len() as u64 * MINUTE,
            BASE,
        )
        .unwrap();
        let mut result = Diagnostics::default();
        let append = |result: &mut Diagnostics, chunk: Diagnostics| {
            for (key, count) in chunk.counts {
                *result.counts.entry(key).or_default() += count;
            }
            result.opportunities.extend(chunk.opportunities);
        };
        for (i, bar) in bars.iter().enumerate() {
            observer.advance(*bar).unwrap();
            if (i + 1) % partition == 0 {
                append(&mut result, observer.drain());
            }
        }
        observer.finish().unwrap();
        append(&mut result, observer.drain());
        result
    }
    #[test]
    fn observer_keeps_market_opportunities_while_the_real_account_is_holding_mirrored() {
        for short in [false, true] {
            let c = config();
            let bars = rows(short);
            let independent = run(c.clone(), &bars, 17);
            assert_eq!(independent.opportunities.len(), 2);
            let mut engine = Engine::new(
                c,
                vec![],
                BASE + 50 * 30 * MINUTE,
                BASE + bars.len() as u64 * MINUTE,
                BASE,
            )
            .unwrap();
            for bar in &bars {
                engine.advance(*bar, *bar).unwrap();
            }
            let metrics = engine.finish().unwrap();
            let out = engine.drain();
            assert_eq!(metrics.trades, 1);
            assert_eq!(
                out.trades[0].entry_signal,
                independent.opportunities[0].entry_signal
            );
            assert!(out.trades[0].exit_time > independent.opportunities[1].entry_signal.time);
            assert!(independent.opportunities.iter().all(|o| o.screen_passed));
        }
    }
    #[test]
    fn observer_is_partition_invariant_risk_independent_and_causal() {
        let c = config();
        let bars = rows(false);
        let direct = run(c.clone(), &bars, usize::MAX);
        let drained = run(c.clone(), &bars, 13);
        assert_eq!(
            serde_json::to_value(&direct).unwrap(),
            serde_json::to_value(drained).unwrap()
        );
        let mut alternate = c.clone();
        alternate.risk.daily_loss_pct = 0.5;
        alternate.risk.risk_pct = 0.01;
        alternate.risk.max_exposure_pct = 0.5;
        alternate.execution.initial_capital = 20000.0;
        alternate.risk.cooldown_losses = 20;
        alternate.risk.cooldown_minutes = 1440;
        assert_eq!(
            serde_json::to_value(&direct).unwrap(),
            serde_json::to_value(run(alternate, &bars, 7)).unwrap()
        );
        let cut = 80 * 30;
        let prefix = run(c.clone(), &bars[..cut], 11);
        assert_eq!(prefix.opportunities.len(), 1);
        let mut future = bars.clone();
        for bar in &mut future[cut..] {
            bar.open = 80.;
            bar.close = 80.;
            bar.high = 81.;
            bar.low = 79.;
        }
        let changed = run(c, &future, 19);
        assert_eq!(
            serde_json::to_value(&prefix.opportunities).unwrap(),
            serde_json::to_value(
                changed
                    .opportunities
                    .iter()
                    .filter(|o| o.entry_signal.time < BASE + cut as u64 * MINUTE)
                    .collect::<Vec<_>>()
            )
            .unwrap()
        );
    }
    #[test]
    fn observer_keeps_all_parallel_gates_when_earlier_key_gate_fails_and_honours_direction() {
        let mut c = config();
        let p = c.strategy.structured_pullback.as_mut().unwrap();
        p.key_level = KeyLevelPolicy::Pivot;
        p.shape = ShapePolicy::Any;
        p.candle = CandlePolicy::Reversal;
        let bars = rows(false);
        let result = run(c.clone(), &bars, 5);
        assert_eq!(result.opportunities.len(), 2);
        for o in &result.opportunities {
            assert!(o.checks.retracement);
            assert!(!o.checks.shape);
            assert!(!o.checks.key);
            assert_eq!(
                o.checks.candle,
                match o.entry_signal.trigger.unwrap() {
                    EntryTrigger::StructuredPullback(t) => t.candles.reversal,
                    _ => unreachable!(),
                }
            );
            assert!(!o.screen_passed);
            assert_eq!(
                o.checks,
                match o.entry_signal.trigger.unwrap() {
                    EntryTrigger::StructuredPullback(t) => t.gates.unwrap(),
                    _ => unreachable!(),
                }
            );
        }
        c.strategy.direction = "short".into();
        assert!(run(c, &bars, 5).opportunities.is_empty());
    }
    #[test]
    fn all_five_frozen_market_policies_keep_identical_first_break_identities() {
        let bars = rows(false);
        let base = config();
        let identity = |result: Diagnostics| {
            result
                .opportunities
                .into_iter()
                .map(|o| {
                    let EntryTrigger::StructuredPullback(t) = o.entry_signal.trigger.unwrap()
                    else {
                        unreachable!()
                    };
                    (
                        t.setup_id,
                        o.side,
                        o.entry_signal.time,
                        o.entry_signal.boundary,
                    )
                })
                .collect::<Vec<_>>()
        };
        let expected = identity(run(base.clone(), &bars, usize::MAX));
        for (key, shape, confirmation, role) in [
            (
                KeyLevelPolicy::Either,
                ShapePolicy::Any,
                ConfirmationPolicy::BeforeBreakout,
                KeyRole::PullbackRetest,
            ),
            (
                KeyLevelPolicy::Either,
                ShapePolicy::Any,
                ConfirmationPolicy::SignalClose,
                KeyRole::PullbackRetest,
            ),
            (
                KeyLevelPolicy::Either,
                ShapePolicy::None,
                ConfirmationPolicy::BeforeBreakout,
                KeyRole::PullbackRetest,
            ),
            (
                KeyLevelPolicy::Either,
                ShapePolicy::None,
                ConfirmationPolicy::BeforeBreakout,
                KeyRole::ImpulseContext,
            ),
            (
                KeyLevelPolicy::None,
                ShapePolicy::None,
                ConfirmationPolicy::BeforeBreakout,
                KeyRole::PullbackRetest,
            ),
        ] {
            let mut c = base.clone();
            c.strategy.structured_pullback = Some(Policy {
                key_level: key,
                shape,
                candle: CandlePolicy::None,
                confirmation: Some(confirmation),
                key_role: Some(role),
            });
            assert_eq!(identity(run(c, &bars, 17)), expected);
        }
    }
    #[test]
    fn v9_and_explicit_v10_strict_accounts_have_identical_economics_and_events() {
        fn strip(v: &mut serde_json::Value) {
            match v {
                serde_json::Value::Object(m) => {
                    for name in ["confirmation", "keyRole", "gates", "contextEligible"] {
                        m.remove(name);
                    }
                    for val in m.values_mut() {
                        strip(val);
                    }
                }
                serde_json::Value::Array(a) => {
                    for val in a {
                        strip(val);
                    }
                }
                _ => {}
            }
        }
        for short in [false, true] {
            let c = config();
            let bars = rows(short);
            let mut old = c.clone();
            old.version = 9;
            old.strategy
                .structured_pullback
                .as_mut()
                .unwrap()
                .confirmation = None;
            old.strategy.structured_pullback.as_mut().unwrap().key_role = None;
            let replay = |config| {
                let mut engine = Engine::new(
                    config,
                    vec![],
                    BASE + 50 * 30 * MINUTE,
                    BASE + bars.len() as u64 * MINUTE,
                    BASE,
                )
                .unwrap();
                for bar in &bars {
                    engine.advance(*bar, *bar).unwrap();
                }
                let metrics = engine.finish().unwrap();
                serde_json::to_value((metrics, engine.drain())).unwrap()
            };
            let prior = replay(old);
            let mut modern = replay(c);
            strip(&mut modern);
            assert_eq!(prior, modern);
        }
    }
}
