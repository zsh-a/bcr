//! A versioned mechanical hypothesis, not a discretionary price-action replica.
//! All policies observe the same candles/labels and consume the first whole-
//! impulse rebreak. Gates never change detection, warmup or setup lifetimes.
use super::config::{
    background_minutes, CandlePolicy, ConfirmationPolicy, Execution, KeyLevelPolicy, KeyRole,
    ShapePolicy, Strategy, StructuredPullback as Policy,
};
use super::indicators::CandleBuilder;
use super::model::*;
use super::signals::Candidate;
use std::collections::VecDeque;

#[cfg(test)]
#[path = "structured_pullback_tests.rs"]
mod tests;

const IMPULSE_BARS: usize = 3;
const IMPULSE_ATR: f64 = 1.5;
const MIN_EFFICIENCY: f64 = 0.6;
const MAX_EXTENSION: usize = 8;
const MAX_PULLBACK: usize = 24;
const MIN_DEPTH: f64 = 0.2;
const MAX_DEPTH: f64 = 0.5;
const TOLERANCE: f64 = 0.25;
const EMA_PERIOD: usize = 20;
pub(super) const WARMUP_BARS: usize = 17;
pub(super) const CONTEXT_WARMUP_BARS: usize = 42;

#[derive(Clone, Copy)]
struct Observation {
    close: TradingClose,
    ready: bool,
}
#[derive(Clone, Copy)]
struct Touch {
    index: usize,
    level: f64,
    atr: f64,
}
#[derive(Default)]
struct Validation {
    pending: Option<Touch>,
    confirmed: VecDeque<(usize, u64)>,
}
impl Validation {
    fn observe(&mut self, side: Side, bar: Bar, time: u64, index: usize, ema: f64, atr: f64) {
        while self.confirmed.front().is_some_and(|&(i, _)| index - i > 20) {
            self.confirmed.pop_front();
        }
        if side.sign() * (bar.close - ema) < -TOLERANCE * atr {
            self.pending = None;
            self.confirmed.clear();
            return;
        }
        if let Some(touch) = self.pending {
            if side.sign() * (bar.close - touch.level) < -TOLERANCE * touch.atr {
                self.pending = None;
            } else if index > touch.index
                && side.sign() * (bar.close - touch.level) >= 0.5 * touch.atr
            {
                self.confirmed.push_back((index, time));
                while self.confirmed.len() > 2 {
                    self.confirmed.pop_front();
                }
                self.pending = None;
            }
            // A confirming candle cannot simultaneously start another touch.
            return;
        }
        let wick = if side == Side::Long {
            bar.low
        } else {
            bar.high
        };
        if (wick - ema).abs() <= TOLERANCE * atr && side.sign() * (bar.close - ema) >= 0.0 {
            self.pending = Some(Touch {
                index,
                level: ema,
                atr,
            });
        }
    }
    fn confirmed_at(&self) -> Option<u64> {
        (self.confirmed.len() == 2).then(|| self.confirmed.back().unwrap().1)
    }
}
#[derive(Clone, Copy)]
struct Context {
    time: u64,
    ema: f64,
    validated: [Option<u64>; 2],
}
#[derive(Default)]
struct KeyLevels {
    builder: CandleBuilder,
    bars: VecDeque<Bar>,
    highs: VecDeque<KeyLevelSnapshot>,
    lows: VecDeque<KeyLevelSnapshot>,
    contexts: VecDeque<Context>,
    validation: [Validation; 2],
    count: usize,
    previous: Option<f64>,
    ema: f64,
    atr: f64,
    atr_sum: f64,
}
impl KeyLevels {
    fn observe(&mut self, minute: Bar, minutes: usize) {
        let Some(bar) = self.builder.close(minute, minutes) else {
            return;
        };
        self.closed(bar, minutes);
    }
    fn closed(&mut self, bar: Bar, minutes: usize) {
        let time = bar.time + minutes as u64 * MINUTE - 1;
        let tr = self.previous.map_or(bar.high - bar.low, |p| {
            (bar.high - bar.low)
                .max((bar.high - p).abs())
                .max((bar.low - p).abs())
        });
        self.count += 1;
        if self.count <= 14 {
            self.atr_sum += tr;
            self.atr = self.atr_sum / self.count as f64;
        } else {
            self.atr = (self.atr * 13.0 + tr) / 14.0;
        }
        self.ema = if self.count == 1 {
            bar.close
        } else {
            self.ema + 2.0 / 21.0 * (bar.close - self.ema)
        };
        self.previous = Some(bar.close);
        if self.count >= EMA_PERIOD && self.atr > 0.0 {
            for (i, side) in [Side::Long, Side::Short].into_iter().enumerate() {
                self.validation[i].observe(side, bar, time, self.count, self.ema, self.atr);
            }
        }
        self.contexts.push_back(Context {
            time,
            ema: self.ema,
            validated: self.validation.each_ref().map(Validation::confirmed_at),
        });
        while self.contexts.len() > 4 {
            self.contexts.pop_front();
        }
        self.bars.push_back(bar);
        while self.bars.len() > 5 {
            self.bars.pop_front();
        }
        if self.bars.len() != 5 {
            return;
        }
        let p = self.bars[2];
        for (side, confirmed) in [
            (
                Side::Long,
                (0..2).all(|i| p.high > self.bars[i].high)
                    && (3..5).all(|i| p.high >= self.bars[i].high),
            ),
            (
                Side::Short,
                (0..2).all(|i| p.low < self.bars[i].low)
                    && (3..5).all(|i| p.low <= self.bars[i].low),
            ),
        ] {
            if !confirmed {
                continue;
            }
            let levels = if side == Side::Long {
                &mut self.highs
            } else {
                &mut self.lows
            };
            levels.push_back(KeyLevelSnapshot {
                minutes,
                price: if side == Side::Long { p.high } else { p.low },
                pivot_time: p.time,
                confirmed_at: time,
                retest_time: None,
                valid: true,
            });
            while levels.len() > 4 {
                levels.pop_front();
            }
        }
    }
    fn pivot(&self, side: Side, time: u64) -> Option<KeyLevelSnapshot> {
        let levels = if side == Side::Long {
            &self.highs
        } else {
            &self.lows
        };
        levels
            .iter()
            .rev()
            .find(|p| p.confirmed_at <= time)
            .copied()
    }
    fn ema(&self, side: Side, time: u64, minutes: usize) -> Option<ValidatedEmaSnapshot> {
        let c = self.contexts.iter().rev().find(|c| c.time <= time)?;
        Some(ValidatedEmaSnapshot {
            minutes,
            period: EMA_PERIOD,
            value: c.ema,
            observed_at: c.time,
            validated_at: c.validated[usize::from(side == Side::Short)]?,
            touches: 2,
            retest_time: None,
            valid: true,
        })
    }
}

struct Setup {
    policy: Policy,
    ema_context_eligible: bool,
    side: Side,
    start_time: u64,
    confirmed_at: u64,
    end_time: u64,
    start: f64,
    extreme: f64,
    atr: f64,
    strength: f64,
    efficiency: f64,
    extensions: usize,
    pullback_start: Option<u64>,
    pullback_bars: usize,
    adverse: f64,
    candles: VecDeque<TradingClose>,
    turns: VecDeque<ConfirmedTurn>,
    pivot: Option<KeyLevelSnapshot>,
    pivot_crossed: bool,
    ema: Option<ValidatedEmaSnapshot>,
}
impl Setup {
    fn depth(&self) -> f64 {
        if self.pullback_start.is_none() {
            0.0
        } else {
            (self.extreme - self.adverse) / (self.extreme - self.start)
        }
    }
    fn shapes(&self) -> ShapeLabels {
        shape_labels(&self.turns, self.side, self.atr)
    }
    fn snapshot(&self, close: TradingClose, candles: CandleLabels) -> EntrySignal {
        let mut turns = [None; 6];
        for (out, turn) in turns.iter_mut().zip(&self.turns) {
            *out = Some(*turn);
        }
        EntrySignal {
            time: close.time,
            price: close.bar.close,
            boundary: Some(self.extreme),
            atr: close.atr,
            lookback_bars: None,
            trigger: Some(EntryTrigger::StructuredPullback(
                StructuredPullbackTrigger {
                    kind: "structured-pullback",
                    confirmation: self.policy.confirmation,
                    key_role: self.policy.key_role,
                    gates: self.policy.confirmation.map(|_| self.gates(close, candles)),
                    context_eligible: self.policy.confirmation.map(|_| ContextEligibility {
                        pivot: self.pivot_crossed,
                        ema: self.ema_context_eligible,
                    }),
                    setup_id: self.confirmed_at,
                    impulse_start_time: self.start_time,
                    impulse_confirmed_at: self.confirmed_at,
                    impulse_end_time: self.end_time,
                    pullback_started_at: self.pullback_start,
                    impulse_start_price: self.start,
                    impulse_extreme: self.extreme,
                    reference_atr: self.atr,
                    strength_atr: self.strength,
                    efficiency: self.efficiency,
                    pullback_bars: self.pullback_bars,
                    retracement: self.depth(),
                    shapes: self.shapes(),
                    candles,
                    turns,
                    pivot: self.pivot,
                    ema: self.ema,
                },
            )),
        }
    }
    fn observe_pullback(&mut self, close: TradingClose) {
        self.candles.push_back(close);
        while self.candles.len() > 5 {
            self.candles.pop_front();
        }
        if self.candles.len() == 5 {
            let window = std::array::from_fn(|i| self.candles[i]);
            self.confirm_turn(window);
        }
    }
    fn confirm_signal_close(&mut self, close: TradingClose) {
        if self.candles.len() < 4 {
            return;
        }
        let first = self.candles.len() - 4;
        let window = std::array::from_fn(|i| {
            if i == 4 {
                close
            } else {
                self.candles[first + i]
            }
        });
        self.confirm_turn(window);
    }
    fn confirm_turn(&mut self, window: [TradingClose; 5]) {
        let p = window[2];
        let high = (0..2).all(|i| p.bar.high > window[i].bar.high)
            && (3..5).all(|i| p.bar.high >= window[i].bar.high);
        let low = (0..2).all(|i| p.bar.low < window[i].bar.low)
            && (3..5).all(|i| p.bar.low <= window[i].bar.low);
        // A dual pivot has no known intrabar order. The current candle is only
        // a right-side confirmation, never the center of this five-bar window.
        if high == low {
            return;
        }
        let turn = ConfirmedTurn {
            kind: if high { "high" } else { "low" },
            time: p.time,
            confirmed_at: window[4].time,
            price: if high { p.bar.high } else { p.bar.low },
        };
        if let Some(last) = self.turns.back_mut().filter(|p| p.kind == turn.kind) {
            if (high && turn.price > last.price) || (!high && turn.price < last.price) {
                *last = turn;
            }
        } else {
            self.turns.push_back(turn);
        }
        while self.turns.len() > 6 {
            self.turns.pop_front();
        }
    }
    fn gates(&self, close: TradingClose, candles: CandleLabels) -> EntryGates {
        let context = self.policy.key_role == Some(KeyRole::ImpulseContext);
        let pivot = self.pivot.is_some_and(|p| {
            p.valid
                && self.side.sign() * (close.bar.close - p.price) > 0.0
                && if context {
                    self.pivot_crossed
                } else {
                    p.retest_time.is_some()
                }
        });
        let ema = self.ema.is_some_and(|p| {
            p.valid
                && self.side.sign() * (close.bar.close - p.value) > 0.0
                && if context {
                    self.ema_context_eligible
                } else {
                    p.retest_time.is_some()
                }
        });
        let key = match self.policy.key_level {
            KeyLevelPolicy::None => true,
            KeyLevelPolicy::Pivot => pivot,
            KeyLevelPolicy::ValidatedEma => ema,
            KeyLevelPolicy::Either => pivot || ema,
        };
        let s = self.shapes();
        let shape = match self.policy.shape {
            ShapePolicy::None => true,
            ShapePolicy::Any => s.two_legs || s.wedge || s.channel || s.double_test,
            ShapePolicy::TwoLegs => s.two_legs,
            ShapePolicy::Wedge => s.wedge,
            ShapePolicy::Channel => s.channel,
            ShapePolicy::DoubleTest => s.double_test,
        };
        EntryGates {
            retracement: (2..=MAX_PULLBACK).contains(&self.pullback_bars)
                && (MIN_DEPTH..=MAX_DEPTH).contains(&self.depth()),
            key,
            shape,
            candle: !matches!(self.policy.candle, CandlePolicy::Reversal) || candles.reversal,
        }
    }
    fn update_keys(&mut self, close: TradingClose, context: Option<Context>, allow_retest: bool) {
        let sign = self.side.sign();
        let tolerance = TOLERANCE * self.atr;
        let wick = if self.side == Side::Long {
            close.bar.low
        } else {
            close.bar.high
        };
        if let Some(k) = &mut self.pivot {
            if sign * (close.bar.close - k.price) < -tolerance {
                k.valid = false;
            }
            if allow_retest
                && k.valid
                && k.retest_time.is_none()
                && (wick - k.price).abs() <= tolerance
                && sign * (close.bar.close - k.price) > 0.0
            {
                k.retest_time = Some(close.time);
            }
        }
        if let Some(k) = &mut self.ema {
            if let Some(c) = context {
                k.value = c.ema;
                k.observed_at = c.time;
            }
            if sign * (close.bar.close - k.value) < -tolerance {
                k.valid = false;
            }
            if allow_retest
                && k.valid
                && k.retest_time.is_none()
                && (wick - k.value).abs() <= tolerance
                && sign * (close.bar.close - k.value) > 0.0
            {
                k.retest_time = Some(close.time);
            }
        }
    }
}

fn shape_labels(turns: &VecDeque<ConfirmedTurn>, side: Side, atr: f64) -> ShapeLabels {
    let adverse = if side == Side::Long { "low" } else { "high" };
    let lows: Vec<_> = turns.iter().filter(|t| t.kind == adverse).collect();
    let highs: Vec<_> = turns.iter().filter(|t| t.kind != adverse).collect();
    let q = |p: &ConfirmedTurn| side.sign() * p.price;
    let mut labels = ShapeLabels::default();
    if lows.len() >= 2 {
        let a = lows[lows.len() - 2];
        let b = lows[lows.len() - 1];
        if let Some(h) = highs.iter().find(|h| h.time > a.time && h.time < b.time) {
            labels.two_legs = true;
            labels.double_test =
                (q(a) - q(b)).abs() <= TOLERANCE * atr && q(h) - q(a).max(q(b)) >= 0.5 * atr;
        }
    }
    if lows.len() >= 3 {
        let a = lows[lows.len() - 3];
        let b = lows[lows.len() - 2];
        let c = lows[lows.len() - 1];
        let h1 = highs.iter().find(|h| h.time > a.time && h.time < b.time);
        let h2 = highs.iter().find(|h| h.time > b.time && h.time < c.time);
        if let (Some(h1), Some(h2)) = (h1, h2) {
            let first = q(a) - q(b);
            let second = q(b) - q(c);
            labels.wedge = first > 0.0 && second > 0.0 && second < first && q(h2) < q(h1);
        }
    }
    if lows.len() >= 2 && highs.len() >= 2 {
        let a = lows[lows.len() - 2];
        let b = lows[lows.len() - 1];
        let h1 = highs[highs.len() - 2];
        let h2 = highs[highs.len() - 1];
        let slope_low = (q(b) - q(a)) / (b.time - a.time) as f64;
        let slope_high = (q(h2) - q(h1)) / (h2.time - h1.time) as f64;
        let span = b.time.max(h2.time) - a.time.min(h1.time);
        // Two countertrend rails, similar displacement over their common span,
        // and positive width. Four confirmed alternating pivots are mandatory.
        let width = q(h2) - (q(b) + slope_low * (h2.time as f64 - b.time as f64));
        labels.channel = slope_low < 0.0
            && slope_high < 0.0
            && (slope_low - slope_high).abs() * span as f64 <= TOLERANCE * atr
            && width >= TOLERANCE * atr;
    }
    labels
}
fn is_doji(bar: Bar) -> bool {
    let range = bar.high - bar.low;
    range > 0.0 && (bar.close - bar.open).abs() <= 0.1 * range
}
fn candle_labels(
    history: &VecDeque<TradingClose>,
    close: TradingClose,
    side: Side,
    atr: f64,
) -> CandleLabels {
    let mut labels = CandleLabels::default();
    let b = close.bar;
    labels.doji = is_doji(b);
    if let Some(previous) = history.back() {
        let p = previous.bar;
        labels.inside_bar = b.high <= p.high && b.low >= p.low;
        labels.outside_bar = b.high > p.high && b.low < p.low;
        labels.engulfing = side.sign() * (b.close - b.open) > 0.0
            && side.sign() * (p.close - p.open) < 0.0
            && b.open.min(b.close) <= p.open.min(p.close)
            && b.open.max(b.close) >= p.open.max(p.close);
        let range = b.high - b.low;
        let near_end = if side == Side::Long {
            b.high - b.close
        } else {
            b.close - b.low
        };
        labels.reversal = labels.engulfing
            || (labels.outside_bar
                && side.sign() * (b.close - b.open) > 0.0
                && range > 0.0
                && near_end <= 0.25 * range);
    }
    labels.double_doji = history.len() >= 2 && history.iter().rev().take(2).all(|c| is_doji(c.bar));
    if history.len() >= 3 {
        let bars: Vec<_> = history.iter().rev().take(3).collect();
        labels.narrow_range = bars
            .iter()
            .map(|c| c.bar.high)
            .fold(f64::NEG_INFINITY, f64::max)
            - bars.iter().map(|c| c.bar.low).fold(f64::INFINITY, f64::min)
            <= atr;
    }
    labels
}

#[derive(Default)]
pub struct StructuredPullback {
    history: VecDeque<Observation>,
    levels: KeyLevels,
    setup: Option<Setup>,
    eligible_after: u64,
    reset_requested: bool,
}
impl StructuredPullback {
    pub fn observe_minute(&mut self, bar: Bar, minutes: usize) {
        self.levels.observe(bar, background_minutes(minutes));
    }
    pub fn reset(&mut self) {
        self.reset_requested = true;
    }
    pub fn close(
        &mut self,
        close: TradingClose,
        ready: bool,
        enabled: bool,
        directions: [bool; 2],
        strategy: &Strategy,
        execution: &Execution,
        events: &mut Vec<Event>,
    ) -> Option<Candidate> {
        let result = self.evaluate(close, enabled, directions, strategy, execution, events);
        self.history.push_back(Observation { close, ready });
        while self.history.len() > IMPULSE_BARS {
            self.history.pop_front();
        }
        result
    }
    fn event(
        setup: &Setup,
        close: TradingClose,
        kind: &'static str,
        reason: &str,
        events: &mut Vec<Event>,
    ) {
        let candles = candle_labels(&setup.candles, close, setup.side, setup.atr);
        events.push(Event {
            time: close.time,
            kind,
            side: setup.side,
            price: close.bar.close,
            value: Some(setup.confirmed_at as f64),
            trade_id: None,
            reason: reason.into(),
            entry_signal: Some(setup.snapshot(close, candles)),
        });
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
        if !enabled || reset || !directions.iter().any(|a| *a) {
            if let Some(setup) = self.setup.take() {
                Self::event(
                    &setup,
                    close,
                    "setup",
                    if !enabled || reset {
                        "sp-disabled"
                    } else {
                        "sp-direction-invalid"
                    },
                    events,
                );
            }
            self.eligible_after = close.time;
            return None;
        }
        if let Some(mut setup) = self.setup.take() {
            let reason = if !directions[usize::from(setup.side == Side::Short)] {
                Some("sp-direction-invalid")
            } else {
                None
            };
            if let Some(reason) = reason {
                Self::event(&setup, close, "setup", reason, events);
                self.eligible_after = close.time;
                return None;
            }
            let previous = self.history.back().expect("setup has history").close;
            if setup.pullback_start.is_none() {
                if setup.pivot.is_some_and(|p| {
                    execution.breaks_by_tick(close.bar.close, p.price, setup.side.sign())
                }) {
                    setup.pivot_crossed = true;
                }
                if setup.side.sign() * (close.bar.close - previous.bar.close) < 0.0 {
                    // The first reversing candle belongs to the pullback: its wick
                    // cannot move the frozen pre-pullback impulse boundary.
                    if !setup.pivot_crossed {
                        if let Some(p) = &mut setup.pivot {
                            p.valid = false;
                        }
                    }
                    setup.pullback_start = Some(close.time);
                    setup.adverse = if setup.side == Side::Long {
                        close.bar.low
                    } else {
                        close.bar.high
                    };
                } else {
                    setup.extensions += 1;
                    if setup.extensions > MAX_EXTENSION {
                        Self::event(&setup, close, "setup", "sp-expired", events);
                        self.eligible_after = close.time;
                        return None;
                    }
                    setup.extreme = if setup.side == Side::Long {
                        setup.extreme.max(close.bar.high)
                    } else {
                        setup.extreme.min(close.bar.low)
                    };
                    setup.end_time = close.time;
                    self.setup = Some(setup);
                    return None;
                }
            }
            setup.pullback_bars += 1;
            setup.adverse = if setup.side == Side::Long {
                setup.adverse.min(close.bar.low)
            } else {
                setup.adverse.max(close.bar.high)
            };
            let breaking =
                execution.breaks_by_tick(close.bar.close, setup.extreme, setup.side.sign());
            setup.update_keys(close, self.levels.contexts.back().copied(), !breaking);
            if setup.pullback_bars == 1 {
                Self::event(&setup, close, "setup", "sp-pullback-start", events);
            }
            let labels = candle_labels(&setup.candles, close, setup.side, setup.atr);
            if setup.depth() > MAX_DEPTH || setup.pullback_bars > MAX_PULLBACK {
                Self::event(
                    &setup,
                    close,
                    "setup",
                    if setup.depth() > MAX_DEPTH {
                        "sp-structure-invalid"
                    } else {
                        "sp-expired"
                    },
                    events,
                );
                self.eligible_after = close.time;
                return None;
            }
            if breaking {
                // v9 and explicit before-breakout preserve the strict prior-
                // close contract. v10 signal-close may confirm t-2 using t,
                // whose complete OHLC is known before the next-open entry.
                if setup.policy.confirmation == Some(ConfirmationPolicy::SignalClose) {
                    setup.confirm_signal_close(close);
                }
                self.eligible_after = close.time;
                Self::event(&setup, close, "setup", "sp-first-break", events);
                let gates = setup.gates(close, labels);
                let reason = if !gates.retracement {
                    Some("sp-retracement-invalid")
                } else if !gates.key {
                    Some("sp-key-level-missing")
                } else if !gates.shape {
                    Some("sp-shape-missing")
                } else if !gates.candle {
                    Some("sp-candle-missing")
                } else {
                    None
                };
                if let Some(reason) = reason {
                    Self::event(&setup, close, "setup", reason, events);
                    return None;
                }
                Self::event(&setup, close, "setup", "sp-accepted", events);
                return Some(Candidate {
                    side: setup.side,
                    anchor: Some(setup.adverse),
                    atr: close.atr,
                    entry_signal: setup.snapshot(close, labels),
                });
            }
            setup.observe_pullback(close);
            self.setup = Some(setup);
            return None;
        }
        if self.history.len() != IMPULSE_BARS {
            return None;
        }
        let origin = self.history[0];
        if !origin.ready || origin.close.time < self.eligible_after || origin.close.atr <= 0.0 {
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
        let mut path = 0.0;
        let mut prior = origin.close.bar.close;
        let mut extreme = if side == Side::Long {
            close.bar.high
        } else {
            close.bar.low
        };
        for bar in self
            .history
            .iter()
            .skip(1)
            .map(|o| o.close.bar)
            .chain(std::iter::once(close.bar))
        {
            path += (bar.close - prior).abs();
            prior = bar.close;
            extreme = if side == Side::Long {
                extreme.max(bar.high)
            } else {
                extreme.min(bar.low)
            };
        }
        if delta.abs() < IMPULSE_ATR * origin.close.atr
            || path <= 0.0
            || delta.abs() / path < MIN_EFFICIENCY
        {
            return None;
        }
        let pivot = self
            .levels
            .pivot(side, origin.close.time)
            .filter(|p| side.sign() * (origin.close.bar.close - p.price) <= 0.0);
        let pivot_crossed =
            pivot.is_some_and(|p| execution.breaks_by_tick(close.bar.close, p.price, side.sign()));
        let ema = self.levels.ema(
            side,
            origin.close.time,
            background_minutes(strategy.trade_minutes),
        );
        let setup = Setup {
            policy: strategy
                .structured_pullback
                .expect("validated structured entry"),
            ema_context_eligible: ema
                .is_some_and(|e| side.sign() * (origin.close.bar.close - e.value) >= 0.0),
            side,
            start_time: origin.close.time,
            confirmed_at: close.time,
            end_time: close.time,
            start: origin.close.bar.close,
            extreme,
            atr: origin.close.atr,
            strength: delta.abs() / origin.close.atr,
            efficiency: delta.abs() / path,
            extensions: 0,
            pullback_start: None,
            pullback_bars: 0,
            adverse: extreme,
            candles: VecDeque::new(),
            turns: VecDeque::new(),
            pivot,
            pivot_crossed,
            ema,
        };
        Self::event(&setup, close, "impulse", "structured-pullback", events);
        self.setup = Some(setup);
        None
    }
}
