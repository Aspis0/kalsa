//! The decision table: every RAM tier, with and without the phone, the GPU
//! budget branches, the two justifications, and the refusals. The "no candidate,
//! and we say so" case is tested like any other — it is the answer nobody
//! remembers to prove.

use kalsa_catalog::{
    capability_basis, choose, footprint_bytes, usable_bytes, Backend, CapabilityBasis, ChoiceInput,
    Decision, Justification, Parameters, PhoneModel, Prediction, RefusalReason, DOWNLOADABLE, GIB,
};

/// The default phone model, as the pairing handshake reports it: a dense 4B
/// at 2.83 GB.
const PHONE_BYTES: u64 = 2_834_975_040;
const PHONE_PARAMS: Parameters = Parameters::dense(4_000_000_000);

fn phone(battery_powered: Option<bool>) -> PhoneModel {
    PhoneModel {
        weights_bytes: PHONE_BYTES,
        parameters: Some(PHONE_PARAMS),
        measured_tokens_per_second: Some(9.0),
        battery_powered,
    }
}

/// Numbers from the probe on the development machine, so the arithmetic in the
/// expectations is the arithmetic the product would do.
fn input(ram_gib: u64, phone_known: bool) -> ChoiceInput {
    ChoiceInput {
        backend: Backend::Cpu,
        ram_bytes: ram_gib * GIB,
        bandwidth_bytes_per_second: 85.0e9,
        bandwidth_is_lower_bound: false,
        compute_flops_per_second: 100.0e9,
        context_tokens: 8192,
        phone: phone_known.then_some(phone(Some(true))),
    }
}

fn input_with_phone(ram_gib: u64, battery_powered: Option<bool>) -> ChoiceInput {
    ChoiceInput {
        phone: Some(phone(battery_powered)),
        ..input(ram_gib, true)
    }
}

fn input_with_phone_model(ram_gib: u64, model: PhoneModel) -> ChoiceInput {
    ChoiceInput {
        phone: Some(model),
        ..input(ram_gib, true)
    }
}

/// A PC: the RAM is the same, but a model that will decode on the card is
/// budgeted by the card, not by the machine.
fn pc(ram_gib: u64, vram_gib: Option<u64>) -> ChoiceInput {
    pc_with_phone(ram_gib, vram_gib, phone(Some(true)))
}

fn pc_with_phone(ram_gib: u64, vram_gib: Option<u64>, model: PhoneModel) -> ChoiceInput {
    ChoiceInput {
        backend: Backend::DiscreteGpu {
            vram_bytes: vram_gib.map(|gib| gib * GIB),
        },
        phone: Some(model),
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
    // The premise: nothing that fits admits a capability claim against the
    // phone's reported parameters — the dense row is the phone's own size, and
    // a MoE is never claimed over a dense phone.
    let usable = usable_bytes(8 * GIB);
    for entry in kalsa_catalog::usable() {
        let entry = entry.entry();
        if footprint_bytes(entry, 8192).total_bytes() <= usable {
            assert!(
                capability_basis(entry.parameters, entry.dense_equivalent, Some(PHONE_PARAMS))
                    .is_none(),
                "{} must not admit a capability claim on this tier",
                entry.repo
            );
        }
    }

    // But every token the PC generates is one the phone did not, so the
    // recommendation comes through the relief axis, and says so. Nothing
    // published settles the pick's class either, and the result records that
    // honestly: None means nothing published, not that the model is weak.
    match choose(&input(8, true)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.justification, Justification::Relief);
            assert_eq!(selection.repo, "arcee-ai/Trinity-Nano-Preview");
            assert_eq!(selection.display_name, "Arcee Trinity Nano");
            assert!(
                selection.details.contains("relief"),
                "{}",
                selection.details
            );
            assert!(
                !selection.details.contains("on capability"),
                "a lateral move must not be sold as an upgrade: {}",
                selection.details
            );
            // The details are the user's sentence too: no repo path, no quant,
            // and the prefill floor prints as a floor, never as a range.
            assert!(
                !selection.details.contains("arcee-ai/"),
                "{}",
                selection.details
            );
            assert!(!selection.details.contains("Q4"), "{}", selection.details);
            assert!(
                selection.details.contains("≈ 50.0"),
                "{}",
                selection.details
            );
            assert!(
                !selection.details.contains("50–50"),
                "{}",
                selection.details
            );
            assert_eq!(selection.budget.usable_bytes, usable);
            assert!(selection.dense_equivalent.is_none());
        }
        other => panic!("expected a relief pick, got {other:?}"),
    }
}

#[test]
fn every_pick_carries_its_pinned_plan() {
    // There is no "pick without a plan" case to test: the selection's plan
    // is not an Option, because the chooser only sees rows that carry their
    // file's address. The 8 GiB pick hands the shell the exact file at the
    // pinned commit, the size every byte must add up to, and the digest
    // nothing unverified gets past.
    match choose(&input(8, true)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "arcee-ai/Trinity-Nano-Preview");
            let plan = &selection.download;
            assert_eq!(
                plan.url,
                "https://huggingface.co/arcee-ai/Trinity-Nano-Preview-GGUF/resolve/2aa08593b79242d224da0215fb36924dcc0f87ea/Trinity-Nano-Preview-Q4_K_M.gguf"
            );
            assert_eq!(plan.bytes, 3_786_957_088);
            assert_eq!(
                plan.sha256,
                "287562a3824ce2277e2c71cfcc70248b2d90f7fa342a4779979e0bf3e37ad546"
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn sixteen_gigabytes_picks_a_downloadable_moe_whose_plan_matches_its_row() {
    // The old winner here was a research-table row — a model the app could
    // name but never fetch. The menu is now the download table, and the
    // tier's winner is a MoE whose file, size and digest were verified
    // against the pinned commit.
    match choose(&input(16, true)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "inclusionAI/Ling-mini-2.0");
            assert_eq!(
                selection.justification,
                Justification::ExpectedButUnmeasured
            );
            let plan = &selection.download;
            assert!(plan.url.ends_with("/Ling-mini-2.0.Q4_K_M.gguf"), "{}", plan.url);
            assert!(plan.url.contains("/resolve/76f2da561c6519b8f70ceb868e6be78526c69b79/"));
            assert_eq!(plan.bytes, 9_911_575_904);
            assert_eq!(
                plan.sha256,
                "bbb4ef25c6aa7842a93fa999cc6638ba5a8330fb0bd46dc5d7bd85a0db80d74f"
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn a_battery_powered_phone_gets_relief_whether_or_not_it_is_charging() {
    // Charging is a moment, not a property: the catalog asks only whether the
    // device runs on battery at all, so the relief offer cannot depend on
    // which second of the day the question is asked.
    match choose(&input_with_phone(8, Some(true))) {
        Decision::Pick(selection) => {
            assert_eq!(selection.justification, Justification::Relief);
            assert_eq!(
                selection.plain_reason,
                "This is about as good as what your phone already runs, but doing the \
                 work here keeps the heat and the battery drain off your phone."
            );
        }
        other => panic!("expected a relief pick, got {other:?}"),
    }
}

#[test]
fn a_phone_that_has_not_said_it_runs_on_battery_gets_no_relief() {
    let (reason, explanation) = refusal(&input_with_phone(8, None));
    assert_eq!(reason, RefusalReason::NothingBetter);
    assert!(explanation.contains("has not said"), "{explanation}");
}

#[test]
fn a_device_that_does_not_run_on_battery_gets_no_relief() {
    // For a phone the answer is always yes, so this is not a phone — but the
    // rule still holds: relief is about saving a battery, and a wall-powered
    // device has none to save.
    let (reason, explanation) = refusal(&input_with_phone(8, Some(false)));
    assert_eq!(reason, RefusalReason::NothingBetter);
    assert!(
        explanation.contains("does not run on battery"),
        "{explanation}"
    );
}

#[test]
fn capability_does_not_need_a_battery() {
    // Capability is a claim about the model, not about the device's power:
    // it is offered to a wall-powered device all the same. The reachable
    // capability route on shipped rows is the publisher's own dense
    // comparison: IBM places Granite near dense 3B, which clears the bar
    // against a dense 2B phone.
    let machine = pc_with_phone(
        32,
        Some(9),
        PhoneModel {
            weights_bytes: 2_000_000_000,
            parameters: Some(Parameters::dense(2_000_000_000)),
            ..phone(Some(false))
        },
    );
    match choose(&machine) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "ibm-granite/granite-4.0-h-tiny");
            assert!(matches!(
                selection.justification,
                Justification::Capability(CapabilityBasis::PublishedDenseEquivalent {
                    parameters: 3_000_000_000,
                    ..
                })
            ));
        }
        other => panic!("expected a capability pick, got {other:?}"),
    }
}

#[test]
fn a_small_card_is_not_bypassed_by_the_system_ram() {
    // 32 GiB of RAM would fit the 19 GiB research MoE; the 6 GiB card gives a
    // 3 GiB budget, which fits nothing. The machine is refused — a model
    // sized to its RAM would spill across both memories, and the spill is a
    // loss.
    let biggest_on_ram = kalsa_catalog::rows()
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
    // The card holds 9 GiB; the RAM alone would hold rows three times
    // bigger. Only what fits the card entirely is a candidate, and the
    // biggest class that fits wins: Gemma is the dense 12B row, even though
    // it decodes more slowly than the MoE it displaced.
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
fn an_unreadable_card_is_refused_rather_than_guessed() {
    // A 6 GiB card we could not read, 32 GiB of RAM: the RAM budget would
    // offer a twenty-gigabyte model into that card. A model that will decode
    // on the card must fit it entirely, so the machine is refused, and says
    // what unblocks it.
    let (reason, explanation) = refusal(&pc(32, None));
    assert_eq!(reason, RefusalReason::MachineNotMeasured);
    assert!(explanation.contains("could not be read"), "{explanation}");
    assert!(explanation.contains("will not guess"), "{explanation}");
}

#[test]
fn an_undetected_backend_runs_on_the_cpu_it_has() {
    // No GPU was detected, so the CPU is the path the budget is sized for —
    // and the caveat stays on the record: whatever the machine has is not
    // accounted for.
    match choose(&ChoiceInput {
        backend: Backend::Unknown,
        ..input(32, true)
    }) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "Qwen/Qwen3.6-35B-A3B");
            assert!(!selection.budget.gpu_accounted_for);
            assert!(
                selection.details.contains("could not be detected"),
                "{}",
                selection.details
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn a_floor_measurement_offers_what_a_range_would_refuse() {
    // A bandwidth measured on a slower path than the model will decode on
    // makes every prediction a floor — a shape that can keep a candidate
    // but must never refuse one. The pick carries the promise that the real
    // figure is measured on this machine, and it is never called slow.
    let mac = ChoiceInput {
        backend: Backend::Metal,
        bandwidth_is_lower_bound: true,
        bandwidth_bytes_per_second: 107.0e9,
        ..input(64, true)
    };
    match choose(&mac) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "Qwen/Qwen3-Next-80B-A3B-Instruct");
            assert!(matches!(selection.decode, Prediction::Floor(_)));
            assert!(
                selection
                    .details
                    .contains("will be measured on this machine"),
                "{}",
                selection.details
            );
            assert!(
                !selection.details.contains("slower than reading"),
                "a floor must never be called slow: {}",
                selection.details
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn a_measured_decode_is_what_counts() {
    // The 8 GiB Metal tier picks Trinity, and Trinity's speed is no longer a
    // prediction: the row carries the rate measured tonight on this very
    // machine, the machine and the conditions travel with it, and the
    // probe's floor figure is nowhere in the prose — a floor speaks words,
    // and this row has graduated past words.
    let mac = ChoiceInput {
        backend: Backend::Metal,
        bandwidth_is_lower_bound: true,
        bandwidth_bytes_per_second: 107.0e9,
        ..input(8, true)
    };
    match choose(&mac) {
        Decision::Pick(selection) => {
            assert_eq!(selection.justification, Justification::Relief);
            assert!(matches!(
                selection.decode,
                Prediction::Measured { tokens_per_second, .. } if (tokens_per_second - 62.7).abs() < 1e-9
            ));
            assert!(
                selection
                    .details
                    .contains("62.7 tokens per second, as measured on M1 Max"),
                "{}",
                selection.details
            );
            // No floor glyph anywhere: the row is past floors.
            assert!(!selection.details.contains('≥'), "{}", selection.details);
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn the_revenue_conditional_licence_is_visible_and_does_not_close_the_door() {
    let lfm = DOWNLOADABLE
        .iter()
        .map(|row| &row.model)
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
    assert!(
        lfm.is_usable(),
        "a condition on the shipper is not a refusal"
    );

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
fn a_large_unsourced_moe_is_expected_but_unmeasured_and_never_capability() {
    // A dense 2B phone: Qwen3.6 clears the TOTAL parameter bar (17.5×) but
    // the shapes differ — MoE against dense is a claim nothing published
    // settles, and the row publishes no dense equivalent. But it is not
    // relief either: calling a 35B MoE "comparable" to a 2B phone is as
    // false as the opposite error. The honest third state says we expect
    // stronger and will measure it here.
    let model = PhoneModel {
        weights_bytes: 2_000_000_000,
        parameters: Some(Parameters::dense(2_000_000_000)),
        ..phone(Some(true))
    };
    match choose(&input_with_phone_model(32, model)) {
        Decision::Pick(selection) => {
            let qwen = DOWNLOADABLE
                .iter()
                .find(|row| row.model.repo == "Qwen/Qwen3.6-35B-A3B")
                .expect("the Qwen3.6 row exists")
                .model
                .parameters;
            assert!(
                qwen.total().count() as f64 >= 2_000_000_000.0 * 1.4,
                "the total bar is cleared"
            );
            assert!(qwen.is_mixture() && !PHONE_PARAMS.is_mixture(),
                "the shapes differ, which is what keeps this from capability"
            );
            assert_eq!(selection.repo, "Qwen/Qwen3.6-35B-A3B");
            assert_eq!(
                selection.justification,
                Justification::ExpectedButUnmeasured
            );
            assert!(
                selection.details.contains("expected to be more model"),
                "{}",
                selection.details
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn a_sourced_equivalent_claims_capability_through_that_route_and_says_so() {
    // A 6 GiB card budget holds the mid-size rows and nothing denser or
    // bigger. IBM's own published figure places granite near dense 3B, which
    // clears the bar against a dense 2B phone — and granite also decodes
    // fastest in the leader's class, so it is the pick. The claim carries its
    // source as data, and the user sees a name, not a repo path.
    let machine = pc_with_phone(
        32,
        Some(9),
        PhoneModel {
            weights_bytes: 2_000_000_000,
            parameters: Some(Parameters::dense(2_000_000_000)),
            ..phone(Some(true))
        },
    );
    match choose(&machine) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "ibm-granite/granite-4.0-h-tiny");
            assert_eq!(selection.display_name, "IBM Granite 4 Tiny");
            assert_eq!(
                selection.justification,
                Justification::Capability(CapabilityBasis::PublishedDenseEquivalent {
                    parameters: 3_000_000_000,
                    note: "close to it: above on GSM8K, DeepMind-Math and MBPP, below \
                           on BBH and IFEval",
                    source: "IBM's Granite 4.0 model documentation, accessed 2026-09-14",
                })
            );
            assert!(
                selection.details.contains("publisher's own comparison"),
                "{}",
                selection.details
            );
        }
        other => panic!("expected a capability pick, got {other:?}"),
    }
}

#[test]
fn a_sourced_row_offered_as_relief_records_its_equivalence() {
    // Against the default 4B phone, IBM's own figure says phone-class — the
    // evidence refuses capability, and what is left is relief, on battery,
    // with the published comparison recorded in the result.
    match choose(&pc_with_phone(32, Some(9), phone(Some(true)))) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "ibm-granite/granite-4.0-h-tiny");
            assert_eq!(selection.justification, Justification::Relief);
            let equivalent = selection
                .dense_equivalent
                .expect("the published comparison travels with the row");
            assert_eq!(equivalent.parameters, 3_000_000_000);
            assert!(
                selection
                    .details
                    .contains("places it near a dense model of 3.0B"),
                "{}",
                selection.details
            );
        }
        other => panic!("expected a relief pick, got {other:?}"),
    }
}

#[test]
fn a_phone_without_parameter_counts_is_never_offered_capability() {
    // The handshake did not say what the phone runs in parameters, so no
    // claim is invented — the pick carries relief instead, whatever it is.
    let model = PhoneModel {
        parameters: None,
        ..phone(Some(true))
    };
    match choose(&input_with_phone_model(16, model)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "inclusionAI/Ling-mini-2.0");
            assert_eq!(selection.justification, Justification::Relief);
        }
        other => panic!("expected a relief pick, got {other:?}"),
    }
}

#[test]
fn the_plain_reason_speaks_the_readers_language() {
    // The same two sentences the shell shows, at every tier: what the offer
    // means for the reader, with no internals and no numbers at all. The
    // honest bit stays in — including that the unmeasured case is unmeasured.
    let forbidden = [
        "token",
        "expert",
        "bandwidth",
        "context",
        "cache",
        "GiB",
        "MiB",
        "KiB",
    ];
    for ram in [8, 16, 32, 64] {
        match choose(&input(ram, true)) {
            Decision::Pick(selection) => {
                let reason = &selection.plain_reason;
                assert!(!reason.is_empty(), "{ram}: the plain reason is missing");
                assert!(
                    !reason.chars().any(|c| c.is_ascii_digit()),
                    "{ram}: the plain reason carries numbers: {reason}"
                );
                for word in forbidden {
                    assert!(
                        !reason.contains(word),
                        "{ram}: plain reason says {word:?}: {reason}"
                    );
                }
            }
            other => panic!("{ram}: expected a pick, got {other:?}"),
        }
    }
    // And each justification's honest bit is in the plain words, not buried
    // in the details.
    let reasons: Vec<(u64, String)> = [8, 16, 32, 64]
        .into_iter()
        .map(|ram| match choose(&input(ram, true)) {
            Decision::Pick(selection) => (ram, selection.plain_reason),
            other => panic!("{ram}: expected a pick, got {other:?}"),
        })
        .collect();
    let say = |ram: u64, words: &str| {
        assert!(
            reasons
                .iter()
                .any(|(tier, r)| *tier == ram && r.contains(words)),
            "{ram}: the honest bit is missing from the plain reason"
        );
    };
    say(8, "about as good as what your phone");
    say(8, "keeps the heat and the battery drain off your phone");
    say(16, "we have not checked it on this computer yet");
    say(32, "we have not checked it on this computer yet");
    say(64, "we have not checked it on this computer yet");
}

#[test]
fn sixteen_gigabytes_offers_the_biggest_downloadable_class_not_the_biggest_name() {
    // Gemma is now downloadable and in the menu, but its bigger name does
    // not make it win on size alone. The winner is the biggest fitting class
    // under the chooser's other constraints: the verified Ling MoE.
    assert_eq!(chosen(&input(16, true)), "inclusionAI/Ling-mini-2.0");
    assert!(kalsa_catalog::usable()
        .any(|entry| entry.entry().repo == "google/gemma-4-12B-it"));
}

#[test]
fn thirty_two_gigabytes_takes_the_twenty_gigabyte_moe_and_its_pinned_plan() {
    // Qwen3.6-35B-A3B (20.61 GiB of verified weights) is the biggest row
    // that fits the 24 GiB budget, and nothing else is in its class: the
    // tier's winner is a model the earlier catalog could name but never
    // fetch. Against the dense default phone nothing published settles the
    // MoE comparison, so the pick is expected-but-unmeasured, to be
    // measured on this machine before it is called an upgrade.
    let input = input(32, true);
    assert_eq!(chosen(&input), "Qwen/Qwen3.6-35B-A3B");
    match choose(&input) {
        Decision::Pick(selection) => {
            assert_eq!(
                selection.justification,
                Justification::ExpectedButUnmeasured
            );
            assert!(selection.download.bytes == 22_134_528_992);
            assert!(selection.download.url.contains(
                "unsloth/Qwen3.6-35B-A3B-GGUF/resolve/a483e9e6cbd595906af30beda3187c2663a1118c/"
            ));
            assert!(
                selection.decode.floor() > 20.0,
                "3B active on 85 GB/s should be well above 20 tok/s, got {}",
                selection.decode.floor()
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn sixty_four_gigabytes_takes_the_eighty_billion_moe_and_its_pinned_plan() {
    // The 80B MoE fits the 48 GiB budget with 1.7 GiB to spare, is the
    // biggest fitting row, and no other row is in its class: a 64 GiB
    // machine finally uses its memory. The plan is the file at the pinned
    // commit of the vendor's own GGUF repo, with the digest the download
    // is held to.
    let input = input(64, true);
    assert_eq!(chosen(&input), "Qwen/Qwen3-Next-80B-A3B-Instruct");
    match choose(&input) {
        Decision::Pick(selection) => {
            assert_eq!(
                selection.justification,
                Justification::ExpectedButUnmeasured
            );
            assert!(
                selection.footprint.total_bytes() <= selection.budget.usable_bytes,
                "the pick fits the 48 GiB budget entirely"
            );
            assert!(selection.download.bytes == 48_410_988_384);
            assert!(selection.download.url.contains(
                "Qwen/Qwen3-Next-80B-A3B-Instruct-GGUF/resolve/4c8630cf7af926a9c5095cb4bbbbc65d36e20f77/"
            ));
            assert_eq!(
                selection.download.sha256,
                "d103b2733ec1012a52d01edda66b7e5c24ae50508c9f99f5297ea459ef3c061a"
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn a_machine_where_everything_is_too_slow_says_so() {
    // The range refusal still exists for machines that do not hand us a
    // floor: with a bandwidth that slow, every fitting row's pessimistic end
    // is below reading speed, and that is knowledge a range is allowed to
    // have.
    let mut slow = input(32, true);
    slow.bandwidth_bytes_per_second = 0.5e9;
    let (reason, explanation) = refusal(&slow);
    assert_eq!(reason, RefusalReason::NothingFastEnough);
    assert!(explanation.contains("slower than reading"), "{explanation}");
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
    // On 16 GiB the refused Instella MoE (9.75 GiB, 16B/2.8B) would be a
    // bigger pick than the chosen row: the licence gate keeps it out of the
    // menu, and the type split keeps it from ever coming back by accident.
    let instella = kalsa_catalog::CATALOG
        .iter()
        .find(|entry| entry.repo.starts_with("amd/"))
        .expect("instella is in the catalog");
    assert!(
        footprint_bytes(instella, 8192).total_bytes() <= usable_bytes(16 * GIB),
        "the refused row does fit, which is what makes this test meaningful"
    );
    assert!(
        instella.weights_bytes > 9 * GIB,
        "and it is bigger than the chosen row"
    );
    assert_eq!(chosen(&input(16, true)), "inclusionAI/Ling-mini-2.0");
    assert!(kalsa_catalog::excluded().any(|(entry, reason)| {
        entry.repo == instella.repo && reason.contains("research only")
    }));
}

#[test]
fn the_decision_says_why_with_a_range_and_the_phones_own_number() {
    match choose(&input(32, true)) {
        Decision::Pick(selection) => {
            let why = &selection.details;
            assert!(why.contains("Alibaba Qwen 3.6"), "{why}");
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
            // Prefill is an estimate and prints as one: the probe omits
            // attention and routing, so it is not a floor at long context.
            assert!(why.contains("≈ "), "{why}");
            assert!(!why.contains("≥ "), "prefill is not a floor: {why}");
            assert_eq!(
                selection.plain_reason,
                "This should be better than what your \
phone runs; we have not checked it on this computer yet, and we will."
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
