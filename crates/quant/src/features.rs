//! Market-only features can be shared by independent parameter portfolios.
use crate::model::{Bar, Breadth, Manifest};
use std::collections::{BTreeMap, VecDeque};

pub(crate) struct PreparedDay {
    pub date: u32,
    pub breadth: Vec<Breadth>,
    pub candidates: Vec<usize>,
}
pub(crate) fn breadth<'a>(
    manifest: &Manifest,
    bars: impl Iterator<Item = &'a Bar>,
    histories: &[VecDeque<f64>],
) -> Vec<Breadth> {
    let mut counts: BTreeMap<usize, (usize, usize)> = BTreeMap::new();
    for b in bars.filter(|b| b.breadth_member && manifest.industries[b.industry] != "unknown") {
        let h = &histories[b.id];
        if h.len() != 20 {
            continue;
        }
        let c = counts.entry(b.industry).or_default();
        c.1 += 1;
        if b.close * b.adjfactor > h.iter().sum::<f64>() / 20.0 {
            c.0 += 1;
        }
    }
    let mut result: Vec<Breadth> = counts
        .into_iter()
        .map(|(id, (above, total))| Breadth {
            industry: manifest.industries[id].clone(),
            above,
            total,
            ratio: (above as f64 / total as f64 * 100.0).round_ties_even(),
        })
        .collect();
    result.sort_by(|a, b| {
        b.ratio
            .total_cmp(&a.ratio)
            .then(a.industry.cmp(&b.industry))
    });
    result
}
pub(crate) fn candidates<'a>(
    manifest: &Manifest,
    bars: impl Iterator<Item = &'a Bar>,
) -> Vec<usize> {
    let mut selected: Vec<&Bar> = bars
        .filter(|b| b.selection_member && !b.is_st && b.profit > 0.0 && b.shares > 0.0)
        .collect();
    selected.sort_by(|a, b| {
        (a.close * a.shares)
            .total_cmp(&(b.close * b.shares))
            .then_with(|| {
                manifest.instruments[a.id]
                    .code
                    .cmp(&manifest.instruments[b.id].code)
            })
    });
    selected.into_iter().map(|b| b.id).collect()
}
pub(crate) struct FactorState {
    manifest: Manifest,
    histories: Vec<VecDeque<f64>>,
    next: usize,
}
impl FactorState {
    pub fn new(manifest: Manifest) -> Self {
        let count = manifest.instruments.len();
        Self {
            manifest,
            histories: vec![VecDeque::with_capacity(20); count],
            next: 0,
        }
    }
    pub fn advance(&mut self, bars: &[Bar]) -> Result<PreparedDay, String> {
        self.advance_mode(bars, false)
    }
    pub fn advance_daily(&mut self, bars: &[Bar]) -> Result<PreparedDay, String> {
        self.advance_mode(bars, true)
    }
    pub fn processed_days(&self) -> usize {
        self.next
    }
    fn advance_mode(&mut self, bars: &[Bar], daily: bool) -> Result<PreparedDay, String> {
        let session = self
            .manifest
            .calendar
            .get(self.next)
            .ok_or("too many factor sessions")?;
        let mut previous_id = None;
        for b in bars {
            if b.date != session.date || b.industry >= self.manifest.industries.len() {
                return Err("factor calendar/industry mismatch".into());
            }
            if previous_id.is_some_and(|id| id >= b.id)
                || !b.close.is_finite()
                || b.close <= 0.0
                || b.close > 1e12
                || !b.adjfactor.is_finite()
                || b.adjfactor <= 0.0
                || b.adjfactor > 1e12
                || b.close * b.adjfactor > 1e15
            {
                return Err("invalid factor price, adjustment or instrument order".into());
            }
            previous_id = Some(b.id);
            let h = self
                .histories
                .get_mut(b.id)
                .ok_or("invalid factor instrument")?;
            if h.len() == 20 {
                h.pop_front();
            }
            h.push_back(b.close * b.adjfactor);
        }
        self.next += 1;
        Ok(PreparedDay {
            date: session.date,
            breadth: if daily || session.rebalance {
                breadth(&self.manifest, bars.iter(), &self.histories)
            } else {
                vec![]
            },
            candidates: if !daily && session.rebalance {
                candidates(&self.manifest, bars.iter())
            } else {
                vec![]
            },
        })
    }
}
