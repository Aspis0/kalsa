//! Is this measurement trustworthy?
//!
//! A machine that is busy — the user watching a video, an antivirus scanning,
//! another model generating — measures low, and a low number is indistinguishable
//! from a slow machine unless we look for the conditions that make a measurement
//! untrustworthy. Every check here is machine-independent: none of them knows
//! what hardware it is running on, so they hold on hardware we have never seen.
//!
//! What no invariant can do is tell "slow machine" from "busy machine" in
//! absolute terms. That is why the answer is a verdict and a retry, not a table
//! of what each CPU class should reach.
//!
//! One check is not about the machine at all: a probe compiled without
//! optimisations times its own build, nineteen times under the truth, and every
//! other check here would then convict the computer of it.

/// Repetitions that disagree by more than this were measured under a load that
/// changed during the run. A quiet machine lands at 1–4%.
pub const SPREAD_LIMIT: f64 = 0.20;
/// Share of the requested threads that must actually receive CPU time. Loose on
/// purpose: the memory system saturates with a handful of threads, so a machine
/// that lost half of them to something else still measures the same number (four
/// synchronized processes on an M1 Max add up to the same ~110 GB/s as one).
pub const PARALLELISM_FLOOR: f64 = 0.5;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Reliability {
    pub reliable: bool,
    /// CPU seconds received by the probe's threads over the wall time. On an idle
    /// machine this is the thread count; under contention it is less.
    pub effective_parallelism: Option<f64>,
    pub threads: usize,
    /// Spread of the repetitions at the plateau, relative to their mean.
    pub spread: f64,
    /// DRAM reads per second over cache-resident reads per second. Above 1.0 the
    /// cache was slower than memory, which means the "DRAM" figure was not memory.
    pub cache_ratio: Option<f64>,
    /// Everything that is wrong, in words, for the user.
    pub notes: Vec<String>,
}

pub struct Evidence {
    /// Threads the ramp settled on.
    pub plateau_threads: usize,
    /// Threads the ramp tried, for the parallelism check.
    pub tried_threads: usize,
    pub effective_parallelism: Option<f64>,
    pub spread: f64,
    pub best_rate: f64,
    /// The ramp never flattened: the last step was still the fastest.
    pub still_rising: bool,
    pub cache_rate: Option<f64>,
    /// Whether the probe itself was compiled with optimisations. It is not a
    /// fact about the machine, which is why it is the one note that does not
    /// blame one.
    pub optimised: bool,
}

pub fn judge(evidence: &Evidence) -> Reliability {
    let mut notes = Vec::new();

    if evidence.best_rate <= 0.0 {
        notes.push("no usable reading came out of the probe".to_string());
    }
    if evidence.spread > SPREAD_LIMIT {
        notes.push(format!(
            "the repetitions disagreed by {:.0}%: something else was using this machine \
             while it was measured",
            evidence.spread * 100.0
        ));
    }
    if evidence.still_rising {
        notes.push(
            "the throughput was still climbing at the last thread count tried: the machine \
             has more parallelism than the ramp reached, or something was taking cores \
             during the run"
                .to_string(),
        );
    }
    if let Some(parallelism) = evidence.effective_parallelism {
        let wanted = evidence.tried_threads as f64 * PARALLELISM_FLOOR;
        if parallelism < wanted {
            notes.push(format!(
                "the probe's threads received {:.1} cores of the {} it asked for: the machine \
                 is busy",
                parallelism, evidence.tried_threads
            ));
        }
    }
    if !evidence.optimised {
        notes.push(
            "this probe was built without optimisations, so what it timed is the build and \
             not the computer"
                .to_string(),
        );
    }
    if let Some(cache) = evidence.cache_rate {
        if cache > 0.0 && evidence.best_rate > cache * 1.05 {
            notes.push(format!(
                "memory reads came out faster than cache reads ({:.0} vs {:.0} GB/s): the \
                 reading is not measuring memory",
                evidence.best_rate / 1e9,
                cache / 1e9
            ));
        }
    }
    Reliability {
        reliable: notes.is_empty(),
        effective_parallelism: evidence.effective_parallelism,
        threads: evidence.plateau_threads,
        spread: evidence.spread,
        cache_ratio: evidence
            .cache_rate
            .filter(|cache| *cache > 0.0)
            .map(|cache| evidence.best_rate / cache),
        notes,
    }
}

/// CPU time this process has used (user + system), when the platform says.
///
/// Unix only: Windows would need another dependency for one diagnostic, and the
/// parallelism check simply does not run there.
pub fn cpu_seconds() -> Option<f64> {
    #[cfg(unix)]
    {
        let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
        if unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut usage) } != 0 {
            return None;
        }
        let user = usage.ru_utime.tv_sec as f64 + usage.ru_utime.tv_usec as f64 / 1e6;
        let sys = usage.ru_stime.tv_sec as f64 + usage.ru_stime.tv_usec as f64 / 1e6;
        Some(user + sys)
    }
    #[cfg(not(unix))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence() -> Evidence {
        Evidence {
            plateau_threads: 8,
            tried_threads: 10,
            effective_parallelism: Some(10.0),
            spread: 0.02,
            best_rate: 110.0e9,
            still_rising: false,
            cache_rate: Some(300.0e9),
            optimised: true,
        }
    }

    #[test]
    fn a_quiet_consistent_run_is_reliable() {
        let verdict = judge(&evidence());
        assert!(verdict.reliable, "{:?}", verdict.notes);
        assert!(verdict.notes.is_empty());
        assert!((verdict.cache_ratio.unwrap() - 110.0 / 300.0).abs() < 1e-9);
    }

    #[test]
    fn repetitions_that_disagree_are_not_a_baseline() {
        let mut input = evidence();
        input.spread = 0.35;
        let verdict = judge(&input);
        assert!(!verdict.reliable);
        assert!(verdict.notes[0].contains("disagreed by 35%"));
    }

    #[test]
    fn a_machine_with_no_cores_to_give_says_so() {
        let mut input = evidence();
        input.effective_parallelism = Some(2.0);
        let verdict = judge(&input);
        assert!(!verdict.reliable);
        assert!(verdict.notes.iter().any(|note| note.contains("busy")));
    }

    #[test]
    fn losing_half_the_cores_is_still_a_measurement_of_the_machine() {
        // Four synchronized processes add up to the same total as one: the memory
        // system saturates long before the cores run out.
        let mut input = evidence();
        input.effective_parallelism = Some(5.0);
        assert!(judge(&input).reliable);
    }

    #[test]
    fn a_dram_reading_faster_than_the_cache_is_not_a_dram_reading() {
        let mut input = evidence();
        input.cache_rate = Some(50.0e9);
        let verdict = judge(&input);
        assert!(!verdict.reliable);
        assert!(verdict
            .notes
            .iter()
            .any(|note| note.contains("cache reads")));
    }

    #[test]
    fn an_unoptimised_probe_says_so_instead_of_blaming_the_machine() {
        let mut input = evidence();
        input.optimised = false;
        let verdict = judge(&input);
        assert!(!verdict.reliable);
        assert!(verdict
            .notes
            .iter()
            .any(|note| note.contains("without optimisations")));
        assert!(
            !verdict.notes.iter().any(|note| note.contains("busy")),
            "the build is not the machine's fault: {:?}",
            verdict.notes
        );
    }

    #[test]
    fn a_ramp_that_never_flattened_is_worth_a_retry() {
        let mut input = evidence();
        input.still_rising = true;
        let verdict = judge(&input);
        assert!(!verdict.reliable);
        assert!(verdict
            .notes
            .iter()
            .any(|note| note.contains("still climbing")));
    }
}
