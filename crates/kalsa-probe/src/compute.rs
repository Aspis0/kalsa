//! Compute, measured separately because **prefill is compute-bound**.
//!
//! Prefill multiplies every weight by every prompt token, so its cost is FLOPs
//! and predicting it from the bandwidth figure would be wrong in silence. This
//! probe is a dense f32 matmul, parallelised by rows the way an inference engine
//! splits work — portable Rust, no BLAS, no intrinsics, because we ship to
//! Haswell-era x86 as well as to Apple Silicon.
//!
//! # This figure is a FLOOR
//!
//! Measured on an M1 Max, this loop reaches ~131 GFLOP/s at 384×384 while
//! Accelerate's `sgemm` — the same multiplication through AMX and blocked,
//! vectorised kernels — reaches 1238 GFLOP/s: **9x more**. llama.cpp's prefill
//! kernels are blocked and quantised the same way, so a prefill prediction built
//! on this number under-predicts, and the caller needs to know that:
//! [`crate::Measurement::compute_is_lower_bound`] carries it as data.
//!
//! An earlier version of this comment called the figure an *upper bound* on real
//! prefill throughput. That is the wrong direction, which is worse than saying
//! nothing: it stopped the next reader from checking.
//!
//! # What does not help
//!
//! Blocking harder was tried and measured here, not assumed: a 4×4 register tile
//! (26 GFLOP/s), a dot-product form with 4-wide and 8-wide accumulators (32–42
//! GFLOP/s) all came out *slower* than this shape. The compiler vectorises the
//! simple axpy loop and stops vectorising the clever ones. The portable win is
//! doing several rows per pass: eight rows measure 131 vs 113 GFLOP/s at 384, and
//! 179 vs 135 at 1024.

use std::time::Instant;

use crate::bandwidth::SAMPLE_TARGET;
use crate::series::Series;
use crate::ProbeConfig;

/// Rows multiplied per pass: the one blocking factor that helped, measured.
const ROWS_PER_PASS: usize = 8;

pub fn measure_compute(config: &ProbeConfig) -> Series {
    let size = config.matmul_size.max(16);
    let threads = config.threads.max(1);
    let a = vec![1.0f32; size * size];
    let b = vec![0.5f32; size * size];
    let mut c = vec![0.0f32; size * size];
    let flops_per_run = 2.0 * (size as f64).powi(3);
    let rows_per_band = size.div_ceil(threads);

    let mut samples = Vec::with_capacity(config.repetitions as usize);
    for _ in 0..config.repetitions {
        let started = Instant::now();
        let mut passes = 0u64;
        // 1.5 ms of arithmetic measures the scheduler: keep going until the
        // sample is worth timing.
        while started.elapsed() < SAMPLE_TARGET {
            std::thread::scope(|scope| {
                let (a, b) = (&a, &b);
                let mut handles = Vec::new();
                for (band_index, rows) in c.chunks_mut(rows_per_band * size).enumerate() {
                    let first_row = band_index * rows_per_band;
                    handles.push(scope.spawn(move || {
                        multiply_rows(a, b, rows, size, first_row);
                    }));
                }
                for handle in handles {
                    let _ = handle.join();
                }
            });
            passes += 1;
        }
        let elapsed = started.elapsed().as_secs_f64();
        std::hint::black_box(c[0]);
        if elapsed > 0.0 {
            samples.push(flops_per_run * passes as f64 / elapsed);
        }
    }
    Series::new(samples)
}

/// `c` is this band's rows, `first_row` where they start in the full matrices.
fn multiply_rows(a: &[f32], b: &[f32], c: &mut [f32], size: usize, first_row: usize) {
    let rows = c.len() / size;
    let mut row = 0;
    while row < rows {
        let block = (rows - row).min(ROWS_PER_PASS);
        for k in 0..size {
            let input = &b[k * size..(k + 1) * size];
            for offset in 0..block {
                let weight = a[(first_row + row + offset) * size + k];
                let out = &mut c[(row + offset) * size..(row + offset + 1) * size];
                for (slot, value) in out.iter_mut().zip(input) {
                    *slot += weight * value;
                }
            }
        }
        row += block;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_short_run_produces_positive_flops() {
        let config = ProbeConfig {
            repetitions: 2,
            threads: 2,
            matmul_size: 64,
        };
        let series = measure_compute(&config);
        assert_eq!(series.samples().len(), 2);
        assert!(series.min() > 0.0);
    }

    /// Eight rows per pass is the shape that measured faster; the arithmetic has
    /// to be the same one, whatever the blocking.
    #[test]
    fn the_blocked_product_is_the_product() {
        let size = 8;
        let a: Vec<f32> = (0..size * size).map(|i| (i % 7) as f32 * 0.5).collect();
        let b: Vec<f32> = (0..size * size).map(|i| (i % 5) as f32 * 0.25).collect();
        let mut c = vec![0.0f32; size * size];
        multiply_rows(&a, &b, &mut c, size, 0);
        for i in 0..size {
            for j in 0..size {
                let expected: f32 = (0..size).map(|k| a[i * size + k] * b[k * size + j]).sum();
                assert!(
                    (c[i * size + j] - expected).abs() < 1e-3,
                    "c[{i}][{j}] = {} expected {expected}",
                    c[i * size + j]
                );
            }
        }
    }
}
