//! Input checks shared by account replay and independent market observation.
//! These functions validate only; callers own their clocks and lifecycle.
use super::model::{Bar, DAY, MAX_WARMUP_DAYS, MINUTE};

pub(super) const BROWSER_MAX_DAYS: u64 = 730;
#[cfg(not(target_arch = "wasm32"))]
pub(super) const RESEARCH_MAX_DAYS: u64 = 1096;

pub(super) fn validate_window(
    start: u64,
    end: u64,
    warmup: u64,
    maximum_days: u64,
) -> Result<(), &'static str> {
    if start % MINUTE != 0
        || end % MINUTE != 0
        || warmup % MINUTE != 0
        || warmup > start
        || start >= end
        || end - start > maximum_days * DAY
        || start - warmup > MAX_WARMUP_DAYS * DAY
        || start < 1_000_000_000_000
    {
        return Err("invalid minute backtest window");
    }
    Ok(())
}

pub(super) fn validate_ohlc(bar: Bar) -> Result<(), &'static str> {
    if [bar.open, bar.high, bar.low, bar.close]
        .iter()
        .any(|p| !p.is_finite() || *p <= 0.0)
        || bar.high < bar.open.max(bar.close)
        || bar.low > bar.open.min(bar.close)
    {
        return Err("invalid traded or mark candle");
    }
    Ok(())
}

pub(super) fn validate_minute(bar: Bar, expected: u64, end: u64) -> Result<(), &'static str> {
    if bar.time != expected || bar.time >= end {
        return Err("minute input must be complete, chronological and aligned with the window");
    }
    validate_ohlc(bar)
}
