//! The owner's quant rule: which file a row is served as, on this machine.
//!
//! One decision, made once per row before the chooser's gates run their
//! course: at or above [`Q8_MIN_BANDWIDTH_BYTES_PER_SECOND`] a row that
//! carries a Q8_0 variant is served as that variant — but only when the
//! variant's own candidate clears every gate the row's own file faces below
//! (fit, the reading floor, the roomy-machine rule, the row's dense line).
//! Anything less and the row keeps its own file, unchanged: the swap is all
//! or nothing, so a machine never loses a row it would have run by trying
//! to upgrade it. The dense line is asked here unconditionally while
//! `runnable_on` asks it only once some row clears one — the safe side:
//! a variant held back here can still run as its row's own file.

use crate::candidate::{candidate, Candidate};
use crate::choice::{
    dense_speed_floor, full_precision_file, provably_too_slow, ChoiceInput, ROOMY_RAM_BYTES,
};
use crate::footprint::{fits_footprint, memory_budget, MemoryBudget};
use crate::manifest::{self, ModelEntry, UsableEntry};

/// The bandwidth at or above which a row that carries a Q8_0 file is served
/// as Q8_0 instead of its smaller compression — the owner's rule of
/// 2026-09-29, set at the M1 Pro's published 200 GB/s so the bigger file
/// goes to the machines whose memory bus can carry it. The figure compared
/// is the bandwidth the chooser is given (`ChoiceInput::bandwidth_bytes_per_second`).
pub(crate) const Q8_MIN_BANDWIDTH_BYTES_PER_SECOND: f64 = 200.0e9;

/// Whether a candidate clears, on its own numbers, the gates the chooser
/// applies below — the same predicates `runnable_on` applies to every
/// candidate, asked here so the swap either happens whole or not at all.
fn clears_the_gates(candidate: &Candidate, input: &ChoiceInput, budget: &MemoryBudget) -> bool {
    fits_footprint(candidate.entry, &candidate.footprint, budget)
        && !provably_too_slow(&candidate.decode)
        && dense_speed_floor(candidate.entry).is_none_or(|line| candidate.decode.floor() >= line)
        && !(full_precision_file(candidate.entry) && input.ram_bytes < ROOMY_RAM_BYTES)
}

/// The entry a row serves: its own, or the variant when the band gate is
/// cleared and the variant's own candidate clears the gates below. The one
/// decision both windows share, so they cannot drift.
fn served_entry<'a>(
    row: UsableEntry<'a>,
    variant: Option<UsableEntry<'a>>,
    input: &ChoiceInput,
) -> UsableEntry<'a> {
    let budget = memory_budget(input.backend, input.ram_bytes);
    match variant {
        Some(variant)
            if input.bandwidth_bytes_per_second >= Q8_MIN_BANDWIDTH_BYTES_PER_SECOND
                && clears_the_gates(&candidate(variant, input), input, &budget) =>
        {
            variant
        }
        _ => row,
    }
}

/// The chooser's candidates over any pairing: one per row, served as the
/// one decision decides, each returned beside its owning row's entry —
/// paired by structure where the table nests it.
pub(crate) fn resolved_in<'a>(
    pairs: impl Iterator<Item = (UsableEntry<'a>, Option<UsableEntry<'a>>)>,
    input: &ChoiceInput,
) -> Vec<(&'a ModelEntry, Candidate<'a>)> {
    pairs
        .map(|(row, variant)| {
            let served = served_entry(row, variant, input);
            (row.entry(), candidate(served, input))
        })
        .collect()
}

/// The chooser's candidates, one per row, served as the rule decides.
pub(crate) fn resolved(input: &ChoiceInput) -> Vec<(&'static ModelEntry, Candidate<'static>)> {
    resolved_in(manifest::usable_with_q8(), input)
}

/// The menu as the chooser serves it on this machine: one entry per row —
/// the Q8 file where the rule serves it, the row's own file everywhere
/// else. The listing surfaces read this, so their lines cannot disagree
/// with the pick.
pub fn served(input: &ChoiceInput) -> Vec<UsableEntry<'static>> {
    manifest::usable_with_q8()
        .map(|(row, variant)| served_entry(row, variant, input))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::choice::largest_that_runs_well;
    use crate::footprint::GIB;
    use crate::manifest::{usable_with_q8_in, DownloadableEntry, GgufSource, Q8Variant, Sampling};
    use crate::parameters::Parameters;
    use crate::Prediction;
    use kalsa_probe::Backend;

    /// A Mac: unified memory, the stated bandwidth, the chooser's window.
    fn mac(ram_gib: u64, bandwidth_gbps: f64) -> ChoiceInput {
        ChoiceInput {
            backend: Backend::Metal,
            ram_bytes: ram_gib * GIB,
            bandwidth_bytes_per_second: bandwidth_gbps * 1e9,
            bandwidth_is_lower_bound: false,
            compute_flops_per_second: 100.0e9,
            context_tokens: crate::choice::CHOOSER_CONTEXT_TOKENS,
            phone: None,
        }
    }

    /// Every row's candidate after the rule has had its say.
    fn resolved(input: &ChoiceInput) -> Vec<Candidate<'static>> {
        super::resolved(input)
            .into_iter()
            .map(|(_, candidate)| candidate)
            .collect()
    }

    /// The one candidate the rule leaves for Gemma 4 12B — one file or the
    /// other, never both.
    fn the_twelve_b<'a>(candidates: &'a [Candidate<'static>]) -> &'a Candidate<'static> {
        let found: Vec<&Candidate> = candidates
            .iter()
            .filter(|candidate| candidate.entry.repo == "google/gemma-4-12B-it")
            .collect();
        assert_eq!(
            found.len(),
            1,
            "the row answers once, one file or the other: {}",
            found.len()
        );
        found[0]
    }

    #[test]
    fn a_hundred_gb_s_mac_keeps_q4_and_gains_the_drafter() {
        // 16 GiB / 100 GB/s: under the Q8 line, so the row is the Q4 file it
        // always was — and the drafter rides either way, charged to the fit.
        let candidates = resolved(&mac(16, 100.0));
        let twelve_b = the_twelve_b(&candidates);
        assert_eq!(twelve_b.entry.quant, "Q4_K_M");
        let drafter = twelve_b.drafter.expect("the row ships a drafter");
        assert_eq!(drafter.file, "mtp-gemma-4-12B-it-Q8_0.gguf");
        assert_eq!(drafter.bytes, 465_109_152);
        assert_eq!(twelve_b.footprint.drafter_bytes, 465_109_152);
    }

    #[test]
    fn a_four_hundred_gb_s_mac_with_room_is_served_q8() {
        // 64 GiB / 400 GB/s: over the line, and the Q8 candidate clears fit,
        // the reading floor and its line many times over — so the variant
        // took the row, with its own pin and its own measured rate.
        let candidates = resolved(&mac(64, 400.0));
        let twelve_b = the_twelve_b(&candidates);
        assert_eq!(twelve_b.entry.quant, "Q8_0");
        assert_eq!(twelve_b.source.file, "gemma-4-12B-it-Q8_0.gguf");
        assert_eq!(twelve_b.source.bytes, 12_669_647_328);
        assert!(twelve_b.drafter.is_some(), "the drafter rides the variant");
        // In the measurement's band the prediction is the Q8 anchor, not the
        // row's Q4 rate riding the bigger file's name.
        match twelve_b.decode {
            Prediction::Measured {
                tokens_per_second, ..
            } => assert!(
                (tokens_per_second - 19.81).abs() < 1e-9,
                "{tokens_per_second}"
            ),
            other => panic!("in band, the Q8 anchor is the answer: {other:?}"),
        }
    }

    #[test]
    fn the_served_q8_prediction_never_exceeds_the_q4_one() {
        // The two anchors are one build's ratio apart (23.90/24.66), scaled
        // onto the row's own anchor — so on the machine both describe, the
        // file the rule serves must never read faster than the one it
        // replaces. 19.81 against 20.44 at 400 GB/s.
        let input = mac(64, 400.0);
        let (row, variant) = manifest::usable_with_q8()
            .find(|(row, _)| row.entry().repo == "google/gemma-4-12B-it")
            .expect("the row with a variant");
        let (_, served) = resolved_in(std::iter::once((row, variant)), &input)
            .pop()
            .expect("the pairing answers once");
        assert_eq!(served.entry.quant, "Q8_0", "the premise: Q8 is served here");
        let q4 = candidate(row, &input);
        assert!(
            served.decode.floor() <= q4.decode.floor(),
            "Q8 at {:.2} must not outrun Q4 at {:.2}",
            served.decode.floor(),
            q4.decode.floor()
        );
    }

    #[test]
    fn exactly_at_the_line_q8_takes_the_row_where_it_clears_the_gates() {
        // 32 GiB / 200 GB/s — exactly at the line. The arithmetic the swap
        // rests on: 12_669_647_328 of Q8 weights + 465_109_152 of drafter +
        // 536_870_912 of compute buffers + 65_536 tokens at the row's
        // measured 8_704 bytes = 570_425_344; the total 14_242_052_736 sits
        // well inside the 24 GiB budget's 25_769_803_776, and the Q8 floor
        // (10.4 tok/s) clears the row's small-dense line of 10 — so the
        // variant takes the row here too.
        let machine = mac(32, 200.0);
        let candidates = resolved(&machine);
        assert_eq!(the_twelve_b(&candidates).entry.quant, "Q8_0");
        let budget = memory_budget(machine.backend, machine.ram_bytes);
        let twelve_b = the_twelve_b(&candidates);
        assert_eq!(twelve_b.footprint.total_bytes(), 14_242_052_736);
        assert!(twelve_b.footprint.total_bytes() <= budget.usable_bytes);
    }

    #[test]
    fn a_hundred_and_ninety_nine_gb_s_mac_stays_on_q4() {
        // One GB/s under the line: the bigger file is not the row's answer,
        // however much room the machine has.
        let candidates = resolved(&mac(64, 199.0));
        assert_eq!(the_twelve_b(&candidates).entry.quant, "Q4_K_M");
    }

    #[test]
    fn the_q8_file_does_not_take_the_row_where_it_does_not_fit() {
        // 16 GiB / 400 GB/s: over the line, but the Q8 weights, the drafter
        // and the row's accounting need 13.3 GiB against the 12 GiB budget —
        // so the rule leaves the row exactly as it was.
        let candidates = resolved(&mac(16, 400.0));
        assert_eq!(the_twelve_b(&candidates).entry.quant, "Q4_K_M");
    }

    #[test]
    fn q8_never_takes_a_row_it_cannot_drive() {
        // The speed half of the rule, on a row this test writes: over the
        // line, with room to spare, and the variant's own prediction sits
        // under the row's small-dense line while the row's own file clears
        // it. The row keeps the file that clears — the swap is all or
        // nothing.
        let model = |quant: &'static str, weights: u64| crate::manifest::ModelEntry {
            repo: "test/q8-gated",
            display_name: "Test Q8 Gated",
            last_modified: "2026-01-01",
            licence: crate::licence::Licence::Open("apache-2.0"),
            parameters: Parameters::dense(12_000_000_000),
            quant,
            weights_bytes: weights,
            kv_bytes_per_token: Some(8_704),
            slot_cache: crate::manifest::SlotCache::None,
            dense_equivalent: None,
            kv_assumption_undercounts: false,
            measured_decode: None,
            trained_context_tokens: Some(131_072),
            stale: None,
            sampling: Sampling::default(),
        };
        let source = |bytes: u64| GgufSource {
            repo: "test/only",
            commit: "0000000000000000000000000000000000000000",
            file: "test.gguf",
            bytes,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        };
        let table = [DownloadableEntry {
            model: model("Q4_K_M", 8 * GIB),
            source: source(8 * GIB),
            drafter: None,
            mmproj: None,
            q8: Some(Q8Variant {
                model: model("Q8_0", 16 * GIB),
                source: source(16 * GIB),
            }),
        }];
        let input = mac(64, 210.0);
        let budget = memory_budget(input.backend, input.ram_bytes);
        let (row, variant) = usable_with_q8_in(&table)
            .next()
            .expect("the row passes the gates");
        let variant = variant.expect("the variant passes the gates");
        let q4 = candidate(row, &input);
        let q8 = candidate(variant, &input);
        assert!(
            q4.decode.floor() >= 10.0,
            "the premise: the row's own file clears its line, {:?}",
            q4.decode.floor()
        );
        assert!(
            q8.decode.floor() < 10.0 && q8.decode.floor() >= 3.0,
            "the premise: the variant fails the line, not the reading floor, {:?}",
            q8.decode.floor()
        );
        assert!(
            fits_footprint(q8.entry, &q8.footprint, &budget),
            "the premise: memory is not what stops this variant"
        );
        let served = resolved_in(usable_with_q8_in(&table), &input)
            .pop()
            .map(|(_, served)| served)
            .expect("the pairing answers once");
        assert_eq!(served.entry.quant, "Q4_K_M");
    }

    #[test]
    fn a_row_without_a_drafter_carries_none_through_the_whole_plan() {
        // Every other row runs alone: no placeholder drafter in any
        // candidate, whatever the rule does to the Gemma rows beside them.
        let candidates = resolved(&mac(64, 400.0));
        let alone: Vec<&Candidate> = candidates
            .iter()
            .filter(|candidate| {
                candidate.entry.repo != "google/gemma-4-12B-it"
                    && candidate.entry.repo != "google/gemma-4-E4B-it"
            })
            .collect();
        assert!(
            !alone.is_empty(),
            "rows that run alone are still the menu's majority"
        );
        for other in alone {
            assert!(other.drafter.is_none(), "{}", other.entry.repo);
        }
        // And the plan itself, end to end through the public walk: the
        // 18 GiB Mac at 400 GB/s is where the Q8 row leads, so its plan is
        // the one place the drafter's fetch line and the one total can be
        // pinned as a pick would carry them.
        let pick = largest_that_runs_well(&mac(18, 400.0)).expect("an 18 GiB Mac runs the Q8 row");
        assert_eq!(pick.entry.repo, "google/gemma-4-12B-it");
        assert_eq!(pick.entry.quant, "Q8_0");
        let drafter = pick
            .download
            .drafter
            .as_ref()
            .expect("the plan fetches the drafter");
        assert!(
            drafter.url.ends_with("/mtp-gemma-4-12B-it-Q8_0.gguf"),
            "{}",
            drafter.url
        );
        assert_eq!(drafter.bytes, 465_109_152);
        assert_eq!(pick.download.total_bytes(), 12_669_647_328 + 465_109_152);
        // A pick without a drafter plans only its own file.
        let lfm_pick = largest_that_runs_well(&ChoiceInput {
            bandwidth_bytes_per_second: 85.0e9,
            ..mac(8, 85.0)
        })
        .expect("the 8 GiB tier runs the LFM file");
        assert_eq!(lfm_pick.entry.repo, "LiquidAI/LFM2.5-2.6B");
        assert!(lfm_pick.download.drafter.is_none());
        assert_eq!(lfm_pick.download.total_bytes(), lfm_pick.download.bytes);
    }

    #[test]
    fn the_two_windows_serve_the_same_file_for_every_row() {
        // `served` and `resolved` are two windows onto one decision: if they
        // drifted, the listing would show a file the chooser never picks.
        // Both walk the pairing in table order, so the vectors align.
        for machine in [mac(16, 100.0), mac(24, 200.0), mac(64, 400.0)] {
            let entries: Vec<(&str, &str, u64)> = served(&machine)
                .iter()
                .map(|entry| {
                    (
                        entry.entry().repo,
                        entry.entry().quant,
                        entry.entry().weights_bytes,
                    )
                })
                .collect();
            let candidates: Vec<(&str, &str, u64)> = super::resolved(&machine)
                .iter()
                .map(|(_, candidate)| {
                    (
                        candidate.entry.repo,
                        candidate.entry.quant,
                        candidate.entry.weights_bytes,
                    )
                })
                .collect();
            assert_eq!(
                entries,
                candidates,
                "the windows disagree at {:.0} GB/s",
                machine.bandwidth_bytes_per_second / 1e9
            );
        }
    }
}
