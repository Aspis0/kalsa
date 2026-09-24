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
    /// CPU time this process received per wall second over the probe window —
    /// every thread of the process, because both `getrusage(RUSAGE_SELF)` and
    /// `GetProcessTimes` count process-wide, not just the probe's: the
    /// standalone binary runs alone, while in the app the probe runs inside
    /// the Tauri process and the app's own threads count too. On an idle
    /// machine it is about the plateau thread count; under contention less.
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
    /// Every logical core the OS says this process may use. The claim
    /// `still_rising` makes is about the machine — "more parallelism than
    /// the ramp reached" — so the note counts only below this: a ramp that
    /// reached every core cannot have left parallelism behind, and the busy
    /// half of that flag's sentence is the parallelism check's own.
    pub machine_parallelism: usize,
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
    // A rising ramp condemns only a ramp that stopped below what the machine
    // has: at the machine's full parallelism "more parallelism than the ramp
    // reached" is impossible by construction, and whatever was taking cores
    // is what the parallelism check below is for. The requested thread count
    // would be the wrong line — a caller may cap the ramp below the machine,
    // and there a rising tail really does mean untried parallelism.
    if evidence.still_rising && evidence.plateau_threads < evidence.machine_parallelism {
        notes.push(format!(
            "the throughput was still climbing at the last thread count tried: the ramp \
             settled at {} of the machine's {} logical threads, so the machine has more \
             parallelism than the ramp reached, or something was taking cores during the run",
            evidence.plateau_threads, evidence.machine_parallelism
        ));
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
/// Unix reads `getrusage(RUSAGE_SELF)`; Windows reads `GetProcessTimes` —
/// this process's kernel and user time, FILETIME's 100 ns ticks divided to
/// seconds. The same sum in different units, so the parallelism check runs
/// on either; a platform that answers neither gets `None` and the check
/// simply does not run there.
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
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::FILETIME;
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
        let ticks = |time: &FILETIME| -> f64 {
            ((u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)) as f64
                / 10_000_000.0
        };
        let mut creation = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut exit = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut kernel = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        let mut user = FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        };
        // GetCurrentProcess is a pseudo-handle: nothing to close after.
        let ok = unsafe {
            GetProcessTimes(
                GetCurrentProcess(),
                &mut creation,
                &mut exit,
                &mut kernel,
                &mut user,
            )
        };
        (ok != 0).then(|| ticks(&kernel) + ticks(&user))
    }
    #[cfg(not(any(unix, windows)))]
    {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plateau::{plateau, still_rising};

    fn evidence() -> Evidence {
        Evidence {
            plateau_threads: 8,
            tried_threads: 10,
            effective_parallelism: Some(10.0),
            spread: 0.02,
            best_rate: 110.0e9,
            still_rising: false,
            machine_parallelism: 16,
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

    /// The Surface Laptop 3's first refused run (i7-1065G7, 4 cores / 8
    /// logical): 1/2/4/8 threads at 20.0/29.0/47.4/53.2 GB/s. The
    /// hyperthreaded tail beats four threads by 12%, past the 5%
    /// tolerance, so the plateau IS the last step — the exact shape that
    /// was refused.
    const SURFACE_RUN_1: [(usize, f64); 4] = [
        (1, 20.0e9),
        (2, 29.0e9),
        (4, 47.4e9),
        (8, 53.2e9),
    ];

    /// Evidence the way `measure` builds it: plateau and raw flag from the
    /// same ramp, machine parallelism whatever the machine reports.
    fn evidence_of(ramp: &[(usize, f64)], machine_parallelism: usize) -> Evidence {
        let (plateau_threads, _) = plateau(ramp).expect("a plateau");
        Evidence {
            plateau_threads,
            tried_threads: plateau_threads,
            effective_parallelism: Some(plateau_threads as f64),
            spread: 0.02,
            best_rate: ramp
                .iter()
                .map(|(_, rate)| *rate)
                .fold(0.0_f64, f64::max),
            still_rising: still_rising(ramp),
            machine_parallelism,
            cache_rate: Some(300.0e9),
            optimised: true,
        }
    }

    #[test]
    fn a_ramp_that_reached_every_logical_thread_is_reliable() {
        // The Surface's default config: config.threads = available_parallelism
        // = 8, and the tail still climbs past the tolerance — but the ramp
        // reached every thread the machine has, so there is no untried
        // parallelism to claim.
        let input = evidence_of(&SURFACE_RUN_1, 8);
        assert_eq!(
            input.plateau_threads, 8,
            "the tail is past the tolerance: the plateau is the last step"
        );
        assert!(input.still_rising, "the raw flag fires on this shape");
        let verdict = judge(&input);
        assert!(verdict.reliable, "{:?}", verdict.notes);
        assert!(!verdict
            .notes
            .iter()
            .any(|note| note.contains("still climbing")));
    }

    #[test]
    fn a_ramp_stopped_short_of_the_machine_is_still_flagged() {
        // A shape `measure` really produces: a caller caps the ramp at four
        // threads on this eight-logical machine (`thread_ramp(4)` = 1, 2, 4)
        // and the tail is still climbing at the cap. "More parallelism than
        // the ramp reached" is exactly true there — worth a retry.
        let capped = &SURFACE_RUN_1[..3];
        let input = evidence_of(capped, 8);
        assert_eq!(input.plateau_threads, 4, "the plateau is the last step");
        assert!(input.still_rising, "the raw flag fires on this shape");
        let verdict = judge(&input);
        assert!(!verdict.reliable, "{:?}", verdict.notes);
        assert!(verdict
            .notes
            .iter()
            .any(|note| note.contains("still climbing")));
    }

    #[test]
    fn a_ramp_at_its_ceiling_still_refuses_when_the_cores_were_taken() {
        // The handoff the flag's sentence promises: with the climbing note
        // suppressed at the top of the machine, the busy half must come from
        // the parallelism check — and it does.
        let mut input = evidence_of(&SURFACE_RUN_1, 8);
        input.effective_parallelism = Some(2.0);
        let verdict = judge(&input);
        assert!(!verdict.reliable);
        assert!(!verdict
            .notes
            .iter()
            .any(|note| note.contains("still climbing")));
        assert!(verdict.notes.iter().any(|note| note.contains("busy")));
    }

    /// Windows reports this process's CPU time too — without it a steadily
    /// contended Windows machine would pass the parallelism check by never
    /// having one, and be saved as a baseline.
    #[cfg(windows)]
    #[test]
    fn cpu_seconds_on_windows_reports_and_grows_with_work() {
        let before = cpu_seconds().expect("Windows reports this process's CPU time");
        let started = std::time::Instant::now();
        let mut sink = 0u64;
        while started.elapsed() < std::time::Duration::from_millis(200) {
            sink = sink.wrapping_mul(3).wrapping_add(1);
        }
        std::hint::black_box(sink);
        let after = cpu_seconds().expect("Windows reports this process's CPU time");
        assert!(
            after > before,
            "CPU seconds must grow with work: {before} -> {after}"
        );
    }
}
