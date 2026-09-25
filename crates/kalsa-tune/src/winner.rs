//! Which trial won: the best sample says how fast, the band says what
//! counts as equal, and the lighter setting takes the tie.

use kalsa_launch::Offload;

use crate::candidates::Candidate;

/// Candidates within 5 % of the top are equal in use, so the lighter one
/// wins. The band is the measurement's own slop: two runs of the same
/// launch differ by percents, and a setting that beats another by less
/// than this has not beaten it — the machine is making that difference,
/// not the settings.
pub const TIE_BAND: f64 = 0.05;

/// Why a candidate produced no samples — a closed set of our own causes,
/// never free text: this is written to disk (`tuning.txt`), and an
/// arbitrary stderr line would carry paths or anything else the engine
/// happened to print. Stable names, one per cause, in the record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The engine never came up: the spawn failed, or the process died
    /// before it ever answered.
    DidNotStart,
    /// It was alive but never answered readiness inside the deadline.
    NotReady,
    /// It ran and answered, but no usable decode rate came out of it —
    /// nothing finished, or the timings were unusable.
    NoUsableAnswer,
}

/// One candidate's result: the tokens-per-second samples it produced, or
/// which closed cause kept it from producing any. A refused candidate
/// never wins — there is no number to win with, and inventing one would
/// rank a failure above a slow success.
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    Measured(Vec<f64>),
    Refused(Refusal),
}

impl Outcome {
    /// The candidate's estimate: its BEST sample, never the mean — the
    /// probe's own rule, competition can only make a sample slower, so the
    /// fastest observed run is the closest thing to this setting's own
    /// speed. A rate that is not positive is not a measurement (0 tok/s
    /// means nothing ran to completion), and `None` for a refusal or an
    /// empty measurement means unmeasured — and unmeasured cannot win.
    pub fn best(&self) -> Option<f64> {
        match self {
            Self::Measured(samples) => samples
                .iter()
                .copied()
                .filter(|rate| rate.is_finite() && *rate > 0.0)
                .reduce(f64::max),
            Self::Refused(_) => None,
        }
    }
}

/// The winner: which launch to keep and the number that won it — the app
/// shows the figure it chose, so the number travels with the choice.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Winner {
    pub candidate: Candidate,
    pub best: f64,
}

/// Lighter is better inside the band: the offload that puts every layer on
/// the GPU first (the GPU does the work then, though full offload does not
/// free the processor entirely), then the fewer threads — and an unknown
/// thread count ranks heaviest of all: the engine's own default may be
/// every core the machine has.
fn lightness(candidate: &Candidate) -> (u8, usize) {
    let offload_rank = u8::from(candidate.offload != Offload::All);
    let thread_rank = candidate.threads.unwrap_or(usize::MAX);
    (offload_rank, thread_rank)
}

/// The winner among the trials: the top is the highest best, and within
/// `TIE_BAND` of it the lightest candidate wins. `None` when nothing was
/// measured or everything was refused — the caller keeps the rule.
pub fn winner(trials: &[(Candidate, Outcome)]) -> Option<Winner> {
    let top = trials.iter().filter_map(|(_, outcome)| outcome.best()).reduce(f64::max)?;
    let mut best: Option<Winner> = None;
    for (candidate, outcome) in trials {
        let Some(rate) = outcome.best() else {
            continue;
        };
        if rate < top * (1.0 - TIE_BAND) {
            continue;
        }
        let take = match &best {
            None => true,
            Some(current) => lightness(candidate) < lightness(&current.candidate),
        };
        if take {
            best = Some(Winner { candidate: *candidate, best: rate });
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_runtime::ServerBackend;

    fn cpu(threads: usize) -> Candidate {
        Candidate {
            backend: ServerBackend::Cpu,
            threads: Some(threads),
            offload: Offload::NoGpuBuild,
        }
    }

    fn gpu() -> Candidate {
        Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(16),
            offload: Offload::All,
        }
    }

    /// Inside the band (11.8 is within 5 % of 12.1) the lighter setting
    /// wins, not the raw maximum — 12.1 tok/s asks for six more logical
    /// threads than the machine's sixteen physical cores.
    #[test]
    fn a_tie_within_the_band_goes_to_the_fewer_threads() {
        let trials = [
            (cpu(16), Outcome::Measured(vec![11.8])),
            (cpu(22), Outcome::Measured(vec![12.1])),
        ];
        assert_eq!(winner(&trials).map(|win| win.candidate), Some(cpu(16)));
    }

    /// A candidate four times faster is not a tie: the graphics run wins
    /// on its number, and full offload is the lighter setting besides.
    #[test]
    fn the_graphics_candidate_wins_when_it_is_faster() {
        let trials = [
            (gpu(), Outcome::Measured(vec![49.0])),
            (cpu(16), Outcome::Measured(vec![11.8])),
        ];
        let win = winner(&trials).expect("both measured");
        assert_eq!(win.candidate, gpu());
        assert_eq!(win.best, 49.0);
    }

    /// A refusal is not a slow run: it has no number, so the best CPU
    /// takes the win the graphics candidate could not claim.
    #[test]
    fn a_refused_candidate_falls_to_the_best_processor() {
        let trials = [
            (gpu(), Outcome::Refused(Refusal::DidNotStart)),
            (cpu(16), Outcome::Measured(vec![11.8])),
        ];
        assert_eq!(winner(&trials).map(|win| win.candidate), Some(cpu(16)));
    }

    /// Refused or unmeasured all the way down: no winner, and the caller
    /// keeps the rule's guess. An empty trial list says the same.
    #[test]
    fn nothing_measured_means_no_winner() {
        let trials = [
            (gpu(), Outcome::Refused(Refusal::NotReady)),
            (cpu(16), Outcome::Refused(Refusal::DidNotStart)),
        ];
        assert_eq!(winner(&trials), None);
        assert_eq!(winner(&[]), None);
    }

    /// The estimator is the best sample, never the mean: A's mean (10.0)
    /// beats B's (9.5), but B's best (15.0) beats A's (10.0) — and B sits
    /// exactly on the band's edge over A's mean, so only the mean-driven
    /// estimator picks A.
    #[test]
    fn the_estimate_is_the_best_sample_not_the_mean() {
        let trials = [
            (cpu(16), Outcome::Measured(vec![10.0, 10.0])),
            (cpu(22), Outcome::Measured(vec![15.0, 4.0])),
        ];
        assert_eq!(
            winner(&trials).map(|win| (win.candidate, win.best)),
            Some((cpu(22), 15.0))
        );
    }

    /// A rate that is not positive is not a measurement: 0 tok/s means
    /// nothing ran to completion, and a row of them leaves nothing that
    /// can win.
    #[test]
    fn a_sample_that_is_not_positive_is_not_a_measurement() {
        assert_eq!(Outcome::Measured(vec![0.0, -3.0, 7.5]).best(), Some(7.5));
        assert_eq!(Outcome::Measured(vec![0.0, -3.0]).best(), None);
        let trials = [
            (cpu(4), Outcome::Measured(vec![0.0])),
            (cpu(8), Outcome::Measured(vec![9.0])),
        ];
        assert_eq!(winner(&trials).map(|win| win.candidate), Some(cpu(8)));
        let all_bad = [
            (cpu(4), Outcome::Measured(vec![0.0])),
            (cpu(8), Outcome::Measured(vec![-1.0])),
        ];
        assert_eq!(winner(&all_bad), None, "non-positive samples leave no winner");
    }

    /// An unknown thread count is the heaviest, not the lightest: the
    /// engine's own default may be every core, and ranking it as zero
    /// would let the unmeasured setting win the tie it cannot justify.
    #[test]
    fn an_unknown_thread_count_is_the_heaviest_not_the_lightest() {
        let unknown = Candidate {
            backend: ServerBackend::Cpu,
            threads: None,
            offload: Offload::NoGpuBuild,
        };
        let trials = [
            (unknown, Outcome::Measured(vec![12.0])),
            (cpu(4), Outcome::Measured(vec![11.6])),
        ];
        assert_eq!(
            winner(&trials).map(|win| win.candidate),
            Some(cpu(4)),
            "the known count is lighter than the engine's default"
        );
    }
}
