//! Which trial won: the best sample says how fast, the band says what
//! counts as equal, and the lighter setting takes the tie.

use kalsa_runtime::ServerBackend;

use crate::candidates::Candidate;

/// Candidates within 5 % of the top are equal in use, so the lighter one
/// wins. The band is the measurement's own slop: two runs of the same
/// launch differ by percents, and a setting that beats another by less
/// than this has not beaten it — the machine is making that difference,
/// not the settings.
pub const TIE_BAND: f64 = 0.05;

/// One candidate's result: the tokens-per-second samples it produced, or
/// why it produced none. A refused candidate never wins — there is no
/// number to win with, and inventing one would rank a failure above a
/// slow success.
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    Measured(Vec<f64>),
    Refused(String),
}

impl Outcome {
    /// The candidate's estimate: its BEST sample, never the mean — the
    /// probe's own rule, competition can only make a sample slower, so the
    /// fastest observed run is the closest thing to this setting's own
    /// speed. `None` for a refusal or an empty measurement: unmeasured,
    /// and unmeasured cannot win.
    pub fn best(&self) -> Option<f64> {
        match self {
            Self::Measured(samples) => {
                samples.iter().copied().filter(|rate| rate.is_finite()).reduce(f64::max)
            }
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

/// Lighter is better inside the band: a graphics run first (it frees the
/// processor entirely), then the fewer threads.
fn lightness(candidate: &Candidate) -> (u8, usize) {
    let processor = candidate.backend == ServerBackend::Cpu;
    (u8::from(processor), candidate.threads.unwrap_or(0))
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
    use kalsa_launch::Offload;

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
    /// wins, not the raw maximum — 22 threads bought 0.3 tok/s and cost the
    /// processor six cores.
    #[test]
    fn a_tie_within_the_band_goes_to_the_fewer_threads() {
        let trials = [
            (cpu(16), Outcome::Measured(vec![11.8])),
            (cpu(22), Outcome::Measured(vec![12.1])),
        ];
        assert_eq!(winner(&trials).map(|win| win.candidate), Some(cpu(16)));
    }

    /// A candidate four times faster is not a tie: the graphics run wins
    /// on its number, and it frees the processor besides.
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
            (gpu(), Outcome::Refused("it did not load".into())),
            (cpu(16), Outcome::Measured(vec![11.8])),
        ];
        assert_eq!(winner(&trials).map(|win| win.candidate), Some(cpu(16)));
    }

    /// Refused or unmeasured all the way down: no winner, and the caller
    /// keeps the rule's guess. An empty trial list says the same.
    #[test]
    fn nothing_measured_means_no_winner() {
        let trials = [
            (gpu(), Outcome::Refused("it timed out".into())),
            (cpu(16), Outcome::Refused("it did not load".into())),
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
}
