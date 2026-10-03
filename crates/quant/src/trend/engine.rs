use super::background::Background;
use super::config::{Config, CostPolicy};
use super::evaluation::Evaluator;
use super::indicators::Indicators;
use super::management::ChannelExit;
use super::model::*;
use super::position::{update_protection, Position};
use super::risk::RiskState;
use super::signals::{Candidate, Signals};

/// Minute event ordering: carried-position funding, prior-close orders, old
/// stops, close-only indicators/signals, then stop changes for the next minute.
pub struct Engine {
    config: Config,
    cost_policy: CostPolicy,
    start: u64,
    end: u64,
    expected: u64,
    finished: bool,
    indicators: Indicators,
    signals: Signals,
    background: Background,
    context_metrics: ContextMetrics,
    position: Option<Position>,
    pending: Option<Candidate>,
    pending_exit: bool,
    channel_exit: ChannelExit,
    evaluation: Evaluator,
    funding: Vec<Funding>,
    funding_cursor: usize,
    cash: f64,
    peak: f64,
    max_drawdown: f64,
    loss_streak: usize,
    risk: RiskState,
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
        let cost_policy = config.cost_policy()?;
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
        let capital = config.execution.initial_capital;
        Ok(Self {
            config,
            cost_policy,
            start,
            end,
            expected: warmup,
            finished: false,
            indicators: Indicators::default(),
            signals: Signals::default(),
            background: Background::default(),
            context_metrics: ContextMetrics::default(),
            position: None,
            pending: None,
            pending_exit: false,
            channel_exit: ChannelExit::default(),
            evaluation: Evaluator::default(),
            funding,
            funding_cursor: 0,
            cash: capital,
            peak: capital,
            max_drawdown: 0.0,
            loss_streak: 0,
            risk: RiskState::default(),
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
            entry_signal: None,
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
        let entry = self.config.execution.fill(bar.open, side == Side::Long)?;
        if candidate
            .anchor
            .is_some_and(|anchor| side.sign() * (bar.open - anchor) <= 0.0)
        {
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
        let distance = candidate.atr * self.config.strategy.stop_atr;
        let stop = if side == Side::Long {
            self.config.execution.floor(entry - distance)
        } else {
            self.config.execution.ceil(entry + distance)
        };
        let actual_distance = (entry - stop).abs();
        let stop_fill = if stop > 0.0 {
            self.config.execution.fill(stop, side == Side::Short)?
        } else {
            0.0
        };
        let unit_risk =
            side.sign() * (entry - stop_fill) + (entry + stop_fill) * self.config.execution.fee();
        let limit = (self.cash * self.config.risk.risk_pct / unit_risk).min(
            self.cash * self.config.risk.max_exposure_pct
                / (entry * (1.0 + self.config.execution.fee())),
        );
        let quantity = (limit / self.config.execution.quantity_step).floor()
            * self.config.execution.quantity_step;
        if stop <= 0.0
            || !quantity.is_finite()
            || quantity <= 0.0
            || quantity * entry < self.config.execution.min_notional
        {
            self.rejected += 1;
            self.event(bar.time, "rejected", side, entry, None, None, "risk-budget");
            return Ok(None);
        }
        let fee = entry * quantity * self.config.execution.fee();
        self.cash -= fee;
        self.evaluation.entry(entry * quantity);
        self.fees += fee;
        let id = self.next_id;
        self.next_id += 1;
        let p = Position {
            id,
            side,
            time: bar.time,
            entry,
            entry_signal: candidate.entry_signal,
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
            &self.config.strategy.entry.clone(),
        );
        self.event(bar.time, "stop", side, stop, None, Some(id), "initial");
        Ok(Some(p))
    }
    fn close(&mut self, p: Position, raw: f64, time: u64, reason: &str) -> Result<(), String> {
        let price = self.config.execution.fill(raw, p.side == Side::Short)?;
        let gross = p.side.sign() * (price - p.entry) * p.quantity;
        let exit_fee = price * p.quantity * self.config.execution.fee();
        self.cash += gross - exit_fee;
        self.fees += exit_fee;
        let fees = p.entry_fee + exit_fee;
        let net = gross - fees - p.funding;
        let risk = p.distance * p.quantity;
        let r = net / risk;
        self.trades += 1;
        self.pending_exit = false;
        self.r_sum += r;
        if net > 0.0 {
            self.wins += 1;
            self.profit_sum += net;
            self.loss_streak = 0;
        } else if net < 0.0 {
            self.losses += 1;
            self.loss_sum -= net;
            self.loss_streak += 1;
            self.longest_loss_streak = self.longest_loss_streak.max(self.loss_streak);
        } else {
            self.loss_streak = 0;
        }
        let trade = Trade {
            id: p.id,
            side: p.side,
            entry_time: p.time,
            exit_time: time,
            entry_price: p.entry,
            entry_signal: p.entry_signal,
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
        };
        self.evaluation.trade(&trade);
        self.output.trades.push(trade);
        self.event(time, "exit", p.side, price, Some(net), Some(p.id), reason);
        if let Some(until) = self.risk.record_trade(net, time, &self.config.risk) {
            self.signals.reset();
            self.pending = None;
            self.event(
                time,
                "cooldown",
                p.side,
                price,
                Some(until as f64),
                Some(p.id),
                "cooldown",
            );
        }
        self.observe_equity(time, self.cash, true);
        Ok(())
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
        let mut exposed = position.is_some();
        if bar.time >= self.start {
            let opening_equity = self.marked(&position, mark.open);
            if self.risk.begin_day(bar.time, opening_equity)
                && (self.rows == 1 || self.last.is_none_or(|(b, _)| b.time < self.start))
            {
                self.observe_equity(bar.time, self.risk.day_equity, true);
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
                .risk
                .flatten_minute
                .is_some_and(|m| (bar.time % DAY) / MINUTE >= m as u64);
            if cutoff || self.risk.daily_exit {
                self.pending = None;
                self.signals.reset();
                if let Some(p) = position.take() {
                    self.close(
                        p,
                        bar.open,
                        bar.time,
                        if self.risk.daily_exit {
                            "daily-loss"
                        } else {
                            "daily-close"
                        },
                    )?;
                }
                self.risk.daily_exit = false;
            }
            if self.pending_exit {
                self.pending_exit = false;
                self.pending = None;
                if let Some(p) = position.take() {
                    // A known channel-close exit is a market order. A worse
                    // opening gap therefore still fills at that opening price.
                    self.close(p, bar.open, bar.time, "channel-exit")?;
                }
            }
            if let Some(candidate) = self.pending.take() {
                if position.is_none()
                    && !cutoff
                    && !self.risk.daily_blocked
                    && bar.time >= self.risk.cooldown_until
                    && self.cash > 0.0
                {
                    position = self.enter(candidate, bar)?;
                    exposed |= position.is_some();
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
                    if let Some(reason) = update_protection(
                        &mut p,
                        bar,
                        &self.config.strategy,
                        &self.config.execution,
                    ) {
                        self.event(
                            bar.time + MINUTE - 1,
                            "stop",
                            p.side,
                            p.stop,
                            None,
                            Some(p.id),
                            reason,
                        );
                    }
                    position = Some(p);
                }
            }
            let equity = self.marked(&position, mark.close);
            let close_time = bar.time + MINUTE - 1;
            self.evaluation.minute(close_time, equity, exposed);
            self.observe_equity(close_time, equity, (bar.time + MINUTE) % (60 * MINUTE) == 0);
            self.risk
                .observe(equity, position.is_some(), &self.config.risk);
            if self.risk.daily_blocked {
                self.pending = None;
                self.signals.reset();
            }
        }
        self.position = position;
        if self.config.strategy.filter == "background" {
            // Update even while holding a position, but gate only new entries.
            self.background
                .close(bar, self.config.strategy.trade_minutes);
        }
        let closed = self.indicators.close(bar, &self.config.strategy);
        if closed.ema_updated && bar.time >= self.start {
            self.output.indicators.push(Indicator {
                time: bar.time + MINUTE - 1,
                fast: self.indicators.fast,
                slow: self.indicators.slow,
            });
        }
        let cutoff = self
            .config
            .risk
            .flatten_minute
            .is_some_and(|m| (bar.time % DAY) / MINUTE >= m as u64);
        if self.position.is_some() || cutoff || self.risk.daily_blocked {
            self.signals.reset();
        }
        if let Some(candle) = closed.trade {
            if self.config.strategy.management == "channel" {
                self.pending_exit = self.channel_exit.close(
                    candle,
                    self.position.as_ref().map(|p| p.side),
                    self.config.strategy.breakout_bars,
                );
            }
            let enabled = candle.time >= self.start
                && self.position.is_none()
                && !cutoff
                && !self.risk.daily_blocked
                && bar.time + MINUTE >= self.risk.cooldown_until
                && self.cash > 0.0;
            if let Some(mut candidate) = self.signals.close(
                candle,
                &self.indicators,
                &self.config,
                enabled,
                &mut self.output.events,
            ) {
                let allowed = if self.config.strategy.filter == "background" {
                    let mut decision = self.background.decide(
                        bar.time + MINUTE - 1,
                        candle.close,
                        candidate.side,
                        candidate.atr,
                        &self.config.execution,
                        self.config.strategy.trade_minutes,
                    );
                    // Preserve v4's bundled context-cost decision and diagnostics.
                    // New configurations keep this entry policy separate from trend state.
                    if decision.allowed && self.cost_policy.rejects_background(decision.cost_atr) {
                        decision.allowed = false;
                        decision.reason = "context-cost";
                    }
                    self.context_metrics.observe(&decision);
                    if decision.allowed {
                        // Freeze the known structural boundary for next-open
                        // execution too. A gap cannot silently bypass the gate.
                        candidate.anchor = match (candidate.anchor, decision.anchor) {
                            (Some(a), Some(b)) => Some(if candidate.side == Side::Long {
                                a.max(b)
                            } else {
                                a.min(b)
                            }),
                            (a, b) => a.or(b),
                        };
                    }
                    if !decision.allowed {
                        self.rejected += 1;
                        self.event(
                            decision.time,
                            "rejected",
                            candidate.side,
                            candle.close,
                            decision.cost_atr,
                            None,
                            decision.reason,
                        );
                    }
                    let allowed = decision.allowed;
                    self.output.contexts.push(decision);
                    allowed
                } else {
                    true
                };
                if allowed {
                    let cost_atr = self
                        .config
                        .execution
                        .round_trip_cost_atr(candle.close, candidate.atr);
                    if self.cost_policy.rejects_entry(cost_atr) {
                        self.rejected += 1;
                        self.event(
                            bar.time + MINUTE - 1,
                            "rejected",
                            candidate.side,
                            candle.close,
                            cost_atr,
                            None,
                            "entry-cost",
                        );
                    } else {
                        self.pending = Some(candidate);
                    }
                }
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
        self.evaluation.point(self.end - 1, self.cash);
        self.finished = true;
        Ok(Metrics {
            evaluation: self.evaluation.finish(
                self.config.execution.initial_capital,
                self.start,
                self.end,
                self.cash,
                self.max_drawdown,
            ),
            final_equity: self.cash,
            total_return: self.cash / self.config.execution.initial_capital - 1.0,
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
            context: self.context_metrics.clone(),
        })
    }
}
