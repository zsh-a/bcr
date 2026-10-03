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

/// A fully observed minute. Protection uses its extrema/close only after the
/// previously active stop has been checked; changes apply from the next open.
#[derive(Clone, Copy, Debug)]
pub struct MinuteClose(pub Bar);
impl MinuteClose {
    pub fn time(self) -> u64 {
        self.0.time + MINUTE - 1
    }
}

/// A completed strategy candle and the ATR incorporating that same candle.
/// It is distinct from a minute close even when the strategy period is one minute.
#[derive(Clone, Copy, Debug)]
pub struct TradingClose {
    pub bar: Bar,
    pub time: u64,
    pub atr: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitReason {
    Channel,
    ProtectionCrossed,
    DailyClose,
    DailyLoss,
}
impl ExitReason {
    pub fn label(self) -> &'static str {
        match self {
            Self::Channel => "channel-exit",
            Self::ProtectionCrossed => "protection-crossed",
            Self::DailyClose => "daily-close",
            Self::DailyLoss => "daily-loss",
        }
    }
    pub fn priority(self) -> u8 {
        match self {
            Self::Channel => 0,
            Self::ProtectionCrossed => 1,
            Self::DailyClose => 2,
            Self::DailyLoss => 3,
        }
    }
}

/// A market exit already decided for one position. Engine alone queues and
/// consumes it; a conditional stop remains independent of this instruction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExitIntent {
    pub position_id: usize,
    pub triggered_at: u64,
    pub execute_at: u64,
    pub reason: ExitReason,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary: Option<f64>,
    pub atr: f64,
    /// Channel bars preceding the signal candle; absent for structural pullbacks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lookback_bars: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger: Option<EntryTrigger>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum EntryTrigger {
    Kdj(KdjTrigger),
    PriceAction(PriceActionTrigger),
    StructuredPullback(StructuredPullbackTrigger),
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeLabels {
    pub two_legs: bool,
    pub wedge: bool,
    pub channel: bool,
    pub double_test: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandleLabels {
    pub engulfing: bool,
    pub doji: bool,
    pub inside_bar: bool,
    pub outside_bar: bool,
    pub reversal: bool,
    pub double_doji: bool,
    pub narrow_range: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedTurn {
    pub kind: &'static str,
    pub time: u64,
    pub confirmed_at: u64,
    pub price: f64,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedEmaSnapshot {
    pub minutes: usize,
    pub period: usize,
    pub value: f64,
    pub observed_at: u64,
    pub validated_at: u64,
    pub touches: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retest_time: Option<u64>,
    pub valid: bool,
}
fn serialize_turns<S: serde::Serializer>(
    turns: &[Option<ConfirmedTurn>; 6],
    s: S,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeSeq;
    let mut seq = s.serialize_seq(Some(turns.iter().flatten().count()))?;
    for turn in turns.iter().flatten() {
        seq.serialize_element(turn)?;
    }
    seq.end()
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryGates {
    pub retracement: bool,
    pub key: bool,
    pub shape: bool,
    pub candle: bool,
}
impl EntryGates {
    pub fn passed(self) -> bool {
        self.retracement && self.key && self.shape && self.candle
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEligibility {
    pub pivot: bool,
    pub ema: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuredPullbackTrigger {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation: Option<super::config::ConfirmationPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_role: Option<super::config::KeyRole>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gates: Option<EntryGates>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_eligible: Option<ContextEligibility>,
    pub kind: &'static str,
    pub setup_id: u64,
    pub impulse_start_time: u64,
    pub impulse_confirmed_at: u64,
    pub impulse_end_time: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pullback_started_at: Option<u64>,
    pub impulse_start_price: f64,
    pub impulse_extreme: f64,
    pub reference_atr: f64,
    pub strength_atr: f64,
    pub efficiency: f64,
    pub pullback_bars: usize,
    pub retracement: f64,
    pub shapes: ShapeLabels,
    pub candles: CandleLabels,
    #[serde(serialize_with = "serialize_turns")]
    pub turns: [Option<ConfirmedTurn>; 6],
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pivot: Option<KeyLevelSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ema: Option<ValidatedEmaSnapshot>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceActionTrigger {
    pub kind: &'static str,
    pub setup_id: u64,
    pub impulse_start_time: u64,
    pub impulse_confirmed_at: u64,
    pub pullback_started_at: u64,
    pub impulse_start_price: f64,
    pub impulse_extreme: f64,
    pub reference_atr: f64,
    pub strength_atr: f64,
    pub efficiency: f64,
    pub pullback_bars: usize,
    pub retracement: f64,
    pub leg_count: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_level: Option<KeyLevelSnapshot>,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyLevelSnapshot {
    pub minutes: usize,
    pub price: f64,
    pub pivot_time: u64,
    pub confirmed_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retest_time: Option<u64>,
    pub valid: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KdjTrigger {
    pub kind: &'static str,
    pub armed_at: u64,
    pub armed_k: f64,
    pub previous_k: f64,
    pub previous_d: f64,
    pub k: f64,
    pub d: f64,
    pub j: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slow_ema: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slow_ema3_ago: Option<f64>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fast: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slow: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub k: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub d: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub j: Option<f64>,
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
