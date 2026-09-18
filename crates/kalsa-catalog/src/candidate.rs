//! A catalog row turned into a prediction for one machine: what it occupies,
//! how fast a token comes out, how fast prompts go in.
//!
//! The two axes are easy to swap and fatal to swap: the footprint uses the
//! TOTAL weights, the speed the ACTIVE ones. Keeping the construction in one
//! place is what makes swapping them twice impossible.

use kalsa_probe::{decode_band, decode_tokens_per_second, prefill_tokens_per_second};

use crate::choice::{ChoiceInput, MINIMUM_TOKENS_PER_SECOND};
use crate::footprint::{footprint_bytes, Footprint, MemoryBudget};
use crate::manifest::{self, GgufSource, ModelEntry, UsableEntry};

/// A predicted figure, with its shape carried in the type. The shape is
/// decided where the prediction is made, which is why the formatter has no
/// equal-ends case to guard and no wrong call to make: it renders whichever
/// shape it is handed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Prediction {
    /// Decode, from a bandwidth measured on the path the model will run on:
    /// the same traffic priced at both ends of the machine's band — a
    /// pessimistic end that pays a fixed price per token and only a share of
    /// the measured rate, an optimistic end that pays nothing and streams at
    /// full rate — so both ends are known.
    Range { low: f64, high: f64 },
    /// A lower bound — decode predicted from a bandwidth measured on a
    /// slower path than the model will run on. It can keep a candidate, but
    /// it can never refuse one, and the formatter gives it words, not
    /// figures: tonight a floor built from a busy probe said ">= 3.0" for a
    /// machine doing 62, and a figure that wrong must not be pronounceable.
    Floor(f64),
    /// An estimate — prefill, from the compute probe. The probe counts the
    /// weights' work and omits attention and routing, which grow with
    /// context, so the figure is neither a floor nor a range and prints as
    /// an approximation.
    Estimate(f64),
    /// A decode rate measured for real, on the real path, for the measured
    /// row — it replaces the probe prediction entirely, and it names the
    /// machine, because a rate is a fact about one machine, never a
    /// property of the model.
    Measured {
        tokens_per_second: f64,
        machine: &'static str,
    },
}

impl Prediction {
    /// The pessimistic end — the one that must clear the usability floor.
    pub fn floor(&self) -> f64 {
        match *self {
            Prediction::Range { low, .. } => low,
            Prediction::Floor(value)
            | Prediction::Estimate(value)
            | Prediction::Measured {
                tokens_per_second: value,
                ..
            } => value,
        }
    }

    /// The optimistic end — the one same-class candidates are ordered by.
    pub fn ceiling(&self) -> f64 {
        match *self {
            Prediction::Range { high, .. } => high,
            Prediction::Floor(value)
            | Prediction::Estimate(value)
            | Prediction::Measured {
                tokens_per_second: value,
                ..
            } => value,
        }
    }
}

pub(crate) struct Candidate<'a> {
    pub(crate) entry: &'a ModelEntry,
    /// The pinned file behind the row. A candidate exists only for a row
    /// that has one — that is what `UsableEntry` means — so a prediction
    /// can always become a download plan.
    pub(crate) source: &'a GgufSource,
    pub(crate) footprint: Footprint,
    /// Decode throughput as a range, never as a point.
    pub(crate) decode: Prediction,
    /// Prefill throughput as a **floor**: one number meaning "at least this
    /// much".
    pub(crate) prefill: Prediction,
}

impl Candidate<'_> {
    /// Ordered by the top of the band: the band is the same factor for every
    /// candidate, so this is the same ordering as any other point in it.
    pub(crate) fn decode_ceiling(&self) -> f64 {
        self.decode.ceiling()
    }
}

/// The decode prediction the chooser itself would give this row on this
/// machine — the same candidate construction `choose` runs: the measured rate
/// when the row carries one for this backend, otherwise the two ends of the
/// machine's band over the row's real traffic, cache included. One copy of
/// that arithmetic exists; this is the window onto it for callers outside
/// the catalog, so no fourth formula grows somewhere else.
pub fn decode_prediction(entry: UsableEntry<'_>, input: &ChoiceInput) -> Prediction {
    candidate(entry, input).decode
}

pub(crate) fn candidate<'a>(entry: UsableEntry<'a>, input: &ChoiceInput) -> Candidate<'a> {
    let source = entry.source();
    let entry = entry.entry();
    let footprint = footprint_bytes(entry, input.context_tokens);
    // Speed uses the ACTIVE weights; the footprint uses the total. Getting
    // these two the wrong way round is the mistake the separate types prevent.
    let active_bytes = active_weight_bytes(entry);
    // A token's traffic is the weights it reads plus the cache, which is
    // re-read every token — charged here where the context is known.
    // Attention may read the cache more than once; the pessimistic end of
    // the band absorbs that slop. A mixture reads roughly
    // MOE_TRAFFIC_CORRECTION times its active-byte share (measured — see
    // the constant); a dense row reads its weights once, and the five dense
    // calibration points fit without any correction.
    //
    // KNOWN DEBT, now quantified. The correction below is one machine's
    // mean over four models, three of which agree; Trinity-Nano reads 3.58x
    // its active bytes and nobody knows why, so it stays an outlier instead
    // of being averaged in to hide. A row's own `measured_decode` still
    // replaces all of this where one exists.
    //
    // The correction is clamped at the whole file: a router can make a token
    // read more than its active share, but not more bytes than the model
    // has. Nothing on today's menu reaches that ceiling — the widest share is
    // Phi-mini-MoE's 2.4 of 7.6 billion, and 0.32 x 2.06 is 0.65 of the file
    // — so the clamp is a bound on the correction rather than a working part
    // of it. It stays because 2.06 is one machine's mean over four models,
    // not a law: a row whose active share went above 1/2.06 would otherwise
    // be charged for weights that do not exist, and the closer to dense it
    // sat the worse that lie would get. The Gemma 4 "E" shapes look like
    // that case and are not — the manifest calls them dense, so they take
    // the branch below and never meet this one.
    let weights_traffic = if entry.parameters.is_mixture() {
        ((active_bytes as f64 * MOE_TRAFFIC_CORRECTION) as u64).min(entry.weights_bytes)
    } else {
        active_bytes
    };
    let traffic = weights_traffic.saturating_add(footprint.kv_bytes);
    let ends = decode_band(input.bandwidth_bytes_per_second);
    let decode = match entry.measured_decode {
        // A rate measured on the real path beats any prediction — but only
        // for a machine that decodes on the same path: the figure is a fact
        // about the machine it was measured on, and saying it elsewhere is
        // the number-without-a-path mistake all over again.
        Some(measured) if measured.backend == input.backend => Prediction::Measured {
            tokens_per_second: measured.tokens_per_second,
            machine: measured.measured_on,
        },
        _ => {
            let pessimistic = ends.and_then(|(low, _)| decode_tokens_per_second(&low, traffic));
            let optimistic = ends.and_then(|(_, high)| decode_tokens_per_second(&high, traffic));
            if input.bandwidth_is_lower_bound {
                // The bandwidth was measured on a slower path than the model
                // will run on, so the honest prediction is the pessimistic
                // end of the band: a floor, never a range the real path can
                // outrun.
                Prediction::Floor(pessimistic.unwrap_or(0.0))
            } else {
                Prediction::Range {
                    low: pessimistic.unwrap_or(0.0),
                    high: optimistic.unwrap_or(0.0),
                }
            }
        }
    };
    Candidate {
        entry,
        source,
        footprint,
        decode,
        // Prefill is an estimate, and says so: the compute probe counts the
        // weights' work and omits attention and routing, which grow with
        // context — so at long contexts this is not a lower bound, and it
        // does not print as one.
        prefill: Prediction::Estimate(
            prefill_tokens_per_second(
                input.compute_flops_per_second,
                entry.parameters.active().count(),
            )
            .unwrap_or(0.0),
        ),
    }
}

/// What a token actually reads: the active share of the same quantised weights.
fn active_weight_bytes(entry: &ModelEntry) -> u64 {
    let total = entry.parameters.total().count();
    let active = entry.parameters.active().count();
    if total == 0 {
        return entry.weights_bytes;
    }
    (entry.weights_bytes as u128 * active as u128 / total as u128) as u64
}

/// A mixture's per-token traffic, as a multiple of its active-byte share of
/// the file. Measured on ONE machine (Apple M1 Max, Metal, q8_0 KV, flash
/// attention, 2026-09-18) by inverting this crate's own decode model —
/// `seconds/token = 0.001504 + traffic / 183.46 GiB/s`, the five-point fit —
/// against four decoded MoEs:
///
/// | row | file | total/active | active-byte estimate | traffic that explains the rate | ratio |
/// |---|---|---|---|---|---|
/// | Qwen3.6-35B-A3B | 20.61 GiB | 35B/3B | 1.77 GiB | 3.80 GiB | 2.15x |
/// | gemma-4-26B-A4B | 12.67 GiB | 25.2B/3.8B | 1.91 GiB | 4.31 GiB | 2.26x |
/// | LFM2.5-8B-A1B | 4.27 GiB | 8.2B/1.5B | 0.78 GiB | 1.39 GiB | 1.78x |
/// | Trinity-Nano-Preview | 3.52 GiB | 6B/1B | 0.59 GiB | 2.10 GiB | 3.58x |
///
/// Three of the four agree closely; their mean is this constant. Trinity is
/// NOT averaged in: it reads 3.58x its active bytes, far outside the others,
/// and the reason is unexplained — the 2026-09-14 observation that
/// Trinity-class MoEs decode ~1.8x slower than a smaller, less-active LFM
/// saw the same shape from the other side. This is a correction measured on
/// one machine across four models, not a law. It applies to mixtures only: a
/// dense row reads its weights once, and the dense calibration fits without
/// a correction. A row's own `measured_decode` replaces the estimate where
/// one exists.
pub(crate) const MOE_TRAFFIC_CORRECTION: f64 = 2.06;

/// The decode prediction of the largest row that fits, improves on the phone,
/// and is nevertheless provably too slow — worth saying out loud instead of
/// hiding behind a smaller recommendation. Only a range can be called slower
/// than reading: a floor below the line is unknown, not slow, and its row may
/// well be offered to be measured.
pub(crate) fn too_slow_to_use(
    input: &ChoiceInput,
    budget: &MemoryBudget,
    chosen: &Candidate<'_>,
) -> Option<Prediction> {
    manifest::usable()
        .map(|entry| candidate(entry, input))
        .filter(|candidate| candidate.footprint.total_bytes() <= budget.usable_bytes)
        .filter(|candidate| matches!(candidate.decode, Prediction::Range { .. }))
        .filter(|candidate| candidate.decode.floor() < MINIMUM_TOKENS_PER_SECOND)
        .filter(|candidate| candidate.entry.weights_bytes > chosen.entry.weights_bytes)
        .map(|candidate| candidate.decode)
        .max_by(|a, b| {
            a.ceiling()
                .partial_cmp(&b.ceiling())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::footprint::GIB;

    fn entry(weights_gib: f64, total: u64, active: u64) -> ModelEntry {
        ModelEntry {
            repo: "test/row",
            display_name: "Test Row",
            last_modified: "2026-01-01",
            licence: crate::licence::Licence::Open("apache-2.0"),
            parameters: if active == total {
                crate::parameters::Parameters::dense(total)
            } else {
                crate::parameters::Parameters::mixture(total, active)
            },
            quant: "Q4_K_M",
            weights_bytes: (weights_gib * GIB as f64) as u64,
            mmproj_bytes: None,
            kv_bytes_per_token: None,
            kv_assumption_undercounts: false,
            dense_equivalent: None,
            measured_decode: None,
            // The fixture's limit is the memory's, so the trained cap never binds.
            trained_context_tokens: None,
            stale: None,
        }
    }

    /// The two axes are one keystroke apart in a message, so the risk is real:
    /// same total weights, a quarter of them active, same file.
    #[test]
    fn footprint_follows_the_total_and_speed_follows_the_active() {
        // The fixture's active share is a realistic one. Under the measured
        // mixture correction (2.06x the active share), a quarter-active
        // mixture reads about half its file and decodes about twice as fast
        // as the dense read of the same bytes; the old 50%-share fixture
        // would now read its whole file and win nothing, which is what the
        // measurement says.
        let dense = entry(8.0, 16_000_000_000, 16_000_000_000);
        let mixture = entry(8.0, 16_000_000_000, 4_000_000_000);
        let input = ChoiceInput {
            backend: kalsa_probe::Backend::Cpu,
            ram_bytes: 64 * GIB,
            bandwidth_bytes_per_second: 80.0e9,
            bandwidth_is_lower_bound: false,
            compute_flops_per_second: 100.0e9,
            context_tokens: 8192,
            phone: None,
        };
        let dense_candidate = candidate(UsableEntry::for_test(&dense), &input);
        let mixture_candidate = candidate(UsableEntry::for_test(&mixture), &input);

        assert_eq!(
            dense_candidate.footprint, mixture_candidate.footprint,
            "the same weights occupy the same memory"
        );
        // The cache is charged to both, and the correction compresses the
        // raw 4x of the share to under twice — but the advantage must stay
        // substantial, or speed would not follow the active axis at all.
        // Swapping the axes makes the mixture read like the dense file and
        // this ratio fall to 1, which is the mistake this catches.
        assert!(
            mixture_candidate.decode_ceiling() > dense_candidate.decode_ceiling() * 1.5,
            "a quarter-active mixture must still decode meaningfully faster"
        );
        // Prefill is compute-bound and follows the ACTIVE parameters too.
        // Had it used the total ones, these two would be equal — that is the
        // swap this assertion catches.
        assert!(
            mixture_candidate.prefill.ceiling() > dense_candidate.prefill.ceiling() * 1.9,
            "a quarter of the active parameters must prefill about four times as fast"
        );
    }

    #[test]
    fn a_lower_bound_measurement_predicts_a_floor_and_a_direct_one_a_range() {
        // The path fact travels with the figure: a CPU-path bandwidth on a
        // machine that will decode on Metal is a floor, and the type says so
        // instead of printing a range the real path can outrun.
        let dense = entry(8.0, 8_000_000_000, 8_000_000_000);
        let mac = ChoiceInput {
            backend: kalsa_probe::Backend::Metal,
            bandwidth_is_lower_bound: true,
            ..input_for()
        };
        assert!(matches!(
            candidate(UsableEntry::for_test(&dense), &mac).decode,
            Prediction::Floor(_)
        ));
        let direct = ChoiceInput {
            bandwidth_is_lower_bound: false,
            ..mac
        };
        assert!(matches!(
            candidate(UsableEntry::for_test(&dense), &direct).decode,
            Prediction::Range { .. }
        ));
    }

    #[test]
    fn decode_depends_on_the_cache_it_decodes_against() {
        // The cache is re-read every token: at 256k the assumed cache alone
        // is 24 GiB, and a figure that ignored it would print the same speed
        // at 8k and 256k while the cache grew past the weights.
        let dense = entry(8.0, 8_000_000_000, 8_000_000_000);
        let small = ChoiceInput {
            context_tokens: 8192,
            ..input_for()
        };
        let large = ChoiceInput {
            context_tokens: 262_144,
            ..small
        };
        let at_8k = candidate(UsableEntry::for_test(&dense), &small);
        let at_256k = candidate(UsableEntry::for_test(&dense), &large);
        assert!(
            at_256k.decode.floor() < at_8k.decode.floor(),
            "the cache dominates at long context: {}/{}, got {} vs {}",
            at_8k.decode.floor(),
            at_256k.decode.floor(),
            at_8k.decode.floor(),
            at_256k.decode.floor()
        );
        // And prefill is an estimate, never printed as a floor.
        assert!(matches!(at_8k.prefill, Prediction::Estimate(_)));
    }

    /// A direct-measurement input, so the path tests read as one line each.
    fn input_for() -> ChoiceInput {
        ChoiceInput {
            backend: kalsa_probe::Backend::Cpu,
            ram_bytes: 64 * GIB,
            bandwidth_bytes_per_second: 80.0e9,
            bandwidth_is_lower_bound: false,
            compute_flops_per_second: 100.0e9,
            context_tokens: 8192,
            phone: None,
        }
    }

    #[test]
    fn a_mixture_active_share_is_proportional_to_its_parameters() {
        // 19 GiB of weights, 3B of 35B read per token: about 1.6 GiB a token.
        let moe = entry(19.0, 35_000_000_000, 3_000_000_000);
        let share = active_weight_bytes(&moe) as f64 / GIB as f64;
        assert!((share - 19.0 * 3.0 / 35.0).abs() < 0.01, "got {share}");
    }

    #[test]
    fn the_measured_moe_correction_lands_near_the_measured_rates() {
        // 2026-09-18, the M1 Max: Qwen3.6-35B-A3B decoded at ~45 tok/s,
        // gemma-4-26B-A4B a little below it (~40), LFM2.5-8B-A1B at ~110.
        // Priced at one token of cache so the KV term cannot muddy the
        // comparison. The "near" comparison runs against the calibrated
        // model — the fixed prior plus the full fitted bandwidth, the same
        // terms the 2.06x was inverted from. Tolerance is 15%: the
        // correction's own per-model ratios run 1.78x to 2.26x, so a tighter
        // band would claim a precision one machine did not measure.
        let cases = [
            (20.614, 35_000_000_000, 3_000_000_000, 45.0, "Qwen3.6-35B-A3B"),
            (12.67, 25_200_000_000, 3_800_000_000, 40.0, "gemma-4-26B-A4B"),
            (4.27, 8_200_000_000, 1_500_000_000, 110.0, "LFM2.5-8B-A1B"),
        ];
        for (weights_gib, total, active, measured, name) in cases {
            let mixture = entry(weights_gib, total, active);
            let input = ChoiceInput {
                context_tokens: 1,
                bandwidth_bytes_per_second: 183.46 * GIB as f64,
                ..input_for()
            };
            let predicted = candidate(UsableEntry::for_test(&mixture), &input);
            let Prediction::Range { low, high } = predicted.decode else {
                panic!("{name}: a CPU-path measurement predicts a range");
            };
            // The band the product ships brackets what was measured.
            assert!(
                low < measured && measured < high,
                "{name}: the band {low:.1}..{high:.1} must bracket {measured}"
            );
            // And the calibrated point lands near it.
            let traffic_bytes = (active_weight_bytes(&mixture) as f64 * MOE_TRAFFIC_CORRECTION)
                as u64
                + 96 * 1024;
            let point = 1.0 / (kalsa_probe::FIXED_SECONDS_PRIOR + traffic_bytes as f64 / (183.46 * GIB as f64));
            assert!(
                (point - measured).abs() < measured * 0.15,
                "{name}: corrected prediction {point:.1} tok/s against a measured {measured}"
            );
        }
    }
}
