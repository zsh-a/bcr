//! Research observations come from actual fills and closing marks, never simulated trade pairs.
use crate::model::Breadth;
use serde::Serialize;

#[derive(Clone, Default)]
pub(crate) struct Account {
    /// Weighted acquisition cost including buy fees; cash distributions do not reduce this basis.
    pub basis: f64,
    pub dirty: bool,
    pub cashflow: f64,
    pub fees: f64,
    pub income: f64,
    pub receivable: f64,
    pub previous_profit: f64,
    pub previous_quantity: u64,
    pub industry: usize,
    pub mark_date: u32,
}

#[derive(Clone, Default, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub version: u32,
    pub days: usize,
    pub rows: usize,
    pub instrument_days: usize,
    pub non_positive_profit: usize,
    pub zero_shares: usize,
    pub unknown_industry: usize,
    pub suspended: usize,
    pub st: usize,
    pub stale_held_marks: usize,
    pub first_date: Option<String>,
    pub last_date: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRow {
    pub code: String,
    pub industry: String,
    pub quantity: u64,
    pub average_cost: f64,
    pub price: f64,
    pub mark_date: String,
    pub value: f64,
    pub weight: f64,
    pub cashflow: f64,
    pub receivable: f64,
    pub income: f64,
    pub fees: f64,
    pub daily_profit: f64,
    pub profit: f64,
    pub realized: f64,
    pub unrealized: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
    pub code: String,
    pub industry: String,
    pub market_cap: f64,
    pub rank: Option<usize>,
    pub reason: String,
    pub tradable: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchDay {
    pub date: String,
    pub cash: f64,
    pub receivables: f64,
    pub equity: f64,
    pub breadth: Vec<Breadth>,
    pub ledger: Vec<LedgerRow>,
    /// Present on scheduled rebalances, including a rebalance blocked by portfolio risk.
    pub candidates: Option<Vec<Candidate>>,
}
