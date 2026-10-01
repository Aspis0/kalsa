//! The lifetimes: one candidate's server, up and down, and the tune that
//! walks every shape through them under one budget the owner set.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use kalsa_runtime::{free_loopback_port, serve, ServeError};

use crate::candidates::Candidate;
use crate::passes::{self, Samples, Tuned};
use crate::refusal::Refusal;
use crate::room;
use crate::sample::{request_ask, serves_id, Ask};

/// The whole tune's budget: the prefill and the decode passes share one
/// clock, checked BEFORE each lifetime and never during one — a lifetime
/// that has begun always runs to its end. Sized on the machine this design
/// came from: the Lenovo is three shapes, one prefill lifetime each and
/// four draft settings on each, so fifteen lifetimes; its slowest
/// plausible one is a processor decode at 8 tok/s — a 12B load of about
/// 30 s plus two 128-token asks of about 32 s — so fifteen of those are
/// ~1000 s, and 1080 s holds the whole tune the owner asked for. A
/// slower machine is cut, and its started lifetimes still stand: the
/// budget's job is that few lifetimes begin, and the worst case is this
/// bound plus one lifetime's own (READY_TIMEOUT, three requests at
/// REQUEST_TIMEOUT, both identity checks, the stop grace).
const TOTAL_BUDGET: Duration = Duration::from_secs(1080);

/// A lifetime's ready deadline: a cold first read of a 5 GB file on a
/// slow disk is the worst case (the Lenovo's GPU candidate loaded at the
/// app's 65536 context in 20 s), and past this the server is not coming
/// up in time anyway. It also bounds the budget's overshoot: a lifetime
/// is never killed mid-measurement, so this is what a started one can
/// cost at most plus its requests.
const READY_TIMEOUT: Duration = Duration::from_secs(120);

/// One request's bound: 60 s refuses anything slower than about 2 tok/s
/// on the decode ask — a real refusal, not only a hang. The decode ask is
/// 128 tokens and the room ask about two thousand, so a processor or
/// forced-off launch decoding below ~2 tok/s is refused, and prefill below
/// ~33 tok/s is refused with it: both are near or below the catalog's own
/// floor (`MINIMUM_TOKENS_PER_SECOND = 3.0`,
/// `kalsa-catalog/src/choice.rs`) and useless in use regardless of how
/// they rank — nobody waits a minute for a two-hundred-token reply. The
/// refusal costs the tune nothing: if it is the only candidate there is no
/// tune, and the caller keeps the rule. One wedged candidate also cannot
/// spend the whole budget.
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// The identity checks get their own short bound: `/v1/models` is a
/// set-iteration over one entry and a string build — instant — so five
/// seconds is a hung server, not a slow one, and the gate must not spend
/// a request's minute of the budget twice per lifetime.
const IDENTITY_TIMEOUT: Duration = Duration::from_secs(5);

/// One warm-up request, discarded (a cold connection, a cold cache), then
/// two measured requests: two runs of one number let the best be the fair
/// estimator and still cost seconds.
const WARMUP_REQUESTS: usize = 1;

/// What the warm-up asks for: a handful of tokens to settle the connection
/// and the cache. On a processor run a full-length warm-up costs as much
/// as a measurement — the Surface's whole tune once took 144 s — and 8
/// tokens warm it at a fraction of that. The discarded warm-up's rate is
/// never parsed, so nothing compares it to the measured ones.
const WARMUP_N_PREDICT: u64 = 8;
const MEASURED_REQUESTS: usize = 2;

/// The whole tune: every shape's prefill, then its decode sweep — off and
/// every draft setting — over the caller's short chat ask, so all decode
/// numbers are the same work made. `drafter` says whether the plan ships
/// one at all; a shape whose build cannot host it is a refusal inside the
/// sweep, never a failed launch.
pub fn measure_tune(
    shapes: &[(Candidate, PathBuf)],
    state_root: &Path,
    ask: &Ask,
    drafter: bool,
    build: impl Fn(&Candidate, &PathBuf, u16) -> (PathBuf, Vec<String>),
    progress: &mut dyn FnMut(usize, usize),
) -> Tuned {
    let started = Instant::now();
    let build = &build;
    passes::tune(
        shapes,
        drafter,
        TOTAL_BUDGET,
        || started.elapsed(),
        progress,
        |candidate, exe| room::prefill_lifetime(state_root, candidate, exe, build),
        |candidate, exe| run_lifetime(state_root, candidate, exe, build, ask),
    )
}

/// One candidate's whole lifetime: a free port, the caller's argv, the
/// wait until `/health` answers, the caller's own requests between the
/// two identity checks — and the server is stopped and reaped when this
/// returns, so the GPU is free before the next candidate spawns.
pub(crate) fn lifetime(
    state_root: &Path,
    candidate: &Candidate,
    resolved_exe: &PathBuf,
    build: &impl Fn(&Candidate, &PathBuf, u16) -> (PathBuf, Vec<String>),
    requests: impl FnOnce(SocketAddr) -> Samples,
) -> Samples {
    let port = free_loopback_port().map_err(|_| Refusal::DidNotStart)?;
    let (exe, argv) = build(candidate, resolved_exe, port);
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
    let mut server =
        serve(state_root, port, &exe, &argv, READY_TIMEOUT).map_err(|error| match error {
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
    let measured = requests(server.address());
    // The gates speak last. A request that refused while the child died,
    // or while the port serves somebody else, is the same DidNotStart any
    // other lifetime with those facts earns: the refusal is about the
    // measurement, and those facts are about whether it was ever ours.
    let child_is_alive = server.alive();
    let on_our_model = serves_id(server.address(), &nonce, IDENTITY_TIMEOUT);
    match measured {
        Ok(rates) => conclude(rates, child_is_alive, on_our_model),
        Err(refusal) => {
            if !child_is_alive || !on_our_model {
                Err(Refusal::DidNotStart)
            } else {
                Err(refusal)
            }
        }
    }
}

/// The decode pass's lifetime: the ask's own requests, warm-up first and
/// two measured — the samples the estimator takes the best of.
fn run_lifetime(
    state_root: &Path,
    candidate: &Candidate,
    resolved_exe: &PathBuf,
    build: &impl Fn(&Candidate, &PathBuf, u16) -> (PathBuf, Vec<String>),
    ask: &Ask,
) -> Samples {
    lifetime(state_root, candidate, resolved_exe, build, |addr| {
        let mut rates = Vec::with_capacity(MEASURED_REQUESTS);
        for attempt in 0..(WARMUP_REQUESTS + MEASURED_REQUESTS) {
            let n_predict = if attempt < WARMUP_REQUESTS {
                WARMUP_N_PREDICT
            } else {
                ask.n_predict
            };
            let rate = request_ask(addr, REQUEST_TIMEOUT, ask, n_predict);
            if attempt >= WARMUP_REQUESTS {
                if let Some(rate) = rate {
                    rates.push(rate);
                }
            }
        }
        Ok(rates)
    })
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
    let hex = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
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
fn conclude(rates: Vec<f64>, child_is_alive: bool, on_our_model: bool) -> Samples {
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
