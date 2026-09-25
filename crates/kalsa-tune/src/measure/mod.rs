//! The rounds: run each candidate's lifetime once, and again only where
//! the first round could not decide — against a wall clock the owner set.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use kalsa_runtime::{free_loopback_port, serve, ServeError};

use crate::candidates::Candidate;
use crate::sample::{request, serves_id};
use crate::winner::{Outcome, Refusal};

/// The owner's budget for the whole tune: one to two minutes extra on a
/// first start was the target. 180 s stops STARTS, not work: it is
/// checked before each lifetime, never during one — a lifetime that has
/// begun still gets its full run, and the real sum of the worst case is
/// READY_TIMEOUT (120 s), three requests at REQUEST_TIMEOUT (3 x 60 s),
/// two identity checks at IDENTITY_TIMEOUT (2 x 5 s) and the stop grace
/// (5 s) — 315 s, a little over five minutes. The budget's job is that
/// few lifetimes begin at all.
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
/// or forced-off launch can decode below the catalog's own floor
/// (`MINIMUM_TOKENS_PER_SECOND = 3.0`, `kalsa-catalog/src/choice.rs`).
/// Such a launch is useless in use regardless of how it ranks — nobody
/// waits a minute for 64 tokens — so the refusal costs the tune nothing:
/// if it is the only candidate there is no tune, and the caller keeps the
/// rule. One wedged candidate also cannot spend the whole budget.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// The identity checks get their own short bound: `/v1/models` is a
/// set-iteration over one entry and a string build — instant — so five
/// seconds is a hung server, not a slow one, and the gate must not spend
/// a request's minute of the budget twice per lifetime.
const IDENTITY_TIMEOUT: Duration = Duration::from_secs(5);

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

/// What the warm-up asks for: a handful of tokens to settle the connection
/// and the cache. On a processor run a full 64-token warm-up costs as much
/// as a measurement — the Surface's whole four-lifetime tune took 144 s —
/// and8 tokens warm it at a fraction of that. The discarded warm-up's rate
/// is never parsed, so nothing compares it to the measured ones.
const WARMUP_N_PREDICT: u64 = 8;
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
    // One identity per lifetime, and it goes into the launch as the
    // model's `--alias` — the rename the engine lists on `/v1/models`
    // ("set model name aliases … (to be used by API)",
    // kalsallama `common/arg.cpp:3015-3016`), which touches the listing
    // and nothing of load or decode: it cannot change what we measure.
    // The caller's own aliases come off first: aliases are a SET
    // (kalsallama `server-context.h:19`) and the served id becomes the
    // FIRST of them sorted — "backward compat: use first alias as model
    // name" (`server-context.cpp:1385-1386`) — so a repeated `--alias`
    // does not resolve to the last — which is why the check below reads
    // `aliases` as well as `id`.
    let nonce = fresh_nonce().ok_or(Refusal::DidNotStart)?;
    let mut argv = without_aliases(argv);
    argv.extend(["--alias".to_string(), nonce.clone()]);
    let mut server = serve(state_root, port, &exe, &argv, READY_TIMEOUT).map_err(|error| match error {
        ServeError::DidNotStart => Refusal::DidNotStart,
        ServeError::NotReady { .. } => Refusal::NotReady,
    })?;
    // Before the first request and after the last: the port must be
    // serving OUR id. The window opens before the engine binds
    // (`llama_backend_init()`, kalsallama `server.cpp:109`, long before
    // `ctx_http.start()` at :463-468 on `833cde99b`), so a foreign
    // server can answer while ours is still initialising — timing the
    // liveness gate cannot prove, identity can.
    if !serves_id(server.address(), &nonce, IDENTITY_TIMEOUT) {
        return Err(Refusal::DidNotStart);
    }
    let mut rates = Vec::with_capacity(MEASURED_REQUESTS);
    for attempt in 0..(WARMUP_REQUESTS + MEASURED_REQUESTS) {
        let n_predict = if attempt < WARMUP_REQUESTS {
            WARMUP_N_PREDICT
        } else {
            crate::sample::N_PREDICT
        };
        let rate = request(server.address(), REQUEST_TIMEOUT, n_predict);
        if attempt >= WARMUP_REQUESTS {
            if let Some(rate) = rate {
                rates.push(rate);
            }
        }
    }
    let on_our_model = serves_id(server.address(), &nonce, IDENTITY_TIMEOUT);
    conclude(rates, server.alive(), on_our_model)
}

/// A fresh identity for one lifetime: 128 random bits as the model id.
/// Not secrecy — the question is only whether some OTHER server is
/// answering our freed port — so uniqueness against any real model name
/// is the whole requirement, and the door picks its ids the same way.
fn fresh_nonce() -> Option<String> {
    nonce_from(getrandom::fill)
}

/// The nonce through an injectable fallibility: the OS entropy source can
/// refuse, and a tune that cannot draw an identity does not spawn — the
/// lifetime is `Refusal::DidNotStart`, never a panic in the walk.
fn nonce_from<E>(fill: impl FnOnce(&mut [u8]) -> Result<(), E>) -> Option<String> {
    let mut bytes = [0u8; 16];
    fill(&mut bytes).ok()?;
    let hex = bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    Some(format!("kalsa-tune-{hex}"))
}

/// The caller's own alias declarations removed, keeping every other
/// argument in order. Exactly two forms exist: the parser looks the
/// option up as a whole token and takes its value from the next one
/// (kalsallama `common/arg.cpp:819-824`, `argv[++i]` at :849-852), so
/// only `--alias VALUE` and `-a VALUE` are aliases. Stripping those
/// cannot make our nonce the served id on its own — an inherited
/// `LLAMA_ARG_ALIAS` (set at `arg.cpp:3015-3025`, applied before the
/// command line at :781-802) still sorts into the set first — which is
/// why the identity check reads the entry's `aliases` too.
fn without_aliases(argv: Vec<String>) -> Vec<String> {
    let mut kept = Vec::with_capacity(argv.len());
    let mut skip_value = false;
    for arg in argv {
        if skip_value {
            skip_value = false;
            continue;
        }
        if arg == "--alias" || arg == "-a" {
            skip_value = true;
            continue;
        }
        kept.push(arg);
    }
    kept
}

/// The lifetime's answer once both gates have spoken: our child must be
/// alive AND the port must still be serving OUR id. The port was free
/// before the spawn — the window opens before the engine binds — so a
/// child that died, or a port that answers with somebody else's model,
/// means the samples were not ours, however good they look.
fn conclude(
    rates: Vec<f64>,
    child_is_alive: bool,
    on_our_model: bool,
) -> Result<Vec<f64>, Refusal> {
    if !child_is_alive || !on_our_model {
        return Err(Refusal::DidNotStart);
    }
    if rates.is_empty() {
        Err(Refusal::NoUsableAnswer)
    } else {
        Ok(rates)
    }
}

#[cfg(test)]
mod tests;
