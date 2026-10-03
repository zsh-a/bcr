use super::config::{Strategy, ATR_PERIOD, FAST_EMA, SLOW_EMA};
use super::model::{Bar, DAY, MINUTE};
use std::collections::VecDeque;

#[derive(Default)]
pub struct CandleBuilder {
    bucket: Option<Bar>,
    rows: usize,
}
impl CandleBuilder {
    /// UTC aligned, complete candles only. The builder survives data partitions.
    pub fn close(&mut self, bar: Bar, minutes: usize) -> Option<Bar> {
        let interval = minutes as u64 * MINUTE;
        // Weekly context candles start Monday 00:00 UTC, not Unix-epoch Thursday.
        let offset = if minutes == 10080 { 4 * DAY } else { 0 };
        let start = (bar.time - offset) / interval * interval + offset;
        if self.bucket.is_none_or(|b| b.time != start) {
            self.bucket = Some(Bar { time: start, ..bar });
            self.rows = 1;
        } else if let Some(b) = &mut self.bucket {
            b.high = b.high.max(bar.high);
            b.low = b.low.min(bar.low);
            b.close = bar.close;
            b.volume += bar.volume;
            self.rows += 1;
        }
        if bar.time + MINUTE == start + interval && self.rows == minutes {
            self.bucket.take()
        } else {
            None
        }
    }
}
pub struct ClosedCandles {
    pub trade: Option<Bar>,
    pub ema_updated: bool,
}
#[derive(Default)]
pub struct Indicators {
    pub atr: f64,
    pub fast: f64,
    pub slow: f64,
    previous: Option<f64>,
    atr_count: usize,
    atr_sum: f64,
    ema_count: usize,
    fast_history: VecDeque<f64>,
    trade: CandleBuilder,
}
impl Indicators {
    /// Signals, ATR and optional EMA share exactly the same closed trading candle.
    pub fn close(&mut self, bar: Bar, config: &Strategy) -> ClosedCandles {
        let trade = self.trade.close(bar, config.trade_minutes);
        if let Some(candle) = trade {
            let tr = self.previous.map_or(candle.high - candle.low, |p| {
                (candle.high - candle.low)
                    .max((candle.high - p).abs())
                    .max((candle.low - p).abs())
            });
            self.previous = Some(candle.close);
            self.atr_count += 1;
            if self.atr_count <= ATR_PERIOD {
                self.atr_sum += tr;
                self.atr = self.atr_sum / self.atr_count as f64;
            } else {
                self.atr = (self.atr * (ATR_PERIOD - 1) as f64 + tr) / ATR_PERIOD as f64;
            }
        }
        if config.filter != "ema" {
            return ClosedCandles {
                trade,
                ema_updated: false,
            };
        }
        let Some(candle) = trade else {
            return ClosedCandles {
                trade,
                ema_updated: false,
            };
        };
        let value = candle.close;
        if self.ema_count == 0 {
            self.fast = value;
            self.slow = value;
        } else {
            self.fast += 2.0 / (FAST_EMA + 1) as f64 * (value - self.fast);
            self.slow += 2.0 / (SLOW_EMA + 1) as f64 * (value - self.slow);
        }
        self.ema_count += 1;
        self.fast_history.push_back(self.fast);
        if self.fast_history.len() > 4 {
            self.fast_history.pop_front();
        }
        ClosedCandles {
            trade,
            ema_updated: true,
        }
    }
    pub fn ready(&self) -> bool {
        self.atr_count >= ATR_PERIOD && self.atr > 0.0
    }
    pub fn direction(&self) -> i8 {
        if self.ema_count < SLOW_EMA
            || self.atr_count < ATR_PERIOD
            || self.fast_history.len() < 4
            || self.atr <= 0.0
        {
            return 0;
        }
        let older = self.fast_history[0];
        if self.fast > self.slow && self.fast > older {
            1
        } else if self.fast < self.slow && self.fast < older {
            -1
        } else {
            0
        }
    }
}
