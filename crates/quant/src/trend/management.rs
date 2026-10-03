use super::config::{Execution, Strategy};
use super::model::*;
use super::position::{Position, Stages};
use std::collections::VecDeque;

/// Completed-candle exit history, independent of the entry signal history.
#[derive(Default)]
pub struct ChannelExit {
    history: VecDeque<Bar>,
}
impl ChannelExit {
    /// Compare this close with PREVIOUS completed candles before appending it.
    /// Returns an exit intent, filled at the following minute open by Engine.
    pub fn close(
        &mut self,
        close: TradingClose,
        position: Option<(usize, Side)>,
        window: usize,
    ) -> Option<ExitIntent> {
        let bar = close.bar;
        let exit = if self.history.len() >= window {
            position.is_some_and(|(_, side)| {
                let extreme = self
                    .history
                    .iter()
                    .rev()
                    .take(window)
                    .map(|b| if side == Side::Long { b.low } else { b.high })
                    .fold(
                        if side == Side::Long {
                            f64::INFINITY
                        } else {
                            f64::NEG_INFINITY
                        },
                        |a, b| {
                            if side == Side::Long {
                                a.min(b)
                            } else {
                                a.max(b)
                            }
                        },
                    );
                side.sign() * (bar.close - extreme) < 0.0
            })
        } else {
            false
        };
        self.history.push_back(bar);
        while self.history.len() > window {
            self.history.pop_front();
        }
        exit.then(|| ExitIntent {
            position_id: position.expect("exit requires a position").0,
            triggered_at: close.time,
            execute_at: close.time + 1,
            reason: ExitReason::Channel,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bar(close: f64) -> TradingClose {
        TradingClose {
            time: MINUTE - 1,
            atr: 1.0,
            bar: Bar {
                time: 0,
                open: close,
                high: close + 1.0,
                low: close - 1.0,
                close,
                volume: 0.0,
            },
        }
    }
    #[test]
    fn exit_uses_previous_closed_channel_and_is_symmetric() {
        for side in [Side::Long, Side::Short] {
            let mut channel = ChannelExit::default();
            for _ in 0..10 {
                assert!(channel.close(bar(100.0), Some((1, side)), 10).is_none());
            }
            assert!(channel.close(bar(100.0), Some((1, side)), 10).is_none());
            assert!(channel
                .close(bar(100.0 - side.sign() * 2.0), Some((1, side)), 10)
                .is_some());
        }
    }
    #[test]
    fn history_updates_while_flat_and_equality_is_not_a_break() {
        let mut channel = ChannelExit::default();
        for _ in 0..10 {
            assert!(channel.close(bar(100.0), None, 10).is_none());
        }
        assert!(channel
            .close(bar(99.0), Some((1, Side::Long)), 10)
            .is_none());
        assert_eq!(channel.history.len(), 10);
    }
}

/// A pure proposal. Only Engine commits it after checking the old stop.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StopUpdate {
    pub price: f64,
    pub reason: &'static str,
}
pub fn protection_decision(
    p: &Position,
    close: MinuteClose,
    strategy: &Strategy,
    execution: &Execution,
) -> Option<StopUpdate> {
    // Channel management keeps the hard initial stop. Only completed trading
    // candles can request a channel exit; minute noise cannot tighten it.
    if strategy.management != "atr" {
        return None;
    }
    let mut stop = p.stop;
    let mut reason = p.stop_reason;
    if strategy.break_even_atr > 0.0 && p.mfe >= strategy.break_even_atr * p.signal_atr {
        let target = break_even_stop(p, execution);
        if p.side.sign() * (target - stop) > 0.0
            && p.side.sign() * (close.0.close - target) > execution.tick_size
        {
            stop = target;
            reason = "breakeven";
        }
    }
    {
        let target = p.entry + p.side.sign() * (p.mfe - strategy.trailing_atr * p.signal_atr);
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
        return Some(StopUpdate {
            price: stop,
            reason,
        });
    }
    None
}

fn break_even_stop(p: &Position, execution: &Execution) -> f64 {
    let cost = (p.entry_fee + p.funding) / p.quantity;
    // The required *fill* must lie on the price grid before inverting
    // slippage. Rounding only the raw stop can leave a net loss when the
    // eventual sell fill is rounded down a second time.
    if p.side == Side::Long {
        let required_fill = execution.ceil((p.entry + cost) / (1.0 - execution.fee()));
        execution.ceil(required_fill / (1.0 - execution.slip())) + execution.tick_size
    } else {
        let required_fill = execution.floor((p.entry - cost) / (1.0 + execution.fee()));
        execution.floor(required_fill / (1.0 + execution.slip())) - execution.tick_size
    }
}

/// Staged rules are evaluated only after the full strategy candle and its ATR
/// have closed. Initial R stays frozen; trailing distance uses this close's ATR.
pub struct StagedDecision {
    pub stages: Stages,
    pub stop: Option<StopUpdate>,
    pub exit: Option<ExitIntent>,
    pub close_r: f64,
}
pub fn staged_decision(
    p: &Position,
    close: TradingClose,
    strategy: &Strategy,
    execution: &Execution,
) -> StagedDecision {
    let policy = strategy
        .staged
        .as_ref()
        .expect("validated staged management");
    let close_r = p.side.sign() * (close.bar.close - p.entry) / p.initial_distance;
    let stages = Stages {
        break_even: p.stages.break_even
            || (policy.break_even_r > 0.0 && close_r >= policy.break_even_r),
        trailing: p.stages.trailing || close_r >= policy.trailing_start_r,
    };
    let mut price = p.stop;
    let mut reason = p.stop_reason;
    if stages.break_even {
        let target = break_even_stop(p, execution);
        if p.side.sign() * (target - price) > 0.0 {
            price = target;
            reason = "breakeven";
        }
    }
    if stages.trailing {
        let target = dynamic_trailing_price(p, close.atr, strategy, execution);
        if p.side.sign() * (target - price) > 0.0 {
            price = target;
            reason = "trailing";
        }
    }
    let stop = (p.side.sign() * (price - p.stop) > execution.tick_size * 0.5)
        .then_some(StopUpdate { price, reason });
    let exit = stop
        .filter(|s| p.side.sign() * (s.price - close.bar.close) >= 0.0)
        .map(|_| ExitIntent {
            position_id: p.id,
            triggered_at: close.time,
            execute_at: close.time + 1,
            reason: ExitReason::ProtectionCrossed,
        });
    StagedDecision {
        stages,
        stop,
        exit,
        close_r,
    }
}

/// The same dynamic ATR formula as staged management, without an R gate or BE.
fn dynamic_trailing_price(
    p: &Position,
    atr: f64,
    strategy: &Strategy,
    execution: &Execution,
) -> f64 {
    let target = p.entry + p.side.sign() * (p.mfe - strategy.trailing_atr * atr);
    if p.side == Side::Long {
        execution.floor(target)
    } else {
        execution.ceil(target)
    }
}
pub fn chandelier_decision(
    p: &Position,
    close: TradingClose,
    strategy: &Strategy,
    execution: &Execution,
) -> StagedDecision {
    let target = dynamic_trailing_price(p, close.atr, strategy, execution);
    let stop =
        (p.side.sign() * (target - p.stop) > execution.tick_size * 0.5).then_some(StopUpdate {
            price: target,
            reason: "trailing",
        });
    let exit = stop
        .filter(|s| p.side.sign() * (s.price - close.bar.close) >= 0.0)
        .map(|_| ExitIntent {
            position_id: p.id,
            triggered_at: close.time,
            execute_at: close.time + 1,
            reason: ExitReason::ProtectionCrossed,
        });
    StagedDecision {
        stages: Stages {
            break_even: false,
            trailing: true,
        },
        stop,
        exit,
        close_r: p.side.sign() * (close.bar.close - p.entry) / p.initial_distance,
    }
}
