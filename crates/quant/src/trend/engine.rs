use super::indicators::Indicators;
use super::model::*;
use std::collections::VecDeque;

#[derive(Clone)]
struct Position {
    id: usize,
    side: Side,
    time: u64,
    entry: f64,
    quantity: f64,
    initial_stop: f64,
    stop: f64,
    distance: f64,
    atr: f64,
    entry_fee: f64,
    funding: f64,
    mfe: f64,
    mae: f64,
    stop_reason: &'static str,
}
#[derive(Clone)]
struct Candidate {
    side: Side,
    anchor: f64,
    atr: f64,
}
struct Setup {
    side: Side,
    start: f64,
    extreme: f64,
    retrace: f64,
    bars: usize,
    pulling: bool,
}

/// Minute event ordering: carried-position funding, prior-close orders, old
/// stops, close-only indicators/signals, then stop changes for the next minute.
pub struct Engine {
    pub config: Config,
    start: u64,
    end: u64,
    expected: u64,
    finished: bool,
    indicators: Indicators,
    history: VecDeque<Bar>,
    position: Option<Position>,
    pending: Option<Candidate>,
    setup: Option<Setup>,
    funding: Vec<Funding>,
    funding_cursor: usize,
    cash: f64,
    peak: f64,
    max_drawdown: f64,
    day: u64,
    day_equity: f64,
    daily_blocked: bool,
    daily_exit: bool,
    cooldown_until: u64,
    loss_streak: usize,
    cooldown_streak: usize,
    longest_loss_streak: usize,
    trades: usize,
    wins: usize,
    losses: usize,
    next_id: usize,
    profit_sum: f64,
    loss_sum: f64,
    r_sum: f64,
    fees: f64,
    funding_sum: f64,
    rejected: usize,
    funding_events: usize,
    rows: usize,
    last: Option<(Bar, Bar)>,
    output: Chunk,
}
impl Engine {
    pub fn new(
        config: Config,
        funding: Vec<Funding>,
        start: u64,
        end: u64,
        warmup: u64,
    ) -> Result<Self, String> {
        config.validate()?;
        if start % MINUTE != 0
            || end % MINUTE != 0
            || warmup % MINUTE != 0
            || warmup > start
            || start >= end
            || end - start > 730 * DAY
            || start - warmup > MAX_WARMUP_DAYS * DAY
            || start < 1_000_000_000_000
        {
            return Err("invalid minute backtest window".into());
        }
        let mut previous = 0;
        for f in &funding {
            if f.time < start
                || f.time >= end
                || f.time <= previous
                || !f.rate.is_finite()
                || f.rate.abs() > 1.0
                || !f.interval_hours.is_finite()
                || f.interval_hours <= 0.0
                || f.interval_hours > 24.0
            {
                return Err("invalid or unordered funding events".into());
            }
            previous = f.time;
        }
        let capital = config.initial_capital;
        Ok(Self {
            config,
            start,
            end,
            expected: warmup,
            finished: false,
            indicators: Indicators::default(),
            history: VecDeque::new(),
            position: None,
            pending: None,
            setup: None,
            funding,
            funding_cursor: 0,
            cash: capital,
            peak: capital,
            max_drawdown: 0.0,
            day: u64::MAX,
            day_equity: capital,
            daily_blocked: false,
            daily_exit: false,
            cooldown_until: 0,
            loss_streak: 0,
            cooldown_streak: 0,
            longest_loss_streak: 0,
            trades: 0,
            wins: 0,
            losses: 0,
            next_id: 1,
            profit_sum: 0.0,
            loss_sum: 0.0,
            r_sum: 0.0,
            fees: 0.0,
            funding_sum: 0.0,
            rejected: 0,
            funding_events: 0,
            rows: 0,
            last: None,
            output: Chunk::default(),
        })
    }
    pub fn rows(&self) -> usize {
        self.rows
    }
    pub fn drain(&mut self) -> Chunk {
        std::mem::take(&mut self.output)
    }
    fn fee(&self) -> f64 {
        self.config.fee_bps / 10_000.0
    }
    fn slip(&self) -> f64 {
        self.config.slippage_bps / 10_000.0
    }
    fn floor(&self, price: f64) -> f64 {
        (price / self.config.tick_size + 1e-9).floor() * self.config.tick_size
    }
    fn ceil(&self, price: f64) -> f64 {
        (price / self.config.tick_size - 1e-9).ceil() * self.config.tick_size
    }
    fn fill(&self, raw: f64, buy: bool) -> Result<f64, String> {
        let price = if buy {
            self.ceil(raw * (1.0 + self.slip()))
        } else {
            self.floor(raw * (1.0 - self.slip()))
        };
        if !price.is_finite() || price <= 0.0 {
            return Err("tick size produces an invalid fill price".into());
        }
        Ok(price)
    }
    fn event(
        &mut self,
        time: u64,
        kind: &'static str,
        side: Side,
        price: f64,
        value: Option<f64>,
        id: Option<usize>,
        reason: &str,
    ) {
        self.output.events.push(Event {
            time,
            kind,
            side,
            price,
            value,
            trade_id: id,
            reason: reason.into(),
        });
    }
    fn marked(&self, position: &Option<Position>, price: f64) -> f64 {
        self.cash
            + position
                .as_ref()
                .map_or(0.0, |p| p.side.sign() * (price - p.entry) * p.quantity)
    }
    fn observe_equity(&mut self, time: u64, equity: f64, emit: bool) {
        self.peak = self.peak.max(equity);
        let drawdown = equity / self.peak - 1.0;
        self.max_drawdown = self.max_drawdown.min(drawdown);
        if emit {
            let point = Equity {
                time,
                equity,
                cash: self.cash,
                drawdown,
            };
            if self.output.equity.last().is_some_and(|p| p.time == time) {
                self.output.equity.pop();
            }
            self.output.equity.push(point);
        }
    }
    fn enter(&mut self, candidate: Candidate, bar: Bar) -> Result<Option<Position>, String> {
        let side = candidate.side;
        let entry = self.fill(bar.open, side == Side::Long)?;
        if side.sign() * (bar.open - candidate.anchor) <= 0.0 {
            self.rejected += 1;
            self.event(
                bar.time,
                "rejected",
                side,
                entry,
                None,
                None,
                "structure-invalid",
            );
            return Ok(None);
        }
        let structural = side.sign() * (entry - candidate.anchor) + self.config.tick_size;
        let distance = structural.max(candidate.atr * self.config.stop_atr);
        let reject = if distance > candidate.atr * self.config.max_stop_atr {
            "stop-distance"
        } else {
            "risk-budget"
        };
        let stop = if side == Side::Long {
            self.floor(entry - distance)
        } else {
            self.ceil(entry + distance)
        };
        let actual_distance = (entry - stop).abs();
        let stop_fill = if stop > 0.0 {
            self.fill(stop, side == Side::Short)?
        } else {
            0.0
        };
        let unit_risk = side.sign() * (entry - stop_fill) + (entry + stop_fill) * self.fee();
        let limit = (self.cash * self.config.risk_pct / unit_risk)
            .min(self.cash * self.config.max_exposure_pct / (entry * (1.0 + self.fee())));
        let quantity = (limit / self.config.quantity_step).floor() * self.config.quantity_step;
        if stop <= 0.0
            || actual_distance > candidate.atr * self.config.max_stop_atr + 1e-9
            || !quantity.is_finite()
            || quantity <= 0.0
            || quantity * entry < self.config.min_notional
        {
            self.rejected += 1;
            self.event(bar.time, "rejected", side, entry, None, None, reject);
            return Ok(None);
        }
        let fee = entry * quantity * self.fee();
        self.cash -= fee;
        self.fees += fee;
        let id = self.next_id;
        self.next_id += 1;
        let p = Position {
            id,
            side,
            time: bar.time,
            entry,
            quantity,
            initial_stop: stop,
            stop,
            distance: actual_distance,
            atr: candidate.atr,
            entry_fee: fee,
            funding: 0.0,
            mfe: 0.0,
            mae: 0.0,
            stop_reason: "initial",
        };
        self.event(
            bar.time,
            "entry",
            side,
            entry,
            Some(quantity),
            Some(id),
            &self.config.entry.clone(),
        );
        self.event(bar.time, "stop", side, stop, None, Some(id), "initial");
        Ok(Some(p))
    }
    fn close(&mut self, p: Position, raw: f64, time: u64, reason: &str) -> Result<(), String> {
        let price = self.fill(raw, p.side == Side::Short)?;
        let gross = p.side.sign() * (price - p.entry) * p.quantity;
        let exit_fee = price * p.quantity * self.fee();
        self.cash += gross - exit_fee;
        self.fees += exit_fee;
        let fees = p.entry_fee + exit_fee;
        let net = gross - fees - p.funding;
        let risk = p.distance * p.quantity;
        let r = net / risk;
        self.trades += 1;
        self.r_sum += r;
        if net > 0.0 {
            self.wins += 1;
            self.profit_sum += net;
            self.loss_streak = 0;
            self.cooldown_streak = 0;
        } else if net < 0.0 {
            self.losses += 1;
            self.loss_sum -= net;
            self.loss_streak += 1;
            self.cooldown_streak += 1;
            self.longest_loss_streak = self.longest_loss_streak.max(self.loss_streak);
        }
        self.output.trades.push(Trade {
            id: p.id,
            side: p.side,
            entry_time: p.time,
            exit_time: time,
            entry_price: p.entry,
            exit_price: price,
            quantity: p.quantity,
            initial_stop: p.initial_stop,
            risk,
            gross_pnl: gross,
            fees,
            funding: p.funding,
            net_pnl: net,
            r_multiple: r,
            mfe_r: p.mfe / p.distance,
            mae_r: p.mae / p.distance,
            reason: reason.into(),
        });
        self.event(time, "exit", p.side, price, Some(net), Some(p.id), reason);
        if self.config.cooldown_losses > 0 && self.cooldown_streak >= self.config.cooldown_losses {
            self.cooldown_until = time + self.config.cooldown_minutes * MINUTE;
            self.cooldown_streak = 0;
            self.setup = None;
            self.pending = None;
            self.event(
                time,
                "cooldown",
                p.side,
                price,
                Some(self.cooldown_until as f64),
                Some(p.id),
                "cooldown",
            );
        }
        self.observe_equity(time, self.cash, true);
        Ok(())
    }
    fn update_stop(&mut self, p: &mut Position, bar: Bar) {
        let favourable = if p.side == Side::Long {
            bar.high - p.entry
        } else {
            p.entry - bar.low
        };
        let adverse = if p.side == Side::Long {
            p.entry - bar.low
        } else {
            bar.high - p.entry
        };
        p.mfe = p.mfe.max(favourable);
        p.mae = p.mae.max(adverse);
        let mut stop = p.stop;
        let mut reason = p.stop_reason;
        if self.config.break_even_r > 0.0 && p.mfe >= self.config.break_even_r * p.distance {
            // Entry slippage is already in p.entry. Cover entry/exit fees,
            // accumulated funding, estimated exit slippage and one rounding tick.
            let cost = (p.entry_fee + p.funding) / p.quantity;
            let target = if p.side == Side::Long {
                self.ceil((p.entry + cost) / ((1.0 - self.fee()) * (1.0 - self.slip())))
                    + self.config.tick_size
            } else {
                self.floor((p.entry - cost) / ((1.0 + self.fee()) * (1.0 + self.slip())))
                    - self.config.tick_size
            };
            if p.side.sign() * (target - stop) > 0.0
                && p.side.sign() * (bar.close - target) > self.config.tick_size
            {
                stop = target;
                reason = "breakeven";
            }
        }
        if p.mfe >= self.config.trailing_start_r * p.distance {
            let target = p.entry + p.side.sign() * (p.mfe - self.config.trailing_atr * p.atr);
            let rounded = if p.side == Side::Long {
                self.floor(target)
            } else {
                self.ceil(target)
            };
            if p.side.sign() * (rounded - stop) > 0.0 {
                stop = rounded;
                reason = "trailing";
            }
        }
        if p.side.sign() * (stop - p.stop) > self.config.tick_size * 0.5 {
            p.stop = stop;
            p.stop_reason = reason;
            self.event(
                bar.time + MINUTE - 1,
                "stop",
                p.side,
                stop,
                None,
                Some(p.id),
                reason,
            );
        }
    }
    fn signal(&mut self, bar: Bar) {
        let direction = self.indicators.direction(&self.config);
        if direction == 0 {
            self.setup = None;
            return;
        }
        let side = if direction > 0 {
            Side::Long
        } else {
            Side::Short
        };
        if (side == Side::Long && self.config.direction == "short")
            || (side == Side::Short && self.config.direction == "long")
        {
            self.setup = None;
            return;
        }
        let atr = self.indicators.atr;
        let mut candidate = None;
        if self.config.entry == "breakout" {
            if self.history.len() >= self.config.breakout_bars {
                let prior = self.history.iter().rev().take(self.config.breakout_bars);
                let extreme = if side == Side::Long {
                    prior.map(|b| b.high).fold(f64::NEG_INFINITY, f64::max)
                } else {
                    prior.map(|b| b.low).fold(f64::INFINITY, f64::min)
                };
                if side.sign() * (bar.close - extreme) >= self.config.tick_size {
                    candidate = Some(Candidate {
                        side,
                        anchor: bar.close - side.sign() * atr * self.config.stop_atr,
                        atr,
                    });
                }
            }
        } else {
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
                        if setup.bars <= self.config.max_pullback_bars
                            && depth <= self.config.max_retracement
                        {
                            if setup.bars >= self.config.min_pullback_bars
                                && depth >= self.config.min_retracement
                                && side.sign() * (bar.close - setup.extreme)
                                    >= self.config.tick_size
                            {
                                candidate = Some(Candidate {
                                    side,
                                    anchor: setup.retrace,
                                    atr,
                                });
                            } else {
                                self.setup = Some(setup);
                            }
                        }
                    }
                }
            }
            if candidate.is_none()
                && self.setup.is_none()
                && self.history.len() >= self.config.impulse_bars
            {
                let start = self.history[self.history.len() - self.config.impulse_bars].close;
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
                    .skip(self.history.len() - self.config.impulse_bars + 1)
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
                if displacement >= self.config.impulse_atr * atr
                    && path > 0.0
                    && displacement / path >= self.config.min_efficiency
                {
                    self.setup = Some(Setup {
                        side,
                        start,
                        extreme,
                        retrace: extreme,
                        bars: 0,
                        pulling: false,
                    });
                    self.event(
                        bar.time + self.config.trade_minutes as u64 * MINUTE - 1,
                        "impulse",
                        side,
                        extreme,
                        Some(displacement / atr),
                        None,
                        "impulse",
                    );
                }
            }
        }
        if let Some(candidate) = candidate {
            self.event(
                bar.time + self.config.trade_minutes as u64 * MINUTE - 1,
                "signal",
                side,
                bar.close,
                Some(candidate.anchor),
                None,
                &self.config.entry.clone(),
            );
            self.pending = Some(candidate);
            self.setup = None;
        }
    }
    pub fn advance(&mut self, bar: Bar, mark: Bar) -> Result<(), String> {
        if self.finished
            || bar.time != self.expected
            || mark.time != bar.time
            || bar.time >= self.end
        {
            return Err(
                "minute input must be complete, chronological and aligned with the window".into(),
            );
        }
        if [
            bar.open, bar.high, bar.low, bar.close, mark.open, mark.high, mark.low, mark.close,
        ]
        .iter()
        .any(|p| !p.is_finite() || *p <= 0.0)
            || bar.high < bar.open.max(bar.close)
            || bar.low > bar.open.min(bar.close)
            || mark.high < mark.open.max(mark.close)
            || mark.low > mark.open.min(mark.close)
        {
            return Err("invalid traded or mark candle".into());
        }
        self.expected += MINUTE;
        self.rows += 1;
        let mut position = self.position.take();
        if bar.time >= self.start {
            let day = bar.time / DAY;
            if self.day != day {
                self.day = day;
                self.day_equity = self.marked(&position, mark.open);
                self.daily_blocked = false;
                if self.rows == 1 || self.last.is_none_or(|(b, _)| b.time < self.start) {
                    self.observe_equity(bar.time, self.day_equity, true);
                }
            }
            // Historical funding uses the opening mark for this minute and
            // applies to positions carried into it, before new orders.
            while self.funding_cursor < self.funding.len()
                && self.funding[self.funding_cursor].time < bar.time + MINUTE
            {
                let f = &self.funding[self.funding_cursor];
                if let Some(p) = &mut position {
                    let amount = p.side.sign() * p.quantity * mark.open * f.rate;
                    let time = f.time;
                    p.funding += amount;
                    self.cash -= amount;
                    self.funding_sum += amount;
                    self.funding_events += 1;
                    self.event(
                        time,
                        "funding",
                        p.side,
                        mark.open,
                        Some(amount),
                        Some(p.id),
                        "funding",
                    );
                }
                self.funding_cursor += 1;
            }
            let cutoff = self
                .config
                .flatten_minute
                .is_some_and(|m| (bar.time % DAY) / MINUTE >= m as u64);
            if cutoff || self.daily_exit {
                self.pending = None;
                self.setup = None;
                if let Some(p) = position.take() {
                    self.close(
                        p,
                        bar.open,
                        bar.time,
                        if self.daily_exit {
                            "daily-loss"
                        } else {
                            "daily-close"
                        },
                    )?;
                }
                self.daily_exit = false;
            }
            if let Some(candidate) = self.pending.take() {
                if position.is_none()
                    && !cutoff
                    && !self.daily_blocked
                    && bar.time >= self.cooldown_until
                    && self.cash > 0.0
                {
                    position = self.enter(candidate, bar)?;
                }
            }
            if let Some(mut p) = position.take() {
                let hit = if p.side == Side::Long {
                    bar.low <= p.stop
                } else {
                    bar.high >= p.stop
                };
                if hit {
                    let raw = if p.side == Side::Long {
                        bar.open.min(p.stop)
                    } else {
                        bar.open.max(p.stop)
                    };
                    p.mae = p.mae.max(p.side.sign() * (p.entry - raw));
                    let reason = p.stop_reason;
                    let time = if raw == bar.open {
                        bar.time
                    } else {
                        bar.time + MINUTE - 1
                    };
                    self.close(p, raw, time, reason)?;
                } else {
                    self.update_stop(&mut p, bar);
                    position = Some(p);
                }
            }
            let equity = self.marked(&position, mark.close);
            let close_time = bar.time + MINUTE - 1;
            self.observe_equity(close_time, equity, (bar.time + MINUTE) % (60 * MINUTE) == 0);
            if self.config.daily_loss_pct > 0.0
                && equity <= self.day_equity * (1.0 - self.config.daily_loss_pct)
            {
                self.daily_blocked = true;
                self.daily_exit = position.is_some();
                self.pending = None;
                self.setup = None;
            }
        }
        self.position = position;
        let closed = self.indicators.close(bar, &self.config);
        if closed.trend && bar.time >= self.start {
            self.output.indicators.push(Indicator {
                time: bar.time + MINUTE - 1,
                fast: self.indicators.fast,
                slow: self.indicators.slow,
            });
        }
        let cutoff = self
            .config
            .flatten_minute
            .is_some_and(|m| (bar.time % DAY) / MINUTE >= m as u64);
        if self.position.is_some() || cutoff || self.daily_blocked {
            self.setup = None;
        }
        if let Some(candle) = closed.trade {
            if candle.time >= self.start
                && self.position.is_none()
                && !cutoff
                && !self.daily_blocked
                && bar.time + MINUTE >= self.cooldown_until
                && self.cash > 0.0
            {
                self.signal(candle);
            }
            self.history.push_back(candle);
            let capacity = self.config.breakout_bars.max(self.config.impulse_bars) + 1;
            if self.history.len() > capacity {
                self.history.pop_front();
            }
        }
        self.last = Some((bar, mark));
        Ok(())
    }
    pub fn finish(&mut self) -> Result<Metrics, String> {
        if self.finished || self.expected != self.end || self.funding_cursor != self.funding.len() {
            return Err("backtest window or funding history is incomplete".into());
        }
        let (last, _) = self.last.ok_or("empty minute backtest")?;
        self.pending = None;
        if let Some(p) = self.position.take() {
            self.close(p, last.close, self.end - 1, "end-range")?;
        }
        self.observe_equity(self.end - 1, self.cash, true);
        self.finished = true;
        Ok(Metrics {
            final_equity: self.cash,
            total_return: self.cash / self.config.initial_capital - 1.0,
            max_drawdown: self.max_drawdown,
            trades: self.trades,
            wins: self.wins,
            losses: self.losses,
            win_rate: (self.trades > 0).then(|| self.wins as f64 / self.trades as f64),
            profit_factor: (self.loss_sum > 0.0).then(|| self.profit_sum / self.loss_sum),
            mean_r: (self.trades > 0).then(|| self.r_sum / self.trades as f64),
            fees: self.fees,
            funding: self.funding_sum,
            longest_loss_streak: self.longest_loss_streak,
            rejected_signals: self.rejected,
            funding_events: self.funding_events,
            rows: self.rows,
        })
    }
}
