//! Runs the probe and prints what it found, spread included.
//!
//! `cargo run --release -p kalsa-probe` — release matters: a debug build
//! measures the optimizer, not the machine.

use kalsa_probe::{
    decode_tokens_per_second, measure_bandwidth, measure_compute, prefill_tokens_per_second,
    ProbeConfig, Series, EFFICIENCY_BAND,
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
    let config = match configured() {
        Ok(config) => config,
        Err(usage) => {
            eprintln!("{usage}");
            std::process::exit(2);
        }
    };
    println!(
        "probe: {} MiB buffer, {} repetitions, {} threads, {}×{} matmul",
        config.buffer_bytes / (1024 * 1024),
        config.repetitions,
        config.threads,
        config.matmul_size,
        config.matmul_size
    );

    let bandwidth = measure_bandwidth(&config);
    report("bandwidth", "GB/s", &bandwidth, |value| value / 1e9);
    let compute = measure_compute(&config);
    report("compute", "GFLOP/s", &compute, |value| value / 1e9);

    // The median, not the mean: one descheduled sample must not decide what we
    // tell the user about their machine.
    let bandwidth_mean = bandwidth.median();
    let compute_mean = compute.median();
    let (low, high) = EFFICIENCY_BAND;
    println!();
    println!("predictions from the median, at efficiency {low}..{high} (and the 1.0 bound)");
    println!(
        "{:<20} {:>18} {:>18}",
        "row (illustrative)", "decode tok/s", "prefill tok/s"
    );
    for (label, active_bytes, active_params) in ROWS {
        let decode_upper = decode_tokens_per_second(bandwidth_mean, active_bytes, 1.0);
        let decode_low = decode_tokens_per_second(bandwidth_mean, active_bytes, low);
        let decode_high = decode_tokens_per_second(bandwidth_mean, active_bytes, high);
        let prefill_low = prefill_tokens_per_second(compute_mean, active_params, low);
        let prefill_high = prefill_tokens_per_second(compute_mean, active_params, high);
        println!(
            "{label:<20} {:>18} {:>18}",
            span(decode_low, decode_high, decode_upper),
            span(prefill_low, prefill_high, None)
        );
    }
}

/// `--threads`, `--reps`, `--buffer-mib`, `--matmul`: enough to re-measure a
/// different way (one thread, a longer sample) without editing code.
fn configured() -> Result<ProbeConfig, String> {
    let mut config = ProbeConfig::default();
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--threads" => config.threads = number(&mut args, &flag)?.max(1),
            "--reps" => config.repetitions = number(&mut args, &flag)?.max(1) as u32,
            "--buffer-mib" => config.buffer_bytes = number(&mut args, &flag)? * 1024 * 1024,
            "--matmul" => config.matmul_size = number(&mut args, &flag)?,
            other => {
                return Err(format!(
                    "unknown flag {other}\nusage: kalsa-probe [--threads N] [--reps N] [--buffer-mib N] [--matmul N]"
                ))
            }
        }
    }
    Ok(config)
}

fn number(args: &mut impl Iterator<Item = String>, flag: &str) -> Result<usize, String> {
    args.next()
        .ok_or_else(|| format!("{flag} needs a value"))?
        .parse()
        .map_err(|e| format!("{flag}: {e}"))
}

fn report(label: &str, unit: &str, series: &Series, scale: impl Fn(f64) -> f64) {
    println!(
        "{label:<10} median {:>8.2} {unit}   mean {:>8.2}   min {:>8.2}   max {:>8.2}   spread {:>5.1}%  ({} samples)",
        scale(series.median()),
        scale(series.mean()),
        scale(series.min()),
        scale(series.max()),
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
