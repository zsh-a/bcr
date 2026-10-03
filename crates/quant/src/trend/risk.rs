use super::config::Risk;
use super::model::{ExitIntent, ExitReason, MinuteClose, DAY, MINUTE};

/// Portfolio guard state survives midnight and partition/output boundaries.
#[derive(Default)]
pub struct RiskState {
    pub day: Option<u64>,
    pub day_equity: f64,
    pub daily_blocked: bool,
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
    pub fn at_cutoff(time: u64, policy: &Risk) -> bool {
        policy
            .flatten_minute
            .is_some_and(|m| (time % DAY) / MINUTE >= m as u64)
    }
    pub fn opening_exit(time: u64, position_id: usize, policy: &Risk) -> Option<ExitIntent> {
        Self::at_cutoff(time, policy).then_some(ExitIntent {
            position_id,
            triggered_at: time,
            execute_at: time,
            reason: ExitReason::DailyClose,
        })
    }
    pub fn observe(
        &mut self,
        close: MinuteClose,
        equity: f64,
        position_id: Option<usize>,
        policy: &Risk,
    ) -> Option<ExitIntent> {
        if policy.daily_loss_pct > 0.0 && equity <= self.day_equity * (1.0 - policy.daily_loss_pct)
        {
            self.daily_blocked = true;
            return position_id.map(|position_id| ExitIntent {
                position_id,
                triggered_at: close.time(),
                execute_at: close.time() + 1,
                reason: ExitReason::DailyLoss,
            });
        }
        None
    }
}
