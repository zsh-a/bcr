use super::background::Background;
use super::config::{Config, CostPolicy};
use super::evaluation::Evaluator;
use super::indicators::Indicators;
use super::management::{
    chandelier_decision, protection_decision, staged_decision, ChannelExit, StopUpdate,
};
use super::model::*;
use super::position::{Position, Stages};
use super::risk::RiskState;
use super::signals::{Candidate, Signals};

/// Minute event ordering: carried-position funding, prior-close orders, old
/// stops, minute-close protection/risk, then completed trading-candle signals.
/// New protection and close-triggered exits cannot execute before the next open.
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
    pending_exit: Option<ExitIntent>,
    channel_exit: ChannelExit,
    evaluation: Evaluator,
    funding: Vec<Funding>,
    funding_cursor: usize,
    cash: f64,
    risk: RiskState,
    next_id: usize,
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
        Self::with_window_limit(config, funding, start, end, warmup, 730)
    }

    /// Offline research can retain positions and account state across longer
    /// continuous histories. This entry point is unavailable in browser WASM.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn new_research(
        config: Config,
        funding: Vec<Funding>,
        start: u64,
        end: u64,
        warmup: u64,
    ) -> Result<Self, String> {
        Self::with_window_limit(config, funding, start, end, warmup, 1096)
    }

    fn with_window_limit(
        config: Config,
        funding: Vec<Funding>,
        start: u64,
        end: u64,
        warmup: u64,
        maximum_days: u64,
    ) -> Result<Self, String> {
        let cost_policy = config.cost_policy()?;
        if start % MINUTE != 0
            || end % MINUTE != 0
            || warmup % MINUTE != 0
            || warmup > start
            || start >= end
            || end - start > maximum_days * DAY
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
            pending_exit: None,
            channel_exit: ChannelExit::default(),
            evaluation: Evaluator::new(capital, start),
            funding,
            funding_cursor: 0,
            cash: capital,
            risk: RiskState::default(),
            next_id: 1,
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
        let drawdown = self.evaluation.observe(time, equity);
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
    fn request_exit(&mut self, intent: ExitIntent) {
        // Risk exits outrank confirmed protection crossings, then channel exits.
        if self
            .pending_exit
            .is_none_or(|old| intent.reason.priority() > old.reason.priority())
        {
            self.pending_exit = Some(intent);
        }
    }
    fn execute_exit(&mut self, position: &mut Option<Position>, bar: Bar) -> Result<(), String> {
        let Some(intent) = self.pending_exit else {
            return Ok(());
        };
        if bar.time < intent.execute_at {
            return Ok(());
        }
        self.pending_exit = None;
        // An intent can never close a replacement position, even if consumed late.
        if position.as_ref().is_none_or(|p| p.id != intent.position_id) {
            return Ok(());
        }
        self.pending = None;
        if intent.reason != ExitReason::Channel {
            self.signals.reset();
        }
        let p = position.take().expect("matched position");
        self.close(p, bar.open, bar.time, intent.reason.label())
    }
    fn commit_protection(
        &mut self,
        position: &mut Position,
        close: MinuteClose,
        update: StopUpdate,
    ) {
        position.stop = update.price;
        position.stop_reason = update.reason;
        self.event(
            close.time(),
            "stop",
            position.side,
            position.stop,
            None,
            Some(position.id),
            update.reason,
        );
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
        let quantity = self.config.execution.floor_quantity(limit);
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
            initial_distance: actual_distance,
            signal_atr: candidate.atr,
            entry_fee: fee,
            entry_slippage_and_rounding: side.sign() * (entry - bar.open) * quantity,
            funding: 0.0,
            mfe: 0.0,
            mae: 0.0,
            stop_reason: "initial",
            stages: Stages::default(),
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
        let fees = p.entry_fee + exit_fee;
        let net = gross - fees - p.funding;
        let risk = p.initial_distance * p.quantity;
        let r = net / risk;
        self.pending_exit = None;
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
            slippage_and_rounding: p.entry_slippage_and_rounding
                + p.side.sign() * (raw - price) * p.quantity,
            net_pnl: net,
            r_multiple: r,
            mfe_r: p.mfe / p.initial_distance,
            mae_r: p.mae / p.initial_distance,
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
        if bar.time == self.start {
            self.signals.begin_replay(self.start);
        }
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
            let cutoff = RiskState::at_cutoff(bar.time, &self.config.risk);
            if cutoff {
                self.pending = None;
                self.signals.reset();
            }
            if let Some(p) = &position {
                if let Some(intent) = RiskState::opening_exit(bar.time, p.id, &self.config.risk) {
                    self.request_exit(intent);
                }
            }
            self.execute_exit(&mut position, bar)?;
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
                    p.observe_stop(raw);
                    let reason = p.stop_reason;
                    let time = if raw == bar.open {
                        bar.time
                    } else {
                        bar.time + MINUTE - 1
                    };
                    self.close(p, raw, time, reason)?;
                } else {
                    let close = MinuteClose(bar);
                    p.observe_minute(close);
                    if let Some(update) = protection_decision(
                        &p,
                        close,
                        &self.config.strategy,
                        &self.config.execution,
                    ) {
                        self.commit_protection(&mut p, close, update);
                    }
                    position = Some(p);
                }
            }
            let equity = self.marked(&position, mark.close);
            let close_time = bar.time + MINUTE - 1;
            self.evaluation.minute(exposed);
            self.observe_equity(close_time, equity, (bar.time + MINUTE) % (60 * MINUTE) == 0);
            if let Some(intent) = self.risk.observe(
                MinuteClose(bar),
                equity,
                position.as_ref().map(|p| p.id),
                &self.config.risk,
            ) {
                self.request_exit(intent);
            }
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
        self.signals.observe_minute(bar, &self.config.strategy);
        let closed = self.indicators.close(bar, &self.config.strategy);
        if (closed.ema_updated || closed.kdj_updated) && bar.time >= self.start {
            self.output.indicators.push(Indicator {
                time: bar.time + MINUTE - 1,
                fast: (closed.ema_updated && self.config.strategy.filter == "ema")
                    .then_some(self.indicators.fast),
                slow: closed.ema_updated.then_some(self.indicators.slow),
                k: closed.kdj_updated.then(|| self.indicators.kdj.unwrap().k),
                d: closed.kdj_updated.then(|| self.indicators.kdj.unwrap().d),
                j: closed.kdj_updated.then(|| self.indicators.kdj.unwrap().j),
            });
        }
        let cutoff = RiskState::at_cutoff(bar.time, &self.config.risk);
        if self.position.is_some() || cutoff || self.risk.daily_blocked {
            self.signals.reset();
        }
        if let Some(close) = closed.trade {
            let candle = close.bar;
            if matches!(
                self.config.strategy.management.as_str(),
                "staged" | "chandelier"
            ) {
                if let Some(mut position) = self.position.take() {
                    let decide = if self.config.strategy.management == "chandelier" {
                        chandelier_decision
                    } else {
                        staged_decision
                    };
                    let decision = decide(
                        &position,
                        close,
                        &self.config.strategy,
                        &self.config.execution,
                    );
                    for (was_active, active, reason) in [
                        (
                            position.stages.break_even,
                            decision.stages.break_even,
                            "breakeven-armed",
                        ),
                        (
                            position.stages.trailing,
                            decision.stages.trailing,
                            "trailing-armed",
                        ),
                    ] {
                        if !was_active && active {
                            self.event(
                                close.time,
                                "stage",
                                position.side,
                                candle.close,
                                Some(decision.close_r),
                                Some(position.id),
                                reason,
                            );
                        }
                    }
                    position.stages = decision.stages;
                    if let Some(update) = decision.stop {
                        self.commit_protection(&mut position, MinuteClose(bar), update);
                    }
                    if let Some(intent) = decision.exit {
                        self.request_exit(intent);
                    }
                    self.position = Some(position);
                }
            }
            if self.config.strategy.management == "channel" {
                if let Some(intent) = self.channel_exit.close(
                    close,
                    self.position.as_ref().map(|p| (p.id, p.side)),
                    self.config.strategy.channel_exit_bars(),
                ) {
                    self.request_exit(intent);
                }
            }
            let enabled = candle.time >= self.start
                && self.position.is_none()
                && !cutoff
                && !self.risk.daily_blocked
                && bar.time + MINUTE >= self.risk.cooldown_until
                && self.cash > 0.0;
            // KDJ arms only inside the currently allowed trend. Legacy entry
            // filters retain their candidate-only diagnostics and behaviour.
            let background_directions = if matches!(
                self.config.strategy.entry.as_str(),
                "kdj" | "price-action" | "structured-pullback"
            ) && self.config.strategy.filter == "background"
            {
                [Side::Long, Side::Short].map(|side| {
                    self.background
                        .decide(
                            close.time,
                            candle.close,
                            side,
                            close.atr,
                            &self.config.execution,
                            self.config.strategy.trade_minutes,
                        )
                        .allowed
                })
            } else {
                [true, true]
            };
            if let Some(mut candidate) = self.signals.close(
                close,
                &self.indicators,
                &self.config,
                enabled,
                &mut self.output.events,
                background_directions,
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
        let evaluation = self.evaluation.finish(self.end, self.cash);
        self.finished = true;
        let statistics = self.evaluation.statistics();
        Ok(Metrics {
            evaluation,
            final_equity: self.cash,
            total_return: self.cash / self.config.execution.initial_capital - 1.0,
            max_drawdown: self.evaluation.max_drawdown(),
            trades: statistics.trades,
            wins: statistics.wins,
            losses: statistics.losses,
            win_rate: statistics.win_rate,
            profit_factor: statistics.profit_factor,
            mean_r: statistics.mean_r,
            fees: statistics.fees,
            funding: statistics.funding,
            longest_loss_streak: statistics.longest_loss_streak,
            rejected_signals: self.rejected,
            funding_events: self.funding_events,
            rows: self.rows,
            context: self.context_metrics.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const START: u64 = 1_704_067_200_000;

    #[test]
    fn browser_constructor_retains_730_day_limit() {
        for days in [730, 731, 760, 1096, 1097] {
            let result = Engine::new(Config::default(), vec![], START, START + days * DAY, START);
            assert_eq!(result.is_ok(), days == 730, "{days} day browser window");
        }
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn offline_constructor_supports_continuous_histories_up_to_1096_days() {
        for days in [730, 731, 760, 1096, 1097] {
            let result =
                Engine::new_research(Config::default(), vec![], START, START + days * DAY, START);
            assert_eq!(result.is_ok(), days <= 1096, "{days} day research window");
        }
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn offline_constructor_preserves_warmup_funding_and_completeness_checks() {
        let end = START + 760 * DAY;
        assert!(Engine::new_research(
            Config::default(),
            vec![],
            START,
            end,
            START - (MAX_WARMUP_DAYS + 1) * DAY,
        )
        .is_err());
        assert!(Engine::new_research(
            Config::default(),
            vec![Funding {
                time: end,
                rate: 0.0001,
                interval_hours: 8.0,
            }],
            START,
            end,
            START,
        )
        .is_err());
        let mut incomplete =
            Engine::new_research(Config::default(), vec![], START, end, START).unwrap();
        assert_eq!(
            incomplete.finish().err().as_deref(),
            Some("backtest window or funding history is incomplete")
        );
    }

    fn opened() -> (Engine, Option<Position>, Bar) {
        let mut engine =
            Engine::new(Config::default(), vec![], START, START + 3 * MINUTE, START).unwrap();
        let bar = Bar {
            time: START,
            open: 100.0,
            high: 101.0,
            low: 99.0,
            close: 100.0,
            volume: 1.0,
        };
        let position = engine
            .enter(
                Candidate {
                    side: Side::Long,
                    anchor: None,
                    atr: 2.0,
                    entry_signal: EntrySignal {
                        time: START - 1,
                        price: 100.0,
                        boundary: Some(99.0),
                        atr: 2.0,
                        lookback_bars: Some(20),
                        trigger: None,
                    },
                },
                bar,
            )
            .unwrap();
        (engine, position, bar)
    }

    #[test]
    fn market_exit_priority_is_explicit_and_cannot_execute_before_its_due_open() {
        for order in [
            [
                ExitReason::Channel,
                ExitReason::DailyClose,
                ExitReason::DailyLoss,
            ],
            [
                ExitReason::DailyLoss,
                ExitReason::Channel,
                ExitReason::DailyClose,
            ],
        ] {
            let (mut engine, mut position, mut bar) = opened();
            for reason in order {
                engine.request_exit(ExitIntent {
                    position_id: position.as_ref().unwrap().id,
                    triggered_at: START + MINUTE - 1,
                    execute_at: START + MINUTE,
                    reason,
                });
            }
            assert_eq!(engine.pending_exit.unwrap().reason, ExitReason::DailyLoss);
            engine.execute_exit(&mut position, bar).unwrap();
            assert!(position.is_some());
            assert!(engine.output.trades.is_empty());
            bar.time += MINUTE;
            bar.open = 90.0;
            engine.execute_exit(&mut position, bar).unwrap();
            assert!(position.is_none());
            assert!(engine.pending_exit.is_none());
            assert_eq!(engine.output.trades[0].reason, "daily-loss");
            assert_eq!(engine.output.trades[0].exit_time, bar.time);
            assert_eq!(
                engine.output.trades[0].exit_price,
                engine.config.execution.fill(bar.open, false).unwrap()
            );
            engine.execute_exit(&mut position, bar).unwrap();
            assert_eq!(engine.output.trades.len(), 1);
        }
    }

    #[test]
    fn stale_exit_cannot_close_a_different_position() {
        let (mut engine, mut position, bar) = opened();
        let id = position.as_ref().unwrap().id;
        engine.request_exit(ExitIntent {
            position_id: id + 1,
            triggered_at: START - 1,
            execute_at: START,
            reason: ExitReason::Channel,
        });
        engine.execute_exit(&mut position, bar).unwrap();
        assert_eq!(position.unwrap().id, id);
        assert!(engine.pending_exit.is_none());
        assert!(engine.output.trades.is_empty());
    }
}
