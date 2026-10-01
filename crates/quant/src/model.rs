use serde::{Deserialize, Serialize};

pub const MAX_PARTITION_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_INSTRUMENTS: usize = 20_000;
pub const MAX_DAYS: usize = 20_000;
pub const MAX_ORDERS: usize = 200_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub research_window: Option<ResearchWindow>,
    #[serde(default = "research_model")]
    pub execution_model: String,
    #[serde(default)]
    pub fees: Vec<FeeSchedule>,
    #[serde(default = "default_participation")]
    pub participation: f64,
    pub initial_capital: f64,
    pub pool_size: usize,
    pub stock_count: usize,
    pub commission_bps: f64,
    pub slippage_bps: f64,
    pub stop_loss: f64,
    pub trailing_stop: f64,
    pub max_drawdown: f64,
    pub t_plus_one: bool,
    pub industry_blacklist: Vec<String>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            research_window: None,
            execution_model: research_model(),
            fees: vec![],
            participation: default_participation(),
            initial_capital: 1_000_000.0,
            pool_size: 20,
            stock_count: 10,
            commission_bps: 3.0,
            slippage_bps: 10.0,
            stop_loss: 0.0,
            trailing_stop: 0.0,
            max_drawdown: 0.0,
            t_plus_one: false,
            industry_blacklist: vec!["ads".into()],
        }
    }
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if self
            .research_window
            .as_ref()
            .is_some_and(|w| !valid_date(w.start) || !valid_date(w.end) || w.start > w.end)
        {
            return Err("invalid research window".into());
        }
        if !["jsg-adjusted-v1", "jsg-raw-v2"].contains(&self.execution_model.as_str())
            || !self.participation.is_finite()
            || !(0.0..=1.0).contains(&self.participation)
            || self.participation == 0.0
        {
            return Err("invalid execution model/participation".into());
        }
        let mut previous = 0;
        for f in &self.fees {
            if f.commission_bps
                .is_some_and(|v| !v.is_finite() || !(0.0..=100.0).contains(&v))
            {
                return Err("invalid dated commission".into());
            }
            if !valid_date(f.from) || f.from <= previous {
                return Err("fee schedule must have sorted unique dates".into());
            }
            for v in [f.minimum_commission, f.transfer_bps, f.sell_tax_bps] {
                if !v.is_finite() || !(0.0..=10000.0).contains(&v) {
                    return Err("invalid fees".into());
                }
            }
            previous = f.from;
        }
        if !self.initial_capital.is_finite()
            || self.initial_capital <= 0.0
            || self.initial_capital > 1e15
            || self.pool_size == 0
            || self.pool_size > MAX_INSTRUMENTS
            || self.stock_count == 0
            || self.stock_count > self.pool_size
        {
            return Err("invalid capital or stock/pool count".into());
        }
        for value in [self.commission_bps, self.slippage_bps] {
            if !value.is_finite() || !(0.0..=100.0).contains(&value) {
                return Err("commission/slippage must be between 0 and 100 bps".into());
            }
        }
        for value in [self.stop_loss, self.trailing_stop, self.max_drawdown] {
            if !value.is_finite() || !(0.0..1.0).contains(&value) {
                return Err("risk thresholds must be in [0, 1)".into());
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResearchWindow {
    pub start: u32,
    pub end: u32,
}
fn research_model() -> String {
    "jsg-adjusted-v1".into()
}
fn default_participation() -> f64 {
    0.1
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeeSchedule {
    #[serde(default)]
    pub commission_bps: Option<f64>,
    pub from: u32,
    pub minimum_commission: f64,
    pub transfer_bps: f64,
    pub sell_tax_bps: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorporateAction {
    pub id: usize,
    pub record_date: u32,
    pub ex_date: u32,
    pub pay_date: u32,
    pub share_available_date: u32,
    pub known_date: u32,
    pub cash_per_share: f64,
    pub withholding_per_share: f64,
    /// Additional shares per old share; explicit cash in lieu for fractional shares.
    pub share_ratio: f64,
    pub fractional_cash_price: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataQuality {
    pub membership: String,
    pub financials: String,
    pub corporate_actions: String,
    pub price_limits: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Instrument {
    pub code: String,
    pub limit_ratio: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub date: u32,
    pub rebalance: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Partition {
    pub file: String,
    pub bytes: usize,
    pub rows: usize,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub corporate_actions: Vec<CorporateAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_quality: Option<DataQuality>,
    pub version: u32,
    pub schema: String,
    pub name: String,
    pub source: String,
    pub universe_mode: String,
    pub warnings: Vec<String>,
    pub start_date: u32,
    pub end_date: u32,
    pub instruments: Vec<Instrument>,
    pub industries: Vec<String>,
    pub calendar: Vec<Session>,
    pub partitions: Vec<Partition>,
}
impl Manifest {
    pub fn validate(&self) -> Result<(), String> {
        if !((self.version == 1 && self.schema == "jsg-daily-v1")
            || (self.version == 2 && self.schema == "jsg-daily-v2"))
        {
            return Err("unsupported research schema".into());
        }
        if let Some(q) = &self.data_quality {
            if !["historical", "snapshot"].contains(&q.membership.as_str())
                || !["revisions", "latest"].contains(&q.financials.as_str())
                || !["complete", "missing"].contains(&q.corporate_actions.as_str())
                || !["daily", "static"].contains(&q.price_limits.as_str())
            {
                return Err("invalid data quality provenance".into());
            }
        }
        if self.version == 2 && self.data_quality.is_none() {
            return Err("v2 requires data quality provenance".into());
        }
        if self.corporate_actions.len() > MAX_DAYS {
            return Err("too many corporate actions".into());
        }
        let mut actions = std::collections::BTreeSet::new();
        for a in &self.corporate_actions {
            if a.id >= self.instruments.len()
                || ![
                    a.record_date,
                    a.ex_date,
                    a.pay_date,
                    a.share_available_date,
                    a.known_date,
                ]
                .into_iter()
                .all(valid_date)
                || a.record_date >= a.ex_date
                || a.known_date > a.record_date
                || a.pay_date < a.ex_date
                || a.share_available_date < a.ex_date
                || !actions.insert((a.id, a.ex_date))
                || a.withholding_per_share > a.cash_per_share
                || [
                    a.cash_per_share,
                    a.withholding_per_share,
                    a.share_ratio,
                    a.fractional_cash_price,
                ]
                .iter()
                .any(|v| !v.is_finite() || !(0.0..=1e6).contains(v))
            {
                return Err("invalid/duplicate corporate action or availability dates".into());
            }
            if a.record_date >= self.start_date
                && a.record_date <= self.end_date
                && !self.calendar.iter().any(|s| s.date == a.record_date)
            {
                return Err("corporate action record date missing from trading calendar".into());
            }
        }
        if self.instruments.is_empty()
            || self.instruments.len() > MAX_INSTRUMENTS
            || self.industries.is_empty()
            || self.industries.len() > MAX_INSTRUMENTS
            || self.calendar.is_empty()
            || self.calendar.len() > MAX_DAYS
            || self.start_date > self.end_date
            || self.partitions.is_empty()
        {
            return Err("invalid research dimensions/range".into());
        }
        if !["snapshot", "historical", "synthetic"].contains(&self.universe_mode.as_str()) {
            return Err("invalid universe mode".into());
        }
        let mut industries = std::collections::BTreeSet::new();
        if self
            .industries
            .iter()
            .any(|name| name.is_empty() || !industries.insert(name))
        {
            return Err("invalid/duplicate industry code".into());
        }
        let mut codes = std::collections::BTreeSet::new();
        for instrument in &self.instruments {
            if instrument.code.is_empty()
                || !codes.insert(&instrument.code)
                || !instrument.limit_ratio.is_finite()
                || !(0.0..=0.3).contains(&instrument.limit_ratio)
            {
                return Err("invalid/duplicate instrument".into());
            }
        }
        let mut previous = 0;
        for session in &self.calendar {
            if !valid_date(session.date) || session.date <= previous {
                return Err("calendar must be sorted and unique".into());
            }
            previous = session.date;
        }
        if !self.calendar.iter().any(|s| s.date == self.start_date)
            || self.calendar.last().map(|s| s.date) != Some(self.end_date)
        {
            return Err(
                "calendar must include start and end sessions (warmup precedes start)".into(),
            );
        }
        let mut names = std::collections::BTreeSet::new();
        for partition in &self.partitions {
            if partition.bytes == 0
                || partition.bytes > MAX_PARTITION_BYTES
                || partition.rows == 0
                || partition.file.contains(['/', '\\'])
                || !partition.file.ends_with(".arrow")
                || !names.insert(&partition.file)
            {
                return Err("invalid/duplicate/big Arrow partition".into());
            }
        }
        Ok(())
    }
}
pub fn valid_date(date: u32) -> bool {
    let y = date / 10000;
    let m = (date / 100) % 100;
    let d = date % 100;
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days = match m {
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    (1900..=2200).contains(&y) && d > 0 && d <= days
}
pub fn date_text(date: u32) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date / 10000,
        date / 100 % 100,
        date % 100
    )
}

#[derive(Clone, Debug)]
pub struct Bar {
    pub volume: Option<u64>,
    pub limit_up: Option<f64>,
    pub limit_down: Option<f64>,
    pub id: usize,
    pub industry: usize,
    pub date: u32,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub preclose: f64,
    pub adjfactor: f64,
    pub profit: f64,
    pub shares: f64,
    pub is_st: bool,
    pub tradable: bool,
    pub breadth_member: bool,
    pub selection_member: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Equity {
    pub date: String,
    pub equity: f64,
    pub cash: f64,
    pub drawdown: f64,
    pub holdings: usize,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Order {
    pub date: String,
    pub signal_date: String,
    pub code: String,
    pub side: String,
    pub timing: String,
    pub reason: String,
    pub requested: u64,
    pub quantity: u64,
    pub price: f64,
    pub fee: f64,
    pub status: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Holding {
    pub code: String,
    pub quantity: u64,
    pub average_cost: f64,
    pub price: f64,
    pub value: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub date: String,
    pub top_industry: Option<String>,
    pub breadth: f64,
    pub targets: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub engine: String,
    pub model: String,
    pub final_equity: f64,
    pub total_return: f64,
    pub annualized_return: f64,
    pub sharpe: f64,
    pub max_drawdown: f64,
    pub filled_orders: usize,
    pub rejected_orders: usize,
    pub fees: f64,
    pub days: usize,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultData {
    pub diagnostics: crate::research::Diagnostics,
    pub research: Vec<crate::research::ResearchDay>,
    pub metrics: Metrics,
    pub equity: Vec<Equity>,
    pub orders: Vec<Order>,
    pub holdings: Vec<Holding>,
    pub decisions: Vec<Decision>,
    pub pending_orders: usize,
    pub warnings: Vec<String>,
    pub receivables: f64,
}

/// Optional daily reconciliation output; drained by the caller, never retained for a whole run.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditDay {
    pub date: String,
    pub cash: f64,
    pub equity: f64,
    pub breadth: Vec<Breadth>,
    pub targets: Option<Vec<String>>,
    pub holdings: Vec<Holding>,
    pub orders: Vec<Order>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Breadth {
    pub industry: String,
    pub above: usize,
    pub total: usize,
    pub ratio: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputChunk {
    pub research: Vec<crate::research::ResearchDay>,
    pub equity: Vec<Equity>,
    pub orders: Vec<Order>,
    pub decisions: Vec<Decision>,
}
