use super::model::*;

#[derive(Clone)]
pub struct Position {
    pub id: usize,
    pub side: Side,
    pub time: u64,
    pub entry: f64,
    pub entry_signal: EntrySignal,
    pub quantity: f64,
    pub initial_stop: f64,
    pub stop: f64,
    /// Frozen at entry, independent of later protection improvements.
    pub initial_distance: f64,
    pub signal_atr: f64,
    pub entry_fee: f64,
    pub entry_slippage_and_rounding: f64,
    pub funding: f64,
    pub mfe: f64,
    pub mae: f64,
    pub stop_reason: &'static str,
}
impl Position {
    /// Observe only minutes in which the position survived its active stop.
    pub fn observe_minute(&mut self, close: MinuteClose) {
        let bar = close.0;
        let favourable = if self.side == Side::Long {
            bar.high - self.entry
        } else {
            self.entry - bar.low
        };
        let adverse = if self.side == Side::Long {
            self.entry - bar.low
        } else {
            bar.high - self.entry
        };
        self.mfe = self.mfe.max(favourable);
        self.mae = self.mae.max(adverse);
    }
    pub fn observe_stop(&mut self, raw: f64) {
        self.mae = self.mae.max(self.side.sign() * (self.entry - raw));
    }
}
