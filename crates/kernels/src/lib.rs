//! BCR WASM kernels（架构文档 §9.1：TypedArray / linear memory / 最小拷贝）。
//!
//! 调用方从 Worker 以分块窗口喂数据，禁止整段装载大文件（§4）。

use wasm_bindgen::prelude::*;

/// 一次性 BLAKE3（小数据）。大文件请用 `StreamingBlake3` 分块喂入。
#[wasm_bindgen]
pub fn blake3_hex(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

/// 流式 BLAKE3：配合 readRange 窗口流动，内存占用与窗口大小同级。
#[wasm_bindgen]
pub struct StreamingBlake3 {
    hasher: blake3::Hasher,
}

#[wasm_bindgen]
impl StreamingBlake3 {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            hasher: blake3::Hasher::new(),
        }
    }

    pub fn update(&mut self, chunk: &[u8]) {
        self.hasher.update(chunk);
    }

    pub fn finalize_hex(&self) -> String {
        self.hasher.finalize().to_hex().to_string()
    }
}

impl Default for StreamingBlake3 {
    fn default() -> Self {
        Self::new()
    }
}

/// f32 PCM 的 RMS（DSP 最小示例）。
#[wasm_bindgen]
pub fn rms_f32(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples
        .iter()
        .map(|&s| {
            let s = f64::from(s);
            s * s
        })
        .sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// f32 PCM 的峰值电平。
#[wasm_bindgen]
pub fn peak_f32(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0_f32, |acc, &s| acc.max(s.abs()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blake3_matches_reference() {
        // BLAKE3("") 官方向量
        assert_eq!(
            blake3_hex(b""),
            "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
        );
        assert_eq!(
            blake3_hex(b"abc"),
            "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85"
        );
    }

    #[test]
    fn streaming_matches_one_shot() {
        let data: Vec<u8> = (0..10_000u32).flat_map(u32::to_le_bytes).collect();
        let mut hasher = StreamingBlake3::new();
        for chunk in data.chunks(1024) {
            hasher.update(chunk);
        }
        assert_eq!(hasher.finalize_hex(), blake3_hex(&data));
    }

    #[test]
    fn rms_and_peak() {
        assert_eq!(rms_f32(&[]), 0.0);
        assert!((rms_f32(&[0.5, -0.5]) - 0.5).abs() < 1e-6);
        assert_eq!(peak_f32(&[0.25, -0.75, 0.5]), 0.75);
        assert_eq!(peak_f32(&[]), 0.0);
    }
}
