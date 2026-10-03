use super::{
    config::Config,
    engine::Engine,
    indicators::{CandleBuilder, Indicators},
    model::*,
    reader,
};
const BASE: u64 = 1_704_067_200_000;
mod architecture_contract;
mod breakout_policy_contract;
mod execution_contract;
mod kdj_contract;
mod price_action_contract;
mod protection_contract;

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
    let mut c = Config::default();
    c.strategy.filter = "none".into();
    c.strategy.entry = "pullback".into();
    c.strategy.management = "atr".into();
    c.strategy.direction = "both".into();
    c.strategy.trade_minutes = 1;
    c.strategy.stop_atr = 1.5;
    c.strategy.break_even_atr = 0.0;
    c.strategy.trailing_atr = 20.0;
    c.execution.tick_size = 0.01;
    c.execution.min_notional = 1.0;
    c.risk.daily_loss_pct = 0.0;
    c
}
fn period_config(minutes: usize) -> Config {
    let mut c = config();
    c.strategy.trade_minutes = minutes;
    c
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
            output.contexts.extend(chunk.contexts);
        }
    }
    let metrics = engine.finish().unwrap();
    let tail = engine.drain();
    output.trades.extend(tail.trades);
    output.events.extend(tail.events);
    output.equity.extend(tail.equity);
    output.indicators.extend(tail.indicators);
    output.contexts.extend(tail.contexts);
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
        assert!((m.final_equity - config().execution.initial_capital - t.net_pnl).abs() < 1e-8);
        assert!(t.net_pnl > 0.0);
    }
}
#[test]
fn breakout_snapshot_uses_only_the_previous_n_candles() {
    use super::signals::Signals;
    for short in [false, true] {
        let mut c = config();
        c.strategy.entry = "breakout".into();
        c.strategy.breakout_bars = 3;
        let mut bars: Vec<Bar> = (0..26).map(|i| bar(i, 100.0, 100.0)).collect();
        bars[21].high = 150.0; // Outside the previous three-candle window.
        bars[22].high = 105.0;
        bars[23].high = 104.0;
        bars[24].high = 103.0;
        bars[25].close = 105.02;
        bars[25].high = 130.0; // The signal candle must not enter its own boundary.
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
        let mut signals = Signals::default();
        let mut indicators = Indicators::default();
        let mut events = vec![];
        for b in &bars[..25] {
            let close = indicators.close(*b, &c.strategy).trade.unwrap();
            assert!(signals
                .close(close, &indicators, &c, false, &mut events, [true, true])
                .is_none());
        }
        let b = bars[25];
        let close = indicators.close(b, &c.strategy).trade.unwrap();
        let candidate = signals
            .close(close, &indicators, &c, true, &mut events, [true, true])
            .unwrap();
        let expected = EntrySignal {
            time: b.time + MINUTE - 1,
            price: b.close,
            boundary: Some(if short { 95.0 } else { 105.0 }),
            atr: indicators.atr,
            lookback_bars: Some(3),
            trigger: None,
        };
        assert_eq!(candidate.side, if short { Side::Short } else { Side::Long });
        assert_eq!(candidate.entry_signal, expected);
        assert_eq!(candidate.atr, expected.atr);
        let event = events.last().unwrap();
        assert_eq!(event.kind, "signal");
        assert_eq!(event.entry_signal, Some(expected));
        assert_eq!(event.value, None); // Existing breakout value semantics stay unchanged.
    }
}
#[test]
fn next_open_gap_preserves_the_pullback_signal_snapshot() {
    for short in [false, true] {
        let mut bars = history(short);
        let side = if short { Side::Short } else { Side::Long };
        for b in &mut bars[66..] {
            let gap = side.sign() * 1.5;
            b.open += gap;
            b.high += gap;
            b.low += gap;
            b.close += gap;
        }
        let c = config();
        let mut indicators = Indicators::default();
        for b in &bars[..66] {
            indicators.close(*b, &c.strategy);
        }
        let (_, out) = replay(c.clone(), &bars, vec![], false);
        assert_eq!(out.trades.len(), 1);
        let trade = &out.trades[0];
        let event = out.events.iter().find(|e| e.kind == "signal").unwrap();
        let expected = EntrySignal {
            time: bars[65].time + MINUTE - 1,
            price: bars[65].close,
            boundary: Some(if short { bars[62].low } else { bars[62].high }),
            atr: indicators.atr,
            lookback_bars: None,
            trigger: None,
        };
        assert_eq!(trade.entry_signal, expected);
        assert_eq!(event.entry_signal, Some(expected));
        assert_eq!(trade.entry_time, expected.time + 1);
        assert_eq!(
            trade.entry_price,
            c.execution.fill(bars[66].open, !short).unwrap()
        );
        assert!((trade.entry_price - expected.price).abs() > 1.0);
        assert!(event.value.is_some()); // Pullback value remains its structural anchor.
        let serialized = serde_json::to_value(trade).unwrap();
        assert_eq!(
            serialized["entrySignal"]["boundary"],
            expected.boundary.unwrap()
        );
        assert!(serialized["entrySignal"].get("lookbackBars").is_none());
        assert!(out
            .events
            .iter()
            .filter(|e| e.kind != "signal")
            .all(|e| e.entry_signal.is_none()));
    }
}
#[test]
fn optional_ema_is_unchanged_until_trading_candle_close() {
    let mut c = period_config(5);
    c.strategy.filter = "ema".into();
    let mut indicators = Indicators::default();
    for i in 0..4 {
        assert!(
            !indicators
                .close(bar(i, 100.0, 101.0), &c.strategy)
                .ema_updated
        );
        assert_eq!(indicators.fast, 0.0);
    }
    assert!(
        indicators
            .close(bar(4, 100.0, 101.0), &c.strategy)
            .ema_updated
    );
    let fast = indicators.fast;
    for i in 5..9 {
        assert!(
            !indicators
                .close(bar(i, 101.0, 1000.0), &c.strategy)
                .ema_updated
        );
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
        assert!((m.final_equity - config().execution.initial_capital - t.net_pnl).abs() < 1e-8);
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
    assert!(t.net_pnl < -config().execution.initial_capital * config().risk.risk_pct); // gap can exceed budget
    let modelled_fill = (t.initial_stop * (1.0 - config().execution.slippage_bps / 10_000.0)
        / config().execution.tick_size)
        .floor()
        * config().execution.tick_size;
    let risk = (t.entry_price - modelled_fill
        + (t.entry_price + modelled_fill) * config().execution.fee_bps / 10_000.0)
        * t.quantity;
    assert!(risk <= config().execution.initial_capital * config().risk.risk_pct + 1e-8);
    assert!((m.fees - t.fees).abs() < 1e-8);
}
#[test]
fn stop_improvement_does_not_fill_retroactively_in_the_same_bar() {
    let mut bars = history(false);
    let mut c = config();
    c.strategy.break_even_atr = 0.1;
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
    c.risk.flatten_minute = Some(67);
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
fn slippage_attribution_reconciles_without_deducting_fills_twice() {
    for short in [false, true] {
        let bars = history(short);
        let mut c = config();
        c.execution.fee_bps = 7.0;
        c.execution.slippage_bps = 3.0;
        c.execution.tick_size = 0.03;
        let funding = vec![Funding {
            time: bars[67].time + 1,
            rate: 0.001,
            interval_hours: 8.0,
        }];
        let initial = c.execution.initial_capital;
        let (metrics, out) = replay(c.clone(), &bars, funding.clone(), false);
        let (drained, _) = replay(c, &bars, funding, true);
        assert_eq!(
            serde_json::to_string(&metrics).unwrap(),
            serde_json::to_string(&drained).unwrap()
        );
        assert_eq!(out.trades.len(), 1);
        let t = &out.trades[0];
        assert_eq!(t.reason, "end-range");
        let raw_entry = bars[((t.entry_time - BASE) / MINUTE) as usize].open;
        let raw_exit = bars.last().unwrap().close;
        let reference = t.side.sign() * (raw_exit - raw_entry) * t.quantity;
        let expected_slippage =
            t.side.sign() * ((t.entry_price - raw_entry) + (raw_exit - t.exit_price)) * t.quantity;
        assert!(expected_slippage > 0.0);
        assert!((t.slippage_and_rounding - expected_slippage).abs() < 1e-9);
        let costs = &metrics.evaluation.costs;
        assert!((costs.slippage_and_rounding - expected_slippage).abs() < 1e-9);
        assert!((costs.gross_before_costs - reference).abs() < 1e-9);
        assert!((costs.cost_to_gross_profit.unwrap() - costs.total / reference).abs() < 1e-9);
        assert!((costs.fees - metrics.fees).abs() < 1e-9);
        assert!((costs.funding - metrics.funding).abs() < 1e-9);
        assert!(if short {
            costs.funding < 0.0
        } else {
            costs.funding > 0.0
        });
        assert!((costs.net_pnl - t.net_pnl).abs() < 1e-9);
        assert!((costs.gross_before_costs - costs.total - costs.net_pnl).abs() < 1e-9);
        assert!((metrics.final_equity - initial - costs.net_pnl).abs() < 1e-8);
        assert!((t.gross_pnl - t.fees - t.funding - t.net_pnl).abs() < 1e-9);
        assert!(
            (metrics.evaluation.daily.last().unwrap().equity - metrics.final_equity).abs() < 1e-9
        );
    }
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
    c.strategy.entry = "breakout".into();
    c.strategy.breakout_bars = 2;
    c.strategy.stop_atr = 0.25;
    c.execution.fee_bps = 0.0;
    c.execution.slippage_bps = 0.0;
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
    c.risk.daily_loss_pct = 0.0001;
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
    let c = period_config(5);
    let mut indicators = Indicators::default();
    for i in 0..4 {
        assert!(indicators
            .close(bar(i, 100.0 + i as f64, 101.0 + i as f64), &c.strategy)
            .trade
            .is_none());
        assert_eq!(indicators.atr, 0.0);
    }
    let candle = indicators
        .close(bar(4, 104.0, 105.0), &c.strategy)
        .trade
        .unwrap();
    assert_eq!(candle.bar.time, BASE);
    assert_eq!(candle.time, BASE + 5 * MINUTE - 1);
    assert_eq!(candle.atr, indicators.atr);
    assert_eq!(candle.bar.open, 100.0);
    assert_eq!(candle.bar.close, 105.0);
    assert_eq!(candle.bar.volume, 50.0);
    assert!((candle.bar.high - 105.05).abs() < 1e-9);
    assert!((indicators.atr - 5.1).abs() < 1e-9);
    let prior = indicators.atr;
    for i in 5..9 {
        indicators.close(bar(i, 105.0, 1000.0), &c.strategy);
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

#[test]
fn wilder_atr_seeds_with_fourteen_true_ranges_and_includes_gaps() {
    let c = config();
    let mut indicators = Indicators::default();
    for i in 0..14 {
        let b = Bar {
            high: 101.0,
            low: 99.0,
            ..bar(i, 100.0, 100.0)
        };
        indicators.close(b, &c.strategy);
        assert_eq!(indicators.atr, 2.0);
        assert_eq!(indicators.ready(), i == 13);
    }
    // The gap from the previous close (100), not this candle's range (3),
    // determines TR=12. Wilder ATR is (13*2 + 12)/14 = 19/7.
    indicators.close(
        Bar {
            high: 112.0,
            low: 109.0,
            ..bar(14, 110.0, 111.0)
        },
        &c.strategy,
    );
    assert!((indicators.atr - 19.0 / 7.0).abs() < 1e-12);
    // A downward gap contributes TR=111-88=23, giving ATR=204/49.
    indicators.close(
        Bar {
            high: 92.0,
            low: 88.0,
            ..bar(15, 91.0, 89.0)
        },
        &c.strategy,
    );
    assert!((indicators.atr - 204.0 / 49.0).abs() < 1e-12);
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
    let c = period_config(5);
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
        out.contexts.extend(chunk.contexts);
    }
    let metrics = engine.finish().unwrap();
    let chunk = engine.drain();
    out.trades.extend(chunk.trades);
    out.events.extend(chunk.events);
    out.equity.extend(chunk.equity);
    out.indicators.extend(chunk.indicators);
    out.contexts.extend(chunk.contexts);
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
        assert_eq!(signal.entry_signal, Some(t.entry_signal));
        assert_eq!(t.entry_signal.price, bars[329].close);
        assert_eq!(t.entry_signal.time, signal.time);
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
    let c = period_config(1440);
    assert!(Engine::new(c.clone(), vec![], BASE + 60 * DAY, BASE + 61 * DAY, BASE).is_ok());
    let mut invalid = c.clone();
    invalid.risk.flatten_minute = Some(1437);
    assert!(invalid.validate().is_err());
    invalid = c;
    invalid.strategy.trade_minutes = 7;
    assert!(invalid.validate().is_err());
}

#[test]
fn daily_signals_enter_at_next_utc_midnight_and_positions_survive_new_days() {
    let bars = period_history(1440, false);
    let mut e = Engine::new(
        period_config(1440),
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

#[test]
fn pure_channel_has_no_ema_gate_and_uses_exact_entry_atr_risk() {
    for short in [false, true] {
        let mut c = config();
        c.strategy.entry = "breakout".into();
        let original = history(short);
        let mut bars = original[..20].to_vec();
        bars.extend(original[60..].iter().copied());
        for (i, b) in bars.iter_mut().enumerate() {
            b.time = BASE + i as u64 * MINUTE;
        }
        let run = |config: Config| {
            let mut engine = Engine::new(
                config,
                vec![],
                BASE + 20 * MINUTE,
                BASE + bars.len() as u64 * MINUTE,
                BASE,
            )
            .unwrap();
            for b in &bars {
                engine.advance(*b, *b).unwrap();
            }
            engine.finish().unwrap();
            engine.drain()
        };
        let out = run(c.clone());
        let t = &out.trades[0];
        assert_eq!(t.side, if short { Side::Short } else { Side::Long });
        // Channel/ATR are ready before the optional slow EMA's 60 candles.
        assert_eq!(t.entry_time, BASE + 21 * MINUTE);
        assert!(out.indicators.is_empty());
        let mut indicators = Indicators::default();
        for b in bars.iter().take(21) {
            indicators.close(*b, &c.strategy);
        }
        let distance = (t.entry_price - t.initial_stop).abs();
        assert!(distance >= indicators.atr * c.strategy.stop_atr);
        assert!(distance < indicators.atr * c.strategy.stop_atr + c.execution.tick_size + 1e-9);
        c.strategy.filter = "ema".into();
        assert!(run(c).trades.is_empty());
    }
}

// Test adapter: production observes excursions and commits decisions in Engine.
fn update_protection(
    p: &mut super::position::Position,
    bar: Bar,
    strategy: &super::config::Strategy,
    execution: &super::config::Execution,
) -> Option<&'static str> {
    let close = MinuteClose(bar);
    p.observe_minute(close);
    let update = super::management::protection_decision(p, close, strategy, execution)?;
    p.stop = update.price;
    p.stop_reason = update.reason;
    Some(update.reason)
}

fn position(side: Side) -> super::position::Position {
    super::position::Position {
        id: 1,
        side,
        time: BASE,
        entry: 100.0,
        entry_signal: EntrySignal {
            time: BASE - 1,
            price: 100.0,
            boundary: Some(100.0 - side.sign()),
            atr: 2.0,
            lookback_bars: Some(20),
            trigger: None,
        },
        quantity: 1.0,
        initial_stop: 100.0 - side.sign() * 6.0,
        stop: 100.0 - side.sign() * 6.0,
        initial_distance: 6.0,
        signal_atr: 2.0,
        entry_fee: 0.0,
        entry_slippage_and_rounding: 0.0,
        funding: 0.0,
        mfe: 0.0,
        mae: 0.0,
        stop_reason: "initial",
        stages: super::position::Stages::default(),
    }
}
#[test]
fn breakeven_trigger_uses_frozen_atr_not_initial_r_and_covers_costs() {
    for side in [Side::Long, Side::Short] {
        let mut c = config();
        c.strategy.break_even_atr = 1.0;
        c.strategy.trailing_atr = 20.0;
        let mut p = position(side);
        p.entry_fee = p.entry * c.execution.fee();
        p.funding = 0.02;
        let mut b = bar(1, 100.0 + side.sign() * 2.5, 100.0 + side.sign() * 2.5);
        b.high = b.open + 0.01;
        b.low = b.open - 0.01;
        assert!(p.initial_distance > 2.51); // 1 R not reached; 1 ATR reached.
        assert_eq!(
            update_protection(&mut p, b, &c.strategy, &c.execution),
            Some("breakeven")
        );
        let price = c.execution.fill(p.stop, side == Side::Short).unwrap();
        let net =
            side.sign() * (price - p.entry) - p.entry_fee - price * c.execution.fee() - p.funding;
        assert!(net >= 0.0);
    }
}
#[test]
fn trailing_has_no_extra_activation_threshold_and_never_loosens() {
    for side in [Side::Long, Side::Short] {
        let mut c = config();
        c.strategy.trailing_atr = 2.0;
        let mut p = position(side);
        let b = bar(0, 100.0, 100.0 + side.sign() * 1.0);
        assert_eq!(
            update_protection(&mut p, b, &c.strategy, &c.execution),
            Some("trailing")
        );
        let stop = p.stop;
        assert!(side.sign() * (stop - p.initial_stop) > 0.0);
        for i in 1..8 {
            let b = bar(i, 100.0, 100.0);
            update_protection(&mut p, b, &c.strategy, &c.execution);
            assert_eq!(p.stop, stop);
        }
    }
}
#[test]
fn prefix_decisions_do_not_depend_on_future_candles_for_any_variant() {
    for entry in ["breakout", "pullback"] {
        let mut c = config();
        c.strategy.entry = entry.into();
        let base = history(false);
        let mut future = base.clone();
        for b in future.iter_mut().skip(68) {
            b.high += 1000.0;
            b.close += 1000.0;
        }
        let (_, a) = replay(c.clone(), &base, vec![], false);
        let (_, b) = replay(c, &future, vec![], false);
        let prefix = |out: Chunk| {
            out.events
                .into_iter()
                .filter(|e| e.time < BASE + 68 * MINUTE)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            serde_json::to_string(&prefix(a)).unwrap(),
            serde_json::to_string(&prefix(b)).unwrap()
        );
    }
}
#[test]
fn risk_cooldown_counts_net_losses_and_resets_on_flat_trade() {
    let c = config();
    let mut risk = super::risk::RiskState::default();
    assert!(risk.record_trade(-1.0, BASE, &c.risk).is_none());
    assert!(risk.record_trade(-1.0, BASE, &c.risk).is_none());
    assert!(risk.record_trade(0.0, BASE, &c.risk).is_none());
    assert!(risk.record_trade(-1.0, BASE, &c.risk).is_none());
    assert!(risk.record_trade(-1.0, BASE, &c.risk).is_none());
    assert_eq!(
        risk.record_trade(-1.0, BASE, &c.risk),
        Some(BASE + 60 * MINUTE)
    );
    risk.begin_day(BASE + DAY, 10000.0);
    assert_eq!(risk.cooldown_until, BASE + 60 * MINUTE);
}
#[test]
fn versioned_config_rejects_unknown_nested_settings_and_invalid_exit_policy() {
    let mut json = serde_json::to_value(Config::default()).unwrap();
    json["strategy"]["trailingStartR"] = serde_json::json!(2);
    assert!(serde_json::from_value::<Config>(json).is_err());
    let mut c = Config::default();
    c.strategy.break_even_atr = f64::NAN;
    assert!(c.validate().is_err());
    c = Config::default();
    c.risk.cooldown_minutes = 0;
    assert!(c.validate().is_err());
    c = Config::default();
    c.version = 1;
    assert!(c.validate().is_err());
}

fn background_history(short: bool) -> Vec<Bar> {
    let mut bars = vec![];
    let mut previous = 100.0;
    for i in 0..210 {
        let close = previous + if i == 150 { 1.0 } else { 0.05 };
        let mut b = bar(i, previous, close);
        b.high = b.open.max(b.close) + 0.5;
        b.low = b.open.min(b.close) - 0.5;
        if short {
            b = Bar {
                open: 200.0 - b.open,
                close: 200.0 - b.close,
                high: 200.0 - b.low,
                low: 200.0 - b.high,
                ..b
            };
        }
        bars.push(b);
        previous = close;
    }
    bars
}
fn replay_background(bars: &[Bar], partition: usize) -> (Metrics, Chunk) {
    let mut c = config();
    c.strategy.entry = "breakout".into();
    c.strategy.filter = "background".into();
    c.execution.fee_bps = 0.0;
    c.execution.slippage_bps = 0.0;
    let mut engine = Engine::new(
        c,
        vec![],
        BASE + 150 * MINUTE,
        BASE + bars.len() as u64 * MINUTE,
        BASE,
    )
    .unwrap();
    let mut out = Chunk::default();
    for part in bars.chunks(partition) {
        for b in part {
            engine.advance(*b, *b).unwrap();
        }
        let chunk = engine.drain();
        out.trades.extend(chunk.trades);
        out.events.extend(chunk.events);
        out.equity.extend(chunk.equity);
        out.indicators.extend(chunk.indicators);
        out.contexts.extend(chunk.contexts);
    }
    let metrics = engine.finish().unwrap();
    let chunk = engine.drain();
    out.trades.extend(chunk.trades);
    out.events.extend(chunk.events);
    out.equity.extend(chunk.equity);
    out.indicators.extend(chunk.indicators);
    out.contexts.extend(chunk.contexts);
    (metrics, out)
}
#[test]
fn background_decisions_are_causal_symmetric_and_invariant_to_output_partitions() {
    for short in [false, true] {
        let bars = background_history(short);
        let (metrics, out) = replay_background(&bars, bars.len());
        let (split_metrics, split) = replay_background(&bars, 7);
        assert_eq!(
            serde_json::to_string(&metrics).unwrap(),
            serde_json::to_string(&split_metrics).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&out).unwrap(),
            serde_json::to_string(&split).unwrap()
        );
        assert_eq!(
            out.trades.len(),
            1,
            "{}",
            serde_json::to_string(&out.contexts).unwrap()
        );
        assert!(out.contexts[0].allowed);
        assert_eq!(out.contexts[0].time + 1, out.trades[0].entry_time);
        assert!(out
            .contexts
            .iter()
            .all(|d| d.as_of.is_none_or(|t| t <= d.time)));
        assert_eq!(metrics.context.evaluated, out.contexts.len());
        assert_eq!(
            metrics.context.evaluated,
            metrics.context.allowed + metrics.context.rejected
        );
        assert!(out.indicators.is_empty());
        let mut changed = bars.clone();
        for b in changed.iter_mut().skip(180) {
            b.high += 1000.0;
            b.close += 1000.0;
        }
        let (_, future) = replay_background(&changed, 7);
        let prefix = |chunk: Chunk| {
            chunk
                .contexts
                .into_iter()
                .filter(|d| d.time < BASE + 180 * MINUTE)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            serde_json::to_string(&prefix(out)).unwrap(),
            serde_json::to_string(&prefix(future)).unwrap()
        );
    }
}
#[test]
fn opening_gap_cannot_bypass_the_frozen_background_structure() {
    let mut bars = background_history(false);
    bars[151] = bar(151, 80.0, 80.0);
    let (_, out) = replay_background(&bars, 7);
    assert!(out.contexts[0].allowed);
    assert!(!out
        .events
        .iter()
        .any(|e| e.kind == "entry" && e.time == bars[151].time));
    assert!(out
        .events
        .iter()
        .any(|e| e.reason == "structure-invalid" && e.time == bars[151].time));
}
#[test]
fn background_has_its_own_warmup_and_never_treats_missing_context_as_permission() {
    let mut c = config();
    c.strategy.entry = "breakout".into();
    c.strategy.filter = "background".into();
    let (metrics, out) = replay(c, &history(false), vec![], true);
    assert_eq!(metrics.trades, 0);
    assert!(metrics.context.rejected > 0);
    assert!(out
        .contexts
        .iter()
        .all(|d| d.reason == "context-warmup" && !d.allowed));
}

#[test]
fn channel_management_ignores_minute_noise_and_fills_confirmed_exit_at_next_open() {
    for short in [false, true] {
        let side = if short { Side::Short } else { Side::Long };
        let mut bars = period_history(5, false);
        let mut last = bars.last().unwrap().close;
        for _ in 0..150 {
            bars.push(bar(bars.len(), last, last + 0.03));
            last += 0.03;
        }
        let reversal_start = bars.len();
        for _ in 0..5 {
            bars.push(bar(bars.len(), last, last - 0.5));
            last -= 0.5;
        }
        let fill_index = bars.len();
        for _ in 0..5 {
            // Gap at the first next-minute open; do not use signal close.
            bars.push(bar(bars.len(), last - 0.3, last - 0.3));
            last -= 0.3;
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
        let mut c = period_config(5);
        c.strategy.entry = "breakout".into();
        c.strategy.management = "channel".into();
        c.strategy.stop_atr = 20.0;
        c.strategy.break_even_atr = 0.1;
        c.strategy.trailing_atr = 0.1;
        let run = |step| {
            let mut e = Engine::new(
                c.clone(),
                vec![],
                BASE + 300 * MINUTE,
                BASE + bars.len() as u64 * MINUTE,
                BASE,
            )
            .unwrap();
            let mut out = Chunk::default();
            for (i, b) in bars.iter().enumerate() {
                e.advance(*b, *b).unwrap();
                if i % step == 0 {
                    let chunk = e.drain();
                    out.trades.extend(chunk.trades);
                    out.events.extend(chunk.events);
                }
            }
            let metrics = e.finish().unwrap();
            let chunk = e.drain();
            out.trades.extend(chunk.trades);
            out.events.extend(chunk.events);
            (metrics, out)
        };
        let (metrics, out) = run(bars.len());
        let (split_metrics, split) = run(7);
        assert_eq!(
            serde_json::to_string(&metrics).unwrap(),
            serde_json::to_string(&split_metrics).unwrap()
        );
        assert_eq!(
            serde_json::to_string(&out.trades).unwrap(),
            serde_json::to_string(&split.trades).unwrap()
        );
        let t = out
            .trades
            .iter()
            .find(|t| t.reason == "channel-exit")
            .expect("confirmed channel exit");
        assert_eq!(t.side, side);
        assert_eq!(t.exit_time, bars[fill_index].time);
        assert!(t.exit_time > bars[reversal_start].time);
        assert_eq!(
            t.exit_price,
            c.execution
                .fill(bars[fill_index].open, side == Side::Short)
                .unwrap()
        );
        assert!(!out
            .events
            .iter()
            .any(|e| e.kind == "stop" && e.reason != "initial"));
        assert_eq!(metrics.evaluation.total_days, 0);
        assert!(
            (metrics.evaluation.net_expectancy.unwrap() * metrics.trades as f64
                - out.trades.iter().map(|t| t.net_pnl).sum::<f64>())
            .abs()
                < 1e-8
        );
    }
}

#[test]
fn channel_hard_stop_remains_active_within_an_unclosed_trading_candle() {
    let mut bars = period_history(5, false);
    let mut c = period_config(5);
    c.strategy.entry = "breakout".into();
    c.strategy.management = "channel".into();
    c.strategy.breakout_bars = 20;
    c.strategy.stop_atr = 2.0;
    let replay = |bars: &[Bar]| {
        let mut e = Engine::new(
            c.clone(),
            vec![],
            BASE + 300 * MINUTE,
            BASE + bars.len() as u64 * MINUTE,
            BASE,
        )
        .unwrap();
        for b in bars {
            e.advance(*b, *b).unwrap();
        }
        e.finish().unwrap();
        e.drain()
    };
    let baseline = replay(&bars);
    let entry = baseline.trades[0].entry_time;
    let index = ((entry - BASE) / MINUTE) as usize + 1;
    bars[index].low = baseline.trades[0].initial_stop - 0.5;
    let out = replay(&bars);
    assert_eq!(out.trades[0].reason, "initial");
    assert_eq!(out.trades[0].exit_time, bars[index].time + MINUTE - 1);
}

#[test]
fn tick_breaks_accept_exact_decimal_ticks_but_not_subtick_moves() {
    let mut execution = config().execution;
    for tick in [0.01, 0.1] {
        execution.tick_size = tick;
        for boundary in [99.8, 100.1, 100.2, 50_000.2] {
            for direction in [-1.0, 1.0] {
                assert!(execution.breaks_by_tick(boundary + direction * tick, boundary, direction));
                assert!(!execution.breaks_by_tick(
                    boundary + direction * tick * 0.9999,
                    boundary,
                    direction,
                ));
                assert!(!execution.breaks_by_tick(boundary, boundary, direction));
                assert!(!execution.breaks_by_tick(
                    boundary - direction * tick,
                    boundary,
                    direction
                ));
            }
        }
    }
}

#[test]
fn current_config_requires_independent_cost_policy_and_v4_retains_legacy_shape() {
    let mut c = Config::default();
    assert_eq!(c.version, 10);
    assert_eq!(c.strategy.max_cost_atr, Some(0.0));
    assert_eq!(c.strategy.trade_minutes, 240);
    assert_eq!(c.strategy.management, "channel");
    assert_eq!(c.strategy.direction, "long");
    assert_eq!(c.strategy.filter, "background");
    assert!(c.validate().is_ok());
    for invalid in [None, Some(-0.1), Some(20.1), Some(f64::NAN)] {
        c.strategy.max_cost_atr = invalid;
        assert!(c.validate().is_err());
    }
    c.version = 4;
    c.strategy.max_cost_atr = None;
    c.strategy.filter = "none".into();
    assert!(c.validate().is_ok());
    let json = serde_json::to_value(&c).unwrap();
    assert!(json["strategy"].get("maxCostAtr").is_none());
    let legacy: Config = serde_json::from_value(json).unwrap();
    assert!(legacy.validate().is_ok());
    assert_eq!(
        legacy.cost_policy().unwrap(),
        super::config::CostPolicy::Disabled
    );
    c.strategy.filter = "background".into();
    assert_eq!(
        c.cost_policy().unwrap(),
        super::config::CostPolicy::LegacyBackground { max_atr: 0.5 }
    );
    c.strategy.max_cost_atr = Some(0.0);
    assert!(
        c.validate().is_err(),
        "v4 must not silently ignore a new policy"
    );
}

#[test]
fn warmup_days_cover_channel_ema_and_weekly_background_horizons() {
    let mut c = Config::default();
    assert_eq!(c.warmup_days(), 22);
    c.strategy.filter = "none".into();
    assert_eq!(c.warmup_days(), 4);
    c.strategy.filter = "background".into();
    assert_eq!(c.warmup_days(), 22);
    c.strategy.trade_minutes = 1440;
    assert_eq!(c.warmup_days(), 154);
    c.strategy.filter = "ema".into();
    assert_eq!(c.warmup_days(), 60);
    c.strategy.filter = "none".into();
    c.strategy.breakout_bars = 250;
    assert_eq!(c.warmup_days(), 250);
    c.strategy.trade_minutes = 1;
    assert_eq!(c.warmup_days(), 1);
}

#[test]
fn shared_contract_matches_executor_defaults_periods_and_warmup() {
    let contract: serde_json::Value =
        serde_json::from_str(include_str!("../../fixtures/trend-contract.json")).unwrap();
    assert_eq!(contract["executor"], super::ENGINE_VERSION);
    let defaults: Config = serde_json::from_value(contract["defaultConfig"].clone()).unwrap();
    defaults.validate().unwrap();
    assert_eq!(
        serde_json::to_value(defaults).unwrap(),
        serde_json::to_value(Config::default()).unwrap()
    );
    for period in contract["periods"].as_array().unwrap() {
        let minutes = period["minutes"].as_u64().unwrap() as usize;
        let mut config = Config::default();
        config.strategy.trade_minutes = minutes;
        config.validate().unwrap();
        assert_eq!(
            super::config::background_minutes(minutes),
            period["backgroundMinutes"].as_u64().unwrap() as usize,
            "trading period {minutes}"
        );
    }
    for case in contract["warmupCases"].as_array().unwrap() {
        let mut value = contract["defaultConfig"].clone();
        value["strategy"]
            .as_object_mut()
            .unwrap()
            .extend(case["strategy"].as_object().unwrap().clone());
        let config: Config = serde_json::from_value(value).unwrap();
        config.validate().unwrap();
        assert_eq!(
            config.warmup_days(),
            case["days"].as_u64().unwrap(),
            "shared warmup case: {case}"
        );
    }
}

#[test]
fn cost_policy_is_independent_of_filter_and_legacy_cost_rejections_stay_compatible() {
    let bars = background_history(false);
    let run = |c: Config| {
        let mut engine = Engine::new(
            c,
            vec![],
            BASE + 150 * MINUTE,
            BASE + bars.len() as u64 * MINUTE,
            BASE,
        )
        .unwrap();
        for b in &bars {
            engine.advance(*b, *b).unwrap();
        }
        let metrics = engine.finish().unwrap();
        (metrics, engine.drain())
    };
    for filter in ["none", "ema", "background"] {
        let mut c = config();
        c.strategy.entry = "breakout".into();
        c.strategy.filter = filter.into();
        c.execution.fee_bps = 100.0;
        c.execution.slippage_bps = 100.0;
        c.strategy.max_cost_atr = Some(0.5);
        let (restricted, output) = run(c.clone());
        assert_eq!(restricted.trades, 0, "{filter}");
        assert!(
            output.events.iter().any(|e| e.reason == "entry-cost"),
            "{filter}"
        );
        assert!(!output.events.iter().any(|e| e.reason == "context-cost"));
        if filter == "background" {
            assert!(output.contexts.iter().all(|d| d.allowed));
            assert_eq!(restricted.context.rejected, 0);
        }

        c.strategy.max_cost_atr = Some(0.0);
        let (unrestricted, new_output) = run(c.clone());
        assert!(
            unrestricted.trades > 0,
            "disabled cost policy must allow {filter}"
        );

        c.version = 4;
        c.strategy.max_cost_atr = None;
        let (legacy, old_output) = run(c);
        if filter == "background" {
            assert_eq!(legacy.trades, 0);
            assert!(old_output.events.iter().any(|e| e.reason == "context-cost"));
            assert!(old_output
                .contexts
                .iter()
                .all(|d| !d.allowed && d.reason == "context-cost"));
            assert_eq!(legacy.rejected_signals, restricted.rejected_signals);
        } else {
            assert_eq!(
                serde_json::to_value(legacy).unwrap(),
                serde_json::to_value(unrestricted).unwrap()
            );
            assert_eq!(
                serde_json::to_value(old_output).unwrap(),
                serde_json::to_value(new_output).unwrap()
            );
        }
    }
}
