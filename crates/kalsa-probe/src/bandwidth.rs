//! Sustained memory bandwidth, measured the way inference uses it.
//!
//! Generating a token streams every active weight through the CPU once, so what
//! matters is the rate a streaming read of a block larger than any cache
//! sustains. **This number describes the CPU path only.** On Apple Silicon the
//! SoC's memory bandwidth (an M1 Max is specified at 400 GB/s) is not reachable
//! from the CPU at all: measured here, every CPU configuration — one process or
//! four, 1 to 16 threads, scalar or 128-bit NEON loads — tops out near 110 GB/s,
//! while the GPU can use the rest. llama.cpp runs decode on the GPU through
//! Metal on macOS, so a CPU-only figure under-predicts a Mac; see
//! `ExecutionPath` for how the number says so, and `path.rs` for what a Metal
//! backend would have to add.
//!
//! **How much it under-predicts is not one number, measured rather than reasoned
//! (2026-09-18, M1 Max, llama.cpp b10950 through Metal, `llama-bench`, five dense
//! Q4_K_M models from 0.45 to 7.12 GiB): decode has no single bandwidth.** The
//! rate a model achieves climbs with its size and then wanders — 95.7, 145.4,
//! 157.7, 189.1 and 171.3 GiB/s at 0.45, 1.04, 1.95, 4.36 and 7.12 GiB — because
//! a cost per token that the weights do not explain (attention, the KV cache,
//! launching the kernels) is paid whatever they weigh. Fitting
//! `seconds_per_token = fixed + bytes / bandwidth` across the five gives
//! **183.5 GiB/s marginal and 1.504 ms fixed**; held out one point at a time,
//! that shape errs 13.3% on average where a single rate errs 25.7%.
//!
//! So this CPU figure is a floor under the marginal term, not a factor away from
//! the answer: 110 GB/s here against 197 GB/s marginal through Metal. An earlier
//! version of this comment said 3-4x, reasoning from the SoC's 400 GB/s
//! specification; the version after it said 1.6x, which was one model's implied
//! rate mistaken for a constant. Both stated one number where the machine has two.
//!
//! The same runs are why no synthetic probe lives here, and why a small model is
//! not a shortcut to the big one. `stories260K` at 1.12 MiB implies 0.87 GiB/s,
//! off by more than 200x; even a real 0.45 GiB model implies 95.7 where the 4.36
//! GiB one reaches 189.1, because at that size the fixed cost is 31.8% of every
//! token. Quantisation moves the rate independently of size: the same gemma
//! requantised to Q2_K (4.48 GiB) decodes at 26.4 tok/s where the fit says 38.6,
//! spending the difference on dequantisation rather than on memory.
//!
//! The kernel is deliberately simple: an M1 Max measures the same with 128-bit
//! NEON and with these 64-bit loads (112 vs 111 GB/s at the plateau), so the
//! effort belongs in the thread ramp, not in vectorising the loop.

use std::time::{Duration, Instant};

use crate::series::Series;

/// How long a timed sample should last. Shorter samples measure the scheduler on
/// a machine somebody is using, not the hardware.
pub const SAMPLE_TARGET: Duration = Duration::from_millis(60);

/// One stream per thread, two words per load — `ldp` on aarch64, and enough
/// independent loads in flight that the core is not the limit.
pub fn read_stream(buf: &[u64]) -> u64 {
    let (mut a, mut b) = (0u64, 0u64);
    let mut chunks = buf.chunks_exact(2);
    for pair in &mut chunks {
        a = a.wrapping_add(pair[0]);
        b = b.wrapping_add(pair[1]);
    }
    chunks
        .remainder()
        .iter()
        .fold(a ^ b, |sum, word| sum.wrapping_add(*word))
}

/// Thread counts to try: powers of two up to the machine's parallelism, plus the
/// count itself. A ramp, not a guess.
pub fn thread_ramp(parallelism: usize) -> Vec<usize> {
    let mut counts: Vec<usize> = Vec::new();
    let mut count = 1;
    while count < parallelism {
        counts.push(count);
        count *= 2;
    }
    counts.push(parallelism.max(1));
    counts.dedup();
    counts
}

/// Reads `bytes` with `threads` threads, `repetitions` times, and answers with
/// the rates. Each sample keeps passing over the buffer until it is long enough
/// to mean something: a 4 ms sample on a machine somebody is using reports the
/// scheduler.
pub fn measure_at_threads(bytes: usize, threads: usize, repetitions: u32) -> Series {
    let words = (bytes / 8).max(2);
    let buffer: Vec<u64> = (0..words).map(|index| index as u64 | 1).collect();
    let band = words.div_ceil(threads.max(1));

    let mut samples = Vec::with_capacity(repetitions as usize);
    for _ in 0..repetitions {
        let started = Instant::now();
        // The pass loop lives inside the threads: passing over a small buffer by
        // re-spawning threads each time measures the spawner, not the cache.
        let read_bytes: u64 = std::thread::scope(|scope| {
            let handles: Vec<_> = buffer
                .chunks(band)
                .map(|part| {
                    scope.spawn(move || {
                        let deadline = Instant::now() + SAMPLE_TARGET;
                        let mut passes = 0u64;
                        let mut checksum = 0u64;
                        loop {
                            checksum = checksum.wrapping_add(read_stream(part));
                            passes += 1;
                            if Instant::now() >= deadline {
                                break;
                            }
                        }
                        std::hint::black_box(checksum);
                        part.len() as u64 * 8 * passes
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|handle| handle.join().unwrap_or(0))
                .fold(0u64, u64::wrapping_add)
        });
        let elapsed = started.elapsed().as_secs_f64();
        if elapsed > 0.0 {
            samples.push(read_bytes as f64 / elapsed);
        }
    }
    Series::new(samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ramp_covers_powers_of_two_and_the_machine() {
        assert_eq!(thread_ramp(10), vec![1, 2, 4, 8, 10]);
        assert_eq!(thread_ramp(8), vec![1, 2, 4, 8]);
        assert_eq!(thread_ramp(1), vec![1]);
        assert_eq!(thread_ramp(3), vec![1, 2, 3]);
    }

    #[test]
    fn a_short_run_still_produces_positive_samples() {
        let series = measure_at_threads(1 << 20, 2, 2);
        assert_eq!(series.samples().len(), 2);
        assert!(series.min() > 0.0);
    }
}
