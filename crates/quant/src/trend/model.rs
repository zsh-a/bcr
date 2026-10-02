use serde::{Deserialize, Serialize};

pub const MINUTE: u64 = 60_000;
pub const DAY: u64 = 86_400_000;
pub const MAX_WARMUP_DAYS: u64 = 250;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Long,
    Short,
}
impl Side {
    pub fn sign(self) -> f64 {
        if self == Self::Long {
            1.0
        } else {
            -1.0
        }
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Bar {
    pub time: u64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Funding {
    pub time: u64,
    pub rate: f64,
    pub interval_hours: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trade {
    pub id: usize,
    pub side: Side,
    pub entry_time: u64,
    pub exit_time: u64,
    pub entry_price: f64,
    pub exit_price: f64,
    pub quantity: f64,
    pub initial_stop: f64,
    pub risk: f64,
    pub gross_pnl: f64,
    pub fees: f64,
    pub funding: f64,
    pub net_pnl: f64,
    pub r_multiple: f64,
    pub mfe_r: f64,
    pub mae_r: f64,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub time: u64,
    pub kind: &'static str,
    pub side: Side,
    pub price: f64,
    pub value: Option<f64>,
    pub trade_id: Option<usize>,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Equity {
    pub time: u64,
    pub equity: f64,
    pub cash: f64,
    pub drawdown: f64,
}
#[derive(Clone, Debug, Serialize)]
pub struct Indicator {
    pub time: u64,
    pub fast: f64,
    pub slow: f64,
}
#[derive(Default, Serialize)]
pub struct Chunk {
    pub trades: Vec<Trade>,
    pub events: Vec<Event>,
    pub equity: Vec<Equity>,
    pub indicators: Vec<Indicator>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub final_equity: f64,
    pub total_return: f64,
    pub max_drawdown: f64,
    pub trades: usize,
    pub wins: usize,
    pub losses: usize,
    pub win_rate: Option<f64>,
    pub profit_factor: Option<f64>,
    pub mean_r: Option<f64>,
    pub fees: f64,
    pub funding: f64,
    pub longest_loss_streak: usize,
    pub rejected_signals: usize,
    pub funding_events: usize,
    pub rows: usize,
}
