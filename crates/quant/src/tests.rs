use crate::{engine::Engine, model::*};

fn manifest(days: usize) -> Manifest {
    Manifest {
        version: 1,
        schema: "jsg-daily-v1".into(),
        name: "test".into(),
        source: "fixture".into(),
        universe_mode: "synthetic".into(),
        warnings: vec![],
        start_date: 20240121,
        end_date: 20240100 + days as u32,
        instruments: vec![
            Instrument {
                code: "sz.001001".into(),
                limit_ratio: 0.1,
            },
            Instrument {
                code: "sz.001002".into(),
                limit_ratio: 0.1,
            },
        ],
        industries: vec!["tech".into(), "ads".into()],
        calendar: (1..=days)
            .map(|i| Session {
                date: 20240100 + i as u32,
                rebalance: i == 21,
            })
            .collect(),
        partitions: vec![Partition {
            file: "test.arrow".into(),
            bytes: 100,
            rows: days * 2,
        }],
    }
}
fn config() -> Config {
    Config {
        pool_size: 2,
        stock_count: 1,
        commission_bps: 0.0,
        slippage_bps: 0.0,
        initial_capital: 100_000.0,
        ..Config::default()
    }
}
fn bars(day: usize) -> Vec<Bar> {
    (0..2)
        .map(|id| {
            let close = 10.0 + day as f64 * 0.01;
            Bar {
                id,
                date: 20240100 + day as u32,
                industry: 0,
                open: close,
                high: close,
                low: close,
                close,
                preclose: 10.0 + day.saturating_sub(1) as f64 * 0.01,
                adjfactor: 1.0,
                profit: 1.0,
                shares: (id + 1) as f64 * 1e8,
                is_st: false,
                tradable: true,
                breadth_member: true,
                selection_member: true,
            }
        })
        .collect()
}
fn warm(engine: &mut Engine) {
    for day in 1..=21 {
        engine.day(bars(day)).unwrap();
    }
}
fn set_close(bar: &mut Bar, close: f64) {
    bar.close = close;
    bar.low = bar.low.min(close);
    bar.high = bar.high.max(close);
}

#[test]
fn rebalance_fills_next_open_and_leaves_final_pending_orders() {
    let mut engine = Engine::new(manifest(22), config()).unwrap();
    warm(&mut engine);
    assert_eq!(engine.processed_days(), 21);
    engine.day(bars(22)).unwrap();
    let result = engine.finish().unwrap();
    assert_eq!(result.orders.len(), 1);
    let fill = &result.orders[0];
    assert_eq!(fill.signal_date, "2024-01-21");
    assert_eq!(fill.date, "2024-01-22");
    assert_eq!(fill.timing, "next-open");
    assert_eq!(fill.quantity % 100, 0);
    assert_eq!(result.equity[0].holdings, 0);
    assert_eq!(result.equity[1].holdings, 1);
    let mut truncated = Engine::new(manifest(21), config()).unwrap();
    warm(&mut truncated);
    let result = truncated.finish().unwrap();
    assert!(result.orders.is_empty());
    assert_eq!(result.pending_orders, 1);
}
#[test]
fn next_open_gap_respects_cash_and_commission() {
    let mut m = manifest(22);
    m.instruments[0].limit_ratio = 0.0;
    let mut c = config();
    c.commission_bps = 3.0;
    c.slippage_bps = 10.0;
    let mut e = Engine::new(m, c).unwrap();
    warm(&mut e);
    let mut b = bars(22);
    b[0].open = 12.0;
    b[0].high = 12.0;
    b[0].close = 12.0;
    e.day(b).unwrap();
    let r = e.finish().unwrap();
    let o = &r.orders[0];
    assert_eq!(o.status, "partial");
    assert_eq!(o.quantity, 8300);
    assert!((o.price - 12.012).abs() < 1e-9);
    assert!((o.fee - o.price * o.quantity as f64 * 0.0003).abs() < 1e-9);
    assert!(r.equity[1].cash >= 0.0);
    assert!(
        (r.metrics.final_equity - (100_000.0 - o.fee - (o.price - 12.0) * o.quantity as f64)).abs()
            < 1e-8
    );
}
#[test]
fn t_plus_one_blocks_same_day_stop_but_allows_next_day_sale() {
    let mut c = config();
    c.stop_loss = 0.05;
    c.t_plus_one = true;
    let mut e = Engine::new(manifest(23), c).unwrap();
    warm(&mut e);
    let mut b = bars(22);
    set_close(&mut b[0], 9.5);
    e.day(b).unwrap();
    let mut b = bars(23);
    b[0].preclose = 9.5;
    set_close(&mut b[0], 9.5);
    e.day(b).unwrap();
    let r = e.finish().unwrap();
    assert_eq!(r.orders[1].status, "not-sellable");
    assert_eq!(r.orders[2].side, "sell");
    assert!(r.holdings.is_empty());
    assert_eq!(r.orders[2].date, "2024-01-23");
}
#[test]
fn close_stop_is_included_in_same_day_equity() {
    let mut c = config();
    c.stop_loss = 0.05;
    c.commission_bps = 3.0;
    let mut e = Engine::new(manifest(22), c).unwrap();
    warm(&mut e);
    let mut b = bars(22);
    set_close(&mut b[0], 9.5);
    e.day(b).unwrap();
    let r = e.finish().unwrap();
    assert_eq!(r.orders[1].timing, "close");
    assert_eq!(r.orders[1].reason, "stop-loss");
    assert_eq!(r.equity[1].holdings, 0);
    let paid = r
        .orders
        .iter()
        .map(|o| {
            if o.side == "buy" {
                -o.price * o.quantity as f64 - o.fee
            } else {
                o.price * o.quantity as f64 - o.fee
            }
        })
        .sum::<f64>();
    assert!((r.metrics.final_equity - (100_000.0 + paid)).abs() < 1e-8);
}
#[test]
fn suspended_and_limit_up_orders_expire_without_false_fills() {
    for suspended in [true, false] {
        let mut e = Engine::new(manifest(23), config()).unwrap();
        warm(&mut e);
        let mut b = bars(22);
        if suspended {
            b[0].tradable = false;
        } else {
            b[0].preclose = 9.0;
        }
        e.day(b).unwrap();
        e.day(bars(23)).unwrap();
        let r = e.finish().unwrap();
        assert_eq!(r.orders.len(), 1);
        assert_eq!(r.orders[0].quantity, 0);
        assert!(r.holdings.is_empty());
        assert_eq!(
            r.orders[0].status,
            if suspended { "suspended" } else { "limit-up" }
        );
    }
}
#[test]
fn missing_held_bar_uses_last_mark_and_cannot_execute_stop() {
    let mut e = Engine::new(manifest(23), config()).unwrap();
    warm(&mut e);
    e.day(bars(22)).unwrap();
    e.day(vec![bars(23).remove(1)]).unwrap();
    let r = e.finish().unwrap();
    assert_eq!(r.holdings.len(), 1);
    assert!(r.warnings.iter().any(|w| w.contains("stale")));
}
#[test]
fn unknown_profit_and_st_are_excluded_and_blacklist_empties_targets() {
    let mut e = Engine::new(manifest(22), config()).unwrap();
    for day in 1..=22 {
        let mut b = bars(day);
        b[0].profit = 0.0;
        b[1].is_st = true;
        e.day(b).unwrap();
    }
    assert!(e.finish().unwrap().orders.is_empty());
    let mut e = Engine::new(manifest(22), config()).unwrap();
    for day in 1..=22 {
        let mut b = bars(day);
        for bar in &mut b {
            bar.industry = 1;
        }
        e.day(b).unwrap();
    }
    let r = e.finish().unwrap();
    assert!(r.orders.is_empty());
    assert_eq!(r.decisions[0].top_industry.as_deref(), Some("ads"));
}
#[test]
fn input_cannot_skip_repeat_or_split_a_calendar_day() {
    let mut e = Engine::new(manifest(22), config()).unwrap();
    assert!(e.day(bars(2)).is_err());
    e.day(bars(1)).unwrap();
    assert!(e.day(bars(1)).is_err());
    assert!(e.finish().is_err());
    let mut e = Engine::new(manifest(22), config()).unwrap();
    let mut b = bars(1);
    b.push(b[0].clone());
    assert!(e.day(b).is_err());
}
#[test]
fn adjusted_indicator_and_raw_market_cap_and_limits_have_separate_scales() {
    let mut e = Engine::new(manifest(22), config()).unwrap();
    for day in 1..=22 {
        let mut b = bars(day);
        for bar in &mut b {
            bar.adjfactor = 2.0;
        }
        e.day(b).unwrap();
    }
    let r = e.finish().unwrap();
    assert_eq!(r.orders[0].price, 20.44);
    assert_eq!(r.orders[0].code, "sz.001001");
    assert_eq!(r.orders[0].status, "filled");
}
#[test]
fn warmup_has_no_orders_and_prefix_is_independent_of_future_prices() {
    let mut m = manifest(24);
    m.calendar[0].rebalance = true;
    let mut a = Engine::new(m.clone(), config()).unwrap();
    let mut b = Engine::new(m, config()).unwrap();
    for day in 1..=24 {
        a.day(bars(day)).unwrap();
        let mut other = bars(day);
        if day > 22 {
            set_close(&mut other[0], 9.8);
        }
        b.day(other).unwrap();
    }
    let a = a.finish().unwrap();
    let b = b.finish().unwrap();
    assert!(a
        .orders
        .iter()
        .all(|o| o.signal_date >= "2024-01-21".to_string()));
    assert_eq!(
        serde_json::to_value(&a.equity[..2]).unwrap(),
        serde_json::to_value(&b.equity[..2]).unwrap()
    );
}

#[test]
fn previous_limit_up_opening_exits_at_current_close() {
    let mut e = Engine::new(manifest(23), config()).unwrap();
    warm(&mut e);
    let mut b = bars(22);
    set_close(&mut b[0], 11.23);
    e.day(b).unwrap();
    let mut b = bars(23);
    b[0].preclose = 11.23;
    set_close(&mut b[0], 11.15);
    e.day(b).unwrap();
    let r = e.finish().unwrap();
    assert_eq!(r.orders[1].reason, "limit-up-opened");
    assert_eq!(r.orders[1].timing, "close");
    assert_eq!(r.orders[1].price, 11.15);
    assert!(r.holdings.is_empty());
}

#[test]
fn trailing_stop_uses_high_watermark_even_with_positive_pnl() {
    let mut m = manifest(23);
    m.instruments[0].limit_ratio = 0.0;
    let mut c = config();
    c.trailing_stop = 0.05;
    let mut e = Engine::new(m, c).unwrap();
    warm(&mut e);
    let mut b = bars(22);
    set_close(&mut b[0], 11.2);
    e.day(b).unwrap();
    let mut b = bars(23);
    set_close(&mut b[0], 10.6);
    e.day(b).unwrap();
    let r = e.finish().unwrap();
    assert_eq!(r.orders[1].reason, "trailing-stop");
    assert!(r.metrics.total_return > 0.0);
    assert!(r.holdings.is_empty());
}

#[test]
fn drawdown_liquidation_retries_after_a_limit_down_rejection() {
    let mut c = config();
    c.max_drawdown = 0.05;
    let mut e = Engine::new(manifest(23), c).unwrap();
    warm(&mut e);
    let mut b = bars(22);
    set_close(&mut b[0], 9.0);
    e.day(b).unwrap();
    let mut b = bars(23);
    b[0].preclose = 9.0;
    set_close(&mut b[0], 9.1);
    e.day(b).unwrap();
    let r = e.finish().unwrap();
    assert_eq!(r.orders[1].status, "limit-down");
    assert_eq!(r.orders[2].reason, "max-drawdown");
    assert_eq!(r.orders[2].status, "filled");
    assert!(r.holdings.is_empty());
}

#[test]
fn unclassified_breadth_cannot_open_the_stock_selection_gate() {
    let mut m = manifest(22);
    m.industries = vec!["unknown".into()];
    let mut e = Engine::new(m, config()).unwrap();
    warm(&mut e);
    e.day(bars(22)).unwrap();
    let r = e.finish().unwrap();
    assert!(r.orders.is_empty());
    assert!(r.decisions[0].top_industry.is_none());
}
