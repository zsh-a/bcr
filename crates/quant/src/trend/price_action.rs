//! Fixed price-action experiment. Both ablations share identification, clocks,
//! key-level observations and consumption; only first-break eligibility differs.
use super::config::{background_minutes, Execution, Strategy};
use super::indicators::CandleBuilder;
use super::model::*;
use super::signals::Candidate;
use std::collections::VecDeque;

#[cfg(test)]
#[path = "price_action_tests.rs"]
mod tests;

const MAX_EXTENSION_BARS: usize = 8;
const KEY_TOLERANCE_ATR: f64 = 0.25;
// This experiment has its own fixed rules; changing legacy pullback parameters
// must not silently change the price-action research definition.
const IMPULSE_BARS: usize = 3;
const IMPULSE_ATR: f64 = 1.5;
const MIN_EFFICIENCY: f64 = 0.6;
const MIN_PULLBACK_BARS: usize = 2;
const MAX_PULLBACK_BARS: usize = 8;
const MIN_RETRACEMENT: f64 = 0.2;
const MAX_RETRACEMENT: f64 = 0.5;
pub(super) const WARMUP_BARS: usize = 14 + IMPULSE_BARS;

#[derive(Clone, Copy)]
struct Observation {
    close: TradingClose,
    atr_ready: bool,
}
#[derive(Clone, Copy)]
enum Leg {
    First,
    Bounce,
    Second,
}
#[derive(Clone, Copy)]
struct Pullback {
    started_at: u64,
    bars: usize,
    extreme: f64,
    leg: Leg,
}
struct Setup {
    side: Side,
    start_time: u64,
    confirmed_at: u64,
    start_price: f64,
    extreme: f64,
    reference_atr: f64,
    strength_atr: f64,
    efficiency: f64,
    extensions: usize,
    pullback: Option<Pullback>,
    key: Option<KeyLevelSnapshot>,
}
impl Setup {
    fn snapshot(&self, close: TradingClose) -> Option<EntrySignal> {
        let pullback = self.pullback?;
        Some(EntrySignal {
            time: close.time,
            price: close.bar.close,
            boundary: Some(self.extreme),
            atr: close.atr,
            lookback_bars: None,
            trigger: Some(EntryTrigger::PriceAction(PriceActionTrigger {
                kind: "price-action",
                setup_id: self.confirmed_at,
                impulse_start_time: self.start_time,
                impulse_confirmed_at: self.confirmed_at,
                pullback_started_at: pullback.started_at,
                impulse_start_price: self.start_price,
                impulse_extreme: self.extreme,
                reference_atr: self.reference_atr,
                strength_atr: self.strength_atr,
                efficiency: self.efficiency,
                pullback_bars: pullback.bars,
                retracement: self.depth(),
                leg_count: if matches!(pullback.leg, Leg::Second) {
                    2
                } else {
                    1
                },
                key_level: self.key,
            })),
        })
    }
    fn depth(&self) -> f64 {
        self.pullback.map_or(0.0, |p| {
            (self.extreme - p.extreme) / (self.extreme - self.start_price)
        })
    }
}

#[derive(Default)]
struct KeyLevels {
    builder: CandleBuilder,
    candles: VecDeque<Bar>,
    highs: VecDeque<KeyLevelSnapshot>,
    lows: VecDeque<KeyLevelSnapshot>,
}
impl KeyLevels {
    fn observe(&mut self, minute: Bar, minutes: usize) {
        let Some(candle) = self.builder.close(minute, minutes) else {
            return;
        };
        self.candles.push_back(candle);
        if self.candles.len() > 5 {
            self.candles.pop_front();
        }
        if self.candles.len() < 5 {
            return;
        }
        let pivot = self.candles[2];
        for (side, confirmed) in [
            (
                Side::Long,
                (0..2).all(|i| pivot.high > self.candles[i].high)
                    && (3..5).all(|i| pivot.high >= self.candles[i].high),
            ),
            (
                Side::Short,
                (0..2).all(|i| pivot.low < self.candles[i].low)
                    && (3..5).all(|i| pivot.low <= self.candles[i].low),
            ),
        ] {
            if confirmed {
                let pivots = if side == Side::Long {
                    &mut self.highs
                } else {
                    &mut self.lows
                };
                pivots.push_back(KeyLevelSnapshot {
                    minutes,
                    price: if side == Side::Long {
                        pivot.high
                    } else {
                        pivot.low
                    },
                    pivot_time: pivot.time,
                    confirmed_at: candle.time + minutes as u64 * MINUTE - 1,
                    retest_time: None,
                    valid: true,
                });
                if pivots.len() > 2 {
                    pivots.pop_front();
                }
            }
        }
    }
    fn before(&self, side: Side, time: u64) -> Option<KeyLevelSnapshot> {
        let pivots = if side == Side::Long {
            &self.highs
        } else {
            &self.lows
        };
        pivots
            .iter()
            .rev()
            .find(|p| p.confirmed_at <= time)
            .copied()
    }
}

#[derive(Default)]
pub struct PriceAction {
    history: VecDeque<Observation>,
    levels: KeyLevels,
    setup: Option<Setup>,
    eligible_after: u64,
    reset_requested: bool,
}
impl PriceAction {
    pub fn observe_minute(&mut self, bar: Bar, trade_minutes: usize) {
        self.levels.observe(bar, background_minutes(trade_minutes));
    }
    pub fn reset(&mut self) {
        self.reset_requested = true;
    }
    pub fn close(
        &mut self,
        close: TradingClose,
        atr_ready: bool,
        enabled: bool,
        directions: [bool; 2],
        strategy: &Strategy,
        execution: &Execution,
        events: &mut Vec<Event>,
    ) -> Option<Candidate> {
        let result = self.evaluate(close, enabled, directions, strategy, execution, events);
        self.history.push_back(Observation { close, atr_ready });
        if self.history.len() > IMPULSE_BARS {
            self.history.pop_front();
        }
        result
    }
    fn event(setup: &Setup, close: TradingClose, reason: &'static str, events: &mut Vec<Event>) {
        events.push(Event {
            time: close.time,
            kind: "setup",
            side: setup.side,
            price: close.bar.close,
            value: Some(setup.confirmed_at as f64),
            trade_id: None,
            reason: reason.into(),
            entry_signal: setup.snapshot(close),
        });
    }
    fn cancel(&mut self, close: TradingClose, reason: &'static str, events: &mut Vec<Event>) {
        if let Some(setup) = self.setup.take() {
            Self::event(&setup, close, reason, events);
        }
        self.eligible_after = close.time;
    }
    fn evaluate(
        &mut self,
        close: TradingClose,
        enabled: bool,
        directions: [bool; 2],
        strategy: &Strategy,
        execution: &Execution,
        events: &mut Vec<Event>,
    ) -> Option<Candidate> {
        let reset = std::mem::take(&mut self.reset_requested);
        if !enabled || reset {
            self.cancel(close, "pa-disabled", events);
            return None;
        }
        if !directions[0] && !directions[1] {
            self.cancel(close, "pa-direction-invalid", events);
            return None;
        }
        if let Some(mut setup) = self.setup.take() {
            let allowed = directions[usize::from(setup.side == Side::Short)];
            if !allowed {
                Self::event(&setup, close, "pa-direction-invalid", events);
                self.eligible_after = close.time;
                return None;
            }
            let previous = self
                .history
                .back()
                .expect("a setup has prior candles")
                .close
                .bar;
            if setup.pullback.is_none() {
                // Include the first reversing candle's completed wick before
                // freezing the whole impulse. It cannot break its own extreme.
                setup.extreme = if setup.side == Side::Long {
                    setup.extreme.max(close.bar.high)
                } else {
                    setup.extreme.min(close.bar.low)
                };
                if setup.side.sign() * (close.bar.close - previous.close) < 0.0 {
                    setup.pullback = Some(Pullback {
                        started_at: close.time,
                        bars: 1,
                        extreme: if setup.side == Side::Long {
                            close.bar.low
                        } else {
                            close.bar.high
                        },
                        leg: Leg::First,
                    });
                } else {
                    setup.extensions += 1;
                    if setup.extensions > MAX_EXTENSION_BARS {
                        Self::event(&setup, close, "pa-expired", events);
                        self.eligible_after = close.time;
                    } else {
                        self.setup = Some(setup);
                    }
                    return None;
                }
            } else if let Some(pullback) = &mut setup.pullback {
                pullback.bars += 1;
                pullback.extreme = if setup.side == Side::Long {
                    pullback.extreme.min(close.bar.low)
                } else {
                    pullback.extreme.max(close.bar.high)
                };
                // A single completed candle can advance at most one leg state.
                pullback.leg = match pullback.leg {
                    Leg::First
                        if execution.breaks_by_tick(
                            close.bar.close,
                            if setup.side == Side::Long {
                                previous.high
                            } else {
                                previous.low
                            },
                            setup.side.sign(),
                        ) =>
                    {
                        Leg::Bounce
                    }
                    Leg::Bounce
                        if execution.breaks_by_tick(
                            close.bar.close,
                            if setup.side == Side::Long {
                                previous.low
                            } else {
                                previous.high
                            },
                            -setup.side.sign(),
                        ) =>
                    {
                        Leg::Second
                    }
                    leg => leg,
                };
            }
            if let Some(key) = &mut setup.key {
                let tolerance = KEY_TOLERANCE_ATR * setup.reference_atr;
                if setup.side.sign() * (close.bar.close - key.price) < -tolerance {
                    key.valid = false;
                }
                let touch = if setup.side == Side::Long {
                    close.bar.low
                } else {
                    close.bar.high
                };
                if key.valid
                    && key.retest_time.is_none()
                    && (touch - key.price).abs() <= tolerance
                    && setup.side.sign() * (close.bar.close - key.price) > 0.0
                {
                    key.retest_time = Some(close.time);
                }
            }
            let pullback = setup.pullback.unwrap();
            let depth = setup.depth();
            let invalid = if depth > MAX_RETRACEMENT {
                Some("pa-structure-invalid")
            } else if pullback.bars > MAX_PULLBACK_BARS {
                Some("pa-expired")
            } else {
                None
            };
            if let Some(reason) = invalid {
                Self::event(&setup, close, reason, events);
                self.eligible_after = close.time;
                return None;
            }
            if execution.breaks_by_tick(close.bar.close, setup.extreme, setup.side.sign()) {
                // First whole-impulse break consumes every ablation identically,
                // even if it is shallow, early, or missing a requested mechanism.
                self.eligible_after = close.time;
                let policy = strategy.price_action.expect("validated price-action entry");
                let reason = if pullback.bars < MIN_PULLBACK_BARS || depth < MIN_RETRACEMENT {
                    Some("pa-retracement-invalid")
                } else if policy.key_level
                    && !setup.key.is_some_and(|k| {
                        k.valid
                            && k.retest_time.is_some()
                            && setup.side.sign() * (close.bar.close - k.price) > 0.0
                    })
                {
                    Some("pa-key-level-missing")
                } else if policy.two_legs && !matches!(pullback.leg, Leg::Second) {
                    Some("pa-two-legs-missing")
                } else {
                    None
                };
                if let Some(reason) = reason {
                    Self::event(&setup, close, reason, events);
                    return None;
                }
                return Some(Candidate {
                    side: setup.side,
                    anchor: Some(pullback.extreme),
                    atr: close.atr,
                    entry_signal: setup.snapshot(close).unwrap(),
                });
            }
            self.setup = Some(setup);
            return None;
        }
        if self.history.len() != IMPULSE_BARS {
            return None;
        }
        let origin = self.history[0];
        if !origin.atr_ready || origin.close.time < self.eligible_after || origin.close.atr <= 0.0 {
            return None;
        }
        let delta = close.bar.close - origin.close.bar.close;
        let side = if delta >= 0.0 {
            Side::Long
        } else {
            Side::Short
        };
        if !directions[usize::from(side == Side::Short)] {
            return None;
        }
        let displacement = side.sign() * delta;
        let mut previous = origin.close.bar.close;
        let mut path = 0.0;
        let mut extreme = if side == Side::Long {
            close.bar.high
        } else {
            close.bar.low
        };
        for b in self
            .history
            .iter()
            .skip(1)
            .map(|o| o.close.bar)
            .chain(std::iter::once(close.bar))
        {
            path += (b.close - previous).abs();
            previous = b.close;
            extreme = if side == Side::Long {
                extreme.max(b.high)
            } else {
                extreme.min(b.low)
            };
        }
        if displacement < IMPULSE_ATR * origin.close.atr
            || path <= 0.0
            || displacement / path < MIN_EFFICIENCY
        {
            return None;
        }
        // Select the newest previously known pivot first. Never search older
        // levels for one that happens to fit this already observed impulse.
        let key = self.levels.before(side, origin.close.time).filter(|k| {
            side.sign() * (origin.close.bar.close - k.price) <= 0.0
                && execution.breaks_by_tick(close.bar.close, k.price, side.sign())
        });
        let setup = Setup {
            side,
            start_time: origin.close.time,
            confirmed_at: close.time,
            start_price: origin.close.bar.close,
            extreme,
            reference_atr: origin.close.atr,
            strength_atr: displacement / origin.close.atr,
            efficiency: displacement / path,
            extensions: 0,
            pullback: None,
            key,
        };
        events.push(Event {
            time: close.time,
            kind: "impulse",
            side,
            price: extreme,
            value: Some(setup.strength_atr),
            trade_id: None,
            reason: "price-action".into(),
            entry_signal: None,
        });
        self.setup = Some(setup);
        None
    }
}
