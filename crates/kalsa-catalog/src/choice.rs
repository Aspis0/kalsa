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
//! claimed on parameters within the same shape, or on a publisher's own dense
//! comparison) or relief (a comparable model, because the work moves off a
//! device that runs on battery).

use kalsa_probe::Backend;

use crate::candidate::{candidate, Candidate};
use crate::footprint::{memory_budget, Footprint, MemoryBudget};
use crate::licence::Licence;
use crate::manifest::{self, DenseEquivalent};
use crate::parameters::Parameters;
use crate::rationale::{band_text, details, gib_text, plain_reason};

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
    /// Whether the device runs on battery at all — a property of the device,
    /// settled once at pairing. Deliberately not "is it charging right now":
    /// that changes by the hour and rides with each request, which makes it
    /// the request router's business, not the catalog's. None until the
    /// handshake says; relief is only claimed for a battery-powered device.
    pub battery_powered: Option<bool>,
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
/// The second confound — MoE against dense — is settled per row or not at
/// all. `sqrt(total × active)` and its cousins are uncited folklore, every
/// published MoE scaling law is conditional on training tokens and compute
/// and none yields "given total and active, use dense size f(total, active)",
/// and below roughly ten billion total parameters a MoE can be *worse* than a
/// same-total dense model (Jelassi et al., Mixture of Parrots, ICLR 2025) —
/// our 8 GB tier sits exactly in that regime. So the claim is made two ways
/// and no third: the same shape as the phone, on the parameter bar; or the
/// row's own publisher comparing it, in their benchmark table, to a dense
/// model from the same lab — carried on the row as [`DenseEquivalent`] and
/// compared against the phone's dense size. Anything else is not capability.
///
/// What replaces even this: the bake-off in `scripts/quality/`, run on the
/// user's own machine on the actual pair. Measuring is required, and no
/// citable rule settles it.
pub fn capability_basis(
    candidate: Parameters,
    dense_equivalent: Option<DenseEquivalent>,
    phone: Option<Parameters>,
) -> Option<CapabilityBasis> {
    let Some(phone) = phone else {
        return None; // the phone did not say; we do not invent it
    };
    if candidate.is_mixture() == phone.is_mixture() {
        let clears = candidate.total().count() as f64
            >= phone.total().count() as f64 * IMPROVEMENT_RATIO
            && candidate.active().count() as f64
                >= phone.active().count() as f64 * IMPROVEMENT_RATIO;
        if clears {
            return Some(CapabilityBasis::Parameters);
        }
    }
    // The publisher's own comparison, against a dense phone only: a MoE
    // phone's dense size is not known either, and none is invented for it.
    if !phone.is_mixture() {
        if let Some(equivalent) = dense_equivalent {
            if equivalent.parameters as f64
                >= phone.total().count() as f64 * IMPROVEMENT_RATIO
            {
                return Some(CapabilityBasis::PublishedDenseEquivalent {
                    parameters: equivalent.parameters,
                    note: equivalent.note,
                    source: equivalent.source,
                });
            }
        }
    }
    None
}

/// Below this many total parameters, an unsourced MoE is not credited with
/// "expected stronger than a dense phone": Jelassi et al. (Mixture of
/// Parrots, ICLR 2025) find that in this regime, at fixed active parameters,
/// extra experts help memorisation more than reasoning, and a MoE can be
/// worse than a same-total dense model on commonsense and maths — our 8 GB
/// tier sits inside it. Above the line, an unsourced MoE that clears the
/// parameter bar against a dense phone is [`Justification::ExpectedButUnmeasured`]:
/// expected, never claimed, and settled only by measuring on the user's
/// machine.
pub const LARGE_MOE_TOTAL_PARAMETERS: u64 = 10_000_000_000;

/// The third state's admission rule: a MoE with no published equivalence,
/// against a dense phone that reported parameters, big enough that the
/// small-MoE caveat above no longer blocks the inference, and clearing the
/// parameter bar on the total. "Expected to be stronger, not yet measured" —
/// as distinct from relief, which would falsely call it comparable, and from
/// capability, which would claim more than anything citable supports.
fn expected_but_unmeasured(candidate: &Candidate, phone: &PhoneModel) -> bool {
    let Some(phone) = phone.parameters else {
        return false;
    };
    let params = candidate.entry.parameters;
    if !params.is_mixture() || phone.is_mixture() || candidate.entry.dense_equivalent.is_some() {
        return false;
    }
    params.total().count() >= LARGE_MOE_TOTAL_PARAMETERS
        && params.total().count() as f64 >= phone.total().count() as f64 * IMPROVEMENT_RATIO
}

/// The evidence behind a capability claim. Both routes are data — the phone's
/// own reported parameters, or the row's publisher's own comparison — never a
/// formula that converts one shape to another.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapabilityBasis {
    /// Same shape as the phone's model, parameter bar cleared on both axes.
    Parameters,
    /// The row's publisher places it near a dense model of this many
    /// parameters, which clears the bar against the phone's dense size.
    PublishedDenseEquivalent {
        parameters: u64,
        note: &'static str,
        source: &'static str,
    },
}

/// Why this machine is being offered a model at all. Data the UI branches on,
/// not a string it parses: selling a lateral move as an upgrade is the failure
/// mode, and the two reasons deserve different pages. Three states, and three
/// is the ceiling: a fourth "unknown" would be a refusal wearing a bow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Justification {
    /// A strong claim, carrying the evidence that supports it.
    Capability(CapabilityBasis),
    /// The model is comparable to the phone's, and it is offered only because
    /// the device runs on battery: every token generated on the PC is one the
    /// phone did not generate. `MINIMUM_TOKENS_PER_SECOND` still applies — a
    /// comparable model that crawls is a worse experience, not relief.
    Relief,
    /// The numbers point clearly toward stronger — the total parameter bar is
    /// cleared, above the size regime where the literature warns the
    /// comparison reverses — but nothing citable settles a MoE against a
    /// dense model of the same total, so this is expected, never claimed.
    /// The bake-off in `scripts/quality/`, run on the user's machine on the
    /// actual pair, is what confirms it; measuring is required and no citable
    /// rule settles it.
    ExpectedButUnmeasured,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefusalReason {
    /// The phone has not said what it runs, so nothing can be compared to it.
    PhoneUnknown,
    /// No row in the catalog fits this machine's memory budget.
    NothingFits,
    /// Nothing that fits wins on either axis: nothing admits a capability
    /// claim — the phone did not report parameters, the shapes differ, or the
    /// bar is not cleared — and relief is unavailable: the device does not
    /// run on battery, has not said whether it does, or runs something bigger
    /// than anything that fits here.
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
    /// The name the shell renders: the only model identity the user sees.
    pub display_name: &'static str,
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
    /// The publisher's own dense comparison for the chosen row, when one
    /// exists: recorded even when the offer is relief, because the evidence
    /// travels with the row wherever the row goes.
    pub dense_equivalent: Option<DenseEquivalent>,
    /// Why this is being offered: capability, expected-but-unmeasured, or
    /// relief.
    pub justification: Justification,
    /// One or two sentences for the user: what the offer means for them. No
    /// jargon and no numbers; the shell can show it as-is.
    pub plain_reason: String,
    /// The full working for whoever asks: speeds, the expert split, what was
    /// assumed, what is still missing, where each claim came from. Nothing
    /// deleted from here just because it is technical.
    pub details: String,
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
    // nothing (a small unsourced MoE can claim neither capability nor
    // expected strength, and a device that does not run on battery admits no
    // relief), and when it cannot, the walk falls through to what remains
    // rather than mislabelling the offer or hiding it.
    let battery_powered = phone.battery_powered == Some(true);
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
        let justification = if let Some(basis) =
            capability_basis(chosen.entry.parameters, chosen.entry.dense_equivalent, phone.parameters)
        {
            Justification::Capability(basis)
        } else if expected_but_unmeasured(chosen, &phone) {
            Justification::ExpectedButUnmeasured
        } else if battery_powered
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
    } else if phone.battery_powered == Some(false) {
        (
            RefusalReason::NothingBetter,
            format!(
                "This computer is not worth using: everything that fits would be no better \
                 than the model already on your phone ({}), and the device does not run on \
                 battery, so moving the work there offers no relief either. Staying on the \
                 phone is the honest answer.",
                gib_text(phone.weights_bytes)
            ),
        )
    } else {
        (
            RefusalReason::NothingBetter,
            format!(
                "This computer is not worth using: everything that fits would be no better \
                 than the model already on your phone ({}), and the phone has not said \
                 whether it runs on battery — the only other reason to move the work. \
                 Staying on the phone is the honest answer.",
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
        display_name: chosen.entry.display_name,
        quant: chosen.entry.quant,
        weights_bytes: chosen.entry.weights_bytes,
        footprint: chosen.footprint,
        budget,
        context_tokens: input.context_tokens,
        decode: chosen.decode,
        prefill: chosen.prefill,
        licence: chosen.entry.licence,
        dense_equivalent: chosen.entry.dense_equivalent,
        justification,
        plain_reason: plain_reason(justification),
        details: details(chosen, input, phone, budget, justification),
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
        assert!(capability_basis(
            Parameters::dense(3_200_000_000),
            None,
            Some(Parameters::dense(4_000_000_000))
        )
        .is_none());
    }

    #[test]
    fn an_unsourced_moe_never_claims_capability_over_a_dense_phone() {
        // Trinity-Nano is 6B total: 1.5× the phone's 4B, clearing the bar on
        // parameters — and the claim is still refused, because MoE against
        // dense is a claim across shapes, no sourced rule converts the shapes,
        // and Trinity publishes nothing that would settle it.
        let trinity = Parameters::mixture(6_000_000_000, 1_000_000_000);
        let phone = Parameters::dense(4_000_000_000);
        assert!(
            trinity.total().count() as f64 >= phone.total().count() as f64 * IMPROVEMENT_RATIO,
            "the parameter bar is cleared; only the missing evidence refuses"
        );
        assert!(capability_basis(trinity, None, Some(phone)).is_none());
    }

    #[test]
    fn a_sourced_equivalent_claims_capability_only_when_it_clears_the_bar() {
        // Microsoft's own table places Phi-mini near dense 3.8B: against a
        // dense 2B phone that is capability, and the evidence travels with
        // the claim.
        let phi = Parameters::mixture(7_600_000_000, 2_400_000_000);
        let equivalent = DenseEquivalent {
            parameters: 3_800_000_000,
            note: "near Phi-3 mini",
            source: "model card",
        };
        assert_eq!(
            capability_basis(phi, Some(equivalent), Some(Parameters::dense(2_000_000_000))),
            Some(CapabilityBasis::PublishedDenseEquivalent {
                parameters: 3_800_000_000,
                note: "near Phi-3 mini",
                source: "model card",
            })
        );
        // Against a dense 4B phone the same published figure says phone-class:
        // the evidence is allowed to refuse, too.
        assert!(capability_basis(phi, Some(equivalent), Some(Parameters::dense(4_000_000_000)))
            .is_none());
    }

    #[test]
    fn a_phone_that_never_reported_parameters_never_yields_capability() {
        assert!(capability_basis(Parameters::dense(12_000_000_000), None, None).is_none());
        assert!(capability_basis(
            Parameters::mixture(35_000_000_000, 3_000_000_000),
            None,
            None
        )
        .is_none());
    }

    #[test]
    fn moe_capability_needs_both_axes() {
        // MoE against MoE is the honest comparison, on total AND active: the
        // total is what the model knows, the active is what a token costs.
        let phone = Parameters::mixture(8_000_000_000, 2_000_000_000);
        assert_eq!(
            capability_basis(
                Parameters::mixture(35_000_000_000, 3_000_000_000),
                None,
                Some(phone)
            ),
            Some(CapabilityBasis::Parameters)
        );
        // The total clears 4×; the active count does not clear the bar, and
        // the claim goes with it.
        assert!(capability_basis(
            Parameters::mixture(35_000_000_000, 2_500_000_000),
            None,
            Some(phone)
        )
        .is_none());
    }
}
