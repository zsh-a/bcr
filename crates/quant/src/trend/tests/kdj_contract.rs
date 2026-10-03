use super::*;
use crate::trend::{
    config::Staged, indicators::Kdj, management::staged_decision, signals::Signals,
};

fn kdj_config() -> Config {
    let mut c = config();
    c.strategy.entry = "kdj".into();
    c.strategy.filter = "slow-ema".into();
    c.strategy.management = "staged".into();
    c.strategy.stop_atr = 2.0;
    c.strategy.trailing_atr = 3.0;
    c.strategy.staged = Some(Staged {
        break_even_r: 1.0,
        trailing_start_r: 2.0,
    });
    c
}

#[test]
fn kdj_uses_nine_complete_candles_and_exact_three_three_smoothing() {
    let mut c = kdj_config();
    c.strategy.trade_minutes = 5;
    let mut indicators = Indicators::default();
    for i in 0..45 {
        let b = Bar {
            high: 10.0,
            low: 0.0,
            ..bar(i, 9.0, 9.0)
        };
        let result = indicators.close(b, &c.strategy);
        assert_eq!(result.kdj_updated, i == 44);
        if i < 44 {
            assert!(indicators.kdj.is_none());
        }
    }
    let first = indicators.kdj.unwrap();
    let k = (100.0 + 90.0) / 3.0;
    let d = (100.0 + k) / 3.0;
    assert_eq!(
        first,
        Kdj {
            k,
            d,
            j: 3.0 * k - 2.0 * d
        }
    );
    assert!(indicators.previous_kdj.is_none());
    for i in 45..50 {
        indicators.close(
            Bar {
                high: 10.0,
                low: 0.0,
                ..bar(i, 3.0, 3.0)
            },
            &c.strategy,
        );
    }
    let second = indicators.kdj.unwrap();
    assert_eq!(indicators.previous_kdj, Some(first));
    assert_eq!(second.k, (2.0 * first.k + 30.0) / 3.0);
    assert_eq!(second.d, (2.0 * first.d + second.k) / 3.0);
    assert_eq!(second.j, 3.0 * second.k - 2.0 * second.d);
    let mut flat = Indicators::default();
    for i in 0..100 {
        flat.close(
            Bar {
                high: 9.0,
                low: 9.0,
                ..bar(i, 9.0, 9.0)
            },
            &c.strategy,
        );
    }
    assert_eq!(
        flat.kdj,
        Some(Kdj {
            k: 50.0,
            d: 50.0,
            j: 50.0
        })
    );
}

#[test]
fn slow_ema_needs_63_candles_and_the_current_close_and_three_bar_slope_agree() {
    for short in [false, true] {
        let c = kdj_config();
        let mut indicators = Indicators::default();
        let mut ema = 100.0;
        let mut values = vec![];
        for i in 0..63 {
            let price = 100.0 + if short { -(i as f64) } else { i as f64 };
            if i > 0 {
                ema += 2.0 / 61.0 * (price - ema);
            }
            values.push(ema);
            indicators.close(bar(i, price, price), &c.strategy);
            assert_eq!(indicators.slow, ema);
            if i < 62 {
                assert_eq!(indicators.direction(), 0);
            }
        }
        assert_eq!(indicators.slow_previous, Some(values[59]));
        assert_eq!(indicators.direction(), if short { -1 } else { 1 });
        let price = if short { 200.0 } else { 1.0 };
        indicators.close(bar(63, price, price), &c.strategy);
        // Current close has crossed the EMA; the old trend cannot pass unchanged.
        assert_ne!(indicators.direction(), if short { -1 } else { 1 });
    }
}

fn synthetic_cross(
    signals: &mut Signals,
    indicators: &mut Indicators,
    c: &Config,
    i: usize,
    k: f64,
    d: f64,
    enabled: bool,
    short: bool,
) -> Option<crate::trend::signals::Candidate> {
    indicators.previous_kdj = indicators.kdj;
    indicators.kdj = Some(if short {
        Kdj {
            k: 100.0 - k,
            d: 100.0 - d,
            j: 100.0 - (3.0 * k - 2.0 * d),
        }
    } else {
        Kdj {
            k,
            d,
            j: 3.0 * k - 2.0 * d,
        }
    });
    signals.close(
        TradingClose {
            bar: bar(i, 100.0, 100.0),
            time: BASE + (i as u64 + 1) * MINUTE - 1,
            atr: indicators.atr,
        },
        indicators,
        c,
        enabled,
        &mut vec![],
        [true, true],
    )
}

#[test]
fn kdj_consumes_one_low_high_episode_and_requires_a_later_crossover() {
    for short in [false, true] {
        let mut c = kdj_config();
        c.strategy.filter = "none".into();
        let mut indicators = Indicators::default();
        for i in 0..14 {
            indicators.close(bar(i, 100.0, 100.0), &c.strategy);
        }
        let mut signals = Signals::default();
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            14,
            30.0,
            40.0,
            true,
            short
        )
        .is_none());
        // A crossover on the same low/high-zone entry candle cannot enter.
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            15,
            19.0,
            18.0,
            true,
            short
        )
        .is_none());
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            16,
            17.0,
            18.0,
            true,
            short
        )
        .is_none());
        let candidate = synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            17,
            19.0,
            18.0,
            true,
            short,
        )
        .unwrap();
        assert_eq!(candidate.side, if short { Side::Short } else { Side::Long });
        assert_eq!(candidate.entry_signal.boundary, None);
        let EntryTrigger::Kdj(trigger) = candidate.entry_signal.trigger.unwrap() else {
            panic!("expected KDJ trigger")
        };
        assert_eq!(trigger.armed_at, BASE + 16 * MINUTE - 1);
        assert!(trigger.armed_at < candidate.entry_signal.time);
        assert_eq!(trigger.previous_k, if short { 83.0 } else { 17.0 });
        let serialized = serde_json::to_value(candidate.entry_signal).unwrap();
        assert!(serialized.get("boundary").is_none());
        assert_eq!(serialized["trigger"]["kind"], "kdj-cross");
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            18,
            17.0,
            18.0,
            true,
            short
        )
        .is_none());
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            19,
            19.0,
            18.0,
            true,
            short
        )
        .is_none());
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            20,
            30.0,
            40.0,
            true,
            short
        )
        .is_none());
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            21,
            17.0,
            18.0,
            true,
            short
        )
        .is_none());
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            22,
            19.0,
            18.0,
            true,
            short
        )
        .is_some());
    }
}

#[test]
fn disabled_entry_consumes_the_kdj_episode_instead_of_reviving_it_later() {
    for short in [false, true] {
        let mut c = kdj_config();
        c.strategy.filter = "none".into();
        let mut indicators = Indicators::default();
        for i in 0..14 {
            indicators.close(bar(i, 100.0, 100.0), &c.strategy);
        }
        let mut signals = Signals::default();
        synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            14,
            30.0,
            40.0,
            true,
            short,
        );
        synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            15,
            17.0,
            18.0,
            false,
            short,
        );
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            16,
            19.0,
            18.0,
            true,
            short
        )
        .is_none());
        synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            17,
            30.0,
            40.0,
            true,
            short,
        );
        synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            18,
            17.0,
            18.0,
            true,
            short,
        );
        signals.reset();
        assert!(synthetic_cross(
            &mut signals,
            &mut indicators,
            &c,
            19,
            19.0,
            18.0,
            true,
            short
        )
        .is_none());
    }
}

fn staged_close(side: Side, r: f64, atr: f64) -> TradingClose {
    let price = 100.0 + side.sign() * 6.0 * r;
    TradingClose {
        bar: bar(2, price, price),
        time: BASE + 3 * MINUTE - 1,
        atr,
    }
}

#[test]
fn staged_protection_uses_close_r_latches_stages_and_tracks_dynamic_atr_monotonically() {
    for side in [Side::Long, Side::Short] {
        let mut c = kdj_config();
        c.execution.fee_bps = 0.0;
        c.execution.slippage_bps = 0.0;
        let mut p = position(side);
        p.mfe = 15.0;
        let below = staged_decision(&p, staged_close(side, 0.5, 4.0), &c.strategy, &c.execution);
        assert!(!below.stages.break_even && !below.stages.trailing);
        assert!(
            below.stop.is_none(),
            "an intrabar MFE beyond 2R does not activate close-R stages"
        );
        let be = staged_decision(&p, staged_close(side, 1.0, 4.0), &c.strategy, &c.execution);
        assert!(be.stages.break_even && !be.stages.trailing);
        p.stages = be.stages;
        p.stop = be.stop.unwrap().price;
        let retraced = staged_decision(&p, staged_close(side, 0.5, 4.0), &c.strategy, &c.execution);
        assert!(retraced.stages.break_even);
        let trail = staged_decision(&p, staged_close(side, 2.0, 4.0), &c.strategy, &c.execution);
        assert!(trail.stages.trailing);
        assert!((trail.stop.unwrap().price - (100.0 + side.sign() * 3.0)).abs() < 1e-9);
        p.stages = trail.stages;
        p.stop = trail.stop.unwrap().price;
        let shrunk = staged_decision(&p, staged_close(side, 1.9, 2.0), &c.strategy, &c.execution);
        assert!(
            shrunk.stages.trailing,
            "stage remains active after close drops below 2R"
        );
        assert!((shrunk.stop.unwrap().price - (100.0 + side.sign() * 9.0)).abs() < 1e-9);
        p.stop = shrunk.stop.unwrap().price;
        let expanded =
            staged_decision(&p, staged_close(side, 1.9, 10.0), &c.strategy, &c.execution);
        assert!(expanded.stop.is_none());
        assert_eq!((p.initial_distance, p.signal_atr), (6.0, 2.0));
    }
}

#[test]
fn zero_break_even_disables_it_and_zero_trailing_starts_at_a_nonnegative_close() {
    let mut c = kdj_config();
    c.strategy.staged = Some(Staged {
        break_even_r: 0.0,
        trailing_start_r: 0.0,
    });
    let p = position(Side::Long);
    assert!(
        !staged_decision(
            &p,
            staged_close(Side::Long, -0.1, 2.0),
            &c.strategy,
            &c.execution
        )
        .stages
        .trailing
    );
    let d = staged_decision(
        &p,
        staged_close(Side::Long, 0.0, 2.0),
        &c.strategy,
        &c.execution,
    );
    assert!(!d.stages.break_even && d.stages.trailing);
}

#[test]
fn only_v6_accepts_kdj_slow_ema_and_explicit_staged_policy() {
    let c = kdj_config();
    assert!(c.validate().is_ok());
    for version in [4, 5] {
        let mut old = c.clone();
        old.version = version;
        if version == 4 {
            old.strategy.max_cost_atr = None;
        }
        assert!(old.validate().is_err());
    }
    let mut bad = c.clone();
    bad.strategy.staged = None;
    assert!(bad.validate().is_err());
    bad = c.clone();
    bad.strategy.management = "atr".into();
    assert!(bad.validate().is_err());
    for value in [f64::NAN, -0.01, 20.01] {
        bad = c.clone();
        bad.strategy.staged.as_mut().unwrap().break_even_r = value;
        assert!(bad.validate().is_err());
    }
    for version in [4, 5] {
        let mut old = config();
        old.version = version;
        if version == 4 {
            old.strategy.max_cost_atr = None;
        }
        assert!(old.validate().is_ok());
    }
}

fn kdj_history(minutes: usize, short: bool) -> Vec<Bar> {
    (0usize..100)
        .flat_map(|i| {
            let open = 80.0 + i.saturating_sub(1) as f64 * 0.2;
            let close = 80.0 + i as f64 * 0.2;
            (0..minutes).map(move |m| {
                let mut b = bar(
                    i * minutes + m,
                    open + (close - open) * m as f64 / minutes as f64,
                    open + (close - open) * (m + 1) as f64 / minutes as f64,
                );
                if m == 0 {
                    b.high = if i == 80 { 160.0 } else { close + 0.1 };
                    b.low = open - 0.1;
                }
                if short {
                    b = Bar {
                        open: 200.0 - b.open,
                        close: 200.0 - b.close,
                        high: 200.0 - b.low,
                        low: 200.0 - b.high,
                        ..b
                    };
                }
                b
            })
        })
        .collect()
}

fn replay_period(c: Config, bars: &[Bar], partition: usize) -> (Metrics, Chunk) {
    let minutes = c.strategy.trade_minutes;
    let mut e = Engine::new(
        c,
        vec![],
        BASE + 60 * minutes as u64 * MINUTE,
        BASE + bars.len() as u64 * MINUTE,
        BASE,
    )
    .unwrap();
    let mut out = Chunk::default();
    for rows in bars.chunks(partition) {
        for b in rows {
            e.advance(*b, *b).unwrap();
        }
        let chunk = e.drain();
        out.trades.extend(chunk.trades);
        out.events.extend(chunk.events);
        out.equity.extend(chunk.equity);
        out.indicators.extend(chunk.indicators);
        out.contexts.extend(chunk.contexts);
    }
    let metrics = e.finish().unwrap();
    let chunk = e.drain();
    out.trades.extend(chunk.trades);
    out.events.extend(chunk.events);
    out.equity.extend(chunk.equity);
    out.indicators.extend(chunk.indicators);
    out.contexts.extend(chunk.contexts);
    (metrics, out)
}

#[test]
fn real_kdj_signals_enter_next_open_symmetrically_without_future_or_partition_dependence() {
    for short in [false, true] {
        for minutes in [1, 5] {
            let mut c = kdj_config();
            c.strategy.trade_minutes = minutes;
            let bars = kdj_history(minutes, short);
            let (metrics, out) = replay_period(c.clone(), &bars, bars.len());
            assert_eq!(
                out.trades.len(),
                1,
                "{}",
                serde_json::to_string(&out.events).unwrap()
            );
            let trade = &out.trades[0];
            assert_eq!(trade.side, if short { Side::Short } else { Side::Long });
            assert_eq!(trade.entry_time, trade.entry_signal.time + 1);
            assert_eq!((trade.entry_signal.time + 1) % (minutes as u64 * MINUTE), 0);
            let EntryTrigger::Kdj(trigger) = trade.entry_signal.trigger.unwrap() else {
                panic!("expected KDJ trigger")
            };
            assert!(trigger.armed_at < trade.entry_signal.time);
            assert!(trigger.slow_ema.is_some() && trigger.slow_ema3_ago.is_some());
            assert!(if short {
                trigger.armed_k >= 80.0
            } else {
                trigger.armed_k <= 20.0
            });
            let (split, split_out) = replay_period(c.clone(), &bars, 7);
            assert_eq!(
                serde_json::to_value(&metrics).unwrap(),
                serde_json::to_value(split).unwrap()
            );
            assert_eq!(
                serde_json::to_value(&out).unwrap(),
                serde_json::to_value(split_out).unwrap()
            );
            let mut future = bars.clone();
            let cutoff = trade.entry_time + MINUTE;
            for b in future.iter_mut().filter(|b| b.time >= cutoff) {
                b.high += 500.0;
                b.close += 500.0;
            }
            let (_, changed) = replay_period(c, &future, 7);
            let prefix = |events: &[Event]| {
                serde_json::to_value(
                    events
                        .iter()
                        .filter(|e| e.time < cutoff)
                        .collect::<Vec<_>>(),
                )
                .unwrap()
            };
            assert_eq!(prefix(&out.events), prefix(&changed.events));
            let entry_index = ((trade.entry_time - BASE) / MINUTE) as usize;
            let mfe = bars[entry_index..]
                .iter()
                .map(|b| {
                    if short {
                        trade.entry_price - b.low
                    } else {
                        b.high - trade.entry_price
                    }
                })
                .fold(0.0, f64::max);
            assert!((trade.mfe_r * trade.risk / trade.quantity - mfe).abs() < 1e-9);
            assert!(mfe < 10.0, "pre-entry spike cannot be a trailing anchor");
        }
    }
}

#[test]
fn staged_updates_only_on_full_trading_close_and_crossed_stop_locks_next_open_exit() {
    for short in [false, true] {
        let mut c = config();
        c.strategy.trade_minutes = 5;
        c.strategy.management = "staged".into();
        c.strategy.staged = Some(Staged {
            break_even_r: 0.0,
            trailing_start_r: 0.0,
        });
        c.strategy.trailing_atr = 1.0;
        let mut bars = period_history(5, false);
        bars[331].high = 110.0;
        for (i, b) in bars.iter_mut().enumerate().skip(335) {
            *b = bar(i, 111.0, 111.0);
        }
        if short {
            for b in &mut bars {
                *b = Bar {
                    open: 200.0 - b.open,
                    close: 200.0 - b.close,
                    high: 200.0 - b.low,
                    low: 200.0 - b.high,
                    ..*b
                };
            }
        }
        let (_, out) = replay_period(c.clone(), &bars, 7);
        let t = &out.trades[0];
        assert_eq!(t.entry_time, bars[330].time);
        let stop = out
            .events
            .iter()
            .find(|e| e.kind == "stop" && e.reason == "trailing")
            .unwrap();
        assert_eq!(stop.time, bars[334].time + MINUTE - 1);
        assert!(t.side.sign() * (stop.price - bars[334].close) > 0.0);
        assert!(
            t.side.sign() * (bars[335].open - stop.price) > 0.0,
            "the opening gap recovered beyond the protection line"
        );
        assert_eq!(t.reason, "protection-crossed");
        assert_eq!(t.exit_time, bars[335].time);
        assert_eq!(
            t.exit_price,
            c.execution.fill(bars[335].open, short).unwrap()
        );
        assert_eq!(
            out.events
                .iter()
                .filter(|e| e.kind == "stage" && e.reason == "trailing-armed")
                .count(),
            1
        );
    }
}

#[test]
fn invalid_background_direction_consumes_the_episode_before_a_later_valid_crossover() {
    let mut c = kdj_config();
    c.strategy.filter = "background".into();
    let mut indicators = Indicators::default();
    for i in 0..14 {
        indicators.close(bar(i, 100.0, 100.0), &c.strategy);
    }
    let mut signals = Signals::default();
    synthetic_cross(
        &mut signals,
        &mut indicators,
        &c,
        14,
        30.0,
        40.0,
        true,
        false,
    );
    indicators.previous_kdj = indicators.kdj;
    indicators.kdj = Some(Kdj {
        k: 17.0,
        d: 18.0,
        j: 15.0,
    });
    assert!(signals
        .close(
            TradingClose {
                bar: bar(15, 100.0, 100.0),
                time: BASE + 16 * MINUTE - 1,
                atr: indicators.atr
            },
            &indicators,
            &c,
            true,
            &mut vec![],
            [false, true]
        )
        .is_none());
    assert!(synthetic_cross(
        &mut signals,
        &mut indicators,
        &c,
        16,
        19.0,
        18.0,
        true,
        false
    )
    .is_none());
    synthetic_cross(
        &mut signals,
        &mut indicators,
        &c,
        17,
        30.0,
        40.0,
        true,
        false,
    );
    synthetic_cross(
        &mut signals,
        &mut indicators,
        &c,
        18,
        17.0,
        18.0,
        true,
        false,
    );
    assert!(synthetic_cross(
        &mut signals,
        &mut indicators,
        &c,
        19,
        19.0,
        18.0,
        true,
        false
    )
    .is_some());
}
