use super::{bar, config, history, replay, BASE};
use crate::trend::{
    config::Config,
    model::{Bar, Side, MINUTE},
};

fn mirror(bars: &mut [Bar]) {
    for b in bars {
        *b = Bar {
            open: 200.0 - b.open,
            close: 200.0 - b.close,
            high: 200.0 - b.low,
            low: 200.0 - b.high,
            ..*b
        };
    }
}

fn breakout_config(minutes: usize) -> Config {
    let mut c = config();
    c.strategy.entry = "breakout".into();
    c.strategy.management = "channel".into();
    c.strategy.trade_minutes = minutes;
    c.strategy.breakout_bars = 20;
    c.strategy.stop_atr = 2.0;
    c.execution.fee_bps = 0.0;
    c.execution.slippage_bps = 0.0;
    c
}

#[test]
fn stopped_position_cannot_reuse_a_signal_before_the_next_completed_candle() {
    for short in [false, true] {
        let mut bars: Vec<_> = (0..115)
            .map(|i| {
                let price = if i < 100 {
                    100.0
                } else if i < 107 {
                    101.0
                } else {
                    102.0
                };
                let mut b = bar(i, price, price);
                b.high = price + 0.1;
                b.low = price - 0.1;
                b
            })
            .collect();
        // The first new position is stopped in the middle of its 5-minute candle.
        bars[106].low = 100.0;
        if short {
            mirror(&mut bars);
        }
        let (_, out) = replay(breakout_config(5), &bars, vec![], true);
        let entries: Vec<_> = out.events.iter().filter(|e| e.kind == "entry").collect();
        assert_eq!(
            entries.len(),
            2,
            "{}",
            serde_json::to_string(&out.events).unwrap()
        );
        assert_eq!(entries[0].time, bars[105].time);
        assert_eq!(entries[1].time, bars[110].time);
        assert_eq!(out.trades[0].reason, "initial");
        assert_eq!(out.trades[0].exit_time, bars[106].time + MINUTE - 1);
        assert_eq!(out.trades[0].entry_signal.time, bars[104].time + MINUTE - 1);
        assert_eq!(out.trades[1].entry_signal.time, bars[109].time + MINUTE - 1);
        assert_ne!(
            out.trades[0].entry_signal.time,
            out.trades[1].entry_signal.time
        );
        assert!(entries
            .iter()
            .all(|e| e.side == if short { Side::Short } else { Side::Long }));
    }
}

#[test]
fn trailing_stop_above_or_below_close_fills_only_at_the_next_actual_open() {
    for short in [false, true] {
        let mut bars = history(false);
        bars[66].high = 110.0;
        for (i, b) in bars.iter_mut().enumerate().skip(67) {
            *b = bar(i, 105.0, 105.0);
        }
        if short {
            mirror(&mut bars);
        }
        let mut c = config();
        c.strategy.trailing_atr = 2.0;
        let execution = c.execution.clone();
        let (_, out) = replay(c, &bars, vec![], true);
        assert_eq!(out.trades.len(), 1);
        let trade = &out.trades[0];
        let stop = out
            .events
            .iter()
            .find(|e| e.kind == "stop" && e.reason == "trailing")
            .unwrap();
        assert_eq!(stop.time, bars[66].time + MINUTE - 1);
        assert!(trade.side.sign() * (stop.price - bars[66].close) > 0.0);
        assert_eq!(trade.reason, "trailing");
        assert_eq!(trade.exit_time, bars[67].time);
        assert_eq!(
            trade.exit_price,
            execution.fill(bars[67].open, short).unwrap()
        );
        assert!(trade.side.sign() * (trade.exit_price - stop.price) < 0.0);
    }
}

#[test]
fn a_favorable_opening_gap_back_across_the_new_stop_does_not_lock_a_market_exit() {
    for short in [false, true] {
        let mut bars = history(false);
        bars[66].high = 110.0;
        for (i, b) in bars.iter_mut().enumerate().skip(67) {
            *b = bar(i, 111.0, 111.0);
        }
        if short {
            mirror(&mut bars);
        }
        let mut c = config();
        c.strategy.trailing_atr = 2.0;
        let (_, out) = replay(c, &bars, vec![], true);
        assert_eq!(out.trades.len(), 1);
        let trade = &out.trades[0];
        let stop = out
            .events
            .iter()
            .find(|e| e.kind == "stop" && e.reason == "trailing")
            .unwrap();
        assert_eq!(stop.time, bars[66].time + MINUTE - 1);
        assert!(trade.side.sign() * (stop.price - bars[66].close) > 0.0);
        // Protection becomes active next minute; crossing the prior close does
        // not create a separate, irrevocable market-on-open exit instruction.
        assert!(trade.side.sign() * (bars[67].open - stop.price) > 0.0);
        assert_eq!(trade.reason, "end-range");
        assert_eq!(trade.exit_time, bars.last().unwrap().time + MINUTE - 1);
    }
}

#[test]
fn quantities_below_exchange_minimums_are_rejected_without_fees_or_a_tighter_stop() {
    for short in [false, true] {
        for minimum_quantity in [false, true] {
            let mut c = config();
            if minimum_quantity {
                c.execution.quantity_step = 1_000.0;
            } else {
                c.execution.min_notional = 1_000_000_000.0;
            }
            let capital = c.execution.initial_capital;
            let (metrics, out) = replay(c, &history(short), vec![], true);
            assert_eq!(metrics.trades, 0);
            assert_eq!(metrics.fees, 0.0);
            assert_eq!(metrics.final_equity, capital);
            assert_eq!(metrics.rejected_signals, 1);
            assert!(out
                .events
                .iter()
                .any(|e| e.kind == "rejected" && e.reason == "risk-budget"));
            assert!(!out
                .events
                .iter()
                .any(|e| e.kind == "entry" || e.kind == "stop"));
        }
    }
}

fn quantity_boundary_case(short: bool) -> (Config, Vec<Bar>) {
    let mut c = breakout_config(1);
    c.execution.initial_capital = 100.0;
    c.execution.tick_size = 0.1;
    c.execution.quantity_step = 0.1;
    c.execution.min_notional = 25.0;
    c.risk.risk_pct = 0.05;
    c.risk.max_exposure_pct = 0.3;
    let mut bars: Vec<_> = (0..82)
        .map(|i| {
            let mut b = bar(i, 95.0, 95.0);
            b.high = 95.1;
            b.low = 94.9;
            b
        })
        .collect();
    bars[80] = Bar {
        high: 100.0,
        low: 94.9,
        ..bar(80, 95.0, 100.0)
    };
    bars[81] = Bar {
        high: 100.1,
        low: 99.9,
        ..bar(81, 100.0, 100.0)
    };
    if short {
        mirror(&mut bars);
    }
    (c, bars)
}

#[test]
fn exact_decimal_quantity_step_keeps_the_valid_order_and_its_risk_limit() {
    for short in [false, true] {
        let (c, bars) = quantity_boundary_case(short);
        let capital = c.execution.initial_capital;
        let risk_budget = capital * c.risk.risk_pct;
        let exposure_budget = capital * c.risk.max_exposure_pct;
        let (metrics, out) = replay(c, &bars, vec![], true);
        assert_eq!(
            metrics.rejected_signals, 0,
            "exact 0.3 must not floor to 0.2 and fail min notional"
        );
        assert_eq!(out.trades.len(), 1);
        let trade = &out.trades[0];
        assert!((trade.quantity - 0.3).abs() < 1e-14);
        assert!(trade.entry_price * trade.quantity <= exposure_budget + 1e-12);
        assert!(trade.risk <= risk_budget + 1e-12);
        assert_eq!(trade.entry_time, BASE + 81 * MINUTE);
    }
}

#[test]
fn a_real_quantity_shortfall_is_not_rounded_up_to_satisfy_notional_or_step_minimums() {
    for short in [false, true] {
        for max_exposure in [0.3 - 1e-8, 0.1 - 1e-8] {
            let (mut c, bars) = quantity_boundary_case(short);
            c.risk.max_exposure_pct = max_exposure;
            if max_exposure < 0.1 {
                c.execution.min_notional = 0.0;
            }
            let (metrics, out) = replay(c, &bars, vec![], true);
            assert_eq!(metrics.rejected_signals, 1);
            assert_eq!(metrics.trades, 0);
            assert_eq!(metrics.fees, 0.0);
            assert_eq!(metrics.final_equity, 100.0);
            assert!(!out
                .events
                .iter()
                .any(|e| e.kind == "entry" || e.kind == "stop"));
        }
        let (mut c, bars) = quantity_boundary_case(short);
        c.risk.max_exposure_pct = 0.3 - 1e-8;
        c.execution.min_notional = 0.0;
        let (_, out) = replay(c, &bars, vec![], true);
        assert_eq!(out.trades.len(), 1);
        assert!((out.trades[0].quantity - 0.2).abs() < 1e-14);
    }
}
