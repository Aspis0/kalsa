//! The rounds: run each candidate's lifetime once, and again only where
//! the first round could not decide — against a wall clock the owner set.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use kalsa_runtime::{free_loopback_port, serve, ServeError};

use crate::candidates::Candidate;
use crate::sample::request;
use crate::winner::{Outcome, Refusal};

/// The owner's budget for the whole tune: one to two minutes extra on a
/// first start was the target. 180 s stops STARTS, not work: it is
/// checked before each lifetime, never during one — a lifetime that has
/// begun still gets its full run, worst case ready (READY_TIMEOUT) plus
/// three requests at the per-request bound plus the stop, a little over
/// five minutes. The budget's job is that few lifetimes begin at all.
const TOTAL_BUDGET: Duration = Duration::from_secs(180);

/// A lifetime's ready deadline: a cold first read of a 5 GB file on a
/// slow disk is the worst case (the Lenovo's GPU candidate loaded at the
/// app's 65536 context in 20 s), and past this the server is not coming
/// up in time anyway. It also bounds the budget's overshoot: a lifetime
/// is never killed mid-measurement, so this is what a started one can
/// cost at most plus its requests.
const READY_TIMEOUT: Duration = Duration::from_secs(120);

/// One request's bound: 60 s refuses anything slower than about 1 tok/s
/// (64 tokens in a minute) — a real refusal, not only a hang: a processor
/// or forced-off launch can decode below the catalog's floor. That is
/// acceptable because such a candidate would never win against the launch
/// the catalog itself chose (predicted at or above `MINIMUM_TOKENS_PER_SECOND
/// = 3.0` at its low end, `kalsa-catalog/src/choice.rs`), and if it is the
/// only candidate there is no tune anyway — the caller keeps the rule. One
/// wedged candidate also cannot spend the whole budget.
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
            // Monotonic: the caller may never see the plan shrink; only
            // the final call may lower it to what really ran.
            planned = (done + near.len()).max(planned);
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
    // The final call may lower the plan to what really ran — when the
    // budget cut the list, the earlier `planned` counted lifetimes that
    // never began — and it must then equal `done`.
    progress(done, done);

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
    let mut server = serve(state_root, port, &exe, &argv, READY_TIMEOUT).map_err(|error| match error {
        ServeError::DidNotStart => Refusal::DidNotStart,
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
    conclude(rates, server.alive())
}

/// The lifetime's answer once the liveness gate has spoken: samples count
/// only while OUR child is the one on the port. The port was free before
/// the spawn — the documented race — so a child that died after
/// answering means the answers may have been somebody else's, and none of
/// them counts however good they look.
fn conclude(rates: Vec<f64>, child_is_alive: bool) -> Result<Vec<f64>, Refusal> {
    if !child_is_alive {
        return Err(Refusal::DidNotStart);
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
        let progress_seen = RefCell::new(Vec::new());
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
            &mut |done, planned| progress_seen.borrow_mut().push((done, planned)),
        );
        assert_eq!(
            *progress_seen.borrow(),
            vec![(0, 2), (1, 2), (2, 4), (3, 4), (4, 4)],
            "the plan grows for round two and the final call equals what ran"
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

    /// The samples of a dead child count for nothing: the port was free
    /// before the spawn, so a child that died means the answers may have
    /// been somebody else's — however good they look.
    #[test]
    fn the_answers_of_a_dead_child_count_for_nothing() {
        assert_eq!(conclude(vec![9.9], false), Err(Refusal::DidNotStart));
        assert_eq!(conclude(vec![], true), Err(Refusal::NoUsableAnswer));
        assert_eq!(conclude(vec![7.5], true), Ok(vec![7.5]));
    }

    /// The budget is checked before each lifetime, never inside one: the
    /// candidate that started ran to completion, and the ones behind it
    /// are simply absent — nothing is killed mid-measure.
    #[test]
    fn an_exhausted_budget_leaves_later_candidates_absent() {
        let candidates = vec![cpu(4), cpu(8), cpu(16)];
        let ran = RefCell::new(Vec::new());
        let progress_seen = RefCell::new(Vec::new());
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
            &mut |done, planned| progress_seen.borrow_mut().push((done, planned)),
        );
        assert_eq!(*ran.borrow(), vec![0], "only the lifetime that fit the budget ran");
        assert_eq!(results.len(), 1, "the later candidates are absent, not failed");
        assert_eq!(results[0].1, Outcome::Measured(vec![9.0]), "the started lifetime completed");
        // (done, planned) is monotonic until the last call, and the last
        // call lowers the plan to what really ran — and equals it.
        let seen = progress_seen.borrow();
        assert_eq!(*seen, vec![(0, 3), (1, 1)], "the plan may only shrink at the end");
        assert_eq!(seen.last(), Some(&(1, 1)), "the final plan is what ran");
    }
}
