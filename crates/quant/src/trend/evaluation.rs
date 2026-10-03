use super::model::{Side, Trade, DAY, MINUTE};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
    pub net_expectancy: Option<f64>,
    pub average_win: Option<f64>,
    pub average_loss: Option<f64>,
    pub payoff_ratio: Option<f64>,
    pub gross_pnl: f64,
    pub mean_hold_hours: Option<f64>,
    pub exposure_pct: f64,
    pub turnover: f64,
    pub daily_sharpe: Option<f64>,
    pub sortino: Option<f64>,
    pub calmar: Option<f64>,
    pub positive_days: usize,
    pub total_days: usize,
    pub best_trade_share: Option<f64>,
    pub without_best_trade: f64,
    pub long_net_pnl: f64,
    pub short_net_pnl: f64,
    pub exit_reasons: BTreeMap<String, usize>,
}

/// Bounded by the 730-day replay window, independent of output drain boundaries.
#[derive(Default)]
pub struct Evaluator {
    daily: Vec<(u64, f64)>,
    exposed: usize,
    minutes: usize,
    turnover: f64,
    trades: usize,
    wins: usize,
    losses: usize,
    profit: f64,
    loss: f64,
    net: f64,
    gross: f64,
    best: f64,
    hold_hours: f64,
    long_net: f64,
    short_net: f64,
    reasons: BTreeMap<String, usize>,
}
impl Evaluator {
    pub fn minute(&mut self, time: u64, equity: f64, exposed: bool) {
        self.minutes += 1;
        self.exposed += usize::from(exposed);
        if (time + 1) % DAY == 0 {
            self.point(time, equity);
        }
    }
    pub fn point(&mut self, time: u64, equity: f64) {
        if self.daily.last().is_some_and(|p| p.0 == time) {
            self.daily.pop();
        }
        self.daily.push((time, equity));
    }
    pub fn entry(&mut self, notional: f64) {
        self.turnover += notional;
    }
    pub fn trade(&mut self, trade: &Trade) {
        self.trades += 1;
        self.turnover += trade.exit_price * trade.quantity;
        self.net += trade.net_pnl;
        self.gross += trade.gross_pnl;
        self.best = self.best.max(trade.net_pnl);
        self.hold_hours += (trade.exit_time - trade.entry_time) as f64 / (60 * MINUTE) as f64;
        if trade.net_pnl > 0.0 {
            self.wins += 1;
            self.profit += trade.net_pnl;
        }
        if trade.net_pnl < 0.0 {
            self.losses += 1;
            self.loss -= trade.net_pnl;
        }
        if trade.side == Side::Long {
            self.long_net += trade.net_pnl;
        } else {
            self.short_net += trade.net_pnl;
        }
        *self.reasons.entry(trade.reason.clone()).or_default() += 1;
    }
    pub fn finish(
        &self,
        initial: f64,
        start: u64,
        end: u64,
        final_equity: f64,
        drawdown: f64,
    ) -> Evaluation {
        let mut previous = initial;
        let mut returns = vec![];
        for &(time, equity) in &self.daily {
            // Risk ratios use complete UTC days only. Partial first/last days
            // still participate in PnL, duration, exposure and drawdown.
            if start % DAY == 0 || time >= (start / DAY + 1) * DAY + DAY - 1 {
                if (time + 1) % DAY == 0 && previous > 0.0 {
                    returns.push(equity / previous - 1.0);
                }
            }
            previous = equity;
        }
        let n = returns.len();
        let mean = if n > 0 {
            returns.iter().sum::<f64>() / n as f64
        } else {
            0.0
        };
        let variance = if n > 1 {
            returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / (n - 1) as f64
        } else {
            0.0
        };
        let downside = if n > 0 {
            returns.iter().map(|r| r.min(0.0).powi(2)).sum::<f64>() / n as f64
        } else {
            0.0
        };
        let ratio = |denominator: f64| {
            (n >= 30 && denominator > 0.0).then(|| mean / denominator.sqrt() * 365.0_f64.sqrt())
        };
        let days = (end - start) as f64 / DAY as f64;
        let annual_return = if final_equity > 0.0 {
            (final_equity / initial).powf(365.0 / days) - 1.0
        } else {
            -1.0
        };
        let average_win = (self.wins > 0).then(|| self.profit / self.wins as f64);
        let average_loss = (self.losses > 0).then(|| self.loss / self.losses as f64);
        Evaluation {
            net_expectancy: (self.trades > 0).then(|| self.net / self.trades as f64),
            average_win,
            average_loss,
            payoff_ratio: average_win.zip(average_loss).map(|(w, l)| w / l),
            gross_pnl: self.gross,
            mean_hold_hours: (self.trades > 0).then(|| self.hold_hours / self.trades as f64),
            exposure_pct: if self.minutes > 0 {
                self.exposed as f64 / self.minutes as f64
            } else {
                0.0
            },
            turnover: self.turnover / initial,
            daily_sharpe: ratio(variance),
            sortino: ratio(downside),
            calmar: (days >= 30.0 && drawdown < 0.0).then(|| annual_return / -drawdown),
            positive_days: returns.iter().filter(|r| **r > 0.0).count(),
            total_days: n,
            best_trade_share: (self.profit > 0.0).then(|| self.best / self.profit),
            without_best_trade: self.net - self.best,
            long_net_pnl: self.long_net,
            short_net_pnl: self.short_net,
            exit_reasons: self.reasons.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn final_cost_replaces_daily_close_instead_of_creating_an_extra_day() {
        let mut e = Evaluator::default();
        let start = 1_704_067_200_000;
        for i in 0..30 {
            e.point(start + (i + 1) * DAY - 1, 100.0 + i as f64);
        }
        e.point(start + 30 * DAY - 1, 120.0);
        let result = e.finish(100.0, start, start + 30 * DAY, 120.0, -0.1);
        assert_eq!(result.total_days, 30);
        assert_eq!(result.positive_days, 28);
        assert!(result.daily_sharpe.is_some());
        assert!(result.sortino.is_some());
    }
    #[test]
    fn no_trades_or_partial_days_do_not_invent_expectancy_or_sharpe() {
        let mut e = Evaluator::default();
        let start = 1_704_067_200_000;
        e.point(start + MINUTE - 1, 100.0);
        let r = e.finish(100.0, start, start + MINUTE, 100.0, 0.0);
        assert_eq!(r.net_expectancy, None);
        assert_eq!(r.daily_sharpe, None);
        assert_eq!(r.total_days, 0);
    }
}
