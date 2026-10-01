use crate::model::*;
use crate::research::{Account, Candidate, Diagnostics, LedgerRow, ResearchDay};
use std::collections::{BTreeSet, VecDeque};

#[derive(Clone, Default)]
struct Position {
    quantity: u64,
    today: u64,
    cost: f64,
    mark: f64,
    peak: f64,
}
#[derive(Clone)]
struct Pending {
    id: usize,
    buy: bool,
    quantity: u64,
    signal_date: u32,
    reason: &'static str,
}

/// Single deterministic portfolio state; one complete trading day is the atomic input unit.
pub struct Engine {
    pub manifest: Manifest,
    pub config: Config,
    histories: Vec<VecDeque<f64>>,
    positions: Vec<Position>,
    cash: f64,
    pending: Vec<Pending>,
    previous_limit_up: BTreeSet<usize>,
    next_session: usize,
    risk_peak: f64,
    equity_peak: f64,
    drawdown_triggered: bool,
    daily_loss_triggered: bool,
    risk_pending: Vec<Option<&'static str>>,
    risk_exited: BTreeSet<usize>,
    equity: Vec<Equity>,
    orders: Vec<Order>,
    decisions: Vec<Decision>,
    missing_marks: usize,
    audit_enabled: bool,
    audit: Option<AuditDay>,
    entitlements: Vec<u64>,
    receivables: f64,
    volume_used: Vec<u64>,
    streamed: bool,
    total_days: usize,
    return_mean: f64,
    return_m2: f64,
    last_equity: f64,
    worst_drawdown: f64,
    total_filled: usize,
    total_rejected: usize,
    total_fees: f64,
    research_enabled: bool,
    accounts: Vec<Account>,
    research: Vec<ResearchDay>,
    diagnostics: Diagnostics,
    research_cells: usize,
}
impl Engine {
    pub(crate) fn new_shared(manifest: Manifest, config: Config) -> Result<Self, String> {
        let mut engine = Self::new(manifest, config)?;
        engine.histories = Vec::new();
        engine.research_enabled = false;
        engine.accounts = Vec::new();
        engine.enable_streaming();
        Ok(engine)
    }
    pub fn new(mut manifest: Manifest, config: Config) -> Result<Self, String> {
        manifest.validate()?;
        manifest.display_names = None;
        config.validate()?;
        if let Some(w) = &config.research_window {
            if w.start < manifest.start_date
                || w.end > manifest.end_date
                || !manifest.calendar.iter().any(|d| d.date == w.start)
                || !manifest.calendar.iter().any(|d| d.date == w.end)
            {
                return Err("research window must use covered trading sessions".into());
            }
        }
        let count = manifest.instruments.len();
        let capital = config.initial_capital;
        if config.execution_model == "jsg-raw-v2" {
            let q = manifest
                .data_quality
                .as_ref()
                .ok_or("raw v2 requires v2 execution data")?;
            if manifest.version != 2
                || q.corporate_actions != "complete"
                || q.price_limits != "daily"
                || config.fees.is_empty()
                || config.fees[0].from > manifest.start_date
            {
                return Err(
                    "raw v2 requires complete corporate actions, daily limits and dated fees"
                        .into(),
                );
            }
        }
        let actions = manifest.corporate_actions.len();
        Ok(Self {
            manifest,
            config,
            histories: vec![VecDeque::with_capacity(20); count],
            positions: vec![Position::default(); count],
            cash: capital,
            pending: vec![],
            previous_limit_up: BTreeSet::new(),
            next_session: 0,
            risk_peak: capital,
            equity_peak: capital,
            drawdown_triggered: false,
            daily_loss_triggered: false,
            risk_pending: vec![None; count],
            risk_exited: BTreeSet::new(),
            equity: vec![],
            orders: vec![],
            decisions: vec![],
            missing_marks: 0,
            audit_enabled: false,
            audit: None,
            entitlements: vec![0; actions],
            receivables: 0.0,
            volume_used: vec![0; count],
            streamed: false,
            total_days: 0,
            return_mean: 0.0,
            return_m2: 0.0,
            last_equity: capital,
            worst_drawdown: 0.0,
            total_filled: 0,
            total_rejected: 0,
            total_fees: 0.0,
            research_enabled: true,
            accounts: vec![Account::default(); count],
            research: vec![],
            research_cells: 0,
            diagnostics: Diagnostics {
                version: 1,
                ..Diagnostics::default()
            },
        })
    }
    pub fn enable_streaming(&mut self) {
        self.streamed = true;
    }
    pub fn drain_output(&mut self) -> OutputChunk {
        self.research_cells = 0;
        OutputChunk {
            research: std::mem::take(&mut self.research),
            equity: std::mem::take(&mut self.equity),
            orders: std::mem::take(&mut self.orders),
            decisions: std::mem::take(&mut self.decisions),
        }
    }
    pub fn enable_audit(&mut self) {
        self.audit_enabled = true;
    }
    pub fn take_audit(&mut self) -> Option<AuditDay> {
        self.audit.take()
    }
    pub fn processed_days(&self) -> usize {
        self.next_session
    }
    pub fn day(&mut self, bars: Vec<Bar>) -> Result<(), String> {
        self.day_with_features(bars, None)
    }
    pub(crate) fn day_with_features(
        &mut self,
        bars: Vec<Bar>,
        features: Option<&crate::features::PreparedDay>,
    ) -> Result<(), String> {
        let session = self
            .manifest
            .calendar
            .get(self.next_session)
            .ok_or("more batches than calendar sessions")?
            .clone();
        if features.is_some_and(|f| f.date != session.date) {
            return Err("prepared feature date mismatch".into());
        }
        if features.is_none() && self.histories.len() != self.positions.len() {
            return Err("shared-feature engine requires prepared features".into());
        }
        if features.is_some() {
            self.histories.clear();
        }
        let mut book = vec![None; self.positions.len()];
        let mut last_id = None;
        let raw_model = self.raw_model();
        for bar in bars {
            if raw_model
                && (bar.volume.is_none() || bar.limit_up.is_none() || bar.limit_down.is_none())
            {
                return Err("raw v2 requires volume/limit_up/limit_down columns".into());
            }
            for limit in [bar.limit_up, bar.limit_down].into_iter().flatten() {
                if !limit.is_finite() || !(0.0..=1e12).contains(&limit) {
                    return Err("invalid explicit price limit".into());
                }
            }
            if let (Some(up), Some(down)) = (bar.limit_up, bar.limit_down) {
                if (up == 0.0) != (down == 0.0) || (up > 0.0 && down >= up) {
                    return Err("invalid daily price limit interval".into());
                }
            }
            if bar.date != session.date
                || bar.id >= book.len()
                || bar.industry >= self.manifest.industries.len()
                || last_id.is_some_and(|id| id >= bar.id)
            {
                return Err(
                    "daily rows must match calendar and be sorted by unique instrument id".into(),
                );
            }
            for price in [
                bar.open,
                bar.high,
                bar.low,
                bar.close,
                bar.preclose,
                bar.adjfactor,
            ] {
                if !price.is_finite() || price <= 0.0 || price > 1e12 {
                    return Err("invalid price or adjustment factor".into());
                }
            }
            if !bar.profit.is_finite()
                || !bar.shares.is_finite()
                || bar.shares < 0.0
                || bar.low > bar.open.min(bar.close)
                || bar.high < bar.open.max(bar.close)
                || bar.close * bar.adjfactor > 1e15
                || bar.shares > 1e15
            {
                return Err("invalid OHLC/financial features".into());
            }
            last_id = Some(bar.id);
            let id = bar.id;
            book[id] = Some(bar);
        }
        if book.iter().all(Option::is_none) {
            return Err("empty trading day".into());
        }
        let start = self
            .config
            .research_window
            .as_ref()
            .map_or(self.manifest.start_date, |w| w.start);
        let end = self
            .config
            .research_window
            .as_ref()
            .map_or(self.manifest.end_date, |w| w.end);
        // Validate the complete frozen input, but never mark or trade using data beyond a window.
        if session.date > end {
            self.next_session += 1;
            return Ok(());
        }
        for position in &mut self.positions {
            position.today = 0;
        }
        self.volume_used.fill(0);
        if raw_model {
            self.apply_actions(session.date)?;
        }
        let first_order = self.orders.len();
        let first_decision = self.decisions.len();
        let trading = session.date >= start;
        if trading {
            self.risk_exited.clear();
            // Sales release cash before purchases; a rejected next-open order expires that day.
            let mut pending = std::mem::take(&mut self.pending);
            pending.sort_by_key(|order| order.buy);
            for order in pending {
                self.fill(order, session.date, &book, true)?;
            }
        }
        let mut limit_up = BTreeSet::new();
        for (id, bar) in book.iter().enumerate() {
            if let Some(bar) = bar {
                let adjusted = bar.close * bar.adjfactor;
                let mark = if raw_model { bar.close } else { adjusted };
                self.positions[id].mark = mark;
                if self.research_enabled {
                    self.accounts[id].industry = bar.industry;
                    self.accounts[id].mark_date = session.date;
                }
                if features.is_none() {
                    let history = &mut self.histories[id];
                    if history.len() == 20 {
                        history.pop_front();
                    }
                    history.push_back(adjusted);
                }
                if self.at_limit(bar, bar.close, true) {
                    limit_up.insert(id);
                }
            } else if trading && self.positions[id].quantity > 0 {
                self.missing_marks += 1;
            }
        }
        if trading {
            let opening_equity = self.account_equity();
            let broken: Vec<usize> = self
                .previous_limit_up
                .difference(&limit_up)
                .copied()
                .filter(|id| book[*id].is_some() && self.positions[*id].quantity > 0)
                .collect();
            for id in broken {
                self.close_position(id, session.date, "limit-up-opened", &book)?;
            }
            let stopped = self.risk(session.date, &book)?;
            if session.rebalance {
                if self.drawdown_triggered && !stopped {
                    self.drawdown_triggered = false;
                    self.risk_peak = self.account_equity();
                }
                if !stopped {
                    self.rebalance(
                        session.date,
                        if raw_model {
                            self.account_equity()
                        } else {
                            opening_equity
                        },
                        &book,
                        features,
                    )?;
                }
            }
            let equity = self.account_equity();
            if !equity.is_finite() || equity <= 0.0 {
                return Err("non-finite or depleted portfolio".into());
            }
            self.equity_peak = self.equity_peak.max(equity);
            let daily_return = equity / self.last_equity - 1.0;
            self.total_days += 1;
            let delta = daily_return - self.return_mean;
            self.return_mean += delta / self.total_days as f64;
            self.return_m2 += delta * (daily_return - self.return_mean);
            self.last_equity = equity;
            self.worst_drawdown = self.worst_drawdown.min(equity / self.equity_peak - 1.0);
            self.equity.push(Equity {
                date: date_text(session.date),
                equity,
                cash: self.cash,
                drawdown: equity / self.equity_peak - 1.0,
                holdings: self.positions.iter().filter(|p| p.quantity > 0).count(),
            });
            if self.research_enabled {
                self.observe(session.date, session.rebalance, &book, first_decision)?;
            }
        }
        if trading && self.audit_enabled {
            self.audit = Some(AuditDay {
                date: date_text(session.date),
                cash: self.cash,
                equity: self.account_equity(),
                breadth: features.map_or_else(|| self.breadth(&book), |f| f.breadth.clone()),
                targets: self
                    .decisions
                    .get(first_decision)
                    .map(|d| d.targets.clone()),
                holdings: self.holdings(),
                orders: self.orders[first_order..].to_vec(),
            });
        }
        if raw_model {
            for (i, a) in self.manifest.corporate_actions.iter().enumerate() {
                if a.record_date == session.date {
                    self.entitlements[i] = self.positions[a.id].quantity;
                }
            }
        }
        self.previous_limit_up = limit_up;
        self.next_session += 1;
        Ok(())
    }
    fn raw_model(&self) -> bool {
        self.config.execution_model == "jsg-raw-v2"
    }
    fn apply_actions(&mut self, date: u32) -> Result<(), String> {
        for (i, a) in self.manifest.corporate_actions.iter().enumerate() {
            // Non-trading ex/payment dates become effective before the next session.
            let previous = self
                .next_session
                .checked_sub(1)
                .map_or(0, |j| self.manifest.calendar[j].date);
            let qty = self.entitlements[i];
            if a.ex_date > previous && a.ex_date <= date && qty > 0 {
                let p = &mut self.positions[a.id];
                let exact = qty as f64 * a.share_ratio;
                let added = exact.floor() as u64;
                let distribution = qty as f64 * (a.cash_per_share - a.withholding_per_share)
                    + (exact - added as f64) * a.fractional_cash_price;
                let old_cost = p.cost * p.quantity as f64;
                p.quantity = p
                    .quantity
                    .checked_add(added)
                    .ok_or("corporate action share overflow")?;
                if p.quantity > 1_000_000_000_000 {
                    return Err("corporate action quantity limit".into());
                }
                p.cost = if p.quantity > 0 {
                    (old_cost - distribution).max(0.0) / p.quantity as f64
                } else {
                    0.0
                };
                p.peak = (p.peak - a.cash_per_share) / (1.0 + a.share_ratio);
                self.receivables += distribution;
                if self.research_enabled {
                    self.accounts[a.id].dirty = true;
                    self.accounts[a.id].receivable += distribution;
                    self.accounts[a.id].income += distribution;
                }
                // An overnight order no longer represents the original signal after an ex event.
                self.pending.retain(|o| o.id != a.id);
            }
            if a.pay_date > previous && a.pay_date <= date && qty > 0 {
                let exact = qty as f64 * a.share_ratio;
                let distribution = qty as f64 * (a.cash_per_share - a.withholding_per_share)
                    + exact.fract() * a.fractional_cash_price;
                self.receivables -= distribution;
                self.cash += distribution;
                if self.research_enabled {
                    self.accounts[a.id].dirty = true;
                    self.accounts[a.id].receivable -= distribution;
                    self.accounts[a.id].cashflow += distribution;
                }
            }
        }
        if self.receivables.abs() < 1e-7 {
            self.receivables = 0.0;
        }
        if !self.cash.is_finite() || !self.receivables.is_finite() {
            return Err("corporate action amount overflow".into());
        }
        Ok(())
    }
    fn account_equity(&self) -> f64 {
        self.cash
            + self.receivables
            + self
                .positions
                .iter()
                .map(|p| p.mark * p.quantity as f64)
                .sum::<f64>()
    }
    fn at_limit(&self, bar: &Bar, price: f64, up: bool) -> bool {
        if self.raw_model() {
            let limit = if up {
                bar.limit_up.unwrap_or(0.0)
            } else {
                bar.limit_down.unwrap_or(0.0)
            };
            return limit > 0.0
                && if up {
                    price >= limit - 1e-8
                } else {
                    price <= limit + 1e-8
                };
        }
        let ratio = if bar.is_st {
            0.05
        } else {
            self.manifest.instruments[bar.id].limit_ratio
        };
        if ratio == 0.0 {
            return false;
        }
        let limit = ((bar.preclose * (1.0 + if up { ratio } else { -ratio }) + 0.0001) * 100.0)
            .round()
            / 100.0;
        if up {
            price >= limit - 1e-8
        } else {
            price <= limit + 1e-8
        }
    }
    fn fill(
        &mut self,
        order: Pending,
        date: u32,
        book: &[Option<Bar>],
        open: bool,
    ) -> Result<(), String> {
        if (!self.streamed && self.total_filled + self.total_rejected >= MAX_ORDERS)
            || self.orders.len() >= MAX_ORDERS
        {
            return Err("order output limit exceeded; shorten range".into());
        }
        let mut quantity = 0;
        let mut price = 0.0;
        let mut fee = 0.0;
        let mut status = "missing-bar";
        let mut risk_reason = None;
        if let Some(bar) = &book[order.id] {
            let raw = if open { bar.open } else { bar.close };
            let factor = if self.raw_model() { 1.0 } else { bar.adjfactor };
            price = raw
                * factor
                * (1.0
                    + if order.buy {
                        self.config.slippage_bps / 10000.0
                    } else {
                        -self.config.slippage_bps / 10000.0
                    });
            if self.raw_model() {
                price = (price * 100.0).round() / 100.0;
                if bar.limit_up.unwrap_or(0.0) > 0.0 {
                    price = price
                        .min(bar.limit_up.unwrap())
                        .max(bar.limit_down.unwrap());
                }
                price = price.min(bar.high).max(bar.low);
            }
            if !bar.tradable {
                status = "suspended";
            } else if self.at_limit(bar, raw, order.buy) {
                status = if order.buy { "limit-up" } else { "limit-down" };
            } else {
                let raw_model = self.raw_model();
                let max_volume = if raw_model {
                    (bar.volume.unwrap() as f64 * self.config.participation).floor() as u64
                } else {
                    u64::MAX
                };
                let available_volume = max_volume.saturating_sub(self.volume_used[order.id]);
                let requested = order.quantity.min(available_volume);
                let schedule = self.config.fees.iter().rev().find(|f| f.from <= date);
                let fee_for = |q: u64| -> f64 {
                    if q == 0 {
                        return 0.0;
                    }
                    let amount = q as f64 * price;
                    let commission = if raw_model {
                        schedule
                            .and_then(|f| f.commission_bps)
                            .unwrap_or(self.config.commission_bps)
                    } else {
                        self.config.commission_bps
                    };
                    let proportional = amount * commission / 10000.0;
                    if !raw_model {
                        return proportional;
                    }
                    let f = schedule.unwrap();
                    let total = proportional.max(f.minimum_commission)
                        + amount * (f.transfer_bps + if order.buy { 0.0 } else { f.sell_tax_bps })
                            / 10000.0;
                    (total * 100.0).round() / 100.0
                };
                let locked: u64 = if raw_model {
                    self.manifest
                        .corporate_actions
                        .iter()
                        .enumerate()
                        .filter(|(_, a)| {
                            a.id == order.id && a.ex_date <= date && date < a.share_available_date
                        })
                        .map(|(i, a)| (self.entitlements[i] as f64 * a.share_ratio).floor() as u64)
                        .sum()
                } else {
                    0
                };
                // Value all holdings at this execution's open/close, never a future close.
                let mark_for = |id: usize| {
                    book[id].as_ref().map_or(self.positions[id].mark, |b| {
                        (if open { b.open } else { b.close })
                            * if raw_model { 1.0 } else { b.adjfactor }
                    })
                };
                let holdings_value: f64 = if order.buy
                    && (self.config.max_position_pct > 0.0 || self.config.max_exposure_pct > 0.0)
                {
                    self.positions
                        .iter()
                        .enumerate()
                        .map(|(id, p)| p.quantity as f64 * mark_for(id))
                        .sum()
                } else {
                    0.0
                };
                let mark = raw * factor;
                let held_value = self.positions[order.id].quantity as f64 * mark;
                let equity = self.cash + holdings_value + self.receivables;
                let cap_reason = |q: u64| -> Option<&'static str> {
                    let purchased_value = q as f64 * mark;
                    let after_equity = equity + purchased_value - q as f64 * price - fee_for(q);
                    if self.config.max_position_pct > 0.0
                        && held_value + purchased_value
                            > after_equity * self.config.max_position_pct + 1e-8
                    {
                        Some("position-cap")
                    } else if self.config.max_exposure_pct > 0.0
                        && holdings_value + purchased_value
                            > after_equity * self.config.max_exposure_pct + 1e-8
                    {
                        Some("exposure-cap")
                    } else {
                        None
                    }
                };
                if order.buy {
                    let affordable = (self.cash
                        / (price
                            * (1.0
                                + if raw_model {
                                    0.0
                                } else {
                                    self.config.commission_bps / 10000.0
                                }))
                        / 100.0)
                        .floor()
                        .clamp(0.0, 1e10) as u64
                        * 100;
                    quantity = requested.min(affordable) / 100 * 100;
                    // Binary search avoids a loop proportional to the position size.
                    if quantity as f64 * price + fee_for(quantity) > self.cash {
                        let mut low = 0;
                        let mut high = quantity / 100;
                        while low < high {
                            let mid = (low + high + 1) / 2;
                            if (mid * 100) as f64 * price + fee_for(mid * 100) <= self.cash {
                                low = mid;
                            } else {
                                high = mid - 1;
                            }
                        }
                        quantity = low * 100;
                    }
                    if quantity > 0 {
                        risk_reason = cap_reason(quantity);
                        if risk_reason.is_some() {
                            let mut low = 0;
                            let mut high = quantity / 100;
                            while low < high {
                                let mid = (low + high + 1) / 2;
                                if cap_reason(mid * 100).is_none() {
                                    low = mid;
                                } else {
                                    high = mid - 1;
                                }
                            }
                            quantity = low * 100;
                            // Report the cap that actually prevents the next lot, not the
                            // first cap exceeded by the original, larger request.
                            risk_reason = cap_reason(quantity + 100);
                        }
                    }
                    let position = &mut self.positions[order.id];
                    if quantity > 0 {
                        fee = fee_for(quantity);
                        let amount = quantity as f64 * price + fee;
                        position.cost = (position.cost * position.quantity as f64 + amount)
                            / (position.quantity + quantity) as f64;
                        position.quantity += quantity;
                        position.today += quantity;
                        position.peak = position.peak.max(price);
                        self.cash = (self.cash - amount).max(0.0);
                    }
                    status = if quantity == 0 {
                        risk_reason.unwrap_or("insufficient-cash")
                    } else if quantity < order.quantity {
                        "partial"
                    } else {
                        "filled"
                    };
                } else {
                    let position = &mut self.positions[order.id];
                    let sellable = position
                        .quantity
                        .saturating_sub(if self.config.t_plus_one || raw_model {
                            position.today
                        } else {
                            0
                        })
                        .saturating_sub(locked);
                    quantity = requested.min(sellable);
                    // Odd shares may be sold only when clearing the complete sellable holding.
                    if raw_model && quantity < sellable {
                        quantity = quantity / 100 * 100;
                    }
                    if quantity > 0 {
                        fee = fee_for(quantity);
                        self.cash += quantity as f64 * price - fee;
                        position.quantity -= quantity;
                        position.today = position.today.min(position.quantity);
                        if position.quantity == 0 {
                            position.cost = 0.0;
                            position.peak = 0.0;
                        }
                    }
                    status = if quantity == 0 {
                        "not-sellable"
                    } else if quantity < order.quantity {
                        "partial"
                    } else {
                        "filled"
                    };
                }
                if quantity == 0 && available_volume < 100 {
                    status = "volume-limit";
                }
                self.volume_used[order.id] += quantity;
                self.positions[order.id].mark = raw * factor;
            }
        }
        self.total_fees += fee;
        if self.research_enabled && quantity > 0 {
            let a = &mut self.accounts[order.id];
            a.dirty = true;
            if order.buy {
                a.basis += quantity as f64 * price + fee;
            } else {
                let remaining = self.positions[order.id].quantity;
                a.basis *= remaining as f64 / (remaining + quantity) as f64;
            }
            a.cashflow += if order.buy {
                -(quantity as f64 * price + fee)
            } else {
                quantity as f64 * price - fee
            };
            a.fees += fee;
        }
        if quantity > 0 {
            self.total_filled += 1;
        } else {
            self.total_rejected += 1;
        }
        self.orders.push(Order {
            date: date_text(date),
            signal_date: date_text(order.signal_date),
            code: self.manifest.instruments[order.id].code.clone(),
            side: if order.buy { "buy" } else { "sell" }.into(),
            timing: if open { "next-open" } else { "close" }.into(),
            reason: order.reason.into(),
            risk_reason: risk_reason.map(str::to_owned),
            requested: order.quantity,
            quantity,
            price,
            fee,
            status: status.into(),
        });
        Ok(())
    }
    fn close_position(
        &mut self,
        id: usize,
        date: u32,
        reason: &'static str,
        book: &[Option<Bar>],
    ) -> Result<(), String> {
        let quantity = self.positions[id].quantity;
        if quantity > 0 {
            self.fill(
                Pending {
                    id,
                    buy: false,
                    quantity,
                    signal_date: date,
                    reason,
                },
                date,
                book,
                false,
            )?;
        }
        Ok(())
    }
    fn risk(&mut self, date: u32, book: &[Option<Bar>]) -> Result<bool, String> {
        let equity = self.account_equity();
        self.risk_peak = self.risk_peak.max(equity);
        let drawdown_now = self.config.max_drawdown > 0.0
            && !self.drawdown_triggered
            && 1.0 - equity / self.risk_peak >= self.config.max_drawdown;
        if drawdown_now {
            self.drawdown_triggered = true;
        }
        let daily_now = self.config.max_daily_loss > 0.0
            && 1.0 - equity / self.last_equity >= self.config.max_daily_loss;
        if daily_now {
            self.daily_loss_triggered = true;
        }
        // A portfolio exit remains active until all holdings can actually be sold.
        if self.drawdown_triggered || self.daily_loss_triggered {
            let had_positions = self.positions.iter().any(|p| p.quantity > 0);
            let reason = if self.drawdown_triggered {
                "max-drawdown"
            } else {
                "daily-loss"
            };
            self.pending.retain(|order| !order.buy);
            for id in 0..self.positions.len() {
                self.close_position(id, date, reason, book)?;
            }
            let remaining = self.positions.iter().any(|p| p.quantity > 0);
            if drawdown_now || daily_now || remaining || had_positions {
                return Ok(true);
            }
            self.daily_loss_triggered = false;
        }
        for (id, bar) in book.iter().enumerate() {
            let p = &mut self.positions[id];
            if p.quantity == 0 {
                self.risk_pending[id] = None;
                continue;
            }
            if bar.is_some() {
                p.peak = p.peak.max(p.mark);
            }
            let reason = self.risk_pending[id].or_else(|| {
                if bar.is_none() {
                    None
                } else if self.config.stop_loss > 0.0
                    && p.mark / p.cost - 1.0 <= -self.config.stop_loss
                {
                    Some("stop-loss")
                } else if self.config.trailing_stop > 0.0
                    && 1.0 - p.mark / p.peak >= self.config.trailing_stop
                {
                    Some("trailing-stop")
                } else if self.config.take_profit > 0.0
                    && p.mark / p.cost - 1.0 >= self.config.take_profit
                {
                    Some("take-profit")
                } else {
                    None
                }
            });
            if let Some(reason) = reason {
                self.risk_pending[id] = Some(reason);
                self.risk_exited.insert(id);
                self.close_position(id, date, reason, book)?;
                if self.positions[id].quantity == 0 {
                    self.risk_pending[id] = None;
                }
            }
        }
        Ok(false)
    }
    fn rebalance(
        &mut self,
        date: u32,
        equity: f64,
        book: &[Option<Bar>],
        features: Option<&crate::features::PreparedDay>,
    ) -> Result<(), String> {
        let ranked = features.map_or_else(|| self.breadth(book), |f| f.breadth.clone());
        let top = ranked.first().map(|b| {
            (
                self.manifest
                    .industries
                    .iter()
                    .position(|i| i == &b.industry)
                    .unwrap(),
                b.ratio,
            )
        });
        let allowed = top.is_some_and(|(id, _)| {
            !self
                .config
                .industry_blacklist
                .contains(&self.manifest.industries[id])
        });
        let ids = if allowed {
            features.map_or_else(
                || crate::features::candidates(&self.manifest, book.iter().flatten()),
                |f| f.candidates.clone(),
            )
        } else {
            vec![]
        };
        let mut selected: Vec<&Bar> = ids.iter().filter_map(|id| book[*id].as_ref()).collect();
        selected.truncate(self.config.pool_size.min(self.config.stock_count));
        let targets: BTreeSet<usize> = selected.iter().map(|b| b.id).collect();
        for id in 0..self.positions.len() {
            let quantity = self.positions[id].quantity;
            if quantity > 0 && !targets.contains(&id) {
                self.pending.push(Pending {
                    id,
                    buy: false,
                    quantity,
                    signal_date: date,
                    reason: "rebalance",
                });
            }
        }
        let allocation = equity * 0.95 / selected.len().max(1) as f64;
        for bar in &selected {
            if self.risk_exited.contains(&bar.id) {
                continue;
            }
            let lots = (allocation
                / (bar.close * if self.raw_model() { 1.0 } else { bar.adjfactor })
                / 100.0)
                .floor();
            if !lots.is_finite() || lots > 1e10 {
                return Err("position quantity exceeds research model limit".into());
            }
            let target = lots as u64 * 100;
            let held = self.positions[bar.id].quantity;
            if target != held {
                self.pending.push(Pending {
                    id: bar.id,
                    buy: target > held,
                    quantity: target.abs_diff(held),
                    signal_date: date,
                    reason: "rebalance",
                });
            }
        }
        self.decisions.push(Decision {
            date: date_text(date),
            top_industry: top.map(|(id, _)| self.manifest.industries[id].clone()),
            breadth: top.map_or(0.0, |(_, ratio)| ratio),
            targets: selected
                .iter()
                .map(|b| self.manifest.instruments[b.id].code.clone())
                .collect(),
        });
        Ok(())
    }
    fn breadth(&self, book: &[Option<Bar>]) -> Vec<Breadth> {
        crate::features::breadth(&self.manifest, book.iter().flatten(), &self.histories)
    }
    fn observe(
        &mut self,
        date: u32,
        rebalance: bool,
        book: &[Option<Bar>],
        first_decision: usize,
    ) -> Result<(), String> {
        let day = date_text(date);
        let equity = self.account_equity();
        let d = &mut self.diagnostics;
        d.days += 1;
        d.instrument_days += book.len();
        d.first_date.get_or_insert_with(|| day.clone());
        d.last_date = Some(day.clone());
        d.stale_held_marks = self.missing_marks;
        for b in book.iter().flatten() {
            d.rows += 1;
            d.non_positive_profit += usize::from(b.profit <= 0.0);
            d.zero_shares += usize::from(b.shares == 0.0);
            d.unknown_industry += usize::from(self.manifest.industries[b.industry] == "unknown");
            d.suspended += usize::from(!b.tradable);
            d.st += usize::from(b.is_st);
        }
        let breadth = self.breadth(book);
        let candidates = if rebalance {
            let ids = crate::features::candidates(&self.manifest, book.iter().flatten());
            let mut ranks = vec![None; book.len()];
            for (i, id) in ids.iter().enumerate() {
                ranks[*id] = Some(i + 1);
            }
            let decision = self.decisions.get(first_decision);
            let blocked = match decision {
                None => Some("portfolio-stop"),
                Some(d) if d.top_industry.is_none() => Some("insufficient-history"),
                Some(d)
                    if d.top_industry
                        .as_ref()
                        .is_some_and(|i| self.config.industry_blacklist.contains(i)) =>
                {
                    Some("industry-blacklist")
                }
                _ => None,
            };
            let mut rows: Vec<Candidate> = book
                .iter()
                .flatten()
                .filter(|b| b.selection_member)
                .map(|b| {
                    let reason = if b.is_st {
                        "st"
                    } else if b.profit <= 0.0 {
                        "non-positive-profit"
                    } else if b.shares <= 0.0 {
                        "zero-shares"
                    } else if let Some(reason) = blocked {
                        reason
                    } else if ranks[b.id]
                        .is_some_and(|r| r <= self.config.stock_count.min(self.config.pool_size))
                    {
                        "target"
                    } else if ranks[b.id].is_some_and(|r| r <= self.config.pool_size) {
                        "pool"
                    } else {
                        "outside-pool"
                    };
                    Candidate {
                        code: self.manifest.instruments[b.id].code.clone(),
                        industry: self.manifest.industries[b.industry].clone(),
                        market_cap: b.close * b.shares,
                        rank: ranks[b.id],
                        reason: reason.into(),
                        tradable: b.tradable,
                    }
                })
                .collect();
            rows.sort_by(|a, b| {
                a.rank
                    .unwrap_or(usize::MAX)
                    .cmp(&b.rank.unwrap_or(usize::MAX))
                    .then(a.code.cmp(&b.code))
            });
            Some(rows)
        } else {
            None
        };
        let mut ledger = vec![];
        for (id, p) in self.positions.iter().enumerate() {
            let a = &mut self.accounts[id];
            let value = p.mark * p.quantity as f64;
            let profit = value + a.receivable + a.cashflow;
            let daily_profit = profit - a.previous_profit;
            if p.quantity > 0
                || a.previous_quantity > 0
                || a.dirty
                || a.receivable.abs() > 1e-8
                || daily_profit.abs() > 1e-8
            {
                let unrealized = value - a.basis;
                ledger.push(LedgerRow {
                    code: self.manifest.instruments[id].code.clone(),
                    industry: self.manifest.industries[a.industry].clone(),
                    quantity: p.quantity,
                    average_cost: if p.quantity > 0 {
                        a.basis / p.quantity as f64
                    } else {
                        0.0
                    },
                    price: p.mark,
                    mark_date: date_text(a.mark_date),
                    value,
                    weight: value / equity,
                    cashflow: a.cashflow,
                    receivable: a.receivable,
                    income: a.income,
                    fees: a.fees,
                    daily_profit,
                    profit,
                    realized: profit - unrealized,
                    unrealized,
                });
            }
            a.previous_profit = profit;
            a.previous_quantity = p.quantity;
            a.dirty = false;
        }
        self.research_cells +=
            ledger.len() + breadth.len() + candidates.as_ref().map_or(0, Vec::len);
        if self.research_cells > MAX_ORDERS {
            return Err("research output limit exceeded; use streaming / native --jsonl".into());
        }
        self.research.push(ResearchDay {
            date: day,
            cash: self.cash,
            receivables: self.receivables,
            equity,
            breadth,
            ledger,
            candidates,
        });
        Ok(())
    }
    fn holdings(&self) -> Vec<Holding> {
        self.positions
            .iter()
            .enumerate()
            .filter(|(_, p)| p.quantity > 0)
            .map(|(id, p)| Holding {
                code: self.manifest.instruments[id].code.clone(),
                quantity: p.quantity,
                average_cost: p.cost,
                price: p.mark,
                value: p.mark * p.quantity as f64,
            })
            .collect()
    }
    pub fn finish(self) -> Result<ResultData, String> {
        if self.next_session != self.manifest.calendar.len() {
            return Err("incomplete dataset: calendar sessions missing".into());
        }
        if self.total_days == 0 {
            return Err("no trading sessions".into());
        }
        let last = self.last_equity;
        let mean = self.return_mean;
        let variance = self.return_m2 / self.total_days.saturating_sub(1).max(1) as f64;
        let metrics = Metrics {
            engine: "rust-wasm/native".into(),
            model: self.config.execution_model.clone(),
            final_equity: last,
            total_return: last / self.config.initial_capital - 1.0,
            annualized_return: (last / self.config.initial_capital)
                .powf(252.0 / self.total_days as f64)
                - 1.0,
            sharpe: if variance > 0.0 {
                mean / variance.sqrt() * 252.0_f64.sqrt()
            } else {
                0.0
            },
            max_drawdown: self.worst_drawdown,
            filled_orders: self.total_filled,
            rejected_orders: self.total_rejected,
            fees: self.total_fees,
            days: self.total_days,
        };
        if !metrics.annualized_return.is_finite() || !metrics.sharpe.is_finite() {
            return Err("metric overflow; inspect prices and adjustment factors".into());
        }
        let holdings = self.holdings();
        let mut warnings = self.manifest.warnings;
        if self.missing_marks > 0 {
            warnings.push(format!(
                "{} held-instrument sessions marked at stale prices",
                self.missing_marks
            ));
        }
        Ok(ResultData {
            diagnostics: self.diagnostics,
            research: self.research,
            metrics,
            equity: self.equity,
            orders: self.orders,
            holdings,
            decisions: self.decisions,
            pending_orders: self.pending.len(),
            warnings,
            receivables: self.receivables,
        })
    }
}
