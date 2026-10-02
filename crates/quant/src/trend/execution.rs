use super::config::Execution;

/// Adverse rounding and slippage shared by entry, exit and protection.
impl Execution {
    pub fn fee(&self) -> f64 {
        self.fee_bps / 10_000.0
    }
    pub fn slip(&self) -> f64 {
        self.slippage_bps / 10_000.0
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
