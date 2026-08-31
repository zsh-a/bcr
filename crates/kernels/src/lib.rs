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

#[derive(Debug)]
struct TradeCore {
    entry_index: u32,
    exit_index: u32,
    entry_price: f64,
    exit_price: f64,
    return_pct: f64,
    pnl: f64,
}

#[derive(Debug)]
struct BacktestCore {
    equity: Vec<f64>,
    drawdown: Vec<f64>,
    trades: Vec<TradeCore>,
    total_return: f64,
    annualized_return: f64,
    buy_hold_return: f64,
    sharpe: f64,
    max_drawdown: f64,
    win_rate: f64,
    exposure: f64,
    final_equity: f64,
}

fn sample_standard_deviation(values: &[f64]) -> f64 {
    if values.len() < 2 {
        return 0.0;
    }
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let variance = values
        .iter()
        .map(|value| (value - mean).powi(2))
        .sum::<f64>()
        / (values.len() - 1) as f64;
    variance.sqrt()
}

fn backtest_long_only_core(
    closes: &[f64],
    positions: &[u8],
    initial_capital: f64,
    fee_bps: f64,
    annualization_years: f64,
) -> Result<BacktestCore, String> {
    if closes.is_empty() || closes.len() != positions.len() {
        return Err("closes and positions must have the same non-zero length".into());
    }
    if closes
        .iter()
        .any(|value| !value.is_finite() || *value <= 0.0)
    {
        return Err("closes must contain positive finite values".into());
    }
    if positions.iter().any(|position| *position > 1) {
        return Err("positions must contain only 0 or 1".into());
    }
    if !initial_capital.is_finite() || !fee_bps.is_finite() || !annualization_years.is_finite() {
        return Err("backtest parameters must be finite".into());
    }

    let initial_capital = initial_capital.max(1.0);
    let fee = (fee_bps.max(0.0) / 10_000.0).min(0.99);
    let mut equity = Vec::with_capacity(closes.len());
    let mut drawdown = Vec::with_capacity(closes.len());
    let mut trades = Vec::new();
    let mut daily_returns = Vec::with_capacity(closes.len().saturating_sub(1));
    let mut value = initial_capital;
    let mut peak = initial_capital;
    let mut position = 0_u8;
    let mut entry: Option<(u32, f64, f64)> = None;
    let mut exposed_bars = 0_usize;

    for index in 0..closes.len() {
        let close = closes[index];
        let before = value;
        if position == 1 && index > 0 {
            value *= close / closes[index - 1];
            exposed_bars += 1;
        }

        let next_position = positions[index];
        if next_position != position {
            value *= 1.0 - fee;
            if next_position == 1 {
                entry = Some((index as u32, close, value));
            } else if let Some((entry_index, entry_price, entry_capital)) = entry.take() {
                trades.push(TradeCore {
                    entry_index,
                    exit_index: index as u32,
                    entry_price,
                    exit_price: close,
                    return_pct: close / entry_price - 1.0 - fee * 2.0,
                    pnl: value - entry_capital,
                });
            }
            position = next_position;
        }

        if index > 0 {
            daily_returns.push(if before > 0.0 {
                value / before - 1.0
            } else {
                0.0
            });
        }
        peak = peak.max(value);
        equity.push(value);
        drawdown.push(if peak > 0.0 { value / peak - 1.0 } else { 0.0 });
    }

    if let Some((entry_index, entry_price, entry_capital)) = entry {
        let exit_index = closes.len() - 1;
        let exit_price = closes[exit_index];
        value *= 1.0 - fee;
        trades.push(TradeCore {
            entry_index,
            exit_index: exit_index as u32,
            entry_price,
            exit_price,
            return_pct: exit_price / entry_price - 1.0 - fee * 2.0,
            pnl: value - entry_capital,
        });
        peak = peak.max(value);
        equity[exit_index] = value;
        drawdown[exit_index] = value / peak - 1.0;
    }

    let total_return = value / initial_capital - 1.0;
    let volatility = sample_standard_deviation(&daily_returns);
    let average_return = if daily_returns.is_empty() {
        0.0
    } else {
        daily_returns.iter().sum::<f64>() / daily_returns.len() as f64
    };
    let winning = trades.iter().filter(|trade| trade.pnl > 0.0).count();
    let years = annualization_years.max(1.0 / 252.0);

    Ok(BacktestCore {
        equity,
        max_drawdown: drawdown.iter().copied().fold(0.0, f64::min),
        drawdown,
        total_return,
        annualized_return: (1.0 + total_return).powf(1.0 / years) - 1.0,
        buy_hold_return: closes[closes.len() - 1] / closes[0] - 1.0,
        sharpe: if volatility > 0.0 {
            average_return / volatility * 252.0_f64.sqrt()
        } else {
            0.0
        },
        win_rate: if trades.is_empty() {
            0.0
        } else {
            winning as f64 / trades.len() as f64
        },
        exposure: if closes.len() > 1 {
            exposed_bars as f64 / (closes.len() - 1) as f64
        } else {
            0.0
        },
        final_equity: value,
        trades,
    })
}

/// Long-only 回测结果。数组 getter 返回 TypedArray，交易日期由调用方用索引映射。
#[wasm_bindgen]
pub struct BacktestOutput {
    inner: BacktestCore,
}

#[wasm_bindgen]
impl BacktestOutput {
    pub fn equity(&self) -> Vec<f64> {
        self.inner.equity.clone()
    }

    pub fn drawdown(&self) -> Vec<f64> {
        self.inner.drawdown.clone()
    }

    pub fn trade_entry_indices(&self) -> Vec<u32> {
        self.inner
            .trades
            .iter()
            .map(|trade| trade.entry_index)
            .collect()
    }

    pub fn trade_exit_indices(&self) -> Vec<u32> {
        self.inner
            .trades
            .iter()
            .map(|trade| trade.exit_index)
            .collect()
    }

    pub fn trade_entry_prices(&self) -> Vec<f64> {
        self.inner
            .trades
            .iter()
            .map(|trade| trade.entry_price)
            .collect()
    }

    pub fn trade_exit_prices(&self) -> Vec<f64> {
        self.inner
            .trades
            .iter()
            .map(|trade| trade.exit_price)
            .collect()
    }

    pub fn trade_returns(&self) -> Vec<f64> {
        self.inner
            .trades
            .iter()
            .map(|trade| trade.return_pct)
            .collect()
    }

    pub fn trade_pnls(&self) -> Vec<f64> {
        self.inner.trades.iter().map(|trade| trade.pnl).collect()
    }

    pub fn total_return(&self) -> f64 {
        self.inner.total_return
    }

    pub fn annualized_return(&self) -> f64 {
        self.inner.annualized_return
    }

    pub fn buy_hold_return(&self) -> f64 {
        self.inner.buy_hold_return
    }

    pub fn sharpe(&self) -> f64 {
        self.inner.sharpe
    }

    pub fn max_drawdown(&self) -> f64 {
        self.inner.max_drawdown
    }

    pub fn win_rate(&self) -> f64 {
        self.inner.win_rate
    }

    pub fn exposure(&self) -> f64 {
        self.inner.exposure
    }

    pub fn trade_count(&self) -> u32 {
        self.inner.trades.len() as u32
    }

    pub fn final_equity(&self) -> f64 {
        self.inner.final_equity
    }
}

/// f64 收盘价 + u8 仓位批次进入 Rust linear memory，一次调用完成权益、回撤、交易与指标。
#[wasm_bindgen]
pub fn backtest_long_only_f64(
    closes: &[f64],
    positions: &[u8],
    initial_capital: f64,
    fee_bps: f64,
    annualization_years: f64,
) -> Result<BacktestOutput, JsError> {
    backtest_long_only_core(
        closes,
        positions,
        initial_capital,
        fee_bps,
        annualization_years,
    )
    .map(|inner| BacktestOutput { inner })
    .map_err(|error| JsError::new(&error))
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

    #[test]
    fn long_only_backtest_produces_finite_metrics_and_trade_indices() {
        let closes = [100.0, 110.0, 105.0, 120.0, 130.0, 125.0];
        let positions = [0, 1, 1, 0, 1, 1];
        let result = backtest_long_only_core(&closes, &positions, 1_000.0, 10.0, 1.0).unwrap();

        assert_eq!(result.equity.len(), closes.len());
        assert_eq!(result.drawdown.len(), closes.len());
        assert_eq!(result.trades.len(), 2);
        assert_eq!(result.trades[0].entry_index, 1);
        assert_eq!(result.trades[0].exit_index, 3);
        assert_eq!(result.trades[1].entry_index, 4);
        assert_eq!(result.trades[1].exit_index, 5);
        assert!(result.final_equity.is_finite());
        assert!(result.sharpe.is_finite());
        assert!(result.max_drawdown <= 0.0);
        assert!((0.0..=1.0).contains(&result.exposure));
    }

    #[test]
    fn long_only_backtest_rejects_invalid_batches() {
        assert!(backtest_long_only_core(&[100.0], &[], 1_000.0, 0.0, 1.0).is_err());
        assert!(backtest_long_only_core(&[100.0], &[2], 1_000.0, 0.0, 1.0).is_err());
        assert!(backtest_long_only_core(&[f64::NAN], &[0], 1_000.0, 0.0, 1.0).is_err());
    }
}
