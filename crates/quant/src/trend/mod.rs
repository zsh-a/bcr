pub mod engine;
pub mod indicators;
pub mod model;
pub mod reader;
#[cfg(test)]
mod tests;

use engine::Engine;
use model::{Bar, Config, Funding};
use wasm_bindgen::prelude::*;

fn error(value: impl ToString) -> JsValue {
    JsValue::from_str(&value.to_string())
}

/// Bounded CSV partition input; one deterministic state survives all archives.
#[wasm_bindgen]
pub struct TrendBacktest {
    engine: Engine,
    partition: Vec<(Bar, Bar)>,
    cursor: usize,
}
#[wasm_bindgen]
impl TrendBacktest {
    #[wasm_bindgen(constructor)]
    pub fn new(config: &str, funding: &str, window: &str) -> Result<TrendBacktest, JsValue> {
        let config: Config = serde_json::from_str(config).map_err(error)?;
        let funding: Vec<Funding> = serde_json::from_str(funding).map_err(error)?;
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Window {
            start_time: u64,
            end_time: u64,
            warmup_start: u64,
        }
        let window: Window = serde_json::from_str(window).map_err(error)?;
        let engine = Engine::new(
            config,
            funding,
            window.start_time,
            window.end_time,
            window.warmup_start,
        )
        .map_err(error)?;
        Ok(Self {
            engine,
            partition: vec![],
            cursor: 0,
        })
    }
    pub fn load_partition(&mut self, candles: &str, marks: &str) -> Result<(), JsValue> {
        if self.cursor < self.partition.len() {
            return Err(error("partition still active"));
        }
        self.partition = reader::aligned(candles, marks).map_err(error)?;
        self.cursor = 0;
        Ok(())
    }
    pub fn advance(&mut self, rows: u32) -> Result<bool, JsValue> {
        if rows == 0 || rows > 1024 {
            return Err(error("advance requires 1–1024 rows"));
        }
        let end = (self.cursor + rows as usize).min(self.partition.len());
        while self.cursor < end {
            let (bar, mark) = self.partition[self.cursor];
            self.engine.advance(bar, mark).map_err(error)?;
            self.cursor += 1;
        }
        Ok(self.cursor == self.partition.len())
    }
    pub fn processed_rows(&self) -> u32 {
        self.engine.rows() as u32
    }
    pub fn drain_output(&mut self) -> Result<String, JsValue> {
        serde_json::to_string(&self.engine.drain()).map_err(error)
    }
    pub fn finish(&mut self) -> Result<String, JsValue> {
        if self.cursor != self.partition.len() {
            return Err(error("partition still active"));
        }
        let metrics = self.engine.finish().map_err(error)?;
        serde_json::to_string(&metrics).map_err(error)
    }
}
