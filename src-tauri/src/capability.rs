//! What the Brain page — the app's home — says about this computer, from
//! what was already kept: a [`kalsa_probe::Measurement`], the machine's RAM,
//! and the paired phone.
//!
//! Nothing here starts a server, decides a runtime or downloads anything — it
//! computes, purely, what the catalog would pick. The backend it answers with
//! is the **detected** one (`measurement.will_run_on`), never a build that
//! won: `startup::budget_backend` exists for the moment a build has won, but
//! this preview runs before any walk, so there is no winner and none may be
//! downloaded. The catalog's refusal is an answer, not an error — an unpaired
//! phone refuses with words the owner can act on, and they travel untouched.

use serde::Serialize;

use kalsa_catalog::{
    choose, decode_prediction, largest_that_runs_well, memory_budget, quicker_alternative, rows,
    usable, ChoiceInput, Decision, GIB, ModelEntry, PhoneModel, Prediction, RefusalReason,
    RunnableRow, Selection,
};
use kalsa_launch::funded_context;
use kalsa_probe::{Backend, Measurement};

use crate::startup::CHOOSER_CONTEXT_TOKENS;

/// The phone-free pick's sentence, written for that path: there is no
/// justification to report, because no comparison was ever made. The true
/// thing is that this is the biggest model the machine runs well, and the
/// phone is what would turn it into a comparison.
pub(crate) const PHONE_FREE_REASON: &str = "This is the biggest model this computer runs well. \
Pair your phone and the app can tell you whether it beats what the phone runs.";

/// The second option's sentence. It says the trade in the order the owner
/// needs it: what it gives (speed), what it costs (capability), and which of
/// the two is the stronger model — never leaving that to be inferred from the
/// sizes.
const QUICKER_REASON: &str = "Smaller and much faster: it starts answering sooner. \
The one above is the more capable of the two.";

/// The conversation length every speed on this page is priced at.
///
/// [`CHOOSER_CONTEXT_TOKENS`] is 1 on purpose, and must stay 1: it decides
/// *which* row, and pricing the cache there excludes nothing. But the cache is
/// re-read on every token, so it costs speed as well as memory, and a figure
/// quoted with an empty cache is the best case the owner will see once — at
/// the first word of the first conversation. This is the figure after a real
/// exchange, and the card says which length it is, because the honest answer
/// is that the speed falls as the conversation grows rather than that it is
/// one number.
///
/// It is a CEILING, not the figure: see [`shown_context`]. Quoting a speed at
/// 8192 tokens on a row the machine funds 1645 tokens of is a number nobody
/// can ever see, and a label the model cannot keep — Phi Mini was trained at
/// 4096 and the card said 8192 under it.
const SPEED_CONTEXT_TOKENS: u64 = 8192;

/// The conversation length one row's speed is priced at on this machine:
/// [`SPEED_CONTEXT_TOKENS`] where the memory funds it, the whole funded
/// window where it does not. `funded_context` already stops at the length the
/// model was trained for, so this cannot label a row with a window it never
/// had. `None` there means the row fits with nothing left for a cache at all;
/// the chooser's own one token is then the only context there is.
fn shown_context(entry: &ModelEntry, usable_bytes: u64) -> u64 {
    funded_context(entry, usable_bytes)
        .map_or(CHOOSER_CONTEXT_TOKENS, |funded| funded.min(SPEED_CONTEXT_TOKENS))
}

/// The answer the Brain page reads. `Unmeasured` when this run keeps no
/// measurement of the machine; otherwise the machine's facts and exactly one
/// of a pick and a refusal.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum CapabilityDto {
    /// This run has no measurement of the machine kept.
    Unmeasured,
    Measured {
        machine: MachineDto,
        /// The catalog's pick, when it has one.
        model: Option<ModelChoiceDto>,
        /// The second option: the most model this machine runs clearly faster
        /// than `model`. `None` when nothing does — offering two rows that
        /// feel the same is not a choice, and no machine is owed two.
        quicker: Option<ModelChoiceDto>,
        /// Why there is no pick, in the refusal's own words. Exactly one of
        /// `model` and `refusal` is Some.
        refusal: Option<String>,
    },
}

#[derive(Serialize)]
pub(crate) struct MachineDto {
    ram_bytes: u64,
    /// What a model may occupy, and whether the memory it will run in was
    /// accounted for (`MemoryBudget::gpu_accounted_for` false means a discrete
    /// card is present but unmeasured — say it, never hide it).
    budget_bytes: u64,
    gpu_accounted_for: bool,
    /// Where a model will decode, in the owner's words — not the enum name.
    runs_on: String,
    bandwidth_bytes_per_second: f64,
    /// Where the rate above comes from, because the three cases need three
    /// different sentences and a boolean could only tell two of them apart.
    /// `"measured"` — taken on the path the model will run on. `"floor"` —
    /// taken on a slower path, so the truth is above it. `"chip"` — the
    /// machine decodes on a GPU this probe cannot time, so the figure is the
    /// chip's published bandwidth scaled by a share measured on one like it.
    /// Saying "measured" for that last one would be a plain lie.
    bandwidth_basis: &'static str,
}

#[derive(Serialize)]
pub(crate) struct ModelChoiceDto {
    name: String,
    quant: String,
    weights_bytes: u64,
    /// The context this machine would actually fund for the row, from the
    /// launch arithmetic — never the chooser's one-token pricing, which on
    /// the screen would read "context window: 1 token". `None` when the row
    /// cannot fund even one token; the page shows nothing rather than a
    /// number that lies.
    context_tokens: Option<u64>,
    /// The conversation length the `speed` above is priced at. It travels as
    /// a number so the page can say it: a speed without the length it was
    /// measured at is the empty-cache best case wearing a general claim.
    speed_context_tokens: u64,
    speed: SpeedDto,
    /// `Selection::plain_reason` — already written for a human, pass it through.
    reason: String,
    /// `Selection::details` — the full working, for whoever asks.
    details: String,
}

#[derive(Serialize)]
#[serde(tag = "shape", rename_all = "snake_case")]
pub(crate) enum SpeedDto {
    Range { low: f64, high: f64 },
    AtLeast { value: f64 },
    Measured { value: f64, machine: String },
}

/// The answer, computed. The catalog's input is rebuilt here rather than
/// borrowed from `startup::choice_input`, whose backend is the budget path of
/// a build that has won — this preview has no winner, so it hands the catalog
/// the detected backend and says so. The context is the same
/// [`CHOOSER_CONTEXT_TOKENS`] the real walk prices candidates at, never a
/// second constant.
pub(crate) fn dto(
    measurement: &Measurement,
    ram_bytes: u64,
    phone: Option<PhoneModel>,
) -> CapabilityDto {
    let input = ChoiceInput {
        backend: measurement.will_run_on,
        ram_bytes,
        bandwidth_bytes_per_second: measurement.decode_bandwidth_bytes_per_second(),
        bandwidth_is_lower_bound: measurement.bandwidth_is_lower_bound(),
        compute_flops_per_second: measurement.compute.max(),
        context_tokens: CHOOSER_CONTEXT_TOKENS,
        phone,
    };
    let budget = memory_budget(input.backend, input.ram_bytes);
    let machine = MachineDto {
        ram_bytes: input.ram_bytes,
        budget_bytes: budget.usable_bytes,
        gpu_accounted_for: budget.gpu_accounted_for,
        runs_on: runs_on_words(input.backend),
        bandwidth_bytes_per_second: input.bandwidth_bytes_per_second,
        bandwidth_basis: if measurement.decode_bytes_per_second.is_some() {
            "chip"
        } else if input.bandwidth_is_lower_bound {
            "floor"
        } else {
            "measured"
        },
    };
    // The pick, its prediction, and the refusal — exactly one of the first and
    // the last. The prediction travels because the second option is defined
    // against the row actually on the page, which two different roads reach.
    let (model, decode, refusal) = match choose(&input) {
        Decision::Pick(selection) => {
            let row = chosen_row(&selection);
            let context = row.map_or(CHOOSER_CONTEXT_TOKENS, |row| {
                shown_context(row, budget.usable_bytes)
            });
            let shown = row
                .and_then(|row| shown_decode(row, &input, context))
                .unwrap_or(selection.decode);
            (
                Some(ModelChoiceDto {
                    name: selection.display_name.to_string(),
                    quant: selection.quant.to_string(),
                    weights_bytes: selection.weights_bytes,
                    context_tokens: row.and_then(|row| funded_context(row, budget.usable_bytes)),
                    speed_context_tokens: context,
                    speed: speed(&shown),
                    reason: selection.plain_reason,
                    details: selection.details,
                }),
                Some(shown),
                None,
            )
        }
        Decision::Refuse(refusal) => match refusal.reason {
            // The commonest first run has no phone paired. `choose` answers
            // "is this computer an upgrade?" and without a phone that has no
            // answer; the page asks "what can this computer run?", and that
            // one is answerable — the largest row that fits and runs well.
            // Every other refusal is a real one and keeps its own words.
            RefusalReason::PhoneUnknown => match largest_that_runs_well(&input) {
                Ok(row) => {
                    let context = shown_context(row.entry, budget.usable_bytes);
                    let shown =
                        shown_decode(row.entry, &input, context).unwrap_or(row.decode);
                    (
                        Some(ModelChoiceDto {
                            name: row.entry.display_name.to_string(),
                            quant: row.entry.quant.to_string(),
                            weights_bytes: row.entry.weights_bytes,
                            context_tokens: funded_context(row.entry, budget.usable_bytes),
                            speed_context_tokens: context,
                            speed: speed(&shown),
                            reason: PHONE_FREE_REASON.to_string(),
                            // The working quotes the same figure as the line
                            // above it: built from `row.decode` it quoted the
                            // chooser's one-token price instead, and the card
                            // carried two speeds for one model, one click apart.
                            details: phone_free_details(&row, &shown),
                        }),
                        Some(shown),
                        None,
                    )
                }
                // The phone-free question refused for its own reason — the
                // machine unmeasured, nothing fitting, everything too slow —
                // and those are the words that answer, not the pair-first
                // sentence that no longer gates anything.
                Err(fallback) => (None, None, Some(fallback.explanation)),
            },
            _ => (None, None, Some(refusal.explanation)),
        },
    };
    // Against the row on the page, not against the biggest that fits: with a
    // phone paired those can differ, and "faster" has to mean faster than
    // what the owner is looking at.
    let shown_input = ChoiceInput {
        context_tokens: SPEED_CONTEXT_TOKENS,
        ..input
    };
    let quicker = decode
        .and_then(|prediction| quicker_alternative(&shown_input, &prediction))
        .map(|row| {
            let context = shown_context(row.entry, budget.usable_bytes);
            let shown = shown_decode(row.entry, &input, context).unwrap_or(row.decode);
            ModelChoiceDto {
                name: row.entry.display_name.to_string(),
                quant: row.entry.quant.to_string(),
                weights_bytes: row.entry.weights_bytes,
                context_tokens: funded_context(row.entry, budget.usable_bytes),
                speed_context_tokens: context,
                speed: speed(&shown),
                reason: QUICKER_REASON.to_string(),
                details: alternative_details(&row, &shown),
            }
        });
    CapabilityDto::Measured {
        machine,
        model,
        quicker,
        refusal,
    }
}

/// The decode figure the page shows for a row: the same catalog arithmetic,
/// priced at a conversation of real length instead of an empty cache. `None`
/// only if the row is not on the menu, which cannot happen for a row the
/// chooser just picked — the fallback is then the selection's own figure.
fn shown_decode(entry: &ModelEntry, input: &ChoiceInput, context: u64) -> Option<Prediction> {
    let shown = ChoiceInput {
        context_tokens: context,
        ..*input
    };
    usable()
        // The same identity `chosen_row` matches on, minus the display name
        // it does not have here: a repo alone is not a key, and pricing the
        // wrong row's cache would be a wrong number with a right label.
        .find(|row| {
            let row = row.entry();
            row.repo == entry.repo
                && row.quant == entry.quant
                && row.weights_bytes == entry.weights_bytes
        })
        .map(|row| decode_prediction(row, &shown))
}

/// Decode speed as the three shapes the UI can say. `Estimate` is a prefill
/// shape decode never produces; if one ever arrived, "at least" is the honest
/// rendering, not a panic.
fn speed(prediction: &Prediction) -> SpeedDto {
    match *prediction {
        Prediction::Range { low, high } => SpeedDto::Range { low, high },
        Prediction::Floor(value) | Prediction::Estimate(value) => SpeedDto::AtLeast { value },
        Prediction::Measured {
            tokens_per_second,
            machine,
        } => SpeedDto::Measured {
            value: tokens_per_second,
            // The card has one line for this; the row's full provenance —
            // backend, cache quantisation, context, date — is already in the
            // working below it, so the label here is the machine's name and
            // stops at the parenthesis the rest of it opens.
            machine: machine
                .split_once(" (")
                .map_or(machine, |(name, _)| name)
                .to_string(),
        },
    }
}

/// The backend in the owner's words — the UI does not translate enums.
fn runs_on_words(backend: Backend) -> String {
    match backend {
        Backend::Metal => "the graphics chip".to_string(),
        Backend::Cpu => "the processor".to_string(),
        Backend::DiscreteGpu { .. } => "the graphics card".to_string(),
        Backend::Unknown => "this computer".to_string(),
    }
}

/// The catalog row behind the pick, matched on the same identity
/// `startup::chosen_row` uses — repo alone is not a key — and pinned unique
/// by the catalog's own test. The row, not the selection, is what the context
/// arithmetic runs on: the measured per-token cache figure travels there.
fn chosen_row(selection: &Selection) -> Option<&'static ModelEntry> {
    rows().find(|entry| {
        entry.repo == selection.repo
            && entry.display_name == selection.display_name
            && entry.quant == selection.quant
            && entry.weights_bytes == selection.weights_bytes
    })
}

/// A row's speed, in the owner's words: the figure, where it comes from, and
/// whether it was timed somewhere else. Written to be true of any row — the
/// contradiction it replaces was "62.7 tok/s, measured on an M1 Max … The speed
/// is a prediction, not a measurement on this machine", which said both things
/// in one breath.
fn speed_words(decode: &Prediction) -> String {
    match *decode {
        Prediction::Range { low, high } => format!(
            "Predicted {low:.1}–{high:.1} tok/s, worked out from this computer's memory speed."
        ),
        // The rate was measured on a slower path than the model will run on:
        // a floor, never printed as the rate the model will reach.
        Prediction::Floor(_) | Prediction::Estimate(_) => {
            "A floor: timed on a slower path than the model will run on.".to_string()
        }
        // The full provenance is kept — this is the drawer, and which backend
        // and cache produced the figure is what makes it worth quoting.
        Prediction::Measured {
            tokens_per_second,
            machine,
        } => format!("{tokens_per_second:.1} tok/s, timed on {machine} — not on this machine."),
    }
}

/// What one row is, for the drawer: its name, its weight, and where its speed
/// figure comes from. No claim about being the largest — that belongs to the
/// pick alone, and this is what the *second* option says, which exists because
/// it is smaller.
fn alternative_details(row: &RunnableRow, decode: &Prediction) -> String {
    format!(
        "{} — {:.1} GiB of weights. {}",
        row.entry.display_name,
        row.entry.weights_bytes as f64 / GIB as f64,
        speed_words(decode)
    )
}

/// The full working for the phone-free pick: what was compared, what was not,
/// and where its speed figure comes from. Two things are said here and nowhere
/// else — the machine's own "no phone" sentence, and the claim to be the largest
/// that fits, which is true of this row only and was being said of both.
fn phone_free_details(row: &RunnableRow, decode: &Prediction) -> String {
    format!(
        "No phone is paired, so nothing here is compared to one. {} — {:.1} GiB of weights, \
         the largest that fits this machine's {:.1} GiB budget. {}",
        row.entry.display_name,
        row.entry.weights_bytes as f64 / GIB as f64,
        row.budget.usable_bytes as f64 / GIB as f64,
        speed_words(decode)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const GIB: u64 = 1_073_741_824;

    #[test]
    fn the_json_the_page_reads_is_a_contract_pinned_here() {
        let dto = CapabilityDto::Measured {
            // One state the backend can actually produce: a Metal machine
            // decodes on the graphics chip, and a rate measured on the CPU
            // path beneath it is then always a floor.
            machine: MachineDto {
                ram_bytes: 17 * GIB,
                budget_bytes: 13 * GIB,
                gpu_accounted_for: true,
                runs_on: "the graphics chip".to_string(),
                bandwidth_bytes_per_second: 197.0e9,
                bandwidth_basis: "chip",
            },
            model: Some(ModelChoiceDto {
                name: "IBM Granite 4 Tiny".to_string(),
                quant: "Q4_K_M".to_string(),
                weights_bytes: 4_000_000_000,
                context_tokens: Some(4584),
                speed_context_tokens: SPEED_CONTEXT_TOKENS,
                speed: SpeedDto::Range {
                    low: 12.0,
                    high: 21.0,
                },
                reason: "It runs a clearly bigger model than your phone does.".to_string(),
                details: "the full working".to_string(),
            }),
            // The second option is part of the contract, so the sample shows
            // one: a page that never sees the field cannot be trusted to
            // render it the first time a machine produces one.
            quicker: Some(ModelChoiceDto {
                name: "Arcee Trinity Nano".to_string(),
                quant: "Q4_K_M".to_string(),
                weights_bytes: 3_786_957_088,
                context_tokens: Some(8192),
                speed_context_tokens: SPEED_CONTEXT_TOKENS,
                speed: SpeedDto::Measured {
                    value: 62.7,
                    machine: "an M1 Max".to_string(),
                },
                reason: QUICKER_REASON.to_string(),
                details: "the full working".to_string(),
            }),
            refusal: None,
        };
        let json = serde_json::to_value(&dto).expect("serialise");
        println!("{}", serde_json::to_string_pretty(&dto).expect("serialise"));
        assert_eq!(json["kind"], "measured");
        assert_eq!(
            json["machine"]["ram_bytes"],
            serde_json::to_value(17 * GIB).unwrap()
        );
        assert_eq!(json["machine"]["budget_bytes"], 13 * GIB);
        assert_eq!(json["machine"]["gpu_accounted_for"], true);
        assert_eq!(json["machine"]["runs_on"], "the graphics chip");
        assert_eq!(json["machine"]["bandwidth_basis"], "chip");
        assert_eq!(json["model"]["name"], "IBM Granite 4 Tiny");
        assert_eq!(json["model"]["speed"]["shape"], "range");
        assert_eq!(json["model"]["speed"]["low"], 12.0);
        assert_eq!(json["model"]["speed"]["high"], 21.0);
        assert_eq!(json["quicker"]["name"], "Arcee Trinity Nano");
        assert_eq!(json["quicker"]["speed"]["shape"], "measured");
        assert_eq!(json["refusal"], serde_json::Value::Null);
        let mut top_keys: Vec<_> = json.as_object().unwrap().keys().collect();
        top_keys.sort();
        assert_eq!(top_keys, ["kind", "machine", "model", "quicker", "refusal"]);
        // The exact key sets, so a renamed or added field breaks loudly:
        // these are the names the frontend reads, and there is no fifth.
        // Both sides sorted: the contract is the set of names, whatever
        // order serde_json's map happens to keep.
        let mut machine_keys: Vec<_> = json["machine"].as_object().unwrap().keys().collect();
        machine_keys.sort();
        assert_eq!(
            machine_keys,
            [
                "bandwidth_basis",
                "bandwidth_bytes_per_second",
                "budget_bytes",
                "gpu_accounted_for",
                "ram_bytes",
                "runs_on"
            ]
        );
        let mut model_keys: Vec<_> = json["model"].as_object().unwrap().keys().collect();
        model_keys.sort();
        assert_eq!(
            model_keys,
            [
                "context_tokens",
                "details",
                "name",
                "quant",
                "reason",
                "speed",
                "speed_context_tokens",
                "weights_bytes"
            ]
        );
        // Both options are the same shape, so one key set governs both.
        let mut quicker_keys: Vec<_> = json["quicker"].as_object().unwrap().keys().collect();
        quicker_keys.sort();
        assert_eq!(quicker_keys, model_keys);
        let unmeasured =
            serde_json::to_value(CapabilityDto::Unmeasured).expect("serialise");
        assert_eq!(unmeasured, serde_json::json!({ "kind": "unmeasured" }));

        // The fixture the Playwright harness validates against is written
        // from this very value, so it cannot drift from the Rust type: a
        // field added above appears there on the next `cargo test`, and a
        // stale sample shows up as a dirty file instead of as a green suite.
        // Only the sample is replaced — the hand-written keys beside it say
        // things one sample cannot show.
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../chat/scripts/capability-contract.json");
        if let Ok(text) = std::fs::read_to_string(&path) {
            let mut contract: serde_json::Value =
                serde_json::from_str(&text).expect("the contract file is json");
            contract["sample"] = json;
            let written =
                serde_json::to_string_pretty(&contract).expect("serialise the contract");
            std::fs::write(&path, format!("{written}\n")).expect("write the contract");
        }
    }

    #[test]
    fn every_prediction_shape_maps_to_the_speed_the_page_can_say() {
        assert!(matches!(
            speed(&Prediction::Range { low: 12.0, high: 21.0 }),
            SpeedDto::Range { low, high } if low == 12.0 && high == 21.0
        ));
        assert!(matches!(
            speed(&Prediction::Floor(3.0)),
            SpeedDto::AtLeast { value } if value == 3.0
        ));
        assert!(matches!(
            speed(&Prediction::Measured {
                tokens_per_second: 62.7,
                machine: "an M1 Max",
            }),
            SpeedDto::Measured { value, machine } if value == 62.7 && machine == "an M1 Max"
        ));
        // The prefill shape has no decode meaning; it degrades to "at least"
        // instead of panicking a preview that asked for decode.
        assert!(matches!(
            speed(&Prediction::Estimate(9.0)),
            SpeedDto::AtLeast { value } if value == 9.0
        ));
    }

    #[test]
    fn an_unpaired_phone_gets_the_largest_model_that_runs_not_a_dead_end() {
        // The commonest first run: a Mac with no phone paired. The page's
        // question — what can this computer run? — still has an answer; the
        // upgrade question is the one that waits for the phone.
        let suggestion = dto(&measured(Backend::Cpu), 16 * GIB, None);
        let CapabilityDto::Measured {
            model,
            refusal,
            ..
        } = suggestion
        else {
            panic!("a measured machine answers Measured, not Unmeasured");
        };
        let choice = model.expect("something runs well on a 16 GiB machine");
        assert!(refusal.is_none(), "a pick does not carry a refusal");
        let reason = choice.reason.to_ascii_lowercase();
        assert!(reason.contains("biggest"), "{reason}");
        assert!(reason.contains("pair"), "{reason}");
        assert!(!choice.details.is_empty(), "the working travels too");
        // And when nothing runs even without the comparison, the phone-free
        // question's own refusal answers — here, nothing fits — with its
        // words, not the pair-first sentence that no longer gates anything.
        let nothing_fits = dto(&measured(Backend::Cpu), 0, None);
        let CapabilityDto::Measured { model, refusal, .. } = nothing_fits else {
            panic!("a measured machine answers Measured, not Unmeasured");
        };
        assert!(model.is_none(), "nothing fits, nothing is offered");
        let spoken = refusal.expect("the fallback refusal keeps its words");
        assert!(spoken.contains("not worth using"), "{spoken}");
    }

    #[test]
    fn the_preview_shows_the_context_the_machine_funds_not_the_choosers_pricing() {
        // The chooser prices candidates at one token so it refuses nothing
        // the machine could fund at a smaller one; displayed, that pricing
        // reads "context window: 1 token". The pick's context comes from the
        // launch arithmetic instead.
        let phone = PhoneModel {
            weights_bytes: 2_200_000_000,
            parameters: Some(kalsa_catalog::Parameters::dense(4_000_000_000)),
            measured_tokens_per_second: None,
            battery_powered: Some(true),
        };
        let dto = dto(&measured(Backend::Cpu), 16 * GIB, Some(phone));
        let CapabilityDto::Measured {
            model: Some(choice),
            ..
        } = dto
        else {
            panic!("a measured machine with a paired phone gets a pick");
        };
        assert_ne!(
            choice.context_tokens,
            Some(CHOOSER_CONTEXT_TOKENS),
            "the chooser's pricing constant must never reach the screen"
        );
        let context = choice.context_tokens.expect("a funded row shows a context");
        assert!(context > 1, "a real, funded context: {context}");
    }

    /// A measurement by hand, so no test runs the probe: 80 GB/s on the CPU
    /// path, the shape the catalog predicts from.
    #[test]
    fn no_speed_is_quoted_at_a_context_the_machine_does_not_fund() {
        // The card used to price every speed at 8192 tokens whatever the row
        // was: Phi Mini was trained at 4096 and funds 1645 on an 8 GiB
        // machine, and the page still said 8192 under it. A length nobody can
        // reach is not a conversation the owner will ever have.
        for ram in [8, 16, 32, 64] {
            for backend in [Backend::Cpu, Backend::Metal] {
                let CapabilityDto::Measured { model, quicker, .. } =
                    dto(&measured(backend), ram * GIB, None)
                else {
                    panic!("{ram} GiB: a measured machine answers Measured");
                };
                for option in [model, quicker].into_iter().flatten() {
                    assert!(
                        option.speed_context_tokens <= SPEED_CONTEXT_TOKENS,
                        "{ram} GiB: {} priced above the ceiling",
                        option.name
                    );
                    if let Some(funded) = option.context_tokens {
                        assert!(
                            option.speed_context_tokens <= funded,
                            "{ram} GiB: {} priced at {} tokens, funded for {funded}",
                            option.name,
                            option.speed_context_tokens
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn only_the_pick_claims_to_be_the_largest_and_no_speed_contradicts_itself() {
        // Two defects in one string, both read off the screen on 2026-09-19: the
        // working is written for the pick and was applied to both rows, so the
        // second option — smaller, faster, and not the largest by definition —
        // claimed the pick's ground; and a figure that was measured was called a
        // prediction in the same breath ("62.7 tok/s, measured on an M1 Max …
        // The speed is a prediction, not a measurement on this machine").
        let CapabilityDto::Measured { model, quicker, .. } =
            dto(&measured(Backend::Cpu), 32 * GIB, None)
        else {
            panic!("a measured machine answers Measured");
        };
        let pick = model.expect("a 32 GiB machine runs something");
        let second = quicker.expect("a 32 GiB machine has something faster");

        assert!(
            pick.details.contains("largest"),
            "the pick claims its own ground: {}",
            pick.details
        );
        assert!(
            !second.details.contains("largest"),
            "the alternative claims the pick's ground: {}",
            second.details
        );
        assert!(
            !second.details.contains("No phone is paired"),
            "the machine's sentence is said once, not per row: {}",
            second.details
        );
        for option in [&pick, &second] {
            if matches!(&option.speed, SpeedDto::Measured { .. }) {
                assert!(
                    !option.details.contains("prediction"),
                    "{} was timed and is called a prediction: {}",
                    option.name,
                    option.details
                );
            }
        }
    }

    fn measured(backend: Backend) -> Measurement {
        Measurement {
            ramp: vec![(2, 80.0e9)],
            ceiling_bytes_per_second: 80.0e9,
            // No chip figure in a fixture: the test machine is whatever
            // `ceiling` says, so the floor rule stays the backend's own.
            decode_bytes_per_second: None,
            ceiling: kalsa_probe::Series::new(vec![80.0e9]),
            plateau_threads: 2,
            cache: kalsa_probe::Series::new(vec![200.0e9]),
            compute: kalsa_probe::Series::new(vec![100.0e9]),
            reliability: kalsa_probe::Reliability {
                reliable: true,
                effective_parallelism: None,
                threads: 2,
                spread: 0.0,
                cache_ratio: None,
                notes: Vec::new(),
            },
            measured_on: kalsa_probe::ExecutionPath::Cpu,
            will_run_on: backend,
        }
    }
}
