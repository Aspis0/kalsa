//! Sustained memory bandwidth, measured the way inference uses it.
//!
//! Generating a token streams every active weight through the CPU once, so what
//! matters is the bandwidth a *streaming read of a block larger than any cache*
//! sustains — not the datasheet figure, which on a single-channel laptop is
//! fantasy, and not a cache-resident benchmark, which would report L2 speed.
//!
//! The read is sum-of-words: one load and one add per eight bytes, which is what
//! a weight read looks like. Threads split the buffer into contiguous bands, the
//! way an inference engine splits rows.

use std::time::Instant;

use crate::series::Series;
use crate::{
    ProbeConfig, MAX_PASSES_PER_SAMPLE, SAMPLE_TARGET_SECONDS, SLOW_MACHINE_BYTES_PER_SECOND,
};

pub fn measure_bandwidth(config: &ProbeConfig) -> Series {
    let words = (config.buffer_bytes / 8).max(1);
    // A buffer the compiler cannot fold away and whose pages are all resident:
    // a page fault during the first repetition would show up as a slow sample.
    let buffer: Vec<u64> = (0..words).map(|index| index as u64 | 1).collect();
    let threads = config.threads.max(1);
    let band = words.div_ceil(threads);
    let bytes = words as f64 * 8.0;

    // A sample must last long enough that one descheduled repetition is a
    // detail instead of the result: a 4 ms sample on a machine somebody is
    // using reports the scheduler, not the memory.
    let passes = (((SAMPLE_TARGET_SECONDS * SLOW_MACHINE_BYTES_PER_SECOND) / bytes).ceil() as u64)
        .clamp(1, MAX_PASSES_PER_SAMPLE);

    let mut samples = Vec::with_capacity(config.repetitions as usize);
    for _ in 0..config.repetitions {
        let started = Instant::now();
        let mut checksum = 0u64;
        for _ in 0..passes {
            checksum = checksum.wrapping_add(std::thread::scope(|scope| {
                let handles: Vec<_> = buffer
                    .chunks(band)
                    .map(|part| {
                        scope.spawn(move || {
                            let (mut a, mut b, mut c, mut d) = (0u64, 0u64, 0u64, 0u64);
                            let mut remaining = part;
                            while let [w0, w1, w2, w3, rest @ ..] = remaining {
                                a = a.wrapping_add(*w0);
                                b = b.wrapping_add(*w1);
                                c = c.wrapping_add(*w2);
                                d = d.wrapping_add(*w3);
                                remaining = rest;
                            }
                            remaining
                                .iter()
                                .fold(a ^ b ^ c ^ d, |sum, word| sum.wrapping_add(*word))
                        })
                    })
                    .collect();
                handles
                    .into_iter()
                    .map(|handle| handle.join().unwrap_or(0))
                    .fold(0u64, u64::wrapping_add)
            }));
        }
        let elapsed = started.elapsed().as_secs_f64();
        std::hint::black_box(checksum);
        if elapsed > 0.0 {
            samples.push(bytes * passes as f64 / elapsed);
        }
    }
    Series::new(samples)
}
