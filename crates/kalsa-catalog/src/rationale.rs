//! The words that travel with a decision, in two registers.
//!
//! The plain reason is for the person reading the screen: what the offer
//! means for them, in sentences they can hear without asking what a word
//! means. The details are for whoever wants the working — the same facts,
//! with the numbers, the caveats and the provenance. Both stay honest: a
//! caveat may live only in the details, but it may not vanish.

use crate::candidate::{too_slow_to_use, Candidate, Prediction};
use crate::choice::{CapabilityBasis, ChoiceInput, Justification, PhoneModel};
use crate::footprint::{MemoryBudget, GIB};

/// One or two sentences for the user: what the offer means for them. No
/// jargon, no internals, no numbers — the shell can show it as-is, and
/// everything technical lives in [`details`].
pub(crate) fn plain_reason(justification: Justification) -> String {
    match justification {
        Justification::Capability(_) => {
            "This is a clear step up from what your phone runs: a bigger, stronger model."
                .to_string()
        }
        Justification::ExpectedButUnmeasured => {
            "This should be better than what your phone runs; we have not checked it on \
             this computer yet, and we will."
                .to_string()
        }
        Justification::Relief => {
            "This is about as good as what your phone already runs, but doing the work \
             here keeps the heat and the battery drain off your phone."
                .to_string()
        }
    }
}

/// The full working, for whoever asks: speeds as ranges, floors as floors,
/// what was assumed, what is still missing, and where each claim came from.
pub(crate) fn details(
    chosen: &Candidate<'_>,
    input: &ChoiceInput,
    phone: &PhoneModel,
    budget: MemoryBudget,
    justification: Justification,
) -> String {
    // The head names the model as the user knows it, never by repo or quant:
    // those are ours, and this sentence is the user's. The shape of the
    // number decides the shape of the sentence: a floor gets words only —
    // tonight a floor figure was wrong by twenty times in front of the user,
    // so the formatter is not allowed digits for it — and a measurement
    // names the machine it was taken on.
    let mut parts = vec![match chosen.decode {
        Prediction::Floor(_) => format!(
            "{} ({} of weights): decoding and prompt-processing speeds on this machine \
             have not been measured — the probe runs on the CPU, the model will decode \
             on a faster path, and any figure here would be a guess. Both will be \
             measured on this machine.",
            chosen.entry.display_name,
            gib_text(chosen.entry.weights_bytes)
        ),
        Prediction::Measured {
            tokens_per_second,
            machine,
        } => format!(
            "{} ({} of weights): {:.1} tokens per second, as measured on {} — and \
             prompt processing on this machine not yet measured.",
            chosen.entry.display_name,
            gib_text(chosen.entry.weights_bytes),
            tokens_per_second,
            machine
        ),
        _ => format!(
            "{} ({} of weights): about {} tokens per second, and {} for prompt \
             processing.",
            chosen.entry.display_name,
            gib_text(chosen.entry.weights_bytes),
            render(&chosen.decode),
            render(&chosen.prefill)
        ),
    }];

    if chosen.entry.parameters.is_mixture() {
        parts.push(format!(
            "It is a mixture of experts: only {} of its {} parameters are read per token, \
             which is why decoding is quick. Prompt processing is limited by compute rather \
             than by bandwidth, so its own estimate above is what it will feel like.",
            billions(chosen.entry.parameters.active().count()),
            billions(chosen.entry.parameters.total().count())
        ));
    }

    // Why it is being offered at all, with the provenance a reviewer can
    // check: the same facts the Justification data carries.
    parts.push(match justification {
        Justification::Capability(CapabilityBasis::Parameters) => {
            "It is offered on capability: it is meaningfully more model than your phone \
             runs, not merely comparable to it."
                .to_string()
        }
        Justification::Capability(CapabilityBasis::PublishedDenseEquivalent {
            parameters,
            note,
            source,
        }) => {
            format!(
                "It is offered on capability, by the publisher's own comparison: {} places \
                 it near a dense model of {} parameters ({}), which is meaningfully more \
                 model than your phone runs.",
                source,
                billions(parameters),
                note
            )
        }
        Justification::ExpectedButUnmeasured => {
            "It is expected to be more model than your phone runs, but nothing published \
             settles a mixture-of-experts model against a dense one of the same total, so \
             it will be measured on this machine before it is called an upgrade."
                .to_string()
        }
        Justification::Relief => {
            "It is offered for relief rather than capability: the model is comparable to \
             what your phone already runs, and doing the work here keeps the heat and the \
             battery drain off a phone that is on battery."
                .to_string()
        }
    });

    // A sourced equivalence travels with its row even when the offer rests on
    // something weaker than it; only the publisher-route capability already
    // speaks for itself.
    if let Some(equivalent) = chosen.entry.dense_equivalent {
        if !matches!(
            justification,
            Justification::Capability(CapabilityBasis::PublishedDenseEquivalent { .. })
        ) {
            parts.push(format!(
                "Its publisher places it near a dense model of {} parameters: {} ({}).",
                billions(equivalent.parameters),
                equivalent.note,
                equivalent.source
            ));
        }
    }

    if let Some(slowest) = too_slow_to_use(input, &budget, chosen) {
        parts.push(format!(
            "A bigger model fits in this machine, but the numbers say it would run at about \
             {} tokens per second: slower than reading, so it is not offered.",
            render(&slowest)
        ));
    }

    parts.push(match phone.measured_tokens_per_second {
        // Both numbers, no verdict: one is measured and one is a range, and
        // calling a winner would be claiming a precision neither of them has.
        Some(phone_speed) => format!(
            "Your phone's own model does about {:.0} tokens per second, against that range.",
            phone_speed
        ),
        None => "Your phone has not reported its own speed, so that half of the comparison \
                 is missing."
            .to_string(),
    });

    if !budget.gpu_accounted_for {
        parts.push(
            "This machine's graphics could not be detected, so the budget is system RAM \
             and whatever the machine has is not accounted for."
                .to_string(),
        );
    }

    if chosen.footprint.kv_is_assumed(chosen.entry) {
        parts.push(format!(
            "Memory is an estimate: the cache per token for this model has not been measured \
             yet, so {} per token was assumed for a {} context.",
            size_text(chosen.footprint.kv_bytes / input.context_tokens.max(1)),
            size_text(chosen.footprint.kv_bytes)
        ));
    }

    parts.join(" ")
}

pub(crate) fn gib_text(bytes: u64) -> String {
    size_text(bytes)
}

/// One formatter, because there is only one question: which shape is it? A
/// range prints with an en dash, an estimate prints with ≈ — and a floor
/// prints NO figure at all: its number has been wrong by twenty times in
/// front of a user, so the type's words are all it may say. A degenerate
/// band (a failed measurement would make one) renders harmlessly instead of
/// taking the app down.
pub(crate) fn render(prediction: &Prediction) -> String {
    match *prediction {
        Prediction::Range { low, high } if high >= 10.0 => format!("{:.0}–{:.0}", low, high),
        Prediction::Range { low, high } => format!("{:.1}–{:.1}", low, high),
        Prediction::Floor(_) => "a decoding speed not yet measured on this machine"
            .to_string(),
        Prediction::Estimate(value) => format!("≈ {:.1}", value),
        Prediction::Measured {
            tokens_per_second,
            machine,
        } => format!("{tokens_per_second:.1} tok/s on {machine} (measured)"),
    }
}

fn billions(count: u64) -> String {
    format!("{:.1}B", count as f64 / 1e9)
}

/// Sizes in the unit that reads: a cache of 96 KiB is not "0.0 GiB".
fn size_text(bytes: u64) -> String {
    const MIB: u64 = 1024 * 1024;
    const KIB: u64 = 1024;
    if bytes >= GIB {
        format!("{:.1} GiB", bytes as f64 / GIB as f64)
    } else if bytes >= MIB {
        format!("{} MiB", bytes / MIB)
    } else {
        format!("{} KiB", bytes / KIB)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_floor_prints_words_and_a_range_prints_its_band() {
        // The shape is decided by the type, not by the caller picking a
        // formatter: one render, and a floor can never wear a figure —
        // tonight's floor was wrong by twenty times in front of the user.
        let floor = render(&Prediction::Floor(3.0));
        assert!(!floor.chars().any(|c| c.is_ascii_digit()), "{floor}");
        assert_eq!(floor, "a decoding speed not yet measured on this machine");
        assert_eq!(
            render(&Prediction::Range {
                low: 25.4,
                high: 32.6
            }),
            "25–33"
        );
        assert_eq!(
            render(&Prediction::Range {
                low: 0.5,
                high: 0.7
            }),
            "0.5–0.7",
            "below ten, a decimal"
        );
        assert_eq!(render(&Prediction::Estimate(16.7)), "≈ 16.7");
        let measured = render(&Prediction::Measured {
            tokens_per_second: 62.7,
            machine: "M1 Max",
        });
        assert!(measured.contains("62.7") && measured.contains("M1 Max"), "{measured}");
    }

    #[test]
    fn a_degenerate_band_renders_harmlessly() {
        // A failed measurement would produce a zero band. It must print, not
        // panic: formatting code never takes the app down in front of a user.
        assert_eq!(
            render(&Prediction::Range {
                low: 0.0,
                high: 0.0
            }),
            "0.0–0.0"
        );
    }
}
