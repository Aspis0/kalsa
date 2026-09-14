//! The decision table: every RAM tier, with and without the phone, the GPU
//! budget branches, the two justifications, and the refusals. The "no candidate,
//! and we say so" case is tested like any other — it is the answer nobody
//! remembers to prove.

use kalsa_catalog::{
    choose, footprint_bytes, usable_bytes, Backend, ChoiceInput, Decision, Justification,
    PhoneModel, RefusalReason, GIB, IMPROVEMENT_RATIO,
};

/// The default phone model, as the pairing handshake reports it.
const PHONE_BYTES: u64 = 2_834_975_040;

fn phone(on_battery: Option<bool>) -> PhoneModel {
    PhoneModel {
        weights_bytes: PHONE_BYTES,
        measured_tokens_per_second: Some(9.0),
        on_battery,
    }
}

/// Numbers from the probe on the development machine, so the arithmetic in the
/// expectations is the arithmetic the product would do.
fn input(ram_gib: u64, phone_known: bool) -> ChoiceInput {
    ChoiceInput {
        backend: Backend::Cpu,
        ram_bytes: ram_gib * GIB,
        bandwidth_bytes_per_second: 85.0e9,
        compute_flops_per_second: 100.0e9,
        context_tokens: 8192,
        phone: phone_known.then_some(phone(Some(true))),
    }
}

fn input_with_phone(ram_gib: u64, on_battery: Option<bool>) -> ChoiceInput {
    ChoiceInput {
        phone: Some(phone(on_battery)),
        ..input(ram_gib, true)
    }
}

/// A PC: the RAM is the same, but a model that will decode on the card is
/// budgeted by the card, not by the machine.
fn pc(ram_gib: u64, vram_gib: Option<u64>) -> ChoiceInput {
    ChoiceInput {
        backend: Backend::DiscreteGpu {
            vram_bytes: vram_gib.map(|gib| gib * GIB),
        },
        ..input(ram_gib, true)
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
fn eight_gigabytes_is_offered_for_relief_and_not_capability() {
    // The premise: nothing that fits clears the improvement bar — the bar sits
    // above the phone's own class on purpose — so this tier cannot be sold as
    // an upgrade.
    let usable = usable_bytes(8 * GIB);
    for entry in kalsa_catalog::usable() {
        let entry = entry.entry();
        if footprint_bytes(entry, 8192).total_bytes() <= usable {
            assert!(
                (entry.weights_bytes as f64) < PHONE_BYTES as f64 * IMPROVEMENT_RATIO,
                "{} must be under the capability bar on this tier",
                entry.repo
            );
        }
    }

    // But every token the PC generates is one the phone did not, so the
    // recommendation comes through the relief axis, and says so.
    match choose(&input(8, true)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.justification, Justification::Relief);
            assert_eq!(selection.repo, "arcee-ai/Trinity-Nano-Preview");
            assert!(selection.rationale.contains("relief"), "{}", selection.rationale);
            assert!(
                !selection.rationale.contains("on capability"),
                "a lateral move must not be sold as an upgrade: {}",
                selection.rationale
            );
            assert_eq!(selection.budget.usable_bytes, usable);
        }
        other => panic!("expected a relief pick, got {other:?}"),
    }
}

#[test]
fn a_phone_on_a_charger_is_not_offered_relief() {
    let (reason, explanation) = refusal(&input_with_phone(8, Some(false)));
    assert_eq!(reason, RefusalReason::NothingBetter);
    assert!(explanation.contains("charger"), "{explanation}");

    // And when the phone has not said, relief is not invented for it.
    let (reason, explanation) = refusal(&input_with_phone(8, None));
    assert_eq!(reason, RefusalReason::NothingBetter);
    assert!(explanation.contains("has not said"), "{explanation}");
}

#[test]
fn capability_does_not_need_the_battery() {
    // Relief is the only battery-dependent axis. A genuine step up in model
    // class is offered to a phone on a charger all the same.
    match choose(&input_with_phone(16, Some(false))) {
        Decision::Pick(selection) => {
            assert_eq!(selection.justification, Justification::Capability);
            assert_eq!(selection.repo, "google/gemma-4-12B-it");
        }
        other => panic!("expected a capability pick, got {other:?}"),
    }
}

#[test]
fn a_small_card_is_not_bypassed_by_the_system_ram() {
    // 32 GiB of RAM would fit the 35B MoE; the 6 GiB card gives a 3 GiB
    // budget, which fits nothing. The machine is refused — a model sized to
    // its RAM would spill across both memories, and the spill is a loss.
    let biggest_on_ram = kalsa_catalog::CATALOG
        .iter()
        .find(|entry| entry.repo == "Qwen/Qwen3.6-35B-A3B")
        .expect("the 35B row exists");
    assert!(
        footprint_bytes(biggest_on_ram, 8192).total_bytes() <= usable_bytes(32 * GIB),
        "the RAM alone would have allowed the 35B row, which is what makes this test real"
    );
    let (reason, explanation) = refusal(&pc(32, Some(6)));
    assert_eq!(reason, RefusalReason::NothingFits);
    assert!(explanation.contains("GiB"), "{explanation}");
}

#[test]
fn a_model_that_would_spill_is_never_offered() {
    // The card holds 9 GiB; the RAM alone would hold the 35B MoE (20.5 GiB of
    // footprint). A model that only partially fits the card is not a candidate
    // for the GPU path, so the tier takes the largest model that fits it
    // entirely.
    let machine = pc(32, Some(12));
    match choose(&machine) {
        Decision::Pick(selection) => {
            assert_ne!(
                selection.repo, "Qwen/Qwen3.6-35B-A3B",
                "the 35B row does not fit the card and must not be offered"
            );
            assert_eq!(selection.repo, "google/gemma-4-12B-it");
            assert!(
                selection.footprint.total_bytes() <= selection.budget.usable_bytes,
                "the pick fits the chosen budget entirely"
            );
            assert!(selection.budget.gpu_accounted_for);
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn an_unreadable_card_falls_back_to_ram_and_says_so() {
    // Windows' 32-bit VRAM figure is the common case: fall back to the CPU
    // path's arithmetic, and say the GPU was not accounted for — never guess.
    match choose(&pc(32, None)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "Qwen/Qwen3.6-35B-A3B");
            assert!(!selection.budget.gpu_accounted_for);
            assert!(
                selection.rationale.contains("not accounted for"),
                "{}",
                selection.rationale
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn the_revenue_conditional_licence_is_visible_and_does_not_close_the_door() {
    let lfm = kalsa_catalog::CATALOG
        .iter()
        .find(|entry| entry.repo == "LiquidAI/LFM2.5-8B-A1B")
        .expect("the LFM row exists");
    match lfm.licence {
        kalsa_catalog::Licence::Conditional { id, condition } => {
            assert_eq!(id, "lfm1.0");
            assert!(
                condition.contains("$10M"),
                "the revenue condition travels with the row: {condition}"
            );
        }
        other => panic!("the LFM licence must be its own thing, got {other:?}"),
    }
    assert!(lfm.is_usable(), "a condition on the shipper is not a refusal");

    // Every selection carries its row's licence as data, so a conditional row
    // can never present itself as unconditional.
    match choose(&input(8, true)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.licence.id(), "openmdw-1.1");
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn a_phone_running_something_bigger_than_the_pc_gets_no_relief() {
    // Relief moves the work to a comparable model. If everything that fits is
    // smaller than what the phone already runs, the work would move to a
    // weaker model — a downgrade the user would feel, not relief.
    let mut big_phone = input(8, true);
    if let Some(p) = big_phone.phone.as_mut() {
        p.weights_bytes = 6 * GIB;
    }
    assert_eq!(refusal(&big_phone).0, RefusalReason::NothingBetter);
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
            assert_eq!(selection.justification, Justification::Capability);
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
