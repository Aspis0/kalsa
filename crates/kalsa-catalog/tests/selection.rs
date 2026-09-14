//! The decision table: every RAM tier, with and without the phone, plus the
//! refusals. The "no candidate, and we say so" case is tested like any other —
//! it is the answer nobody remembers to prove.

use kalsa_catalog::{
    choose, footprint_bytes, usable_bytes, ChoiceInput, Decision, PhoneModel, RefusalReason, GIB,
    IMPROVEMENT_RATIO,
};

/// The default phone model, as the pairing handshake reports it.
const PHONE_BYTES: u64 = 2_834_975_040;

/// Numbers from the probe on the development machine, so the arithmetic in the
/// expectations is the arithmetic the product would do.
fn input(ram_gib: u64, phone_known: bool) -> ChoiceInput {
    ChoiceInput {
        ram_bytes: ram_gib * GIB,
        bandwidth_bytes_per_second: 85.0e9,
        compute_flops_per_second: 100.0e9,
        context_tokens: 8192,
        phone: phone_known.then_some(PhoneModel {
            weights_bytes: PHONE_BYTES,
            measured_tokens_per_second: Some(9.0),
        }),
    }
}

fn chosen(input: &ChoiceInput) -> &'static str {
    match choose(input) {
        Decision::Pick(selection) => selection.repo,
        Decision::Refuse(refusal) => {
            panic!("refused: {:?} {}", refusal.reason, refusal.explanation)
        }
    }
}

fn refusal(input: &ChoiceInput) -> (RefusalReason, String) {
    match choose(input) {
        Decision::Pick(selection) => panic!("expected a refusal, chose {}", selection.repo),
        Decision::Refuse(refusal) => (refusal.reason, refusal.explanation),
    }
}

#[test]
fn eight_gigabytes_is_not_worth_it_even_though_models_fit() {
    // The honest case: rows fit this machine, and none of them is enough of a
    // step up from the phone to justify it.
    let (reason, explanation) = refusal(&input(8, true));
    assert_eq!(reason, RefusalReason::NothingBetter);
    assert!(explanation.contains("not worth using"), "{explanation}");
    assert!(explanation.contains("phone"), "{explanation}");

    // And prove it is not an accident of the filter: the rows that do fit are
    // all inside the improvement bar.
    let usable = usable_bytes(8 * GIB);
    let fitting: Vec<&str> = kalsa_catalog::usable()
        .map(|entry| entry.entry())
        .filter(|entry| footprint_bytes(entry, 8192).total_bytes() <= usable)
        .map(|entry| entry.repo)
        .collect();
    assert!(!fitting.is_empty(), "the 8 GiB tier is not empty of rows");
    for repo in fitting {
        let entry = kalsa_catalog::CATALOG
            .iter()
            .find(|entry| entry.repo == repo)
            .expect("row exists");
        assert!(
            (entry.weights_bytes as f64) < PHONE_BYTES as f64 * IMPROVEMENT_RATIO,
            "{repo} should be under the improvement bar"
        );
    }
}

#[test]
fn sixteen_gigabytes_takes_the_largest_dense_model_that_fits() {
    assert_eq!(chosen(&input(16, true)), "google/gemma-4-12B-it");
}

#[test]
fn thirty_two_gigabytes_prefers_the_mixture_that_decodes_faster() {
    // Both 32 GiB rows fit and are the same class, so the numbers decide:
    // Qwen3.6-35B-A3B reads 3.0B per token, llm-jp-4-32b-a3b-thinking 3.83B.
    let input = input(32, true);
    assert_eq!(chosen(&input), "Qwen/Qwen3.6-35B-A3B");
    match choose(&input) {
        Decision::Pick(selection) => {
            assert!(selection.decode.0 > 0.0 && selection.decode.1 > selection.decode.0);
            assert!(
                selection.decode.0 > 20.0,
                "3B active on 85 GB/s should be well above 20 tok/s, got {}",
                selection.decode.0
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn sixty_four_gigabytes_leaves_the_dense_70b_on_the_table_for_being_too_slow() {
    // It fits and it is the biggest row in the catalog — and at 40.7 GiB of
    // weights on 85 GB/s it would decode at about half a token per second. A
    // recommendation nobody can read at is not a recommendation, so the tier
    // takes the large MoE instead, and says why.
    let input = input(64, true);
    assert_eq!(chosen(&input), "Qwen/Qwen3.6-35B-A3B");
    match choose(&input) {
        Decision::Pick(selection) => {
            assert!(
                selection.rationale.contains("A bigger model fits"),
                "{}",
                selection.rationale
            );
            assert!(
                selection.rationale.contains("slower than reading"),
                "{}",
                selection.rationale
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn a_machine_too_small_says_so_without_inventing_a_candidate() {
    let (reason, explanation) = refusal(&input(4, true));
    assert_eq!(reason, RefusalReason::NothingFits);
    assert!(explanation.contains("not worth using"), "{explanation}");
    assert!(explanation.contains("GiB"), "{explanation}");
}

#[test]
fn without_the_phone_there_is_no_decision_to_make() {
    let (reason, explanation) = refusal(&input(32, false));
    assert_eq!(reason, RefusalReason::PhoneUnknown);
    assert!(explanation.contains("Pair the phone"), "{explanation}");
}

#[test]
fn the_research_only_row_is_never_chosen_even_when_it_would_win() {
    // On 16 GiB the refused Instella MoE (9.75 GiB, 16B/2.8B) would be a bigger
    // and faster pick than the chosen dense row: the gate is what stops it.
    let instella = kalsa_catalog::CATALOG
        .iter()
        .find(|entry| entry.repo.starts_with("amd/"))
        .expect("instella is in the catalog");
    assert!(
        footprint_bytes(instella, 8192).total_bytes() <= usable_bytes(16 * GIB),
        "the refused row does fit, which is what makes this test meaningful"
    );
    assert!(
        instella.weights_bytes > 7 * GIB,
        "and it is bigger than the chosen row"
    );
    assert_eq!(chosen(&input(16, true)), "google/gemma-4-12B-it");
    assert!(kalsa_catalog::excluded().any(|(entry, reason)| {
        entry.repo == instella.repo && reason.contains("research only")
    }));
}

#[test]
fn the_decision_says_why_with_a_range_and_the_phones_own_number() {
    match choose(&input(32, true)) {
        Decision::Pick(selection) => {
            let why = &selection.rationale;
            assert!(why.contains("Qwen/Qwen3.6-35B-A3B"), "{why}");
            assert!(why.contains("tokens per second"), "{why}");
            // A range, never a point estimate dressed up as data.
            assert!(why.contains('–'), "expected a range in: {why}");
            assert!(
                why.contains("9 tokens per second"),
                "phone number missing: {why}"
            );
            assert!(why.contains("mixture of experts"), "{why}");
            assert!(
                why.contains("not been measured"),
                "the assumed cache size must be admitted: {why}"
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn a_machine_the_probe_could_not_measure_is_not_guessed_at() {
    let mut unmeasured = input(32, true);
    unmeasured.bandwidth_bytes_per_second = 0.0;
    unmeasured.compute_flops_per_second = 0.0;
    let (reason, explanation) = refusal(&unmeasured);
    assert_eq!(reason, RefusalReason::MachineNotMeasured);
    assert!(explanation.contains("run the probe"), "{explanation}");

    // Half a measurement is not a measurement either.
    let mut half_measured = input(32, true);
    half_measured.compute_flops_per_second = 0.0;
    assert_eq!(refusal(&half_measured).0, RefusalReason::MachineNotMeasured);
}
