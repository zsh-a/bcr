use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySignal {
    /// Close timestamp and price of the completed signal candle, before execution.
    pub time: u64,
    pub price: f64,
    /// Prior channel boundary, or the impulse extreme for a pullback entry.
    pub boundary: f64,
    pub atr: f64,
    /// Channel bars preceding the signal candle; absent for structural pullbacks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lookback_bars: Option<usize>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trade {
    pub id: usize,
    pub side: Side,
    pub entry_time: u64,
    pub exit_time: u64,
    pub entry_price: f64,
    pub entry_signal: EntrySignal,
    pub exit_price: f64,
    pub quantity: f64,
    pub initial_stop: f64,
    pub risk: f64,
    pub gross_pnl: f64,
    pub fees: f64,
    pub funding: f64,
    /// Already included in fill-based gross PnL; never deducted from cash again.
    pub slippage_and_rounding: f64,
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
    /// Present on signal events; value retains its original anchor semantics.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_signal: Option<EntrySignal>,
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
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextDecision {
    pub time: u64,
    pub price: f64,
    pub side: Side,
    pub minutes: usize,
    pub as_of: Option<u64>,
    pub phase: &'static str,
    pub direction: Option<Side>,
    pub reference: Option<f64>,
    pub anchor: Option<f64>,
    pub efficiency: Option<f64>,
    pub extension_atr: Option<f64>,
    pub cost_atr: Option<f64>,
    pub allowed: bool,
    pub reason: &'static str,
}
#[derive(Clone, Default, Serialize)]
pub struct ContextMetrics {
    pub evaluated: usize,
    pub allowed: usize,
    pub rejected: usize,
    pub reasons: BTreeMap<&'static str, usize>,
}
impl ContextMetrics {
    pub fn observe(&mut self, decision: &ContextDecision) {
        self.evaluated += 1;
        if decision.allowed {
            self.allowed += 1;
        } else {
            self.rejected += 1;
            *self.reasons.entry(decision.reason).or_default() += 1;
        }
    }
}
#[derive(Default, Serialize)]
pub struct Chunk {
    pub trades: Vec<Trade>,
    pub events: Vec<Event>,
    pub equity: Vec<Equity>,
    pub indicators: Vec<Indicator>,
    pub contexts: Vec<ContextDecision>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub evaluation: super::evaluation::Evaluation,
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
    pub context: ContextMetrics,
}
