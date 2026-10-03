use super::*;
use crate::trend::config::PriceAction;

fn pa_config() -> Config {
    let mut c = config();
    c.strategy.entry = "price-action".into();
    c.strategy.filter = "slow-ema".into();
    c.strategy.trade_minutes = 5;
    c.strategy.stop_atr = 2.0;
    c.strategy.price_action = Some(PriceAction {
        key_level: true,
        two_legs: true,
    });
    c
}

fn candles(short: bool) -> Vec<Bar> {
    let mut output = Vec::new();
    let mut previous = 100.0;
    for i in 0..100 {
        let (close, high, low) = match i {
            30 => (100.0, 101.6, 99.5), // The sole earlier 30m high pivot.
            75 => (100.6, 100.7, 99.9),
            76 => (101.2, 101.3, 100.5),
            77 => (101.8, 101.9, 101.1),
            78 => (102.4, 102.5, 101.7),
            79 => (102.1, 103.0, 101.7),
            80 => (101.9, 102.2, 101.6),
            81 => (102.4, 102.5, 101.85),
            82 => (101.7, 102.5, 101.55),
            83 => (103.2, 103.3, 101.7),
            84.. => (103.3, 103.4, 103.1),
            _ => (100.0, 100.5, 99.5),
        };
        for minute in 0..5 {
            let open = previous + (close - previous) * minute as f64 / 5.0;
            let end = previous + (close - previous) * (minute + 1) as f64 / 5.0;
            let mut b = Bar {
                time: BASE + output.len() as u64 * MINUTE,
                open,
                close: end,
                high: if minute == 0 { high } else { open.max(end) },
                low: if minute == 0 { low } else { open.min(end) },
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
            output.push(b);
        }
        previous = close;
    }
    output
}

fn engine(c: Config, bars: &[Bar]) -> Engine {
    Engine::new(
        c,
        vec![],
        BASE + 60 * 5 * MINUTE,
        BASE + bars.len() as u64 * MINUTE,
        BASE,
    )
    .unwrap()
}

fn append(out: &mut Chunk, chunk: Chunk) {
    out.trades.extend(chunk.trades);
    out.events.extend(chunk.events);
    out.equity.extend(chunk.equity);
    out.indicators.extend(chunk.indicators);
    out.contexts.extend(chunk.contexts);
}

fn run(c: Config, bars: &[Bar], drain_every: usize) -> (Metrics, Chunk) {
    let mut engine = engine(c, bars);
    let mut out = Chunk::default();
    for (i, b) in bars.iter().enumerate() {
        engine.advance(*b, *b).unwrap();
        if (i + 1) % drain_every == 0 {
            append(&mut out, engine.drain());
        }
    }
    let metrics = engine.finish().unwrap();
    append(&mut out, engine.drain());
    (metrics, out)
}

#[test]
fn price_action_five_minute_two_leg_retest_enters_next_open_in_both_directions() {
    for short in [false, true] {
        let c = pa_config();
        let bars = candles(short);
        let (metrics, out) = run(c.clone(), &bars, usize::MAX);
        assert_eq!(
            metrics.trades,
            1,
            "{}",
            serde_json::to_string(&out.events).unwrap()
        );
        assert_eq!(metrics.rejected_signals, 0);
        let trade = &out.trades[0];
        assert_eq!(trade.side, if short { Side::Short } else { Side::Long });
        assert_eq!(trade.entry_time, bars[84 * 5].time);
        assert_eq!(trade.entry_signal.time + 1, trade.entry_time);
        let Some(EntryTrigger::PriceAction(trigger)) = trade.entry_signal.trigger else {
            panic!("price-action snapshot missing")
        };
        assert_eq!(
            trigger.impulse_start_time,
            bars[74 * 5 + 4].time + MINUTE - 1
        );
        assert_eq!(
            trigger.impulse_confirmed_at,
            bars[77 * 5 + 4].time + MINUTE - 1
        );
        assert_eq!(trigger.pullback_bars, 5);
        assert_eq!(trigger.leg_count, 2);
        assert_eq!(trigger.impulse_extreme, if short { 97.0 } else { 103.0 });
        let key = trigger.key_level.unwrap();
        assert_eq!(key.minutes, 30);
        assert_eq!(key.pivot_time, bars[30 * 5].time);
        assert_eq!(key.confirmed_at, bars[48 * 5].time - 1);
        assert!(key.confirmed_at <= trigger.impulse_start_time);
        assert_eq!(key.retest_time, Some(bars[80 * 5].time - 1));
        assert!(key.valid);
        let mut indicators = Indicators::default();
        for b in &bars[..84 * 5] {
            indicators.close(*b, &c.strategy);
        }
        assert_eq!(trade.entry_signal.atr, indicators.atr);
        assert_ne!(trigger.reference_atr, trade.entry_signal.atr);
        assert_eq!(
            trade.entry_price,
            c.execution.fill(bars[84 * 5].open, !short).unwrap()
        );
        assert_eq!(trade.reason, "end-range");
    }
}

#[test]
fn price_action_partition_drains_and_unseen_future_cannot_change_completed_signals() {
    let c = pa_config();
    let bars = candles(false);
    let (a_metrics, a) = run(c.clone(), &bars, usize::MAX);
    let (b_metrics, b) = run(c.clone(), &bars, 7);
    assert_eq!(
        serde_json::to_value(a_metrics).unwrap(),
        serde_json::to_value(b_metrics).unwrap()
    );
    assert_eq!(
        serde_json::to_value(a).unwrap(),
        serde_json::to_value(b).unwrap()
    );
    let mut engine = engine(c.clone(), &bars);
    for b in &bars[..84 * 5] {
        engine.advance(*b, *b).unwrap();
    }
    let prefix = engine.drain();
    assert_eq!(
        prefix.events.iter().filter(|e| e.kind == "signal").count(),
        1
    );
    assert!(prefix.trades.is_empty());
    let mut changed = bars.clone();
    for b in &mut changed[84 * 5..] {
        b.open = 80.0;
        b.close = 80.0;
        b.high = 81.0;
        b.low = 79.0;
    }
    let (_, changed_out) = run(c, &changed, usize::MAX);
    let before: Vec<_> = changed_out
        .events
        .iter()
        .filter(|e| e.time < bars[84 * 5].time)
        .collect();
    assert_eq!(
        serde_json::to_value(&prefix.events).unwrap(),
        serde_json::to_value(before).unwrap()
    );
    assert!(changed_out.trades.is_empty());
    assert_eq!(
        changed_out
            .events
            .iter()
            .filter(|e| e.reason == "structure-invalid")
            .count(),
        1
    );
}

#[test]
fn price_action_setup_gates_are_diagnostics_and_do_not_count_as_order_rejections() {
    let mut bars = candles(false);
    // Remove the known pivot without changing the active impulse or pullback.
    bars[30 * 5].high = 100.5;
    let (metrics, out) = run(pa_config(), &bars, 7);
    assert_eq!(metrics.trades, 0);
    assert_eq!(metrics.rejected_signals, 0);
    let event = out
        .events
        .iter()
        .find(|e| e.reason == "pa-key-level-missing")
        .unwrap();
    assert_eq!(event.kind, "setup");
    assert!(matches!(
        event.entry_signal.unwrap().trigger,
        Some(EntryTrigger::PriceAction(_))
    ));
}

#[test]
fn price_action_configuration_is_explicit_versioned_and_boolean_ablations_share_warmup() {
    let c = pa_config();
    assert!(c.validate().is_ok());
    for version in [4, 5, 6] {
        let mut old = c.clone();
        old.version = version;
        if version == 4 {
            old.strategy.max_cost_atr = None;
        }
        assert!(old.validate().is_err());
    }
    let mut missing = c.clone();
    missing.strategy.price_action = None;
    assert!(missing.validate().is_err());
    for entry in ["breakout", "pullback", "kdj"] {
        let mut invalid = c.clone();
        invalid.strategy.entry = entry.into();
        assert!(invalid.validate().is_err());
    }
    let json = serde_json::to_value(&c).unwrap();
    for invalid in [
        serde_json::Value::Null,
        serde_json::json!({"keyLevel":true}),
        serde_json::json!({"keyLevel":true,"twoLegs":true,"extra":1}),
    ] {
        let mut value = json.clone();
        value["strategy"]["priceAction"] = invalid;
        assert!(serde_json::from_value::<Config>(value).is_err());
    }
    for minutes in [1, 5, 30, 60, 240, 1440] {
        for key in [false, true] {
            for legs in [false, true] {
                let mut variant = c.clone();
                variant.strategy.trade_minutes = minutes;
                variant.strategy.price_action = Some(PriceAction {
                    key_level: key,
                    two_legs: legs,
                });
                let mut original = c.clone();
                original.strategy.trade_minutes = minutes;
                assert_eq!(variant.warmup_days(), original.warmup_days());
            }
        }
    }
}
