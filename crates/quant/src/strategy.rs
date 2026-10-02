//! Signal generation and portfolio construction share no execution/account state.
use crate::model::{Bar, Breadth, Config, Manifest};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, VecDeque};

pub(crate) fn exit_signals(
    spec: &StrategySpec,
    previous_limits: &BTreeSet<usize>,
    current_limits: &BTreeSet<usize>,
) -> Vec<usize> {
    if spec.id == "jsg" {
        previous_limits
            .difference(current_limits)
            .copied()
            .collect()
    } else {
        vec![]
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StrategySpec {
    pub id: String,
    pub lookback: usize,
    pub rebalance: String,
    pub allocation: String,
    pub investment: f64,
}
impl Default for StrategySpec {
    fn default() -> Self {
        Self {
            id: "jsg".into(),
            lookback: 20,
            rebalance: "weekly".into(),
            allocation: "equal".into(),
            investment: 0.95,
        }
    }
}
impl StrategySpec {
    pub fn validate(&self) -> Result<(), String> {
        if !["jsg", "momentum"].contains(&self.id.as_str())
            || !(5..=250).contains(&self.lookback)
            || !["weekly", "monthly", "daily"].contains(&self.rebalance.as_str())
            || !["equal", "inverse-volatility"].contains(&self.allocation.as_str())
            || !self.investment.is_finite()
            || self.investment <= 0.0
            || self.investment > 1.0
        {
            return Err("invalid strategy specification".into());
        }
        Ok(())
    }
    pub fn history_len(&self) -> usize {
        self.lookback
            + usize::from(self.id == "momentum" || self.allocation == "inverse-volatility")
    }
    // Portfolios with the same signal/allocation reuse market-only features.
    pub fn feature_key(&self) -> String {
        format!("{}:{}:{}", self.id, self.lookback, self.allocation)
    }
    pub fn rebalance_at(&self, manifest: &Manifest, index: usize) -> bool {
        let day = &manifest.calendar[index];
        match self.rebalance.as_str() {
            "daily" => true,
            "monthly" => day.month_end.unwrap_or_else(|| {
                manifest
                    .calendar
                    .get(index + 1)
                    .is_some_and(|next| next.date / 100 != day.date / 100)
            }),
            _ => day.rebalance,
        }
    }
}
#[derive(Clone, Default)]
pub(crate) struct Signal {
    pub breadth: Vec<Breadth>,
    pub ranked: Vec<usize>,
    pub scores: Vec<Option<f64>>,
    pub volatilities: Vec<Option<f64>>,
}
trait SignalGenerator {
    fn generate(
        manifest: &Manifest,
        bars: &[Bar],
        histories: &[VecDeque<f64>],
        spec: &StrategySpec,
    ) -> Signal;
}
struct Jsg;
struct Momentum;
impl SignalGenerator for Jsg {
    fn generate(
        manifest: &Manifest,
        bars: &[Bar],
        histories: &[VecDeque<f64>],
        spec: &StrategySpec,
    ) -> Signal {
        Signal {
            breadth: crate::features::breadth_period(
                manifest,
                bars.iter(),
                histories,
                spec.lookback,
            ),
            ranked: crate::features::candidates(manifest, bars.iter()),
            ..Signal::default()
        }
    }
}
impl SignalGenerator for Momentum {
    fn generate(
        manifest: &Manifest,
        bars: &[Bar],
        histories: &[VecDeque<f64>],
        spec: &StrategySpec,
    ) -> Signal {
        let mut scores = vec![None; manifest.instruments.len()];
        for bar in bars.iter().filter(|b| b.selection_member && !b.is_st) {
            let history = &histories[bar.id];
            if history.len() > spec.lookback {
                let first = history[history.len() - spec.lookback - 1];
                scores[bar.id] = Some(history.back().unwrap() / first - 1.0);
            }
        }
        let mut ranked: Vec<_> = bars
            .iter()
            .filter(|b| scores[b.id].is_some_and(|s| s > 0.0))
            .map(|b| b.id)
            .collect();
        ranked.sort_by(|a, b| {
            scores[*b]
                .unwrap()
                .total_cmp(&scores[*a].unwrap())
                .then_with(|| {
                    manifest.instruments[*a]
                        .code
                        .cmp(&manifest.instruments[*b].code)
                })
        });
        Signal {
            ranked,
            scores,
            ..Signal::default()
        }
    }
}
pub(crate) fn generate(
    manifest: &Manifest,
    bars: &[Bar],
    histories: &[VecDeque<f64>],
    spec: &StrategySpec,
) -> Signal {
    let mut signal = if spec.id == "momentum" {
        Momentum::generate(manifest, bars, histories, spec)
    } else {
        Jsg::generate(manifest, bars, histories, spec)
    };
    if spec.allocation == "inverse-volatility" {
        signal.volatilities = histories
            .iter()
            .map(|h| {
                if h.len() <= spec.lookback {
                    return None;
                }
                let prices: Vec<_> = h
                    .iter()
                    .skip(h.len() - spec.lookback - 1)
                    .copied()
                    .collect();
                let returns: Vec<_> = prices.windows(2).map(|w| w[1] / w[0] - 1.0).collect();
                let mean = returns.iter().sum::<f64>() / returns.len() as f64;
                Some(
                    (returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>()
                        / (returns.len() - 1) as f64)
                        .sqrt(),
                )
            })
            .collect();
    }
    signal
}
/// Returns normalized target weights; execution applies lots, fees, liquidity and risk constraints.
pub(crate) fn portfolio(config: &Config, signal: &Signal) -> Vec<(usize, f64)> {
    let spec = config.strategy_spec();
    if spec.id == "jsg"
        && signal
            .breadth
            .first()
            .is_none_or(|b| config.industry_blacklist.contains(&b.industry))
    {
        return vec![];
    }
    let selected: Vec<_> = signal
        .ranked
        .iter()
        .take(config.pool_size.min(config.stock_count))
        .copied()
        .collect();
    let weights: Vec<_> = selected
        .iter()
        .map(|id| {
            if spec.allocation == "inverse-volatility" {
                signal
                    .volatilities
                    .get(*id)
                    .copied()
                    .flatten()
                    .filter(|v| v.is_finite())
                    .map_or(0.0, |v| 1.0 / v.max(1e-6))
            } else {
                1.0
            }
        })
        .collect();
    let total: f64 = weights.iter().sum();
    if total <= 0.0 {
        return vec![];
    }
    selected
        .into_iter()
        .zip(weights)
        .filter(|(_, w)| *w > 0.0)
        .map(|(id, w)| (id, spec.investment * w / total))
        .collect()
}
