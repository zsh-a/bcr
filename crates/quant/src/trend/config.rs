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
pub const BACKGROUND_WINDOW: usize = 20;
pub const BACKGROUND_EMA: usize = 20;
pub const BACKGROUND_SLOPE: usize = 3;
pub const BACKGROUND_MIN_EFFICIENCY: f64 = 0.3;
pub const LEGACY_BACKGROUND_MAX_COST_ATR: f64 = 0.5;

/// Normalized once at the input boundary; the minute engine does not interpret
/// historical configuration versions or optional serialized fields.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum CostPolicy {
    Disabled,
    Independent { max_atr: f64 },
    LegacyBackground { max_atr: f64 },
}
impl CostPolicy {
    pub fn rejects_background(self, cost_atr: Option<f64>) -> bool {
        matches!(self, Self::LegacyBackground { max_atr }
            if cost_atr.is_none_or(|cost| cost > max_atr))
    }
    pub fn rejects_entry(self, cost_atr: Option<f64>) -> bool {
        matches!(self, Self::Independent { max_atr }
            if cost_atr.is_none_or(|cost| cost > max_atr))
    }
}

pub fn background_minutes(trade_minutes: usize) -> usize {
    match trade_minutes {
        1 => 5,
        3 => 15,
        5 => 30,
        15 => 60,
        30 => 120,
        60 => 240,
        120 => 720,
        240 => 1440,
        1440 => 10080,
        _ => unreachable!("validated trading period"),
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Strategy {
    pub entry: String,
    pub filter: String,
    pub management: String,
    pub direction: String,
    pub trade_minutes: usize,
    pub breakout_bars: usize,
    pub stop_atr: f64,
    pub break_even_atr: f64,
    pub trailing_atr: f64,
    /// Version 5 makes trading costs an independent entry policy; zero disables it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_cost_atr: Option<f64>,
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
            version: 5,
            strategy: Strategy {
                entry: "breakout".into(),
                filter: "background".into(),
                management: "channel".into(),
                direction: "long".into(),
                trade_minutes: 240,
                breakout_bars: 20,
                stop_atr: 2.0,
                break_even_atr: 0.0,
                trailing_atr: 2.0,
                max_cost_atr: Some(0.0),
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
    /// Matches quant-core's trendWarmupDays. Requests begin on UTC day boundaries;
    /// the extra higher-period candle also covers an incomplete first week.
    pub fn warmup_days(&self) -> u64 {
        let s = &self.strategy;
        let entry_bars = if s.entry == "breakout" {
            s.breakout_bars
        } else {
            IMPULSE_BARS
        };
        let filter_bars = if s.filter == "ema" { SLOW_EMA } else { 0 };
        let trade_minutes = ATR_PERIOD.max(entry_bars).max(filter_bars) * s.trade_minutes;
        let context_minutes = if s.filter == "background" {
            (BACKGROUND_WINDOW + 2) * background_minutes(s.trade_minutes)
        } else {
            0
        };
        trade_minutes.max(context_minutes).div_ceil(1440).max(1) as u64
    }

    pub(crate) fn cost_policy(&self) -> Result<CostPolicy, String> {
        self.validate()?;
        Ok(if self.version == 4 {
            if self.strategy.filter == "background" {
                CostPolicy::LegacyBackground {
                    max_atr: LEGACY_BACKGROUND_MAX_COST_ATR,
                }
            } else {
                CostPolicy::Disabled
            }
        } else {
            match self
                .strategy
                .max_cost_atr
                .expect("validated v5 cost policy")
            {
                0.0 => CostPolicy::Disabled,
                max_atr => CostPolicy::Independent { max_atr },
            }
        })
    }

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
        if ![4, 5].contains(&self.version)
            || (self.version == 4 && s.max_cost_atr.is_some())
            || (self.version == 5 && s.max_cost_atr.is_none())
            || s.max_cost_atr
                .is_some_and(|v| !v.is_finite() || !(0.0..=20.0).contains(&v))
            || values.iter().any(|v| !v.is_finite())
            || !["pullback", "breakout"].contains(&s.entry.as_str())
            || !["none", "ema", "background"].contains(&s.filter.as_str())
            || !["atr", "channel"].contains(&s.management.as_str())
            || (s.management == "channel" && s.entry != "breakout")
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
