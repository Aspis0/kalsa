//! Runs the probe and prints what it found, working included.
//!
//! `cargo run --release -p kalsa-probe` — release matters: a debug build
//! measures the optimizer, not the machine.

use kalsa_probe::{
    decode_band, decode_tokens_per_second, measure_reliable, prefill_tokens_per_second, ProbeConfig,
    Series,
};

/// Illustrative catalog rows: (label, active bytes, active parameters). Byte
/// counts assume ~0.6 bytes per weight (Q4_K_M plus overhead), the shape of the
/// models this product actually offers. The real numbers come from the catalog.
/// Illustrative rows: the label, the bytes a token really READS, and the active
/// parameters prefill is priced from.
///
/// The middle column is traffic, not the active-byte share, and for a mixture
/// those differ: a router reads about 2.06x its active bytes, measured across
/// four decoded MoEs (`kalsa_catalog::candidate::MOE_TRAFFIC_CORRECTION`). The
/// catalog applies that correction and this table used to not, so the two tools
/// printed different speeds for the same model — the MoE rows below carry it
/// pre-multiplied. The constant cannot be imported: the catalog depends on this
/// crate, not the other way round.
const ROWS: [(&str, u64, u64); 5] = [
    ("4B dense Q4", 2_400_000_000, 4_000_000_000),
    ("8B dense Q4", 4_800_000_000, 8_000_000_000),
    // 1.8 GB active x 2.06
    ("30B-A3B MoE Q4", 3_708_000_000, 3_000_000_000),
    ("70B dense Q4", 42_000_000_000, 70_000_000_000),
    // 7.2 GB active x 2.06
    ("120B-A12B MoE Q4", 14_832_000_000, 12_000_000_000),
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
    println!(
        "lower bounds: bandwidth {} (detected path), compute {} (portable loop)",
        measurement.bandwidth_is_lower_bound(),
        measurement.compute_is_lower_bound()
    );
    println!("{}", measurement.measured_on.note());
    println!("{}", measurement.will_run_on.note());

    let ends = decode_band(measurement.decode_bandwidth_bytes_per_second());
    let compute = measurement.compute.max();
    println!();
    match ends {
        Some((pessimistic, optimistic)) => println!(
            "decode band: pessimistic pays {:.3} ms/token and reads at {:.0} GB/s, optimistic pays nothing and reads at {:.0} GB/s; prefill is a FLOOR, no band",
            pessimistic.fixed_seconds * 1e3,
            pessimistic.bandwidth_bytes_per_second / 1e9,
            optimistic.bandwidth_bytes_per_second / 1e9,
        ),
        None => println!(
            "decode: the measured bandwidth gives no band to predict from; prefill is a FLOOR, no band"
        ),
    }
    println!(
        "{:<20} {:>18} {:>18}",
        "row (illustrative)", "decode tok/s", "prefill tok/s"
    );
    for (label, traffic_bytes, active_params) in ROWS {
        println!(
            "{label:<20} {:>18} {:>18}",
            span(
                ends.and_then(|(pessimistic, _)| {
                    decode_tokens_per_second(&pessimistic, traffic_bytes)
                }),
                ends.and_then(|(_, optimistic)| {
                    decode_tokens_per_second(&optimistic, traffic_bytes)
                }),
            ),
            match prefill_tokens_per_second(compute, active_params) {
                Some(floor) => format!("≥ {floor:.1}"),
                None => "—".to_string(),
            }
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

/// Both ends of the band, or a dash when there is no band to show.
fn span(low: Option<f64>, high: Option<f64>) -> String {
    let (Some(low), Some(high)) = (low, high) else {
        return "—".to_string();
    };
    format!("{low:.1}–{high:.1}")
}
