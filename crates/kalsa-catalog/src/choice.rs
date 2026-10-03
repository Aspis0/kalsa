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

use crate::candidate::{Candidate, Prediction};
use crate::footprint::{fits_footprint, memory_budget, Footprint, MemoryBudget, GIB};
use crate::licence::Licence;
use crate::manifest::{DenseEquivalent, ModelEntry};
use crate::parameters::Parameters;
use crate::q8;
use crate::rationale::{details, gib_text, plain_reason, render};

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
    /// Whether that bandwidth figure is a floor: measured on a slower path
    /// than the model will run on — the probe's
    /// `Measurement::bandwidth_is_lower_bound()`. A floor can keep a
    /// candidate but can never refuse one or be printed as a confident
    /// speed; the prediction carries the shape.
    pub bandwidth_is_lower_bound: bool,
    pub compute_flops_per_second: f64,
    /// The context the server will be configured with: the cache is sized from
    /// it, so a bigger context is part of the footprint, not a free parameter.
    pub context_tokens: u64,
    /// None until the phone has been paired and has said what it runs.
    pub phone: Option<PhoneModel>,
}

/// The context the desktop pick is priced at, everywhere the chooser is
/// asked: 65_536 tokens, the chat default this product launches with. One
/// machine serves several users, so a model that only holds a small window
/// is not a suggestion — a row must FIT at 65_536 tokens to be offered, and
/// the cache that window costs is part of every footprint measured here.
pub const CHOOSER_CONTEXT_TOKENS: u64 = 65_536;

/// The PC must beat the phone, not match it. The bar is a proxy, and says so:
/// what would replace it is a bake-off on the user's own machine, which the
/// plan names as the arbiter and which nothing in this repo builds yet. A constant that
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

/// The dense speed floor for a dense row at or above
/// [`LARGE_DENSE_PARAMETERS`] — the top of one rule, not a rule of its own:
/// a dense row is held to a speed scaled by how much of its file each token
/// pays for ([`dense_speed_floor`]), and 20 tok/s is what the big end asks.
/// One machine serves several users, and a dense model this machine can
/// barely drive is not a suggestion however well it benches: the owner's
/// M1 Max decodes a dense 27B at about 7 tok/s, and the prediction says so
/// before the row reaches the page.
pub const MINIMUM_DENSE_TOKENS_PER_SECOND: f64 = 20.0;

/// The dense speed floor for a dense row below [`LARGE_DENSE_PARAMETERS`].
/// The same rule as [`MINIMUM_DENSE_TOKENS_PER_SECOND`], sized smaller
/// because each token reads a smaller file — but still a floor: 5 tok/s is
/// what the owner measured and called "totalmente inusabile".
pub const MINIMUM_SMALL_DENSE_TOKENS_PER_SECOND: f64 = 10.0;

/// What counts as a big dense row for [`MINIMUM_DENSE_TOKENS_PER_SECOND`]:
/// dense — never a mixture, which is judged by its total and active split,
/// not by this line — and at least this many parameters.
pub const LARGE_DENSE_PARAMETERS: u64 = 20_000_000_000;

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
/// What replaces even this: a bake-off run on the user's own machine on the
/// actual pair. It is unwritten, so this rule is what there is. Measuring is
/// required, and no citable rule settles it.
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
            if equivalent.parameters as f64 >= phone.total().count() as f64 * IMPROVEMENT_RATIO {
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
    /// Offered only because the device runs on battery: every token
    /// generated on the PC is one the phone did not generate, and
    /// `MINIMUM_TOKENS_PER_SECOND` still applies — relief is not a licence
    /// to offer a crawl. `same_class` says how the two sizes sit, and it
    /// picks the words, never the selection.
    Relief {
        /// The candidate is within the phone's own class — the selection
        /// band read in the other direction, [`SAME_CLASS_BAND`] — so
        /// "about as good as" is true of it. Above that, the candidate is a
        /// much bigger model and the sentence must say so.
        same_class: bool,
    },
    /// The numbers point clearly toward stronger — the total parameter bar is
    /// cleared, above the size regime where the literature warns the
    /// comparison reverses — but nothing citable settles a MoE against a
    /// dense model of the same total, so this is expected, never claimed.
    /// A bake-off on the user's machine on the actual pair is what would
    /// confirm it, and nothing here runs one; measuring is required and no
    /// citable rule settles it.
    ExpectedButUnmeasured,
}

/// The one gate a candidate passes to be offered at all, on either road: the
/// capability claim when the evidence supports one, else "expected, not yet
/// measured", else the relief a battery-powered phone justifies. `None` means
/// this candidate admits nothing and must not be put in front of the owner —
/// the caller walks on to the next candidate.
///
/// Both options go through it: the first pick in [`choose`], and the second in
/// [`quicker_alternative`], whose row sits beside one that passed here. Two
/// bars for two rows on one page is how the second option came to offer a
/// model the walk itself would refuse.
fn justification(candidate: &Candidate, phone: &PhoneModel) -> Option<Justification> {
    if let Some(basis) = capability_basis(
        candidate.entry.parameters,
        candidate.entry.dense_equivalent,
        phone.parameters,
    ) {
        return Some(Justification::Capability(basis));
    }
    if expected_but_unmeasured(candidate, phone) {
        return Some(Justification::ExpectedButUnmeasured);
    }
    // Relief is for a device that runs on battery, and never for a
    // candidate below the phone's own class floor: every token generated on
    // this machine is one the phone did not generate, which is the whole of
    // the exchange. The floor says nothing about how far ABOVE it the
    // candidate sits, and the words must not pretend otherwise.
    if phone.battery_powered == Some(true)
        && candidate.entry.weights_bytes as f64 >= phone.weights_bytes as f64 * SAME_CLASS_BAND
    {
        // The same band, read the other way. The gate above decides whether
        // relief is offered at all; this decides which honest words it
        // earns — past phone / band the candidate is a much bigger model,
        // and "about as good as" would be a size claim the bytes contradict.
        let same_class =
            candidate.entry.weights_bytes as f64 <= phone.weights_bytes as f64 / SAME_CLASS_BAND;
        return Some(Justification::Relief { same_class });
    }
    None
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

/// One more file fetched beside the weights, with the same three promises:
/// the address, the size every byte must add up to, the digest nothing
/// unverified gets past.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DownloadFile {
    pub url: String,
    pub bytes: u64,
    pub sha256: &'static str,
}

/// What the shell fetches for a pick: the exact file at the pinned commit,
/// the size every byte must add up to, and the digest the download is
/// verified against before anything runs. Built only from a complete
/// `GgufSource`, and a selection cannot be built without one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DownloadPlan {
    /// The address the file is fetched from.
    pub url: String,
    /// The exact size of the file, in bytes.
    pub bytes: u64,
    /// The sha256 every downloaded byte is verified against.
    pub sha256: &'static str,
    /// The row's drafter, fetched and verified beside the weights when the
    /// row ships with one. `None` on every row that runs alone.
    pub drafter: Option<DownloadFile>,
    /// The row's vision projector pin, for the ON-DEMAND fetch the owner's
    /// explicit yes triggers — never for placement, which must not touch
    /// this field: a projector that arrived unasked would charge a memory
    /// plan the user never agreed to spend. `None` on every row with no
    /// projector, and absent from [`Self::total_bytes`] for the same reason:
    /// the plan's total is what a model download moves, and this file is
    /// not part of it.
    pub mmproj: Option<DownloadFile>,
}

impl DownloadPlan {
    /// The one total a model download costs: the weights and everything
    /// fetched beside them. The projector is deliberately absent — it is
    /// fetched on demand, never with the model.
    pub fn total_bytes(&self) -> u64 {
        self.bytes
            .saturating_add(self.drafter.as_ref().map(|file| file.bytes).unwrap_or(0))
    }
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
    /// Decode throughput as a band: a range, never a point.
    pub decode: Prediction,
    /// Prefill throughput as a floor — one number meaning "at least this
    /// much" (see `Measurement::compute_is_lower_bound`).
    pub prefill: Prediction,
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
    /// What the shell fetches: the exact file at the pinned commit, the
    /// size every byte must add up to, and the digest the download is
    /// verified against before anything runs. Not an `Option`: a selection
    /// exists only for a row that carries its file's address, so there is
    /// no such state as a pick that cannot be fetched.
    pub download: DownloadPlan,
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

    let Runnable {
        budget,
        too_slow,
        remaining,
        dense_lines_stand_down,
    } = match runnable_on(input) {
        Ok(answer) => answer,
        Err(refusal) => return Decision::Refuse(refusal),
    };
    // The walk prunes as it goes, so it borrows its own copy of the
    // survivors; `remaining` stays whole for the nothing-admitted analysis
    // below, where every fitting row still counts. The full-precision file
    // leaves here: it leads no card on either route — the roomy rule offers
    // it as the Faster option only.
    let mut walk: Vec<&Candidate> = remaining
        .iter()
        .filter(|candidate| !full_precision_file(candidate.entry))
        .collect();
    while !walk.is_empty() {
        // The brain's own first card, shared with the phone-free route: the
        // big dense row that cleared its line — asked only while some row
        // on the tier clears one, because on a stand-down tier none did and
        // "that cleared its line" describes nothing. There the walk below
        // leads with speed, as `leading_candidate` does on the phone-free
        // road. The phone answers only whether the row it is given beats
        // what the phone runs; it never decides which PC model leads. No
        // justification, no offer — the row drops out of the walk exactly
        // as the class rule's candidate below does.
        if let Some(dense) = (!dense_lines_stand_down)
            .then(|| {
                walk.iter().copied().filter(|candidate| {
                    dense_speed_floor(candidate.entry) == Some(MINIMUM_DENSE_TOKENS_PER_SECOND)
                })
            })
            .into_iter()
            .flatten()
            .max_by_key(|candidate| candidate.entry.weights_bytes)
        {
            match justification(dense, &phone) {
                Some(earned) => {
                    return Decision::Pick(selection(dense, input, &phone, budget, earned))
                }
                None => {
                    walk.retain(|candidate| !std::ptr::eq(*candidate, dense));
                    continue;
                }
            }
        }
        // Then the class preference, walked until a candidate admits an
        // honest justification: the biggest that fits, then — among models
        // of the same class — the one the numbers say decodes fastest. The
        // biggest may admit nothing (a small unsourced MoE can claim neither
        // capability nor expected strength, and a device that does not run
        // on battery admits no relief), and when it cannot, the walk falls
        // through to what remains rather than mislabelling the offer or
        // hiding it. On a tier whose lines stand down none of that row
        // arithmetic means anything — no line spoke — so the walk leads with
        // speed instead, and the justification below gates it as it gates
        // every other candidate.
        let chosen = if dense_lines_stand_down {
            *walk
                .iter()
                .max_by(|a, b| a.decode.floor().total_cmp(&b.decode.floor()))
                .expect("remaining is not empty")
        } else {
            let leader = *walk
                .iter()
                .max_by_key(|candidate| candidate.entry.weights_bytes)
                .expect("remaining is not empty");
            let band_floor = leader.entry.weights_bytes as f64 * SAME_CLASS_BAND;
            *walk
                .iter()
                .filter(|candidate| candidate.entry.weights_bytes as f64 >= band_floor)
                .max_by(|a, b| {
                    a.decode_ceiling()
                        .partial_cmp(&b.decode_ceiling())
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .expect("the leader is in its own class")
        };
        let Some(earned) = justification(chosen, &phone) else {
            walk.retain(|candidate| !std::ptr::eq(*candidate, chosen));
            continue;
        };
        return Decision::Pick(selection(chosen, input, &phone, budget, earned));
    }

    // Nothing that fits admitted a justification. Say which axis failed.
    // "What fits" is the too-slow rows and the survivors together: a row the
    // speed floor removed still counts when the question is whether anything
    // comparable even fits.
    let comparable: Vec<&Candidate> = too_slow
        .iter()
        .chain(remaining.iter())
        .filter(|candidate| {
            candidate.entry.weights_bytes as f64 >= phone.weights_bytes as f64 * SAME_CLASS_BAND
        })
        .collect();
    let comparable_fast = comparable
        .iter()
        .any(|candidate| candidate.decode.floor() >= MINIMUM_TOKENS_PER_SECOND);
    let comparable_span = span_of(comparable.iter().map(|candidate| &candidate.decode));
    let nothing_comparable = || {
        format!(
            "This computer is not worth using: everything that fits is smaller than the \
             model already on your phone ({}), so the work would move to a weaker model.",
            gib_text(phone.weights_bytes)
        )
    };
    let (reason, explanation) = if comparable.is_empty() {
        (RefusalReason::NothingBetter, nothing_comparable())
    } else if !comparable_fast {
        // comparable is not empty — the arm above has answered that — so the
        // span exists; the None arm keeps the match total and repeats the
        // same answer rather than inventing a speed.
        match comparable_span {
            Some(span) => (
                RefusalReason::NothingFastEnough,
                format!(
                    "This computer is not worth using: the models that fit and would be \
                     worth running here would decode at about {} tokens per second, which \
                     is slower than reading.",
                    render(&span)
                ),
            ),
            None => (RefusalReason::NothingBetter, nothing_comparable()),
        }
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

/// The first card among rows that run — the row every second option is
/// measured against. When some row on the tier clears its own dense line,
/// the big dense row that cleared it is the smarter answer and leads; only
/// a dense row at the big end HAS that line, and here it really cleared it.
/// When the lines stand down — no row clears one — they withhold nobody and
/// pick nobody: the fastest row this machine runs well leads, never the
/// biggest. The full-precision file is already out of `pool`: it leads no
/// card on either answer.
fn leading_candidate<'a>(
    answer: &Runnable,
    pool: &[&'a Candidate<'static>],
) -> Option<&'a Candidate<'static>> {
    if answer.dense_lines_stand_down {
        return pool
            .iter()
            .copied()
            .max_by(|a, b| a.decode.floor().total_cmp(&b.decode.floor()));
    }
    pool.iter()
        .copied()
        .filter(|candidate| {
            dense_speed_floor(candidate.entry) == Some(MINIMUM_DENSE_TOKENS_PER_SECOND)
        })
        .max_by_key(|candidate| candidate.entry.weights_bytes)
        .or_else(|| pool.iter().copied().max_by_key(|candidate| candidate.entry.weights_bytes))
}

/// What the phone-free question answers with: the row this machine runs
/// well that takes the first card — [`leading_candidate`] says which one —
/// with what a page needs in order to show it. Deliberately
/// smaller than a `Selection`: a selection carries a justification, and with
/// no phone there is nothing to justify against — no comparison was made, so
/// none may be implied.
pub struct RunnableRow {
    /// The row itself: repo, display name, quant, weights — and the
    /// per-token cache figure the context arithmetic runs on.
    pub entry: &'static ModelEntry,
    /// What the row occupies on this machine.
    pub footprint: Footprint,
    /// Decode throughput as a band, never a point — the same prediction
    /// `choose` would carry for the row.
    pub decode: Prediction,
    /// The budget this was sized against.
    pub budget: MemoryBudget,
    /// The row's pinned file — address, size, digest — exactly as a
    /// `Selection` carries one. The usable-entry gate already guarantees
    /// the row has one; a phone-free pick must be startable, not merely
    /// displayable.
    pub download: DownloadPlan,
}

/// The catalog row this machine should run, phone or no phone: it fits the
/// budget at [`CHOOSER_CONTEXT_TOKENS`] and even its pessimistic speed
/// clears the usability floor — see [`leading_candidate`] for which of them
/// takes the first card: the big dense row that cleared its line while some
/// row clears one, and the fastest row there is while the lines stand down,
/// never the biggest on a tier where no line can speak. No phone is
/// involved, because "what can this computer run" does not need one — the
/// phone decides whether the computer is an *upgrade*, which is [`choose`].
/// `Err` exactly when `choose` would refuse without ever reaching the
/// comparison: the machine was not measured, nothing fits, or everything
/// that fits is provably too slow — the refusal's own words travel, because
/// the caller that cannot start still owes the owner a reason.
pub fn largest_that_runs_well(input: &ChoiceInput) -> Result<RunnableRow, Refusal> {
    let answer = runnable_on(input)?;
    // The first-card pool, minus the full-precision file: that row leads
    // no card — the roomy rule offers it only as the Faster option — and
    // it must not out-rank the smaller rows by bytes on its way to being
    // one. It never travels alone: anything that admits F16 admits the E4B
    // beside it, which clears every line F16 clears.
    let pool: Vec<&Candidate> = answer
        .remaining
        .iter()
        .filter(|candidate| !full_precision_file(candidate.entry))
        .collect();
    // The first card is [`leading_candidate`]'s answer, whatever this tier
    // is: the second card measures against that row (`quicker_alternative`).
    let chosen = leading_candidate(&answer, &pool)
        .expect("runnable_on answers remaining only when it is not empty");
    Ok(row(chosen, answer.budget))
}

/// One named row, as this machine would run it, or `None` when it is not on
/// the menu: it does not fit the budget, is provably too slow, or has no file
/// left to fetch.
///
/// This is what the manual path asks before it honours a stored choice. A
/// preference is a preference: one this machine cannot satisfy falls back to
/// the automatic answer, because a brain that will not start is worse than one
/// running a model nobody chose.
pub fn runnable_row(input: &ChoiceInput, entry: &'static ModelEntry) -> Option<RunnableRow> {
    let answer = runnable_on(input).ok()?;
    let candidate = answer.remaining.iter().find(|candidate| {
        let row = candidate.entry;
        row.repo == entry.repo
            && row.display_name == entry.display_name
            && row.quant == entry.quant
            && row.weights_bytes == entry.weights_bytes
    })?;
    Some(row(candidate, answer.budget))
}

/// How much faster the second option must decode before a second card is
/// worth showing: half again as fast. Below that the two rows feel the same
/// on the machine that will run them, and the page would be asking the owner
/// to choose between a model and itself.
pub const QUICK_SPEED_ADVANTAGE: f64 = 1.5;

/// The owner's one exception to [`QUICK_SPEED_ADVANTAGE`], and the line it
/// hangs on: machines with this much RAM (32 GiB) are roomy. There the
/// full-precision LFM file takes the second card from its own family's
/// ordinary answer (or takes it outright when the bar found none),
/// whenever it is faster than the pick — the higher-quality file is worth
/// showing on a big machine even without the usual margin — and the file
/// is offered only at or above this line: below it the Q8 file is the LFM
/// row on offer.
pub const ROOMY_RAM_BYTES: u64 = 32 * GIB;

/// The row this exception is about: LiquidAI's full-precision (F16) file of
/// LFM2.5-2.6B. Named by repo and quant rather than by size so the rule
/// cannot drift onto whichever row happens to be biggest — exact repo, not
/// the [`LFM_FAMILY`] prefix: one file of one model, not the family.
pub fn full_precision_file(entry: &ModelEntry) -> bool {
    entry.repo == "LiquidAI/LFM2.5-2.6B" && entry.quant == "F16"
}

/// Every LiquidAI row in the manifest hangs off this prefix — a future
/// `LiquidAI/LFM2.5-8B-A1B` row must be demoted with the rest instead of
/// escaping the rule by spelling its own repo.
const LFM_FAMILY: &str = "LiquidAI/LFM";

/// A row of LiquidAI's LFM family — keyed on the repo prefix, while
/// [`full_precision_file`] stays exact (repo + quant) for its one file. On
/// the second card LFM ranks last among the rows that clear the bar: the
/// owner puts any other family ahead of it, so LFM wins only when nothing
/// else does.
fn lfm_row(entry: &ModelEntry) -> bool {
    entry.repo.starts_with(LFM_FAMILY)
}

/// The second option: the most model this machine runs at least
/// [`QUICK_SPEED_ADVANTAGE`] times faster than the one already being
/// offered, with LFM ranked last among the rows that clear the bar — the
/// owner ranks every other family ahead of it, so LFM is the last resort
/// rather than a size winner. `None` when nothing does — one honest option
/// beats two that feel the same — except as the last word on a roomy
/// machine: when the bar finds nothing, or finds only the family's own
/// Q8 file, the full-precision LFM file takes the card if it is faster
/// than the pick at all (see [`ROOMY_RAM_BYTES`]).
///
/// It is held to the bar of the row it sits beside, which is
/// [`justification`]: a phone-free first option is `leading_candidate`'s
/// answer and was never asked to justify itself, so neither is this one; a first
/// option chosen *against a paired phone* had to earn a justification, so a
/// second option that earns none is not offered — the product would refuse to
/// start it.
///
/// It takes the speed of the row on the page rather than recomputing which
/// row that is, because the page reaches its first pick by two different
/// roads (the phone comparison, or the biggest that runs well) and "faster"
/// has to mean faster than whatever the owner is actually looking at.
///
/// `than` is compared at its **pessimistic** end, the only end that is a
/// promise: measuring against ceilings would let an optimistic guess about a
/// small row outrank a floor under a big one.
pub fn quicker_alternative(input: &ChoiceInput, than: &Prediction) -> Option<RunnableRow> {
    let answer = runnable_on(input).ok()?;
    let justified = |candidate: &Candidate| match input.phone {
        Some(phone) => justification(candidate, &phone).is_some(),
        None => true,
    };
    // The row on the first card, answered the way `largest_that_runs_well`
    // answers it, so the second option can never be that row — the pair a
    // page shows must read as two entries, not one twice. The comparison is
    // the row's identity (repo, quant, weights — what `model_token` keys
    // on), not its display name: two files of one model share a name, and
    // "Liquid LFM 2.5" is both the Q8 and the F16 row.
    let first_card_pool: Vec<&Candidate> = answer
        .remaining
        .iter()
        .filter(|candidate| !full_precision_file(candidate.entry))
        .collect();
    let lead = leading_candidate(&answer, &first_card_pool)
        .map(|candidate| (candidate.entry.repo, candidate.entry.quant, candidate.entry.weights_bytes));
    let not_the_first = |candidate: &Candidate| {
        lead != Some((candidate.entry.repo, candidate.entry.quant, candidate.entry.weights_bytes))
    };
    if answer.dense_lines_stand_down {
        // The lines stand down, so there is no line to clear beside the
        // pick: speed answers both cards — the next fastest row that runs
        // well, above the reading floor like every row here, and never the
        // first card's own model again. Size is not asked at all.
        return answer
            .remaining
            .iter()
            .filter(|candidate| not_the_first(candidate))
            .filter(|candidate| justified(candidate))
            .max_by(|a, b| a.decode.floor().total_cmp(&b.decode.floor()))
            .map(|candidate| row(candidate, answer.budget));
    }
    let wanted = than.floor() * QUICK_SPEED_ADVANTAGE;
    let quick = answer
        .remaining
        .iter()
        .filter(|candidate| candidate.decode.floor() >= wanted)
        .filter(|candidate| justified(candidate))
        // Any family beats LFM among the rows that clear the bar, then the
        // most model of them all — never merely the smallest: a toy is not
        // an option.
        .max_by_key(|candidate| (!lfm_row(candidate.entry), candidate.entry.weights_bytes));
    // The owner's exception, on a roomy machine and gated on being faster
    // than the pick: the full-precision file takes the card from its own
    // family's ordinary answer — the bar found the Q8 file, the F16 file
    // of the same model replaces it — and it takes the card outright when
    // the bar found nothing. A DIFFERENT model the bar found stays, as the
    // owner's table pins: Qwen 3.6 at 64/800, Gemma 26B on the 24 GB card.
    if input.ram_bytes >= ROOMY_RAM_BYTES {
        if let Some(full) = answer
            .remaining
            .iter()
            .filter(|candidate| full_precision_file(candidate.entry))
            .filter(|candidate| justified(candidate))
            .max_by_key(|candidate| candidate.entry.weights_bytes)
        {
            let faster_than_the_pick = full.decode.floor() > than.floor();
            let bar_found_the_family = quick.is_none_or(|other| other.entry.repo == full.entry.repo);
            if faster_than_the_pick && bar_found_the_family {
                return Some(row(full, answer.budget));
            }
        }
    }
    quick.map(|candidate| row(candidate, answer.budget))
}

/// A candidate as a page needs it. The usable-entry gate already guarantees
/// the pinned file, so the plan is built here rather than being optional.
fn row(candidate: &Candidate<'static>, budget: MemoryBudget) -> RunnableRow {
    RunnableRow {
        entry: candidate.entry,
        footprint: candidate.footprint,
        decode: candidate.decode,
        budget,
        download: download_plan(candidate),
    }
}

/// The pick's fetch plan: the weights file, the drafter beside it when the
/// row ships with one — each with its own address, size and digest — and
/// the projector's pin, which travels but is never fetched here.
fn download_plan(candidate: &Candidate<'_>) -> DownloadPlan {
    DownloadPlan {
        url: candidate.source.url(),
        bytes: candidate.source.bytes,
        sha256: candidate.source.sha256,
        drafter: candidate.drafter.map(|file| DownloadFile {
            url: file.url(),
            bytes: file.bytes,
            sha256: file.sha256,
        }),
        mmproj: candidate.mmproj.map(|file| DownloadFile {
            url: file.url(),
            bytes: file.bytes,
            sha256: file.sha256,
        }),
    }
}

/// The machine's verdict before any phone is asked anything. The two filters
/// the product's rules are made of — fits entirely, not provably too slow —
/// are applied here, once, so the phone question and the phone-free one
/// cannot grow different rules about what runs.
struct Runnable {
    budget: MemoryBudget,
    /// Rows that fit the budget but are never offerable on it: under the
    /// reading floor, or under their row's dense speed line while some
    /// other row clears its own. They count when an answer is about what
    /// fits; the reading-speed refusal only ever spans rows the reading
    /// floor refused, because the dense lines stand down when nothing
    /// clears them (they never withhold a whole tier).
    too_slow: Vec<Candidate<'static>>,
    /// Rows that fit and are not provably too slow: everything either
    /// question can actually offer.
    remaining: Vec<Candidate<'static>>,
    /// The stand-down: no row here clears its own dense line, so the lines
    /// are withholding nobody and cannot pick either. Where the lines would
    /// have decided, speed decides instead — see [`leading_candidate`].
    dense_lines_stand_down: bool,
}

/// The machine's half of any answer, phone or no phone. The `Err` arms are
/// exactly the refusals that need no phone to state.
fn runnable_on(input: &ChoiceInput) -> Result<Runnable, Refusal> {
    if !measured(input.bandwidth_bytes_per_second) || !measured(input.compute_flops_per_second) {
        return Err(Refusal {
            reason: RefusalReason::MachineNotMeasured,
            explanation: "This computer has not been measured yet: run the probe first, \
                          otherwise any speed we quote would be a guess."
                .to_string(),
        });
    }

    // A card whose memory could not be read: a model that will decode on it
    // must fit it entirely, and the size is unknown. The RAM budget would
    // offer a twenty-gigabyte model into a six-gigabyte card, so the machine
    // is refused rather than guessed at — reading the card, or pinning the
    // run to the CPU, unblocks it.
    if matches!(input.backend, Backend::DiscreteGpu { vram_bytes: None }) {
        return Err(Refusal {
            reason: RefusalReason::MachineNotMeasured,
            explanation: "This computer has a graphics card whose memory could not be \
                          read, and a model that will decode on it must fit it entirely. \
                          We will not guess the size: read the card's memory, or run the \
                          model on the CPU only, and ask again."
                .to_string(),
        });
    }

    let budget = memory_budget(input.backend, input.ram_bytes);
    // The owner's Q8 rule decides each row's file first, so every gate below
    // sees the file the machine will actually be served.
    let candidates: Vec<Candidate> = q8::resolved(input)
        .into_iter()
        .map(|(_, candidate)| candidate)
        .collect();

    // A candidate fits the chosen budget entirely or it is not a candidate for
    // this path. Measured upstream: 18.49 tok/s fully on the GPU, 12.19 on the
    // CPU, 5.68 split across both — the split is 2.15× slower than not using
    // the GPU at all, so "nearly fits, offload most of it" is a loss dressed
    // up as a win, and the fallback is the largest model that fits, never a
    // spill.
    let fits = |candidate: &Candidate| fits_footprint(candidate.entry, &candidate.footprint, &budget);
    if candidates.iter().all(|candidate| !fits(candidate)) {
        return Err(nothing_fits(budget, &candidates));
    }

    // No justification is worth asking for a crawl — but only a range may
    // say "crawl": a floor below reading speed is unknown, not slow, and on
    // the faster path the model will run on it may not be slow at all. So a
    // range below the line never reaches either answer, and a floor always
    // does, with its offer saying the real figure will be measured.
    let mut too_slow = Vec::new();
    let mut eligible = Vec::new();
    for candidate in candidates {
        if !fits(&candidate) {
            continue;
        }
        if provably_too_slow(&candidate.decode) {
            too_slow.push(candidate);
            continue;
        }
        // The roomy-machine rule: the full-precision file is not on this
        // machine's menu at all below [`ROOMY_RAM_BYTES`] — it fits and
        // clears its speed line, but as a pick it would shove the smaller
        // rows aside on a machine that should be seeing them, and the Q8
        // file is the LFM row down there.
        if full_precision_file(candidate.entry) && input.ram_bytes < ROOMY_RAM_BYTES {
            continue;
        }
        eligible.push(candidate);
    }
    // The dense floors are a preference among rows, not a verdict on the
    // machine: a row under its line is withheld only while some other row
    // clears its own. When nothing clears them — a small tier where every
    // dense row sits under 10 — the reading floor decides alone, so the
    // tier still starts something. That is what keeps the refusal honest:
    // `remaining` is empty only when the eligible rows are empty, so the
    // reading-speed sentence always quotes speeds below the reading floor.
    let clears_its_line =
        |candidate: &Candidate| dense_speed_floor(candidate.entry).is_none_or(|line| {
            candidate.decode.floor() >= line
        });
    // The owner's rule: a row that fits entirely in a dedicated card's
    // budget runs on the card, and the floor under it was timed on the
    // processor — so the floor may keep such a row but never withhold it.
    // Its speed stays what the type says: at least the floor, unknown above.
    let on_the_card_under_a_floor = |candidate: &Candidate| {
        budget.card_sized && matches!(candidate.decode, Prediction::Floor(_))
    };
    let any_clears = eligible.iter().any(|candidate| clears_its_line(candidate));
    let mut remaining = Vec::new();
    for candidate in eligible {
        if any_clears && !clears_its_line(&candidate) && !on_the_card_under_a_floor(&candidate) {
            // Withheld, never offerable here — and counted, so an answer
            // about what fits cannot pretend this row does not exist.
            too_slow.push(candidate);
            continue;
        }
        remaining.push(candidate);
    }
    if remaining.is_empty() {
        // Every model that fits is too slow. The fitting set is not empty —
        // the nothing-fits refusal above has already returned — so the span
        // exists; the None arm keeps the match total by giving the same
        // answer that refusal would give, and the smallest fitting row is
        // the smallest row overall whenever anything fits.
        let span = span_of(too_slow.iter().map(|candidate| &candidate.decode));
        return match span {
            Some(span) => Err(Refusal {
                reason: RefusalReason::NothingFastEnough,
                explanation: format!(
                    "This computer is not worth using: the models that fit would decode \
                     at about {} tokens per second, which is slower than reading.",
                    render(&span)
                ),
            }),
            None => Err(nothing_fits(budget, &too_slow)),
        };
    }
    Ok(Runnable {
        budget,
        too_slow,
        remaining,
        dense_lines_stand_down: !any_clears,
    })
}

/// A probe number we can compute with: positive and not a NaN.
fn measured(rate: f64) -> bool {
    rate.is_finite() && rate > 0.0
}

/// The dense speed floor a row must clear to be offered at all: the big
/// line ([`MINIMUM_DENSE_TOKENS_PER_SECOND`]) at or above
/// [`LARGE_DENSE_PARAMETERS`], the small line
/// ([`MINIMUM_SMALL_DENSE_TOKENS_PER_SECOND`]) below it, and `None` for a
/// mixture — those read only their active share, and the plain
/// [`MINIMUM_TOKENS_PER_SECOND`] floor judges them like every other row.
pub fn dense_speed_floor(entry: &ModelEntry) -> Option<f64> {
    if entry.parameters.is_mixture() {
        return None;
    }
    Some(if entry.parameters.total().count() >= LARGE_DENSE_PARAMETERS {
        MINIMUM_DENSE_TOKENS_PER_SECOND
    } else {
        MINIMUM_SMALL_DENSE_TOKENS_PER_SECOND
    })
}

/// Whether a decode prediction by itself proves a candidate too slow to
/// offer. Only a range can prove it — both ends are known, and a pessimistic
/// end below reading speed means the model is not usable interactively. A
/// floor below the line is unknown, not slow, and on the faster path the
/// model will run on it may not be slow at all.
pub(crate) fn provably_too_slow(decode: &Prediction) -> bool {
    matches!(decode, Prediction::Range { .. }) && decode.floor() < MINIMUM_TOKENS_PER_SECOND
}

/// The refusal for a machine nothing in the catalog fits, naming the numbers
/// so the answer can be checked.
fn nothing_fits(budget: MemoryBudget, candidates: &[Candidate]) -> Refusal {
    let smallest = candidates
        .iter()
        .map(|candidate| candidate.footprint.total_bytes())
        .min()
        .unwrap_or(0);
    Refusal {
        reason: RefusalReason::NothingFits,
        explanation: format!(
            "This computer is not worth using: it can give a model {} and the smallest \
             one in the catalog needs {}.",
            gib_text(budget.usable_bytes),
            gib_text(smallest)
        ),
    }
}

/// The honest span of a set of predictions: from the most pessimistic end to
/// the most optimistic. None for an empty set — there is no speed to
/// summarise, and no fabricated pair of infinities stands in for one.
/// Floors and measurements are not ranges: their ends are not two ends, and
/// spanning a measured rate against a predicted band would be a fabrication.
fn span_of<'a>(predictions: impl Iterator<Item = &'a Prediction>) -> Option<Prediction> {
    let mut low = f64::INFINITY;
    let mut high = f64::NEG_INFINITY;
    let mut seen_range = false;
    for prediction in predictions {
        if let Prediction::Range { low: l, high: h } = *prediction {
            seen_range = true;
            low = low.min(l);
            high = high.max(h);
        }
    }
    seen_range.then_some(Prediction::Range { low, high })
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
        download: download_plan(chosen),
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
        // A 6B mixture: 1.5× the phone's 4B, clearing the bar on
        // parameters — and the claim is still refused, because MoE against
        // dense is a claim across shapes, no sourced rule converts the shapes,
        // and nothing published would settle it.
        let mixture = Parameters::mixture(6_000_000_000, 1_000_000_000);
        let phone = Parameters::dense(4_000_000_000);
        assert!(
            mixture.total().count() as f64 >= phone.total().count() as f64 * IMPROVEMENT_RATIO,
            "the parameter bar is cleared; only the missing evidence refuses"
        );
        assert!(capability_basis(mixture, None, Some(phone)).is_none());
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
            capability_basis(
                phi,
                Some(equivalent),
                Some(Parameters::dense(2_000_000_000))
            ),
            Some(CapabilityBasis::PublishedDenseEquivalent {
                parameters: 3_800_000_000,
                note: "near Phi-3 mini",
                source: "model card",
            })
        );
        // Against a dense 4B phone the same published figure says phone-class:
        // the evidence is allowed to refuse, too.
        assert!(capability_basis(
            phi,
            Some(equivalent),
            Some(Parameters::dense(4_000_000_000))
        )
        .is_none());
    }

    #[test]
    fn a_floor_never_proves_a_candidate_too_slow() {
        // The rule the Mac scenario forced: a range below reading speed is a
        // refusal; a floor below reading speed is unknown, not slow.
        assert!(provably_too_slow(&Prediction::Range {
            low: 1.7,
            high: 2.2
        }));
        assert!(!provably_too_slow(&Prediction::Floor(1.7)));
        assert!(!provably_too_slow(&Prediction::Range {
            low: 3.1,
            high: 4.0
        }));
    }

    #[test]
    fn a_machine_without_a_phone_still_gets_its_largest_runnable_row() {
        // "What can this computer run?" is answerable with no phone at all;
        // only "is it an upgrade?" has to wait for one, and the same input
        // through `choose` still says exactly that.
        let no_phone = ChoiceInput {
            backend: Backend::Cpu,
            ram_bytes: 16 * crate::footprint::GIB,
            bandwidth_bytes_per_second: 80.0e9,
            bandwidth_is_lower_bound: false,
            compute_flops_per_second: 100.0e9,
            // The chooser prices the cache at one token; this question uses
            // the same input, so the same rows are candidates.
            context_tokens: 1,
            phone: None,
        };
        let row = largest_that_runs_well(&no_phone).expect("something runs on 16 GiB");
        assert!(row.budget.usable_bytes > 0);
        assert!(
            row.footprint.total_bytes() <= row.budget.usable_bytes,
            "the answer fits the budget it was sized against"
        );
        assert!(matches!(
            choose(&no_phone),
            Decision::Refuse(Refusal {
                reason: RefusalReason::PhoneUnknown,
                ..
            })
        ));
        let paired = ChoiceInput {
            phone: Some(PhoneModel {
                weights_bytes: 2_200_000_000,
                parameters: Some(Parameters::dense(4_000_000_000)),
                measured_tokens_per_second: None,
                battery_powered: Some(true),
            }),
            ..no_phone
        };
        assert!(
            matches!(choose(&paired), Decision::Pick(_)),
            "the phone question still walks the same filters and answers"
        );
    }

    #[test]
    fn an_empty_set_has_no_span() {
        // Nothing in, nothing out: the empty case is a value the caller must
        // handle, never a fabricated pair of infinities on the screen.
        assert_eq!(span_of(std::iter::empty::<&Prediction>()), None);
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
