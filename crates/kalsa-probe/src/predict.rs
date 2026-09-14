//! The prediction, kept pure and far from any measurement so it can be tested
//! without hardware and so its assumptions sit in one place.
//!
//! **Decode is bandwidth-bound.** Generating one token reads every *active*
//! parameter byte once, so
//!
//! ```text
//! tokens/s ≈ efficiency × bandwidth / active_bytes
//! ```
//!
//! With `efficiency = 1.0` this is an upper bound **for the bandwidth the probe
//! measured — not for the hardware**. The probe is one process doing scalar
//! streaming reads, and on the development machine (Apple M1 Max, 400 GB/s of
//! LPDDR5 on paper) it reaches ~100 GB/s, a quarter of the SoC figure. A tuned
//! quantised kernel may stream faster, so this prediction can be *pessimistic*
//! as well as optimistic. Only a real model, benchmarked here, settles which;
//! that is the plan's measured baseline, and this probe exists to pre-filter a
//! catalog so the user does not download a candidate that obviously loses.
//!
//! It also ignores:
//!
//! * the KV cache, which is re-read every token and grows with context — the
//!   largest omission for a mixture-of-experts model, whose active weights are
//!   small enough that the cache is a big share of the traffic;
//! * attention cost, which grows with context as well;
//! * a mixture-of-experts router (extra reads per token, experts not contiguous);
//! * the fact that the machine does not reach its measured peak while doing
//!   anything else, and that not all of the weights are read exactly once.
//!
//! On CPU, reality lands roughly 10–30% below the upper bound, i.e. an
//! efficiency of 0.7–0.9. Report a range, never the single bound.
//!
//! **Prefill is compute-bound, not bandwidth-bound**, which is why the compute
//! measurement exists and why this module has a second function instead of
//! reusing the bandwidth one. Using the bandwidth number for prefill would be
//! wrong, and wrong in silence.
//!
//! ```text
//! prefill tokens/s ≈ efficiency × FLOPs/s / (2 × active_parameters)
//! ```

/// Decode throughput for a model whose active weights are `active_parameter_bytes`.
///
/// `efficiency` is what fraction of the measured bandwidth the model actually
/// sustains: 1.0 for the bound relative to the measurement, 0.7–0.9 for the band
/// seen against real inference elsewhere. Both the measurement's blind spots and
/// the model's omitted traffic sit inside this number; it is a prior, not a
/// constant of nature.
pub fn decode_tokens_per_second(
    bandwidth_bytes_per_second: f64,
    active_parameter_bytes: u64,
    efficiency: f64,
) -> Option<f64> {
    let inputs = plausible(bandwidth_bytes_per_second, efficiency)?;
    if active_parameter_bytes == 0 {
        return None;
    }
    Some(inputs.0 * inputs.1 / active_parameter_bytes as f64)
}

/// Prefill throughput (tokens per second of prompt processing) for a model with
/// `active_parameters` active weights: two FLOPs per weight per token.
pub fn prefill_tokens_per_second(
    compute_flops_per_second: f64,
    active_parameters: u64,
    efficiency: f64,
) -> Option<f64> {
    let inputs = plausible(compute_flops_per_second, efficiency)?;
    if active_parameters == 0 {
        return None;
    }
    Some(inputs.0 * inputs.1 / (2.0 * active_parameters as f64))
}

/// The efficiency band the two functions above are honest within, as measured
/// against real inference elsewhere. A single number would be a lie.
pub const EFFICIENCY_BAND: (f64, f64) = (0.7, 0.9);

fn plausible(rate: f64, efficiency: f64) -> Option<(f64, f64)> {
    let valid_rate = rate.is_finite() && rate > 0.0;
    let valid_efficiency = efficiency.is_finite() && efficiency > 0.0 && efficiency <= 1.0;
    (valid_rate && valid_efficiency).then_some((rate, efficiency))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_is_bandwidth_over_active_bytes() {
        let bandwidth = 20.0e9;
        let active = 2_400_000_000; // as reported: what a 4B model reads per token
        let upper = decode_tokens_per_second(bandwidth, active, 1.0).expect("upper bound");
        assert!((upper - 8.333).abs() < 0.01, "got {upper}");
        let typical = decode_tokens_per_second(bandwidth, active, 0.8).expect("typical");
        assert!((typical - 6.667).abs() < 0.01, "got {typical}");
        assert!(typical < upper);
    }

    #[test]
    fn decode_scales_the_way_the_hardware_does() {
        // Twice the bandwidth, twice the tokens. Twice the weights, half.
        let base = decode_tokens_per_second(20.0e9, 2_000_000_000, 1.0).expect("base");
        let more_bandwidth = decode_tokens_per_second(40.0e9, 2_000_000_000, 1.0).expect("double");
        let more_weights = decode_tokens_per_second(20.0e9, 4_000_000_000, 1.0).expect("half");
        assert!((more_bandwidth - 2.0 * base).abs() < 1e-9);
        assert!((more_weights - base / 2.0).abs() < 1e-9);
    }

    #[test]
    fn prefill_uses_compute_not_bandwidth() {
        let flops = 100.0e9;
        let params = 3_000_000_000;
        let upper = prefill_tokens_per_second(flops, params, 1.0).expect("upper bound");
        assert!((upper - 16.667).abs() < 0.01, "got {upper}");
        let typical = prefill_tokens_per_second(flops, params, 0.8).expect("typical");
        assert!((typical - 13.333).abs() < 0.01, "got {typical}");
    }

    #[test]
    fn nonsense_inputs_predict_nothing() {
        assert!(decode_tokens_per_second(0.0, 1_000, 1.0).is_none());
        assert!(decode_tokens_per_second(20.0e9, 0, 1.0).is_none());
        assert!(decode_tokens_per_second(20.0e9, 1_000, 0.0).is_none());
        assert!(decode_tokens_per_second(20.0e9, 1_000, 1.5).is_none());
        assert!(decode_tokens_per_second(f64::NAN, 1_000, 1.0).is_none());
        assert!(prefill_tokens_per_second(0.0, 1_000, 1.0).is_none());
        assert!(prefill_tokens_per_second(1.0e12, 0, 1.0).is_none());
    }

    #[test]
    fn the_band_is_wider_than_nothing_and_inside_a_bound() {
        let (low, high) = EFFICIENCY_BAND;
        assert!(low > 0.0 && low < high && high <= 1.0);
    }
}
