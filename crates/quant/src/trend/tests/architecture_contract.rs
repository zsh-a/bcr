use super::*;

fn replay_matrix() -> serde_json::Value {
    let mut cases = vec![];
    for short in [false, true] {
        for mode in [
            "pullback",
            "channel",
            "trailing",
            "breakeven",
            "daily-loss",
            "daily-close",
        ] {
            let mut c = config();
            let mut bars = history(short);
            match mode {
                "channel" => {
                    c.strategy.entry = "breakout".into();
                    c.strategy.management = "channel".into();
                }
                "trailing" => {
                    c.strategy.trailing_atr = 2.0;
                }
                "breakeven" => {
                    c.strategy.break_even_atr = 0.1;
                }
                "daily-loss" => {
                    c.risk.daily_loss_pct = 0.0001;
                    bars[66] = bar(
                        66,
                        bars[66].open,
                        bars[66].open + if short { 0.25 } else { -0.25 },
                    );
                }
                "daily-close" => {
                    c.risk.flatten_minute = Some(68);
                }
                _ => {}
            }
            let funding = vec![Funding {
                time: bars[67].time + 1,
                rate: 0.001,
                interval_hours: 8.0,
            }];
            let (metrics, output) = replay(c, &bars, funding, false);
            cases.push(serde_json::json!({"case": format!("{mode}-{short}"), "metrics": metrics, "output": output}));
        }
        let (metrics, output) = replay_five(&period_history(5, short), vec![], 7);
        cases.push(serde_json::json!({"case": format!("five-minute-{short}"), "metrics": metrics, "output": output}));
    }
    serde_json::Value::Array(cases)
}

#[test]
fn refactor_preserves_v10_replay_outputs() {
    let actual: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&replay_matrix()).unwrap()).unwrap();
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("v10-replay.json")).unwrap();
    compare(&actual, &expected, "root");
}

#[test]
fn observing_extrema_and_proposing_protection_cannot_commit_a_stop() {
    let c = config();
    for side in [Side::Long, Side::Short] {
        let mut p = position(side);
        let initial = (p.initial_stop, p.initial_distance, p.signal_atr, p.stop);
        let close = MinuteClose(bar(1, p.entry, p.entry + side.sign() * 2.5));
        p.observe_minute(close);
        assert!(p.mfe > 2.5);
        assert_eq!(
            (p.initial_stop, p.initial_distance, p.signal_atr, p.stop),
            initial
        );
        let mut strategy = c.strategy.clone();
        strategy.trailing_atr = 2.0;
        let update =
            super::super::management::protection_decision(&p, close, &strategy, &c.execution)
                .unwrap();
        assert!(side.sign() * (update.price - p.stop) > 0.0);
        assert_eq!(
            (p.initial_stop, p.initial_distance, p.signal_atr, p.stop),
            initial
        );
    }
}

#[test]
fn daily_loss_intent_survives_midnight_and_a_favorable_gap() {
    for short in [false, true] {
        let mut c = config();
        c.risk.daily_loss_pct = 0.0001;
        let mut bars = history(short);
        let side = if short { Side::Short } else { Side::Long };
        bars[66] = bar(66, bars[66].open, bars[66].open - side.sign() * 0.25);
        bars[67] = bar(67, bars[66].open + side.sign(), bars[66].open + side.sign());
        for b in &mut bars {
            b.time += DAY - 67 * MINUTE;
        }
        let mut engine = Engine::new(
            c.clone(),
            vec![],
            bars[60].time,
            bars.last().unwrap().time + MINUTE,
            bars[0].time,
        )
        .unwrap();
        for b in &bars {
            engine.advance(*b, *b).unwrap();
        }
        engine.finish().unwrap();
        let out = engine.drain();
        assert_eq!(out.trades[0].reason, "daily-loss");
        assert_eq!(out.trades[0].exit_time, BASE + DAY);
        assert_eq!(
            out.trades[0].exit_price,
            c.execution.fill(bars[67].open, short).unwrap()
        );
    }
}

#[test]
fn legacy_metrics_and_evaluation_share_completed_trade_totals() {
    let (metrics, output) = replay(config(), &history(false), vec![], false);
    assert_eq!(metrics.trades, output.trades.len());
    assert_eq!(metrics.fees, metrics.evaluation.costs.fees);
    assert_eq!(metrics.funding, metrics.evaluation.costs.funding);
    assert_eq!(
        metrics.trades,
        metrics.evaluation.exit_reasons.values().sum::<usize>()
    );
    assert_eq!(
        metrics.evaluation.net_expectancy.unwrap(),
        output.trades.iter().map(|t| t.net_pnl).sum::<f64>() / metrics.trades as f64
    );
}

fn compare(actual: &serde_json::Value, expected: &serde_json::Value, path: &str) {
    use serde_json::Value;
    match (actual, expected) {
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(
                a.keys().collect::<Vec<_>>(),
                b.keys().collect::<Vec<_>>(),
                "{path}"
            );
            for (key, value) in a {
                compare(value, &b[key], &format!("{path}.{key}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare(a, b, &format!("{path}[{i}]"));
            }
        }
        (Value::Number(a), Value::Number(b))
            if path.ends_with(".metrics.fees") || path.ends_with(".metrics.funding") =>
        {
            // Legacy totals used entry/exit event addition; the single Evaluator
            // now sums completed trades, so only their last floating bits may differ.
            let a = a.as_f64().unwrap();
            let b = b.as_f64().unwrap();
            assert!(
                (a - b).abs() <= 1e-12 * b.abs().max(1.0),
                "{path}: {a} != {b}"
            );
        }
        _ => assert_eq!(actual, expected, "{path}"),
    }
}
