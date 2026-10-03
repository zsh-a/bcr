use super::*;
use crate::trend::config::{Config, PriceAction as Policy};
const BASE: u64 = 1_704_067_200_000;

fn config(key_level: bool, two_legs: bool) -> Config {
    let mut c = Config::default();
    c.strategy.entry = "price-action".into();
    c.strategy.filter = "none".into();
    c.strategy.management = "atr".into();
    c.strategy.direction = "both".into();
    c.strategy.price_action = Some(Policy {
        key_level,
        two_legs,
    });
    c.strategy.trade_minutes = 1;
    c.execution.tick_size = 0.01;
    c
}
fn close(i: usize, price: f64, high: f64, low: f64, short: bool) -> TradingClose {
    let mut bar = Bar {
        time: BASE + i as u64 * MINUTE,
        open: price,
        close: price,
        high,
        low,
        volume: 1.0,
    };
    if short {
        bar = Bar {
            open: 200.0 - bar.open,
            close: 200.0 - bar.close,
            high: 200.0 - bar.low,
            low: 200.0 - bar.high,
            ..bar
        };
    }
    TradingClose {
        bar,
        time: bar.time + MINUTE - 1,
        atr: 1.0,
    }
}
fn send(
    pa: &mut PriceAction,
    c: &Config,
    bar: TradingClose,
    events: &mut Vec<Event>,
) -> Option<Candidate> {
    pa.close(
        bar,
        true,
        true,
        [true, true],
        &c.strategy,
        &c.execution,
        events,
    )
}
fn key(price: f64, confirmed_index: usize, short: bool) -> KeyLevelSnapshot {
    KeyLevelSnapshot {
        minutes: 5,
        price: if short { 200.0 - price } else { price },
        pivot_time: BASE + 3 * MINUTE,
        confirmed_at: BASE + (confirmed_index as u64 + 1) * MINUTE - 1,
        retest_time: None,
        valid: true,
    }
}
fn prepared(c: &Config, short: bool, with_key: bool) -> (PriceAction, Vec<Event>) {
    let mut pa = PriceAction::default();
    let mut events = vec![];
    if with_key {
        if short {
            pa.levels.lows.push_back(key(101.6, 8, short));
        } else {
            pa.levels.highs.push_back(key(101.6, 8, short));
        }
    }
    for i in 0..15 {
        send(&mut pa, c, close(i, 100.0, 100.1, 99.9, short), &mut events);
    }
    for (i, price) in [(15, 100.6), (16, 101.2), (17, 101.8)] {
        send(
            &mut pa,
            c,
            close(i, price, price + 0.1, price - 0.1, short),
            &mut events,
        );
    }
    assert_eq!(
        pa.setup.as_ref().unwrap().confirmed_at,
        BASE + 18 * MINUTE - 1
    );
    send(
        &mut pa,
        c,
        close(18, 102.4, 102.5, 102.2, short),
        &mut events,
    );
    (pa, events)
}
fn two_leg_rows(short: bool) -> Vec<TradingClose> {
    vec![
        close(19, 102.1, 103.0, 101.7, short),
        close(20, 101.9, 102.2, 101.6, short),
        close(21, 102.4, 102.5, 101.85, short),
        close(22, 101.7, 102.3, 101.55, short),
        close(23, 103.2, 103.3, 101.7, short),
    ]
}
fn pa_trigger(signal: EntrySignal) -> PriceActionTrigger {
    let Some(EntryTrigger::PriceAction(trigger)) = signal.trigger else {
        panic!("expected price-action trigger")
    };
    trigger
}

#[test]
fn mirrored_two_legs_retest_and_first_reversing_wick_define_auditable_whole_impulse_entry() {
    for short in [false, true] {
        let c = config(true, true);
        let (mut pa, mut events) = prepared(&c, short, true);
        let rows = two_leg_rows(short);
        let mut candidate = None;
        for (i, b) in rows.iter().enumerate() {
            let value = send(&mut pa, &c, *b, &mut events);
            if i < 4 {
                assert!(value.is_none());
            } else {
                candidate = value;
            }
        }
        let candidate = candidate.unwrap();
        let trigger = pa_trigger(candidate.entry_signal);
        assert_eq!(candidate.side, if short { Side::Short } else { Side::Long });
        assert_eq!(
            candidate.entry_signal.boundary,
            Some(if short { 97.0 } else { 103.0 })
        );
        assert_eq!(
            trigger.impulse_extreme,
            candidate.entry_signal.boundary.unwrap()
        );
        assert_eq!(trigger.impulse_start_time, BASE + 15 * MINUTE - 1);
        assert_eq!(trigger.pullback_started_at, BASE + 20 * MINUTE - 1);
        assert_eq!(trigger.pullback_bars, 5);
        assert_eq!(trigger.leg_count, 2);
        assert!((trigger.retracement - 1.45 / 3.0).abs() < 1e-12);
        let key = trigger.key_level.unwrap();
        assert!(key.confirmed_at <= trigger.impulse_start_time);
        assert!(key.valid);
        assert_eq!(key.retest_time, Some(BASE + 20 * MINUTE - 1));
        assert_eq!(pa.eligible_after, candidate.entry_signal.time);
        assert!(pa.setup.is_none());
    }
}

#[test]
fn first_break_consumes_all_ablations_and_a_later_break_cannot_reuse_the_setup() {
    for key_gate in [false, true] {
        for two_gate in [false, true] {
            let c = config(key_gate, two_gate);
            let (mut pa, mut events) = prepared(&c, false, false);
            send(
                &mut pa,
                &c,
                close(19, 102.1, 103.0, 101.7, false),
                &mut events,
            );
            let result = send(
                &mut pa,
                &c,
                close(20, 103.2, 103.3, 101.7, false),
                &mut events,
            );
            assert_eq!(result.is_some(), !key_gate && !two_gate);
            if result.is_none() {
                assert_eq!(
                    events.last().unwrap().reason,
                    if key_gate {
                        "pa-key-level-missing"
                    } else {
                        "pa-two-legs-missing"
                    }
                );
            }
            assert!(pa.setup.is_none());
            assert_eq!(pa.eligible_after, BASE + 21 * MINUTE - 1);
            assert!(send(
                &mut pa,
                &c,
                close(21, 102.0, 102.2, 101.6, false),
                &mut events
            )
            .is_none());
            assert!(send(
                &mut pa,
                &c,
                close(22, 103.5, 103.6, 102.0, false),
                &mut events
            )
            .is_none());
            assert!(
                pa.setup.is_none(),
                "both following windows still start before consumption"
            );
        }
    }
}

#[test]
fn shallow_first_break_is_consumed_instead_of_waiting_for_a_deeper_retest() {
    let c = config(false, false);
    let (mut pa, mut events) = prepared(&c, false, false);
    send(
        &mut pa,
        &c,
        close(19, 102.3, 102.4, 102.2, false),
        &mut events,
    );
    assert!(send(
        &mut pa,
        &c,
        close(20, 102.6, 102.7, 102.3, false),
        &mut events
    )
    .is_none());
    assert_eq!(events.last().unwrap().reason, "pa-retracement-invalid");
    assert!(pa.setup.is_none());
}

#[test]
fn reference_atr_is_ready_before_the_three_bar_impulse_and_does_not_change_signal_risk_atr() {
    let c = config(false, false);
    let mut pa = PriceAction::default();
    let mut events = vec![];
    for i in 0..15 {
        pa.close(
            close(i, 100.0, 100.1, 99.9, false),
            i >= 13,
            true,
            [true, true],
            &c.strategy,
            &c.execution,
            &mut events,
        );
    }
    for (i, p) in [(15, 100.6), (16, 101.2), (17, 101.8)] {
        let mut b = close(i, p, p + 0.1, p - 0.1, false);
        b.atr = 50.0;
        send(&mut pa, &c, b, &mut events);
    }
    assert_eq!(pa.setup.as_ref().unwrap().reference_atr, 1.0);
    send(
        &mut pa,
        &c,
        close(18, 102.4, 102.5, 102.2, false),
        &mut events,
    );
    let mut result = None;
    for mut b in two_leg_rows(false) {
        b.atr = 7.0;
        result = send(&mut pa, &c, b, &mut events);
    }
    let candidate = result.unwrap();
    assert_eq!(candidate.atr, 7.0);
    assert_eq!(candidate.entry_signal.atr, 7.0);
    assert_eq!(pa_trigger(candidate.entry_signal).reference_atr, 1.0);
    let mut cold = PriceAction::default();
    for i in 0..3 {
        cold.close(
            close(i, 100.0, 100.1, 99.9, false),
            false,
            true,
            [true, true],
            &c.strategy,
            &c.execution,
            &mut vec![],
        );
    }
    assert!(send(
        &mut cold,
        &c,
        close(3, 105.0, 105.1, 104.9, false),
        &mut vec![]
    )
    .is_none());
    assert!(cold.setup.is_none());
}

#[test]
fn key_level_selection_is_as_of_the_origin_and_never_searches_for_a_better_older_pivot() {
    let c = config(true, false);
    let mut pa = PriceAction::default();
    let mut events = vec![];
    pa.levels.highs = VecDeque::from([key(101.6, 8, false), key(105.0, 12, false)]);
    for i in 0..15 {
        send(
            &mut pa,
            &c,
            close(i, 100.0, 100.1, 99.9, false),
            &mut events,
        );
    }
    for (i, p) in [(15, 100.6), (16, 101.2), (17, 101.8)] {
        send(
            &mut pa,
            &c,
            close(i, p, p + 0.1, p - 0.1, false),
            &mut events,
        );
    }
    assert!(
        pa.setup.as_ref().unwrap().key.is_none(),
        "latest pivot fails binding, so the older convenient price cannot be used"
    );
    let mut levels = KeyLevels::default();
    levels.highs = VecDeque::from([key(101.6, 8, false), key(105.0, 16, false)]);
    assert_eq!(
        levels
            .before(Side::Long, BASE + 15 * MINUTE - 1)
            .unwrap()
            .price,
        101.6
    );
}

#[test]
fn high_period_pivots_wait_for_two_complete_right_candles() {
    for short in [false, true] {
        let mut levels = KeyLevels::default();
        for i in 0..25 {
            let price = [100.0, 101.0, 103.0, 101.0, 100.0][i / 5];
            let b = close(i, price, price + 0.1, price - 0.1, short).bar;
            levels.observe(b, 5);
            if i < 24 {
                assert!(levels.highs.is_empty() && levels.lows.is_empty());
            }
        }
        let pivot = levels
            .before(
                if short { Side::Short } else { Side::Long },
                BASE + 25 * MINUTE - 1,
            )
            .unwrap();
        assert_eq!(pivot.pivot_time, BASE + 10 * MINUTE);
        assert_eq!(pivot.confirmed_at, BASE + 25 * MINUTE - 1);
        assert!(levels
            .before(
                if short { Side::Short } else { Side::Long },
                BASE + 25 * MINUTE - 2
            )
            .is_none());
    }
}

#[test]
fn key_close_failure_is_latched_but_does_not_change_the_underlying_setup() {
    for gate in [false, true] {
        let c = config(gate, false);
        let (mut pa, mut events) = prepared(&c, false, true);
        send(
            &mut pa,
            &c,
            close(19, 101.34, 102.4, 101.3, false),
            &mut events,
        );
        assert!(pa.setup.is_some());
        assert!(!pa.setup.as_ref().unwrap().key.unwrap().valid);
        assert!(
            send(
                &mut pa,
                &c,
                close(20, 102.8, 102.9, 101.6, false),
                &mut events
            )
            .is_some()
                == !gate
        );
        if gate {
            assert_eq!(events.last().unwrap().reason, "pa-key-level-missing");
        }
    }
}

#[test]
fn direction_disable_depth_and_timeouts_cancel_once_and_require_fresh_windows() {
    let c = config(false, false);
    for reason in ["direction", "disabled", "depth", "extension", "pullback"] {
        let (mut pa, mut events) = prepared(&c, false, false);
        match reason {
            "direction" => {
                pa.close(
                    close(19, 102.3, 102.4, 102.1, false),
                    true,
                    true,
                    [false, true],
                    &c.strategy,
                    &c.execution,
                    &mut events,
                );
            }
            "disabled" => {
                pa.reset();
                pa.close(
                    close(19, 102.3, 102.4, 102.1, false),
                    true,
                    false,
                    [true, true],
                    &c.strategy,
                    &c.execution,
                    &mut events,
                );
            }
            "depth" => {
                send(
                    &mut pa,
                    &c,
                    close(19, 100.5, 102.4, 100.0, false),
                    &mut events,
                );
            }
            "extension" => {
                for i in 19..27 {
                    let p = 102.4 + (i - 18) as f64 * 0.1;
                    send(
                        &mut pa,
                        &c,
                        close(i, p, p + 0.1, p - 0.1, false),
                        &mut events,
                    );
                }
            }
            _ => {
                for i in 19..28 {
                    send(
                        &mut pa,
                        &c,
                        close(i, 102.1, 102.3, 101.6, false),
                        &mut events,
                    );
                }
            }
        }
        assert!(pa.setup.is_none(), "{reason}");
        assert_eq!(
            events.iter().filter(|e| e.kind == "setup").count(),
            1,
            "{reason}"
        );
        assert!(pa.eligible_after >= BASE + 20 * MINUTE - 1);
        assert!(!pa.reset_requested);
    }
}
