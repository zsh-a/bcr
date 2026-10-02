pub mod engine;
mod features;
pub mod model;
#[cfg(not(target_arch = "wasm32"))]
pub mod native;
pub mod reader;
pub mod research;
mod source;
pub mod strategy;

use arrow_ipc::reader::StreamReader;
use engine::Engine;
use model::{Config, Manifest, MAX_PARTITION_BYTES};
use std::io::Cursor;
use wasm_bindgen::prelude::*;

/// WASM keeps state and only one bounded Arrow partition. Each advance consumes one whole day.
#[wasm_bindgen]
pub struct JsgBacktest {
    engine: Option<Engine>,
    reader: Option<StreamReader<Cursor<Vec<u8>>>>,
    rows: usize,
}
fn js_error(error: impl ToString) -> JsValue {
    JsValue::from_str(&error.to_string())
}

/// Independent daily indicator: the same MA20 feature kernel, without portfolio state.
#[wasm_bindgen]
pub struct MarketBreadth {
    factors: features::FactorState,
    reader: Option<StreamReader<Cursor<Vec<u8>>>>,
    expected_days: usize,
    start: u32,
    finished: bool,
}
#[wasm_bindgen]
impl MarketBreadth {
    #[wasm_bindgen(constructor)]
    pub fn new(manifest: &str) -> Result<MarketBreadth, JsValue> {
        let mut manifest: Manifest = serde_json::from_str(manifest).map_err(js_error)?;
        manifest.validate().map_err(js_error)?;
        manifest.display_names = None;
        Ok(Self {
            expected_days: manifest.calendar.len(),
            start: manifest.start_date,
            factors: features::FactorState::new(manifest),
            reader: None,
            finished: false,
        })
    }
    pub fn load_partition(&mut self, bytes: Vec<u8>) -> Result<(), JsValue> {
        if self.finished || self.reader.is_some() {
            return Err(js_error("indicator finished or partition still active"));
        }
        if bytes.is_empty() || bytes.len() > MAX_PARTITION_BYTES {
            return Err(js_error("Arrow partition exceeds 32 MiB"));
        }
        self.reader = Some(StreamReader::try_new(Cursor::new(bytes), None).map_err(js_error)?);
        Ok(())
    }
    pub fn advance(&mut self) -> Result<String, JsValue> {
        let reader = self
            .reader
            .as_mut()
            .ok_or_else(|| js_error("no Arrow partition"))?;
        match reader.next() {
            Some(batch) => {
                let bars = reader::decode_day(&batch.map_err(js_error)?).map_err(js_error)?;
                let day = self.factors.advance_daily(&bars).map_err(js_error)?;
                if day.date < self.start {
                    return Ok("{}".into());
                }
                serde_json::to_string(&serde_json::json!({
                    "date": model::date_text(day.date), "breadth": day.breadth
                }))
                .map_err(js_error)
            }
            None => {
                self.reader = None;
                Ok(String::new())
            }
        }
    }
    pub fn finish(&mut self) -> Result<(), JsValue> {
        if self.finished
            || self.reader.is_some()
            || self.factors.processed_days() != self.expected_days
        {
            return Err(js_error("incomplete indicator calendar"));
        }
        self.finished = true;
        Ok(())
    }
}

/// Shared fixed SELECT; HTTP transport lives in the browser Worker.
#[wasm_bindgen]
pub fn clickhouse_sql(historical: bool) -> String {
    if historical {
        source::HISTORICAL_SQL
    } else {
        source::SNAPSHOT_SQL
    }
    .to_owned()
}

#[wasm_bindgen]
pub fn validate_research_manifest(json: &str) -> Result<(), JsValue> {
    let manifest: Manifest = serde_json::from_str(json).map_err(js_error)?;
    manifest.validate().map_err(js_error)
}

#[wasm_bindgen]
pub struct ClickHouseNormalizer {
    codes: std::collections::BTreeMap<String, u32>,
    industries: std::collections::BTreeMap<String, u32>,
    rows: usize,
}
#[wasm_bindgen]
impl ClickHouseNormalizer {
    #[wasm_bindgen(constructor)]
    pub fn new(codes: &str, industries: &str) -> Result<ClickHouseNormalizer, JsValue> {
        fn dictionary(json: &str) -> Result<std::collections::BTreeMap<String, u32>, JsValue> {
            let values: Vec<String> = serde_json::from_str(json).map_err(js_error)?;
            if values.is_empty()
                || values.len() > model::MAX_INSTRUMENTS
                || values.iter().any(|v| v.is_empty() || v.len() > 2000)
            {
                return Err(js_error("invalid ClickHouse dictionary"));
            }
            let count = values.len();
            let map: std::collections::BTreeMap<_, _> = values
                .into_iter()
                .enumerate()
                .map(|(i, v)| (v, i as u32))
                .collect();
            if map.len() != count {
                return Err(js_error("duplicate ClickHouse dictionary entries"));
            }
            Ok(map)
        }
        Ok(Self {
            codes: dictionary(codes)?,
            industries: dictionary(industries)?,
            rows: 0,
        })
    }
    pub fn normalize(&mut self, bytes: Vec<u8>, dates: &str) -> Result<Vec<u8>, JsValue> {
        let dates: Vec<u32> = serde_json::from_str(dates).map_err(js_error)?;
        let (output, rows) =
            source::normalize_partition(bytes, &dates, &self.codes, &self.industries)
                .map_err(js_error)?;
        self.rows = rows;
        Ok(output)
    }
    pub fn rows(&self) -> usize {
        self.rows
    }
}
#[wasm_bindgen]
impl JsgBacktest {
    #[wasm_bindgen(constructor)]
    pub fn new(manifest: &str, config: &str) -> Result<JsgBacktest, JsValue> {
        let manifest: Manifest = serde_json::from_str(manifest).map_err(js_error)?;
        let config: Config = serde_json::from_str(config).map_err(js_error)?;
        Ok(Self {
            engine: Some(Engine::new(manifest, config).map_err(js_error)?),
            reader: None,
            rows: 0,
        })
    }
    pub fn enable_streaming(&mut self) -> Result<(), JsValue> {
        self.engine
            .as_mut()
            .ok_or_else(|| js_error("backtest finished"))?
            .enable_streaming();
        Ok(())
    }
    pub fn set_schedule(&mut self, json: &str) -> Result<(), JsValue> {
        let steps = serde_json::from_str(json).map_err(js_error)?;
        self.engine
            .as_mut()
            .ok_or_else(|| js_error("backtest finished"))?
            .set_schedule(steps)
            .map_err(js_error)
    }
    pub fn drain_output(&mut self) -> Result<String, JsValue> {
        let chunk = self
            .engine
            .as_mut()
            .ok_or_else(|| js_error("backtest finished"))?
            .drain_output();
        serde_json::to_string(&chunk).map_err(js_error)
    }
    pub fn load_partition(&mut self, bytes: Vec<u8>) -> Result<(), JsValue> {
        if bytes.is_empty() || bytes.len() > MAX_PARTITION_BYTES {
            return Err(js_error("Arrow partition exceeds 32 MiB"));
        }
        if self.reader.is_some() {
            return Err(js_error("consume current partition before loading another"));
        }
        if self.engine.is_none() {
            return Err(js_error("backtest already finished"));
        }
        self.reader = Some(StreamReader::try_new(Cursor::new(bytes), None).map_err(js_error)?);
        Ok(())
    }
    pub fn advance(&mut self) -> Result<bool, JsValue> {
        let reader = self
            .reader
            .as_mut()
            .ok_or_else(|| js_error("no Arrow partition loaded"))?;
        match reader.next() {
            Some(batch) => {
                let bars = reader::decode_day(&batch.map_err(js_error)?).map_err(js_error)?;
                self.rows += bars.len();
                self.engine
                    .as_mut()
                    .ok_or_else(|| js_error("backtest finished"))?
                    .day(bars)
                    .map_err(js_error)?;
                Ok(true)
            }
            None => {
                self.reader = None;
                Ok(false)
            }
        }
    }
    pub fn processed_days(&self) -> usize {
        self.engine.as_ref().map_or(0, Engine::processed_days)
    }
    pub fn processed_rows(&self) -> usize {
        self.rows
    }
    pub fn finish(&mut self) -> Result<String, JsValue> {
        if self.reader.is_some() {
            return Err(js_error("partition not exhausted"));
        }
        let result = self
            .engine
            .take()
            .ok_or_else(|| js_error("backtest already finished"))?
            .finish()
            .map_err(js_error)?;
        serde_json::to_string(&result).map_err(js_error)
    }
}

#[cfg(test)]
mod tests;

/// Decode and prepare each day once; advance one independent portfolio per call so the host can yield.
#[wasm_bindgen]
pub struct JsgGrid {
    engines: Option<Vec<Engine>>,
    configs: Vec<Config>,
    factors: features::FactorState,
    reader: Option<StreamReader<Cursor<Vec<u8>>>>,
    bars: Vec<model::Bar>,
    prepared: Option<features::PreparedDay>,
    next_engine: usize,
    days: usize,
    rows: usize,
}

#[wasm_bindgen]
impl JsgGrid {
    #[wasm_bindgen(constructor)]
    pub fn new(manifest: &str, configs: &str) -> Result<JsgGrid, JsValue> {
        let mut manifest: Manifest = serde_json::from_str(manifest).map_err(js_error)?;
        manifest.validate().map_err(js_error)?;
        // UI labels need not be cloned into every independent portfolio.
        manifest.display_names = None;
        let configs: Vec<Config> = serde_json::from_str(configs).map_err(js_error)?;
        if configs.is_empty() || configs.len() > 64 {
            return Err(js_error("browser grid requires 1–64 configs"));
        }
        let engines = configs
            .iter()
            .map(|config| Engine::new_shared(manifest.clone(), config.clone()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(js_error)?;
        Ok(Self {
            engines: Some(engines),
            factors: features::FactorState::with_configs(manifest, &configs),
            configs,
            reader: None,
            bars: vec![],
            prepared: None,
            next_engine: 0,
            days: 0,
            rows: 0,
        })
    }
    pub fn load_partition(&mut self, bytes: Vec<u8>) -> Result<(), JsValue> {
        if self.engines.is_none() {
            return Err(js_error("grid finished"));
        }
        if bytes.is_empty() || bytes.len() > MAX_PARTITION_BYTES {
            return Err(js_error("Arrow partition exceeds 32 MiB"));
        }
        if self.reader.is_some() || self.prepared.is_some() {
            return Err(js_error("consume current partition before loading another"));
        }
        self.reader = Some(StreamReader::try_new(Cursor::new(bytes), None).map_err(js_error)?);
        Ok(())
    }
    pub fn advance(&mut self) -> Result<bool, JsValue> {
        let engines = self
            .engines
            .as_mut()
            .ok_or_else(|| js_error("grid finished"))?;
        if self.prepared.is_none() {
            let reader = self
                .reader
                .as_mut()
                .ok_or_else(|| js_error("no Arrow partition loaded"))?;
            match reader.next() {
                Some(batch) => {
                    self.bars = reader::decode_day(&batch.map_err(js_error)?).map_err(js_error)?;
                    self.prepared = Some(self.factors.advance(&self.bars).map_err(js_error)?);
                    self.rows += self.bars.len();
                }
                None => {
                    self.reader = None;
                    return Ok(false);
                }
            }
        }
        let engine = &mut engines[self.next_engine];
        engine
            .day_with_features(self.bars.clone(), self.prepared.as_ref())
            .map_err(js_error)?;
        engine.drain_output();
        self.next_engine += 1;
        if self.next_engine == engines.len() {
            self.next_engine = 0;
            self.prepared = None;
            self.bars.clear();
            self.days += 1;
        }
        Ok(true)
    }
    pub fn processed_days(&self) -> usize {
        self.days
    }
    pub fn processed_rows(&self) -> usize {
        self.rows
    }
    pub fn finish(&mut self) -> Result<String, JsValue> {
        if self.reader.is_some() || self.prepared.is_some() {
            return Err(js_error("partition not exhausted"));
        }
        let engines = self
            .engines
            .take()
            .ok_or_else(|| js_error("grid finished"))?;
        let results = engines
            .into_iter()
            .zip(self.configs.iter())
            .map(|(engine, config)| {
                let result = engine.finish()?;
                Ok(serde_json::json!({"config": config, "metrics": result.metrics}))
            })
            .collect::<Result<Vec<_>, String>>()
            .map_err(js_error)?;
        serde_json::to_string(&serde_json::json!({"decodedRows": self.rows, "results": results}))
            .map_err(js_error)
    }
}
