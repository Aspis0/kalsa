//! Measure this machine once, predict any model before downloading it.
//!
//! The problem this exists for: to know whether a model will be fast enough we
//! would have to download gigabytes and try it, and if the answer is no we made
//! the user wait to be told no. A token costs a fixed price whatever the
//! weights weigh, plus the time to stream the bytes it reads, and the
//! streaming half is a property of the *machine*, so it can be measured once —
//! a few seconds — and every catalog entry can be predicted from it. The
//! machine has two properties, then, and only one is measured today: the fixed
//! price travels as a prior from the one machine measured so far.
//!
//! What this is not: exact. See `predict` for the assumptions and the two ends
//! of the decode band, `Series` for why every number comes with its spread,
//! and `confidence` for why a number measured on a busy machine is not offered
//! as the machine's.

mod bandwidth;
mod compute;
mod confidence;
mod detect;
mod path;
mod plateau;
mod predict;
mod series;
mod soc;

pub use bandwidth::{measure_at_threads, thread_ramp, SAMPLE_TARGET};
pub use compute::measure_compute;
pub use detect::backend;
pub use confidence::{Reliability, SPREAD_LIMIT};
pub use path::{Backend, ExecutionPath};
pub use plateau::{plateau, still_rising, PLATEAU_TOLERANCE};
pub use predict::{
    decode_band, decode_tokens_per_second, prefill_tokens_per_second, DecodeCost,
    FIXED_SECONDS_PRIOR, SUSTAINED_BANDWIDTH_SHARE,
};
pub use series::Series;
pub use soc::{published_bandwidth, DECODE_SHARE_OF_PUBLISHED};

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Buffer for the memory measurement: larger than any cache this class of
/// machine has, so the number is memory and not L2.
pub const DRAM_BUFFER_BYTES: usize = 256 * 1024 * 1024;
/// Repetitions per ramp step: enough to see disagreement, short enough that the
/// whole ramp stays inside the "few seconds" the product promises.
pub const RAMP_REPETITIONS: u32 = 3;
/// Buffer for the cache reference: small enough to be served from L2, and large
/// enough that it is not one core's own loop overhead.
pub const CACHE_BUFFER_BYTES: usize = 4 * 1024 * 1024;
/// How many times a round of measurement may be repeated before we hand over a
/// number we do not trust. A busy machine is tried again, not believed.
pub const MAX_ATTEMPTS: u32 = 3;
/// How long to wait between attempts, to give whatever else was running a chance
/// to finish.
pub const RETRY_PAUSE: Duration = Duration::from_secs(3);
/// The optimisation level this crate was compiled at, carried in by the build
/// script. Nothing else can see it at run time, and it changes the reading by a
/// factor of nineteen, so it travels with the evidence.
pub const OPT_LEVEL: &str = env!("KALSA_PROBE_OPT_LEVEL");

#[derive(Clone, Debug)]
pub struct ProbeConfig {
    /// Repetitions per measurement: one sample cannot show a spread.
    pub repetitions: u32,
    /// The most threads the ramp will try. Defaults to every logical core; the
    /// ramp stops earlier, at the plateau, so asking for all of them costs
    /// nothing and cannot be accused of leaving bandwidth unclaimed.
    pub threads: usize,
    /// Side of the square f32 matmul used for the compute probe.
    pub matmul_size: usize,
}

impl Default for ProbeConfig {
    fn default() -> Self {
        Self {
            repetitions: 5,
            threads: std::thread::available_parallelism()
                .map(|cores| cores.get())
                .unwrap_or(4)
                .max(2),
            matmul_size: 384,
        }
    }
}

/// Everything the probe learned, and whether it believes it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Measurement {
    /// Throughput at each thread count tried, in order. Printed, not just used:
    /// the shape of the ramp is how a reader checks the plateau for themselves.
    pub ramp: Vec<(usize, f64)>,
    /// The machine's rate — **the best sample of the ramp**, not the median.
    ///
    /// This is a capability measurement: what this machine can do when it has
    /// itself to itself. A competing process can only make a sample slower, never
    /// faster, so the fastest repetition is the closest we get to the machine,
    /// while the median would answer "how was your afternoon" instead.
    pub ceiling_bytes_per_second: f64,
    /// The repetitions behind that number, so the spread travels with it.
    pub ceiling: Series,
    /// The first thread count that already reached the plateau: what this machine
    /// needs, as opposed to what it was measured with.
    pub plateau_threads: usize,
    /// Cache-resident reads, used as the reference the memory figure must not beat.
    pub cache: Series,
    /// f32 matmul throughput: the number prefill is predicted from.
    pub compute: Series,
    pub reliability: Reliability,
    /// The path the numbers above were measured on (CPU streaming reads today).
    pub measured_on: ExecutionPath,
    /// What this machine will run the model on, by detection only.
    pub will_run_on: Backend,
    /// What decode should reach on the path the model will actually take, when
    /// the chip is one [`soc`] knows. `None` on a machine whose GPU bandwidth
    /// cannot be named — there the CPU figure is all there is, and it says so.
    pub decode_bytes_per_second: Option<f64>,
}

impl Measurement {
    /// True when the machine's real path is faster than the one measured, so the
    /// predictions from these numbers are a floor rather than a figure.
    ///
    /// Data, deliberately: the catalog branches on this instead of parsing the
    /// sentence next to it.
    pub fn bandwidth_is_lower_bound(&self) -> bool {
        self.will_run_on.is_faster_than_cpu_measurement() && self.decode_bytes_per_second.is_none()
    }

    /// The rate decode should be predicted from: the chip's own, where the chip
    /// is known, and the CPU streaming figure otherwise. One accessor, so no
    /// caller can predict from the slow path while another predicts from the
    /// real one.
    pub fn decode_bandwidth_bytes_per_second(&self) -> f64 {
        self.decode_bytes_per_second
            .unwrap_or(self.ceiling_bytes_per_second)
    }

    /// True, always: the compute probe is a portable f32 loop, while prefill in
    /// llama.cpp is blocked, quantised, and on Apple Silicon runs on AMX. The
    /// yardstick on this machine — Accelerate's sgemm at 384×384 — is about nine
    /// times this figure. A caller that multiplies it by an efficiency band is
    /// compounding a floor, not correcting a reading, which is why this is a fact
    /// the code states rather than a comment it hopes will be read.
    pub fn compute_is_lower_bound(&self) -> bool {
        true
    }
}

impl Measurement {
    /// True when this reading may be used as the machine's number.
    pub fn is_reliable(&self) -> bool {
        self.reliability.reliable
    }
}

/// One round: measure, then judge. No retrying, no sleeping — callers that want
/// a trustworthy number use `measure_reliable`.
pub fn measure(config: &ProbeConfig) -> Measurement {
    let cpu_before = confidence::cpu_seconds();
    let started = Instant::now();

    let counts = thread_ramp(config.threads);
    let mut ramp = Vec::with_capacity(counts.len());
    let mut readings: Vec<(usize, Series)> = Vec::with_capacity(counts.len());
    for threads in counts {
        let series = measure_at_threads(DRAM_BUFFER_BYTES, threads, RAMP_REPETITIONS);
        // A capability measurement: the best sample, never the median.
        ramp.push((threads, series.max()));
        readings.push((threads, series));
    }
    let (plateau_threads, _) = plateau(&ramp).unwrap_or((config.threads, 0.0));
    // The ceiling is the best sample anywhere in the ramp, not only at the
    // plateau: this is a capability measurement, and competition can only make a
    // sample slower. The plateau thread count is reported separately as the
    // answer to "how many threads does this machine need".
    let ceiling_entry = readings
        .iter()
        .max_by(|a, b| {
            a.1.max()
                .partial_cmp(&b.1.max())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(threads, series)| (*threads, series.clone()));
    let ceiling = ceiling_entry
        .clone()
        .map(|(_, series)| series)
        .unwrap_or_else(|| Series::new(vec![]));
    let ceiling_rate = ceiling.max();
    let cache = measure_at_threads(CACHE_BUFFER_BYTES, config.threads, 1);

    // Parallelism at the plateau, not averaged over the ramp: the early
    // single-thread steps would drag any average down and say nothing about the
    // configuration the number comes from.
    let cpu_before_probe = confidence::cpu_seconds();
    let probe_started = Instant::now();
    let probe = measure_at_threads(DRAM_BUFFER_BYTES, plateau_threads, 1);
    let probe_wall = probe_started.elapsed().as_secs_f64();
    let cpu_after_probe = confidence::cpu_seconds();
    let effective_parallelism = match (cpu_before_probe, cpu_after_probe) {
        (Some(before), Some(after)) => Some((after - before) / probe_wall.max(1e-9)),
        _ => None,
    };
    std::hint::black_box(probe.max());

    let compute_started = Instant::now();
    let compute = measure_compute(config);
    std::hint::black_box(compute_started.elapsed());
    std::hint::black_box(started.elapsed());
    std::hint::black_box(cpu_before);

    let reliability = confidence::judge(&confidence::Evidence {
        plateau_threads,
        tried_threads: plateau_threads,
        effective_parallelism,
        spread: ceiling.relative_spread(),
        best_rate: ceiling_rate,
        still_rising: still_rising(&ramp),
        cache_rate: Some(cache.max()).filter(|rate| *rate > 0.0),
        optimised: OPT_LEVEL != "0",
    });

    Measurement {
        ramp,
        ceiling_bytes_per_second: ceiling_rate,
        ceiling,
        plateau_threads,
        cache,
        compute,
        reliability,
        measured_on: ExecutionPath::Cpu,
        will_run_on: detect::backend(),
        // Only where the model will decode on the GPU: on a CPU-only machine
        // the streaming figure already describes the path that will run, and
        // replacing it with a chip's published number would swap a
        // measurement for a datasheet.
        decode_bytes_per_second: detect::backend()
            .is_faster_than_cpu_measurement()
            .then(soc::decode_bandwidth)
            .flatten(),
    }
}

/// Measures until the number is trustworthy, or gives up and says which checks
/// failed. A busy machine is retried, never believed: a low reading taken while
/// the user was watching a video would have us refuse a perfectly good computer.
pub fn measure_reliable(config: &ProbeConfig) -> Measurement {
    let mut last = measure(config);
    let mut attempt = 1;
    while !last.is_reliable() && attempt < MAX_ATTEMPTS {
        std::thread::sleep(RETRY_PAUSE);
        last = measure(config);
        attempt += 1;
    }
    last
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny() -> ProbeConfig {
        ProbeConfig {
            repetitions: 2,
            threads: 2,
            matmul_size: 64,
        }
    }

    #[test]
    fn a_measurement_carries_a_ramp_a_ceiling_and_a_verdict() {
        let measurement = measure(&tiny());
        assert_eq!(measurement.ramp.len(), 2, "threads 1 and 2");
        assert!(measurement.ramp.iter().all(|(_, rate)| *rate > 0.0));
        assert!(measurement.ceiling_bytes_per_second >= measurement.ramp[0].1 * 0.5);
        assert!(measurement.compute.min() > 0.0);
        assert!(measurement.cache.max() > 0.0);
        assert_eq!(measurement.measured_on, ExecutionPath::Cpu);
        assert!(!measurement.measured_on.note().is_empty());
        // Detection ran and is reachable as data, not only as prose. A GPU
        // machine is a floor only while its chip is unknown: once `soc` names
        // the chip, the prediction is on the path that will run and the floor
        // is no longer the honest word for it.
        let gpu = measurement.will_run_on.is_faster_than_cpu_measurement();
        assert_eq!(
            measurement.bandwidth_is_lower_bound(),
            gpu && measurement.decode_bytes_per_second.is_none()
        );
        assert_eq!(
            measurement.decode_bandwidth_bytes_per_second(),
            measurement
                .decode_bytes_per_second
                .unwrap_or(measurement.ceiling_bytes_per_second)
        );
        assert!(
            measurement.decode_bytes_per_second.is_none() || gpu,
            "a chip figure on a machine that decodes on the CPU would swap a \
             measurement for a datasheet"
        );
        // The compute figure is a floor on every machine, by construction.
        assert!(measurement.compute_is_lower_bound());
        // The verdict is a judgement, not a promise: either it is reliable or it
        // says what was wrong.
        assert!(measurement.is_reliable() || !measurement.reliability.notes.is_empty());
    }

    #[test]
    fn retrying_never_returns_more_than_it_promises() {
        let config = tiny();
        let measurement = measure_reliable(&config);
        // The plateau is a reading of this machine, not a constant: on a busy
        // one a single thread lands within tolerance of two and the plateau
        // is 1. What retrying may never do is report a ramp it did not walk.
        // Asserting the exact count pinned the hardware instead of the code
        // and failed two runs in four with nothing wrong.
        assert!(
            (1..=config.threads).contains(&measurement.reliability.threads),
            "plateau {} threads, outside the ramp of {}",
            measurement.reliability.threads,
            config.threads
        );
        assert!(measurement.is_reliable() || !measurement.reliability.notes.is_empty());
    }
}
