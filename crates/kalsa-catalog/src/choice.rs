//! Which model to run, and why. Pure: no hardware, no I/O, no download.
//!
//! The order of the rules is the order of the product's logic: know the phone
//! first (a computer is only worth it if it beats what the user already has),
//! then throw out what does not fit, then refuse to propose anything that is not
//! clearly more model than the phone's, and only then choose.

use kalsa_probe::{decode_tokens_per_second, prefill_tokens_per_second, DECODE_EFFICIENCY_BAND};

use crate::footprint::{footprint_bytes, usable_bytes, Footprint, GIB};
use crate::manifest::{self, ModelEntry, UsableEntry};

/// The phone's model, as the pairing handshake reports it.
#[derive(Clone, Copy, Debug)]
pub struct PhoneModel {
    pub weights_bytes: u64,
    /// What the phone measures for itself, when it says. Used to *state* the
    /// comparison, never to invent one.
    pub measured_tokens_per_second: Option<f64>,
}

#[derive(Clone, Copy, Debug)]
pub struct ChoiceInput {
    pub ram_bytes: u64,
    pub bandwidth_bytes_per_second: f64,
    pub compute_flops_per_second: f64,
    /// The context the server will be configured with: the cache is sized from
    /// it, so a bigger context is part of the footprint, not a free parameter.
    pub context_tokens: u64,
    /// None until the phone has been paired and has said what it runs.
    pub phone: Option<PhoneModel>,
}

/// The PC must beat the phone, not match it. A third again as much weight is a
/// different class of model rather than a rounding error — and it is what keeps
/// the phone's own class from being proposed as an upgrade to itself: the
/// default phone model is 2.83 GB, and Qwen3.5-4B is 2.81 GB, so it stays home.
pub const IMPROVEMENT_RATIO: f64 = 1.3;

/// Below roughly reading speed a model is not usable interactively, whatever its
/// size and however good it is: recommending it would be the same mistake as the
/// courtesy tier, in reverse. Applied to the *low* end of the predicted range, so
/// a candidate is only proposed when even its pessimistic case is usable.
pub const MINIMUM_TOKENS_PER_SECOND: f64 = 3.0;

/// Two candidates whose weights are within this band of one another are the same
/// class: taking the faster one costs the user no quality. This is how the
/// mixture-of-experts preference is *checked* instead of assumed — decoding
/// benefits from few active parameters, prompt processing does not.
pub const SAME_CLASS_BAND: f64 = 0.85;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefusalReason {
    /// The phone has not said what it runs, so nothing can be compared to it.
    PhoneUnknown,
    /// No row in the catalog fits this machine's memory.
    NothingFits,
    /// Everything that fits would be no better than the phone's own model.
    NothingBetter,
    /// Everything that fits would be too slow to use.
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
    pub context_tokens: u64,
    /// Decode throughput as a range, never as a point.
    pub decode: (f64, f64),
    /// Prefill throughput as a **floor**: both ends are the same number and mean
    /// "at least this much" (see `Measurement::compute_is_lower_bound`).
    pub prefill: (f64, f64),
    pub rationale: String,
}

#[derive(Clone, Debug)]
pub enum Decision {
    Pick(Selection),
    Refuse(Refusal),
}

struct Candidate<'a> {
    entry: &'a ModelEntry,
    footprint: Footprint,
    decode: (f64, f64),
    prefill: (f64, f64),
}

impl Candidate<'_> {
    /// Ordered by the top of the band: the band is the same factor for every
    /// candidate, so this is the same ordering as any other point in it.
    fn decode_ceiling(&self) -> f64 {
        self.decode.1
    }

    fn improves_on(&self, phone: &PhoneModel) -> bool {
        self.entry.weights_bytes as f64 >= phone.weights_bytes as f64 * IMPROVEMENT_RATIO
    }
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

    let usable = usable_bytes(input.ram_bytes);
    let candidates: Vec<Candidate> = manifest::usable()
        .map(|entry| candidate(entry, input))
        .collect();

    let fitting: Vec<&Candidate> = candidates
        .iter()
        .filter(|candidate| candidate.footprint.total_bytes() <= usable)
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
                gib_text(usable),
                gib_text(smallest)
            ),
        });
    }

    let improving: Vec<&Candidate> = fitting
        .iter()
        .copied()
        .filter(|candidate| candidate.improves_on(&phone))
        .collect();
    if improving.is_empty() {
        return Decision::Refuse(Refusal {
            reason: RefusalReason::NothingBetter,
            explanation: format!(
                "This computer is not worth using: everything that fits would be no better \
                 than the model already on your phone ({}). Staying on the phone is the \
                 honest answer.",
                gib_text(phone.weights_bytes)
            ),
        });
    }

    let usable_speed: Vec<&Candidate> = improving
        .iter()
        .copied()
        .filter(|candidate| candidate.decode.0 >= MINIMUM_TOKENS_PER_SECOND)
        .collect();
    if usable_speed.is_empty() {
        let fastest = improving
            .iter()
            .map(|candidate| candidate.decode.1)
            .fold(0.0, f64::max);
        return Decision::Refuse(Refusal {
            reason: RefusalReason::NothingFastEnough,
            explanation: format!(
                "This computer is not worth using: the models that fit and beat your phone \
                 would run at about {} tokens per second, which is slower than reading.",
                band_text((0.0, fastest))
                    .trim_start_matches('0')
                    .trim_start_matches('–')
            ),
        });
    }

    // The biggest that fits, then — among models of the same class — the one the
    // numbers say decodes fastest.
    let leader = *usable_speed
        .iter()
        .max_by_key(|candidate| candidate.entry.weights_bytes)
        .expect("improving is not empty");
    let band_floor = leader.entry.weights_bytes as f64 * SAME_CLASS_BAND;
    let chosen = usable_speed
        .iter()
        .filter(|candidate| candidate.entry.weights_bytes as f64 >= band_floor)
        .max_by(|a, b| {
            a.decode_ceiling()
                .partial_cmp(&b.decode_ceiling())
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .copied()
        .unwrap_or(leader);

    Decision::Pick(Selection {
        repo: chosen.entry.repo,
        quant: chosen.entry.quant,
        weights_bytes: chosen.entry.weights_bytes,
        footprint: chosen.footprint,
        context_tokens: input.context_tokens,
        decode: chosen.decode,
        prefill: chosen.prefill,
        rationale: rationale(chosen, input, &phone),
    })
}

/// A probe number we can compute with: positive and not a NaN.
fn measured(rate: f64) -> bool {
    rate.is_finite() && rate > 0.0
}

fn candidate<'a>(entry: UsableEntry<'a>, input: &ChoiceInput) -> Candidate<'a> {
    let entry = entry.entry();
    let bandwidth = input.bandwidth_bytes_per_second;
    let compute = input.compute_flops_per_second;
    // Speed uses the ACTIVE weights; the footprint uses the total. Getting these
    // two the wrong way round is the mistake the separate types prevent.
    let active_bytes = active_weight_bytes(entry);
    Candidate {
        entry,
        footprint: footprint_bytes(entry, input.context_tokens),
        decode: band(|efficiency| decode_tokens_per_second(bandwidth, active_bytes, efficiency)),
        // Prefill is a floor, not a range: the compute probe is a portable loop
        // and real kernels are faster. Both ends carry the same number, and the
        // meaning is "at least this much" — never a band to multiply down.
        prefill: {
            let floor = prefill_tokens_per_second(compute, entry.parameters.active().count())
                .unwrap_or(0.0);
            (floor, floor)
        },
    }
}

/// What a token actually reads: the active share of the same quantised weights.
fn active_weight_bytes(entry: &ModelEntry) -> u64 {
    let total = entry.parameters.total().count();
    let active = entry.parameters.active().count();
    if total == 0 {
        return entry.weights_bytes;
    }
    (entry.weights_bytes as u128 * active as u128 / total as u128) as u64
}

fn band(predict: impl Fn(f64) -> Option<f64>) -> (f64, f64) {
    let (low_efficiency, high_efficiency) = DECODE_EFFICIENCY_BAND;
    let low = predict(low_efficiency).unwrap_or(0.0);
    let high = predict(high_efficiency).unwrap_or(0.0);
    (low, high)
}

/// The decode range of the largest row that fits, improves on the phone, and is
/// nevertheless too slow — worth saying out loud instead of hiding behind a
/// smaller recommendation.
fn too_slow_to_use(input: &ChoiceInput, chosen: &Candidate<'_>) -> Option<(f64, f64)> {
    let usable = usable_bytes(input.ram_bytes);
    manifest::usable()
        .map(|entry| candidate(entry, input))
        .filter(|candidate| candidate.footprint.total_bytes() <= usable)
        .filter(|candidate| candidate.decode.0 < MINIMUM_TOKENS_PER_SECOND)
        .filter(|candidate| candidate.entry.weights_bytes > chosen.entry.weights_bytes)
        .map(|candidate| candidate.decode)
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
}

fn rationale(chosen: &Candidate<'_>, input: &ChoiceInput, phone: &PhoneModel) -> String {
    let mut parts = vec![format!(
        "{} ({}, {} of weights): about {} tokens per second, and {} for prompt processing.",
        chosen.entry.repo,
        chosen.entry.quant,
        gib_text(chosen.entry.weights_bytes),
        band_text(chosen.decode),
        band_text(chosen.prefill)
    )];

    if chosen.entry.parameters.is_mixture() {
        parts.push(format!(
            "It is a mixture of experts: only {} of its {} parameters are read per token, \
             which is why decoding is quick. Prompt processing is limited by compute rather \
             than by bandwidth, so its own range above is what it will feel like.",
            billions(chosen.entry.parameters.active().count()),
            billions(chosen.entry.parameters.total().count())
        ));
    }

    if let Some(slowest) = too_slow_to_use(input, chosen) {
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

fn gib_text(bytes: u64) -> String {
    size_text(bytes)
}

/// A range on purpose: from an approximate estimate a single figure would be a
/// made-up precision.
fn band_text((low, high): (f64, f64)) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parameters::Parameters;

    fn entry(weights_gib: f64, total: u64, active: u64) -> ModelEntry {
        ModelEntry {
            repo: "test/row",
            gguf_repo: None,
            last_modified: "2026-01-01",
            licence: crate::licence::Licence::Open("apache-2.0"),
            parameters: if active == total {
                Parameters::dense(total)
            } else {
                Parameters::mixture(total, active)
            },
            quant: "Q4_K_M",
            weights_bytes: (weights_gib * GIB as f64) as u64,
            mmproj_bytes: None,
            kv_bytes_per_token: None,
            stale: None,
        }
    }

    /// The two axes are one keystroke apart in a message, so the risk is real:
    /// same total weights, half the active ones, same footprint, twice the speed.
    #[test]
    fn footprint_follows_the_total_and_speed_follows_the_active() {
        let dense = entry(8.0, 16_000_000_000, 16_000_000_000);
        let mixture = entry(8.0, 16_000_000_000, 8_000_000_000);
        let input = ChoiceInput {
            ram_bytes: 64 * GIB,
            bandwidth_bytes_per_second: 80.0e9,
            compute_flops_per_second: 100.0e9,
            context_tokens: 8192,
            phone: None,
        };
        let dense_candidate = candidate(UsableEntry::for_test(&dense), &input);
        let mixture_candidate = candidate(UsableEntry::for_test(&mixture), &input);

        assert_eq!(
            dense_candidate.footprint, mixture_candidate.footprint,
            "the same weights occupy the same memory"
        );
        assert!(
            mixture_candidate.decode_ceiling() > dense_candidate.decode_ceiling() * 1.9,
            "half the active weights must decode about twice as fast"
        );
        // Prefill is compute-bound and follows the ACTIVE parameters too. Had it
        // used the total ones, these two would be equal — that is the swap this
        // assertion catches.
        assert!(
            mixture_candidate.prefill.1 > dense_candidate.prefill.1 * 1.9,
            "half the active parameters must prefill about twice as fast"
        );
    }

    #[test]
    fn a_range_is_written_as_a_range() {
        assert_eq!(band_text((25.4, 32.6)), "25–33");
        assert_eq!(band_text((0.5, 0.7)), "0.5–0.7", "below ten, a decimal");
    }

    #[test]
    fn a_mixture_active_share_is_proportional_to_its_parameters() {
        // 19 GiB of weights, 3B of 35B read per token: about 1.6 GiB a token.
        let moe = entry(19.0, 35_000_000_000, 3_000_000_000);
        let share = active_weight_bytes(&moe) as f64 / GIB as f64;
        assert!((share - 19.0 * 3.0 / 35.0).abs() < 0.01, "got {share}");
    }
}
