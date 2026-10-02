use super::config::*;
use super::indicators::Indicators;
use super::model::*;
use std::collections::VecDeque;

#[derive(Clone)]
pub struct Candidate {
    pub side: Side,
    pub anchor: Option<f64>,
    pub atr: f64,
}
struct Setup {
    side: Side,
    start: f64,
    extreme: f64,
    retrace: f64,
    bars: usize,
    pulling: bool,
}
#[derive(Default)]
pub struct Signals {
    history: VecDeque<Bar>,
    setup: Option<Setup>,
}
impl Signals {
    pub fn reset(&mut self) {
        self.setup = None;
    }
    pub fn close(
        &mut self,
        bar: Bar,
        indicators: &Indicators,
        config: &Config,
        enabled: bool,
        events: &mut Vec<Event>,
    ) -> Option<Candidate> {
        let result = if enabled {
            self.evaluate(bar, indicators, config, events)
        } else {
            self.reset();
            None
        };
        self.history.push_back(bar);
        let capacity = if config.strategy.entry == "breakout" {
            config.strategy.breakout_bars
        } else {
            IMPULSE_BARS
        };
        if self.history.len() > capacity {
            self.history.pop_front();
        }
        result
    }
    fn evaluate(
        &mut self,
        bar: Bar,
        indicators: &Indicators,
        config: &Config,
        events: &mut Vec<Event>,
    ) -> Option<Candidate> {
        if !indicators.ready() {
            self.setup = None;
            return None;
        }
        let filter = if config.strategy.filter == "ema" {
            Some(indicators.direction())
        } else {
            None
        };
        let allowed = |side: Side| {
            (config.strategy.direction == "both"
                || config.strategy.direction == if side == Side::Long { "long" } else { "short" })
                && filter
                    .is_none_or(|direction| direction == if side == Side::Long { 1 } else { -1 })
        };
        let atr = indicators.atr;
        let mut candidate = None;
        if config.strategy.entry == "breakout" {
            if self.history.len() >= config.strategy.breakout_bars {
                let high = self
                    .history
                    .iter()
                    .rev()
                    .take(config.strategy.breakout_bars)
                    .map(|b| b.high)
                    .fold(f64::NEG_INFINITY, f64::max);
                let low = self
                    .history
                    .iter()
                    .rev()
                    .take(config.strategy.breakout_bars)
                    .map(|b| b.low)
                    .fold(f64::INFINITY, f64::min);
                for (side, extreme) in [(Side::Long, high), (Side::Short, low)] {
                    if allowed(side)
                        && side.sign() * (bar.close - extreme) >= config.execution.tick_size
                    {
                        candidate = Some(Candidate {
                            side,
                            anchor: None,
                            atr,
                        });
                        break;
                    }
                }
            }
        } else {
            // Without EMA, the impulse establishes direction. A retracement does
            // not reverse an existing setup; its structural rules invalidate it.
            let side = self.setup.as_ref().map(|s| s.side).unwrap_or_else(|| {
                let previous = self
                    .history
                    .iter()
                    .rev()
                    .nth(IMPULSE_BARS - 1)
                    .map_or(bar.close, |b| b.close);
                if bar.close >= previous {
                    Side::Long
                } else {
                    Side::Short
                }
            });
            if !allowed(side) {
                self.setup = None;
                return None;
            }
            if let Some(mut setup) = self.setup.take() {
                if setup.side == side {
                    let previous = self.history.back().map_or(bar.open, |b| b.close);
                    if !setup.pulling && side.sign() * (bar.close - previous) >= 0.0 {
                        setup.extreme = if side == Side::Long {
                            setup.extreme.max(bar.high)
                        } else {
                            setup.extreme.min(bar.low)
                        };
                        setup.retrace = setup.extreme;
                        self.setup = Some(setup);
                    } else {
                        setup.pulling = true;
                        setup.bars += 1;
                        setup.retrace = if side == Side::Long {
                            setup.retrace.min(bar.low)
                        } else {
                            setup.retrace.max(bar.high)
                        };
                        let leg = side.sign() * (setup.extreme - setup.start);
                        let depth = side.sign() * (setup.extreme - setup.retrace) / leg;
                        if setup.bars <= MAX_PULLBACK_BARS && depth <= MAX_RETRACEMENT {
                            if setup.bars >= MIN_PULLBACK_BARS
                                && depth >= MIN_RETRACEMENT
                                && side.sign() * (bar.close - setup.extreme)
                                    >= config.execution.tick_size
                            {
                                candidate = Some(Candidate {
                                    side,
                                    anchor: Some(setup.retrace),
                                    atr,
                                });
                            } else {
                                self.setup = Some(setup);
                            }
                        }
                    }
                }
            }
            if candidate.is_none() && self.setup.is_none() && self.history.len() >= IMPULSE_BARS {
                let start = self.history[self.history.len() - IMPULSE_BARS].close;
                let displacement = side.sign() * (bar.close - start);
                let mut previous = start;
                let mut path = 0.0;
                let mut extreme = if side == Side::Long {
                    bar.high
                } else {
                    bar.low
                };
                for b in self
                    .history
                    .iter()
                    .skip(self.history.len() - IMPULSE_BARS + 1)
                    .chain(std::iter::once(&bar))
                {
                    path += (b.close - previous).abs();
                    previous = b.close;
                    extreme = if side == Side::Long {
                        extreme.max(b.high)
                    } else {
                        extreme.min(b.low)
                    };
                }
                if displacement >= IMPULSE_ATR * atr
                    && path > 0.0
                    && displacement / path >= MIN_EFFICIENCY
                {
                    self.setup = Some(Setup {
                        side,
                        start,
                        extreme,
                        retrace: extreme,
                        bars: 0,
                        pulling: false,
                    });
                    events.push(Event {
                        time: bar.time + config.strategy.trade_minutes as u64 * MINUTE - 1,
                        kind: "impulse",
                        side,
                        price: extreme,
                        value: Some(displacement / atr),
                        trade_id: None,
                        reason: "impulse".into(),
                    });
                }
            }
        }
        if let Some(candidate) = &candidate {
            events.push(Event {
                time: bar.time + config.strategy.trade_minutes as u64 * MINUTE - 1,
                kind: "signal",
                side: candidate.side,
                price: bar.close,
                value: candidate.anchor,
                trade_id: None,
                reason: config.strategy.entry.clone(),
            });
            self.setup = None;
        }
        candidate
    }
}
