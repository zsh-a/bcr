use super::{bar, config, history, replay, BASE};
use crate::trend::{
    config::Config,
    indicators::Indicators,
    management::ChannelExit,
    model::{Bar, Event, Side, TradingClose, MINUTE},
    signals::{Candidate, Signals},
};

fn breakout(episode: bool) -> Config {
    let mut c = config();
    c.strategy.entry = "breakout".into();
    c.strategy.management = "channel".into();
    c.strategy.breakout_bars = 20;
    c.strategy.stop_atr = 2.0;
    if episode {
        c.strategy.breakout_reentry = Some("episode".into());
    }
    c
}

fn mirrored(b: Bar, short: bool) -> Bar {
    if short {
        Bar {
            open: 200.0 - b.open,
            close: 200.0 - b.close,
            high: 200.0 - b.low,
            low: 200.0 - b.high,
            ..b
        }
    } else {
        b
    }
}

fn signal(
    signals: &mut Signals,
    indicators: &mut Indicators,
    c: &Config,
    b: Bar,
    enabled: bool,
    events: &mut Vec<Event>,
) -> Option<Candidate> {
    let close = indicators.close(b, &c.strategy).trade.unwrap();
    signals.close(close, indicators, c, enabled, events, [true, true])
}

#[test]
fn new_policies_are_versioned_typed_and_bounded_by_active_warmup() {
    for version in 4..=9 {
        let mut c = breakout(false);
        c.version = version;
        if version == 4 {
            c.strategy.max_cost_atr = None;
        }
        assert!(c.validate().is_ok());
        c.strategy.channel_exit_bars = Some(10);
        assert_eq!(c.validate().is_ok(), version >= 8);
        c.strategy.channel_exit_bars = None;
        c.strategy.breakout_reentry = Some("every-close".into());
        assert_eq!(c.validate().is_ok(), version >= 8);
        c.strategy.breakout_reentry = None;
        c.strategy.breakout_bars = 320;
        assert_eq!(c.validate().is_ok(), version >= 8);
    }
    let mut c = breakout(false);
    for bars in [0, 1001] {
        c.strategy.channel_exit_bars = Some(bars);
        assert!(c.validate().is_err());
    }
    c.strategy.channel_exit_bars = Some(1);
    assert!(c.validate().is_ok());
    c.strategy.management = "atr".into();
    assert!(c.validate().is_err());
    c.strategy.channel_exit_bars = None;
    c.strategy.entry = "pullback".into();
    c.strategy.breakout_reentry = Some("episode".into());
    assert!(c.validate().is_err());
    c.strategy.entry = "breakout".into();
    c.strategy.breakout_reentry = Some("unknown".into());
    assert!(c.validate().is_err());

    let mut c = breakout(false);
    c.strategy.trade_minutes = 30;
    c.strategy.breakout_bars = 320;
    c.strategy.channel_exit_bars = Some(20);
    assert!(c.validate().is_ok());
    assert_eq!(c.warmup_days(), 7);
    c.strategy.breakout_bars = 40;
    c.strategy.channel_exit_bars = Some(320);
    assert_eq!(c.warmup_days(), 7);
    c.strategy.trade_minutes = 1440;
    assert!(c.validate().is_err());
    c.strategy.channel_exit_bars = Some(250);
    assert!(c.validate().is_ok());
    assert_eq!(c.warmup_days(), 250);
    c.strategy.channel_exit_bars = Some(251);
    assert!(c.validate().is_err());
    c.strategy.channel_exit_bars = None;
    c.strategy.breakout_bars = 251;
    assert!(c.validate().is_err());
    c.strategy.trade_minutes = 240;
    c.strategy.breakout_bars = 1000;
    assert!(c.validate().is_ok());
    assert_eq!(c.warmup_days(), 167);
    c.strategy.breakout_bars = 1001;
    assert!(c.validate().is_err());

    for (key, invalid) in [
        ("channelExitBars", serde_json::json!(null)),
        ("channelExitBars", serde_json::json!(2.5)),
        ("breakoutReentry", serde_json::json!(null)),
        ("breakoutReentry", serde_json::json!(true)),
    ] {
        let mut value = serde_json::to_value(breakout(false)).unwrap();
        value["strategy"][key] = invalid;
        assert!(serde_json::from_value::<Config>(value).is_err());
    }
}

#[test]
fn omitted_and_explicit_legacy_windows_have_identical_ledgers_in_all_versions() {
    for short in [false, true] {
        for version in 4..=9 {
            let mut old = breakout(false);
            old.version = version;
            if version == 4 {
                old.strategy.max_cost_atr = None;
            }
            let mut explicit = old.clone();
            explicit.version = 10;
            explicit.strategy.max_cost_atr = Some(0.0);
            explicit.strategy.channel_exit_bars = Some(10);
            explicit.strategy.breakout_reentry = Some("every-close".into());
            let bars = history(short);
            let before = replay(old, &bars, vec![], false);
            let after = replay(explicit, &bars, vec![], true);
            assert!(!before.1.trades.is_empty());
            assert_eq!(
                serde_json::to_value(before).unwrap(),
                serde_json::to_value(after).unwrap()
            );
        }
    }
    let mut old = Config::default();
    old.version = 7;
    assert_eq!(old.warmup_days(), Config::default().warmup_days());
    old.version = 10;
    assert_eq!(
        serde_json::to_value(old).unwrap(),
        serde_json::to_value(Config::default()).unwrap()
    );
}

#[test]
fn full_320_bar_boundary_rolls_and_excludes_current_candle() {
    for short in [false, true] {
        let mut c = breakout(false);
        c.strategy.breakout_bars = 320;
        c.strategy.direction = if short { "short" } else { "long" }.into();
        let mut signals = Signals::default();
        let mut indicators = Indicators::default();
        let mut events = vec![];
        for i in 0..320 {
            let mut b = bar(i, 100.0, 100.0);
            if i == 0 {
                b.high = 102.0;
            }
            assert!(signal(
                &mut signals,
                &mut indicators,
                &c,
                mirrored(b, short),
                false,
                &mut events
            )
            .is_none());
        }
        assert!(signal(
            &mut signals,
            &mut indicators,
            &c,
            mirrored(bar(320, 101.0, 101.0), short),
            true,
            &mut events
        )
        .is_none());
        let mut trigger = bar(321, 103.0, 103.0);
        trigger.high = 150.0;
        let candidate = signal(
            &mut signals,
            &mut indicators,
            &c,
            mirrored(trigger, short),
            true,
            &mut events,
        )
        .unwrap();
        assert_eq!(candidate.entry_signal.lookback_bars, Some(320));
        assert_eq!(
            candidate.entry_signal.boundary,
            Some(if short { 98.95 } else { 101.05 })
        );
        assert_eq!(candidate.entry_signal.time, trigger.time + MINUTE - 1);
    }
}

#[test]
fn explicit_exit_window_retains_its_own_history_in_both_directions() {
    for side in [Side::Long, Side::Short] {
        let mut fast = ChannelExit::default();
        let mut slow = ChannelExit::default();
        for i in 0..40 {
            let mut b = bar(i, 100.0, 100.0);
            if i == 0 {
                b.low = 90.0;
            }
            let b = mirrored(b, side == Side::Short);
            let close = TradingClose {
                bar: b,
                time: b.time + MINUTE - 1,
                atr: 1.0,
            };
            assert!(fast.close(close, None, 20).is_none());
            assert!(slow.close(close, None, 40).is_none());
        }
        let b = mirrored(bar(40, 99.0, 99.0), side == Side::Short);
        let close = TradingClose {
            bar: b,
            time: b.time + MINUTE - 1,
            atr: 1.0,
        };
        let exit = fast.close(close, Some((7, side)), 20).unwrap();
        assert_eq!(exit.execute_at, b.time + MINUTE);
        assert!(slow.close(close, Some((7, side)), 40).is_none());
    }
}

#[test]
fn episodes_consume_disabled_breaks_survive_risk_resets_and_rearm_only_after_boundary_return() {
    for short in [false, true] {
        for enabled_first in [false, true] {
            let mut c = breakout(true);
            c.strategy.direction = if short { "short" } else { "long" }.into();
            let mut signals = Signals::default();
            let mut indicators = Indicators::default();
            let mut events = vec![];
            for i in 0..20 {
                signal(
                    &mut signals,
                    &mut indicators,
                    &c,
                    mirrored(bar(i, 100.0, 100.0), short),
                    false,
                    &mut events,
                );
            }
            signals.begin_replay(BASE + 20 * MINUTE);
            let first = signal(
                &mut signals,
                &mut indicators,
                &c,
                mirrored(bar(20, 101.0, 101.0), short),
                enabled_first,
                &mut events,
            );
            assert_eq!(first.is_some(), enabled_first);
            signals.reset(); // Position/cooldown/daily-loss cancellation cannot revive it.
            assert!(signal(
                &mut signals,
                &mut indicators,
                &c,
                mirrored(bar(21, 102.0, 102.0), short),
                true,
                &mut events
            )
            .is_none());
            assert!(signal(
                &mut signals,
                &mut indicators,
                &c,
                mirrored(bar(22, 100.05, 100.05), short),
                true,
                &mut events
            )
            .is_none());
            assert_eq!(events.last().unwrap().reason, "breakout-episode-reset");
            let second = signal(
                &mut signals,
                &mut indicators,
                &c,
                mirrored(bar(23, 103.0, 103.0), short),
                true,
                &mut events,
            )
            .unwrap();
            assert_eq!(
                second.entry_signal.boundary,
                Some(if short { 97.95 } else { 102.05 })
            );
            assert_eq!(
                events
                    .iter()
                    .filter(|e| e.reason == "breakout-episode-reset")
                    .count(),
                1
            );
            assert_eq!(events.iter().filter(|e| e.kind == "setup").count(), 3);
        }
    }
}

#[test]
fn warmup_does_not_consume_episode_and_an_explicit_replay_start_resets_it() {
    let c = breakout(true);
    let mut signals = Signals::default();
    let mut indicators = Indicators::default();
    let mut events = vec![];
    for i in 0..60 {
        assert!(signal(
            &mut signals,
            &mut indicators,
            &c,
            bar(i, 100.0 + i as f64, 100.0 + i as f64),
            false,
            &mut events
        )
        .is_none());
    }
    assert!(events.is_empty());
    signals.begin_replay(BASE + 60 * MINUTE);
    assert!(signal(
        &mut signals,
        &mut indicators,
        &c,
        bar(60, 160.0, 160.0),
        true,
        &mut events
    )
    .is_some());
    assert!(signal(
        &mut signals,
        &mut indicators,
        &c,
        bar(61, 161.0, 161.0),
        true,
        &mut events
    )
    .is_none());
    signals.begin_replay(BASE + 62 * MINUTE);
    assert!(signal(
        &mut signals,
        &mut indicators,
        &c,
        bar(62, 162.0, 162.0),
        true,
        &mut events
    )
    .is_some());
}

#[test]
fn ema_rejected_first_break_is_consumed_before_the_filter_turns_valid() {
    for short in [false, true] {
        let mut c = breakout(true);
        c.strategy.filter = "slow-ema".into();
        c.strategy.breakout_bars = 2;
        c.strategy.direction = if short { "short" } else { "long" }.into();
        let mut signals = Signals::default();
        let mut indicators = Indicators::default();
        let mut events = vec![];
        for i in 0..70 {
            let price = 100.0 - i as f64 * 0.05;
            signal(
                &mut signals,
                &mut indicators,
                &c,
                mirrored(bar(i, price, price), short),
                false,
                &mut events,
            );
        }
        signals.begin_replay(BASE + 70 * MINUTE);
        assert!(signal(
            &mut signals,
            &mut indicators,
            &c,
            mirrored(bar(70, 96.9, 96.9), short),
            true,
            &mut events
        )
        .is_none());
        assert_eq!(events.last().unwrap().reason, "breakout-episode-filter");
        assert!(signal(
            &mut signals,
            &mut indicators,
            &c,
            mirrored(bar(71, 110.0, 110.0), short),
            true,
            &mut events
        )
        .is_none());
        assert_eq!(indicators.direction(), if short { -1 } else { 1 });
    }
}

#[test]
fn an_episode_started_while_holding_cannot_be_traded_after_a_stop_or_chunk_drain() {
    for short in [false, true] {
        let mut bars: Vec<_> = (0..60)
            .map(|i| {
                let mut b = bar(i, 100.0, 100.0);
                b.high = 101.0;
                b.low = 99.0;
                b
            })
            .collect();
        for price in [102.0, 100.9, 104.0, 105.0, 106.0, 107.0] {
            bars.push(bar(bars.len(), price, price));
        }
        bars[63].low = 90.0;
        for b in &mut bars {
            *b = mirrored(*b, short);
        }
        let mut c = breakout(true);
        c.strategy.direction = if short { "short" } else { "long" }.into();
        let undrained = replay(c.clone(), &bars, vec![], false);
        let drained = replay(c, &bars, vec![], true);
        assert_eq!(
            serde_json::to_value(&undrained).unwrap(),
            serde_json::to_value(drained).unwrap()
        );
        assert_eq!(undrained.1.trades.len(), 1);
        assert_eq!(undrained.1.trades[0].reason, "initial");
        assert!(undrained
            .1
            .events
            .iter()
            .any(|e| e.reason == "breakout-episode-unavailable"
                && e.time == bars[62].time + MINUTE - 1));
        let (_, every_close) = replay(breakout(false), &bars, vec![], false);
        assert_eq!(every_close.trades.len(), 2);
    }
}

#[test]
fn a_cost_rejection_cannot_be_retried_later_in_the_same_episode() {
    let mut bars: Vec<_> = (0..60).map(|i| bar(i, 100.0, 100.0)).collect();
    bars.push(bar(60, 101.0, 101.0));
    let mut wide = bar(61, 102.0, 102.0);
    wide.high = 200.0;
    wide.low = 99.0;
    bars.push(wide);
    bars.push(bar(62, 201.0, 201.0));
    bars.push(bar(63, 201.0, 201.0));
    let mut c = breakout(true);
    c.strategy.direction = "long".into();
    c.strategy.max_cost_atr = Some(0.05);
    let (metrics, out) = replay(c.clone(), &bars, vec![], false);
    assert_eq!(metrics.rejected_signals, 1);
    assert!(out.trades.is_empty());
    assert_eq!(
        out.events
            .iter()
            .filter(|e| e.reason == "entry-cost")
            .count(),
        1
    );
    c.strategy.breakout_reentry = None;
    assert_eq!(replay(c, &bars, vec![], false).1.trades.len(), 1);
}

#[test]
fn five_minute_episodes_survive_csv_boundaries_before_signal_entry_and_stop() {
    use crate::trend::replay::Replay;
    for short in [false, true] {
        let mut c = breakout(true);
        c.strategy.trade_minutes = 5;
        c.strategy.direction = if short { "short" } else { "long" }.into();
        let bars: Vec<_> = (0..115)
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
                b.low = if i == 106 { 100.0 } else { price - 0.1 };
                mirrored(b, short)
            })
            .collect();
        let rows: Vec<_> = bars
            .iter()
            .map(|b| {
                format!(
                    "{},{},{},{},{},{},{}\n",
                    b.time,
                    b.open,
                    b.high,
                    b.low,
                    b.close,
                    b.volume,
                    b.time + MINUTE - 1
                )
            })
            .collect();
        let run = |boundaries: &[usize]| {
            let mut replay = Replay::new(
                c.clone(),
                vec![],
                BASE + 60 * MINUTE,
                BASE + 115 * MINUTE,
                BASE,
            )
            .unwrap();
            let mut begin = 0;
            for end in boundaries {
                let csv = rows[begin..*end].concat();
                replay.load_partition(&csv, &csv).unwrap();
                while !replay.advance(3).unwrap() {}
                begin = *end;
            }
            let metrics = replay.finish().unwrap();
            let out = replay.drain();
            assert_eq!(out.trades.len(), 1);
            assert_eq!(out.trades[0].entry_time, bars[105].time);
            assert_eq!(out.trades[0].entry_signal.time, bars[104].time + MINUTE - 1);
            assert_eq!(out.trades[0].exit_time, bars[106].time + MINUTE - 1);
            assert_eq!(out.trades[0].reason, "initial");
            serde_json::to_value((metrics, out)).unwrap()
        };
        assert_eq!(run(&[115]), run(&[59, 60, 103, 105, 106, 109, 115]));
    }
}
