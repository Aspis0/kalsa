//! A catalog row turned into a prediction for one machine: what it occupies,
//! how fast a token comes out, how fast prompts go in.
//!
//! The two axes are easy to swap and fatal to swap: the footprint uses the
//! TOTAL weights, the speed the ACTIVE ones. Keeping the construction in one
//! place is what makes swapping them twice impossible.

use kalsa_probe::{decode_tokens_per_second, prefill_tokens_per_second, DECODE_EFFICIENCY_BAND};

use crate::choice::{ChoiceInput, MINIMUM_TOKENS_PER_SECOND};
use crate::footprint::{footprint_bytes, Footprint, MemoryBudget};
use crate::manifest::{self, ModelEntry, UsableEntry};

/// A predicted figure, with its shape carried in the type. The shape is
/// decided where the prediction is made, which is why the formatter has no
/// equal-ends case to guard and no wrong call to make: it renders whichever
/// shape it is handed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Prediction {
    /// Decode, from a bandwidth measured on the path the model will run on:
    /// the same traffic read at two efficiencies, so both ends are known.
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

pub(crate) fn candidate<'a>(entry: UsableEntry<'a>, input: &ChoiceInput) -> Candidate<'a> {
    let entry = entry.entry();
    let footprint = footprint_bytes(entry, input.context_tokens);
    // Speed uses the ACTIVE weights; the footprint uses the total. Getting
    // these two the wrong way round is the mistake the separate types prevent.
    let active_bytes = active_weight_bytes(entry);
    // A token's traffic is the active weights plus the cache, which is
    // re-read every token — the omission kalsa-probe documents, charged here
    // where the context is known. Attention may read the cache more than
    // once; the efficiency band absorbs that slop.
    //
    // KNOWN DEBT, measured 2026-09-14 on the M1 Max (Metal, q8_0 KV, flash-
    // attention, all layers on GPU, context 4096): Trinity-Nano-Preview
    // (MoE, 6B total / 1B active, 3.79 GB file) decoded at 62.7 tok/s, while
    // LFM2.5-8B-A1B (MoE, 8.2B total / 1.5B active, 4.59 GB file) decoded at
    // 107-114 tok/s. The smaller, less-active model is ~1.8x SLOWER: real
    // per-token traffic does not follow the active bytes this model charges
    // (for Trinity-class MoEs llama.cpp reads far more than the routed
    // experts). Until the traffic model is rebuilt from per-row measurement,
    // every decode figure here is a probe-side guess that a measured decode
    // (`ModelEntry::measured_decode`) corrects.
    let traffic = active_bytes.saturating_add(footprint.kv_bytes);
    let decode = |efficiency| {
        decode_tokens_per_second(input.bandwidth_bytes_per_second, traffic, efficiency)
    };
    let (low_efficiency, high_efficiency) = DECODE_EFFICIENCY_BAND;
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
            if input.bandwidth_is_lower_bound {
                // The bandwidth was measured on a slower path than the model
                // will run on, so the honest prediction is the pessimistic
                // end of the band: a floor, never a range the real path can
                // outrun.
                Prediction::Floor(decode(low_efficiency).unwrap_or(0.0))
            } else {
                Prediction::Range {
                    low: decode(low_efficiency).unwrap_or(0.0),
                    high: decode(high_efficiency).unwrap_or(0.0),
                }
            }
        }
    };
    Candidate {
        entry,
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
            source: None,
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
            stale: None,
        }
    }

    /// The two axes are one keystroke apart in a message, so the risk is real:
    /// same total weights, half the active ones, same footprint, twice the speed.
    #[test]
    fn footprint_follows_the_total_and_speed_follows_the_active() {
        let dense = entry(8.0, 16_000_000_000, 16_000_000_000);
        let mixture = entry(8.0, 16_000_000_000, 8_000_000_000);
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
        // The cache is charged to both, so half the active weights no longer
        // decode twice as fast at this context — 1.84× here — but the
        // advantage must stay substantial, or speed would not follow the
        // active axis at all.
        assert!(
            mixture_candidate.decode_ceiling() > dense_candidate.decode_ceiling() * 1.5,
            "half the active weights must still decode meaningfully faster"
        );
        // Prefill is compute-bound and follows the ACTIVE parameters too. Had it
        // used the total ones, these two would be equal — that is the swap this
        // assertion catches.
        assert!(
            mixture_candidate.prefill.ceiling() > dense_candidate.prefill.ceiling() * 1.9,
            "half the active parameters must prefill about twice as fast"
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
}
