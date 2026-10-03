use super::model::{Bar, Side};
use std::collections::VecDeque;

/// One exit window derived from the entry horizon; no extra tuning parameter.
#[derive(Default)]
pub struct ChannelExit {
    history: VecDeque<Bar>,
}
impl ChannelExit {
    /// Compare this close with PREVIOUS completed candles before appending it.
    /// Returns an exit intent, filled at the following minute open by Engine.
    pub fn close(&mut self, bar: Bar, side: Option<Side>, entry_bars: usize) -> bool {
        let window = (entry_bars / 2).max(1);
        let exit = if self.history.len() >= window {
            side.is_some_and(|side| {
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
        exit
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn bar(close: f64) -> Bar {
        Bar {
            time: 0,
            open: close,
            high: close + 1.0,
            low: close - 1.0,
            close,
            volume: 0.0,
        }
    }
    #[test]
    fn exit_uses_previous_closed_channel_and_is_symmetric() {
        for side in [Side::Long, Side::Short] {
            let mut channel = ChannelExit::default();
            for _ in 0..10 {
                assert!(!channel.close(bar(100.0), Some(side), 20));
            }
            assert!(!channel.close(bar(100.0), Some(side), 20));
            assert!(channel.close(bar(100.0 - side.sign() * 2.0), Some(side), 20));
        }
    }
    #[test]
    fn history_updates_while_flat_and_equality_is_not_a_break() {
        let mut channel = ChannelExit::default();
        for _ in 0..10 {
            assert!(!channel.close(bar(100.0), None, 20));
        }
        assert!(!channel.close(bar(99.0), Some(Side::Long), 20));
        assert_eq!(channel.history.len(), 10);
    }
}
