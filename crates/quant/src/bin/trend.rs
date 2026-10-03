//! Offline research uses the very same minute engine as the browser's WASM.
#[cfg(not(target_arch = "wasm32"))]
fn run(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use bcr_quant::trend::{
        config::Config,
        engine::Engine,
        model::{Bar, Funding, Trade, DAY},
        opportunity::{Diagnostics as OpportunityDiagnostics, Observer},
        reader, ENGINE_VERSION,
    };
    use serde::{Deserialize, Serialize};
    use sha2::{Digest, Sha256};
    use std::{collections::BTreeMap, fs, io::BufWriter};
    #[derive(Deserialize)]
    struct Candidate {
        id: String,
        config: Config,
    }
    #[derive(Default, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ResearchDiagnostics {
        event_counts: BTreeMap<String, usize>,
        accepted_shape_counts: BTreeMap<String, usize>,
        completed_trades: usize,
    }
    impl ResearchDiagnostics {
        fn observe(&mut self, chunk: &bcr_quant::trend::model::Chunk) {
            use bcr_quant::trend::model::EntryTrigger;
            self.completed_trades += chunk.trades.len();
            for event in &chunk.events {
                *self
                    .event_counts
                    .entry(format!("{}:{}", event.kind, event.reason))
                    .or_default() += 1;
                // Accepted shape observations count candidate signals once, not
                // fills or completed trades; downstream entry gates may reject.
                if event.kind == "signal" {
                    if let Some(EntryTrigger::StructuredPullback(t)) =
                        event.entry_signal.and_then(|s| s.trigger)
                    {
                        for (name, present) in [
                            ("twoLegs", t.shapes.two_legs),
                            ("wedge", t.shapes.wedge),
                            ("channel", t.shapes.channel),
                            ("doubleTest", t.shapes.double_test),
                        ] {
                            if present {
                                *self.accepted_shape_counts.entry(name.into()).or_default() += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    // One candidate owns its replay clock, account, optional observer and output.
    // The account and observer deliberately keep independent detector state.
    struct ReplayCandidate {
        candidate: Candidate,
        warmup: u64,
        engine: Engine,
        observer: Option<Observer>,
        opportunities: OpportunityDiagnostics,
        trades: Vec<Trade>,
        diagnostics: Option<ResearchDiagnostics>,
    }
    impl ReplayCandidate {
        fn new(
            candidate: Candidate,
            funding: &[Funding],
            start: u64,
            end: u64,
        ) -> Result<Self, String> {
            candidate.config.validate()?;
            let warmup = start
                .checked_sub(candidate.config.warmup_days() * DAY)
                .ok_or_else(|| "invalid warmup start".to_string())?;
            let engine = Engine::new_research(
                candidate.config.clone(),
                funding.to_vec(),
                start,
                end,
                warmup,
            )?;
            let structured = candidate.config.strategy.entry == "structured-pullback";
            let observer = if candidate.config.version >= 10 && structured {
                Some(Observer::new(candidate.config.clone(), start, end, warmup)?)
            } else {
                None
            };
            Ok(Self {
                candidate,
                warmup,
                engine,
                observer,
                opportunities: OpportunityDiagnostics::default(),
                trades: vec![],
                diagnostics: structured.then(ResearchDiagnostics::default),
            })
        }
        fn advance(&mut self, bar: Bar, mark: Bar) -> Result<(), String> {
            self.engine.advance(bar, mark)?;
            if let Some(observer) = &mut self.observer {
                observer.advance(bar)?;
            }
            Ok(())
        }
        fn drain_account(&mut self) {
            let chunk = self.engine.drain();
            if let Some(d) = &mut self.diagnostics {
                d.observe(&chunk);
            }
            self.trades.extend(chunk.trades);
        }
        fn drain_observer(&mut self) {
            if let Some(observer) = &mut self.observer {
                let chunk = observer.drain();
                for (reason, count) in chunk.counts {
                    *self.opportunities.counts.entry(reason).or_default() += count;
                }
                self.opportunities.opportunities.extend(chunk.opportunities);
            }
        }
        fn finish(
            mut self,
        ) -> Result<(serde_json::Value, Option<serde_json::Value>), Box<dyn std::error::Error>>
        {
            let metrics = self.engine.finish()?;
            self.drain_account();
            if (metrics.final_equity
                - self.candidate.config.execution.initial_capital
                - self.trades.iter().map(|t| t.net_pnl).sum::<f64>())
            .abs()
                > 1e-6
            {
                return Err("trade ledger does not reconcile with final cash".into());
            }
            // Use the same final, cost-adjusted observations as browser evaluation.
            let daily: Vec<_> = metrics
                .evaluation
                .daily
                .iter()
                .map(|point| serde_json::json!({"time": point.to - 1, "equity": point.equity}))
                .collect();
            let mut result = serde_json::json!({"id": self.candidate.id, "config": self.candidate.config,
                "warmupStart": self.warmup, "metrics": metrics, "trades": self.trades, "daily": daily });
            if let Some(d) = &self.diagnostics {
                result["researchDiagnostics"] = serde_json::to_value(d)?;
            }
            let opportunities = if let Some(observer) = &self.observer {
                observer.finish()?;
                self.drain_observer();
                let mut value = serde_json::to_value(&self.opportunities)?;
                value["id"] = serde_json::json!(self.candidate.id);
                value["warmupStart"] = serde_json::json!(self.warmup);
                Some(value)
            } else {
                None
            };
            Ok((result, opportunities))
        }
    }
    if args.len() != 7 {
        return Err("usage: trend MANIFEST SYMBOL CONFIGS START_MS END_MS OUTPUT WINDOW_ID".into());
    }
    let manifest: serde_json::Value = serde_json::from_slice(&fs::read(&args[0])?)?;
    let input = manifest["symbols"]
        .get(&args[1])
        .ok_or("symbol absent from manifest")?;
    let start: u64 = args[3].parse()?;
    let end: u64 = args[4].parse()?;
    let verified = |path: &str, checksum: &str| -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let bytes = fs::read(path)?;
        if format!("{:x}", Sha256::digest(&bytes)) != checksum {
            return Err(format!("CSV checksum mismatch: {path}").into());
        }
        Ok(bytes)
    };
    let funding_path = input["funding"].as_str().ok_or("missing funding path")?;
    let funding: Vec<Funding> = serde_json::from_slice(&verified(
        funding_path,
        input["fundingSha256"]
            .as_str()
            .ok_or("missing funding hash")?,
    )?)?;
    let funding: Vec<_> = funding
        .into_iter()
        .filter(|f| f.time >= start && f.time < end)
        .collect();
    if funding.is_empty() {
        return Err("funding history cannot be empty".into());
    }
    let candidates: Vec<Candidate> = serde_json::from_slice(&fs::read(&args[2])?)?;
    if candidates.is_empty() || candidates.len() > 16 {
        return Err("research batch requires 1–16 declared candidates".into());
    }
    let mut replays = candidates
        .into_iter()
        .map(|c| ReplayCandidate::new(c, &funding, start, end))
        .collect::<Result<Vec<_>, _>>()?;
    let warmup = replays.iter().map(|c| c.warmup).min().unwrap();
    let hashes: BTreeMap<_, _> = input["archives"]
        .as_array()
        .ok_or("missing archive provenance")?
        .iter()
        .map(|a| {
            Ok((
                a["path"].as_str().ok_or("missing CSV path")?,
                a["csvSha256"].as_str().ok_or("missing CSV hash")?,
            ))
        })
        .collect::<Result<_, &str>>()?;
    let mut used = vec![];
    for partition in input["partitions"].as_array().ok_or("missing partitions")? {
        let month = partition["month"]
            .as_str()
            .ok_or("missing partition month")?;
        let month_start = chrono::NaiveDate::parse_from_str(&format!("{month}-01"), "%Y-%m-%d")?
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_millis() as u64;
        if month_start >= end || month_start + 31 * DAY <= warmup {
            continue;
        }
        let candles_path = partition["candles"]
            .as_str()
            .ok_or("missing candles path")?;
        let marks_path = partition["marks"].as_str().ok_or("missing marks path")?;
        let candles = String::from_utf8(verified(
            candles_path,
            hashes
                .get(candles_path)
                .ok_or("candles missing provenance")?,
        )?)?;
        let marks = String::from_utf8(verified(
            marks_path,
            hashes.get(marks_path).ok_or("marks missing provenance")?,
        )?)?;
        let rows =
            reader::aligned(&candles, &marks).map_err(|e| format!("{}/{month}: {e}", args[1]))?;
        used.push(month.to_string());
        for (i, (bar, mark)) in rows
            .into_iter()
            .filter(|(b, _)| b.time >= warmup && b.time < end)
            .enumerate()
        {
            for replay in &mut replays {
                // A longer candidate may need earlier archives. Do not change another
                // candidate's indicator seed merely because it shares this batch.
                if bar.time < replay.warmup {
                    continue;
                }
                replay.advance(bar, mark)?;
                if i % 1024 == 1023 {
                    replay.drain_account();
                }
            }
        }
        for replay in &mut replays {
            replay.drain_observer();
            replay.drain_account();
        }
    }
    let mut results = vec![];
    let mut opportunity_results = vec![];
    for replay in replays {
        let (result, opportunities) = replay.finish()?;
        results.push(result);
        if let Some(value) = opportunities {
            opportunity_results.push(value);
        }
    }
    let mut output = serde_json::json!({
        "version":1,"engine":ENGINE_VERSION,"symbol":args[1],"window":args[6],
        "startTime":start,"endTime":end,"warmupStart":warmup,
        "planSha256":manifest["planSha256"],"partitions":used,"results":results
    });
    if !opportunity_results.is_empty() {
        output["opportunityDiagnostics"] = serde_json::json!({"version":1,"scope":"account-independent-current-detector","results":opportunity_results});
    }
    serde_json::to_writer(BufWriter::new(fs::File::create(&args[5])?), &output)?;
    Ok(())
}
fn main() {
    #[cfg(not(target_arch = "wasm32"))]
    if let Err(error) = run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("trend: {error}");
        std::process::exit(1);
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::run;
    use bcr_quant::trend::{
        config::Config,
        model::{DAY, MINUTE},
    };
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn mixed_warmup_batch_matches_individual_cli_runs() {
        let fixture = Fixture(std::env::temp_dir().join(format!(
            "bcr-trend-cli-{}-{}", std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        )));
        fs::create_dir_all(&fixture.0).unwrap();
        let base = 1_704_067_200_000;
        let start = base + 3 * DAY;
        let end = start + DAY;
        let csv_path = fixture.0.join("candles.csv");
        let mut csv = String::new();
        let mut previous: f64 = 100.0;
        for i in 0..(end - base) / MINUTE {
            let time = base + i * MINUTE;
            let close = 100.0 + i as f64 * 0.01 + (i as f64 / 100.0).sin() * 0.3;
            csv.push_str(&format!(
                "{time},{previous},{},{},{close},100,{}\n",
                previous.max(close) + 0.003,
                previous.min(close) - 0.003,
                time + MINUTE - 1
            ));
            previous = close;
        }
        fs::write(&csv_path, &csv).unwrap();
        let funding_path = fixture.0.join("funding.json");
        let funding = serde_json::to_vec(&json!([
            {"time": start + 8 * 60 * MINUTE, "rate": 0.0001, "intervalHours": 8}
        ]))
        .unwrap();
        fs::write(&funding_path, &funding).unwrap();
        let manifest_path = fixture.0.join("manifest.json");
        fs::write(&manifest_path, serde_json::to_vec(&json!({
            "planSha256": "warmup-regression", "symbols": {"BTCUSDT": {
                "funding": funding_path,
                "fundingSha256": format!("{:x}", Sha256::digest(&funding)),
                "archives": [{"path": csv_path, "csvSha256": format!("{:x}", Sha256::digest(csv.as_bytes()))}],
                "partitions": [{"month": "2024-01", "candles": csv_path, "marks": csv_path}]
            }}
        })).unwrap()).unwrap();
        let mut fast = Config::default();
        fast.strategy.trade_minutes = 1;
        fast.strategy.filter = "ema".into();
        fast.execution.tick_size = 0.001;
        let mut slow = fast.clone();
        slow.strategy.trade_minutes = 60;
        assert_eq!(fast.warmup_days(), 1);
        assert_eq!(slow.warmup_days(), 3);
        let mut structured = fast.clone();
        structured.strategy.entry = "structured-pullback".into();
        structured.strategy.filter = "none".into();
        structured.strategy.management = "chandelier".into();
        structured.strategy.structured_pullback =
            Some(bcr_quant::trend::config::StructuredPullback {
                key_level: bcr_quant::trend::config::KeyLevelPolicy::None,
                shape: bcr_quant::trend::config::ShapePolicy::None,
                candle: bcr_quant::trend::config::CandlePolicy::None,
                confirmation: Some(bcr_quant::trend::config::ConfirmationPolicy::BeforeBreakout),
                key_role: Some(bcr_quant::trend::config::KeyRole::PullbackRetest),
            });
        let structured = json!({"id": "structured", "config": structured});
        let mut legacy = structured.clone();
        legacy["id"] = json!("legacy");
        legacy["config"]["version"] = json!(9);
        let legacy_policy = legacy["config"]["strategy"]["structuredPullback"]
            .as_object_mut()
            .unwrap();
        legacy_policy.remove("confirmation");
        legacy_policy.remove("keyRole");
        let mut short = structured.clone();
        short["id"] = json!("short");
        short["config"]["strategy"]["direction"] = json!("short");
        let fast = json!({"id": "fast", "config": fast});
        let slow = json!({"id": "slow", "config": slow});
        let invoke = |name: &str, candidates: Value| {
            let configs_path = fixture.0.join(format!("{name}-configs.json"));
            fs::write(&configs_path, serde_json::to_vec(&candidates).unwrap()).unwrap();
            let output_path = fixture.0.join(format!("{name}-output.json"));
            run(&[
                manifest_path.to_string_lossy().into_owned(),
                "BTCUSDT".into(),
                configs_path.to_string_lossy().into_owned(),
                start.to_string(),
                end.to_string(),
                output_path.to_string_lossy().into_owned(),
                "test".into(),
            ])
            .unwrap();
            serde_json::from_slice::<Value>(&fs::read(output_path).unwrap()).unwrap()
        };
        let fast_only = invoke("fast", json!([fast]));
        let slow_only = invoke("slow", json!([slow]));
        let structured_only = invoke("structured", json!([structured]));
        let legacy_only = invoke("legacy", json!([legacy]));
        let short_only = invoke("short", json!([short]));
        let batch = invoke("batch", json!([fast, slow, structured, legacy, short]));
        assert_eq!(batch["results"][2], structured_only["results"][0]);
        assert_eq!(batch["results"][3], legacy_only["results"][0]);
        assert_eq!(batch["results"][4], short_only["results"][0]);
        assert!(fast_only.get("opportunityDiagnostics").is_none());
        assert!(legacy_only.get("opportunityDiagnostics").is_none());
        assert_eq!(batch["opportunityDiagnostics"]["version"], 1);
        assert_eq!(
            batch["opportunityDiagnostics"]["scope"],
            "account-independent-current-detector"
        );
        assert_eq!(
            batch["opportunityDiagnostics"]["results"],
            json!([
                structured_only["opportunityDiagnostics"]["results"][0],
                short_only["opportunityDiagnostics"]["results"][0]
            ])
        );
        assert_eq!(
            batch["opportunityDiagnostics"]["results"][0]["id"],
            "structured"
        );
        assert!(batch["results"][0].get("researchDiagnostics").is_none());
        let diagnostics = &batch["results"][2]["researchDiagnostics"];
        assert!(
            diagnostics["eventCounts"]["impulse:structured-pullback"]
                .as_u64()
                .unwrap()
                > 0
        );
        assert_eq!(
            diagnostics["completedTrades"],
            batch["results"][2]["metrics"]["trades"]
        );
        assert_eq!(batch["results"][0], fast_only["results"][0]);
        assert_eq!(batch["results"][1], slow_only["results"][0]);
        assert_eq!(batch["results"][0]["warmupStart"], start - DAY);
        assert_eq!(batch["results"][1]["warmupStart"], start - 3 * DAY);
        assert_eq!(batch["warmupStart"], start - 3 * DAY);
        assert!(batch["results"][0]["metrics"]["trades"].as_u64().unwrap() > 0);
        for result in batch["results"].as_array().unwrap() {
            let evaluation = &result["metrics"]["evaluation"];
            assert_eq!(evaluation["version"], 2);
            let daily = result["daily"].as_array().unwrap();
            assert_eq!(daily.len(), ((end - start) / DAY) as usize);
            assert_eq!(
                daily.last().unwrap()["equity"],
                result["metrics"]["finalEquity"]
            );
            for (legacy, point) in daily.iter().zip(evaluation["daily"].as_array().unwrap()) {
                assert_eq!(legacy["time"].as_u64().unwrap() + 1, point["to"]);
                assert_eq!(legacy["equity"], point["equity"]);
            }
        }
    }
}
