//! The engine's prefill reports as proof of work, and how long the next one
//! may take.
//!
//! With `return_progress` the engine answers a long prompt with
//! `prompt_progress` frames — `{total, cache, processed, time_ms}`, one at the
//! start and one after each batch — before the first word. Those frames are
//! the engine working, not a keep-alive, so each one restarts the stall
//! clock. How long to wait for the next is what the engine itself measured:
//! a few times the last batch's duration (the difference of two `time_ms`).
//! Nothing here knows the batch size, and no cap is a second constant that
//! has to agree with it.

use std::time::Duration;

use serde_json::Value;

/// Before any batch has been timed there is nothing to derive a gap from, so
/// the first one gets this many times the ordinary stall patience.
const FIRST_GAP_FACTOR: u32 = 5;

/// A batch is expected to take about as long as the last one; this many times
/// that is where it has stopped instead of being slow.
const SAFETY: f64 = 3.0;

/// Follows one request's reports.
pub(super) struct Prefill {
    last_time_ms: Option<f64>,
}

impl Prefill {
    pub(super) fn new() -> Self {
        Self { last_time_ms: None }
    }

    /// The silence the engine may keep after this report, given the ordinary
    /// stall patience `idle`, which is also the floor. A prompt that is fully
    /// read is back to `idle`: the first word follows. A report that cannot be
    /// read changes nothing.
    pub(super) fn report(&mut self, progress: &Value, idle: Duration) -> Duration {
        let number = |name: &str| {
            progress
                .get(name)
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite())
        };
        let (Some(total), Some(processed), Some(time_ms)) =
            (number("total"), number("processed"), number("time_ms"))
        else {
            return idle;
        };
        let previous = self.last_time_ms.replace(time_ms);
        if processed >= total {
            return idle;
        }
        let first_gap = idle.saturating_mul(FIRST_GAP_FACTOR);
        let Some(gap_ms) = previous.map(|last| time_ms - last).filter(|gap| *gap > 0.0) else {
            return first_gap;
        };
        match Duration::try_from_secs_f64(gap_ms / 1000.0 * SAFETY) {
            Ok(allowed) => allowed.max(idle),
            Err(_) => first_gap,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const IDLE: Duration = Duration::from_secs(60);

    fn report(processed: u64, time_ms: u64) -> Value {
        json!({"total": 5000, "cache": 0, "processed": processed, "time_ms": time_ms})
    }

    #[test]
    fn the_first_gap_is_generous_and_later_ones_follow_the_engines_own_pace() {
        let mut prefill = Prefill::new();
        assert_eq!(prefill.report(&report(0, 0), IDLE), IDLE * 5, "nothing timed yet");
        // The first batch took 90 s: the next may take three times that.
        assert_eq!(prefill.report(&report(2048, 90_000), IDLE), Duration::from_secs(270));
        // A fast batch never goes below the ordinary patience.
        assert_eq!(prefill.report(&report(4096, 92_000), IDLE), IDLE);
    }

    #[test]
    fn a_fully_read_prompt_and_an_unreadable_report_ask_for_nothing_more() {
        let mut prefill = Prefill::new();
        assert_eq!(prefill.report(&report(5000, 90_000), IDLE), IDLE);
        assert_eq!(prefill.report(&json!({"total": "many"}), IDLE), IDLE);
        assert_eq!(prefill.report(&json!(null), IDLE), IDLE);
    }

    #[test]
    fn an_absurd_time_is_not_a_panic() {
        let mut prefill = Prefill::new();
        prefill.report(&json!({"total": 10, "processed": 1, "time_ms": 0}), IDLE);
        let answer = prefill.report(&json!({"total": 10, "processed": 2, "time_ms": 1e300}), IDLE);
        assert_eq!(answer, IDLE * 5);
    }
}
