//! Labels and figures the engines page shows verbatim from the catalog.

use crate::Benchmark;

fn apple_chip(machine: &str) -> Option<String> {
    let words: Vec<&str> = machine
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    for (at, word) in words.iter().enumerate() {
        let upper = word.to_ascii_uppercase();
        let bytes = upper.as_bytes();
        if bytes.len() == 2 && bytes[0] == b'M' && (b'1'..=b'5').contains(&bytes[1]) {
            let mut label = upper;
            if let Some(next) = words.get(at + 1) {
                let qualifier = next.to_ascii_lowercase();
                if ["pro", "max", "ultra"].contains(&qualifier.as_str()) {
                    label.push(' ');
                    label.push_str(&qualifier[..1].to_ascii_uppercase());
                    label.push_str(&qualifier[1..]);
                }
            }
            return Some(label);
        }
    }
    None
}

/// The chip a benchmark was measured on, never a version string or RAM size.
pub fn chip_label(benchmark: &Benchmark) -> String {
    if let Some(chip) = apple_chip(&benchmark.machine) {
        return chip;
    }
    match benchmark.chip_tag.as_str() {
        "nvidia" => "NVIDIA GPU".to_string(),
        "amd" => "AMD GPU".to_string(),
        "intel" => "Intel GPU".to_string(),
        "cpu" => "CPU".to_string(),
        tag if tag.starts_with("apple-m") => format!("Apple M{}", &tag[7..]),
        _ => "other hardware".to_string(),
    }
}

/// The metric `gain_of` compares: decode when both decode figures exist, else prefill.
pub fn gain_metric(benchmark: &Benchmark) -> Option<&'static str> {
    if benchmark.decode_tok_s.is_some() && benchmark.baseline_decode_tok_s.is_some() {
        Some("decode")
    } else if benchmark.prefill_tok_s.is_some() && benchmark.baseline_prefill_tok_s.is_some() {
        Some("prefill")
    } else {
        None
    }
}

pub fn gain_of(benchmark: &Benchmark) -> Option<f64> {
    if let (Some(value), Some(base)) = (benchmark.decode_tok_s, benchmark.baseline_decode_tok_s) {
        return Some(value / base);
    }
    match (benchmark.prefill_tok_s, benchmark.baseline_prefill_tok_s) {
        (Some(value), Some(base)) => Some(value / base),
        _ => None,
    }
}

pub fn gain_label(ratio: f64) -> String {
    if ratio >= 2.0 {
        format!("{ratio:.1}×")
    } else {
        format!("{:+}%", ((ratio - 1.0) * 100.0).round())
    }
}

pub fn figure_label(benchmark: &Benchmark) -> Option<String> {
    if let Some(decode) = benchmark.decode_tok_s {
        Some(format!("decode {decode} tok/s"))
    } else {
        benchmark
            .prefill_tok_s
            .map(|prefill| format!("prefill {prefill} tok/s (no decode figure)"))
    }
}
