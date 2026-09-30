use crate::model::*;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

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
    equity: Vec<Equity>,
    orders: Vec<Order>,
    decisions: Vec<Decision>,
    missing_marks: usize,
}
impl Engine {
    pub fn new(manifest: Manifest, config: Config) -> Result<Self, String> {
        manifest.validate()?;
        config.validate()?;
        let count = manifest.instruments.len();
        let capital = config.initial_capital;
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
            equity: vec![],
            orders: vec![],
            decisions: vec![],
            missing_marks: 0,
        })
    }
    pub fn processed_days(&self) -> usize {
        self.next_session
    }
    pub fn day(&mut self, bars: Vec<Bar>) -> Result<(), String> {
        let session = self
            .manifest
            .calendar
            .get(self.next_session)
            .ok_or("more batches than calendar sessions")?
            .clone();
        let mut book = vec![None; self.positions.len()];
        let mut last_id = None;
        for bar in bars {
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
        for position in &mut self.positions {
            position.today = 0;
        }
        let trading = session.date >= self.manifest.start_date;
        if trading {
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
                self.positions[id].mark = adjusted;
                let history = &mut self.histories[id];
                if history.len() == 20 {
                    history.pop_front();
                }
                history.push_back(adjusted);
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
                    self.rebalance(session.date, opening_equity, &book)?;
                }
            }
            let equity = self.account_equity();
            if !equity.is_finite() || equity <= 0.0 {
                return Err("non-finite or depleted portfolio".into());
            }
            self.equity_peak = self.equity_peak.max(equity);
            self.equity.push(Equity {
                date: date_text(session.date),
                equity,
                cash: self.cash,
                drawdown: equity / self.equity_peak - 1.0,
                holdings: self.positions.iter().filter(|p| p.quantity > 0).count(),
            });
        }
        self.previous_limit_up = limit_up;
        self.next_session += 1;
        Ok(())
    }
    fn account_equity(&self) -> f64 {
        self.cash
            + self
                .positions
                .iter()
                .map(|p| p.mark * p.quantity as f64)
                .sum::<f64>()
    }
    fn at_limit(&self, bar: &Bar, price: f64, up: bool) -> bool {
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
        if self.orders.len() >= MAX_ORDERS {
            return Err("order output limit exceeded; shorten range".into());
        }
        let mut quantity = 0;
        let mut price = 0.0;
        let mut fee = 0.0;
        let mut status = "missing-bar";
        if let Some(bar) = &book[order.id] {
            let raw = if open { bar.open } else { bar.close };
            price = raw
                * bar.adjfactor
                * (1.0
                    + if order.buy {
                        self.config.slippage_bps / 10000.0
                    } else {
                        -self.config.slippage_bps / 10000.0
                    });
            if !bar.tradable {
                status = "suspended";
            } else if self.at_limit(bar, raw, order.buy) {
                status = if order.buy { "limit-up" } else { "limit-down" };
            } else {
                let position = &mut self.positions[order.id];
                if order.buy {
                    let affordable = (self.cash
                        / (price * (1.0 + self.config.commission_bps / 10000.0))
                        / 100.0)
                        .floor()
                        .clamp(0.0, 1e10) as u64
                        * 100;
                    quantity = order.quantity.min(affordable);
                    if quantity > 0 {
                        fee = quantity as f64 * price * self.config.commission_bps / 10000.0;
                        let amount = quantity as f64 * price + fee;
                        position.cost = (position.cost * position.quantity as f64 + amount)
                            / (position.quantity + quantity) as f64;
                        position.quantity += quantity;
                        position.today += quantity;
                        position.peak = position.peak.max(price);
                        self.cash = (self.cash - amount).max(0.0);
                    }
                    status = if quantity == 0 {
                        "insufficient-cash"
                    } else if quantity < order.quantity {
                        "partial"
                    } else {
                        "filled"
                    };
                } else {
                    let sellable = position.quantity
                        - if self.config.t_plus_one {
                            position.today
                        } else {
                            0
                        };
                    quantity = order.quantity.min(sellable);
                    if quantity > 0 {
                        fee = quantity as f64 * price * self.config.commission_bps / 10000.0;
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
                position.mark = raw * bar.adjfactor;
            }
        }
        self.orders.push(Order {
            date: date_text(date),
            signal_date: date_text(order.signal_date),
            code: self.manifest.instruments[order.id].code.clone(),
            side: if order.buy { "buy" } else { "sell" }.into(),
            timing: if open { "next-open" } else { "close" }.into(),
            reason: order.reason.into(),
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
        if self.config.max_drawdown > 0.0
            && !self.drawdown_triggered
            && 1.0 - equity / self.risk_peak >= self.config.max_drawdown
        {
            self.drawdown_triggered = true;
            for id in 0..self.positions.len() {
                self.close_position(id, date, "max-drawdown", book)?;
            }
            return Ok(true);
        }
        // Retry liquidation if a limit-down, suspension or T+1 restriction prevented a fill.
        if self.drawdown_triggered {
            for id in 0..self.positions.len() {
                self.close_position(id, date, "max-drawdown", book)?;
            }
        }
        for (id, bar) in book.iter().enumerate() {
            let p = &mut self.positions[id];
            if p.quantity == 0 || bar.is_none() {
                continue;
            }
            p.peak = p.peak.max(p.mark);
            let reason =
                if self.config.stop_loss > 0.0 && p.mark / p.cost - 1.0 <= -self.config.stop_loss {
                    Some("stop-loss")
                } else if self.config.trailing_stop > 0.0
                    && 1.0 - p.mark / p.peak >= self.config.trailing_stop
                {
                    Some("trailing-stop")
                } else {
                    None
                };
            if let Some(reason) = reason {
                self.close_position(id, date, reason, book)?;
            }
        }
        Ok(false)
    }
    fn rebalance(&mut self, date: u32, equity: f64, book: &[Option<Bar>]) -> Result<(), String> {
        let mut breadth: BTreeMap<usize, (usize, usize)> = BTreeMap::new();
        for bar in book
            .iter()
            .flatten()
            .filter(|b| b.breadth_member && self.manifest.industries[b.industry] != "unknown")
        {
            let h = &self.histories[bar.id];
            if h.len() != 20 {
                continue;
            }
            let entry = breadth.entry(bar.industry).or_default();
            entry.1 += 1;
            if bar.close * bar.adjfactor > h.iter().sum::<f64>() / 20.0 {
                entry.0 += 1;
            }
        }
        let mut ranked: Vec<(usize, f64)> = breadth
            .into_iter()
            .map(|(id, (above, total))| {
                (id, (above as f64 / total as f64 * 100.0).round_ties_even())
            })
            .collect();
        ranked.sort_by(|a, b| {
            b.1.total_cmp(&a.1)
                .then_with(|| self.manifest.industries[a.0].cmp(&self.manifest.industries[b.0]))
        });
        let top = ranked.first().copied();
        let allowed = top.is_some_and(|(id, _)| {
            !self
                .config
                .industry_blacklist
                .contains(&self.manifest.industries[id])
        });
        let mut selected: Vec<&Bar> = if allowed {
            book.iter()
                .flatten()
                .filter(|b| b.selection_member && !b.is_st && b.profit > 0.0 && b.shares > 0.0)
                .collect()
        } else {
            vec![]
        };
        selected.sort_by(|a, b| {
            (a.close * a.shares)
                .total_cmp(&(b.close * b.shares))
                .then_with(|| {
                    self.manifest.instruments[a.id]
                        .code
                        .cmp(&self.manifest.instruments[b.id].code)
                })
        });
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
            let lots = (allocation / (bar.close * bar.adjfactor) / 100.0).floor();
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
    pub fn finish(self) -> Result<ResultData, String> {
        if self.next_session != self.manifest.calendar.len() {
            return Err("incomplete dataset: calendar sessions missing".into());
        }
        let last = self.equity.last().ok_or("no trading sessions")?.equity;
        let mut returns = vec![];
        let mut previous = self.config.initial_capital;
        for point in &self.equity {
            returns.push(point.equity / previous - 1.0);
            previous = point.equity;
        }
        let mean = returns.iter().sum::<f64>() / returns.len() as f64;
        let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>()
            / returns.len().saturating_sub(1).max(1) as f64;
        let metrics = Metrics {
            engine: "rust-wasm/native".into(),
            model: "jsg-adjusted-v1".into(),
            final_equity: last,
            total_return: last / self.config.initial_capital - 1.0,
            annualized_return: (last / self.config.initial_capital)
                .powf(252.0 / self.equity.len() as f64)
                - 1.0,
            sharpe: if variance > 0.0 {
                mean / variance.sqrt() * 252.0_f64.sqrt()
            } else {
                0.0
            },
            max_drawdown: self.equity.iter().map(|e| e.drawdown).fold(0.0, f64::min),
            filled_orders: self.orders.iter().filter(|o| o.quantity > 0).count(),
            rejected_orders: self.orders.iter().filter(|o| o.quantity == 0).count(),
            fees: self.orders.iter().map(|o| o.fee).sum(),
            days: self.equity.len(),
        };
        if !metrics.annualized_return.is_finite() || !metrics.sharpe.is_finite() {
            return Err("metric overflow; inspect prices and adjustment factors".into());
        }
        let holdings = self
            .positions
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
            .collect();
        let mut warnings = self.manifest.warnings;
        if self.missing_marks > 0 {
            warnings.push(format!(
                "{} held-instrument sessions marked at stale prices",
                self.missing_marks
            ));
        }
        Ok(ResultData {
            metrics,
            equity: self.equity,
            orders: self.orders,
            holdings,
            decisions: self.decisions,
            pending_orders: self.pending.len(),
            warnings,
        })
    }
}
