//! One decode-throughput measurement from a real turn.
//!
//! Real turns, not a benchmark: the samples arrive whenever the user talks to
//! the model, at whatever pace the conversation sets, on whatever clock the
//! caller keeps. Nothing here reads a clock — `at` is carried in, which is
//! what keeps this crate testable on a busy machine.

/// A single observed decode throughput.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sample {
    /// Seconds on the caller's monotonic clock. Samples must arrive in
    /// non-decreasing order of `at`; one from before the previous is dropped
    /// whole, because it would lie to the idle clock and to the streaks at
    /// the same time.
    pub at: f64,
    /// Decode throughput in tokens per second, as the turn produced it.
    pub tokens_per_second: f64,
}

impl Sample {
    /// Whether this sample is evidence at all. A turn that was killed or
    /// interrupted reports zero or a broken number — that is a failed
    /// measurement, not a slower machine, and counting it would let a
    /// crashed turn masquerade as thermal decay.
    pub fn is_measured(&self) -> bool {
        self.tokens_per_second.is_finite() && self.tokens_per_second > 0.0
    }
}

#[cfg(test)]
mod tests {
    use super::Sample;

    #[test]
    fn a_broken_measurement_is_not_evidence() {
        assert!(!Sample {
            at: 0.0,
            tokens_per_second: 0.0
        }
        .is_measured());
        assert!(!Sample {
            at: 0.0,
            tokens_per_second: f64::NAN
        }
        .is_measured());
        assert!(!Sample {
            at: 0.0,
            tokens_per_second: -3.0
        }
        .is_measured());
        assert!(Sample {
            at: 0.0,
            tokens_per_second: 0.001
        }
        .is_measured());
    }
}
