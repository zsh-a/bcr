pub mod background;
pub mod config;
pub mod engine;
pub mod evaluation;
pub mod execution;
pub mod indicators;
pub mod management;
pub mod model;
pub mod position;
pub mod reader;
mod replay;
pub mod risk;
pub mod signals;
#[cfg(test)]
mod tests;

use config::Config;
use model::Funding;
use replay::Replay;
use wasm_bindgen::prelude::*;

pub const ENGINE_VERSION: &str = "trend-continuation-8";

fn error(value: impl ToString) -> JsValue {
    JsValue::from_str(&value.to_string())
}

/// Bounded CSV partition input; one deterministic state survives all archives.
#[wasm_bindgen]
pub struct TrendBacktest {
    replay: Replay,
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
        let replay = Replay::new(
            config,
            funding,
            window.start_time,
            window.end_time,
            window.warmup_start,
        )
        .map_err(error)?;
        Ok(Self { replay })
    }
    pub fn load_partition(&mut self, candles: &str, marks: &str) -> Result<(), JsValue> {
        self.replay.load_partition(candles, marks).map_err(error)
    }
    pub fn advance(&mut self, rows: u32) -> Result<bool, JsValue> {
        self.replay.advance(rows).map_err(error)
    }
    pub fn processed_rows(&self) -> u32 {
        self.replay.processed_rows()
    }
    pub fn drain_output(&mut self) -> Result<String, JsValue> {
        serde_json::to_string(&self.replay.drain()).map_err(error)
    }
    pub fn finish(&mut self) -> Result<String, JsValue> {
        let metrics = self.replay.finish().map_err(error)?;
        serde_json::to_string(&metrics).map_err(error)
    }
}
