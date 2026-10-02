use serde::{Deserialize, Serialize};

pub const ATR_PERIOD: usize = 14;
pub const FAST_EMA: usize = 20;
pub const SLOW_EMA: usize = 60;
pub const IMPULSE_BARS: usize = 3;
pub const IMPULSE_ATR: f64 = 1.5;
pub const MIN_EFFICIENCY: f64 = 0.6;
pub const MIN_PULLBACK_BARS: usize = 2;
pub const MAX_PULLBACK_BARS: usize = 8;
pub const MIN_RETRACEMENT: f64 = 0.2;
pub const MAX_RETRACEMENT: f64 = 0.5;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Strategy {
    pub entry: String,
    pub filter: String,
    pub direction: String,
    pub trade_minutes: usize,
    pub breakout_bars: usize,
    pub stop_atr: f64,
    pub break_even_atr: f64,
    pub trailing_atr: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Execution {
    pub initial_capital: f64,
    pub fee_bps: f64,
    pub slippage_bps: f64,
    pub tick_size: f64,
    pub quantity_step: f64,
    pub min_notional: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Risk {
    pub risk_pct: f64,
    pub max_exposure_pct: f64,
    pub cooldown_losses: usize,
    pub cooldown_minutes: u64,
    pub daily_loss_pct: f64,
    pub flatten_minute: Option<u16>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub version: u8,
    pub strategy: Strategy,
    pub execution: Execution,
    pub risk: Risk,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            version: 2,
            strategy: Strategy {
                entry: "breakout".into(),
                filter: "none".into(),
                direction: "both".into(),
                trade_minutes: 1,
                breakout_bars: 20,
                stop_atr: 1.5,
                break_even_atr: 1.5,
                trailing_atr: 2.0,
            },
            execution: Execution {
                initial_capital: 10_000.0,
                fee_bps: 5.0,
                slippage_bps: 2.0,
                tick_size: 0.1,
                quantity_step: 0.001,
                min_notional: 100.0,
            },
            risk: Risk {
                risk_pct: 0.005,
                max_exposure_pct: 0.95,
                cooldown_losses: 3,
                cooldown_minutes: 60,
                daily_loss_pct: 0.03,
                flatten_minute: None,
            },
        }
    }
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        let s = &self.strategy;
        let e = &self.execution;
        let r = &self.risk;
        let values = [
            e.initial_capital,
            e.fee_bps,
            e.slippage_bps,
            e.tick_size,
            e.quantity_step,
            e.min_notional,
            r.risk_pct,
            r.max_exposure_pct,
            r.daily_loss_pct,
            s.stop_atr,
            s.break_even_atr,
            s.trailing_atr,
        ];
        if self.version != 2
            || values.iter().any(|v| !v.is_finite())
            || !["pullback", "breakout"].contains(&s.entry.as_str())
            || !["none", "ema"].contains(&s.filter.as_str())
            || !["both", "long", "short"].contains(&s.direction.as_str())
            || ![1, 3, 5, 15, 30, 60, 120, 240, 1440].contains(&s.trade_minutes)
            || !(2..=250).contains(&s.breakout_bars)
            || s.stop_atr <= 0.0
            || s.stop_atr > 20.0
            || !(0.0..=20.0).contains(&s.break_even_atr)
            || s.trailing_atr <= 0.0
            || s.trailing_atr > 20.0
            || e.initial_capital <= 0.0
            || e.initial_capital > 1e12
            || !(0.0..=100.0).contains(&e.fee_bps)
            || !(0.0..=100.0).contains(&e.slippage_bps)
            || e.tick_size <= 0.0
            || e.quantity_step <= 0.0
            || e.min_notional < 0.0
            || r.risk_pct <= 0.0
            || r.risk_pct > 0.05
            || r.max_exposure_pct <= 0.0
            || r.max_exposure_pct > 1.0
            || r.cooldown_losses > 20
            || r.cooldown_minutes > 1440
            || (r.cooldown_losses > 0 && r.cooldown_minutes == 0)
            || !(0.0..=0.5).contains(&r.daily_loss_pct)
            || r.flatten_minute.is_some_and(|v| v == 0 || v > 1439)
            || (s.trade_minutes == 1440 && r.flatten_minute.is_some())
        {
            return Err("invalid trend configuration: strategy, execution or risk policy".into());
        }
        Ok(())
    }
}
