use super::super::model::Side;
use super::{bar, config, history, position, replay, update_protection, BASE};

#[test]
fn breakeven_long_covers_the_final_sell_rounding_boundary() {
    let mut c = config();
    c.strategy.break_even_atr = 1.0;
    c.strategy.trailing_atr = 20.0;
    c.execution.fee_bps = 5.0;
    c.execution.slippage_bps = 3.0;
    c.execution.tick_size = 0.01;
    let mut p = position(Side::Long);
    p.entry = c.execution.fill(33.27, true).unwrap();
    p.signal_atr = 0.01;
    p.initial_stop = 33.25;
    p.stop = p.initial_stop;
    p.initial_distance = p.entry - p.initial_stop;
    p.entry_fee = p.entry * c.execution.fee();
    p.funding = 0.006_700_999_5;
    assert_eq!(p.entry, 33.28);
    let observed = bar(1, 33.39, 33.39);
    assert_eq!(
        update_protection(&mut p, observed, &c.strategy, &c.execution),
        Some("breakeven")
    );
    let exit = c.execution.fill(p.stop, false).unwrap();
    let net = exit - p.entry - p.entry_fee - exit * c.execution.fee() - p.funding;
    assert!(
        net >= -1e-12,
        "a no-gap breakeven stop must cover costs: stop={}, fill={exit}, net={net}",
        p.stop
    );
}

#[test]
fn breakeven_covers_signed_funding_and_costs_without_recharging_entry_slippage() {
    for side in [Side::Long, Side::Short] {
        for funding in [-0.37, 0.0, 0.37] {
            for tick in [0.01, 0.03] {
                let mut c = config();
                c.strategy.break_even_atr = 1.0;
                c.strategy.trailing_atr = 20.0;
                c.execution.fee_bps = 7.0;
                c.execution.slippage_bps = 3.0;
                c.execution.tick_size = tick;
                let mut p = position(side);
                p.quantity = 2.5;
                p.entry = c.execution.fill(100.0, side == Side::Long).unwrap();
                p.entry_fee = p.entry * p.quantity * c.execution.fee();
                p.entry_slippage_and_rounding = side.sign() * (p.entry - 100.0) * p.quantity;
                p.funding = funding;
                let mut without_diagnostic = p.clone();
                without_diagnostic.entry_slippage_and_rounding = 0.0;
                let price = p.entry + side.sign() * 6.0;
                let observed = bar(1, price, price);
                assert_eq!(
                    update_protection(&mut p, observed, &c.strategy, &c.execution),
                    Some("breakeven")
                );
                update_protection(&mut without_diagnostic, observed, &c.strategy, &c.execution);
                // Entry fill already incorporates this diagnostic cost; it is not an extra debit.
                assert_eq!(p.stop, without_diagnostic.stop);
                let exit = c.execution.fill(p.stop, side == Side::Short).unwrap();
                let exit_fee = exit * p.quantity * c.execution.fee();
                let net =
                    side.sign() * (exit - p.entry) * p.quantity - p.entry_fee - exit_fee - funding;
                assert!(
                    net >= -1e-10,
                    "{side:?}, funding={funding}, tick={tick}: {net}"
                );
                let gross_before_slippage = side.sign() * (p.stop - 100.0) * p.quantity;
                let slippage =
                    p.entry_slippage_and_rounding + side.sign() * (p.stop - exit) * p.quantity;
                assert!(
                    (gross_before_slippage - slippage - p.entry_fee - exit_fee - funding - net)
                        .abs()
                        < 1e-10
                );
            }
        }
    }
}

#[test]
fn breakeven_uses_post_entry_mfe_even_when_close_has_not_reached_one_r() {
    for side in [Side::Long, Side::Short] {
        let mut c = config();
        c.strategy.break_even_atr = 1.0;
        c.strategy.trailing_atr = 20.0;
        let mut p = position(side);
        p.entry_fee = p.entry * c.execution.fee();
        p.funding = 0.02;
        let mut observed = bar(1, p.entry, p.entry + side.sign() * 0.5);
        if side == Side::Long {
            observed.high = p.entry + 2.5;
        } else {
            observed.low = p.entry - 2.5;
        }
        let close_r = side.sign() * (observed.close - p.entry) / p.initial_distance;
        assert!(close_r < 0.1);
        assert_eq!(
            update_protection(&mut p, observed, &c.strategy, &c.execution),
            Some("breakeven")
        );
        assert!(p.mfe >= p.signal_atr);
        assert!(p.mfe < p.initial_distance);
    }
}

#[test]
fn protection_stays_monotone_after_funding_changes_and_preserves_the_initial_risk_scale() {
    for side in [Side::Long, Side::Short] {
        let mut c = config();
        c.strategy.break_even_atr = 1.0;
        c.strategy.trailing_atr = 20.0;
        let mut p = position(side);
        p.entry_fee = p.entry * c.execution.fee();
        let initial = (p.initial_stop, p.initial_distance, p.signal_atr);
        let observed = bar(1, p.entry + side.sign() * 3.0, p.entry + side.sign() * 3.0);
        assert_eq!(
            update_protection(&mut p, observed, &c.strategy, &c.execution),
            Some("breakeven")
        );
        let first = p.stop;
        p.funding += 0.5;
        update_protection(&mut p, observed, &c.strategy, &c.execution);
        let paid = p.stop;
        assert!(side.sign() * (paid - first) > 0.0);
        p.funding = -0.5;
        update_protection(&mut p, observed, &c.strategy, &c.execution);
        assert_eq!(
            p.stop, paid,
            "funding receipts must not loosen an already improved stop"
        );
        assert_eq!((p.initial_stop, p.initial_distance, p.signal_atr), initial);
    }
}

#[test]
fn the_signal_candles_extreme_cannot_become_post_entry_mfe() {
    for short in [false, true] {
        let mut bars = history(short);
        let mut c = config();
        c.strategy.break_even_atr = 1.0;
        // This extreme belongs to the completed signal candle, before the next-open entry.
        if short {
            bars[65].low = 50.0;
        } else {
            bars[65].high = 150.0;
        }
        let (_, out) = replay(c, &bars, vec![], false);
        assert_eq!(out.trades.len(), 1);
        let trade = &out.trades[0];
        assert_eq!(trade.entry_time, BASE + 66 * super::super::model::MINUTE);
        let entry_index = ((trade.entry_time - BASE) / super::super::model::MINUTE) as usize;
        let observed_mfe = bars[entry_index..]
            .iter()
            .map(|bar| {
                if short {
                    trade.entry_price - bar.low
                } else {
                    bar.high - trade.entry_price
                }
            })
            .fold(0.0, f64::max);
        let recorded_mfe = trade.mfe_r * trade.risk / trade.quantity;
        assert!((recorded_mfe - observed_mfe).abs() < 1e-10);
        assert!(observed_mfe < trade.entry_signal.atr);
        assert!(!out
            .events
            .iter()
            .any(|event| event.kind == "stop" && event.reason != "initial"));
    }
}
