use super::config::{Execution, Strategy};
use super::model::*;

#[derive(Clone)]
pub struct Position {
    pub id: usize,
    pub side: Side,
    pub time: u64,
    pub entry: f64,
    pub quantity: f64,
    pub initial_stop: f64,
    pub stop: f64,
    pub distance: f64,
    pub atr: f64,
    pub entry_fee: f64,
    pub funding: f64,
    pub mfe: f64,
    pub mae: f64,
    pub stop_reason: &'static str,
}
pub fn update_protection(
    p: &mut Position,
    bar: Bar,
    strategy: &Strategy,
    execution: &Execution,
) -> Option<&'static str> {
    let favourable = if p.side == Side::Long {
        bar.high - p.entry
    } else {
        p.entry - bar.low
    };
    let adverse = if p.side == Side::Long {
        p.entry - bar.low
    } else {
        bar.high - p.entry
    };
    p.mfe = p.mfe.max(favourable);
    p.mae = p.mae.max(adverse);
    // Channel management keeps the hard initial stop. Only completed trading
    // candles can request a channel exit; minute noise cannot tighten it.
    if strategy.management == "channel" {
        return None;
    }
    let mut stop = p.stop;
    let mut reason = p.stop_reason;
    if strategy.break_even_atr > 0.0 && p.mfe >= strategy.break_even_atr * p.atr {
        // Entry slippage is already in p.entry. Cover entry/exit fees,
        // accumulated funding, estimated exit slippage and one rounding tick.
        let cost = (p.entry_fee + p.funding) / p.quantity;
        let target = if p.side == Side::Long {
            execution.ceil((p.entry + cost) / ((1.0 - execution.fee()) * (1.0 - execution.slip())))
                + execution.tick_size
        } else {
            execution.floor((p.entry - cost) / ((1.0 + execution.fee()) * (1.0 + execution.slip())))
                - execution.tick_size
        };
        if p.side.sign() * (target - stop) > 0.0
            && p.side.sign() * (bar.close - target) > execution.tick_size
        {
            stop = target;
            reason = "breakeven";
        }
    }
    {
        let target = p.entry + p.side.sign() * (p.mfe - strategy.trailing_atr * p.atr);
        let rounded = if p.side == Side::Long {
            execution.floor(target)
        } else {
            execution.ceil(target)
        };
        if p.side.sign() * (rounded - stop) > 0.0 {
            stop = rounded;
            reason = "trailing";
        }
    }
    if p.side.sign() * (stop - p.stop) > execution.tick_size * 0.5 {
        p.stop = stop;
        p.stop_reason = reason;
        return Some(reason);
    }
    None
}
