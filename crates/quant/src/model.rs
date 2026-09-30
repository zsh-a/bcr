use serde::{Deserialize, Serialize};

pub const MAX_PARTITION_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_INSTRUMENTS: usize = 20_000;
pub const MAX_DAYS: usize = 20_000;
pub const MAX_ORDERS: usize = 200_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
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
        if self.version != 1 || self.schema != "jsg-daily-v1" {
            return Err("unsupported research schema".into());
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
    pub metrics: Metrics,
    pub equity: Vec<Equity>,
    pub orders: Vec<Order>,
    pub holdings: Vec<Holding>,
    pub decisions: Vec<Decision>,
    pub pending_orders: usize,
    pub warnings: Vec<String>,
}
