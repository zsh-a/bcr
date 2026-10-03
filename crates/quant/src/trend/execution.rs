use super::config::Execution;

/// Adverse rounding and slippage shared by entry, exit and protection.
impl Execution {
    pub fn fee(&self) -> f64 {
        self.fee_bps / 10_000.0
    }
    pub fn slip(&self) -> f64 {
        self.slippage_bps / 10_000.0
    }
    /// Allow only floating-point representation error at an exact one-tick break.
    pub fn breaks_by_tick(&self, price: f64, boundary: f64, direction: f64) -> bool {
        let delta = direction * (price - boundary);
        let tolerance = (8.0 * f64::EPSILON * price.abs().max(boundary.abs()).max(self.tick_size))
            .min(self.tick_size * 1e-6);
        delta + tolerance >= self.tick_size
    }
    pub fn round_trip_cost_atr(&self, price: f64, atr: f64) -> Option<f64> {
        (atr > 0.0).then(|| (2.0 * price * (self.fee() + self.slip()) + 2.0 * self.tick_size) / atr)
    }
    /// Preserve exact decimal steps without promoting a genuine budget shortfall.
    pub fn floor_quantity(&self, limit: f64) -> f64 {
        let steps = limit / self.quantity_step;
        let tolerance = (8.0 * f64::EPSILON * steps.abs()).min(1e-6);
        (steps + tolerance).floor() * self.quantity_step
    }
    pub fn floor(&self, price: f64) -> f64 {
        (price / self.tick_size + 1e-9).floor() * self.tick_size
    }
    pub fn ceil(&self, price: f64) -> f64 {
        (price / self.tick_size - 1e-9).ceil() * self.tick_size
    }
    pub fn fill(&self, raw: f64, buy: bool) -> Result<f64, String> {
        let price = if buy {
            self.ceil(raw * (1.0 + self.slip()))
        } else {
            self.floor(raw * (1.0 - self.slip()))
        };
        if !price.is_finite() || price <= 0.0 {
            return Err("tick size produces an invalid fill price".into());
        }
        Ok(price)
    }
}
