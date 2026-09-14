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

/// A predicted figure, with its shape carried in the type. Decode comes from
/// the same bandwidth read at two efficiencies, so it is a range; prefill
/// comes from the compute probe, which is a floor by construction — so it is
/// one number. The shape is decided where the prediction is made, which is
/// why the formatter has no equal-ends case to guard and no wrong call to
/// make: it renders whichever shape it is handed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Prediction {
    Range { low: f64, high: f64 },
    Floor(f64),
}

impl Prediction {
    /// The pessimistic end — the one that must clear the usability floor.
    pub fn floor(&self) -> f64 {
        match *self {
            Prediction::Range { low, .. } => low,
            Prediction::Floor(value) => value,
        }
    }

    /// The optimistic end — the one same-class candidates are ordered by.
    pub fn ceiling(&self) -> f64 {
        match *self {
            Prediction::Range { high, .. } => high,
            Prediction::Floor(value) => value,
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
    // Speed uses the ACTIVE weights; the footprint uses the total. Getting
    // these two the wrong way round is the mistake the separate types prevent.
    let active_bytes = active_weight_bytes(entry);
    let decode = |efficiency| {
        decode_tokens_per_second(input.bandwidth_bytes_per_second, active_bytes, efficiency)
    };
    let (low_efficiency, high_efficiency) = DECODE_EFFICIENCY_BAND;
    Candidate {
        entry,
        footprint: footprint_bytes(entry, input.context_tokens),
        decode: Prediction::Range {
            low: decode(low_efficiency).unwrap_or(0.0),
            high: decode(high_efficiency).unwrap_or(0.0),
        },
        // Prefill is a floor, not a range: the compute probe is a portable loop
        // and real kernels are faster. The meaning is "at least this much" —
        // never a band to multiply down.
        prefill: Prediction::Floor(
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
/// and is nevertheless too slow — worth saying out loud instead of hiding
/// behind a smaller recommendation.
pub(crate) fn too_slow_to_use(
    input: &ChoiceInput,
    budget: &MemoryBudget,
    chosen: &Candidate<'_>,
) -> Option<Prediction> {
    manifest::usable()
        .map(|entry| candidate(entry, input))
        .filter(|candidate| candidate.footprint.total_bytes() <= budget.usable_bytes)
        .filter(|candidate| candidate.decode.floor() < MINIMUM_TOKENS_PER_SECOND)
        .filter(|candidate| candidate.entry.weights_bytes > chosen.entry.weights_bytes)
        .map(|candidate| candidate.decode)
        .max_by(|a, b| a.ceiling().partial_cmp(&b.ceiling()).unwrap_or(std::cmp::Ordering::Equal))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::footprint::GIB;

    fn entry(weights_gib: f64, total: u64, active: u64) -> ModelEntry {
        ModelEntry {
            repo: "test/row",
            display_name: "Test Row",
            gguf_repo: None,
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
            dense_equivalent: None,
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
        assert!(
            mixture_candidate.decode_ceiling() > dense_candidate.decode_ceiling() * 1.9,
            "half the active weights must decode about twice as fast"
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
    fn a_mixture_active_share_is_proportional_to_its_parameters() {
        // 19 GiB of weights, 3B of 35B read per token: about 1.6 GiB a token.
        let moe = entry(19.0, 35_000_000_000, 3_000_000_000);
        let share = active_weight_bytes(&moe) as f64 / GIB as f64;
        assert!((share - 19.0 * 3.0 / 35.0).abs() < 0.01, "got {share}");
    }
}
