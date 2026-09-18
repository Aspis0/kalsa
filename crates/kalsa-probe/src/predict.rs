//! The prediction, kept pure and far from any measurement so it can be tested
//! without hardware and so its assumptions sit in one place.
//!
//! One token costs a price paid whatever the weights weigh — attention, the
//! cache, launching kernels — plus the time to stream the bytes it reads:
//!
//! ```text
//! seconds/token = fixed_seconds + traffic_bytes / bandwidth
//! ```
//!
//! The additive term is what the measurement taught, not a refinement. Five
//! dense Q4_K_M models on one machine (Apple M1 Max, llama.cpp b10950 via
//! Metal, `llama-bench -p 0 -n 128 -r 3`; quantisation held fixed, only size
//! varying) decoded at 211.62, 139.81, 80.87, 43.38 and 24.06 tok/s at 0.4521,
//! 1.04, 1.95, 4.36 and 7.12 GiB. Under the old shape,
//! `tokens/s = efficiency × bandwidth / traffic`, those imply bandwidths of
//! 95.7, 145.4, 157.7, 189.1 and 171.3 GiB/s: the "constant" does not merely
//! climb with size, it wanders, and no multiplicative efficiency can repair a
//! shape whose constant moves. A fixed price per token can. Least squares over
//! the five gives **183.5 GiB/s and a fixed 1.504 ms**.
//!
//! The two shapes are compared by leave-one-out, not by a split chosen after
//! seeing the answer: each point predicted from the other four, the two-term
//! model errs 13.3% on average against the one-term model's 25.7%. Where it
//! errs matters and is not hidden here — the smallest model, held out, comes
//! back 37.4% wrong, because every remaining point sits at the large end and
//! the line is pinned there.
//!
//! What was measured is one machine and a streaming probe; what will run is
//! maybe another machine and a decode loop. So a machine that has only been
//! streamed gets a band, never a point:
//!
//! * the **pessimistic** end charges [`FIXED_SECONDS_PRIOR`] — one machine's
//!   fixed price — and only [`SUSTAINED_BANDWIDTH_SHARE`] of the measured
//!   rate, because dequantisation costs compute the bytes do not show
//!   (measured, but not modelled);
//! * the **optimistic** end charges nothing per token and streams at the full
//!   measured rate — itself no ceiling, since the probe is one process doing
//!   scalar reads, a quarter of this SoC's paper figure, and a tuned quantised
//!   kernel may stream faster still.
//!
//! An unmeasured machine's truth is somewhere between, and only a measured
//! decode settles where. Report the band, never one end of it.
//!
//! What even the two terms do not see:
//!
//! * the KV cache, which is re-read every token: the caller that knows the
//!   context charges it into `traffic_bytes` (the catalog does), and attention
//!   may read it more than once;
//! * a mixture-of-experts router — real per-token traffic does not follow the
//!   active bytes; the catalog carries that measured debt;
//! * company on the machine, and the assumption that all the traffic is read
//!   exactly once.
//!
//! **Prefill is compute-bound, not bandwidth-bound**, which is why the compute
//! measurement exists and why this module has a second function instead of
//! reusing the bandwidth one. Using the bandwidth number for prefill would be
//! wrong, and wrong in silence.
//!
//! ```text
//! prefill tokens/s ≈ FLOPs/s / (2 × active_parameters)
//! ```
//!
//! Note what is **not** in that formula: an efficiency. The band of the decode
//! model is a *memory* band — the share of measured bandwidth a real decode
//! loop sustains — and it was once applied to the compute figure too. That
//! made an already-low number lower, and the low number was a floor to begin
//! with, because the compute probe is a portable loop and real prefill kernels
//! are blocked, quantised and (on Apple Silicon) run on AMX. A compute-bound
//! prediction gets no memory band, and its floor-ness travels as data
//! ([`crate::Measurement::compute_is_lower_bound`]).

/// What one token costs on this machine: a price paid per token whatever the
/// weights weigh, plus the time to stream the bytes it reads.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DecodeCost {
    /// Seconds paid for every token before a byte is counted: attention, the
    /// cache, kernel launches. Zero means no such price is charged.
    pub fixed_seconds: f64,
    /// The rate the streaming term runs at: traffic divided by this is time.
    pub bandwidth_bytes_per_second: f64,
}

impl DecodeCost {
    /// Fit both terms from real (traffic_bytes, tokens_per_second) observations
    /// by least squares on `seconds/token = fixed + bytes / bandwidth`. Each
    /// point's rate must be finite and positive, and the byte counts must span
    /// a real lever arm — at least half the smallest byte count, where the
    /// calibration data in the tests spans sixteen-fold — because the fit can
    /// separate an additive term from a slope only as far apart as the sizes
    /// are: a one-byte lever on gigabyte models turns a rounding residual into
    /// an invented bandwidth. Answers `None` when the fit is not physical — a
    /// bandwidth of zero or less, a negative fixed cost, or byte counts too
    /// close to separate the terms.
    pub fn fit(points: &[(u64, f64)]) -> Option<DecodeCost> {
        if points.len() < 2 {
            return None;
        }
        // The lever arm, decided in exact integers: the mean of three equal
        // f64s is not always that value once the sum passes 2^53, so a
        // floating spread has no sign to trust — identical sizes must be
        // caught where they are identical.
        let smallest = points.iter().map(|&(bytes, _)| bytes).min()?;
        let largest = points.iter().map(|&(bytes, _)| bytes).max()?;
        if largest - smallest < smallest / 2 {
            return None;
        }
        let mut observed = Vec::with_capacity(points.len());
        for &(traffic_bytes, tokens_per_second) in points {
            observed.push((traffic_bytes as f64, seconds_per_token(tokens_per_second)?));
        }
        let count = observed.len() as f64;
        let mean_bytes = observed.iter().map(|(bytes, _)| bytes).sum::<f64>() / count;
        let mean_seconds = observed.iter().map(|(_, seconds)| seconds).sum::<f64>() / count;
        let mut spread_bytes = 0.0;
        let mut spread_join = 0.0;
        for &(bytes, seconds) in &observed {
            spread_bytes += (bytes - mean_bytes) * (bytes - mean_bytes);
            spread_join += (bytes - mean_bytes) * (seconds - mean_seconds);
        }
        // Bytes per `slope` seconds: a slope that is not finite and positive
        // is no spread in the sizes, or a machine where bigger models run
        // faster. And a line that crosses zero below it charges a negative
        // price per token.
        let slope = spread_join / spread_bytes;
        let fixed_seconds = mean_seconds - slope * mean_bytes;
        if !(slope.is_finite() && slope > 0.0)
            || !(fixed_seconds.is_finite() && fixed_seconds >= 0.0)
        {
            return None;
        }
        Some(DecodeCost {
            fixed_seconds,
            bandwidth_bytes_per_second: 1.0 / slope,
        })
    }
}

/// The two ends of what is not known about a machine that has only been
/// streamed, pessimistic first.
///
/// The **pessimistic** end assumes a real decode loop pays
/// [`FIXED_SECONDS_PRIOR`] — one machine's fixed per-token price — and
/// sustains only [`SUSTAINED_BANDWIDTH_SHARE`] of a streaming probe's rate,
/// because dequantisation costs compute the bytes do not show. The
/// **optimistic** end assumes neither: no fixed price, and every second
/// belongs to the bytes at the full measured rate. The truth of an unmeasured
/// machine lies between, and only a measured decode settles where. Answers
/// `None` for a bandwidth that is not finite and positive.
pub fn decode_band(bandwidth_bytes_per_second: f64) -> Option<(DecodeCost, DecodeCost)> {
    if !(bandwidth_bytes_per_second.is_finite() && bandwidth_bytes_per_second > 0.0) {
        return None;
    }
    Some((
        DecodeCost {
            fixed_seconds: FIXED_SECONDS_PRIOR,
            bandwidth_bytes_per_second: bandwidth_bytes_per_second * SUSTAINED_BANDWIDTH_SHARE,
        },
        DecodeCost {
            fixed_seconds: 0.0,
            bandwidth_bytes_per_second,
        },
    ))
}

/// Tokens per second at this cost for a token whose traffic is
/// `traffic_bytes`: the fixed price plus the streaming time, inverted.
///
/// Answers `None` for zero traffic, a non-finite or non-positive bandwidth,
/// or a negative fixed cost.
pub fn decode_tokens_per_second(cost: &DecodeCost, traffic_bytes: u64) -> Option<f64> {
    if traffic_bytes == 0
        || !(cost.fixed_seconds.is_finite() && cost.fixed_seconds >= 0.0)
        || !(cost.bandwidth_bytes_per_second.is_finite()
            && cost.bandwidth_bytes_per_second > 0.0)
    {
        return None;
    }
    let seconds = cost.fixed_seconds + traffic_bytes as f64 / cost.bandwidth_bytes_per_second;
    Some(1.0 / seconds)
}

/// The fixed cost of one token on the ONE machine measured so far (Apple
/// M1 Max, fitted from the five points in the tests): attention, the
/// cache and kernel launches, paid whatever the weights weigh. It is a prior
/// from a single machine, not a constant of nature; a machine measured for
/// real replaces it.
pub const FIXED_SECONDS_PRIOR: f64 = 0.001_504;

/// The marginal decode rate those same five runs fit, in bytes per second.
/// [`crate::soc`] divides it by the published figure of the part it was
/// measured on to get a share it can apply to other chips, so the number
/// lives here once: a sixth measurement moves the fit, the fit test below
/// fails, and the share follows the constant instead of drifting from it.
pub const MEASURED_DECODE_BYTES_PER_SECOND: f64 = 197.0e9;

/// The share of a measured streaming rate a real decode loop is assumed to
/// sustain — the pessimistic end's second admission. Dequantisation costs
/// compute the bytes do not show: the same gemma model requantised to Q2_K
/// (4.48 GiB) decodes at 26.4 tok/s where the fit says 38.6, so 32% of every
/// token's time goes somewhere the byte count does not explain. That effect is
/// measured but NOT modelled here; only a measured decode settles it.
pub const SUSTAINED_BANDWIDTH_SHARE: f64 = 0.7;

/// A rate inverted, or nothing: only a finite, positive rate is a measurement.
fn seconds_per_token(tokens_per_second: f64) -> Option<f64> {
    (tokens_per_second.is_finite() && tokens_per_second > 0.0).then_some(1.0 / tokens_per_second)
}

/// Prefill throughput (tokens per second of prompt processing) for a model with
/// `active_parameters` active weights: two FLOPs per weight per token.
///
/// This is a **floor**: it comes from a portable f32 loop, and the kernels
/// llama.cpp ships are faster — by a lot. On the M1 Max (2026-09-18) this
/// formula predicted 23 tok/s of prefill for Qwen3.6-35B-A3B's 3B active
/// parameters at 138 GFLOP/s; the machine measured ~300. A floor that far
/// below reality is a direction, not a number, and it must reach a human
/// only in words that say "at least". There is deliberately no efficiency
/// parameter — see the module header for what applying the memory band here
/// cost.
pub fn prefill_tokens_per_second(
    compute_flops_per_second: f64,
    active_parameters: u64,
) -> Option<f64> {
    if !(compute_flops_per_second.is_finite() && compute_flops_per_second > 0.0) {
        return None;
    }
    if active_parameters == 0 {
        return None;
    }
    Some(compute_flops_per_second / (2.0 * active_parameters as f64))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIB: f64 = 1_073_741_824.0;

    /// Five dense Q4_K_M models, quantisation held fixed, only size varying:
    /// (model size as llama-bench sees it, decode tok/s). Apple M1 Max,
    /// llama.cpp b10950 via Metal, `llama-bench -p 0 -n 128 -r 3`, measured
    /// 2026-09-18. Qwen2.5-0.5B/1.5B/3B/7B-Instruct, gemma-4-12B-it.
    const MEASURED: [(u64, f64); 5] = [
        ((0.4521 * GIB) as u64, 211.62),
        ((1.04 * GIB) as u64, 139.81),
        ((1.95 * GIB) as u64, 80.87),
        ((4.36 * GIB) as u64, 43.38),
        ((7.12 * GIB) as u64, 24.06),
    ];

    #[test]
    fn the_five_measurements_fit_a_bandwidth_and_a_fixed_price() {
        let cost = DecodeCost::fit(&MEASURED).expect("five real points fit");
        assert!(
            (cost.bandwidth_bytes_per_second - MEASURED_DECODE_BYTES_PER_SECOND).abs()
                < MEASURED_DECODE_BYTES_PER_SECOND * 0.03,
            "bandwidth {:.1} GiB/s, wanted within a few percent of {:.1}",
            cost.bandwidth_bytes_per_second / GIB,
            MEASURED_DECODE_BYTES_PER_SECOND / GIB
        );
        assert!(
            (cost.fixed_seconds - 0.001_504).abs() < 0.000_3,
            "fixed cost {:.3} ms, wanted within a few tenths of a ms of 1.504",
            cost.fixed_seconds * 1e3
        );
    }

    /// Leave-one-out over all five points, for both shapes fitted on the same
    /// folds by least squares in the same seconds-per-token space: the
    /// two-term fit, and the old one-term shape — the same line forced
    /// through the origin, no fixed price (`slope = Σxy / Σx²`).
    fn leave_one_out_errors() -> ([f64; 5], [f64; 5]) {
        let mut two_term = [0.0; 5];
        let mut one_term = [0.0; 5];
        for held_out in 0..MEASURED.len() {
            let training: Vec<(u64, f64)> = MEASURED
                .iter()
                .enumerate()
                .filter(|(index, _)| *index != held_out)
                .map(|(_, &point)| point)
                .collect();
            let cost = DecodeCost::fit(&training).expect("four sizes span the terms");
            let predicted =
                decode_tokens_per_second(&cost, MEASURED[held_out].0).expect("predicts");
            two_term[held_out] = (predicted - MEASURED[held_out].1).abs() / MEASURED[held_out].1;
            let observed: Vec<(f64, f64)> = training
                .iter()
                .map(|&(bytes, tokens_per_second)| {
                    (bytes as f64, seconds_per_token(tokens_per_second).expect("real rates"))
                })
                .collect();
            let slope = observed.iter().map(|(x, y)| x * y).sum::<f64>()
                / observed.iter().map(|(x, _)| x * x).sum::<f64>();
            let old = 1.0 / (slope * MEASURED[held_out].0 as f64);
            one_term[held_out] = (old - MEASURED[held_out].1).abs() / MEASURED[held_out].1;
        }
        (two_term, one_term)
    }

    #[test]
    fn left_out_one_at_a_time_the_two_term_fit_predicts_every_point() {
        let (two_term, _) = leave_one_out_errors();
        let mean = two_term.iter().sum::<f64>() / 5.0;
        let worst = two_term.iter().copied().fold(0.0, f64::max);
        assert!(
            (mean - 0.133).abs() < 0.02,
            "mean absolute error {:.1}%, wanted near 13.3%",
            mean * 100.0
        );
        assert!(
            (worst - 0.374).abs() < 0.05,
            "worst case {:.1}%, wanted near 37.4%",
            worst * 100.0
        );
    }

    #[test]
    fn the_old_one_term_shape_loses_the_same_leave_one_out() {
        // A fair comparison, not a strawman: both shapes fitted by least
        // squares on the same training folds, in the same seconds-per-token
        // space. The old model is the same line forced through the origin —
        // no fixed price — and it loses on the mean and on the worst case.
        let (two_term, one_term) = leave_one_out_errors();
        let mean = |errors: &[f64; 5]| errors.iter().sum::<f64>() / 5.0;
        let worst = |errors: &[f64; 5]| errors.iter().copied().fold(0.0, f64::max);
        assert!(
            mean(&two_term) < mean(&one_term),
            "two-term mean {:.1}% does not beat one-term {:.1}%",
            mean(&two_term) * 100.0,
            mean(&one_term) * 100.0
        );
        assert!(
            worst(&two_term) < worst(&one_term),
            "two-term worst {:.1}% does not beat one-term {:.1}%",
            worst(&two_term) * 100.0,
            worst(&one_term) * 100.0
        );
    }

    #[test]
    fn fit_refuses_what_it_cannot_fit() {
        assert!(DecodeCost::fit(&[]).is_none());
        assert!(DecodeCost::fit(&[MEASURED[0]]).is_none(), "one point, two unknowns");
        assert!(
            DecodeCost::fit(&[MEASURED[0], MEASURED[0]]).is_none(),
            "the same bytes twice cannot separate the terms"
        );
        assert!(
            DecodeCost::fit(&[(1_000_000_000, 1000.0), (3_000_000_000, 250.0)]).is_none(),
            "these two imply a negative fixed cost"
        );
        assert!(DecodeCost::fit(&[(1_000_000_000, 1000.0), (2_000_000_000, 0.0)]).is_none());
        assert!(DecodeCost::fit(&[(1_000_000_000, 1000.0), (2_000_000_000, f64::NAN)]).is_none());
        // The audit's evidence, verbatim. A one-byte lever on 1.9 GB models
        // fit cleanly and invented a 1000 GB/s machine; and three identical
        // gigabyte counts are one point, though their floating mean rounds
        // away from their own value and once read as a spread.
        assert!(
            DecodeCost::fit(&[(1_900_000_000, 100.0), (1_900_000_001, 100.0 / (1.0 + 1e-10))])
                .is_none(),
            "a one-byte lever cannot separate the two terms"
        );
        let identical: u64 = 4_367_480_754_684_579;
        assert!(
            DecodeCost::fit(&[(identical, 211.62), (identical, 80.87), (identical, 23.83)])
                .is_none(),
            "identical sizes are one point, whatever the mean rounds to"
        );
    }

    #[test]
    fn the_band_is_pessimistic_first() {
        let bandwidth = 178.0 * GIB;
        let (pessimistic, optimistic) = decode_band(bandwidth).expect("a real bandwidth");
        // Pessimistic: the one machine's price, and only a share of the rate.
        assert_eq!(pessimistic.fixed_seconds, FIXED_SECONDS_PRIOR);
        assert_eq!(
            pessimistic.bandwidth_bytes_per_second,
            bandwidth * SUSTAINED_BANDWIDTH_SHARE
        );
        // Optimistic: nothing per token, the full measured rate.
        assert_eq!(optimistic.fixed_seconds, 0.0);
        assert_eq!(optimistic.bandwidth_bytes_per_second, bandwidth);
        assert!(
            decode_tokens_per_second(&pessimistic, MEASURED[2].0)
                < decode_tokens_per_second(&optimistic, MEASURED[2].0),
            "pessimistic must be the slower end"
        );
    }

    #[test]
    fn seconds_are_the_fixed_price_plus_traffic_over_bandwidth() {
        let cost = DecodeCost {
            fixed_seconds: 0.002,
            bandwidth_bytes_per_second: 100.0e9,
        };
        let traffic_bytes = 50_000_000_000;
        let seconds = 1.0 / decode_tokens_per_second(&cost, traffic_bytes).expect("predicts");
        assert!((seconds - 0.002 - 0.5).abs() < 1e-12, "got {seconds}");
        // Additive, not a share: doubling the traffic adds the same half
        // second again, where the old shape would have multiplied everything.
        let doubled = 1.0 / decode_tokens_per_second(&cost, traffic_bytes * 2).expect("predicts");
        assert!((doubled - seconds - 0.5).abs() < 1e-12, "got {doubled}");
    }

    #[test]
    fn nonsense_inputs_predict_nothing() {
        assert!(decode_band(0.0).is_none());
        assert!(decode_band(-178.0 * GIB).is_none());
        assert!(decode_band(f64::NAN).is_none());
        let (pessimistic, _) = decode_band(100.0e9).expect("a real bandwidth");
        assert!(
            decode_tokens_per_second(&pessimistic, 0).is_none(),
            "no traffic, no token"
        );
        assert!(decode_tokens_per_second(
            &DecodeCost {
                fixed_seconds: -0.001,
                bandwidth_bytes_per_second: 100.0e9
            },
            1_000
        )
        .is_none());
        assert!(decode_tokens_per_second(
            &DecodeCost {
                fixed_seconds: 0.001,
                bandwidth_bytes_per_second: 0.0
            },
            1_000
        )
        .is_none());
        assert!(decode_tokens_per_second(
            &DecodeCost {
                fixed_seconds: 0.001,
                bandwidth_bytes_per_second: f64::NAN
            },
            1_000
        )
        .is_none());
        assert!(prefill_tokens_per_second(0.0, 1_000).is_none());
        assert!(prefill_tokens_per_second(1.0e12, 0).is_none());
    }

    #[test]
    fn prefill_is_compute_over_active_parameters_with_no_correction() {
        let flops = 100.0e9;
        let params = 3_000_000_000;
        let predicted = prefill_tokens_per_second(flops, params).expect("a prediction");
        assert!((predicted - 16.667).abs() < 0.01, "got {predicted}");
        // No memory band anywhere near it: the figure is a floor, and a floor is
        // not to be multiplied down.
        assert!(
            (predicted - flops / (2.0 * params as f64)).abs() < 1e-9,
            "the compute figure must pass through untouched"
        );
    }
}
