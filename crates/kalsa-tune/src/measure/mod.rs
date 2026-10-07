//! The lifetimes: one candidate's server, up and down, and the tune that
//! walks every shape through them under one budget the owner set.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use kalsa_runtime::{free_loopback_port, serve, ServeError};

use crate::candidates::Candidate;
use crate::passes::{self, First, Report, Samples, Tuned};
use crate::record::Kept;
use crate::refusal::Refusal;
use crate::room;
use crate::sample::{post_to, request_ask, serves_id, Ask};

/// The tune's budget in whole seconds, for the walk's own report: the page
/// has nothing to average before two lifetimes have finished, and this is
/// the clock its wait counts down from instead.
pub const TOTAL_BUDGET_SECONDS: u64 = 1500;

/// One clock over both passes, checked before each lifetime and never
/// during one: [`TOTAL_BUDGET_SECONDS`] for four shapes (the integrated
/// GPU's mixed shape is the fourth), each a prefill-and-off lifetime and
/// three drafted settings — sixteen lifetimes averaging 93.75 s apiece. The
/// clock stops a lifetime from BEGINNING past the bound, and one that
/// begins just inside runs on by its own limits ([`LIFETIME_LIMIT`], an
/// estimate), so the tune may overrun the budget by up to about one
/// lifetime.
const TOTAL_BUDGET: Duration = Duration::from_secs(TOTAL_BUDGET_SECONDS);

/// A lifetime's ready deadline: a cold first read of a 5 GB file on a
/// slow disk is the worst case, and it bounds the budget's overshoot — a
/// started lifetime is never killed mid-measurement, so one that began at
/// the bound can still cost this much plus its own requests.
const READY_TIMEOUT: Duration = Duration::from_secs(120);

/// One request's bound: 60 s refuses anything slower than about 2 tok/s
/// on the decode ask — a real refusal, not only a hang. The decode ask is
/// 128 tokens, so a launch decoding below ~2 tok/s is refused: that is near
/// or below the catalog's own floor (`MINIMUM_TOKENS_PER_SECOND = 3.0`,
/// `kalsa-catalog/src/choice.rs`) and useless in use regardless of how it
/// ranks. The refusal costs the tune nothing: if it is the only candidate
/// there is no tune, and the caller keeps the rule. One wedged candidate
/// also cannot spend the whole budget.
pub(crate) const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// The room ask's own bound: a prefill of about 2,250 tokens is the longest
/// request the tune makes, and a slow processor is slow, not broken — the
/// Surface's CPU build took 99 s (22.7 tok/s) and under 60 s was refused as
/// "no usable answer" instead of measured. 300 s refuses prefill below
/// ~7.5 tok/s, where a long history is a five-minute wait and not a
/// candidate.
pub(crate) const ROOM_REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

/// One lifetime's cost added up from its parts — the ready deadline, the
/// warm-up, the room ask, the three decode requests and the two identity
/// checks, each at its own request bound. An estimate, not a ceiling:
/// every request also spends a connect deadline of its own (sample.rs's
/// agent sets `timeout_connect` beside the request's timeout) and a DNS
/// lookup sits outside both, so a lifetime can overrun this figure.
const LIFETIME_LIMIT: Duration = Duration::from_secs(
    READY_TIMEOUT.as_secs()
        + REQUEST_TIMEOUT.as_secs()
        + ROOM_REQUEST_TIMEOUT.as_secs()
        + (WARMUP_REQUESTS + MEASURED_REQUESTS) as u64 * REQUEST_TIMEOUT.as_secs()
        + 2 * IDENTITY_TIMEOUT.as_secs(),
);

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
/// and the cache; the history is the expensive part, and the discarded
/// warm-up's rate is never parsed, so nothing compares it to the measured
/// ones.
const WARMUP_N_PREDICT: u64 = 8;
const MEASURED_REQUESTS: usize = 2;

/// The whole tune: every shape's first lifetime — the room ask's prefill
/// and the shape's own off-decode in one server — then its drafted sweep
/// (2, 3, 4) over the caller's short chat ask, so every decode number is
/// the same work made. `drafter` says whether the plan ships one at all;
/// a shape whose build cannot host it is a refusal inside the sweep,
/// never a failed launch. `prior` is the withheld marker's trials: the
/// lifetimes they proved measured are never run again, and the budget
/// counts only what is left.
pub fn measure_tune(
    shapes: &[(Candidate, PathBuf)],
    state_root: &Path,
    ask: &Ask,
    drafter: bool,
    prior: &[(Candidate, Kept)],
    build: impl Fn(&Candidate, &PathBuf, u16) -> (PathBuf, Vec<String>),
    progress: &mut dyn FnMut(Report),
) -> Tuned {
    let started = Instant::now();
    let build = &build;
    passes::tune(
        shapes,
        drafter,
        prior,
        TOTAL_BUDGET,
        || started.elapsed(),
        progress,
        |candidate, exe| first_lifetime(state_root, candidate, exe, build, ask),
        |candidate, exe| decode_lifetime(state_root, candidate, exe, build, ask),
    )
}

/// One candidate's whole lifetime: a free port, the caller's argv, the
/// wait until `/health` answers, the caller's own requests between the
/// two identity checks — and the server is stopped and reaped when this
/// returns, so the GPU is free before the next candidate spawns.
pub(crate) fn lifetime<A>(
    state_root: &Path,
    candidate: &Candidate,
    resolved_exe: &PathBuf,
    build: &impl Fn(&Candidate, &PathBuf, u16) -> (PathBuf, Vec<String>),
    requests: impl FnOnce(SocketAddr) -> Result<A, Refusal>,
) -> Result<A, Refusal> {
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
    conclude(measured, child_is_alive, on_our_model)
}

/// One shape's first lifetime: the room ask once — its own short warm-up
/// first, so the history's first-token cost is the measurement and not
/// the connection's — and then the shape's off-decode, the same warm-up
/// and two measured requests every drafted setting gets. The room ask runs
/// first and both asks carry `cache_prompt: false`, so neither
/// measurement reads the other's cache.
fn first_lifetime(
    state_root: &Path,
    candidate: &Candidate,
    resolved_exe: &PathBuf,
    build: &impl Fn(&Candidate, &PathBuf, u16) -> (PathBuf, Vec<String>),
    ask: &Ask,
) -> Result<First, Refusal> {
    lifetime(state_root, candidate, resolved_exe, build, |addr| {
        let _ = post_to(addr, REQUEST_TIMEOUT, "/completion", &room::warmup_body());
        let prompt_rate = room_prompt_rate(addr, ROOM_REQUEST_TIMEOUT)?;
        let rates = draft_requests(addr, ask);
        Ok(First {
            prompt_rate,
            off: measured(rates),
        })
    })
}

/// The shape's prefill rate from the room ask, within `timeout`. A timeout
/// or an HTTP error is a lifetime with no usable answer, the same reading
/// the decode pass gives one.
fn room_prompt_rate(addr: SocketAddr, timeout: Duration) -> Result<f64, Refusal> {
    match post_to(addr, timeout, "/completion", &room::ask_body()) {
        Ok(answer) => room::prompt_rate(&answer),
        Err(_) => Err(Refusal::NoUsableAnswer),
    }
}

/// The drafted sweep's lifetime: the same ask and the same request
/// discipline as the first lifetime's off-decode, on one n_max.
fn decode_lifetime(
    state_root: &Path,
    candidate: &Candidate,
    resolved_exe: &PathBuf,
    build: &impl Fn(&Candidate, &PathBuf, u16) -> (PathBuf, Vec<String>),
    ask: &Ask,
) -> Samples {
    lifetime(state_root, candidate, resolved_exe, build, |addr| {
        measured(draft_requests(addr, ask))
    })
}

/// The decode sequence one draft lifetime runs: a discarded warm-up at the
/// ask's own prompt, then two measured requests. Shared by a shape's first
/// lifetime and every drafted setting, so all decode numbers are the same
/// work made.
fn draft_requests(addr: SocketAddr, ask: &Ask) -> Vec<f64> {
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
    rates
}

/// The samples of one decode sequence, or the closed cause when none
/// finished: an empty row is not a measurement.
fn measured(rates: Vec<f64>) -> Samples {
    if rates.is_empty() {
        Err(Refusal::NoUsableAnswer)
    } else {
        Ok(rates)
    }
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
fn conclude<A>(
    answer: Result<A, Refusal>,
    child_is_alive: bool,
    on_our_model: bool,
) -> Result<A, Refusal> {
    if !child_is_alive || !on_our_model {
        Err(Refusal::DidNotStart)
    } else {
        answer
    }
}

#[cfg(test)]
mod tests;
