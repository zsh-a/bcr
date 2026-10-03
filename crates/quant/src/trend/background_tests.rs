use super::*;
const BASE: u64 = 1_704_067_200_000; // Monday 00:00 UTC

fn candle(i: usize, close: f64) -> Bar {
    Bar {
        time: BASE + i as u64 * 5 * MINUTE,
        open: close - 0.1,
        close,
        high: close + 0.8,
        low: close - 0.8,
        volume: 1.0,
    }
}
fn execution() -> Execution {
    let mut e = Config::default().execution;
    e.fee_bps = 0.0;
    e.slippage_bps = 0.0;
    e.tick_size = 0.01;
    e
}
fn trending(short: bool) -> Background {
    let mut background = Background::default();
    for i in 0..30 {
        let mut b = candle(i, 100.0 + i as f64 * 0.1);
        if short {
            b = Bar {
                open: 200.0 - b.open,
                close: 200.0 - b.close,
                high: 200.0 - b.low,
                low: 200.0 - b.high,
                ..b
            };
        }
        background.update(b, 5);
    }
    background
}
fn decision(background: &Background, price: f64, side: Side, e: &Execution) -> ContextDecision {
    background.decide(BASE + 150 * MINUTE, price, side, 1.0, e, 1)
}
#[test]
fn aligned_trends_allow_both_directions_and_reject_countertrend_signals() {
    for short in [false, true] {
        let background = trending(short);
        let side = if short { Side::Short } else { Side::Long };
        let price = if short { 97.1 } else { 102.9 };
        let d = decision(&background, price, side, &execution());
        assert!(d.allowed, "{}", serde_json::to_string(&d).unwrap());
        assert_eq!(d.phase, if short { "downtrend" } else { "uptrend" });
        assert_eq!(d.direction, Some(side));
        assert_eq!(d.efficiency, Some(1.0));
        let opposite = if short { Side::Long } else { Side::Short };
        assert_eq!(
            decision(&background, price, opposite, &execution()).reason,
            "context-direction"
        );
    }
}
#[test]
fn large_oscillations_do_not_become_a_trend_just_because_atr_is_high() {
    let mut background = Background::default();
    for i in 0..30 {
        background.update(candle(i, 100.0 + if i % 2 == 0 { 5.0 } else { -5.0 }), 5);
    }
    let d = decision(&background, 100.0, Side::Long, &execution());
    assert_eq!(d.phase, "range");
    assert_eq!(d.reason, "context-range");
    assert!(!d.allowed);
}
#[test]
fn costs_and_ema_extension_are_diagnostics_not_trend_state() {
    let background = trending(false);
    let mut e = execution();
    e.fee_bps = 100.0;
    e.slippage_bps = 100.0;
    let d = decision(&background, 102.9, Side::Long, &e);
    assert_eq!(d.reason, "context-ready");
    assert!(d.allowed);
    assert!(d.cost_atr.unwrap() > 0.5);
    let d = decision(
        &background,
        background.ema + 4.0 * background.atr,
        Side::Long,
        &execution(),
    );
    assert!(d.extension_atr.unwrap() > 3.0);
    assert!(
        d.allowed,
        "EMA distance is diagnostic, not an unvalidated entry gate"
    );
}
#[test]
fn broken_anchor_and_lower_confirmed_lows_invalidate_long_entries() {
    let mut background = trending(false);
    let d = decision(&background, 80.0, Side::Long, &execution());
    assert_eq!(d.reason, "context-structure");
    background.lows = VecDeque::from([101.0, 100.0]);
    let d = decision(&background, 102.9, Side::Long, &execution());
    assert_eq!(d.phase, "conflict");
    assert_eq!(d.reason, "context-conflict");
}
#[test]
fn incomplete_higher_candles_cannot_change_the_known_background() {
    let mut background = trending(false);
    let before = decision(&background, 102.9, Side::Long, &execution());
    for i in 150..154 {
        let b = Bar {
            time: BASE + i * MINUTE,
            open: 102.9,
            close: 1000.0,
            high: 1001.0,
            low: 100.0,
            volume: 1.0,
        };
        background.close(b, 1);
        let after = decision(&background, 102.9, Side::Long, &execution());
        assert_eq!(
            serde_json::to_string(&before).unwrap(),
            serde_json::to_string(&after).unwrap()
        );
    }
    background.close(
        Bar {
            time: BASE + 154 * MINUTE,
            ..candle(0, 1000.0)
        },
        1,
    );
    assert_eq!(background.as_of, Some(BASE + 155 * MINUTE - 1));
    assert_ne!(background.ema, before.reference.unwrap());
}
#[test]
fn pivot_is_known_only_after_two_following_candles() {
    let mut background = Background::default();
    for (i, price) in [103.0, 102.0, 100.0, 102.0].into_iter().enumerate() {
        background.update(candle(i, price), 5);
    }
    assert!(background.lows.is_empty());
    background.update(candle(4, 103.0), 5);
    assert_eq!(background.lows.back(), Some(&99.2));
    assert_eq!(background.as_of, Some(BASE + 25 * MINUTE - 1));
}
#[test]
fn weekly_context_closes_on_sunday_and_ignores_partial_weeks() {
    let mut background = Background::default();
    for i in 0..10079 {
        background.close(
            Bar {
                time: BASE + i * MINUTE,
                ..candle(0, 100.0)
            },
            1440,
        );
    }
    assert_eq!(background.as_of, None);
    background.close(
        Bar {
            time: BASE + 10079 * MINUTE,
            ..candle(0, 100.0)
        },
        1440,
    );
    assert_eq!(background.as_of, Some(BASE + 7 * DAY - 1));
    let mut partial = Background::default();
    for i in 1..10080 {
        partial.close(
            Bar {
                time: BASE + i * MINUTE,
                ..candle(0, 100.0)
            },
            1440,
        );
    }
    assert_eq!(partial.as_of, None);
}
