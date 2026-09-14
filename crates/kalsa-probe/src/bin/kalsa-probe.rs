//! Runs the probe and prints what it found, working included.
//!
//! `cargo run --release -p kalsa-probe` — release matters: a debug build
//! measures the optimizer, not the machine.

use kalsa_probe::{
    decode_tokens_per_second, measure_reliable, prefill_tokens_per_second, ProbeConfig, Series,
    EFFICIENCY_BAND,
};

/// Illustrative catalog rows: (label, active bytes, active parameters). Byte
/// counts assume ~0.6 bytes per weight (Q4_K_M plus overhead), the shape of the
/// models this product actually offers. The real numbers come from the catalog.
const ROWS: [(&str, u64, u64); 5] = [
    ("4B dense Q4", 2_400_000_000, 4_000_000_000),
    ("8B dense Q4", 4_800_000_000, 8_000_000_000),
    ("30B-A3B MoE Q4", 1_800_000_000, 3_000_000_000),
    ("70B dense Q4", 42_000_000_000, 70_000_000_000),
    ("120B-A12B MoE Q4", 7_200_000_000, 12_000_000_000),
];

fn main() {
    let config = ProbeConfig {
        repetitions: 5,
        ..ProbeConfig::default()
    };
    let measurement = measure_reliable(&config);

    println!(
        "probe: ramp up to {} threads, {} repetitions, {}×{} matmul",
        config.threads, config.repetitions, config.matmul_size, config.matmul_size
    );
    println!("measurement describes: {:?}", measurement.measured_on);
    println!("this machine offers:   {:?}", measurement.will_run_on);

    println!();
    println!(
        "thread ramp (best sample per count); plateau reached at {} threads:",
        measurement.plateau_threads
    );
    for (threads, rate) in &measurement.ramp {
        println!("  {threads:>2} threads {:>8.1} GB/s", rate / 1e9);
    }

    println!();
    report(
        "ceiling",
        "GB/s",
        &measurement.ceiling,
        measurement.ceiling_bytes_per_second,
    );
    report("cache", "GB/s", &measurement.cache, measurement.cache.max());
    report(
        "compute",
        "GFLOP/s",
        &measurement.compute,
        measurement.compute.max(),
    );

    println!();
    println!(
        "reliable: {}   (spread {:.1}%, parallelism {})",
        measurement.is_reliable(),
        measurement.reliability.spread * 100.0,
        match measurement.reliability.effective_parallelism {
            Some(parallelism) => format!("{parallelism:.1} cores"),
            None => "not measurable here".to_string(),
        }
    );
    for note in &measurement.reliability.notes {
        println!("  ! {note}");
    }

    println!();
    println!("lower bound: {}", measurement.bandwidth_is_lower_bound());
    println!("{}", measurement.measured_on.note());
    println!("{}", measurement.will_run_on.note());

    let (low, high) = EFFICIENCY_BAND;
    let bandwidth = measurement.ceiling_bytes_per_second;
    let compute = measurement.compute.max();
    println!();
    println!("predictions at efficiency {low}..{high} (and the 1.0 bound)");
    println!(
        "{:<20} {:>18} {:>18}",
        "row (illustrative)", "decode tok/s", "prefill tok/s"
    );
    for (label, active_bytes, active_params) in ROWS {
        println!(
            "{label:<20} {:>18} {:>18}",
            span(
                decode_tokens_per_second(bandwidth, active_bytes, low),
                decode_tokens_per_second(bandwidth, active_bytes, high),
                decode_tokens_per_second(bandwidth, active_bytes, 1.0),
            ),
            span(
                prefill_tokens_per_second(compute, active_params, low),
                prefill_tokens_per_second(compute, active_params, high),
                None,
            )
        );
    }
}

/// Everything in giga-units per second, so one divisor covers both metrics.
fn report(label: &str, unit: &str, series: &Series, headline: f64) {
    const GIGA: f64 = 1e9;
    println!(
        "{label:<10} best {:>8.2} {unit}   median {:>8.2}   min {:>8.2}   spread {:>5.1}%  ({} samples)",
        headline / GIGA,
        series.median() / GIGA,
        series.min() / GIGA,
        series.relative_spread() * 100.0,
        series.samples().len()
    );
}

fn span(low: Option<f64>, high: Option<f64>, upper: Option<f64>) -> String {
    let (Some(low), Some(high)) = (low, high) else {
        return "—".to_string();
    };
    match upper {
        Some(upper) => format!("{low:.1}–{high:.1} ({upper:.1})"),
        None => format!("{low:.1}–{high:.1}"),
    }
}
