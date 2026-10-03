use super::*;
use crate::trend::config::{Config, StructuredPullback as Policy};
use crate::trend::management::{chandelier_decision, staged_decision};
use crate::trend::position::{Position, Stages};
const BASE: u64 = 1_704_067_200_000;
fn config() -> Config {
    let mut c = Config::default();
    c.strategy.entry = "structured-pullback".into();
    c.strategy.filter = "none".into();
    c.strategy.direction = "both".into();
    c.strategy.management = "chandelier".into();
    c.strategy.trailing_atr = 3.0;
    c.strategy.trade_minutes = 1;
    c.strategy.structured_pullback = Some(Policy {
        key_level: KeyLevelPolicy::None,
        shape: ShapePolicy::None,
        candle: CandlePolicy::None,
        confirmation: Some(crate::trend::config::ConfirmationPolicy::BeforeBreakout),
        key_role: Some(crate::trend::config::KeyRole::PullbackRetest),
    });
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
        time: bar.time + MINUTE - 1,
        bar,
        atr: 1.0,
    }
}
fn send(
    pa: &mut StructuredPullback,
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
fn prepared(c: &Config, short: bool) -> (StructuredPullback, Vec<Event>) {
    let mut pa = StructuredPullback::default();
    let mut events = vec![];
    for i in 0..15 {
        send(&mut pa, c, close(i, 100.0, 100.1, 99.9, short), &mut events);
    }
    for (i, p) in [(15, 100.6), (16, 101.2), (17, 101.8), (18, 102.4)] {
        send(
            &mut pa,
            c,
            close(i, p, p + 0.1, p - 0.1, short),
            &mut events,
        );
    }
    assert!(pa.setup.is_some());
    (pa, events)
}
fn trigger(signal: EntrySignal) -> StructuredPullbackTrigger {
    match signal.trigger.unwrap() {
        EntryTrigger::StructuredPullback(t) => t,
        _ => panic!("wrong trigger"),
    }
}
#[test]
fn whole_pre_pullback_extreme_frozen_signal_atr_current_and_first_break_consumed_both_sides() {
    for short in [false, true] {
        let c = config();
        let (mut pa, mut events) = prepared(&c, short);
        send(
            &mut pa,
            &c,
            close(19, 102.0, 104.0, 101.8, short),
            &mut events,
        );
        let mut signal = close(20, 102.51, 102.6, 102.0, short);
        signal.atr = 0.75;
        let candidate = send(&mut pa, &c, signal, &mut events).unwrap();
        let t = trigger(candidate.entry_signal);
        assert_eq!(candidate.side, if short { Side::Short } else { Side::Long });
        assert_eq!(
            candidate.entry_signal.boundary,
            Some(if short { 97.5 } else { 102.5 })
        );
        assert_eq!(candidate.atr, 0.75);
        assert_eq!(t.reference_atr, 1.0);
        assert_eq!(t.pullback_bars, 2);
        assert!(t.impulse_end_time < t.pullback_started_at.unwrap());
        assert!(pa.setup.is_none());
        assert!(send(
            &mut pa,
            &c,
            close(21, 103.0, 103.1, 102.9, short),
            &mut events
        )
        .is_none());
        assert_eq!(
            events
                .iter()
                .filter(|e| e.reason == "sp-first-break")
                .count(),
            1
        );
        let v = serde_json::to_value(t).unwrap();
        assert_eq!(v["turns"], serde_json::json!([]));
    }
}
#[test]
fn failed_gate_consumes_same_first_break_without_waiting_for_later_shape() {
    let mut c = config();
    c.strategy.structured_pullback.as_mut().unwrap().shape = ShapePolicy::Any;
    let (mut pa, mut events) = prepared(&c, false);
    send(
        &mut pa,
        &c,
        close(19, 102.0, 102.1, 101.8, false),
        &mut events,
    );
    assert!(send(
        &mut pa,
        &c,
        close(20, 102.51, 102.6, 102.0, false),
        &mut events
    )
    .is_none());
    assert!(events.iter().any(|e| e.reason == "sp-shape-missing"));
    assert!(pa.setup.is_none());
    for i in 21..24 {
        assert!(send(
            &mut pa,
            &c,
            close(i, 102.55, 102.6, 102.5, false),
            &mut events
        )
        .is_none());
    }
    assert_eq!(
        events
            .iter()
            .filter(|e| e.reason == "sp-first-break")
            .count(),
        1
    );
}
#[test]
fn cancel_never_rearms_old_impulse_and_timeout_has_explicit_event() {
    let c = config();
    let (mut pa, mut events) = prepared(&c, false);
    pa.reset();
    send(
        &mut pa,
        &c,
        close(19, 102.0, 102.1, 101.8, false),
        &mut events,
    );
    assert!(pa.setup.is_none());
    assert!(events.iter().any(|e| e.reason == "sp-disabled"));
    for i in 20..22 {
        send(
            &mut pa,
            &c,
            close(i, 104.0, 104.1, 103.9, false),
            &mut events,
        );
        assert!(pa.setup.is_none());
    }
    let (mut pa, mut events) = prepared(&c, false);
    for i in 19..=43 {
        send(
            &mut pa,
            &c,
            close(i, 102.0, 102.1, 101.8, false),
            &mut events,
        );
    }
    assert!(pa.setup.is_none());
    assert_eq!(
        events.iter().filter(|e| e.reason == "sp-expired").count(),
        1
    );
}
#[test]
fn confirmation_cannot_use_breakout_candle_and_appending_future_does_not_rewrite_events() {
    let c = config();
    let (mut pa, mut events) = prepared(&c, false);
    for (i, p, l) in [
        (19, 102.0, 101.8),
        (20, 102.1, 101.7),
        (21, 102.0, 101.5),
        (22, 102.1, 101.7),
    ] {
        send(&mut pa, &c, close(i, p, 102.2, l, false), &mut events);
    }
    // This fifth candle would confirm index21 as a 2+2 low, but is itself the
    // entry trigger: it must not manufacture a preceding structural turn.
    let candidate = send(
        &mut pa,
        &c,
        close(23, 102.6, 102.7, 102.0, false),
        &mut events,
    )
    .unwrap();
    assert!(trigger(candidate.entry_signal)
        .turns
        .iter()
        .all(Option::is_none));
    let frozen = serde_json::to_value(&events).unwrap();
    let len = events.len();
    for i in 24..40 {
        send(
            &mut pa,
            &c,
            close(i, 103.0, 104.0, 102.0, false),
            &mut events,
        );
    }
    assert_eq!(serde_json::to_value(&events[..len]).unwrap(), frozen);
}
fn turn(i: usize, kind: &'static str, price: f64, short: bool) -> ConfirmedTurn {
    ConfirmedTurn {
        kind: if short {
            if kind == "low" {
                "high"
            } else {
                "low"
            }
        } else {
            kind
        },
        time: BASE + i as u64 * MINUTE,
        confirmed_at: BASE + (i as u64 + 2) * MINUTE,
        price: if short { 200.0 - price } else { price },
    }
}
#[test]
fn structural_labels_are_mirrored_overlapping_and_use_confirmed_alternating_turns() {
    for short in [false, true] {
        let side = if short { Side::Short } else { Side::Long };
        let wedge: VecDeque<_> = [
            (0, "low", 102.0),
            (3, "high", 103.0),
            (6, "low", 101.4),
            (9, "high", 102.6),
            (12, "low", 101.1),
        ]
        .into_iter()
        .map(|(i, k, p)| turn(i, k, p, short))
        .collect();
        let labels = shape_labels(&wedge, side, 1.0);
        assert!(labels.two_legs && labels.wedge);
        assert!(!labels.double_test);
        let channel: VecDeque<_> = [
            (0, "low", 102.0),
            (3, "high", 103.0),
            (6, "low", 101.5),
            (9, "high", 102.5),
        ]
        .into_iter()
        .map(|(i, k, p)| turn(i, k, p, short))
        .collect();
        assert!(shape_labels(&channel, side, 1.0).channel);
        let double: VecDeque<_> = [(0, "low", 102.0), (3, "high", 103.0), (6, "low", 102.2)]
            .into_iter()
            .map(|(i, k, p)| turn(i, k, p, short))
            .collect();
        let labels = shape_labels(&double, side, 1.0);
        assert!(labels.two_legs && labels.double_test);
        assert!(!labels.channel);
    }
}
#[test]
fn pivot_is_known_at_origin_and_can_be_crossed_during_extension_not_reselected() {
    for short in [false, true] {
        let c = config();
        let (mut pa, mut events) = prepared(&c, short);
        // Test the binding independently of the observer: initial qualification
        // at101.8, extension at102.4 crosses a fixed102.0 pivot.
        let mut initial = StructuredPullback::default();
        let key = KeyLevelSnapshot {
            minutes: 5,
            price: if short { 98.0 } else { 102.0 },
            pivot_time: BASE,
            confirmed_at: BASE + MINUTE - 1,
            retest_time: None,
            valid: true,
        };
        if short {
            initial.levels.lows.push_back(key);
        } else {
            initial.levels.highs.push_back(key);
        }
        let mut ev = vec![];
        for i in 0..15 {
            send(
                &mut initial,
                &c,
                close(i, 100.0, 100.1, 99.9, short),
                &mut ev,
            );
        }
        for (i, p) in [(15, 100.6), (16, 101.2), (17, 101.8)] {
            send(
                &mut initial,
                &c,
                close(i, p, p + 0.1, p - 0.1, short),
                &mut ev,
            );
        }
        assert!(!initial.setup.as_ref().unwrap().pivot_crossed);
        send(
            &mut initial,
            &c,
            close(18, 102.4, 102.5, 102.3, short),
            &mut ev,
        );
        assert!(initial.setup.as_ref().unwrap().pivot_crossed);
        send(
            &mut initial,
            &c,
            close(19, 102.1, 102.2, 101.9, short),
            &mut ev,
        );
        assert!(initial
            .setup
            .as_ref()
            .unwrap()
            .pivot
            .unwrap()
            .retest_time
            .is_some());
        // A level confirmed only after the origin is not eligible.
        pa.levels.highs.push_back(KeyLevelSnapshot {
            confirmed_at: BASE + 18 * MINUTE,
            ..key
        });
        assert!(pa.setup.as_ref().unwrap().pivot.is_none());
        send(
            &mut pa,
            &c,
            close(19, 102.0, 102.2, 101.8, short),
            &mut events,
        );
        assert!(pa.setup.as_ref().unwrap().pivot.is_none());
    }
}
#[test]
fn ema_needs_two_distinct_prior_touch_then_later_bounce_and_expiring_evidence() {
    for side in [Side::Long, Side::Short] {
        let short = side == Side::Short;
        let mut v = Validation::default();
        let near = |i| close(i, 100.1, 100.2, 99.9, short).bar;
        let far = |i| close(i, 100.6, 100.7, 100.3, short).bar;
        v.observe(side, near(1), 1, 1, 100.0, 1.0);
        assert!(v.confirmed_at().is_none());
        v.observe(side, far(2), 2, 2, 100.0, 1.0);
        assert!(v.confirmed_at().is_none());
        v.observe(side, near(3), 3, 3, 100.0, 1.0);
        assert!(v.confirmed_at().is_none());
        v.observe(side, far(4), 4, 4, 100.0, 1.0);
        assert_eq!(v.confirmed_at(), Some(4));
        v.observe(side, far(25), 25, 25, 100.0, 1.0);
        assert!(v.confirmed_at().is_none());
    }
}
#[test]
fn htf_partial_candles_and_partitions_do_not_confirm_a_future_key() {
    let mut a = KeyLevels::default();
    let mut b = KeyLevels::default();
    let rows: Vec<_> = (0..150)
        .map(|i| {
            let p = 100.0 + (i as f64 / 10.0).sin();
            close(i, p, p + 0.1, p - 0.1, false).bar
        })
        .collect();
    for row in &rows {
        a.observe(*row, 5);
    }
    for chunk in rows.chunks(7) {
        for row in chunk {
            b.observe(*row, 5);
        }
    }
    assert_eq!(
        a.contexts.back().unwrap().time,
        b.contexts.back().unwrap().time
    );
    assert_eq!(
        a.contexts.back().unwrap().ema,
        b.contexts.back().unwrap().ema
    );
    assert_eq!(
        serde_json::to_value(&a.highs).unwrap(),
        serde_json::to_value(&b.highs).unwrap()
    );
    let before = a.contexts.back().unwrap().time;
    a.observe(close(150, 200.0, 201.0, 199.0, false).bar, 5);
    assert_eq!(a.contexts.back().unwrap().time, before);
}
fn position(side: Side) -> Position {
    Position {
        id: 1,
        side,
        time: BASE,
        entry: 100.0,
        entry_signal: EntrySignal {
            time: BASE - 1,
            price: 100.0,
            boundary: None,
            atr: 1.0,
            lookback_bars: None,
            trigger: None,
        },
        quantity: 1.0,
        initial_stop: 100.0 - side.sign() * 2.0,
        stop: 100.0 - side.sign() * 2.0,
        initial_distance: 2.0,
        signal_atr: 1.0,
        entry_fee: 0.0,
        entry_slippage_and_rounding: 0.0,
        funding: 0.0,
        mfe: 0.5,
        mae: 0.0,
        stop_reason: "initial",
        stages: Stages::default(),
    }
}
#[test]
fn chandelier_has_no_profit_gate_uses_latest_atr_and_never_loosens_mirrored() {
    for side in [Side::Long, Side::Short] {
        let c = config();
        let mut p = position(side);
        let mut bar = close(1, 99.7, 100.1, 99.6, side == Side::Short);
        bar.atr = 0.5;
        let decision = chandelier_decision(&p, bar, &c.strategy, &c.execution);
        assert!(decision.close_r < 0.0);
        assert!(decision.stages.trailing);
        assert!(!decision.stages.break_even);
        assert_eq!(decision.stop.unwrap().price, 100.0 - side.sign());
        let mut legacy = c.strategy.clone();
        legacy.management = "staged".into();
        legacy.staged = Some(crate::trend::config::Staged {
            break_even_r: 0.0,
            trailing_start_r: 0.0,
        });
        assert!(staged_decision(&p, bar, &legacy, &c.execution)
            .stop
            .is_none());
        p.stop = decision.stop.unwrap().price;
        bar.atr = 2.0;
        assert!(chandelier_decision(&p, bar, &c.strategy, &c.execution)
            .stop
            .is_none());
        bar.atr = 0.1;
        let d = chandelier_decision(&p, bar, &c.strategy, &c.execution);
        let intent = d.exit.unwrap();
        assert_eq!(intent.reason, ExitReason::ProtectionCrossed);
        assert_eq!(intent.execute_at, bar.time + 1);
    }
}
#[test]
fn v9_policy_contract_rejects_old_versions_null_unknown_modes_and_legacy_be() {
    let c = config();
    c.validate().unwrap();
    for version in 4..=8 {
        let mut old = c.clone();
        old.version = version;
        assert!(old.validate().is_err());
    }
    let value = serde_json::to_value(&c).unwrap();
    for bad in [
        serde_json::Value::Null,
        serde_json::json!({"keyLevel":"either","shape":"all","candle":"none"}),
    ] {
        let mut v = value.clone();
        v["strategy"]["structuredPullback"] = bad;
        assert!(serde_json::from_value::<Config>(v).is_err());
    }
    let mut other = c.clone();
    other.strategy.entry = "pullback".into();
    assert!(other.validate().is_err());
    let mut be = c.clone();
    be.strategy.break_even_atr = 1.0;
    assert!(be.validate().is_err());
    let mut warm = c;
    warm.strategy.trade_minutes = 30;
    warm.strategy.filter = "ema".into();
    assert_eq!(warm.warmup_days(), 4);
    warm.strategy.structured_pullback = Some(Policy {
        key_level: KeyLevelPolicy::Either,
        shape: ShapePolicy::Any,
        candle: CandlePolicy::Reversal,
        confirmation: Some(crate::trend::config::ConfirmationPolicy::BeforeBreakout),
        key_role: Some(crate::trend::config::KeyRole::PullbackRetest),
    });
    assert_eq!(warm.warmup_days(), 4);
}

#[test]
fn actual_completed_pullback_sequence_forms_two_legs_and_double_test_before_trigger() {
    for short in [false, true] {
        let mut c = config();
        c.strategy.structured_pullback.as_mut().unwrap().shape = ShapePolicy::DoubleTest;
        let (mut pa, mut events) = prepared(&c, short);
        for (i, p, h, l) in [
            (19, 102.0, 102.1, 101.9),
            (20, 101.9, 102.0, 101.7),
            (21, 101.7, 101.9, 101.5),
            (22, 101.9, 102.0, 101.7),
            (23, 102.1, 102.3, 101.9),
            (24, 102.2, 102.4, 102.0),
            (25, 102.0, 102.2, 101.8),
            (26, 101.9, 102.1, 101.7),
            (27, 101.8, 102.0, 101.6),
            (28, 101.9, 102.1, 101.7),
            (29, 102.1, 102.3, 101.9),
        ] {
            assert!(send(&mut pa, &c, close(i, p, h, l, short), &mut events).is_none());
        }
        let result = send(
            &mut pa,
            &c,
            close(30, 102.6, 102.7, 102.1, short),
            &mut events,
        )
        .unwrap();
        let t = trigger(result.entry_signal);
        assert!(t.shapes.two_legs && t.shapes.double_test);
        assert!(t
            .turns
            .iter()
            .flatten()
            .all(|p| p.confirmed_at < result.entry_signal.time));
        assert_eq!(t.turns.iter().flatten().count(), 3);
    }
}

#[test]
fn thirty_minute_native_entries_use_next_minute_and_drain_boundaries_do_not_change_results() {
    use crate::trend::engine::Engine;
    let run = |c: Config, bars: &[Bar], partition: usize| {
        let mut engine = Engine::new(
            c,
            vec![],
            BASE + 70 * 30 * MINUTE,
            BASE + bars.len() as u64 * MINUTE,
            BASE,
        )
        .unwrap();
        let mut output = Chunk::default();
        let append = |all: &mut Chunk, chunk: Chunk| {
            all.trades.extend(chunk.trades);
            all.events.extend(chunk.events);
            // Stream consumers replace an emitted same-timestamp mark when
            // finish publishes the cost-adjusted terminal fill observation.
            for point in chunk.equity {
                if all
                    .equity
                    .last()
                    .is_some_and(|last| last.time == point.time)
                {
                    all.equity.pop();
                }
                all.equity.push(point);
            }
            all.contexts.extend(chunk.contexts);
            all.indicators.extend(chunk.indicators);
        };
        for (i, b) in bars.iter().enumerate() {
            engine.advance(*b, *b).unwrap();
            if (i + 1) % partition == 0 {
                append(&mut output, engine.drain());
            }
        }
        let metrics = engine.finish().unwrap();
        append(&mut output, engine.drain());
        (metrics, output)
    };
    for short in [false, true] {
        let mut c = config();
        c.strategy.trade_minutes = 30;
        c.strategy.structured_pullback.as_mut().unwrap().shape = ShapePolicy::DoubleTest;
        c.risk.daily_loss_pct = 0.0;
        c.execution.min_notional = 1.0;
        let mut rows = vec![];
        let mut previous: f64 = 100.0;
        for i in 0..102 {
            let (price, high, low): (f64, f64, f64) = match i {
                80 => (100.6, 100.7, 99.9),
                81 => (101.2, 101.3, 100.5),
                82 => (101.8, 101.9, 101.1),
                83 => (102.4, 102.5, 101.7),
                84 => (102.0, 103.0, 101.9),
                85 => (101.9, 102.0, 101.7),
                86 => (101.7, 101.9, 101.5),
                87 => (101.9, 102.0, 101.7),
                88 => (102.1, 102.3, 101.9),
                89 => (102.2, 102.4, 102.0),
                90 => (102.0, 102.2, 101.8),
                91 => (101.9, 102.1, 101.7),
                92 => (101.8, 102.0, 101.6),
                93 => (101.9, 102.1, 101.7),
                94 => (102.1, 102.3, 101.9),
                95 => (102.6, 102.7, 102.1),
                96..=101 => (102.7, 102.8, 102.5),
                _ => (100.0, 100.5, 99.5),
            };
            for minute in 0..30 {
                let open = previous + (price - previous) * minute as f64 / 30.0;
                let end = previous + (price - previous) * (minute + 1) as f64 / 30.0;
                let mut b = Bar {
                    time: BASE + rows.len() as u64 * MINUTE,
                    open,
                    close: end,
                    high: if minute == 0 {
                        high.max(open)
                    } else {
                        open.max(end)
                    },
                    low: if minute == 0 {
                        low.min(open)
                    } else {
                        open.min(end)
                    },
                    volume: 1.0,
                };
                if short {
                    b = Bar {
                        open: 200.0 - b.open,
                        close: 200.0 - b.close,
                        high: 200.0 - b.low,
                        low: 200.0 - b.high,
                        ..b
                    };
                }
                rows.push(b);
            }
            previous = price;
        }
        let a = run(c.clone(), &rows, usize::MAX);
        let b = run(c, &rows, 17);
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            serde_json::to_value(&b).unwrap()
        );
        assert_eq!(
            a.1.trades.len(),
            1,
            "{}",
            serde_json::to_string(&a.1.events).unwrap()
        );
        let trade = &a.1.trades[0];
        assert_eq!(trade.entry_time, BASE + 96 * 30 * MINUTE);
        assert_eq!(trade.entry_signal.time + 1, trade.entry_time);
        let t = trigger(trade.entry_signal);
        assert!(t.shapes.double_test);
        assert!(t
            .turns
            .iter()
            .flatten()
            .all(|t| t.confirmed_at < trade.entry_signal.time));
        assert_eq!(
            a.1.events
                .iter()
                .filter(|e| e.kind == "stage" && e.reason == "breakeven-armed")
                .count(),
            0
        );
    }
}

#[test]
fn signal_close_can_confirm_two_bars_ago_without_using_current_as_pivot_mirrored() {
    for short in [false, true] {
        let mut before = config();
        before.strategy.structured_pullback.as_mut().unwrap().shape = ShapePolicy::DoubleTest;
        let mut current = before.clone();
        current
            .strategy
            .structured_pullback
            .as_mut()
            .unwrap()
            .confirmation = Some(ConfirmationPolicy::SignalClose);
        let run = |c: &Config| {
            let (mut pa, mut events) = prepared(c, short);
            for (i, p, h, l) in [
                (19, 102., 102.1, 101.9),
                (20, 101.9, 102., 101.7),
                (21, 101.7, 101.9, 101.5),
                (22, 101.9, 102., 101.7),
                (23, 102.1, 102.3, 101.9),
                (24, 102.2, 102.4, 102.),
                (25, 102., 102.2, 101.8),
                (26, 101.9, 102.1, 101.7),
                (27, 101.8, 102., 101.6),
                (28, 101.9, 102.1, 101.7),
            ] {
                send(&mut pa, c, close(i, p, h, l, short), &mut events);
            }
            let signal = close(29, 102.6, 102.7, 102.0, short);
            let candidate = send(&mut pa, c, signal, &mut events);
            (candidate, events)
        };
        let (old, old_events) = run(&before);
        assert!(old.is_none());
        assert!(old_events.iter().any(|e| e.reason == "sp-shape-missing"));
        let (new, events) = run(&current);
        let candidate = new.unwrap();
        let t = trigger(candidate.entry_signal);
        assert!(t.shapes.two_legs && t.shapes.double_test);
        assert_eq!(
            t.turns.iter().flatten().last().unwrap().confirmed_at,
            candidate.entry_signal.time
        );
        assert!(t
            .turns
            .iter()
            .flatten()
            .all(|p| p.time + 2 * MINUTE <= candidate.entry_signal.time));
        assert!(t.gates.unwrap().passed());
        assert_eq!(
            events
                .iter()
                .filter(|e| e.reason == "sp-first-break")
                .count(),
            1
        );
        // Confirmation changes no impulse/breakout identity or price boundary.
        let old_first = old_events
            .iter()
            .find(|e| e.reason == "sp-first-break")
            .unwrap()
            .entry_signal
            .unwrap();
        assert_eq!(
            (old_first.time, old_first.boundary),
            (candidate.entry_signal.time, candidate.entry_signal.boundary)
        );
    }
}

#[test]
fn impulse_context_needs_frozen_origin_eligibility_and_keeps_later_invalidation() {
    for short in [false, true] {
        let mut c = config();
        let p = c.strategy.structured_pullback.as_mut().unwrap();
        p.key_level = KeyLevelPolicy::Either;
        p.key_role = Some(KeyRole::ImpulseContext);
        let (mut pa, mut events) = prepared(&c, short);
        let setup = pa.setup.as_mut().unwrap();
        setup.pivot = Some(KeyLevelSnapshot {
            minutes: 5,
            price: if short { 99.0 } else { 101.0 },
            pivot_time: BASE,
            confirmed_at: BASE + MINUTE - 1,
            retest_time: None,
            valid: true,
        });
        setup.pivot_crossed = true;
        send(
            &mut pa,
            &c,
            close(19, 102.0, 102.1, 101.8, short),
            &mut events,
        );
        let candidate = send(
            &mut pa,
            &c,
            close(20, 102.6, 102.7, 102.0, short),
            &mut events,
        )
        .unwrap();
        let t = trigger(candidate.entry_signal);
        assert!(t.context_eligible.unwrap().pivot);
        assert!(t.pivot.unwrap().retest_time.is_none());
        assert!(t.gates.unwrap().key);
        // Initial support context never immunizes a key against the old close invalidation.
        let (mut pa, mut events) = prepared(&c, short);
        let setup = pa.setup.as_mut().unwrap();
        setup.pivot = Some(KeyLevelSnapshot {
            price: if short { 97.5 } else { 102.5 },
            ..t.pivot.unwrap()
        });
        setup.pivot_crossed = true;
        send(
            &mut pa,
            &c,
            close(19, 102.0, 102.1, 101.8, short),
            &mut events,
        );
        assert!(send(
            &mut pa,
            &c,
            close(20, 102.6, 102.7, 102.0, short),
            &mut events
        )
        .is_none());
        let rejected = events
            .iter()
            .find(|e| e.reason == "sp-key-level-missing")
            .unwrap();
        assert!(!trigger(rejected.entry_signal.unwrap()).pivot.unwrap().valid);
    }
}

#[test]
fn ema_context_is_decided_at_origin_not_repaired_by_later_ema_values() {
    for short in [false, true] {
        for eligible in [true, false] {
            let mut c = config();
            c.strategy.structured_pullback.as_mut().unwrap().key_role =
                Some(KeyRole::ImpulseContext);
            c.strategy.structured_pullback.as_mut().unwrap().key_level =
                KeyLevelPolicy::ValidatedEma;
            let mut pa = StructuredPullback::default();
            let mut events = vec![];
            let origin_ema = if eligible { 99.0 } else { 101.0 };
            pa.levels.contexts.push_back(Context {
                time: BASE + 14 * MINUTE - 1,
                ema: if short {
                    200.0 - origin_ema
                } else {
                    origin_ema
                },
                validated: [Some(BASE), Some(BASE)],
            });
            for i in 0..15 {
                send(
                    &mut pa,
                    &c,
                    close(i, 100.0, 100.1, 99.9, short),
                    &mut events,
                );
            }
            for (i, p) in [(15, 100.6), (16, 101.2), (17, 101.8), (18, 102.4)] {
                send(
                    &mut pa,
                    &c,
                    close(i, p, p + 0.1, p - 0.1, short),
                    &mut events,
                );
            }
            assert_eq!(pa.setup.as_ref().unwrap().ema_context_eligible, eligible);
            pa.levels.contexts.push_back(Context {
                time: BASE + 19 * MINUTE - 1,
                ema: if short { 101.0 } else { 99.0 },
                validated: [Some(BASE), Some(BASE)],
            });
            send(
                &mut pa,
                &c,
                close(19, 102., 102.1, 101.8, short),
                &mut events,
            );
            let result = send(
                &mut pa,
                &c,
                close(20, 102.6, 102.7, 102., short),
                &mut events,
            );
            assert_eq!(result.is_some(), eligible);
            if let Some(result) = result {
                assert!(trigger(result.entry_signal)
                    .ema
                    .unwrap()
                    .retest_time
                    .is_none());
            }
        }
    }
}

#[test]
fn v9_explicit_old_semantics_are_unchanged_and_v10_requires_both_policies() {
    let modern = config();
    let mut legacy = modern.clone();
    legacy.version = 9;
    legacy
        .strategy
        .structured_pullback
        .as_mut()
        .unwrap()
        .confirmation = None;
    legacy
        .strategy
        .structured_pullback
        .as_mut()
        .unwrap()
        .key_role = None;
    legacy.validate().unwrap();
    let run = |c: &Config| {
        let (mut detector, mut events) = prepared(c, false);
        send(
            &mut detector,
            c,
            close(19, 102., 102.1, 101.8, false),
            &mut events,
        );
        let candidate = send(
            &mut detector,
            c,
            close(20, 102.6, 102.7, 102., false),
            &mut events,
        )
        .unwrap();
        (candidate, events)
    };
    let (a, ev_a) = run(&legacy);
    let (b, ev_b) = run(&modern);
    fn strip(v: &mut serde_json::Value) {
        match v {
            serde_json::Value::Object(m) => {
                for name in ["confirmation", "keyRole", "gates", "contextEligible"] {
                    m.remove(name);
                }
                for val in m.values_mut() {
                    strip(val);
                }
            }
            serde_json::Value::Array(a) => {
                for val in a {
                    strip(val);
                }
            }
            _ => {}
        }
    }
    let mut current = serde_json::to_value((b.entry_signal, ev_b)).unwrap();
    strip(&mut current);
    assert_eq!(
        serde_json::to_value((a.entry_signal, ev_a)).unwrap(),
        current
    );
    let mut missing = legacy.clone();
    missing.version = 10;
    assert!(missing.validate().is_err());
    let mut forbidden = modern.clone();
    forbidden.version = 9;
    assert!(forbidden.validate().is_err());
    for field in ["confirmation", "keyRole"] {
        let mut value = serde_json::to_value(&modern).unwrap();
        value["strategy"]["structuredPullback"][field] = serde_json::Value::Null;
        assert!(serde_json::from_value::<Config>(value).is_err());
    }
}
