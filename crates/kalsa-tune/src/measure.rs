//! The rounds: run each candidate's lifetime once, and again only where
//! the first round could not decide — against a wall clock the owner set.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use kalsa_runtime::{free_loopback_port, serve, ServeError};

use crate::candidates::Candidate;
use crate::sample::request;
use crate::winner::{Outcome, Refusal};

/// The owner's budget for the whole tune: one to two minutes extra on a
/// first start was the target, and 180 s is the cap that lets a slow
/// machine finish round one and still attempt a close round two.
const TOTAL_BUDGET: Duration = Duration::from_secs(180);

/// A lifetime's ready deadline: a cold first read of a 5 GB file on a
/// slow disk is the worst case (the Lenovo's GPU candidate loaded at the
/// app's 65536 context in 20 s), and past this the server is not coming
/// up in time anyway. It also bounds the budget's overshoot: a lifetime
/// is never killed mid-measurement, so this is what a started one can
/// cost at most plus its requests.
const READY_TIMEOUT: Duration = Duration::from_secs(120);

/// One request's bound: 64 tokens at the slowest rate that still counts
/// takes seconds, so a minute means a hung server rather than a slow one.
/// Bounded so one wedged candidate cannot spend the whole budget.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Round two re-runs only what round one could not separate: a candidate
/// a quarter below the top would need an implausible swing to win a
/// re-run, so the closer pairs — and at least two of them — earn a second
/// lifetime. The Lenovo's 4x GPU lead ends after round one; the Surface's
/// 4-against-8-thread pair does not.
const ROUND2_BAND: f64 = 0.25;

/// One warm-up request, discarded (a cold connection, a cold cache), then
/// two measured requests: two runs of one number let the best be the fair
/// estimator and still cost seconds.
const WARMUP_REQUESTS: usize = 1;
const MEASURED_REQUESTS: usize = 2;

/// Runs the candidates and hands back what each lifetime produced, for
/// `winner()` and `record::save`. `build` is the caller's launch — this
/// crate never invents argv — and `progress` hears (lifetimes done,
/// lifetimes planned so far) before each one starts. Candidates past the
/// budget are simply absent from the result.
pub fn measure_candidates(
    candidates: &[Candidate],
    state_root: &Path,
    build: impl Fn(&Candidate, u16) -> (PathBuf, Vec<String>),
    progress: &mut dyn FnMut(usize, usize),
) -> Vec<(Candidate, Outcome)> {
    let started = Instant::now();
    rounds(
        candidates,
        TOTAL_BUDGET,
        || started.elapsed(),
        |candidate| run_lifetime(state_root, candidate, &build),
        progress,
    )
}

/// The rounds, over an injected lifetime and clock — the policy of rounds
/// and budget with no process in sight, which is what the tests exercise.
fn rounds(
    candidates: &[Candidate],
    budget: Duration,
    since_start: impl Fn() -> Duration,
    mut run: impl FnMut(&Candidate) -> Result<Vec<f64>, Refusal>,
    progress: &mut dyn FnMut(usize, usize),
) -> Vec<(Candidate, Outcome)> {
    let count = candidates.len();
    let mut samples: Vec<Vec<f64>> = vec![Vec::new(); count];
    let mut refusals: Vec<Option<Refusal>> = vec![None; count];
    let mut ran: Vec<bool> = vec![false; count];
    let mut done = 0usize;
    let mut planned = count;

    // Round one: every candidate once, in the order the list was built.
    for index in 0..count {
        if since_start() >= budget {
            break; // never started: simply absent from the result
        }
        progress(done, planned);
        ran[index] = true;
        match run(&candidates[index]) {
            Ok(rates) => samples[index] = rates,
            Err(refusal) => refusals[index] = Some(refusal),
        }
        done += 1;
    }

    // Round two: only the near-tops, and only when at least two of them —
    // one near-top candidate cannot be beaten by rerunning itself.
    let best = |index: usize| samples[index].iter().copied().reduce(f64::max);
    let top = (0..count).filter_map(best).reduce(f64::max);
    if let Some(top) = top {
        let near = (0..count)
            .filter(|&index| best(index).is_some_and(|rate| rate >= top * (1.0 - ROUND2_BAND)))
            .collect::<Vec<_>>();
        if near.len() >= 2 {
            planned = done + near.len();
            for index in near {
                if since_start() >= budget {
                    break; // not started this round: its round-one answer stands
                }
                progress(done, planned);
                if let Ok(rates) = run(&candidates[index]) {
                    // Pooled: the best of both rounds is what winner()
                    // will take later; a failed re-run never erases a
                    // first round that measured.
                    samples[index].extend(rates);
                }
                done += 1;
            }
        }
    }
    progress(done, planned);

    (0..count)
        .filter(|&index| ran[index])
        .map(|index| {
            let outcome = if samples[index].is_empty() {
                Outcome::Refused(refusals[index].unwrap_or(Refusal::NoUsableAnswer))
            } else {
                Outcome::Measured(samples[index].clone())
            };
            (candidates[index], outcome)
        })
        .collect()
}

/// One candidate's whole lifetime: a free port, the caller's argv, the
/// wait until `/health` answers, a warm-up, the measured requests — and
/// the server is stopped and reaped when this returns, so the GPU is
/// free before the next candidate spawns.
fn run_lifetime(
    state_root: &Path,
    candidate: &Candidate,
    build: &impl Fn(&Candidate, u16) -> (PathBuf, Vec<String>),
) -> Result<Vec<f64>, Refusal> {
    let port = free_loopback_port().map_err(|_| Refusal::DidNotStart)?;
    let (exe, argv) = build(candidate, port);
    let server = serve(state_root, port, &exe, &argv, READY_TIMEOUT).map_err(|error| match error {
        ServeError::DidNotStart(_) => Refusal::DidNotStart,
        ServeError::NotReady { .. } => Refusal::NotReady,
    })?;
    let mut rates = Vec::with_capacity(MEASURED_REQUESTS);
    for attempt in 0..(WARMUP_REQUESTS + MEASURED_REQUESTS) {
        let rate = request(server.address(), REQUEST_TIMEOUT);
        if attempt >= WARMUP_REQUESTS {
            if let Some(rate) = rate {
                rates.push(rate);
            }
        }
    }
    if rates.is_empty() {
        Err(Refusal::NoUsableAnswer)
    } else {
        Ok(rates)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_launch::Offload;
    use kalsa_runtime::ServerBackend;
    use std::cell::RefCell;

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

    fn measured(value: f64) -> Result<Vec<f64>, Refusal> {
        Ok(vec![value])
    }

    /// The Lenovo shape: a 4x GPU lead cannot be overturned by a re-run
    /// of anything, so round two never happens — one lifetime each, in
    /// list order.
    #[test]
    fn the_lenovo_shape_ends_after_one_round() {
        let candidates = vec![gpu(), cpu(16), cpu(22)];
        let ran = RefCell::new(Vec::new());
        let results = rounds(
            &candidates,
            TOTAL_BUDGET,
            || Duration::ZERO,
            |candidate| {
                let at = candidates
                    .iter()
                    .position(|other| other == candidate)
                    .expect("one of ours");
                ran.borrow_mut().push(at);
                match at {
                    0 => measured(45.4),
                    1 => measured(11.8),
                    _ => measured(12.0),
                }
            },
            &mut |_, _| {},
        );
        assert_eq!(*ran.borrow(), vec![0, 1, 2], "one round, list order");
        assert_eq!(results.len(), 3);
        assert!(results.iter().all(|(_, outcome)| outcome.best().is_some()));
    }

    /// The Surface shape: two candidates a few percent apart both earn a
    /// second lifetime, and both rounds' samples pool — four numbers for
    /// two candidates, not a replacement.
    #[test]
    fn the_surface_shape_gets_a_second_round_pooled() {
        let candidates = vec![cpu(4), cpu(8)];
        let ran = RefCell::new(Vec::new());
        let results = rounds(
            &candidates,
            TOTAL_BUDGET,
            || Duration::ZERO,
            |candidate| {
                let at = candidates
                    .iter()
                    .position(|other| other == candidate)
                    .expect("one of ours");
                let round = ran.borrow().iter().filter(|&&seen| seen == at).count();
                ran.borrow_mut().push(at);
                match (at, round) {
                    (0, 0) => measured(7.5),
                    (0, _) => measured(7.6),
                    (1, 0) => measured(8.0),
                    _ => measured(7.9),
                }
            },
            &mut |_, _| {},
        );
        assert_eq!(*ran.borrow(), vec![0, 1, 0, 1], "both candidates, both rounds");
        for (candidate, outcome) in &results {
            let rates = match outcome {
                Outcome::Measured(rates) => rates,
                other => panic!("{candidate:?} refused: {other:?}"),
            };
            assert_eq!(rates.len(), 2, "one sample per round, pooled");
        }
    }

    /// A refusal earns no re-run: round two is for near-tops, and a
    /// candidate with no rate cannot be one. The near pair still runs.
    #[test]
    fn a_refusal_in_round_one_is_never_rerun() {
        let candidates = vec![cpu(4), cpu(8), cpu(16)];
        let ran = RefCell::new(Vec::new());
        let results = rounds(
            &candidates,
            TOTAL_BUDGET,
            || Duration::ZERO,
            |candidate| {
                let at = candidates
                    .iter()
                    .position(|other| other == candidate)
                    .expect("one of ours");
                ran.borrow_mut().push(at);
                match at {
                    0 => measured(10.0),
                    1 => measured(9.5),
                    _ => Err(Refusal::NotReady),
                }
            },
            &mut |_, _| {},
        );
        assert_eq!(*ran.borrow(), vec![0, 1, 2, 0, 1], "the refused candidate ran once");
        assert_eq!(results[2].1, Outcome::Refused(Refusal::NotReady));
        assert_eq!(results[0].1.best(), Some(10.0));
    }

    /// The budget is checked before each lifetime, never inside one: the
    /// candidate that started ran to completion, and the ones behind it
    /// are simply absent — nothing is killed mid-measure.
    #[test]
    fn an_exhausted_budget_leaves_later_candidates_absent() {
        let candidates = vec![cpu(4), cpu(8), cpu(16)];
        let ran = RefCell::new(Vec::new());
        let clock = RefCell::new(0u32);
        let results = rounds(
            &candidates,
            TOTAL_BUDGET,
            || {
                let tick = {
                    let mut clock = clock.borrow_mut();
                    *clock += 1;
                    *clock
                };
                if tick == 1 {
                    Duration::ZERO
                } else {
                    TOTAL_BUDGET
                }
            },
            |candidate| {
                let at = candidates
                    .iter()
                    .position(|other| other == candidate)
                    .expect("one of ours");
                ran.borrow_mut().push(at);
                measured(9.0 + at as f64)
            },
            &mut |_, _| {},
        );
        assert_eq!(*ran.borrow(), vec![0], "only the lifetime that fit the budget ran");
        assert_eq!(results.len(), 1, "the later candidates are absent, not failed");
        assert_eq!(results[0].1, Outcome::Measured(vec![9.0]), "the started lifetime completed");
    }
}
