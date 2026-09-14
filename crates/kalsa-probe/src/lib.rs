//! Measure this machine once, predict any model before downloading it.
//!
//! The problem this exists for: to know whether a model will be fast enough we
//! would have to download gigabytes and try it, and if the answer is no we made
//! the user wait to be told no. Decode is bandwidth-bound, and bandwidth is a
//! property of the *machine*, so it can be measured once — a few seconds — and
//! every catalog entry can be predicted from it.
//!
//! What this is not: exact. See `predict` for the assumptions and the efficiency
//! band, and `Series` for why every number comes with its spread.

mod bandwidth;
mod compute;
mod predict;
mod series;

pub use bandwidth::measure_bandwidth;
pub use compute::measure_compute;
pub use predict::{decode_tokens_per_second, prefill_tokens_per_second, EFFICIENCY_BAND};
pub use series::Series;

/// How long one timed sample should last. Shorter samples measure the
/// scheduler on a machine somebody is using, not the hardware.
pub const SAMPLE_TARGET_SECONDS: f64 = 0.15;
/// A deliberately pessimistic bandwidth floor, used only to size a sample:
/// below this the machine is not a candidate for running a model at all.
pub const SLOW_MACHINE_BYTES_PER_SECOND: f64 = 20.0e9;
/// Same idea for the compute probe: an old laptop's f32 matmul floor.
pub const FLOOR_FLOPS_PER_SECOND: f64 = 20.0e9;
/// Ceiling on the repetitions inside one sample: a small buffer would otherwise
/// turn a sample into thousands of thread spawns, measuring the spawner.
pub const MAX_PASSES_PER_SAMPLE: u64 = 16;

/// What to measure, and how hard. Defaults are chosen to be short enough to run
/// during a first start and long enough to be a baseline.
#[derive(Clone, Debug)]
pub struct ProbeConfig {
    /// Bigger than any cache this machine has, or the number is L2 speed.
    pub buffer_bytes: usize,
    /// Repetitions per measurement: one sample cannot show a spread.
    pub repetitions: u32,
    /// The threads we would really run inference with, not the core count.
    pub threads: usize,
    /// Side of the square f32 matmul used for the compute probe.
    pub matmul_size: usize,
}

impl Default for ProbeConfig {
    fn default() -> Self {
        Self {
            buffer_bytes: 256 * 1024 * 1024,
            repetitions: 5,
            threads: std::thread::available_parallelism()
                .map(|cores| cores.get() / 2)
                .unwrap_or(4)
                .clamp(2, 8),
            matmul_size: 384,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny() -> ProbeConfig {
        ProbeConfig {
            buffer_bytes: 1 << 20,
            repetitions: 2,
            threads: 2,
            matmul_size: 64,
        }
    }

    /// The probes must return a usable series for any sane config. The numbers
    /// themselves are the machine's business; the structure is ours.
    #[test]
    fn bandwidth_returns_one_positive_sample_per_repetition() {
        let series = measure_bandwidth(&tiny());
        assert_eq!(series.samples().len(), 2);
        assert!(series.min() > 0.0, "bandwidth must be positive");
        assert!(series.mean() <= series.max());
        assert!(series.relative_spread().is_finite());
    }

    #[test]
    fn compute_returns_one_positive_sample_per_repetition() {
        let series = measure_compute(&tiny());
        assert_eq!(series.samples().len(), 2);
        assert!(series.min() > 0.0, "compute must be positive");
        assert!(series.mean() <= series.max());
    }

    #[test]
    fn a_single_thread_is_enough_to_measure_something() {
        let mut config = tiny();
        config.threads = 1;
        assert!(measure_bandwidth(&config).mean() > 0.0);
        assert!(measure_compute(&config).mean() > 0.0);
    }
}
