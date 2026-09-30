pub mod engine;
mod features;
pub mod model;
#[cfg(not(target_arch = "wasm32"))]
pub mod native;
pub mod reader;

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
