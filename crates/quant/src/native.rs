//! Native I/O only. Credentials never enter manifests, errors, WASM or the UI.
use crate::{model::*, reader::decode_day};
use arrow_array::{
    Array, ArrayRef, BinaryArray, LargeStringArray, RecordBatch, StringArray, UInt32Array,
};
use arrow_ipc::{reader::StreamReader, writer::StreamWriter};
use arrow_select::concat::concat_batches;
use chrono::{Datelike, NaiveDate};
use reqwest::{
    blocking::{Client, Response},
    redirect::Policy,
    Url,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{BufReader, Read},
    path::Path,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub const SNAPSHOT_SQL: &str = include_str!("../sql/snapshot.sql");
pub struct ClickHouse {
    client: Client,
    url: Url,
    database: String,
    user: String,
    password: String,
}
impl ClickHouse {
    pub fn from_env() -> Result<Self, Error> {
        let url =
            Url::parse(&std::env::var("CLICKHOUSE_URL").unwrap_or("http://localhost:8123/".into()))
                .map_err(|_| "invalid ClickHouse endpoint")?;
        if !["http", "https"].contains(&url.scheme())
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.host_str().is_none()
        {
            return Err("endpoint must be HTTP(S) without credentials/query/fragment".into());
        }
        let database = std::env::var("CLICKHOUSE_DATABASE").unwrap_or("stock_data".into());
        if database.is_empty()
            || !database
                .bytes()
                .enumerate()
                .all(|(i, b)| b == b'_' || b.is_ascii_alphabetic() || (i > 0 && b.is_ascii_digit()))
        {
            return Err("invalid database identifier".into());
        }
        let client = Client::builder()
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|_| "HTTP client initialization failed")?;
        Ok(Self {
            client,
            url,
            database,
            user: std::env::var("CLICKHOUSE_USER").unwrap_or("default".into()),
            password: std::env::var("CLICKHOUSE_PASSWORD").unwrap_or_default(),
        })
    }
    pub fn query(&self, sql: &str, params: &BTreeMap<String, String>) -> Result<Response, Error> {
        let mut options = vec![
            ("database".to_string(), self.database.clone()),
            ("readonly".into(), "1".into()),
        ];
        options.extend(
            params
                .iter()
                .map(|(k, v)| (format!("param_{k}"), v.clone())),
        );
        let mut url = self.url.clone();
        url.query_pairs_mut().extend_pairs(options);
        let response = self
            .client
            .post(url)
            .header("X-ClickHouse-User", &self.user)
            .header("X-ClickHouse-Key", &self.password)
            .body(sql.to_owned())
            .send()
            .map_err(|_| "ClickHouse request failed (connection/timeout)")?;
        if !response.status().is_success() {
            return Err(format!(
                "ClickHouse HTTP {}; check permissions/schema",
                response.status().as_u16()
            )
            .into());
        }
        Ok(response)
    }
    pub fn json(&self, sql: &str, params: &BTreeMap<String, String>) -> Result<Vec<Value>, Error> {
        let mut text = String::new();
        self.query(&format!("{sql} FORMAT JSONEachRow"), params)?
            .take(4 * 1024 * 1024 + 1)
            .read_to_string(&mut text)
            .map_err(|_| "invalid ClickHouse JSON response")?;
        if text.len() > 4 * 1024 * 1024 {
            return Err("metadata response exceeds 4 MiB".into());
        }
        text.lines()
            .filter(|s| !s.is_empty())
            .map(|s| serde_json::from_str(s).map_err(|_| "invalid ClickHouse metadata".into()))
            .collect()
    }
    pub fn inspect(&self) -> Result<Value, Error> {
        let p = BTreeMap::from([("db".into(), self.database.clone())]);
        let columns=self.json("SELECT table,name,type FROM system.columns WHERE database={db:String} AND table IN ('index_stocks','finicial_report','index_membership_history','financial_revisions','corporate_actions','stock_daily_execution') ORDER BY table,position",&p)?;
        let has = |table: &str, name: &str| {
            columns
                .iter()
                .any(|r| r["table"] == table && r["name"] == name)
        };
        let membership = has("index_membership_history", "is_member")
            && has("index_membership_history", "publish_date");
        let financials =
            has("financial_revisions", "publish_date") && has("financial_revisions", "version");
        let actions =
            has("corporate_actions", "record_date") && has("corporate_actions", "pay_date");
        let limits =
            has("stock_daily_execution", "limit_up") && has("stock_daily_execution", "limit_down");
        Ok(
            json!({"membershipHistory":membership,"financialRevisions":financials,"corporateActions":actions,"dailyLimits":limits,"strictPitReady":membership&&financials&&actions&&limits,"columns":columns}),
        )
    }
}

pub fn hash_file(path: &Path) -> Result<String, Error> {
    let mut h = Sha256::new();
    let mut f = File::open(path)?;
    let mut bytes = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut bytes)?;
        if n == 0 {
            break;
        }
        h.update(&bytes[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}
pub fn verify_snapshot(root: &Path) -> Result<(), Error> {
    let path = root.join("snapshot-sha256.json");
    if !path.exists() {
        return Ok(());
    }
    let hashes: BTreeMap<String, String> = serde_json::from_reader(File::open(path)?)?;
    for (name, expected) in hashes {
        if name.contains(['/', '\\']) || name == "." || name == ".." {
            return Err("invalid snapshot hash path".into());
        }
        if hash_file(&root.join(&name))? != expected {
            return Err(format!("snapshot integrity mismatch: {name}").into());
        }
    }
    Ok(())
}
pub fn read_snapshot(
    path: &Path,
    mut day: impl FnMut(Vec<Bar>) -> Result<(), Error>,
) -> Result<Manifest, Error> {
    let manifest: Manifest = serde_json::from_reader(File::open(path)?)?;
    manifest.validate()?;
    let root = path.parent().ok_or("missing snapshot root")?;
    verify_snapshot(root)?;
    for partition in &manifest.partitions {
        let file = File::open(root.join(&partition.file))?;
        if file.metadata()?.len() != partition.bytes as u64 {
            return Err("partition size mismatch".into());
        }
        let mut rows = 0;
        for batch in StreamReader::try_new(BufReader::new(file), None)? {
            let bars = decode_day(&batch?)?;
            rows += bars.len();
            day(bars)?;
        }
        if rows != partition.rows {
            return Err("partition row mismatch".into());
        }
    }
    Ok(manifest)
}
fn string_value(array: &ArrayRef, index: usize) -> Result<&str, Error> {
    if array.is_null(index) {
        return Err("null dictionary value".into());
    }
    if let Some(a) = array.as_any().downcast_ref::<StringArray>() {
        return Ok(a.value(index));
    }
    if let Some(a) = array.as_any().downcast_ref::<LargeStringArray>() {
        return Ok(a.value(index));
    }
    if let Some(a) = array.as_any().downcast_ref::<BinaryArray>() {
        return Ok(std::str::from_utf8(a.value(index))?);
    }
    Err("ClickHouse code/industry must be Arrow UTF8/Binary".into())
}
fn normalize(
    batch: &RecordBatch,
    codes: &BTreeMap<String, u32>,
    industries: &BTreeMap<String, u32>,
) -> Result<RecordBatch, Error> {
    let code = batch.column_by_name("code").ok_or("missing code")?;
    let industry = batch
        .column_by_name("industry_code")
        .ok_or("missing industry")?;
    let ids: Vec<u32> = (0..batch.num_rows())
        .map(|i| {
            let c = string_value(code, i)?;
            codes
                .get(c)
                .copied()
                .ok_or_else(|| "unknown instrument".into())
        })
        .collect::<Result<_, Error>>()?;
    let sectors: Vec<u32> = (0..batch.num_rows())
        .map(|i| {
            let c = string_value(industry, i)?;
            industries
                .get(c)
                .copied()
                .ok_or_else(|| "unknown industry".into())
        })
        .collect::<Result<_, Error>>()?;
    let mut arrays: Vec<ArrayRef> = vec![];
    for name in [
        "date",
        "id",
        "industry",
        "open",
        "high",
        "low",
        "close",
        "preclose",
        "adjfactor",
        "profit",
        "shares",
        "is_st",
        "tradable",
        "breadth_member",
        "selection_member",
    ] {
        let array: ArrayRef = match name {
            "id" => Arc::new(UInt32Array::from(ids.clone())),
            "industry" => Arc::new(UInt32Array::from(sectors.clone())),
            _ => batch.column_by_name(name).ok_or("missing feature")?.clone(),
        };
        arrays.push(array);
    }
    let mut names = vec![
        "date",
        "id",
        "industry",
        "open",
        "high",
        "low",
        "close",
        "preclose",
        "adjfactor",
        "profit",
        "shares",
        "is_st",
        "tradable",
        "breadth_member",
        "selection_member",
    ];
    for name in ["volume", "limit_up", "limit_down"] {
        if let Some(a) = batch.column_by_name(name) {
            names.push(name);
            arrays.push(a.clone());
        }
    }
    let schema = arrow_array::RecordBatch::try_from_iter(names.into_iter().zip(arrays))?;
    Ok(schema)
}

struct DailyWriter<'a> {
    root: &'a Path,
    writer: Option<StreamWriter<File>>,
    partitions: Vec<Partition>,
    dates: Vec<u32>,
    bytes: usize,
    rows: usize,
    days: usize,
}
impl DailyWriter<'_> {
    fn finish_partition(&mut self) -> Result<(), Error> {
        if let Some(mut w) = self.writer.take() {
            w.finish()?;
            w.get_ref().sync_all()?;
            let file = format!("part-{:04}.arrow", self.partitions.len());
            let bytes = fs::metadata(self.root.join(&file))?.len() as usize;
            if bytes > MAX_PARTITION_BYTES {
                return Err("Arrow day exceeds partition limit".into());
            }
            self.partitions.push(Partition {
                file,
                bytes,
                rows: self.rows,
            });
            self.bytes = 0;
            self.rows = 0;
            self.days = 0;
        }
        Ok(())
    }
    fn day(&mut self, batch: RecordBatch) -> Result<(), Error> {
        let bars = decode_day(&batch)?;
        let date = bars[0].date;
        if self.dates.last().is_some_and(|d| *d >= date) {
            return Err("unordered ClickHouse daily stream".into());
        }
        // Conservative bounded estimate includes schema/IPC alignment overhead.
        let estimate = batch.num_rows()
            * if batch.column_by_name("volume").is_some() {
                104
            } else {
                80
            }
            + 64 * 1024;
        if estimate > MAX_PARTITION_BYTES {
            return Err("single trading day exceeds 32 MiB".into());
        }
        if self.days >= 20 || self.bytes + estimate > MAX_PARTITION_BYTES {
            self.finish_partition()?;
        }
        if self.writer.is_none() {
            self.writer = Some(StreamWriter::try_new(
                File::create(
                    self.root
                        .join(format!("part-{:04}.arrow", self.partitions.len())),
                )?,
                &batch.schema(),
            )?);
        }
        self.writer.as_mut().unwrap().write(&batch)?;
        self.bytes += estimate;
        self.rows += batch.num_rows();
        self.days += 1;
        self.dates.push(date);
        Ok(())
    }
}

pub fn export_snapshot(
    start: &str,
    end: &str,
    output: &Path,
    strict_pit: bool,
) -> Result<Value, Error> {
    let start = NaiveDate::parse_from_str(start, "%Y-%m-%d")?;
    let end = NaiveDate::parse_from_str(end, "%Y-%m-%d")?;
    if start > end || output.exists() {
        return Err("invalid dates or output already exists".into());
    }
    let timer = Instant::now();
    let ch = ClickHouse::from_env()?;
    let quality = ch.inspect()?;
    if strict_pit && quality["strictPitReady"] != true {
        return Err("strict PIT export refused: historical membership/revisions/actions/daily limits missing".into());
    }
    let mut params = BTreeMap::from([
        ("breadth".into(), "000985".into()),
        ("selection".into(), "399101".into()),
    ]);
    let rows = ch.json(
        "SELECT calendar_date AS date FROM trade_dates FINAL WHERE is_trading_day=1 ORDER BY date",
        &BTreeMap::new(),
    )?;
    let calendar: Vec<NaiveDate> = rows
        .iter()
        .map(|r| {
            NaiveDate::parse_from_str(r["date"].as_str().ok_or("invalid calendar")?, "%Y-%m-%d")
                .map_err(Error::from)
        })
        .collect::<Result<_, _>>()?;
    let selected: Vec<NaiveDate> = calendar
        .iter()
        .copied()
        .filter(|d| *d >= start && *d <= end)
        .collect();
    let first = *selected.first().ok_or("no trading days")?;
    let last = *selected.last().unwrap();
    let before: Vec<NaiveDate> = calendar.iter().copied().filter(|d| *d < first).collect();
    if before.len() < 30 || !calendar.iter().any(|d| *d > last) {
        return Err("calendar lacks warmup or future weekly session".into());
    }
    let mut week_last = BTreeMap::new();
    for date in &calendar {
        week_last.insert((date.iso_week().year(), date.iso_week().week()), *date);
    }
    let sessions: Vec<Session> = before[before.len() - 30..]
        .iter()
        .chain(&selected)
        .map(|d| Session {
            date: d.format("%Y%m%d").to_string().parse().unwrap(),
            rebalance: week_last[&(d.iso_week().year(), d.iso_week().week())] == *d,
        })
        .collect();
    let rows=ch.json(if strict_pit { "SELECT DISTINCT code FROM index_membership_history FINAL WHERE index IN ({breadth:String},{selection:String}) ORDER BY code" } else { "SELECT DISTINCT code FROM index_stocks FINAL WHERE index IN ({breadth:String},{selection:String}) ORDER BY code" },&params)?;
    let codes: BTreeMap<String, u32> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| {
            Ok((
                r["code"].as_str().ok_or("invalid code")?.to_owned(),
                i as u32,
            ))
        })
        .collect::<Result<_, Error>>()?;
    if codes.is_empty() || codes.len() > MAX_INSTRUMENTS {
        return Err("invalid universe size".into());
    }
    let rows=ch.json("SELECT DISTINCT industry_code FROM industry_info FINAL WHERE industry_code!='' ORDER BY industry_code",&params)?;
    let mut sectors: Vec<String> = rows
        .iter()
        .map(|r| {
            r["industry_code"]
                .as_str()
                .ok_or("invalid industry")
                .map(str::to_owned)
        })
        .collect::<Result<_, _>>()?;
    sectors.push("unknown".into());
    sectors.sort();
    sectors.dedup();
    let industries: BTreeMap<String, u32> = sectors
        .iter()
        .enumerate()
        .map(|(i, s)| (s.clone(), i as u32))
        .collect();
    params.insert("start".into(), date_text(sessions[0].date));
    params.insert("end".into(), last.to_string());
    let parent = output
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let staging = parent.join(format!(
        ".jsg-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    ));
    fs::create_dir(&staging)?;
    let result = (|| -> Result<Value, Error> {
        let query_timer = Instant::now();
        let sql = if strict_pit {
            include_str!("../sql/historical.sql")
        } else {
            SNAPSHOT_SQL
        };
        let mut actions = vec![];
        if strict_pit {
            let coverage = ch.json("SELECT dataset FROM research_coverage WHERE verified=1 AND start_date<={start:Date} AND end_date>={end:Date} GROUP BY dataset", &params)?;
            for required in [
                "membership",
                "financials",
                "corporateActions",
                "priceLimits",
            ] {
                if !coverage.iter().any(|r| r["dataset"] == required) {
                    return Err(format!("missing audited coverage: {required}").into());
                }
            }
            let invalid=ch.json("SELECT count() AS n FROM index_membership_history FINAL WHERE is_member NOT IN (0,1)",&BTreeMap::new())?;
            if invalid[0]["n"].as_u64() != Some(0) {
                return Err("invalid membership events".into());
            }
            // Limits must cover every valid price row; an INNER JOIN cannot hide missing rows.
            let missing=ch.json("SELECT count() AS n FROM (SELECT * FROM stock_daily FINAL) p LEFT ANTI JOIN (SELECT * FROM stock_daily_execution FINAL) e ON p.code=e.code AND p.date=e.date WHERE p.date BETWEEN {start:Date} AND {end:Date} AND p.open>0 AND p.close>0 AND p.code IN (SELECT code FROM index_membership_history FINAL WHERE index IN ({breadth:String},{selection:String}))",&params)?;
            if missing[0]["n"].as_u64() != Some(0) {
                return Err("missing daily execution limits".into());
            }
            let rows=ch.json("SELECT code,toUInt32(formatDateTime(record_date,'%Y%m%d')) AS recordDate,toUInt32(formatDateTime(ex_date,'%Y%m%d')) AS exDate,toUInt32(formatDateTime(pay_date,'%Y%m%d')) AS payDate,toUInt32(formatDateTime(share_available_date,'%Y%m%d')) AS shareAvailableDate,toUInt32(formatDateTime(known_date,'%Y%m%d')) AS knownDate,cash_per_share AS cashPerShare,withholding_per_share AS withholdingPerShare,share_ratio AS shareRatio,fractional_cash_price AS fractionalCashPrice FROM corporate_actions FINAL WHERE record_date BETWEEN {start:Date} AND {end:Date} ORDER BY ex_date,code",&params)?;
            for mut row in rows {
                let code = row["code"].as_str().ok_or("invalid action code")?;
                if let Some(id) = codes.get(code) {
                    row.as_object_mut().unwrap().remove("code");
                    row["id"] = json!(id);
                    actions.push(serde_json::from_value::<CorporateAction>(row)?);
                }
            }
        }
        let response = ch.query(sql, &params)?;
        let header_stats = response
            .headers()
            .get("X-ClickHouse-Summary")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| serde_json::from_str::<Value>(s).ok());
        let mut daily = DailyWriter {
            root: &staging,
            writer: None,
            partitions: vec![],
            dates: vec![],
            bytes: 0,
            rows: 0,
            days: 0,
        };
        let mut chunks: Vec<RecordBatch> = vec![];
        let mut current = 0;
        let mut count = 0;
        for batch in StreamReader::try_new(BufReader::new(response), None)? {
            let batch = normalize(&batch?, &codes, &industries)?;
            let dates = batch
                .column_by_name("date")
                .unwrap()
                .as_any()
                .downcast_ref::<UInt32Array>()
                .ok_or("wrong date type")?;
            let mut begin = 0;
            while begin < batch.num_rows() {
                let date = dates.value(begin);
                let mut finish = begin + 1;
                while finish < batch.num_rows() && dates.value(finish) == date {
                    finish += 1;
                }
                if current != 0 && current != date {
                    daily.day(concat_batches(&chunks[0].schema(), &chunks)?)?;
                    chunks.clear();
                    count = 0;
                }
                current = date;
                count += finish - begin;
                if count > MAX_INSTRUMENTS {
                    return Err("oversized ClickHouse trading day".into());
                }
                chunks.push(batch.slice(begin, finish - begin));
                begin = finish;
            }
        }
        if !chunks.is_empty() {
            daily.day(concat_batches(&chunks[0].schema(), &chunks)?)?;
        }
        daily.finish_partition()?;
        if daily.dates != sessions.iter().map(|s| s.date).collect::<Vec<_>>() {
            return Err("ClickHouse dates differ from exchange calendar".into());
        }
        let manifest = Manifest {
            version: if strict_pit { 2 } else { 1 },
            schema: if strict_pit {
                "jsg-daily-v2"
            } else {
                "jsg-daily-v1"
            }
            .into(),
            name: format!("JSG {first} to {last}"),
            source: format!("Rust / ClickHouse {}", ch.database),
            universe_mode: if strict_pit { "historical" } else { "snapshot" }.into(),
            warnings: vec![
                "当前成分快照缺少退出历史，存在幸存者偏差。".into(),
                "旧财报表覆盖历史修订版本，无法恢复已丢失的历史信息。".into(),
                "股本按公布日与变更日均严格早于交易日取值。".into(),
                "v1 使用固定涨跌停比例与复权研究单位；raw-v2 需要明确公司行为和每日涨跌停价。"
                    .into(),
            ],
            start_date: first.format("%Y%m%d").to_string().parse()?,
            end_date: last.format("%Y%m%d").to_string().parse()?,
            instruments: codes
                .keys()
                .map(|c| Instrument {
                    code: c.clone(),
                    limit_ratio: if c.starts_with("sz.30") || c.starts_with("sh.68") {
                        0.2
                    } else {
                        0.1
                    },
                })
                .collect(),
            industries: sectors,
            calendar: sessions,
            partitions: daily.partitions,
            corporate_actions: actions,
            data_quality: if strict_pit {
                Some(DataQuality {
                    membership: "historical".into(),
                    financials: "revisions".into(),
                    corporate_actions: "complete".into(),
                    price_limits: "daily".into(),
                })
            } else {
                None
            },
        };
        let mut manifest = manifest;
        if strict_pit {
            manifest.warnings = vec![
                "公告仅有日期时，按下一交易日可用；行业沿用旧库生效日期，尚无独立公告时间。".into(),
            ];
        }
        manifest.validate()?;
        let statistics = json!({"rows":manifest.partitions.iter().map(|p|p.rows).sum::<usize>(),"bytes":manifest.partitions.iter().map(|p|p.bytes).sum::<usize>(),"days":manifest.calendar.len(),"queryAndWriteMs":query_timer.elapsed().as_secs_f64()*1000.0,"totalMs":timer.elapsed().as_secs_f64()*1000.0,"clickhouse":header_stats,"sourceCapabilities":quality,"sqlSha256":format!("{:x}",Sha256::digest(sql.as_bytes()))});
        fs::write(
            staging.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest)?,
        )?;
        fs::write(
            staging.join("export-statistics.json"),
            serde_json::to_vec_pretty(&statistics)?,
        )?;
        let mut hashes = BTreeMap::new();
        for name in std::iter::once("manifest.json")
            .chain(manifest.partitions.iter().map(|p| p.file.as_str()))
        {
            hashes.insert(name, hash_file(&staging.join(name))?);
        }
        fs::write(
            staging.join("snapshot-sha256.json"),
            serde_json::to_vec_pretty(&hashes)?,
        )?;
        if output.exists() {
            return Err("output appeared during export".into());
        }
        fs::rename(&staging, output)?;
        Ok(statistics)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(staging);
    }
    result
}

/// Decode each day once; independent portfolios share I/O and remain sequential through time.
pub fn grid(path: &Path, configs: Vec<Config>, threads: usize) -> Result<Value, Error> {
    use rayon::prelude::*;
    if configs.is_empty() || configs.len() > 256 || threads == 0 || threads > 64 {
        return Err("grid requires 1–256 configs and 1–64 threads".into());
    }
    let manifest: Manifest = serde_json::from_reader(File::open(path)?)?;
    let mut engines: Vec<crate::engine::Engine> = configs
        .iter()
        .map(|c| crate::engine::Engine::new(manifest.clone(), c.clone()))
        .collect::<Result<_, _>>()?;
    for e in &mut engines {
        e.enable_streaming();
    }
    let mut factors = crate::features::FactorState::new(manifest);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(threads.min(configs.len()))
        .build()?;
    let timer = Instant::now();
    let mut rows = 0;
    read_snapshot(path, |bars| {
        rows += bars.len();
        let prepared = factors.advance(&bars)?;
        pool.install(|| {
            engines.par_iter_mut().try_for_each(|e| {
                e.day_with_features(bars.clone(), Some(&prepared))?;
                e.drain_output();
                Ok::<_, String>(())
            })
        })?;
        Ok(())
    })?;
    let results: Vec<Value> = engines
        .into_iter()
        .zip(configs)
        .map(|(e, c)| Ok(json!({"config":c,"metrics":e.finish()?.metrics})))
        .collect::<Result<_, Error>>()?;
    Ok(
        json!({"elapsedMs":timer.elapsed().as_secs_f64()*1000.0,"decodedRows":rows,"threads":threads.min(results.len()),"results":results}),
    )
}
