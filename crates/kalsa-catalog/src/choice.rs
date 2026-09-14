//! Which model to run, and why. Pure: no hardware, no I/O, no download.
//!
//! The order of the rules is the order of the product's logic: know the phone
//! first (a computer is only worth it if it beats what the user already has),
//! then size the budget to the path the model will take (a discrete GPU is
//! budgeted by its own memory, not the machine's), then throw out everything
//! that does not fit that budget *entirely* — split across GPU and CPU, a
//! model is slower than on the CPU alone — and only then offer something, in
//! the existing size order, from the first candidate that admits an honest
//! justification: capability (meaningfully more model than the phone's,
//! claimed on parameters within the same shape) or relief (a comparable model,
//! because the work moves off a phone that is on battery).

use kalsa_probe::Backend;

use crate::candidate::{candidate, Candidate};
use crate::footprint::{memory_budget, Footprint, MemoryBudget};
use crate::licence::Licence;
use crate::manifest;
use crate::parameters::Parameters;
use crate::rationale::{band_text, gib_text, rationale};

/// The phone's model, as the pairing handshake reports it.
#[derive(Clone, Copy, Debug)]
pub struct PhoneModel {
    pub weights_bytes: u64,
    /// The phone model's parameter counts, when the pairing handshake says.
    /// Capability is claimed against these, never against bytes; when the
    /// phone has not said, we do not invent it, and nothing is claimed as
    /// capability.
    pub parameters: Option<Parameters>,
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

/// The PC must beat the phone, not match it. The bar is a proxy, and says so:
/// what would replace it is the bake-off in `scripts/quality/`, measured on
/// the user's machine, which the plan names as the arbiter. A constant that
/// pretends to be a measurement is worse than one that admits it is a
/// placeholder — the byte version of this bar pretended, and it conflated
/// quantisation with size and size with shape. It now applies to parameters
/// only, within the same shape (see [`capability_claim`]); 1.4 carries the
/// same promise it made on bytes: the top of the phone's own class is not
/// sold back to the user as an upgrade.
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

/// The capability rule, on the quantity it was always supposed to compare.
///
/// Parameters, not bytes. File size is a proxy that fails in both directions:
/// the same model at Q8 is twice the bytes of itself at Q4 and not one bit
/// smarter, and a MoE's bytes say nothing about how much of it a token reads.
/// Parameters are quantisation-independent, which removes the first confound
/// outright.
///
/// The second confound is not solved but refused. Dense and mixture-of-experts
/// are different shapes, the rules of thumb for a MoE's "effective" parameter
/// count are unsourced, and inventing a constant to make a comparison come out
/// right is how the byte bar got into trouble. So a capability claim across
/// shapes is never made here; such a candidate falls to relief until a
/// measured comparison — the bake-off in `scripts/quality/`, on the user's
/// machine, which the plan names as the arbiter — says otherwise.
///
/// Within the same shape, the claim needs the bar cleared on both axes: a MoE
/// is claimed against a MoE on total and active alike, because the total is
/// what the model knows and the active is what a token costs.
pub fn capability_claim(candidate: Parameters, phone: Option<Parameters>) -> bool {
    let Some(phone) = phone else {
        return false; // the phone did not say; we do not invent it
    };
    if candidate.is_mixture() != phone.is_mixture() {
        return false; // no cross-shape claim without a measurement
    }
    candidate.total().count() as f64 >= phone.total().count() as f64 * IMPROVEMENT_RATIO
        && candidate.active().count() as f64 >= phone.active().count() as f64 * IMPROVEMENT_RATIO
}

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
    /// Nothing that fits wins on either axis: nothing admits a capability
    /// claim — the phone did not report parameters, the shapes differ, or the
    /// bar is not cleared — and relief is unavailable: the phone is on a
    /// charger, has not said whether it is on battery, or runs something
    /// bigger than anything that fits here.
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

    // No justification is worth asking for a crawl: a candidate below reading
    // speed is neither an upgrade nor relief, so it never reaches the walk.
    let mut remaining: Vec<&Candidate> = fitting
        .iter()
        .copied()
        .filter(|candidate| candidate.decode.0 >= MINIMUM_TOKENS_PER_SECOND)
        .collect();
    if remaining.is_empty() {
        let fastest = fitting
            .iter()
            .map(|candidate| candidate.decode.1)
            .fold(0.0, f64::max);
        return Decision::Refuse(Refusal {
            reason: RefusalReason::NothingFastEnough,
            explanation: format!(
                "This computer is not worth using: the models that fit would decode at \
                 about {} tokens per second, which is slower than reading.",
                band_text((0.0, fastest))
                    .trim_start_matches('0')
                    .trim_start_matches('–')
            ),
        });
    }

    // The existing preference, walked until a candidate admits an honest
    // justification: the biggest that fits, then — among models of the same
    // class — the one the numbers say decodes fastest. The biggest may admit
    // nothing (a MoE cannot be claimed over a dense phone on any parameter
    // count we are willing to invent, and a charger phone admits no relief),
    // and when it cannot, the walk falls through to what remains rather than
    // mislabelling the offer or hiding it.
    let on_battery = phone.on_battery == Some(true);
    while !remaining.is_empty() {
        let leader = *remaining
            .iter()
            .max_by_key(|candidate| candidate.entry.weights_bytes)
            .expect("remaining is not empty");
        let band_floor = leader.entry.weights_bytes as f64 * SAME_CLASS_BAND;
        let chosen = *remaining
            .iter()
            .filter(|candidate| candidate.entry.weights_bytes as f64 >= band_floor)
            .max_by(|a, b| {
                a.decode_ceiling()
                    .partial_cmp(&b.decode_ceiling())
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .expect("the leader is in its own class");
        let justification = if capability_claim(chosen.entry.parameters, phone.parameters) {
            Justification::Capability
        } else if on_battery
            && chosen.entry.weights_bytes as f64 >= phone.weights_bytes as f64 * SAME_CLASS_BAND
        {
            Justification::Relief
        } else {
            remaining.retain(|candidate| !std::ptr::eq(*candidate, chosen));
            continue;
        };
        return Decision::Pick(selection(
            chosen,
            input,
            &phone,
            budget,
            justification,
        ));
    }

    // Nothing that fits admitted a justification. Say which axis failed.
    let comparable: Vec<&Candidate> = fitting
        .iter()
        .copied()
        .filter(|candidate| {
            candidate.entry.weights_bytes as f64 >= phone.weights_bytes as f64 * SAME_CLASS_BAND
        })
        .collect();
    let comparable_fast = comparable
        .iter()
        .any(|candidate| candidate.decode.0 >= MINIMUM_TOKENS_PER_SECOND);
    let (reason, explanation) = if comparable.is_empty() {
        (
            RefusalReason::NothingBetter,
            format!(
                "This computer is not worth using: everything that fits is smaller than the \
                 model already on your phone ({}), so the work would move to a weaker model.",
                gib_text(phone.weights_bytes)
            ),
        )
    } else if !comparable_fast {
        (
            RefusalReason::NothingFastEnough,
            format!(
                "This computer is not worth using: the models that fit and would be worth \
                 running here would decode at about {} tokens per second, which is slower \
                 than reading.",
                band_text((0.0, fastest_ceiling(&comparable)))
                    .trim_start_matches('0')
                    .trim_start_matches('–')
            ),
        )
    } else if phone.on_battery == Some(false) {
        (
            RefusalReason::NothingBetter,
            format!(
                "This computer is not worth using: everything that fits would be no better \
                 than the model already on your phone ({}), and with the phone on a charger, \
                 moving the work there offers no relief either. Staying on the phone is the \
                 honest answer.",
                gib_text(phone.weights_bytes)
            ),
        )
    } else {
        (
            RefusalReason::NothingBetter,
            format!(
                "This computer is not worth using: everything that fits would be no better \
                 than the model already on your phone ({}), and the phone has not said \
                 whether it is on battery — the only other reason to move the work. Staying \
                 on the phone is the honest answer.",
                gib_text(phone.weights_bytes)
            ),
        )
    };
    Decision::Refuse(Refusal {
        reason,
        explanation,
    })
}

/// A probe number we can compute with: positive and not a NaN.
fn measured(rate: f64) -> bool {
    rate.is_finite() && rate > 0.0
}

fn fastest_ceiling(candidates: &[&Candidate]) -> f64 {
    candidates
        .iter()
        .map(|candidate| candidate.decode.1)
        .fold(0.0, f64::max)
}

/// The numbers and the sentence for the candidate the walk settled on.
fn selection(
    chosen: &Candidate,
    input: &ChoiceInput,
    phone: &PhoneModel,
    budget: MemoryBudget,
    justification: Justification,
) -> Selection {
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

    #[test]
    fn quantisation_cannot_fake_a_capability_claim() {
        // A dense 3.2B model at Q8 is about 3.3 GB on disk: more bytes than a
        // 4B phone model at Q4, and not one bit more model. The byte bar this
        // comparison used to use is cleared; the parameter bar refuses.
        assert!(
            3_300_000_000u64 as f64 >= 2_200_000_000u64 as f64 * IMPROVEMENT_RATIO,
            "the byte bar is cleared, which is exactly what made bytes the wrong quantity"
        );
        assert!(!capability_claim(
            Parameters::dense(3_200_000_000),
            Some(Parameters::dense(4_000_000_000))
        ));
    }

    #[test]
    fn a_moe_never_claims_capability_over_a_dense_phone() {
        // Trinity-Nano is 6B total: 1.5× the phone's 4B, clearing the bar on
        // parameters — and the claim is still refused, because MoE against
        // dense is a claim across shapes, and no sourced rule turns one into
        // the other. Its 1.34× bytes were the symptom that exposed the wrong
        // quantity; the shape rule is the fix that survives the next pair.
        let trinity = Parameters::mixture(6_000_000_000, 1_000_000_000);
        let phone = Parameters::dense(4_000_000_000);
        assert!(
            trinity.total().count() as f64 >= phone.total().count() as f64 * IMPROVEMENT_RATIO,
            "the parameter bar is cleared; only the shape rule refuses"
        );
        assert!(!capability_claim(trinity, Some(phone)));
    }

    #[test]
    fn a_phone_that_never_reported_parameters_never_yields_capability() {
        assert!(!capability_claim(Parameters::dense(12_000_000_000), None));
    }

    #[test]
    fn moe_capability_needs_both_axes() {
        // MoE against MoE is the honest comparison, on total AND active: the
        // total is what the model knows, the active is what a token costs.
        let phone = Parameters::mixture(8_000_000_000, 2_000_000_000);
        assert!(capability_claim(
            Parameters::mixture(35_000_000_000, 3_000_000_000),
            Some(phone)
        ));
        // The total clears 4×; the active count does not clear the bar, and
        // the claim goes with it.
        assert!(!capability_claim(
            Parameters::mixture(35_000_000_000, 2_500_000_000),
            Some(phone)
        ));
    }
}
