use crate::{engine::Engine, model::*};

fn manifest(days: usize) -> Manifest {
    Manifest {
        display_names: None,
        corporate_actions: vec![],
        data_quality: None,
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
                month_end: None,
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
                volume: None,
                limit_up: None,
                limit_down: None,
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
#[test]
fn daily_market_breadth_matches_rebalance_and_excludes_warmup_or_non_members() {
    let mut portfolio = crate::features::FactorState::new(manifest(23));
    let mut indicator = crate::features::FactorState::new(manifest(23));
    for day in 1..=23 {
        let mut input = bars(day);
        if day == 22 {
            input[1].breadth_member = false;
        }
        let weekly = portfolio.advance(&input).unwrap();
        let daily = indicator.advance_daily(&input).unwrap();
        assert!(daily.signals.is_empty());
        if day < 20 {
            assert!(daily.breadth.is_empty());
        }
        if day == 21 {
            assert_eq!(
                serde_json::to_value(&weekly.breadth).unwrap(),
                serde_json::to_value(&daily.breadth).unwrap()
            );
        }
        if day == 22 {
            assert!(weekly.breadth.is_empty());
            assert_eq!(daily.breadth[0].total, 1);
            assert_eq!(daily.breadth[0].above, 1);
        }
    }
    assert_eq!(indicator.processed_days(), 23);
    assert!(indicator.advance_daily(&bars(24)).is_err());
}
#[test]
fn names_round_trip_without_affecting_replay_or_identities() {
    let plain = manifest(22);
    let mut named = plain.clone();
    named.display_names = Some(DisplayNames {
        instruments: std::collections::BTreeMap::from([("sz.001001".into(), "示例证券".into())]),
        industries: std::collections::BTreeMap::from([("tech".into(), "科技".into())]),
        captured_at: Some("2026-10-01T00:00:00Z".into()),
    });
    named.validate().unwrap();
    let encoded = serde_json::to_string(&named).unwrap();
    let restored: Manifest = serde_json::from_str(&encoded).unwrap();
    assert_eq!(
        restored.display_names.as_ref().unwrap().industries["tech"],
        "科技"
    );
    let mut a = Engine::new(plain, config()).unwrap();
    let mut b = Engine::new(restored, config()).unwrap();
    for day in 1..=22 {
        a.day(bars(day)).unwrap();
        b.day(bars(day)).unwrap();
    }
    assert_eq!(
        serde_json::to_value(a.finish().unwrap()).unwrap(),
        serde_json::to_value(b.finish().unwrap()).unwrap()
    );
    named
        .display_names
        .as_mut()
        .unwrap()
        .instruments
        .insert("absent".into(), "错误证券".into());
    assert!(named.validate().is_err());
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

fn raw_manifest(days: usize) -> Manifest {
    let mut m = manifest(days);
    m.version = 2;
    m.schema = "jsg-daily-v2".into();
    m.data_quality = Some(DataQuality {
        membership: "snapshot".into(),
        financials: "latest".into(),
        corporate_actions: "complete".into(),
        price_limits: "daily".into(),
    });
    m
}
fn raw_config() -> Config {
    Config {
        execution_model: "jsg-raw-v2".into(),
        fees: vec![FeeSchedule {
            commission_bps: None,
            from: 20200101,
            minimum_commission: 5.0,
            transfer_bps: 1.0,
            sell_tax_bps: 5.0,
        }],
        ..config()
    }
}
fn raw_bars(day: usize) -> Vec<Bar> {
    bars(day)
        .into_iter()
        .map(|mut b| {
            b.volume = Some(1_000_000);
            b.limit_up = Some(100.0);
            b.limit_down = Some(1.0);
            b.adjfactor = 2.0;
            b
        })
        .collect()
}

#[test]
fn position_cap_uses_actual_open_valuation_and_net_equity_after_fees() {
    for raw in [false, true] {
        let mut c = if raw { raw_config() } else { config() };
        c.max_position_pct = 0.2;
        c.commission_bps = 100.0;
        let mut e = Engine::new(if raw { raw_manifest(22) } else { manifest(22) }, c).unwrap();
        for d in 1..=21 {
            e.day(if raw { raw_bars(d) } else { bars(d) }).unwrap();
        }
        let mut b = if raw { raw_bars(22) } else { bars(22) };
        b[0].open = 11.0;
        b[0].high = 11.0;
        b[0].preclose = 11.0;
        e.day(b).unwrap();
        let r = e.finish().unwrap();
        let buy = &r.orders[0];
        let value = buy.quantity as f64 * buy.price;
        assert_eq!(buy.risk_reason.as_deref(), Some("position-cap"));
        assert_eq!(buy.status, "partial");
        assert!(value <= (100_000.0 - buy.fee) * 0.2 + 1e-8);
        assert_eq!(buy.quantity, 1800);
        // It must not size the open using the cheaper close available later that day.
        assert!(buy.requested > buy.quantity);
    }
}

#[test]
fn exposure_cap_applies_across_symbols_and_records_zero_and_partial_fills() {
    for raw in [false, true] {
        let mut c = if raw { raw_config() } else { config() };
        c.stock_count = 2;
        c.max_exposure_pct = 0.35;
        let mut e = Engine::new(if raw { raw_manifest(22) } else { manifest(22) }, c).unwrap();
        for d in 1..=22 {
            e.day(if raw { raw_bars(d) } else { bars(d) }).unwrap();
        }
        let r = e.finish().unwrap();
        let exposure: f64 = r.holdings.iter().map(|p| p.value).sum();
        assert!(exposure <= r.metrics.final_equity * 0.35 + 1e-8);
        assert_eq!(r.orders[0].risk_reason.as_deref(), Some("exposure-cap"));
        assert_eq!(r.orders[0].status, "partial");
        assert_eq!(r.orders[1].status, "exposure-cap");
        assert_eq!(r.orders[1].quantity, 0);
    }
}

#[test]
fn mixed_caps_report_the_binding_limit_after_lot_rounding() {
    let mut c = config();
    c.max_position_pct = 0.6;
    c.max_exposure_pct = 0.2;
    let mut e = Engine::new(manifest(22), c).unwrap();
    warm(&mut e);
    e.day(bars(22)).unwrap();
    let r = e.finish().unwrap();
    assert_eq!(r.orders[0].risk_reason.as_deref(), Some("exposure-cap"));
    assert_eq!(r.orders[0].quantity, 1900);
}

#[test]
fn daily_loss_uses_previous_session_equity_and_retries_limit_down() {
    let mut c = config();
    c.max_daily_loss = 0.05;
    let mut m = manifest(24);
    m.calendar[21].rebalance = true;
    m.calendar[22].rebalance = true;
    let mut e = Engine::new(m, c).unwrap();
    warm(&mut e);
    let mut b = bars(22);
    set_close(&mut b[0], 9.0);
    e.day(b).unwrap();
    let mut b = bars(23);
    b[0].preclose = 9.0;
    set_close(&mut b[0], 9.1);
    e.day(b).unwrap();
    e.day(bars(24)).unwrap();
    let r = e.finish().unwrap();
    assert_eq!(r.orders[1].reason, "daily-loss");
    assert_eq!(r.orders[1].status, "limit-down");
    assert_eq!(r.orders[2].reason, "daily-loss");
    assert_eq!(r.orders[2].status, "filled");
    assert_eq!(r.orders.iter().filter(|o| o.side == "buy").count(), 1);
    assert!(r.holdings.is_empty());
}

#[test]
fn take_profit_retries_after_t_plus_one_even_if_profit_falls_and_does_not_rebuy() {
    let mut c = raw_config();
    c.take_profit = 0.05;
    let mut m = raw_manifest(23);
    m.calendar[21].rebalance = true;
    m.calendar[22].rebalance = true;
    let mut e = Engine::new(m, c).unwrap();
    for d in 1..=21 {
        e.day(raw_bars(d)).unwrap();
    }
    let mut b = raw_bars(22);
    set_close(&mut b[0], 11.0);
    e.day(b).unwrap();
    e.day(raw_bars(23)).unwrap();
    let r = e.finish().unwrap();
    assert_eq!(r.orders[1].reason, "take-profit");
    assert_eq!(r.orders[1].status, "not-sellable");
    assert_eq!(r.orders[2].reason, "take-profit");
    assert_eq!(r.orders[2].status, "filled");
    assert!(r.holdings.is_empty());
    assert_eq!(r.pending_orders, 0);
}

#[test]
fn new_risk_settings_validate_and_default_to_disabled_when_omitted() {
    let mut value = serde_json::to_value(config()).unwrap();
    for key in [
        "maxPositionPct",
        "maxExposurePct",
        "maxDailyLoss",
        "takeProfit",
    ] {
        value.as_object_mut().unwrap().remove(key);
    }
    let restored: Config = serde_json::from_value(value).unwrap();
    assert_eq!(restored.max_position_pct, 0.0);
    assert_eq!(restored.max_exposure_pct, 0.0);
    assert_eq!(restored.max_daily_loss, 0.0);
    assert_eq!(restored.take_profit, 0.0);
    let mut c = config();
    c.max_position_pct = 1.0;
    c.max_exposure_pct = 1.0;
    c.take_profit = 2.0;
    assert!(c.validate().is_ok());
    c.max_daily_loss = 1.0;
    assert!(c.validate().is_err());
    c.max_daily_loss = 0.0;
    c.max_position_pct = f64::NAN;
    assert!(c.validate().is_err());
}
#[test]
fn raw_execution_uses_real_shares_minimum_fees_and_volume_budget() {
    let mut c = raw_config();
    c.participation = 0.00025;
    let mut e = Engine::new(raw_manifest(22), c).unwrap();
    for d in 1..=22 {
        e.day(raw_bars(d)).unwrap();
    }
    let r = e.finish().unwrap();
    assert_eq!(r.orders[0].quantity, 200);
    assert_eq!(r.orders[0].status, "partial");
    assert_eq!(r.orders[0].price, 10.22);
    assert!((r.orders[0].fee - 5.20).abs() < 1e-8);
    assert_eq!(r.metrics.model, "jsg-raw-v2");
}
#[test]
fn explicit_action_preserves_equity_and_pays_record_date_holder_after_sale() {
    let mut m = raw_manifest(25);
    m.calendar[23].rebalance = true;
    m.corporate_actions.push(CorporateAction {
        id: 0,
        record_date: 20240122,
        ex_date: 20240123,
        pay_date: 20240125,
        known_date: 20240120,
        share_available_date: 20240124,
        cash_per_share: 1.0,
        withholding_per_share: 0.0,
        share_ratio: 1.0,
        fractional_cash_price: 0.0,
    });
    let mut c = raw_config();
    c.fees[0].minimum_commission = 0.0;
    c.fees[0].transfer_bps = 0.0;
    c.fees[0].sell_tax_bps = 0.0;
    let mut e = Engine::new(m, c).unwrap();
    e.enable_audit();
    for d in 1..=22 {
        e.day(raw_bars(d)).unwrap();
    }
    let before = e.take_audit().unwrap();
    let qty = before.holdings[0].quantity;
    let mut day = raw_bars(23);
    let price = (10.22 - 1.0) / 2.0;
    day[0].open = price;
    day[0].close = price;
    day[0].high = price;
    day[0].low = price;
    e.day(day).unwrap();
    let ex = e.take_audit().unwrap();
    assert_eq!(ex.holdings[0].quantity, qty * 2);
    assert!((ex.equity - before.equity).abs() < 1e-7);
    assert!((ex.cash - before.cash).abs() < 1e-7);
    let mut after = raw_bars(24);
    for b in &mut after {
        b.profit = 0.0;
    }
    after[0].open = price;
    after[0].close = price;
    after[0].high = price;
    after[0].low = price;
    e.day(after).unwrap();
    let mut paid_day = raw_bars(25);
    paid_day[0].open = price;
    paid_day[0].close = price;
    paid_day[0].high = price;
    paid_day[0].low = price;
    e.day(paid_day).unwrap();
    let paid = e.take_audit().unwrap();
    assert!((paid.cash - before.cash - qty as f64 - 2.0 * qty as f64 * price).abs() < 1e-7);
    assert!(paid.holdings.is_empty());
    let result = e.finish().unwrap();
    assert_eq!(result.receivables, 0.0);
    let ex_ledger = &result.research[2].ledger[0];
    assert_eq!(ex_ledger.quantity, qty * 2);
    assert!((ex_ledger.receivable - qty as f64).abs() < 1e-7);
    assert!(ex_ledger.daily_profit.abs() < 1e-7);
    assert!((ex_ledger.realized - qty as f64).abs() < 1e-7);
    assert!((ex_ledger.unrealized + qty as f64).abs() < 1e-7);
    let paid_ledger = &result.research[4].ledger[0];
    assert_eq!(paid_ledger.quantity, 0);
    assert_eq!(paid_ledger.receivable, 0.0);
    assert_eq!(paid_ledger.income, qty as f64);
    assert!(
        (paid_ledger.profit - (result.metrics.final_equity - config().initial_capital)).abs()
            < 1e-7
    );
}

#[test]
fn ledger_reconciles_actual_fees_unrealized_and_stale_marks() {
    let mut c = config();
    c.commission_bps = 3.0;
    c.slippage_bps = 10.0;
    let mut e = Engine::new(manifest(24), c.clone()).unwrap();
    for d in 1..=24 {
        let mut rows = bars(d);
        if d == 23 {
            rows.remove(0);
        }
        e.day(rows).unwrap();
    }
    let r = e.finish().unwrap();
    let mut previous = c.initial_capital;
    for day in &r.research {
        let daily = day.ledger.iter().map(|r| r.daily_profit).sum::<f64>();
        assert!((day.equity - previous - daily).abs() < 1e-7);
        assert!(
            (day.cash + day.receivables + day.ledger.iter().map(|r| r.value).sum::<f64>()
                - day.equity)
                .abs()
                < 1e-7
        );
        previous = day.equity;
    }
    let last = &r.research.last().unwrap().ledger[0];
    assert!((last.fees - r.metrics.fees).abs() < 1e-8);
    assert!((last.profit - (r.metrics.final_equity - c.initial_capital)).abs() < 1e-7);
    assert!((last.profit - last.realized - last.unrealized).abs() < 1e-8);
    assert_eq!(r.research[2].ledger[0].mark_date, "2024-01-22");
    assert_eq!(r.diagnostics.stale_held_marks, 1);
    assert_eq!(r.diagnostics.rows, 7);
}

#[test]
fn research_window_is_independent_of_later_prices_and_starts_without_positions() {
    let mut c = config();
    c.research_window = Some(ResearchWindow {
        start: 20240121,
        end: 20240122,
    });
    let mut a = Engine::new(manifest(24), c.clone()).unwrap();
    let mut b = Engine::new(manifest(24), c).unwrap();
    for d in 1..=24 {
        a.day(bars(d)).unwrap();
        let mut rows = bars(d);
        if d > 22 {
            for r in &mut rows {
                r.open = 50.0;
                r.close = 50.0;
                r.high = 50.0;
                r.low = 50.0;
            }
        }
        b.day(rows).unwrap();
    }
    let a = a.finish().unwrap();
    let b = b.finish().unwrap();
    assert_eq!(
        serde_json::to_value(&a).unwrap(),
        serde_json::to_value(&b).unwrap()
    );
    assert_eq!(a.metrics.days, 2);
    assert_eq!(a.equity[0].holdings, 0);
    assert_eq!(a.research[1].ledger[0].mark_date, "2024-01-22");
    let mut c = config();
    c.research_window = Some(ResearchWindow {
        start: 20240122,
        end: 20240124,
    });
    let mut e = Engine::new(manifest(24), c).unwrap();
    for d in 1..=24 {
        e.day(bars(d)).unwrap();
    }
    let r = e.finish().unwrap();
    assert!(r.orders.is_empty());
    assert_eq!(r.metrics.total_return, 0.0);
}

#[test]
fn explanations_preserve_suspended_candidates_and_financial_exclusions() {
    let mut e = Engine::new(manifest(22), config()).unwrap();
    for d in 1..=22 {
        let mut rows = bars(d);
        rows[0].tradable = false;
        rows[1].profit = 0.0;
        e.day(rows).unwrap();
    }
    let r = e.finish().unwrap();
    let candidates = r.research[0].candidates.as_ref().unwrap();
    assert_eq!(candidates[0].reason, "target");
    assert!(!candidates[0].tradable);
    assert_eq!(candidates[1].reason, "non-positive-profit");
    assert_eq!(r.orders[0].status, "suspended");
    assert!(r.research[1].ledger.is_empty());
}
#[test]
fn raw_model_rejects_missing_actions_or_limits_instead_of_inferring_from_adjustment() {
    assert!(Engine::new(manifest(22), raw_config()).is_err());
    let mut e = Engine::new(raw_manifest(22), raw_config()).unwrap();
    assert!(e.day(bars(1)).is_err());
    let mut m = raw_manifest(22);
    m.data_quality.as_mut().unwrap().corporate_actions = "missing".into();
    assert!(Engine::new(m, raw_config()).is_err());
}

#[test]
fn streaming_and_full_output_have_identical_metrics_and_events() {
    let mut full = Engine::new(manifest(25), config()).unwrap();
    let mut streamed = Engine::new(manifest(25), config()).unwrap();
    streamed.enable_streaming();
    let mut orders = vec![];
    let mut equity = vec![];
    for d in 1..=25 {
        full.day(bars(d)).unwrap();
        streamed.day(bars(d)).unwrap();
        let chunk = streamed.drain_output();
        orders.extend(chunk.orders);
        equity.extend(chunk.equity);
    }
    let a = full.finish().unwrap();
    let b = streamed.finish().unwrap();
    assert_eq!(
        serde_json::to_value(&a.metrics).unwrap(),
        serde_json::to_value(&b.metrics).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&a.orders).unwrap(),
        serde_json::to_value(orders).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&a.equity).unwrap(),
        serde_json::to_value(equity).unwrap()
    );
    assert!(b.equity.is_empty());
    assert!(b.orders.is_empty());
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn frozen_real_prices_match_daily_audit_golden() {
    use std::{
        fs::File,
        io::{BufRead, BufReader},
        path::Path,
    };
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/real-q2");
    let m: Manifest =
        serde_json::from_reader(File::open(root.join("manifest.json")).unwrap()).unwrap();
    let mut engine = Engine::new(m, Config::default()).unwrap();
    engine.enable_audit();
    let expected: Vec<serde_json::Value> =
        BufReader::new(File::open(root.join("audit.jsonl")).unwrap())
            .lines()
            .map(|s| serde_json::from_str(&s.unwrap()).unwrap())
            .collect();
    let mut i = 0;
    crate::native::read_snapshot(&root.join("manifest.json"), |bars| {
        engine.day(bars)?;
        if let Some(day) = engine.take_audit() {
            let actual = serde_json::to_value(day)?;
            for key in [
                "date", "targets", "orders", "holdings", "breadth", "cash", "equity",
            ] {
                assert_json_close(&actual[key], &expected[i][key]);
            }
            i += 1;
        }
        Ok(())
    })
    .unwrap();
    assert_eq!(i, expected.len());
    assert_eq!(i, 60);
    let result = engine.finish().unwrap();
    assert!(result.metrics.filled_orders > 10);
}
fn assert_json_close(a: &serde_json::Value, b: &serde_json::Value) {
    use serde_json::Value;
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let x = x.as_f64().unwrap();
            let y = y.as_f64().unwrap();
            assert!(
                (x - y).abs() <= 1e-11 * x.abs().max(y.abs()).max(1.0),
                "{x} != {y}"
            );
        }
        (Value::Array(x), Value::Array(y)) => {
            assert_eq!(x.len(), y.len());
            for (x, y) in x.iter().zip(y) {
                assert_json_close(x, y);
            }
        }
        (Value::Object(x), Value::Object(y)) => {
            assert_eq!(x.len(), y.len());
            for (k, v) in x {
                assert_json_close(v, &y[k]);
            }
        }
        _ => assert_eq!(a, b),
    }
}

#[cfg(not(target_arch = "wasm32"))]
#[test]
fn shared_factors_match_independent_portfolios_with_different_risk_parameters() {
    use std::{fs::File, path::Path};
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/real-q2/manifest.json");
    let manifest: Manifest = serde_json::from_reader(File::open(&path).unwrap()).unwrap();
    let configs: Vec<Config> = (0..3)
        .map(|i| Config {
            stock_count: [1, 5, 10][i],
            stop_loss: [0.0, 0.04, 0.12][i],
            trailing_stop: [0.0, 0.1, 0.0][i],
            max_position_pct: [0.0, 0.1, 0.2][i],
            max_exposure_pct: [0.0, 0.4, 0.7][i],
            max_daily_loss: [0.0, 0.02, 0.05][i],
            take_profit: [0.0, 0.1, 0.03][i],
            max_drawdown: [0.0, 0.2, 0.0][i],
            ..Config::default()
        })
        .collect();
    let shared = crate::native::grid(&path, configs.clone(), 2).unwrap();
    assert_eq!(shared["decodedRows"], 1890);
    for (i, c) in configs.into_iter().enumerate() {
        let mut engine = Engine::new(manifest.clone(), c).unwrap();
        crate::native::read_snapshot(&path, |bars| {
            engine.day(bars)?;
            Ok(())
        })
        .unwrap();
        assert_json_close(
            &shared["results"][i]["metrics"],
            &serde_json::to_value(engine.finish().unwrap().metrics).unwrap(),
        );
    }
}

#[test]
fn explicit_default_strategy_preserves_legacy_replay() {
    let mut legacy = Engine::new(manifest(23), config()).unwrap();
    let mut explicit = Engine::new(
        manifest(23),
        Config {
            strategy: Some(crate::strategy::StrategySpec::default()),
            ..config()
        },
    )
    .unwrap();
    for day in 1..=23 {
        legacy.day(bars(day)).unwrap();
        explicit.day(bars(day)).unwrap();
    }
    assert_eq!(
        serde_json::to_value(legacy.finish().unwrap()).unwrap(),
        serde_json::to_value(explicit.finish().unwrap()).unwrap()
    );
}
#[test]
fn momentum_uses_only_known_prices_and_executes_next_open_without_financial_filters() {
    let c = Config {
        strategy: Some(crate::strategy::StrategySpec {
            id: "momentum".into(),
            lookback: 5,
            rebalance: "daily".into(),
            ..Default::default()
        }),
        ..config()
    };
    let mut engine = Engine::new(manifest(23), c).unwrap();
    for day in 1..=23 {
        let mut day_bars = bars(day);
        day_bars[1].profit = 0.0;
        day_bars[1].shares = 0.0;
        let p = 10.0 + day as f64 * 0.04;
        day_bars[1].open = p;
        day_bars[1].high = p;
        day_bars[1].low = p;
        day_bars[1].close = p;
        day_bars[1].preclose = 10.0 + (day - 1) as f64 * 0.04;
        engine.day(day_bars).unwrap();
    }
    let result = engine.finish().unwrap();
    assert_eq!(result.decisions[0].targets, vec!["sz.001002"]);
    assert_eq!(result.orders[0].date, "2024-01-22");
    assert_eq!(result.orders[0].signal_date, "2024-01-21");
    let ranked = result.research[0].candidates.as_ref().unwrap();
    assert_eq!(ranked[0].reason, "target");
    assert!(ranked[0].score.unwrap() > ranked[1].score.unwrap());
}
#[test]
fn mixed_strategies_and_lookbacks_share_features_without_changing_results() {
    let configs = vec![
        config(),
        Config {
            strategy: Some(crate::strategy::StrategySpec {
                lookback: 5,
                allocation: "inverse-volatility".into(),
                rebalance: "daily".into(),
                ..Default::default()
            }),
            ..config()
        },
        Config {
            strategy: Some(crate::strategy::StrategySpec {
                id: "momentum".into(),
                lookback: 10,
                rebalance: "daily".into(),
                ..Default::default()
            }),
            ..config()
        },
    ];
    let mut separate: Vec<_> = configs
        .iter()
        .map(|c| Engine::new(manifest(23), c.clone()).unwrap())
        .collect();
    let mut shared: Vec<_> = configs
        .iter()
        .map(|c| Engine::new_shared(manifest(23), c.clone()).unwrap())
        .collect();
    let mut factors = crate::features::FactorState::with_configs(manifest(23), &configs);
    for day in 1..=23 {
        let data = bars(day);
        let prepared = factors.advance(&data).unwrap();
        for engine in &mut separate {
            engine.day(data.clone()).unwrap();
        }
        for engine in &mut shared {
            engine
                .day_with_features(data.clone(), Some(&prepared))
                .unwrap();
        }
    }
    for (a, b) in separate.into_iter().zip(shared) {
        assert_eq!(
            serde_json::to_value(a.finish().unwrap().metrics).unwrap(),
            serde_json::to_value(b.finish().unwrap().metrics).unwrap()
        );
    }
}
#[test]
fn portfolio_weights_normalize_volatility_and_month_end_uses_full_calendar_marks() {
    let c = Config {
        stock_count: 2,
        strategy: Some(crate::strategy::StrategySpec {
            allocation: "inverse-volatility".into(),
            investment: 0.8,
            ..Default::default()
        }),
        ..config()
    };
    let signal = crate::strategy::Signal {
        breadth: vec![Breadth {
            industry: "tech".into(),
            ratio: 80.0,
            above: 4,
            total: 5,
        }],
        ranked: vec![0, 1],
        volatilities: vec![Some(0.01), Some(0.03)],
        ..Default::default()
    };
    let weights = crate::strategy::portfolio(&c, &signal);
    assert!((weights[0].1 - 0.6).abs() < 1e-12);
    assert!((weights[1].1 - 0.2).abs() < 1e-12);
    let spec = crate::strategy::StrategySpec {
        rebalance: "monthly".into(),
        ..Default::default()
    };
    let mut m = manifest(23);
    assert!(!spec.rebalance_at(&m, 22));
    m.calendar[22].month_end = Some(true);
    assert!(spec.rebalance_at(&m, 22));
}

#[test]
fn momentum_does_not_inherit_jsg_limit_opened_exit() {
    let spec = crate::strategy::StrategySpec {
        id: "momentum".into(),
        rebalance: "daily".into(),
        lookback: 5,
        ..Default::default()
    };
    let mut engine = Engine::new(
        manifest(23),
        Config {
            strategy: Some(spec),
            ..config()
        },
    )
    .unwrap();
    for day in 1..=23 {
        let mut data = bars(day);
        if day == 21 {
            let p = data[0].preclose * 1.1;
            data[0].open = p;
            data[0].high = p;
            data[0].low = p;
            data[0].close = p;
        }
        engine.day(data).unwrap();
    }
    let result = engine.finish().unwrap();
    assert!(result
        .holdings
        .iter()
        .any(|h| h.code == "sz.001001" && h.quantity > 0));
    assert!(result.orders.iter().all(|o| o.reason != "limit-up-opened"));
}

#[test]
fn walk_forward_selects_at_prior_close_and_carries_account_across_steps() {
    use crate::strategy::ParameterStep;
    let base = Config {
        research_window: Some(ResearchWindow {
            start: 20240121,
            end: 20240130,
        }),
        ..config()
    };
    let second = Config {
        stock_count: 2,
        ..base.clone()
    };
    let mut engine = Engine::new(manifest(30), base.clone()).unwrap();
    engine
        .set_schedule(vec![
            ParameterStep {
                from: 20240121,
                selected_at: 20240120,
                config: base.clone(),
            },
            ParameterStep {
                from: 20240125,
                selected_at: 20240124,
                config: second,
            },
        ])
        .unwrap();
    for day in 1..=30 {
        engine.day(bars(day)).unwrap();
    }
    let result = engine.finish().unwrap();
    assert_eq!(result.metrics.days, 10);
    assert_eq!(result.equity[0].holdings, 1);
    assert_eq!(result.orders[0].date, "2024-01-21");
    assert_eq!(result.orders[0].signal_date, "2024-01-20");
    let boundary = &result.equity[4];
    assert_eq!(boundary.date, "2024-01-25");
    assert_eq!(boundary.holdings, 2);
    assert!(boundary.equity > base.initial_capital);
    assert!(result
        .equity
        .windows(2)
        .all(|p| (p[1].equity / p[0].equity - 1.0).abs() < 0.01));
    assert!(result
        .orders
        .iter()
        .filter(|o| o.signal_date == "2024-01-24")
        .all(|o| o.date == "2024-01-25"));
}

#[test]
fn walk_forward_rejects_future_selection_execution_changes_and_late_installation() {
    use crate::strategy::ParameterStep;
    let base = Config {
        research_window: Some(ResearchWindow {
            start: 20240121,
            end: 20240123,
        }),
        ..config()
    };
    let step = ParameterStep {
        from: 20240121,
        selected_at: 20240120,
        config: base.clone(),
    };
    let mut engine = Engine::new(manifest(23), base.clone()).unwrap();
    let mut future = step.clone();
    future.selected_at = 20240121;
    assert!(engine.set_schedule(vec![future]).is_err());
    let mut reset = step.clone();
    reset.config.initial_capital *= 2.0;
    assert!(engine.set_schedule(vec![reset]).is_err());
    let mut fees = step.clone();
    fees.config.slippage_bps = 1.0;
    assert!(engine.set_schedule(vec![fees]).is_err());
    assert!(engine
        .set_schedule(vec![step.clone(), step.clone()])
        .is_err());
    engine.day(bars(1)).unwrap();
    assert!(engine.set_schedule(vec![step]).is_err());
}

#[test]
fn walk_forward_retains_longer_price_history_before_a_later_period_change() {
    use crate::strategy::{ParameterStep, StrategySpec};
    let base = Config {
        strategy: Some(StrategySpec {
            id: "momentum".into(),
            lookback: 5,
            rebalance: "daily".into(),
            ..Default::default()
        }),
        research_window: Some(ResearchWindow {
            start: 20240121,
            end: 20240130,
        }),
        ..config()
    };
    let long = Config {
        strategy: Some(StrategySpec {
            lookback: 25,
            ..base.strategy_spec()
        }),
        ..base.clone()
    };
    let mut engine = Engine::new(manifest(30), base.clone()).unwrap();
    engine
        .set_schedule(vec![
            ParameterStep {
                from: 20240121,
                selected_at: 20240120,
                config: base,
            },
            ParameterStep {
                from: 20240127,
                selected_at: 20240126,
                config: long,
            },
        ])
        .unwrap();
    for day in 1..=30 {
        engine.day(bars(day)).unwrap();
    }
    let result = engine.finish().unwrap();
    let decision = result
        .decisions
        .iter()
        .find(|d| d.date == "2024-01-26")
        .unwrap();
    assert_eq!(decision.targets.len(), 1);
    assert!(result.equity[6].holdings > 0);
}
