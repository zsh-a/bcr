use serde::{Deserialize, Serialize};

pub const MINUTE: u64 = 60_000;
pub const DAY: u64 = 86_400_000;
pub const MAX_WARMUP_DAYS: u64 = 250;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub entry: String,
    pub direction: String,
    pub initial_capital: f64,
    pub risk_pct: f64,
    pub max_exposure_pct: f64,
    pub fee_bps: f64,
    pub slippage_bps: f64,
    pub tick_size: f64,
    pub quantity_step: f64,
    pub min_notional: f64,
    pub trade_minutes: usize,
    pub trend_minutes: usize,
    pub fast_ema: usize,
    pub slow_ema: usize,
    pub atr_period: usize,
    pub impulse_bars: usize,
    pub impulse_atr: f64,
    pub min_efficiency: f64,
    pub min_pullback_bars: usize,
    pub max_pullback_bars: usize,
    pub min_retracement: f64,
    pub max_retracement: f64,
    pub breakout_bars: usize,
    pub stop_atr: f64,
    pub max_stop_atr: f64,
    pub break_even_r: f64,
    pub trailing_start_r: f64,
    pub trailing_atr: f64,
    pub cooldown_losses: usize,
    pub cooldown_minutes: u64,
    pub daily_loss_pct: f64,
    pub flatten_minute: Option<u16>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            entry: "pullback".into(),
            direction: "both".into(),
            initial_capital: 10_000.0,
            risk_pct: 0.005,
            max_exposure_pct: 0.95,
            fee_bps: 5.0,
            slippage_bps: 2.0,
            tick_size: 0.1,
            quantity_step: 0.001,
            min_notional: 100.0,
            trade_minutes: 1,
            trend_minutes: 5,
            fast_ema: 20,
            slow_ema: 60,
            atr_period: 14,
            impulse_bars: 3,
            impulse_atr: 1.5,
            min_efficiency: 0.6,
            min_pullback_bars: 2,
            max_pullback_bars: 8,
            min_retracement: 0.2,
            max_retracement: 0.5,
            breakout_bars: 20,
            stop_atr: 1.5,
            max_stop_atr: 3.0,
            break_even_r: 1.0,
            trailing_start_r: 2.0,
            trailing_atr: 2.0,
            cooldown_losses: 3,
            cooldown_minutes: 60,
            daily_loss_pct: 0.03,
            flatten_minute: Some(1437),
        }
    }
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        let values = [
            self.initial_capital,
            self.risk_pct,
            self.max_exposure_pct,
            self.fee_bps,
            self.slippage_bps,
            self.tick_size,
            self.quantity_step,
            self.min_notional,
            self.impulse_atr,
            self.min_efficiency,
            self.min_retracement,
            self.max_retracement,
            self.stop_atr,
            self.max_stop_atr,
            self.break_even_r,
            self.trailing_start_r,
            self.trailing_atr,
            self.daily_loss_pct,
        ];
        if values.iter().any(|v| !v.is_finite())
            || !["pullback", "breakout"].contains(&self.entry.as_str())
            || !["both", "long", "short"].contains(&self.direction.as_str())
            || self.initial_capital <= 0.0
            || self.initial_capital > 1e12
            || self.risk_pct <= 0.0
            || self.risk_pct > 0.05
            || self.max_exposure_pct <= 0.0
            || self.max_exposure_pct > 1.0
            || !(0.0..=100.0).contains(&self.fee_bps)
            || !(0.0..=100.0).contains(&self.slippage_bps)
            || self.tick_size <= 0.0
            || self.quantity_step <= 0.0
            || self.min_notional < 0.0
            || ![1, 3, 5, 15, 30, 60, 120, 240, 1440].contains(&self.trade_minutes)
            || ![1, 3, 5, 15, 30, 60, 120, 240, 1440].contains(&self.trend_minutes)
            || self.trend_minutes < self.trade_minutes
            || !(2..=200).contains(&self.fast_ema)
            || self.slow_ema <= self.fast_ema
            || self.slow_ema > 200
            || !(2..=100).contains(&self.atr_period)
            || !(2..=20).contains(&self.impulse_bars)
            || !(2..=250).contains(&self.breakout_bars)
            || self.impulse_atr <= 0.0
            || self.impulse_atr > 10.0
            || !(0.0..=1.0).contains(&self.min_efficiency)
            || self.min_pullback_bars == 0
            || self.min_pullback_bars > 60
            || self.max_pullback_bars < self.min_pullback_bars
            || self.max_pullback_bars > 120
            || self.min_retracement < 0.0
            || self.max_retracement <= self.min_retracement
            || self.max_retracement >= 1.0
            || self.stop_atr <= 0.0
            || self.max_stop_atr < self.stop_atr
            || self.max_stop_atr > 20.0
            || self.break_even_r < 0.0
            || self.trailing_start_r <= 0.0
            || self.trailing_start_r < self.break_even_r
            || self.trailing_atr <= 0.0
            || self.trailing_atr > 20.0
            || self.cooldown_losses > 20
            || self.cooldown_minutes > 1440
            || !(0.0..=0.5).contains(&self.daily_loss_pct)
            || self.flatten_minute.is_some_and(|v| v == 0 || v > 1439)
            || (self.trade_minutes == 1440 && self.flatten_minute.is_some())
        {
            return Err("invalid trend strategy configuration".into());
        }
        Ok(())
    }
}

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
