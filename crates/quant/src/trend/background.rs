use super::config::*;
use super::indicators::CandleBuilder;
use super::model::*;
use std::collections::VecDeque;

/// A causal view of the last completed higher-period candles. Incomplete
/// candles never change it; swing points become known two candles later.
#[derive(Default)]
pub struct Background {
    builder: CandleBuilder,
    history: VecDeque<Bar>,
    ema_history: VecDeque<f64>,
    ema: f64,
    atr: f64,
    count: usize,
    previous_close: Option<f64>,
    lows: VecDeque<f64>,
    highs: VecDeque<f64>,
    as_of: Option<u64>,
}

#[cfg(test)]
#[path = "background_tests.rs"]
mod tests;
impl Background {
    pub fn close(&mut self, bar: Bar, trade_minutes: usize) {
        let minutes = background_minutes(trade_minutes);
        if let Some(candle) = self.builder.close(bar, minutes) {
            self.update(candle, minutes);
        }
    }
    fn update(&mut self, candle: Bar, minutes: usize) {
        let tr = self.previous_close.map_or(candle.high - candle.low, |p| {
            (candle.high - candle.low)
                .max((candle.high - p).abs())
                .max((candle.low - p).abs())
        });
        self.count += 1;
        let weight = self.count.min(ATR_PERIOD) as f64;
        self.atr += (tr - self.atr) / weight;
        self.ema = if self.count == 1 {
            candle.close
        } else {
            self.ema + 2.0 / (BACKGROUND_EMA + 1) as f64 * (candle.close - self.ema)
        };
        self.previous_close = Some(candle.close);
        self.as_of = Some(candle.time + minutes as u64 * MINUTE - 1);
        self.ema_history.push_back(self.ema);
        if self.ema_history.len() > BACKGROUND_SLOPE + 1 {
            self.ema_history.pop_front();
        }
        self.history.push_back(candle);
        if self.history.len() > BACKGROUND_WINDOW + 1 {
            self.history.pop_front();
        }
        if self.history.len() >= 5 {
            let start = self.history.len() - 5;
            let pivot = self.history[start + 2];
            let high = (0..2).all(|i| pivot.high > self.history[start + i].high)
                && (3..5).all(|i| pivot.high >= self.history[start + i].high);
            let low = (0..2).all(|i| pivot.low < self.history[start + i].low)
                && (3..5).all(|i| pivot.low <= self.history[start + i].low);
            if high {
                self.highs.push_back(pivot.high);
                if self.highs.len() > 2 {
                    self.highs.pop_front();
                }
            }
            if low {
                self.lows.push_back(pivot.low);
                if self.lows.len() > 2 {
                    self.lows.pop_front();
                }
            }
        }
    }
    pub fn decide(
        &self,
        time: u64,
        price: f64,
        side: Side,
        signal_atr: f64,
        execution: &Execution,
        trade_minutes: usize,
    ) -> ContextDecision {
        debug_assert!(self.as_of.is_none_or(|as_of| as_of <= time));
        let ready = self.history.len() == BACKGROUND_WINDOW + 1 && self.atr > 0.0;
        let mut path = 0.0;
        for i in 1..self.history.len() {
            path += (self.history[i].close - self.history[i - 1].close).abs();
        }
        let efficiency = ready.then(|| {
            if path > 0.0 {
                (self.history.back().unwrap().close - self.history.front().unwrap().close).abs()
                    / path
            } else {
                0.0
            }
        });
        let slope = self.ema - self.ema_history.front().copied().unwrap_or(self.ema);
        let last = self.previous_close.unwrap_or(price);
        let direction = if ready && last > self.ema && slope > 0.0 {
            Some(Side::Long)
        } else if ready && last < self.ema && slope < 0.0 {
            Some(Side::Short)
        } else {
            None
        };
        let anchor = direction.map(|direction| {
            if direction == Side::Long {
                self.lows.back().copied().unwrap_or_else(|| {
                    self.history
                        .iter()
                        .map(|b| b.low)
                        .fold(f64::INFINITY, f64::min)
                })
            } else {
                self.highs.back().copied().unwrap_or_else(|| {
                    self.history
                        .iter()
                        .map(|b| b.high)
                        .fold(f64::NEG_INFINITY, f64::max)
                })
            }
        });
        let structure_valid = match direction {
            Some(Side::Long) => {
                last > anchor.unwrap() && (self.lows.len() < 2 || self.lows[1] >= self.lows[0])
            }
            Some(Side::Short) => {
                last < anchor.unwrap() && (self.highs.len() < 2 || self.highs[1] <= self.highs[0])
            }
            None => false,
        };
        let phase = if !ready {
            "warming"
        } else if efficiency.unwrap() < BACKGROUND_MIN_EFFICIENCY {
            "range"
        } else if direction.is_none() || !structure_valid {
            "conflict"
        } else if direction == Some(Side::Long) {
            "uptrend"
        } else {
            "downtrend"
        };
        // A conservative unchanged-price round trip: fees, slippage and up to
        // two rounding ticks. Future funding and unknown book impact are excluded.
        let cost_atr = execution.round_trip_cost_atr(price, signal_atr);
        let extension_atr = ready.then(|| side.sign() * (price - self.ema) / self.atr);
        let reason = if !ready {
            "context-warmup"
        } else if phase == "range" {
            "context-range"
        } else if phase == "conflict" {
            "context-conflict"
        } else if direction != Some(side) {
            "context-direction"
        } else if side.sign() * (price - anchor.unwrap()) <= 0.0 {
            "context-structure"
        } else {
            "context-ready"
        };
        ContextDecision {
            time,
            price,
            side,
            minutes: background_minutes(trade_minutes),
            as_of: self.as_of,
            phase,
            direction,
            reference: self.as_of.map(|_| self.ema),
            anchor,
            efficiency,
            extension_atr,
            cost_atr,
            allowed: reason == "context-ready",
            reason,
        }
    }
}
