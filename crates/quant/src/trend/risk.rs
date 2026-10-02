use super::config::Risk;
use super::model::{DAY, MINUTE};

/// Portfolio guard state survives midnight and partition/output boundaries.
#[derive(Default)]
pub struct RiskState {
    pub day: Option<u64>,
    pub day_equity: f64,
    pub daily_blocked: bool,
    pub daily_exit: bool,
    pub cooldown_until: u64,
    pub cooldown_streak: usize,
}
impl RiskState {
    pub fn begin_day(&mut self, time: u64, equity: f64) -> bool {
        if self.day != Some(time / DAY) {
            self.day = Some(time / DAY);
            self.day_equity = equity;
            self.daily_blocked = false;
            return true;
        }
        false
    }
    pub fn record_trade(&mut self, net: f64, time: u64, policy: &Risk) -> Option<u64> {
        self.cooldown_streak = if net < 0.0 {
            self.cooldown_streak + 1
        } else {
            0
        };
        if policy.cooldown_losses > 0 && self.cooldown_streak >= policy.cooldown_losses {
            self.cooldown_until = time + policy.cooldown_minutes * MINUTE;
            self.cooldown_streak = 0;
            Some(self.cooldown_until)
        } else {
            None
        }
    }
    pub fn observe(&mut self, equity: f64, has_position: bool, policy: &Risk) {
        if policy.daily_loss_pct > 0.0 && equity <= self.day_equity * (1.0 - policy.daily_loss_pct)
        {
            self.daily_blocked = true;
            self.daily_exit = has_position;
        }
    }
}
