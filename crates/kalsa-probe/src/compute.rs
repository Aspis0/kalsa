//! Compute, measured separately because **prefill is compute-bound**.
//!
//! Prefill is a matrix multiply: every weight is used once per prompt token, so
//! the cost is FLOPs, not bytes streamed. Predicting it from the bandwidth
//! number would be wrong, and wrong in silence — which is why this exists.
//!
//! The probe is a dense f32 matmul parallelised by rows, the way an inference
//! engine splits work. It is a stand-in for a quantised kernel: an upper bound
//! on real prefill throughput, for the same reason the bandwidth probe is an
//! upper bound on decode.

use std::time::Instant;

use crate::series::Series;
use crate::{ProbeConfig, FLOOR_FLOPS_PER_SECOND, MAX_PASSES_PER_SAMPLE, SAMPLE_TARGET_SECONDS};

pub fn measure_compute(config: &ProbeConfig) -> Series {
    let size = config.matmul_size.max(16);
    let threads = config.threads.max(1);
    let a = vec![1.0f32; size * size];
    let b = vec![0.5f32; size * size];
    let mut c = vec![0.0f32; size * size];
    let flops_per_run = 2.0 * (size as f64).powi(3);
    let rows_per_band = size.div_ceil(threads);

    // Same reasoning as the bandwidth probe: 1.5 ms of arithmetic measures the
    // scheduler. Repeat the matmul until a sample is worth timing.
    let passes = ((SAMPLE_TARGET_SECONDS * FLOOR_FLOPS_PER_SECOND / flops_per_run).ceil() as u64)
        .clamp(1, MAX_PASSES_PER_SAMPLE);

    let mut samples = Vec::with_capacity(config.repetitions as usize);
    for _ in 0..config.repetitions {
        let started = Instant::now();
        for _ in 0..passes {
            c.fill(0.0);
            std::thread::scope(|scope| {
                let (a, b) = (&a, &b);
                let mut handles = Vec::new();
                for (band_index, rows) in c.chunks_mut(rows_per_band * size).enumerate() {
                    let first_row = band_index * rows_per_band;
                    handles.push(scope.spawn(move || {
                        for (offset, out) in rows.chunks_mut(size).enumerate() {
                            let row = first_row + offset;
                            for k in 0..size {
                                let weight = a[row * size + k];
                                let input = &b[k * size..(k + 1) * size];
                                for (slot, value) in out.iter_mut().zip(input) {
                                    *slot += weight * value;
                                }
                            }
                        }
                    }));
                }
                for handle in handles {
                    let _ = handle.join();
                }
            });
        }
        let elapsed = started.elapsed().as_secs_f64();
        std::hint::black_box(c[0]);
        if elapsed > 0.0 {
            samples.push(flops_per_run * passes as f64 / elapsed);
        }
    }
    Series::new(samples)
}
