use super::model::{Side, Trade, DAY, MINUTE};
use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::Serialize;
use std::collections::BTreeMap;

const ANNUALIZATION_DAYS: f64 = 365.0;
const MIN_DAILY_OBSERVATIONS: usize = 30;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conventions {
    pub calendar: &'static str,
    pub annualization_days: usize,
    pub risk_free_rate: f64,
    pub downside_target: f64,
    pub min_daily_observations: usize,
    pub variance: &'static str,
    pub drawdown_sampling: &'static str,
}
impl Default for Conventions {
    fn default() -> Self {
        Self {
            calendar: "UTC",
            annualization_days: ANNUALIZATION_DAYS as usize,
            risk_free_rate: 0.0,
            downside_target: 0.0,
            min_daily_observations: MIN_DAILY_OBSERVATIONS,
            variance: "sample",
            drawdown_sampling: "minute-mark-and-fills",
        }
    }
}

/// Actual covered interval [from, to); partial first/last UTC days stay visible.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyReturn {
    pub from: u64,
    pub to: u64,
    pub equity: f64,
    pub return_pct: Option<f64>,
    pub complete: bool,
    /// Drawdown against peaks in the daily/terminal sequence, not minute peaks.
    pub drawdown: f64,
    /// Lowest sampled drawdown against the global minute/fill peak that day.
    pub max_intraday_drawdown: f64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyReturn {
    pub from: u64,
    pub to: u64,
    pub equity: f64,
    pub return_pct: Option<f64>,
    pub complete: bool,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Costs {
    pub fees: f64,
    /// Signed: negative funding is a credit.
    pub funding: f64,
    pub slippage_and_rounding: f64,
    pub total: f64,
    /// Same quantities and trade path repriced at raw fill references.
    /// This is not a zero-cost strategy rerun.
    pub gross_before_costs: f64,
    pub net_pnl: f64,
    pub cost_to_gross_profit: Option<f64>,
}
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
    pub version: u8,
    pub conventions: Conventions,
    pub annualized_return: Option<f64>,
    pub annualized_volatility: Option<f64>,
    pub duration_ms: u64,
    pub daily_max_drawdown: f64,
    pub max_drawdown_duration_ms: u64,
    pub current_drawdown_duration_ms: u64,
    pub current_drawdown: f64,
    pub best_day_return: Option<f64>,
    pub worst_day_return: Option<f64>,
    pub daily: Vec<DailyReturn>,
    pub monthly: Vec<MonthlyReturn>,
    pub costs: Costs,
}

#[derive(Clone, Copy)]
struct Drawdown {
    peak: f64,
    peak_time: u64,
    current: f64,
    maximum: f64,
    current_duration: u64,
    maximum_duration: u64,
}
impl Drawdown {
    fn new(initial: f64, start: u64) -> Self {
        Self {
            peak: initial,
            peak_time: start,
            current: 0.0,
            maximum: 0.0,
            current_duration: 0,
            maximum_duration: 0,
        }
    }
    fn observe(&mut self, time: u64, equity: f64) {
        if equity >= self.peak {
            if self.current < 0.0 {
                self.maximum_duration = self.maximum_duration.max(time - self.peak_time);
            }
            // Equal highs recover the previous episode and reset the high-water time.
            self.peak = equity;
            self.peak_time = time;
            self.current = 0.0;
            self.current_duration = 0;
        } else {
            self.current = equity / self.peak - 1.0;
            self.current_duration = time - self.peak_time;
            self.maximum_duration = self.maximum_duration.max(self.current_duration);
            self.maximum = self.maximum.min(self.current);
        }
    }
}
struct DayClose {
    time: u64,
    equity: f64,
    min_drawdown: f64,
}

/// One pending point lets a fill replace a same-timestamp mark without leaving
/// a false peak, trough, recovery or daily record. Storage remains O(days).
pub struct Evaluator {
    initial: f64,
    start: u64,
    daily: Vec<DayClose>,
    pending: Option<(u64, f64)>,
    drawdown: Drawdown,
    day_min_drawdown: f64,
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
    fees: f64,
    funding: f64,
    slippage_and_rounding: f64,
    best: f64,
    hold_hours: f64,
    long_net: f64,
    short_net: f64,
    reasons: BTreeMap<String, usize>,
}
impl Evaluator {
    pub fn new(initial: f64, start: u64) -> Self {
        Self {
            initial,
            start,
            daily: vec![],
            pending: None,
            drawdown: Drawdown::new(initial, start),
            day_min_drawdown: 0.0,
            exposed: 0,
            minutes: 0,
            turnover: 0.0,
            trades: 0,
            wins: 0,
            losses: 0,
            profit: 0.0,
            loss: 0.0,
            net: 0.0,
            gross: 0.0,
            fees: 0.0,
            funding: 0.0,
            slippage_and_rounding: 0.0,
            best: 0.0,
            hold_hours: 0.0,
            long_net: 0.0,
            short_net: 0.0,
            reasons: BTreeMap::new(),
        }
    }
    pub fn minute(&mut self, exposed: bool) {
        self.minutes += 1;
        self.exposed += usize::from(exposed);
    }
    pub fn observe(&mut self, time: u64, equity: f64) -> f64 {
        if let Some((previous, _)) = self.pending {
            assert!(
                time >= previous,
                "equity observations must be chronological"
            );
            if time != previous {
                self.commit_pending();
            }
        }
        self.pending = Some((time, equity));
        self.latest_drawdown().current
    }
    fn latest_drawdown(&self) -> Drawdown {
        let mut value = self.drawdown;
        if let Some((time, equity)) = self.pending {
            value.observe(time, equity);
        }
        value
    }
    pub fn max_drawdown(&self) -> f64 {
        self.latest_drawdown().maximum
    }
    fn commit_pending(&mut self) {
        if let Some((time, equity)) = self.pending.take() {
            self.drawdown.observe(time, equity);
            self.day_min_drawdown = self.day_min_drawdown.min(self.drawdown.current);
            if (time + 1) % DAY == 0 {
                self.close_day(time, equity);
            }
        }
    }
    fn close_day(&mut self, time: u64, equity: f64) {
        self.daily.push(DayClose {
            time,
            equity,
            min_drawdown: self.day_min_drawdown,
        });
        self.day_min_drawdown = 0.0;
    }
    pub fn entry(&mut self, notional: f64) {
        self.turnover += notional;
    }
    pub fn trade(&mut self, trade: &Trade) {
        self.trades += 1;
        self.turnover += trade.exit_price * trade.quantity;
        self.net += trade.net_pnl;
        self.gross += trade.gross_pnl;
        self.fees += trade.fees;
        self.funding += trade.funding;
        self.slippage_and_rounding += trade.slippage_and_rounding;
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
    pub fn finish(&mut self, end: u64, final_equity: f64) -> Evaluation {
        self.observe(end - 1, final_equity);
        self.commit_pending();
        if self.daily.last().is_none_or(|day| day.time != end - 1) {
            self.close_day(end - 1, final_equity);
        }
        let mut from = self.start;
        let mut previous = self.initial;
        let mut daily_peak = self.initial;
        let mut daily_max_drawdown: f64 = 0.0;
        let mut daily = Vec::with_capacity(self.daily.len());
        for point in &self.daily {
            let to = point.time + 1;
            daily_peak = daily_peak.max(point.equity);
            let drawdown = point.equity / daily_peak - 1.0;
            daily_max_drawdown = daily_max_drawdown.min(drawdown);
            daily.push(DailyReturn {
                from,
                to,
                equity: point.equity,
                return_pct: period_return(previous, point.equity),
                complete: from % DAY == 0 && to - from == DAY,
                drawdown,
                max_intraday_drawdown: point.min_drawdown,
            });
            from = to;
            previous = point.equity;
        }
        let complete: Vec<_> = daily.iter().filter(|p| p.complete).collect();
        let n = complete.len();
        // Insolvency conventions use this same stored daily/terminal sequence in
        // native, WASM and offline portfolio research. Never select only the
        // definable days from a broken return path.
        let all_returns_defined = daily.iter().all(|p| p.return_pct.is_some());
        let nonnegative_path = daily.iter().all(|p| p.equity >= 0.0);
        let positive_before_final = daily.iter().take(daily.len() - 1).all(|p| p.equity > 0.0);
        let returns: Option<Vec<f64>> = complete.iter().map(|p| p.return_pct).collect();
        let valid_returns = returns.as_deref().unwrap_or(&[]);
        let mean = if !valid_returns.is_empty() {
            valid_returns.iter().sum::<f64>() / valid_returns.len() as f64
        } else {
            0.0
        };
        let variance = if valid_returns.len() > 1 {
            valid_returns
                .iter()
                .map(|r| (r - mean).powi(2))
                .sum::<f64>()
                / (valid_returns.len() - 1) as f64
        } else {
            0.0
        };
        let downside = if !valid_returns.is_empty() {
            valid_returns
                .iter()
                .map(|r| r.min(0.0).powi(2))
                .sum::<f64>()
                / valid_returns.len() as f64
        } else {
            0.0
        };
        let enough_days = n >= MIN_DAILY_OBSERVATIONS;
        let ratio = |denominator: f64| {
            if enough_days
                && all_returns_defined
                && nonnegative_path
                && returns.is_some()
                && denominator > 0.0
                && denominator.is_finite()
            {
                finite(mean / denominator.sqrt() * ANNUALIZATION_DAYS.sqrt())
            } else {
                None
            }
        };
        let duration_ms = end - self.start;
        let annualized_return = if enough_days && nonnegative_path && positive_before_final {
            finite(
                (final_equity / self.initial)
                    .powf(ANNUALIZATION_DAYS * DAY as f64 / duration_ms as f64)
                    - 1.0,
            )
        } else {
            None
        };
        let annualized_volatility =
            if enough_days && all_returns_defined && nonnegative_path && returns.is_some() {
                finite(variance.sqrt() * ANNUALIZATION_DAYS.sqrt())
            } else {
                None
            };
        let average_win = (self.wins > 0).then(|| self.profit / self.wins as f64);
        let average_loss = (self.losses > 0).then(|| self.loss / self.losses as f64);
        let total_cost = self.fees + self.funding + self.slippage_and_rounding;
        let gross_before_costs = self.gross + self.slippage_and_rounding;
        let monthly = monthly_returns(&daily, self.initial);
        Evaluation {
            net_expectancy: (self.trades > 0).then(|| self.net / self.trades as f64),
            average_win,
            average_loss,
            payoff_ratio: average_win
                .zip(average_loss)
                .and_then(|(w, l)| finite(w / l)),
            gross_pnl: self.gross,
            mean_hold_hours: (self.trades > 0).then(|| self.hold_hours / self.trades as f64),
            exposure_pct: if self.minutes > 0 {
                self.exposed as f64 / self.minutes as f64
            } else {
                0.0
            },
            turnover: self.turnover / self.initial,
            daily_sharpe: ratio(variance),
            sortino: ratio(downside),
            calmar: annualized_return.and_then(|annualized| {
                (self.drawdown.maximum < 0.0)
                    .then(|| annualized / -self.drawdown.maximum)
                    .and_then(finite)
            }),
            positive_days: complete
                .iter()
                .filter(|p| p.return_pct.is_some_and(|r| r > 0.0))
                .count(),
            total_days: n,
            best_trade_share: (self.profit > 0.0).then(|| self.best / self.profit),
            without_best_trade: self.net - self.best,
            long_net_pnl: self.long_net,
            short_net_pnl: self.short_net,
            exit_reasons: self.reasons.clone(),
            version: 2,
            conventions: Conventions::default(),
            annualized_return,
            annualized_volatility,
            duration_ms,
            daily_max_drawdown,
            max_drawdown_duration_ms: self.drawdown.maximum_duration,
            current_drawdown_duration_ms: self.drawdown.current_duration,
            current_drawdown: self.drawdown.current,
            best_day_return: all_returns_defined
                .then(|| {
                    complete
                        .iter()
                        .filter_map(|p| p.return_pct)
                        .reduce(f64::max)
                })
                .flatten(),
            worst_day_return: all_returns_defined
                .then(|| {
                    complete
                        .iter()
                        .filter_map(|p| p.return_pct)
                        .reduce(f64::min)
                })
                .flatten(),
            daily,
            monthly,
            costs: Costs {
                fees: self.fees,
                funding: self.funding,
                slippage_and_rounding: self.slippage_and_rounding,
                total: total_cost,
                gross_before_costs,
                net_pnl: self.net,
                cost_to_gross_profit: (gross_before_costs > 0.0)
                    .then(|| total_cost / gross_before_costs)
                    .and_then(finite),
            },
        }
    }
}
fn finite(value: f64) -> Option<f64> {
    value.is_finite().then_some(value)
}
fn period_return(initial: f64, final_equity: f64) -> Option<f64> {
    (initial > 0.0)
        .then(|| final_equity / initial - 1.0)
        .and_then(finite)
}
fn month_bounds(time: u64) -> (u64, u64) {
    let date =
        DateTime::<Utc>::from_timestamp_millis(time as i64).expect("validated market timestamp");
    let start = NaiveDate::from_ymd_opt(date.year(), date.month(), 1).unwrap();
    let end = if date.month() == 12 {
        NaiveDate::from_ymd_opt(date.year() + 1, 1, 1)
    } else {
        NaiveDate::from_ymd_opt(date.year(), date.month() + 1, 1)
    }
    .unwrap();
    let millis = |day: NaiveDate| {
        day.and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis() as u64
    };
    (millis(start), millis(end))
}
fn monthly_returns(daily: &[DailyReturn], initial: f64) -> Vec<MonthlyReturn> {
    let mut monthly = vec![];
    let Some(first) = daily.first() else {
        return monthly;
    };
    let mut from = first.from;
    let mut previous = initial;
    for (index, day) in daily.iter().enumerate() {
        let (calendar_start, calendar_end) = month_bounds(day.to - 1);
        if day.to == calendar_end || index + 1 == daily.len() {
            monthly.push(MonthlyReturn {
                from,
                to: day.to,
                equity: day.equity,
                return_pct: period_return(previous, day.equity),
                complete: from == calendar_start && day.to == calendar_end,
            });
            from = day.to;
            previous = day.equity;
        }
    }
    monthly
}

#[cfg(test)]
mod tests {
    use super::*;
    const START: u64 = 1_704_067_200_000;
    #[test]
    fn final_cost_replaces_daily_close_instead_of_creating_an_extra_day() {
        let mut e = Evaluator::new(100.0, START);
        for i in 0..30 {
            e.observe(START + (i + 1) * DAY - 1, 100.0 + i as f64);
        }
        let result = e.finish(START + 30 * DAY, 120.0);
        assert_eq!(result.total_days, 30);
        assert_eq!(result.positive_days, 28);
        assert_eq!(result.daily.len(), 30);
        assert_eq!(result.daily.last().unwrap().equity, 120.0);
        assert!((result.current_drawdown - (120.0 / 128.0 - 1.0)).abs() < 1e-12);
        assert!(result.daily_sharpe.is_some());
        assert!(result.sortino.is_some());
    }
    #[test]
    fn no_trades_or_partial_days_do_not_invent_expectancy_or_sharpe() {
        let mut e = Evaluator::new(100.0, START);
        let r = e.finish(START + MINUTE, 100.0);
        assert_eq!(r.net_expectancy, None);
        assert_eq!(r.daily_sharpe, None);
        assert_eq!(r.annualized_return, None);
        assert_eq!(r.annualized_volatility, None);
        assert_eq!(r.total_days, 0);
        assert_eq!(r.daily.len(), 1);
        assert!(!r.daily[0].complete);
        assert_eq!(r.monthly.len(), 1);
        assert!(!r.monthly[0].complete);
        assert_eq!(r.best_day_return, None);
    }
    #[test]
    fn matches_shared_account_evaluation_contract() {
        let contract: serde_json::Value = serde_json::from_str(include_str!(
            "../../fixtures/trend-evaluation-contract.json"
        ))
        .unwrap();
        for case in contract["cases"].as_array().unwrap() {
            let mut e = Evaluator::new(
                case["initialCapital"].as_f64().unwrap(),
                case["startTime"].as_u64().unwrap(),
            );
            let daily = case["daily"].as_array().unwrap();
            for point in daily {
                e.observe(
                    point["time"].as_u64().unwrap(),
                    point["equity"].as_f64().unwrap(),
                );
            }
            let value = serde_json::to_value(e.finish(
                case["endTime"].as_u64().unwrap(),
                daily.last().unwrap()["equity"].as_f64().unwrap(),
            ))
            .unwrap();
            assert_eq!(value["version"], contract["version"]);
            assert_eq!(
                value["conventions"].as_object().unwrap().len(),
                contract["conventions"].as_object().unwrap().len()
            );
            for (key, expected) in contract["conventions"].as_object().unwrap() {
                if expected.is_number() {
                    assert_eq!(value["conventions"][key].as_f64(), expected.as_f64());
                } else {
                    assert_eq!(&value["conventions"][key], expected);
                }
            }
            for (key, expected) in case["expected"].as_object().unwrap() {
                if let Some(number) = expected.as_f64() {
                    let actual = value[key].as_f64().unwrap();
                    assert!(
                        (actual - number).abs() <= 1e-10 * number.abs().max(1.0),
                        "{} {key}: expected {number}, actual {actual}",
                        case["name"]
                    );
                } else {
                    assert_eq!(&value[key], expected, "{} {key}", case["name"]);
                }
            }
        }
    }
    #[test]
    fn minute_drawdown_and_recovery_duration_do_not_use_daily_peaks() {
        let mut e = Evaluator::new(100.0, START);
        let peak = START + 12 * 60 * MINUTE;
        e.observe(peak, 120.0);
        e.observe(START + DAY - 1, 110.0);
        e.observe(START + DAY + MINUTE, 108.0);
        e.observe(START + 2 * DAY - 1, 115.0);
        let recovered = START + 2 * DAY + MINUTE;
        e.observe(recovered, 120.0);
        let end = START + 3 * DAY;
        let r = e.finish(end, 120.0);
        assert!((e.max_drawdown() + 0.1).abs() < 1e-12);
        assert_eq!(r.daily_max_drawdown, 0.0);
        assert_eq!(r.daily[0].drawdown, 0.0);
        assert!((r.daily[0].max_intraday_drawdown - (110.0 / 120.0 - 1.0)).abs() < 1e-12);
        assert!((r.daily[1].max_intraday_drawdown + 0.1).abs() < 1e-12);
        assert_eq!(r.max_drawdown_duration_ms, recovered - peak);
        assert_eq!(r.current_drawdown_duration_ms, 0);
        assert_eq!(r.current_drawdown, 0.0);
    }
    #[test]
    fn terminal_fill_replaces_transient_peak_trough_and_recovery() {
        for transient in [130.0, 50.0] {
            let mut e = Evaluator::new(100.0, START);
            let peak = START + MINUTE;
            let end = START + 2 * DAY;
            e.observe(peak, 120.0);
            e.observe(START + DAY - 1, 90.0);
            e.observe(end - 1, transient);
            let r = e.finish(end, 100.0);
            assert_eq!(r.daily.len(), 2);
            assert!((e.max_drawdown() + 0.25).abs() < 1e-12);
            assert!((r.current_drawdown - (100.0 / 120.0 - 1.0)).abs() < 1e-12);
            assert_eq!(r.current_drawdown_duration_ms, end - 1 - peak);
            assert_eq!(r.max_drawdown_duration_ms, end - 1 - peak);
            assert!((r.daily[1].max_intraday_drawdown - r.current_drawdown).abs() < 1e-12);
            assert!((r.daily_max_drawdown + 0.1).abs() < 1e-12);
        }
    }
    #[test]
    fn partial_utc_days_and_months_stay_visible_but_do_not_enter_daily_ratios() {
        let start = START + 30 * DAY + DAY / 2; // January 31 noon, leap year.
        let end = START + 61 * DAY + DAY / 2; // March 2 noon.
        let mut e = Evaluator::new(100.0, start);
        for day in 31..=61 {
            e.observe(START + day * DAY - 1, 110.0);
        }
        let r = e.finish(end, 99.0);
        assert_eq!(r.duration_ms, end - start);
        assert_eq!(r.total_days, 30);
        assert_eq!(r.daily.len(), 32);
        assert!(!r.daily.first().unwrap().complete);
        assert!(!r.daily.last().unwrap().complete);
        assert_eq!(r.best_day_return, Some(0.0));
        assert_eq!(r.worst_day_return, Some(0.0));
        assert_eq!(r.annualized_volatility, Some(0.0));
        assert_eq!(r.daily_sharpe, None);
        assert_eq!(r.monthly.len(), 3);
        assert!(!r.monthly[0].complete);
        assert_eq!(r.monthly[0].from, start);
        assert!(r.monthly[1].complete);
        assert_eq!(r.monthly[1].to - r.monthly[1].from, 29 * DAY);
        assert!(!r.monthly[2].complete);
        assert_eq!(r.monthly[2].to, end);
        let product = r
            .monthly
            .iter()
            .map(|m| 1.0 + m.return_pct.unwrap())
            .product::<f64>();
        assert!((product - 0.99).abs() < 1e-12);
        assert_eq!(
            month_bounds(1_735_603_200_000),
            (1_733_011_200_000, 1_735_689_600_000)
        );
    }
    #[test]
    fn nonpositive_daily_bases_do_not_selectively_drop_bad_days_for_ratios() {
        for nonpositive in [0.0, -1.0] {
            let mut e = Evaluator::new(100.0, START);
            for day in 1..=31 {
                e.observe(
                    START + day * DAY - 1,
                    if day == 15 {
                        nonpositive
                    } else {
                        100.0 + day as f64
                    },
                );
            }
            let r = e.finish(START + 31 * DAY, 131.0);
            assert_eq!(r.total_days, 31);
            assert_eq!(r.daily[15].return_pct, None);
            assert_eq!(r.daily_sharpe, None);
            assert_eq!(r.sortino, None);
            assert_eq!(r.annualized_volatility, None);
            assert_eq!(r.annualized_return, None);
            assert_eq!(r.calmar, None);
            assert_eq!(r.best_day_return, None);
            assert_eq!(r.worst_day_return, None);
        }
    }
    #[test]
    fn all_annualized_metrics_require_thirty_complete_days_and_finite_results() {
        for (days, final_equity, expected) in [
            (29, 110.0, None),
            (30, 0.0, Some(-1.0)),
            (30, -10.0, None),
            (30, 1e300, None),
        ] {
            let mut e = Evaluator::new(100.0, START);
            for day in 1..=days {
                e.observe(START + day * DAY - 1, 100.0);
            }
            let r = e.finish(START + days * DAY, final_equity);
            assert_eq!(r.annualized_return, expected);
            if final_equity == 0.0 {
                assert_eq!(r.worst_day_return, Some(-1.0));
                assert!(r.annualized_volatility.is_some());
            }
            if final_equity < 0.0 {
                assert_eq!(r.worst_day_return, Some(-1.1));
                assert_eq!(r.best_day_return, Some(0.0));
                assert_eq!(r.annualized_volatility, None);
                assert_eq!(r.daily_sharpe, None);
                assert_eq!(r.sortino, None);
                assert_eq!(r.calmar, None);
            }
            if days < 30 || final_equity == 1e300 {
                assert_eq!(r.annualized_volatility, None);
                assert_eq!(r.daily_sharpe, None);
                assert_eq!(r.sortino, None);
                assert_eq!(r.calmar, None);
            }
        }
    }
    #[test]
    fn observations_store_only_daily_closes_and_one_pending_point() {
        let mut e = Evaluator::new(100.0, START);
        for minute in 0..3 * 1440 {
            e.minute(minute % 2 == 0);
            e.observe(
                START + (minute + 1) * MINUTE - 1,
                100.0 + minute as f64 * 0.001,
            );
        }
        assert_eq!(e.daily.len(), 2);
        assert!(e.pending.is_some());
        let r = e.finish(START + 3 * DAY, 104.319);
        assert_eq!(r.daily.len(), 3);
        assert_eq!(r.exposure_pct, 0.5);
        assert_eq!(e.daily.len(), 3);
        assert!(e.pending.is_none());
    }
}
