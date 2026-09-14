//! The words that travel with a decision, in two registers.
//!
//! The plain reason is for the person reading the screen: what the offer
//! means for them, in sentences they can hear without asking what a word
//! means. The details are for whoever wants the working — the same facts,
//! with the numbers, the caveats and the provenance. Both stay honest: a
//! caveat may live only in the details, but it may not vanish.

use crate::candidate::{too_slow_to_use, Candidate};
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
    // those are ours, and this sentence is the user's.
    let mut parts = vec![format!(
        "{} ({} of weights): about {} tokens per second, and {} for prompt processing.",
        chosen.entry.display_name,
        gib_text(chosen.entry.weights_bytes),
        band_text(chosen.decode),
        floor_text(chosen.prefill.1)
    )];

    if chosen.entry.parameters.is_mixture() {
        parts.push(format!(
            "It is a mixture of experts: only {} of its {} parameters are read per token, \
             which is why decoding is quick. Prompt processing is limited by compute rather \
             than by bandwidth, so its own floor above is what it will feel like.",
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
            band_text(slowest)
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
            "A discrete GPU is present but its memory could not be read, so this budget is \
             system RAM and the card is not accounted for."
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

/// A floor is one number with a direction — the shape the probe prints —
/// never a degenerate range. Always one decimal: a floor is a measured
/// figure, and "≥ 16" would round away the digit that says so.
pub(crate) fn floor_text(value: f64) -> String {
    format!("≥ {:.1}", value)
}

pub(crate) fn gib_text(bytes: u64) -> String {
    size_text(bytes)
}

/// A range on purpose: from an approximate estimate a single figure would be a
/// made-up precision.
pub(crate) fn band_text((low, high): (f64, f64)) -> String {
    assert!(
        high > low,
        "a range needs two different ends: a single value is a floor, printed with floor_text"
    );
    if high >= 10.0 {
        format!("{:.0}–{:.0}", low, high)
    } else {
        // "0–1" for half a token per second would be a rounding that hides a
        // categorical difference: too slow to use.
        format!("{:.1}–{:.1}", low, high)
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
    fn a_floor_prints_as_a_floor() {
        assert_eq!(floor_text(16.1), "≥ 16.1");
        assert_eq!(floor_text(4.2), "≥ 4.2");
        assert_eq!(floor_text(50.0), "≥ 50.0");
    }

    #[test]
    #[should_panic(expected = "a range needs two different ends")]
    fn a_range_never_prints_two_equal_ends() {
        band_text((4.2, 4.2));
    }

    #[test]
    fn a_range_is_written_as_a_range() {
        assert_eq!(band_text((25.4, 32.6)), "25–33");
        assert_eq!(band_text((0.5, 0.7)), "0.5–0.7", "below ten, a decimal");
    }
}
