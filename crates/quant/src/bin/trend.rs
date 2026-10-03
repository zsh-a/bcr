//! Offline research uses the very same minute engine as the browser's WASM.
#[cfg(not(target_arch = "wasm32"))]
fn run(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use bcr_quant::trend::{
        config::Config,
        engine::Engine,
        model::{Funding, DAY},
        reader, ENGINE_VERSION,
    };
    use serde::Deserialize;
    use sha2::{Digest, Sha256};
    use std::{collections::BTreeMap, fs, io::BufWriter};
    #[derive(Deserialize)]
    struct Candidate {
        id: String,
        config: Config,
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
    let warmups = candidates
        .iter()
        .map(|candidate| {
            candidate.config.validate()?;
            start
                .checked_sub(candidate.config.warmup_days() * DAY)
                .ok_or_else(|| "invalid warmup start".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let warmup = *warmups.iter().min().unwrap();
    let mut engines = candidates
        .iter()
        .zip(&warmups)
        .map(|(c, &candidate_warmup)| {
            Engine::new(
                c.config.clone(),
                funding.clone(),
                start,
                end,
                candidate_warmup,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut trades: Vec<Vec<bcr_quant::trend::model::Trade>> =
        (0..engines.len()).map(|_| vec![]).collect();
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
            for (j, engine) in engines.iter_mut().enumerate() {
                // A longer candidate may need earlier archives. Do not change another
                // candidate's indicator seed merely because it shares this batch.
                if bar.time < warmups[j] {
                    continue;
                }
                engine.advance(bar, mark)?;
                if i % 1024 == 1023 {
                    let chunk = engine.drain();
                    trades[j].extend(chunk.trades);
                }
            }
        }
        for (j, engine) in engines.iter_mut().enumerate() {
            let chunk = engine.drain();
            trades[j].extend(chunk.trades);
        }
    }
    let mut results = vec![];
    for (j, engine) in engines.iter_mut().enumerate() {
        let metrics = engine.finish()?;
        let tail = engine.drain();
        trades[j].extend(tail.trades);
        if (metrics.final_equity
            - candidates[j].config.execution.initial_capital
            - trades[j].iter().map(|t| t.net_pnl).sum::<f64>())
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
        results.push(
            serde_json::json!({"id": candidates[j].id, "config": candidates[j].config,
            "warmupStart": warmups[j],
            "metrics": metrics, "trades": trades[j], "daily": daily }),
        );
    }
    serde_json::to_writer(
        BufWriter::new(fs::File::create(&args[5])?),
        &serde_json::json!({
            "version": 1, "engine": ENGINE_VERSION, "symbol": args[1], "window": args[6],
            "startTime": start, "endTime": end, "warmupStart": warmup,
            "planSha256": manifest["planSha256"], "partitions": used, "results": results
        }),
    )?;
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
        let batch = invoke("batch", json!([fast, slow]));
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
