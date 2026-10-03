use super::config::*;
use super::indicators::Indicators;
use super::model::*;
use std::collections::VecDeque;

#[derive(Clone)]
pub struct Candidate {
    pub side: Side,
    pub anchor: Option<f64>,
    pub atr: f64,
    pub entry_signal: EntrySignal,
}
/// Market direction gates shared by account signals and independent observers.
/// Account availability and detector lifecycle remain with their callers.
pub(super) fn entry_directions(
    strategy: &Strategy,
    indicator_direction: i8,
    background: [bool; 2],
) -> [bool; 2] {
    let direction =
        matches!(strategy.filter.as_str(), "ema" | "slow-ema").then_some(indicator_direction);
    [Side::Long, Side::Short].map(|side| {
        background[usize::from(side == Side::Short)]
            && (strategy.direction == "both"
                || strategy.direction == if side == Side::Long { "long" } else { "short" })
            && direction.is_none_or(|d| d == if side == Side::Long { 1 } else { -1 })
    })
}
struct Setup {
    side: Side,
    start: f64,
    extreme: f64,
    retrace: f64,
    bars: usize,
    pulling: bool,
}
#[derive(Clone, Copy)]
struct KdjArm {
    time: u64,
    k: f64,
}
#[derive(Default)]
pub struct Signals {
    history: VecDeque<Bar>,
    setup: Option<Setup>,
    kdj_long: Option<KdjArm>,
    kdj_short: Option<KdjArm>,
    low_episode: bool,
    high_episode: bool,
    breakout_episodes: [Option<f64>; 2],
    replay_start: Option<u64>,
    price_action: super::price_action::PriceAction,
    structured_pullback: super::structured_pullback::StructuredPullback,
}
impl Signals {
    /// Warmup builds channel history but cannot consume a research episode.
    pub fn begin_replay(&mut self, start: u64) {
        self.replay_start = Some(start);
        self.breakout_episodes = [None, None];
    }
    pub fn reset(&mut self) {
        // Position/risk resets cancel armed setups, not market breakout episodes.
        self.setup = None;
        self.kdj_long = None;
        self.kdj_short = None;
        self.price_action.reset();
        self.structured_pullback.reset();
    }
    pub fn observe_minute(&mut self, bar: Bar, strategy: &Strategy) {
        if strategy.entry == "structured-pullback" {
            self.structured_pullback
                .observe_minute(bar, strategy.trade_minutes);
        } else if strategy.entry == "price-action" {
            self.price_action
                .observe_minute(bar, strategy.trade_minutes);
        }
    }
    pub fn close(
        &mut self,
        close: TradingClose,
        indicators: &Indicators,
        config: &Config,
        enabled: bool,
        events: &mut Vec<Event>,
        background_directions: [bool; 2],
    ) -> Option<Candidate> {
        let result = if matches!(
            config.strategy.entry.as_str(),
            "price-action" | "structured-pullback"
        ) {
            let directions = entry_directions(
                &config.strategy,
                indicators.direction(),
                background_directions,
            );
            if config.strategy.entry == "structured-pullback" {
                self.structured_pullback.close(
                    close,
                    indicators.ready(),
                    enabled,
                    directions,
                    &config.strategy,
                    &config.execution,
                    events,
                )
            } else {
                self.price_action.close(
                    close,
                    indicators.ready(),
                    enabled,
                    directions,
                    &config.strategy,
                    &config.execution,
                    events,
                )
            }
        } else if config.strategy.entry == "kdj" {
            self.kdj_close(close, indicators, config, enabled, background_directions)
        } else if config.strategy.entry == "breakout" && config.strategy.episode_reentry() {
            self.breakout_episode_close(close, indicators, config, enabled, events)
        } else if enabled {
            self.evaluate(close, indicators, config, events, [true, true])
        } else {
            self.reset();
            None
        };
        self.history.push_back(close.bar);
        let capacity = if config.strategy.entry == "breakout" {
            config.strategy.breakout_bars
        } else {
            IMPULSE_BARS
        };
        if self.history.len() > capacity {
            self.history.pop_front();
        }
        if matches!(
            config.strategy.entry.as_str(),
            "kdj" | "price-action" | "structured-pullback"
        ) {
            if let Some(candidate) = &result {
                events.push(Event {
                    time: close.time,
                    kind: "signal",
                    side: candidate.side,
                    price: close.bar.close,
                    value: candidate.anchor,
                    trade_id: None,
                    reason: config.strategy.entry.clone(),
                    entry_signal: Some(candidate.entry_signal),
                });
            }
        }
        result
    }
    fn breakout_episode_close(
        &mut self,
        close: TradingClose,
        indicators: &Indicators,
        config: &Config,
        enabled: bool,
        events: &mut Vec<Event>,
    ) -> Option<Candidate> {
        if self.replay_start.is_none_or(|start| close.bar.time < start)
            || !indicators.ready()
            || self.history.len() < config.strategy.breakout_bars
        {
            return None;
        }
        let mut opened = [false, false];
        for (index, side) in [Side::Long, Side::Short].into_iter().enumerate() {
            if config.strategy.direction != "both"
                && config.strategy.direction != if side == Side::Long { "long" } else { "short" }
            {
                continue;
            }
            if let Some(boundary) = self.breakout_episodes[index] {
                if side.sign() * (close.bar.close - boundary) <= 0.0 {
                    self.breakout_episodes[index] = None;
                    events.push(Event {
                        time: close.time,
                        kind: "setup",
                        side,
                        price: close.bar.close,
                        value: Some(boundary),
                        trade_id: None,
                        reason: "breakout-episode-reset".into(),
                        entry_signal: None,
                    });
                }
                // A reset close cannot simultaneously start another episode.
                continue;
            }
            let boundary = self
                .history
                .iter()
                .rev()
                .take(config.strategy.breakout_bars)
                .map(|bar| {
                    if side == Side::Long {
                        bar.high
                    } else {
                        bar.low
                    }
                })
                .reduce(|a, b| {
                    if side == Side::Long {
                        a.max(b)
                    } else {
                        a.min(b)
                    }
                })
                .expect("complete breakout history");
            if config
                .execution
                .breaks_by_tick(close.bar.close, boundary, side.sign())
            {
                self.breakout_episodes[index] = Some(boundary);
                opened[index] = true;
                let filter_allowed = !matches!(config.strategy.filter.as_str(), "ema" | "slow-ema")
                    || indicators.direction() == if side == Side::Long { 1 } else { -1 };
                events.push(Event {
                    time: close.time,
                    kind: "setup",
                    side,
                    price: close.bar.close,
                    value: Some(boundary),
                    trade_id: None,
                    reason: if !enabled {
                        "breakout-episode-unavailable"
                    } else if !filter_allowed {
                        "breakout-episode-filter"
                    } else {
                        "breakout-episode-start"
                    }
                    .into(),
                    entry_signal: None,
                });
            }
        }
        enabled
            .then(|| self.evaluate(close, indicators, config, events, opened))
            .flatten()
    }
    fn kdj_close(
        &mut self,
        close: TradingClose,
        indicators: &Indicators,
        config: &Config,
        enabled: bool,
        background: [bool; 2],
    ) -> Option<Candidate> {
        let Some(current) = indicators.kdj else {
            self.reset();
            return None;
        };
        let low = current.k <= 20.0;
        let high = current.k >= 80.0;
        let direction = matches!(config.strategy.filter.as_str(), "ema" | "slow-ema")
            .then(|| indicators.direction());
        let allowed = |side: Side, external: bool| {
            enabled
                && indicators.ready()
                && external
                && (config.strategy.direction == "both"
                    || config.strategy.direction
                        == if side == Side::Long { "long" } else { "short" })
                && direction.is_none_or(|d| d == if side == Side::Long { 1 } else { -1 })
        };
        let long = allowed(Side::Long, background[0]);
        let short = allowed(Side::Short, background[1]);
        if !long {
            self.kdj_long = None;
        }
        if !short {
            self.kdj_short = None;
        }
        // A continuous oversold/overbought episode is consumed even when entry
        // is disabled. A reset cannot revive a crossover inherited from warmup,
        // a held position, or an invalid trend direction.
        if low && !self.low_episode && long {
            self.kdj_long = Some(KdjArm {
                time: close.time,
                k: current.k,
            });
        }
        if high && !self.high_episode && short {
            self.kdj_short = Some(KdjArm {
                time: close.time,
                k: current.k,
            });
        }
        self.low_episode = low;
        self.high_episode = high;
        let previous = indicators.previous_kdj?;
        let selected = if long && previous.k <= previous.d && current.k > current.d {
            self.kdj_long.map(|arm| (Side::Long, arm))
        } else if short && previous.k >= previous.d && current.k < current.d {
            self.kdj_short.map(|arm| (Side::Short, arm))
        } else {
            None
        };
        let (side, arm) = selected.filter(|(_, arm)| arm.time < close.time)?;
        self.kdj_long = None;
        self.kdj_short = None;
        let ema = matches!(config.strategy.filter.as_str(), "ema" | "slow-ema");
        Some(Candidate {
            side,
            anchor: None,
            atr: close.atr,
            entry_signal: EntrySignal {
                time: close.time,
                price: close.bar.close,
                boundary: None,
                atr: close.atr,
                lookback_bars: None,
                trigger: Some(EntryTrigger::Kdj(KdjTrigger {
                    kind: "kdj-cross",
                    armed_at: arm.time,
                    armed_k: arm.k,
                    previous_k: previous.k,
                    previous_d: previous.d,
                    k: current.k,
                    d: current.d,
                    j: current.j,
                    slow_ema: ema.then_some(indicators.slow),
                    slow_ema3_ago: ema.then_some(indicators.slow_previous).flatten(),
                })),
            },
        })
    }
    fn evaluate(
        &mut self,
        close: TradingClose,
        indicators: &Indicators,
        config: &Config,
        events: &mut Vec<Event>,
        breakout_allowed: [bool; 2],
    ) -> Option<Candidate> {
        let bar = close.bar;
        if !indicators.ready() {
            self.setup = None;
            return None;
        }
        let filter = if matches!(config.strategy.filter.as_str(), "ema" | "slow-ema") {
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
        let atr = close.atr;
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
                        && breakout_allowed[usize::from(side == Side::Short)]
                        && config
                            .execution
                            .breaks_by_tick(bar.close, extreme, side.sign())
                    {
                        candidate = Some(Candidate {
                            side,
                            anchor: None,
                            atr,
                            entry_signal: EntrySignal {
                                time: close.time,
                                price: bar.close,
                                boundary: Some(extreme),
                                atr,
                                lookback_bars: Some(config.strategy.breakout_bars),
                                trigger: None,
                            },
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
                                && config.execution.breaks_by_tick(
                                    bar.close,
                                    setup.extreme,
                                    side.sign(),
                                )
                            {
                                candidate = Some(Candidate {
                                    side,
                                    anchor: Some(setup.retrace),
                                    atr,
                                    entry_signal: EntrySignal {
                                        time: close.time,
                                        price: bar.close,
                                        boundary: Some(setup.extreme),
                                        atr,
                                        lookback_bars: None,
                                        trigger: None,
                                    },
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
                        time: close.time,
                        kind: "impulse",
                        side,
                        price: extreme,
                        value: Some(displacement / atr),
                        trade_id: None,
                        reason: "impulse".into(),
                        entry_signal: None,
                    });
                }
            }
        }
        if let Some(candidate) = &candidate {
            events.push(Event {
                time: close.time,
                kind: "signal",
                side: candidate.side,
                price: bar.close,
                value: candidate.anchor,
                trade_id: None,
                reason: config.strategy.entry.clone(),
                entry_signal: Some(candidate.entry_signal),
            });
            self.setup = None;
        }
        candidate
    }
}

#[cfg(test)]
mod direction_tests {
    use super::*;

    #[test]
    fn market_directions_respect_filters_without_account_state() {
        let mut strategy = Config::default().strategy;
        for (filter, trend, background, expected) in [
            ("none", -1, [true, true], [true, true]),
            ("none", 0, [true, true], [true, true]),
            ("background", 1, [false, true], [false, true]),
            ("background", -1, [true, false], [true, false]),
            ("background", 0, [false, false], [false, false]),
            ("ema", 1, [true, true], [true, false]),
            ("ema", -1, [true, true], [false, true]),
            ("ema", 0, [true, true], [false, false]),
            ("slow-ema", 1, [true, true], [true, false]),
            ("slow-ema", -1, [true, true], [false, true]),
            ("slow-ema", 0, [true, true], [false, false]),
        ] {
            strategy.filter = filter.into();
            for (direction, allowed) in [
                ("both", expected),
                ("long", [expected[0], false]),
                ("short", [false, expected[1]]),
            ] {
                strategy.direction = direction.into();
                assert_eq!(
                    entry_directions(&strategy, trend, background),
                    allowed,
                    "{filter}/{direction}/{trend}"
                );
            }
        }
    }
}
