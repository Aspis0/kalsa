//! The decision table: every RAM tier, with and without the phone, the GPU
//! budget branches, the two justifications, and the refusals. The "no candidate,
//! and we say so" case is tested like any other — it is the answer nobody
//! remembers to prove.

use kalsa_catalog::{
    capability_basis, choose, decode_prediction, dense_speed_floor, footprint_bytes,
    largest_that_runs_well, quicker_alternative, usable_bytes, Backend, CapabilityBasis,
    ChoiceInput, Decision, Justification, Parameters, PhoneModel, Prediction, RefusalReason,
    DOWNLOADABLE, GIB, CHOOSER_CONTEXT_TOKENS, LARGE_MOE_TOTAL_PARAMETERS,
    MINIMUM_DENSE_TOKENS_PER_SECOND, MINIMUM_SMALL_DENSE_TOKENS_PER_SECOND,
    QUICK_SPEED_ADVANTAGE, SAME_CLASS_BAND,
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

/// Numbers from the probe on the development machine, at the product's own
/// pricing window: the chooser prices every candidate at
/// [`CHOOSER_CONTEXT_TOKENS`], so the arithmetic in the expectations is the
/// arithmetic the product would do.
fn input(ram_gib: u64, phone_known: bool) -> ChoiceInput {
    ChoiceInput {
        backend: Backend::Cpu,
        ram_bytes: ram_gib * GIB,
        bandwidth_bytes_per_second: 85.0e9,
        bandwidth_is_lower_bound: false,
        compute_flops_per_second: 100.0e9,
        context_tokens: CHOOSER_CONTEXT_TOKENS,
        phone: phone_known.then_some(phone(Some(true))),
    }
}

/// The same fixture on the Metal path at a stated bandwidth: the small-dense
/// line bites differently per bandwidth, so the tests that care ask here.
fn metal(ram_gib: u64, bandwidth: f64) -> ChoiceInput {
    ChoiceInput {
        backend: Backend::Metal,
        bandwidth_bytes_per_second: bandwidth,
        ..input(ram_gib, false)
    }
}

/// A dense 9B, about 5.2 GB of weights. Big enough that no PC row below 12.6B
/// parameters clears the capability bar against it, which is what makes a
/// 16 GiB machine refuse the walk outright.
fn nine_billion_phone(battery_powered: Option<bool>) -> PhoneModel {
    PhoneModel {
        weights_bytes: 5_200_000_000,
        parameters: Some(Parameters::dense(9_000_000_000)),
        measured_tokens_per_second: Some(9.0),
        battery_powered,
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
    // phone's reported parameters — the one row that fits here is the dense
    // 2.69B at its only compression, under the phone's own 4B.
    let usable = usable_bytes(8 * GIB);
    for entry in kalsa_catalog::usable() {
        let entry = entry.entry();
        if footprint_bytes(entry, CHOOSER_CONTEXT_TOKENS).total_bytes() <= usable {
            assert!(
                capability_basis(entry.parameters, entry.dense_equivalent, Some(PHONE_PARAMS))
                    .is_none(),
                "{} must not admit a capability claim on this tier",
                entry.repo
            );
        }
    }

    // But every token the PC generates is one the phone did not, so the
    // recommendation comes through the relief axis, and says so.
    match choose(&input(8, true)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.justification, Justification::Relief);
            assert_eq!(selection.repo, "LiquidAI/LFM2.5-2.6B");
            assert_eq!(selection.display_name, "Liquid LFM 2.5");
            assert_eq!(selection.quant, "Q8_0", "the tier's own file");
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
                !selection.details.contains("LiquidAI/"),
                "{}",
                selection.details
            );
            assert!(!selection.details.contains("Q4"), "{}", selection.details);
            assert!(
                selection.details.contains("at least 18.5"),
                "{}",
                selection.details
            );
            assert!(
                !selection.details.contains("50–50"),
                "{}",
                selection.details
            );
            assert_eq!(selection.budget.usable_bytes, usable);
        }
        other => panic!("expected a relief pick, got {other:?}"),
    }
}

#[test]
fn every_pick_carries_its_pinned_plan() {
    // There is no "pick without a plan" case to test: the selection's plan
    // is not an Option, because the chooser only sees rows that carry their
    // file's address. The 8 GiB tier's pick — the bigger of the LFM
    // compressions — hands the shell the exact file at the pinned commit,
    // the size every byte must add up to, and the digest nothing
    // unverified gets past.
    match choose(&input(8, true)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "LiquidAI/LFM2.5-2.6B");
            assert_eq!(selection.quant, "Q8_0");
            let plan = &selection.download;
            assert_eq!(
                plan.url,
                "https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/e7caca5d835a3901a8e0d63e94009429bafafdfc/LFM2.5-2.6B-Q8_0.gguf"
            );
            assert_eq!(plan.bytes, 2_874_779_648);
            assert_eq!(
                plan.sha256,
                "1e22128dfa128bdfb684da167e74e072d0a056baa7d06d9f280291e2839b0fc9"
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn sixteen_gigabytes_picks_a_downloadable_row_whose_plan_matches_its_row() {
    // The old winner here was a research-table row — a model the app could
    // name but never fetch — and the MoE it later picked is owner-rejected
    // now. The tier's winner is the biggest downloadable row that clears
    // its own speed line — at this machine's 85 GB/s the 12B predicts 7.1
    // tok/s, under the small-dense 10, so the tier goes to the E4B — and
    // the pick carries the file, size and digest verified against the
    // pinned commit.
    match choose(&input(16, true)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "google/gemma-4-E4B-it");
            assert_eq!(
                selection.justification,
                Justification::Capability(CapabilityBasis::Parameters)
            );
            let plan = &selection.download;
            assert!(plan.url.ends_with("/gemma-4-E4B-it-Q4_K_M.gguf"), "{}", plan.url);
            assert!(plan.url.contains("/resolve/bfc15c382204943c3a8fff0c750b94ae2364d7a3/"));
            assert_eq!(plan.bytes, 4_977_171_584);
            assert_eq!(
                plan.sha256,
                "85a896a047553e842f25297ee5b031d64ff30147d9c4af17b1e4b394cd1fab87"
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
    // capability route on shipped rows is dense against dense: Gemma 4 E4B
    // (8B dense) clears the parameter bar against a dense 2B phone.
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
            assert_eq!(selection.repo, "google/gemma-4-E4B-it");
            assert!(matches!(
                selection.justification,
                Justification::Capability(CapabilityBasis::Parameters)
            ));
        }
        other => panic!("expected a capability pick, got {other:?}"),
    }
}

#[test]
fn a_small_card_is_not_bypassed_by_the_system_ram() {
    // 32 GiB of RAM would fit the 20.6 GiB MoE; the 5 GiB card gives a
    // 2 GiB budget, and the smallest row in the catalog needs 3.7 GiB at
    // the chooser's 65_536-token window, so nothing fits. The machine is refused — a model sized to its
    // RAM would spill across both memories, and the spill is a loss.
    let biggest_on_ram = kalsa_catalog::rows()
        .find(|entry| entry.repo == "Qwen/Qwen3.6-35B-A3B")
        .expect("the 35B row exists");
    assert!(
        footprint_bytes(biggest_on_ram, CHOOSER_CONTEXT_TOKENS).total_bytes()
            <= usable_bytes(32 * GIB),
        "the RAM alone would have allowed the 35B row, which is what makes this test real"
    );
    let (reason, explanation) = refusal(&pc(32, Some(5)));
    assert_eq!(reason, RefusalReason::NothingFits);
    assert!(explanation.contains("GiB"), "{explanation}");
}

#[test]
fn a_model_that_would_spill_is_never_offered() {
    // The card holds 12 GiB; the RAM alone would hold rows three times
    // bigger. Only what fits the card entirely is a candidate, and the
    // biggest class that fits AND clears its row's speed line wins: at this
    // machine's bandwidth the dense 12B sits under its 10 tok/s line, so
    // the pick is the Gemma 4 E4B.
    let machine = pc(32, Some(12));
    match choose(&machine) {
        Decision::Pick(selection) => {
            assert_ne!(
                selection.repo, "Qwen/Qwen3.6-35B-A3B",
                "the 35B row does not fit the card and must not be offered"
            );
            assert_eq!(selection.repo, "google/gemma-4-E4B-it");
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
            assert_eq!(selection.repo, "Qwen/Qwen3.6-35B-A3B");
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
    // The 16 GiB Metal tier picks the row whose speed is no longer a
    // prediction — on the machine the rate was measured on: the owner's
    // M1 Max at 400 GB/s, same backend and same bandwidth, so the figure,
    // the machine and the conditions travel with it and the probe's floor
    // figure is nowhere in the prose — a floor speaks words, and this row
    // has graduated past words.
    let mac = ChoiceInput {
        backend: Backend::Metal,
        bandwidth_is_lower_bound: true,
        bandwidth_bytes_per_second: 400.0e9,
        ..input(16, true)
    };
    match choose(&mac) {
        Decision::Pick(selection) => {
            assert_eq!(selection.justification, Justification::Capability(CapabilityBasis::Parameters));
            assert!(matches!(
                selection.decode,
                Prediction::Measured { tokens_per_second, .. } if (tokens_per_second - 20.44).abs() < 1e-9
            ));
            assert!(
                selection
                    .details
                    .contains("20.4 tokens per second, as measured on M1 Max"),
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
fn a_measured_decode_belongs_to_the_machine_it_was_measured_on() {
    // The rate above is a fact about a 400 GB/s M1 Max. Asked of the row
    // directly — the pick at 100 GB/s is decided by the small-dense line
    // as well, so the row is the honest subject here — the figure at
    // 100 GB/s is a prediction: the M1 Max's 20.44 must not travel.
    let twelve = kalsa_catalog::usable()
        .find(|row| row.entry().repo == "google/gemma-4-12B-it")
        .expect("the measured row is on the menu");
    let slow = decode_prediction(twelve, &metal(16, 100.0e9));
    assert!(
        !matches!(slow, Prediction::Measured { .. }),
        "the M1 Max's measurement must not reach a 100 GB/s machine: {slow:?}"
    );
    assert!(slow.floor() < 20.44, "the speed is no longer 20.44: {:?}", slow.floor());
    assert!(slow.floor() > 0.0, "the prediction still has a figure: {slow:?}");

    // And the band: a machine a quarter away from the measured bandwidth
    // still counts as the machine the rate was taken on.
    let near = decode_prediction(twelve, &metal(16, 300.0e9));
    assert!(
        matches!(near, Prediction::Measured { .. }),
        "300 GB/s is within a quarter of the M1 Max's 400: {near:?}"
    );
}

#[test]
fn the_revenue_conditional_licence_is_visible_and_does_not_close_the_door() {
    let lfm = DOWNLOADABLE
        .iter()
        .map(|row| &row.model)
        .find(|entry| entry.repo == "LiquidAI/LFM2.5-2.6B")
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
    // can never present itself as unconditional — and here the pick IS the
    // conditional row, which is the case the rule exists for.
    match choose(&input(8, true)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.licence.id(), "lfm1.0");
            assert_eq!(
                selection.licence.condition(),
                Some("commercial use only for entities under $10M annual revenue")
            );
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
fn a_phone_without_parameter_counts_is_never_offered_capability() {
    // The handshake did not say what the phone runs in parameters, so no
    // claim is invented — the pick carries relief instead, whatever it is.
    let model = PhoneModel {
        parameters: None,
        ..phone(Some(true))
    };
    match choose(&input_with_phone_model(16, model)) {
        Decision::Pick(selection) => {
            assert_eq!(selection.repo, "google/gemma-4-E4B-it");
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
    // in the details. 8 GiB is relief; 16 GiB is a dense Capability pick
    // on the Parameters basis, whose honest bit is the admission that
    // "bigger" was not measured as "better"; 32 and 64 are MoE picks that
    // stay on the expected-but-unmeasured sentence.
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
    say(16, "We have not measured whether it is better");
    say(32, "We have not checked it on this computer.");
    say(64, "We have not checked it on this computer.");
}

#[test]
fn sixteen_gigabytes_takes_the_biggest_row_that_fits_and_clears_its_line() {
    // The MoEs this tier used to pick were removed from the manifest as
    // stale. The biggest fitting downloadable row used to be the dense
    // Gemma 12B — it still fits, but at this machine's 85 GB/s it predicts
    // 7.1 tok/s, under the small-dense line, so the tier goes to the
    // biggest row that clears it: the E4B. What the tier must never do is
    // hand it back to a research-only row — pinned by the research test
    // below.
    assert_eq!(chosen(&input(16, true)), "google/gemma-4-E4B-it");
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
            // The floor is the corrected model's pessimistic end on this
            // machine, and the arithmetic is worth spelling out: 3/35 of
            // 22_134_528_992 bytes is 1_897_245_342 of active bytes; x2.06
            // (the measured MoE correction) is 3_908_325_404; plus the
            // 65_536-token cache at this row's own 40_960 bytes is
            // 2_684_354_560 bytes of traffic. At this test's 85 GB/s
            // CPU-path measurement the floor takes the 0.7 sustained share
            // of it: 1/(0.001504 + 6_592_679_964/59_500_000_000) = 8.9
            // tok/s. A mixture is held to the plain 3 tok/s line, not to
            // the dense floors — it reads 3 of its 35 billion parameters a
            // token — so 8.9 clears it by nearly three times.
            assert!(
                selection.decode.floor() > 3.0,
                "the tier must offer a usable pick, got {}",
                selection.decode.floor()
            );
        }
        other => panic!("expected a pick, got {other:?}"),
    }
}

#[test]
fn sixty_four_gigabytes_takes_the_biggest_downloadable_moe_and_its_pinned_plan() {
    // The 80B MoE this tier used to take was removed from the manifest as
    // stale, so the biggest downloadable row is the 20.6 GiB
    // Qwen3.6-35B-A3B MoE, and it fits the 48 GiB budget. The plan is the
    // file at the pinned commit of the vendor's own GGUF repo, with the
    // digest the download is held to.
    let input = input(64, true);
    assert_eq!(chosen(&input), "Qwen/Qwen3.6-35B-A3B");
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
            assert!(selection.download.bytes == 22_134_528_992);
            assert!(selection.download.url.contains(
                "unsloth/Qwen3.6-35B-A3B-GGUF/resolve/a483e9e6cbd595906af30beda3187c2663a1118c/"
            ));
            assert_eq!(
                selection.download.sha256,
                "ac0e2c1189e055faa36eff361580e79c5bd6f8e76bffb4ce547f167d53e31a61"
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
    // `choose` answers "is this computer an upgrade?" — with no phone that
    // has no answer, and refusing is correct. What this must no longer
    // imply is that nothing can run: the next test pins the phone-free
    // question on the same machine.
    let (reason, explanation) = refusal(&input(32, false));
    assert_eq!(reason, RefusalReason::PhoneUnknown);
    assert!(explanation.contains("Pair the phone"), "{explanation}");
}

#[test]
fn without_the_phone_the_largest_runnable_row_still_answers() {
    // The product's ruling: the phone decides whether the computer is an
    // upgrade; it never gates what the computer can run. The same machine
    // the test above refused, asked the phone-free question, gets the
    // largest row that fits and clears the speed floor — with the pinned
    // file a start needs.
    let no_phone = input(32, false);
    let row = largest_that_runs_well(&no_phone).expect("a 32 GiB machine runs something");
    let budget = usable_bytes(32 * GIB);
    assert!(
        row.footprint.total_bytes() <= budget,
        "the pick fits the budget it was sized against"
    );
    assert!(
        row.download.bytes > 0 && !row.download.url.is_empty() && row.download.sha256.len() == 64,
        "the pinned file — address, size, digest — travels with the pick"
    );
}

#[test]
fn the_research_only_row_is_never_chosen_even_when_it_would_win() {
    // On 8 GiB the research row Gemma 4 E2B (3.22 GiB, no pinned file)
    // weighs more than the chosen row and fits the budget: it would win by
    // the size rule, and it is still never offered — the chooser is handed
    // DOWNLOADABLE only, and the type split keeps a research row from ever
    // coming back by accident.
    let e2b = kalsa_catalog::CATALOG
        .iter()
        .find(|entry| entry.repo == "google/gemma-4-E2B-it")
        .expect("the research row is in the catalog");
    assert!(
        footprint_bytes(e2b, CHOOSER_CONTEXT_TOKENS).total_bytes() <= usable_bytes(8 * GIB),
        "the research row does fit, which is what makes this test meaningful"
    );
    let pick = chosen(&input(8, true));
    assert_eq!(pick, "LiquidAI/LFM2.5-2.6B");
    let chosen_row = kalsa_catalog::usable()
        .find(|entry| entry.entry().repo == pick)
        .expect("the pick is on the menu");
    assert!(
        e2b.weights_bytes > chosen_row.entry().weights_bytes,
        "and it is bigger than the chosen row, which is what \"would win\" means"
    );
    assert!(
        kalsa_catalog::usable().all(|entry| entry.entry().repo != e2b.repo),
        "the research row never reaches the chooser"
    );
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
            // This row's per-token cache was read from its own GGUF header
            // (manifest.rs), so there is no assumption left to admit — and
            // admitting one that is not being made would be its own lie. No
            // shipped row is on the assumption any more; the sentence itself
            // stays live and is asserted on a fixture row in
            // `rationale::tests`.
            assert!(
                !why.contains("has not been measured yet"),
                "a measured cache must not claim to be assumed: {why}"
            );
            // Prefill is a floor — the compute probe is a portable loop, and
            // on the one machine that checked it sat 13x below reality — so
            // it prints as an at-least, never as an expectation.
            assert!(why.contains("at least"), "{why}");
            assert!(!why.contains("≈ "), "prefill is not an estimate: {why}");
            assert_eq!(
                selection.plain_reason,
                "This should be better than what your \
phone runs. We have not checked it on this computer."
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

// ── the second option ──────────────────────────────────────────────────────
// What the home page offers beside its pick: the fastest row worth having,
// out of the machine's own numbers, so the pair moves when the machine does.

#[test]
fn the_second_option_is_clearly_faster_and_smaller_than_the_first() {
    // 16 GiB on the Metal path at 200 GB/s: the biggest row that runs well
    // is the dense 12B (16.6 tok/s, over its small-dense line), and the LFM
    // file clears twice that — the pair this section is about. At the dev
    // machine's 85 GB/s the 12B sits under its line and there is no pair
    // to ask for.
    let machine = metal(16, 200.0e9);
    let first = largest_that_runs_well(&machine).expect("a 16 GiB machine runs something");
    assert_eq!(first.entry.repo, "google/gemma-4-12B-it");
    let quick =
        quicker_alternative(&machine, &first.decode).expect("something beats the pick on speed");
    assert!(
        quick.entry.weights_bytes < first.entry.weights_bytes,
        "the quick option is the smaller of the two"
    );
    assert!(
        quick.decode.floor() >= first.decode.floor() * QUICK_SPEED_ADVANTAGE,
        "{} at {:.1} is not clearly faster than {} at {:.1}",
        quick.entry.repo,
        quick.decode.floor(),
        first.entry.repo,
        first.decode.floor(),
    );
}

#[test]
fn the_second_option_is_the_largest_fast_row_not_the_smallest_row() {
    // "Fast" alone would hand the owner the tiniest thing on the menu. The
    // rule is the most model that still clears the speed bar, so no row
    // bigger than the pick may also clear it.
    let machine = metal(16, 200.0e9);
    let first = largest_that_runs_well(&machine).expect("a pick");
    let quick = quicker_alternative(&machine, &first.decode).expect("a second option");
    let wanted = first.decode.floor() * QUICK_SPEED_ADVANTAGE;
    for usable in kalsa_catalog::usable() {
        let row = usable.entry();
        if row.weights_bytes > quick.entry.weights_bytes {
            assert!(
                kalsa_catalog::decode_prediction(usable, &machine).floor() < wanted,
                "{} is bigger than the quick pick and also fast enough",
                row.repo
            );
        }
    }
}

#[test]
fn a_machine_with_one_honest_answer_is_not_given_two() {
    // The 8 GiB tier: the rows that fit are two compressions of ONE model,
    // so a second option would be the same model wearing a different file.
    // None is the answer.
    let machine = input(8, false);
    let first = largest_that_runs_well(&machine).expect("the 8 GiB tier runs a row");
    if let Some(quick) = quicker_alternative(&machine, &first.decode) {
        panic!(
            "offered {} beside {} on a machine with one thing to offer",
            quick.entry.repo, first.entry.repo
        );
    }
}

#[test]
fn an_unmeasured_machine_is_offered_no_second_option_either() {
    // The refusal that gates the first pick gates this one too: a machine
    // with no numbers cannot be told which of two models is faster on it.
    let machine = ChoiceInput {
        bandwidth_bytes_per_second: 0.0,
        ..input(64, false)
    };
    assert!(quicker_alternative(&machine, &Prediction::Range { low: 1.0, high: 2.0 }).is_none());
}

#[test]
fn a_refused_machine_offers_no_second_option_either() {
    // A property of the helper, and not a screen: the card computes its second
    // option from the prediction of the row it is showing, and a refusal
    // carries no row — `decode.and_then` in `src-tauri/src/capability.rs:248-249`
    // keeps it that way, which is why the refusal-shaped symptom was never
    // reachable. What is asserted here is only that asking beside a refusal
    // answers nothing rather than offering a row the walk would not start.
    //
    // The audit's 16 GiB Mac at 140 GB/s, with a phone that runs a dense 9B on
    // its wall socket: nothing that fits clears the parameter bar against 9B —
    // the biggest runnable row is the dense Gemma 4 12B at 11.95B, and the bar
    // is 12.6B — so the walk refuses the machine outright.
    let machine = ChoiceInput {
        backend: Backend::Metal,
        bandwidth_bytes_per_second: 220.0e9,
        ..input_with_phone_model(16, nine_billion_phone(Some(false)))
    };
    assert_eq!(refusal(&machine).0, RefusalReason::NothingBetter);

    // Liquid LFM 2.5 is the row the speed bar admits: 2.69B dense, which
    // earns none of the three justifications — no published dense
    // equivalent to compare, no mixture to expect (and under the 10B total
    // either way), and no relief from a phone on the wall socket. At 220 GB/s
    // it clears the speed bar (44.2 against the measured 20.4), so the bar
    // was never what stopped it: it is a row the walk would not start, and
    // it is not offered here.
    let than = largest_that_runs_well(&machine)
        .expect("a 16 GiB machine runs something")
        .decode;
    let lfm = kalsa_catalog::usable()
        .find(|row| row.entry().repo == "LiquidAI/LFM2.5-2.6B")
        .expect("the fast row beside the refusal is on the menu");
    assert!(
        footprint_bytes(lfm.entry(), machine.context_tokens).total_bytes()
            <= usable_bytes(machine.ram_bytes),
        "the row must be a candidate at all, or this test proves nothing about the gate"
    );
    assert!(
        kalsa_catalog::decode_prediction(lfm, &machine).floor()
            >= than.floor() * QUICK_SPEED_ADVANTAGE,
        "the speed bar no longer admits it, so this test would pass for the wrong reason"
    );
    assert!(
        quicker_alternative(&machine, &than).is_none(),
        "a model the walk refuses must not be offered beside the refusal"
    );
}

#[test]
fn a_pick_is_not_offered_a_second_option_that_earns_nothing() {
    // The reachable shape, and so the one that matters: the walk SUCCEEDS and
    // there is a row on the page for a second option to stand beside. A refusal
    // cannot show one at all — `decode.and_then` in `src-tauri/src/capability.rs:248-249`
    // computes the alternative only from the prediction of the row on the
    // page, and a refusal carries no such row. Sixteen gibibytes of unified
    // memory at 200 GB/s with a 4B phone on the wall socket: the pick is Gemma 4
    // 12B on capability, and the row beside it earns nothing.
    let machine = ChoiceInput {
        backend: Backend::Metal,
        bandwidth_bytes_per_second: 200.0e9,
        ..input_with_phone_model(16, phone(Some(false)))
    };
    let Decision::Pick(pick) = choose(&machine) else {
        panic!("this machine is offered a model, so the card has a pick to stand beside");
    };
    assert_eq!(pick.repo, "google/gemma-4-12B-it");
    assert!(matches!(pick.justification, Justification::Capability(_)));

    // The row beside that pick — the bigger LFM file, which clears the speed
    // bar at this bandwidth — and why it earns none of the three:
    // asserting the branches, not only the outcome: no capability (2.69B
    // dense under the phone's own 4B, with no published comparison), no
    // expectation (it is not a mixture, and 2.69B is under the 10B total
    // anyway), and no relief, though relief is the branch this row would
    // have taken. The phone's battery flag is therefore what decides it,
    // and a phone on battery makes the row legitimate: there would be no
    // defect at all.
    let lfm = kalsa_catalog::usable()
        .find(|row| {
            row.entry().repo == "LiquidAI/LFM2.5-2.6B" && row.entry().quant == "Q8_0"
        })
        .expect("the row beside the pick is on the menu");
    assert!(
        footprint_bytes(lfm.entry(), machine.context_tokens).total_bytes()
            <= usable_bytes(machine.ram_bytes),
        "the row must be a candidate at all, or this test proves nothing about the gate"
    );
    assert!(
        capability_basis(
            lfm.entry().parameters,
            lfm.entry().dense_equivalent,
            Some(PHONE_PARAMS)
        )
        .is_none(),
        "the capability branch must fail: 2.69B dense does not clear the parameter bar against a dense 4B"
    );
    assert!(
        lfm.entry().parameters.total().count() < LARGE_MOE_TOTAL_PARAMETERS,
        "the expectation branch must fail on the size line"
    );
    assert!(
        lfm.entry().weights_bytes as f64 >= PHONE_BYTES as f64 * SAME_CLASS_BAND,
        "it is inside the phone's own class, so relief is the branch the battery flag decides"
    );
    assert_eq!(
        machine.phone.map(|phone| phone.battery_powered),
        Some(Some(false)),
        "a phone on battery would earn this row relief, and there would be nothing to fix"
    );
    assert!(
        quicker_alternative(&machine, &pick.decode).is_none(),
        "a pick may not be offered a second option that earns nothing"
    );
}

#[test]
fn without_a_phone_the_second_option_keeps_the_only_bar_there_is() {
    // A phone is what makes a comparison; without one, the first option is
    // simply the largest that runs well, and nothing asked it to justify
    // itself. Asking the second option for a justification its neighbour
    // never faced would be the same bug from the other side. Liquid LFM 2.5
    // clears the speed bar here and is offered with no justification asked
    // of it at all.
    let machine = ChoiceInput {
        backend: Backend::Metal,
        bandwidth_bytes_per_second: 200.0e9,
        ..input(16, false)
    };
    let first = largest_that_runs_well(&machine).expect("a 16 GiB machine runs something");
    let quick = quicker_alternative(&machine, &first.decode)
        .expect("fit and the speed bar are the whole of the rule with no phone");
    assert_eq!(quick.entry.repo, "LiquidAI/LFM2.5-2.6B");
}

#[test]
fn a_phone_on_battery_still_earns_the_quicker_row_its_place() {
    // The rule is not "the second option is gone". On the same machine, a
    // phone that runs on battery and whose own class the quicker row is in
    // (2.87 GB against a 2.83 GB phone, inside the 0.85 band) justifies relief
    // — every token generated here is one the phone did not generate — so the
    // quicker row is still offered, and on exactly the ground the walk itself
    // would offer it.
    let machine = ChoiceInput {
        backend: Backend::Metal,
        bandwidth_bytes_per_second: 200.0e9,
        ..input_with_phone(16, Some(true))
    };
    assert_eq!(chosen(&machine), "google/gemma-4-12B-it");
    let first = largest_that_runs_well(&machine).expect("a 16 GiB machine runs something");
    let quick = quicker_alternative(&machine, &first.decode).expect("relief earns it a place");
    assert_eq!(quick.entry.repo, "LiquidAI/LFM2.5-2.6B");
    assert_eq!(quick.entry.quant, "Q8_0", "the bigger file is the one in the phone's class");
    assert!(
        capability_basis(
            quick.entry.parameters,
            quick.entry.dense_equivalent,
            Some(PHONE_PARAMS)
        )
        .is_none(),
        "it is not offered as a capability claim: 2.69B dense does not clear the parameter bar against 4B"
    );
    assert!(
        quick.entry.weights_bytes as f64 >= PHONE_BYTES as f64 * SAME_CLASS_BAND,
        "relief holds it inside the phone's own class, on the phone's own bytes"
    );
}

#[test]
fn a_mixture_that_fits_beats_the_dense_row_it_displaces() {
    // The two axes, on one machine: total weights decide what fits, active
    // weights decide the speed. Where both fit, a mixture is the bigger model
    // AND the faster one, and the chooser must land on it. Gemma 4 26B-A4B
    // against the dense Gemma 4 12B it replaces above 20 GiB is that case
    // exactly — twice the total parameters, and a token reads less.
    let machine = ChoiceInput {
        backend: Backend::Metal,
        ram_bytes: 24 * GIB,
        bandwidth_bytes_per_second: 183.0e9,
        bandwidth_is_lower_bound: false,
        compute_flops_per_second: 135.0e9,
        context_tokens: CHOOSER_CONTEXT_TOKENS,
        phone: None,
    };
    let chosen = largest_that_runs_well(&machine).expect("a 24 GiB Mac runs something");
    assert_eq!(chosen.entry.repo, "google/gemma-4-26B-A4B-it");

    let dense = kalsa_catalog::usable()
        .find(|row| row.entry().repo == "google/gemma-4-12B-it")
        .expect("the dense row it displaces is on the menu");
    let dense_speed = kalsa_catalog::decode_prediction(dense, &machine);
    assert!(
        chosen.entry.parameters.total().count() > dense.entry().parameters.total().count(),
        "the mixture is meant to be the bigger model"
    );
    // Its pessimistic end, against the dense row's figure: even the bottom of
    // the band wins, so the comparison does not rest on the optimistic one.
    assert!(
        chosen.decode.floor() > dense_speed.ceiling(),
        "the mixture is not faster: {:.1} against {:.1}",
        chosen.decode.floor(),
        dense_speed.ceiling()
    );
}

// ── the dense speed floor ──────────────────────────────────────────────────
// One rule at both ends: a dense row must clear the line its size sets, and
// a row that does not is withheld — but reported, with its own numbers.

#[test]
fn the_dense_speed_floor_is_one_rule_at_both_ends() {
    assert_eq!(MINIMUM_DENSE_TOKENS_PER_SECOND, 20.0);
    assert_eq!(MINIMUM_SMALL_DENSE_TOKENS_PER_SECOND, 10.0);
    let row = |repo: &str| {
        kalsa_catalog::rows()
            .find(|entry| entry.repo == repo)
            .expect("row exists")
    };
    assert_eq!(dense_speed_floor(row("Qwen/Qwen3.8-27B")), Some(20.0));
    assert_eq!(dense_speed_floor(row("google/gemma-4-12B-it")), Some(10.0));
    assert_eq!(dense_speed_floor(row("google/gemma-4-E4B-it")), Some(10.0));
    assert_eq!(
        dense_speed_floor(row("Qwen/Qwen3.6-35B-A3B")),
        None,
        "a mixture reads its active share and is judged by the plain floor"
    );
}

#[test]
fn a_big_dense_row_is_refused_where_it_cannot_drive_its_line_and_taken_where_it_can() {
    // Qwen3.8-27B predicts 14.6–21.3 tok/s on a 64 GiB / 400 GB/s machine:
    // its floor is under the big-dense line, so the tier is the MoE alone.
    // At 800 GB/s the floor clears 20 and the dense row takes the first card.
    let slow = ChoiceInput {
        bandwidth_bytes_per_second: 400.0e9,
        ..input(64, false)
    };
    let pick = largest_that_runs_well(&slow).expect("a 64 GiB machine runs something");
    assert_eq!(pick.entry.repo, "Qwen/Qwen3.6-35B-A3B");
    let qwen38 = kalsa_catalog::usable()
        .find(|row| row.entry().repo == "Qwen/Qwen3.8-27B")
        .expect("the dense row is on the menu");
    assert!(
        decode_prediction(qwen38, &slow).floor() < MINIMUM_DENSE_TOKENS_PER_SECOND,
        "{:?}",
        decode_prediction(qwen38, &slow).floor()
    );

    let fast = ChoiceInput {
        bandwidth_bytes_per_second: 800.0e9,
        ..input(64, false)
    };
    let pick = largest_that_runs_well(&fast).expect("a 64 GiB machine runs something");
    assert_eq!(pick.entry.repo, "Qwen/Qwen3.8-27B");
    assert!(
        decode_prediction(qwen38, &fast).floor() >= MINIMUM_DENSE_TOKENS_PER_SECOND,
        "{:?}",
        decode_prediction(qwen38, &fast).floor()
    );
}

#[test]
fn a_small_dense_row_is_offered_only_at_ten_tokens_a_second() {
    // The owner's line: 5 tok/s is "totalmente inusabile", so a dense row
    // under twenty billion parameters must predict at least 10. At 16 GiB /
    // 100 GB/s the 12B predicts 8.4–12.1 — under it — and the tier goes to
    // the E4B (12.4, clear of its line); at 200 GB/s the 12B predicts 16.6
    // and takes the tier back.
    let slow = metal(16, 100.0e9);
    let pick = largest_that_runs_well(&slow).expect("a 16 GiB machine runs something");
    assert_eq!(pick.entry.repo, "google/gemma-4-E4B-it");
    let fast = metal(16, 200.0e9);
    let pick = largest_that_runs_well(&fast).expect("a 16 GiB machine runs something");
    assert_eq!(pick.entry.repo, "google/gemma-4-12B-it");

    // And a gated row is reported, not lost: at 40 GB/s the 8 GiB tier's
    // only fitting row (the LFM file, ~8 tok/s) is under its line, and the
    // refusal states its speed — not the "smallest one needs N bytes"
    // sentence an empty bucket would give.
    let tier = metal(8, 40.0e9);
    let refusal = match largest_that_runs_well(&tier) {
        Err(refusal) => refusal,
        Ok(pick) => panic!("{} is under its line and was offered anyway", pick.entry.repo),
    };
    assert_eq!(refusal.reason, RefusalReason::NothingFastEnough);
    let explanation = refusal.explanation;
    assert!(explanation.contains("tokens per second"), "{explanation}");
    assert!(
        !explanation.contains("smallest one in the catalog needs"),
        "the too-slow bucket must not read as the no-fit bucket: {explanation}"
    );
}
