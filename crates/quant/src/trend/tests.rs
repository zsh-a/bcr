use super::{
    engine::Engine,
    indicators::{CandleBuilder, Indicators},
    model::*,
    reader,
};
const BASE: u64 = 1_704_067_200_000;
fn bar(i: usize, open: f64, close: f64) -> Bar {
    Bar {
        time: BASE + i as u64 * MINUTE,
        open,
        high: open.max(close) + 0.05,
        low: open.min(close) - 0.05,
        close,
        volume: 10.0,
    }
}
fn config() -> Config {
    Config {
        fast_ema: 2,
        slow_ema: 4,
        tick_size: 0.01,
        quantity_step: 0.001,
        min_notional: 1.0,
        daily_loss_pct: 0.0,
        flatten_minute: None,
        break_even_r: 0.0,
        trailing_start_r: 100.0,
        ..Config::default()
    }
}
fn history(short: bool) -> Vec<Bar> {
    let mut bars = vec![];
    let mut last = 100.0;
    for i in 0..60 {
        let close = 100.0 + (i + 1) as f64 * 0.02;
        bars.push(bar(i, last, close));
        last = close;
    }
    for change in [1.0, 1.0, 1.0, -0.6, -0.15, 1.0, 0.4, 0.5, 0.3, 0.2] {
        bars.push(bar(bars.len(), last, last + change));
        last += change;
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
    bars
}
fn replay(config: Config, bars: &[Bar], funding: Vec<Funding>, drain: bool) -> (Metrics, Chunk) {
    let mut engine = Engine::new(
        config,
        funding,
        BASE + 60 * MINUTE,
        BASE + bars.len() as u64 * MINUTE,
        BASE,
    )
    .unwrap();
    let mut output = Chunk::default();
    for b in bars {
        engine.advance(*b, *b).unwrap();
        if drain {
            let chunk = engine.drain();
            output.trades.extend(chunk.trades);
            output.events.extend(chunk.events);
            output.equity.extend(chunk.equity);
            output.indicators.extend(chunk.indicators);
        }
    }
    let metrics = engine.finish().unwrap();
    let tail = engine.drain();
    output.trades.extend(tail.trades);
    output.events.extend(tail.events);
    output.equity.extend(tail.equity);
    output.indicators.extend(tail.indicators);
    assert!(engine.finish().is_err());
    (metrics, output)
}
#[test]
fn pullback_continuation_is_symmetric_and_enters_after_signal_close() {
    for short in [false, true] {
        let bars = history(short);
        let (m, out) = replay(config(), &bars, vec![], false);
        assert_eq!(
            m.trades,
            1,
            "events: {}",
            serde_json::to_string(&out.events).unwrap()
        );
        let t = &out.trades[0];
        assert_eq!(t.side, if short { Side::Short } else { Side::Long });
        assert_eq!(t.entry_time, bars[66].time);
        let signal = out.events.iter().find(|e| e.kind == "signal").unwrap();
        assert_eq!(signal.time + 1, t.entry_time);
        assert_eq!(t.reason, "end-range");
        assert!((m.final_equity - config().initial_capital - t.net_pnl).abs() < 1e-8);
        assert!(t.net_pnl > 0.0);
    }
}
#[test]
fn higher_period_ema_is_unchanged_until_candle_close() {
    let c = config();
    let mut indicators = Indicators::default();
    for i in 0..4 {
        assert!(!indicators.close(bar(i, 100.0, 101.0), &c).trend);
        assert_eq!(indicators.fast, 0.0);
    }
    assert!(indicators.close(bar(4, 100.0, 101.0), &c).trend);
    let fast = indicators.fast;
    for i in 5..9 {
        assert!(!indicators.close(bar(i, 101.0, 1000.0), &c).trend);
        assert_eq!(indicators.fast, fast);
    }
}
#[test]
fn gap_invalidating_pullback_is_rejected() {
    let mut bars = history(false);
    bars[66] = bar(66, 102.0, 102.0);
    for (i, b) in bars.iter_mut().enumerate().skip(67) {
        *b = bar(i, 102.0, 102.0);
    }
    let (m, out) = replay(config(), &bars, vec![], false);
    assert_eq!(m.trades, 0);
    assert!(out.events.iter().any(|e| e.reason == "structure-invalid"));
}
#[test]
fn funding_applies_to_carried_positions_before_new_entries_and_reconciles() {
    for short in [false, true] {
        let bars = history(short);
        let rate = 0.001;
        let events = vec![
            Funding {
                time: bars[66].time + 1,
                rate,
                interval_hours: 8.0,
            },
            Funding {
                time: bars[67].time + 1,
                rate,
                interval_hours: 8.0,
            },
        ];
        let (m, out) = replay(config(), &bars, events, false);
        let t = &out.trades[0];
        assert_eq!(m.funding_events, 1);
        let expected = t.side.sign() * t.quantity * bars[67].open * rate;
        assert!((t.funding - expected).abs() < 1e-9);
        assert!((m.final_equity - config().initial_capital - t.net_pnl).abs() < 1e-8);
    }
}
#[test]
fn stop_gap_fill_and_risk_budget_include_rounding_and_costs() {
    let mut bars = history(false);
    bars[67] = bar(67, 100.0, 100.0);
    for (i, b) in bars.iter_mut().enumerate().skip(68) {
        *b = bar(i, 100.0, 100.0);
    }
    let (m, out) = replay(config(), &bars, vec![], false);
    let t = &out.trades[0];
    assert_eq!(t.reason, "initial");
    assert_eq!(t.exit_time, bars[67].time);
    assert!(t.exit_price <= 100.0);
    assert!(t.net_pnl < -config().initial_capital * config().risk_pct); // gap can exceed budget
    let modelled_fill =
        (t.initial_stop * (1.0 - config().slippage_bps / 10_000.0) / config().tick_size).floor()
            * config().tick_size;
    let risk = (t.entry_price - modelled_fill
        + (t.entry_price + modelled_fill) * config().fee_bps / 10_000.0)
        * t.quantity;
    assert!(risk <= config().initial_capital * config().risk_pct + 1e-8);
    assert!((m.fees - t.fees).abs() < 1e-8);
}
#[test]
fn stop_improvement_does_not_fill_retroactively_in_the_same_bar() {
    let mut bars = history(false);
    let mut c = config();
    c.break_even_r = 0.1;
    bars[66].high = 107.0; // old stop survives, intrabar low is below new breakeven
    bars[67] = bar(67, 104.6, 104.5);
    let (_, out) = replay(c, &bars, vec![], false);
    let t = &out.trades[0];
    assert_eq!(t.reason, "breakeven");
    assert_eq!(t.exit_time, bars[67].time);
}
#[test]
fn daily_flat_closes_and_blocks_orders_for_remaining_utc_day() {
    let bars = history(false);
    let mut c = config();
    c.flatten_minute = Some(67);
    let (_, out) = replay(c, &bars, vec![], false);
    assert_eq!(out.trades.len(), 1);
    assert_eq!(out.trades[0].reason, "daily-close");
    assert_eq!(out.trades[0].exit_time, bars[67].time);
}
#[test]
fn draining_does_not_change_decisions_or_metrics() {
    let bars = history(false);
    let (a, a_out) = replay(config(), &bars, vec![], false);
    let (b, b_out) = replay(config(), &bars, vec![], true);
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
    assert_eq!(
        serde_json::to_string(&a_out.trades).unwrap(),
        serde_json::to_string(&b_out.trades).unwrap()
    );
    assert_eq!(
        serde_json::to_string(&a_out.events).unwrap(),
        serde_json::to_string(&b_out.events).unwrap()
    );
}
#[test]
fn incomplete_or_out_of_order_input_cannot_be_finished() {
    let mut e = Engine::new(config(), vec![], BASE, BASE + 2 * MINUTE, BASE).unwrap();
    assert!(e
        .advance(bar(1, 100.0, 100.0), bar(1, 100.0, 100.0))
        .is_err());
    e.advance(bar(0, 100.0, 100.0), bar(0, 100.0, 100.0))
        .unwrap();
    assert!(e.finish().is_err());
}
#[test]
fn parser_rejects_microseconds_gaps_and_unaligned_marks() {
    let csv = format!("{BASE},100,101,99,100,1,{},0,1,0,0,0\n", BASE + MINUTE - 1);
    assert_eq!(reader::candles(&csv).unwrap().len(), 1);
    assert!(reader::candles(&csv.replace(&BASE.to_string(), &(BASE * 1000).to_string())).is_err());
    let next = csv
        .replace(&BASE.to_string(), &(BASE + 2 * MINUTE).to_string())
        .replace(
            &(BASE + MINUTE - 1).to_string(),
            &(BASE + 3 * MINUTE - 1).to_string(),
        );
    assert!(reader::candles(&(csv.clone() + &next)).is_err());
    assert!(reader::aligned(&csv, &next).is_err());
}

#[test]
fn cooldown_survives_utc_midnight_and_output_drains() {
    let mut c = config();
    c.entry = "breakout".into();
    c.breakout_bars = 2;
    c.stop_atr = 0.25;
    c.max_stop_atr = 20.0;
    c.fee_bps = 0.0;
    c.slippage_bps = 0.0;
    let offset = DAY - 100 * MINUTE;
    let mut bars = history(false)[..60].to_vec();
    let mut previous = bars.last().unwrap().close;
    for i in 60..140 {
        let close = previous + if i < 66 && i % 2 == 0 { 2.0 } else { 0.02 };
        let mut b = bar(i, previous, close);
        if i < 66 && i % 2 == 1 {
            b.low = previous - 1.0;
        }
        bars.push(b);
        previous = close;
    }
    for b in &mut bars {
        b.time += offset;
    }
    let mut engine = Engine::new(
        c,
        vec![],
        BASE + offset + 60 * MINUTE,
        BASE + offset + 140 * MINUTE,
        BASE + offset,
    )
    .unwrap();
    let mut events = vec![];
    for b in bars {
        engine.advance(b, b).unwrap();
        events.extend(engine.drain().events);
    }
    engine.finish().unwrap();
    events.extend(engine.drain().events);
    let cooling = events
        .iter()
        .find(|e| e.kind == "cooldown")
        .expect("three losses cause cooldown");
    let until = cooling.value.unwrap() as u64;
    assert!(cooling.time < BASE + DAY && until > BASE + DAY);
    assert!(!events
        .iter()
        .any(|e| e.kind == "entry" && e.time > cooling.time && e.time < until));
}

#[test]
fn daily_loss_exits_at_next_open_and_locks_the_day() {
    let mut bars = history(false);
    let mut c = config();
    c.daily_loss_pct = 0.0001;
    // Mark-to-market loss without touching the initial stop; next open exits.
    bars[66] = bar(66, bars[66].open, bars[66].open - 0.25);
    bars[67] = bar(67, bars[66].close, bars[66].close + 0.5);
    let (_, out) = replay(c, &bars, vec![], false);
    assert_eq!(out.trades.len(), 1);
    assert_eq!(out.trades[0].reason, "daily-loss");
    assert_eq!(out.trades[0].exit_time, bars[67].time);
}

#[test]
fn trading_candles_and_atr_ignore_unclosed_or_partial_periods() {
    let c = Config {
        trade_minutes: 5,
        ..config()
    };
    let mut indicators = Indicators::default();
    for i in 0..4 {
        assert!(indicators
            .close(bar(i, 100.0 + i as f64, 101.0 + i as f64), &c)
            .trade
            .is_none());
        assert_eq!(indicators.atr, 0.0);
    }
    let candle = indicators.close(bar(4, 104.0, 105.0), &c).trade.unwrap();
    assert_eq!(candle.time, BASE);
    assert_eq!(candle.open, 100.0);
    assert_eq!(candle.close, 105.0);
    assert_eq!(candle.volume, 50.0);
    assert!((candle.high - 105.05).abs() < 1e-9);
    assert!((indicators.atr - 5.1).abs() < 1e-9);
    let prior = indicators.atr;
    for i in 5..9 {
        indicators.close(bar(i, 105.0, 1000.0), &c);
        assert_eq!(indicators.atr, prior);
    }
    let mut partial = CandleBuilder::default();
    for i in 2..5 {
        assert!(partial.close(bar(i, 100.0, 101.0), 5).is_none());
    }
    for i in 5..9 {
        assert!(partial.close(bar(i, 100.0, 101.0), 5).is_none());
    }
    assert_eq!(
        partial.close(bar(9, 100.0, 101.0), 5).unwrap().time,
        BASE + 5 * MINUTE
    );
}

fn period_history(minutes: usize, short: bool) -> Vec<Bar> {
    history(short)
        .into_iter()
        .enumerate()
        .flat_map(|(i, b)| {
            (0..minutes).map(move |m| {
                let mut minute = bar(
                    i * minutes + m,
                    b.open + (b.close - b.open) * m as f64 / minutes as f64,
                    b.open + (b.close - b.open) * (m + 1) as f64 / minutes as f64,
                );
                if m == 0 {
                    minute.high = b.high;
                    minute.low = b.low;
                }
                minute
            })
        })
        .collect()
}
fn replay_five(bars: &[Bar], funding: Vec<Funding>, partition_rows: usize) -> (Metrics, Chunk) {
    let c = Config {
        trade_minutes: 5,
        ..config()
    };
    let mut engine = Engine::new(
        c,
        funding,
        BASE + 300 * MINUTE,
        BASE + bars.len() as u64 * MINUTE,
        BASE,
    )
    .unwrap();
    let mut out = Chunk::default();
    for partition in bars.chunks(partition_rows) {
        for b in partition {
            engine.advance(*b, *b).unwrap();
        }
        let chunk = engine.drain();
        out.trades.extend(chunk.trades);
        out.events.extend(chunk.events);
        out.equity.extend(chunk.equity);
        out.indicators.extend(chunk.indicators);
    }
    let metrics = engine.finish().unwrap();
    let chunk = engine.drain();
    out.trades.extend(chunk.trades);
    out.events.extend(chunk.events);
    out.equity.extend(chunk.equity);
    out.indicators.extend(chunk.indicators);
    (metrics, out)
}
#[test]
fn five_minute_signal_fills_next_minute_and_is_invariant_to_partition_boundaries() {
    for short in [false, true] {
        let bars = period_history(5, short);
        let (a, out) = replay_five(&bars, vec![], bars.len());
        let (b, split) = replay_five(&bars, vec![], 7);
        assert_eq!(
            out.trades.len(),
            1,
            "{}",
            serde_json::to_string(&out.events).unwrap()
        );
        let t = &out.trades[0];
        assert_eq!(t.entry_time, BASE + 330 * MINUTE);
        let signal = out.events.iter().find(|e| e.kind == "signal").unwrap();
        assert_eq!(signal.time, BASE + 330 * MINUTE - 1);
        assert_eq!(signal.time + 1, t.entry_time);
        assert_eq!(t.side, if short { Side::Short } else { Side::Long });
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&out).unwrap(),
            serde_json::to_string(&split).unwrap()
        );
    }
}
#[test]
fn five_minute_strategy_stops_and_pays_funding_inside_an_unclosed_candle() {
    let mut bars = period_history(5, false);
    let (_, baseline) = replay_five(&bars, vec![], 7);
    let initial_stop = baseline.trades[0].initial_stop;
    bars[332].low = initial_stop - 0.1;
    let funding = vec![Funding {
        time: bars[331].time + 1,
        rate: 0.001,
        interval_hours: 8.0,
    }];
    let (metrics, out) = replay_five(&bars, funding, 7);
    let t = &out.trades[0];
    assert_eq!(t.reason, "initial");
    assert_eq!(t.exit_time, bars[332].time + MINUTE - 1);
    assert_ne!((t.exit_time + 1) % (5 * MINUTE), 0);
    assert_eq!(metrics.funding_events, 1);
    assert!((t.funding - t.quantity * bars[331].open * 0.001).abs() < 1e-9);
}
#[test]
fn daily_trading_supports_long_warmup_and_requires_overnight_positions() {
    let c = Config {
        trade_minutes: 1440,
        trend_minutes: 1440,
        flatten_minute: None,
        ..Config::default()
    };
    assert!(Engine::new(c.clone(), vec![], BASE + 60 * DAY, BASE + 61 * DAY, BASE).is_ok());
    assert!(Config {
        flatten_minute: Some(1437),
        ..c.clone()
    }
    .validate()
    .is_err());
    assert!(Config {
        trade_minutes: 15,
        trend_minutes: 5,
        ..c
    }
    .validate()
    .is_err());
}

#[test]
fn daily_signals_enter_at_next_utc_midnight_and_positions_survive_new_days() {
    let bars = period_history(1440, false);
    let mut e = Engine::new(
        Config {
            trade_minutes: 1440,
            trend_minutes: 1440,
            ..config()
        },
        vec![],
        BASE + 60 * DAY,
        BASE + 70 * DAY,
        BASE,
    )
    .unwrap();
    for b in bars {
        e.advance(b, b).unwrap();
    }
    let metrics = e.finish().unwrap();
    let out = e.drain();
    assert_eq!(
        metrics.trades,
        1,
        "{}",
        serde_json::to_string(&out.events).unwrap()
    );
    let signal = out.events.iter().find(|e| e.kind == "signal").unwrap();
    assert_eq!(signal.time, BASE + 66 * DAY - 1);
    assert_eq!(out.trades[0].entry_time, signal.time + 1);
    assert_eq!(out.trades[0].reason, "end-range");
    assert_eq!(out.trades[0].exit_time, BASE + 70 * DAY - 1);
    assert!(out.trades[0].net_pnl > 0.0);
}
