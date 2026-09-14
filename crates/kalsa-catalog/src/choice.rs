//! Which model to run, and why. Pure: no hardware, no I/O, no download.
//!
//! The order of the rules is the order of the product's logic: know the phone
//! first (a computer is only worth it if it beats what the user already has),
//! then size the budget to the path the model will take (a discrete GPU is
//! budgeted by its own memory, not the machine's), then throw out everything
//! that does not fit that budget *entirely* — split across GPU and CPU, a
//! model is slower than on the CPU alone — and only then offer something, for
//! one of exactly two reasons: capability (meaningfully more model than the
//! phone's) or relief (a comparable model, because the work moves off a phone
//! that is on battery).

use kalsa_probe::Backend;

use crate::candidate::{candidate, Candidate};
use crate::footprint::{memory_budget, Footprint, MemoryBudget};
use crate::licence::Licence;
use crate::manifest;
use crate::rationale::{band_text, gib_text, rationale};

/// The phone's model, as the pairing handshake reports it.
#[derive(Clone, Copy, Debug)]
pub struct PhoneModel {
    pub weights_bytes: u64,
    /// What the phone measures for itself, when it says. Used to *state* the
    /// comparison, never to invent one.
    pub measured_tokens_per_second: Option<f64>,
    /// Whether the phone is on battery, when the pairing handshake says. None
    /// until it does: relief is worth nothing to a phone on a charger, and
    /// inventing this bit would offer relief to exactly the phone that cannot
    /// use it.
    pub on_battery: Option<bool>,
}

#[derive(Clone, Copy, Debug)]
pub struct ChoiceInput {
    /// What this machine will run the model on, by detection. The memory
    /// budget branches on it: a discrete GPU is budgeted by its VRAM, and
    /// system RAM is irrelevant to a model that will decode there.
    pub backend: Backend,
    /// System RAM. The budget on a CPU machine or in unified memory; the
    /// fallback — said out loud — when a card's VRAM could not be read.
    pub ram_bytes: u64,
    pub bandwidth_bytes_per_second: f64,
    pub compute_flops_per_second: f64,
    /// The context the server will be configured with: the cache is sized from
    /// it, so a bigger context is part of the footprint, not a free parameter.
    pub context_tokens: u64,
    /// None until the phone has been paired and has said what it runs.
    pub phone: Option<PhoneModel>,
}

/// The PC must beat the phone, not match it — and the bar has to sit above the
/// top of the phone's own class, or that class gets sold back to the user as
/// an upgrade. Trinity-Nano (3_786_957_088 bytes) against the default phone
/// model (2_834_975_040) is 1.34×: more of the same, not a new class, and
/// exactly the pair the relief axis exists for. The bar sits at 1.4 so that a
/// capability claim means a genuinely different class of model, and anything
/// weaker has to say it is relief instead.
pub const IMPROVEMENT_RATIO: f64 = 1.4;

/// Below roughly reading speed a model is not usable interactively, whatever its
/// size and however good it is: recommending it would be the same mistake as the
/// courtesy tier, in reverse. Applied to the *low* end of the predicted range, so
/// a candidate is only proposed when even its pessimistic case is usable.
pub const MINIMUM_TOKENS_PER_SECOND: f64 = 3.0;

/// Two candidates whose weights are within this band of one another are the same
/// class: taking the faster one costs the user no quality. This is how the
/// mixture-of-experts preference is *checked* instead of assumed — decoding
/// benefits from few active parameters, prompt processing does not — and how a
/// relief candidate is held to the phone's own class rather than allowed to be
/// a downgrade.
pub const SAME_CLASS_BAND: f64 = 0.85;

/// Why this machine is being offered a model at all. Data the UI branches on,
/// not a string it parses: selling a lateral move as an upgrade is the failure
/// mode, and the two reasons deserve different pages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Justification {
    /// The model clears `IMPROVEMENT_RATIO` against the phone's: a different
    /// class of model, worth it whatever the phone's battery is doing.
    Capability,
    /// The model is comparable to the phone's, and it is offered only because
    /// the phone is on battery: every token generated on the PC is one the
    /// phone did not generate. `MINIMUM_TOKENS_PER_SECOND` still applies — a
    /// comparable model that crawls is a worse experience, not relief.
    Relief,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefusalReason {
    /// The phone has not said what it runs, so nothing can be compared to it.
    PhoneUnknown,
    /// No row in the catalog fits this machine's memory budget.
    NothingFits,
    /// Nothing that fits wins on either axis: nothing clears the improvement
    /// bar, and relief is unavailable — the phone is on a charger, has not
    /// said whether it is on battery, or runs something bigger than anything
    /// that fits here.
    NothingBetter,
    /// Everything that fits and would be worth running would be too slow to use.
    NothingFastEnough,
    /// The probe did not return usable numbers, so no speed can be predicted.
    MachineNotMeasured,
}

#[derive(Clone, Debug)]
pub struct Refusal {
    pub reason: RefusalReason,
    pub explanation: String,
}

#[derive(Clone, Debug)]
pub struct Selection {
    pub repo: &'static str,
    pub quant: &'static str,
    pub weights_bytes: u64,
    pub footprint: Footprint,
    /// The budget this was sized against: which memory, and whether the GPU is
    /// accounted for.
    pub budget: MemoryBudget,
    pub context_tokens: u64,
    /// Decode throughput as a range, never as a point.
    pub decode: (f64, f64),
    /// Prefill throughput as a **floor**: both ends are the same number and mean
    /// "at least this much" (see `Measurement::compute_is_lower_bound`).
    pub prefill: (f64, f64),
    /// The licence of the chosen row, as data: a conditional licence must be
    /// visible in the result, never silently presented as unconditional.
    pub licence: Licence,
    /// Why this is being offered: capability or relief.
    pub justification: Justification,
    pub rationale: String,
}

#[derive(Clone, Debug)]
pub enum Decision {
    Pick(Selection),
    Refuse(Refusal),
}

pub fn choose(input: &ChoiceInput) -> Decision {
    let Some(phone) = input.phone else {
        return Decision::Refuse(Refusal {
            reason: RefusalReason::PhoneUnknown,
            explanation: "No decision yet: we do not know which model your phone runs, \
                          and a computer is only worth it if it beats what you already have. \
                          Pair the phone first."
                .to_string(),
        });
    };

    if !measured(input.bandwidth_bytes_per_second) || !measured(input.compute_flops_per_second) {
        return Decision::Refuse(Refusal {
            reason: RefusalReason::MachineNotMeasured,
            explanation: "This computer has not been measured yet: run the probe first, \
                          otherwise any speed we quote would be a guess."
                .to_string(),
        });
    }

    let budget = memory_budget(input.backend, input.ram_bytes);
    let candidates: Vec<Candidate> = manifest::usable()
        .map(|entry| candidate(entry, input))
        .collect();

    // A candidate fits the chosen budget entirely or it is not a candidate for
    // this path. Measured upstream: 18.49 tok/s fully on the GPU, 12.19 on the
    // CPU, 5.68 split across both — the split is 2.15× slower than not using
    // the GPU at all, so "nearly fits, offload most of it" is a loss dressed
    // up as a win, and the fallback is the largest model that fits, never a
    // spill.
    let fitting: Vec<&Candidate> = candidates
        .iter()
        .filter(|candidate| candidate.footprint.total_bytes() <= budget.usable_bytes)
        .collect();
    if fitting.is_empty() {
        let smallest = candidates
            .iter()
            .map(|candidate| candidate.footprint.total_bytes())
            .min()
            .unwrap_or(0);
        return Decision::Refuse(Refusal {
            reason: RefusalReason::NothingFits,
            explanation: format!(
                "This computer is not worth using: it can give a model {} and the smallest \
                 one in the catalog needs {}.",
                gib_text(budget.usable_bytes),
                gib_text(smallest)
            ),
        });
    }

    let improving: Vec<&Candidate> = fitting
        .iter()
        .copied()
        .filter(|candidate| candidate.improves_on(&phone))
        .collect();
    // Relief candidates: the phone's own class or better, whether or not they
    // clear the improvement bar.
    let comparable: Vec<&Candidate> = fitting
        .iter()
        .copied()
        .filter(|candidate| {
            candidate.entry.weights_bytes as f64 >= phone.weights_bytes as f64 * SAME_CLASS_BAND
        })
        .collect();
    let fast = |candidate: &&Candidate| candidate.decode.0 >= MINIMUM_TOKENS_PER_SECOND;
    let on_battery = phone.on_battery == Some(true);

    // Capability first: the existing rule, worth it whatever the battery does.
    if improving.iter().any(fast) {
        let usable_speed: Vec<&Candidate> = improving.into_iter().filter(fast).collect();
        return Decision::Pick(pick(
            &usable_speed,
            input,
            &phone,
            budget,
            Justification::Capability,
        ));
    }

    // Then relief: a comparable model, but the work moves off the phone. Only
    // for a phone that IS on battery — on a charger the relief is worth
    // nothing, and when the phone has not said, we do not invent it.
    if on_battery && comparable.iter().any(fast) {
        let usable_speed: Vec<&Candidate> = comparable.into_iter().filter(fast).collect();
        return Decision::Pick(pick(
            &usable_speed,
            input,
            &phone,
            budget,
            Justification::Relief,
        ));
    }

    // Refuse, saying which axis failed.
    let any_candidate = !improving.is_empty() || !comparable.is_empty();
    let any_fast = improving.iter().chain(comparable.iter()).any(fast);
    if any_candidate && !any_fast {
        let fastest = improving
            .iter()
            .chain(comparable.iter())
            .map(|candidate| candidate.decode.1)
            .fold(0.0, f64::max);
        return Decision::Refuse(Refusal {
            reason: RefusalReason::NothingFastEnough,
            explanation: format!(
                "This computer is not worth using: the models that fit and would be worth \
                 running here would decode at about {} tokens per second, which is slower \
                 than reading.",
                band_text((0.0, fastest))
                    .trim_start_matches('0')
                    .trim_start_matches('–')
            ),
        });
    }

    let explanation = if !any_candidate {
        format!(
            "This computer is not worth using: everything that fits is smaller than the \
             model already on your phone ({}), so the work would move to a weaker model.",
            gib_text(phone.weights_bytes)
        )
    } else if phone.on_battery == Some(false) {
        format!(
            "This computer is not worth using: everything that fits would be no better than \
             the model already on your phone ({}), and with the phone on a charger, moving \
             the work there offers no relief either. Staying on the phone is the honest \
             answer.",
            gib_text(phone.weights_bytes)
        )
    } else {
        format!(
            "This computer is not worth using: everything that fits would be no better than \
             the model already on your phone ({}), and the phone has not said whether it is \
             on battery — the only other reason to move the work. Staying on the phone is \
             the honest answer.",
            gib_text(phone.weights_bytes)
        )
    };
    Decision::Refuse(Refusal {
        reason: RefusalReason::NothingBetter,
        explanation,
    })
}

/// A probe number we can compute with: positive and not a NaN.
fn measured(rate: f64) -> bool {
    rate.is_finite() && rate > 0.0
}

/// The biggest that fits, then — among models of the same class — the one the
/// numbers say decodes fastest. Both axes pick by the same rule.
fn pick(
    candidates: &[&Candidate],
    input: &ChoiceInput,
    phone: &PhoneModel,
    budget: MemoryBudget,
    justification: Justification,
) -> Selection {
    let leader = *candidates
        .iter()
        .max_by_key(|candidate| candidate.entry.weights_bytes)
        .expect("a non-empty list reaches pick");
    let band_floor = leader.entry.weights_bytes as f64 * SAME_CLASS_BAND;
    let chosen = candidates
        .iter()
        .filter(|candidate| candidate.entry.weights_bytes as f64 >= band_floor)
        .max_by(|a, b| {
            a.decode_ceiling()
                .partial_cmp(&b.decode_ceiling())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .copied()
        .unwrap_or(leader);

    Selection {
        repo: chosen.entry.repo,
        quant: chosen.entry.quant,
        weights_bytes: chosen.entry.weights_bytes,
        footprint: chosen.footprint,
        budget,
        context_tokens: input.context_tokens,
        decode: chosen.decode,
        prefill: chosen.prefill,
        licence: chosen.entry.licence,
        justification,
        rationale: rationale(chosen, input, phone, budget, justification),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bar exists to keep the phone's own class from being sold back as an
    /// upgrade. Trinity-Nano against the default phone model is 1.336× — the
    /// top of that class — so it must fail the capability check and reach the
    /// chooser through relief instead, while a genuinely bigger class clears.
    #[test]
    fn the_bar_sits_above_the_top_of_the_phones_own_class() {
        let trinity = 3_786_957_088u64;
        let phone = PhoneModel {
            weights_bytes: 2_834_975_040,
            measured_tokens_per_second: None,
            on_battery: None,
        };
        assert!(
            (trinity as f64) < phone.weights_bytes as f64 * IMPROVEMENT_RATIO,
            "Trinity must be a relief candidate, not a capability claim"
        );
        assert!(
            1.1 * trinity as f64 >= phone.weights_bytes as f64 * IMPROVEMENT_RATIO,
            "a genuinely bigger class still clears the bar"
        );
    }
}
