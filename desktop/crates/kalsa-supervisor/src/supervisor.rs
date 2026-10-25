//! The supervisor: one worker thread owns the child, the UI only reads a state
//! and sends commands. Nothing here blocks the caller.
//!
//! Why a child process at all: `GGML_ASSERT` calls `abort()`, which
//! `catch_unwind` does not contain, so an inference crash takes down whatever
//! process hosts it. Death of the server is therefore a normal case this module
//! must report, not an exception it may assume away.

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::engine_id::EngineId;

use crate::child::{self, ChildHandle, Residency, Termination};
use crate::config::ServerConfig;
use crate::drain;
use crate::engine_lines::{is_failure_line, is_out_of_memory_line, is_safe_engine_line};
use crate::health;
use crate::instance::{Existing, InstanceFile};
use crate::presence;
use crate::suspect::Suspect;

/// How often the worker thread looks for a command or a dead child.
const TICK: Duration = Duration::from_millis(200);
/// Per-probe budget during the ready handshake.
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);
/// How long a start waits for the port to be bindable after the walk that
/// stopped an earlier run's engine. Short on purpose: the walk has already
/// waited its own grace for the process to die, so what is left is a kernel
/// that has not reaped yet — or a stranger that is never letting go.
const PORT_FREE_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ServerState {
    Stopped,
    Starting,
    Running {
        /// The pid of the child this run spawned.
        pid: u32,
        port: u16,
    },
    /// A stop is in flight: its caller has declared it and the worker has not
    /// finished the teardown. The two facts it exists for: a `brain_state`
    /// poll must report the drain instead of the `Running` the state kept
    /// reading for up to two graces, and that arm must NOT raise the door the
    /// stop lowered — the poll is the reconciler, so this state is what
    /// suppresses the re-raise. It leaves only for one of the drain's TWO
    /// ends: `Stopped`, or the failed-to-stop state that reports a drain it
    /// could not prove finished (`drain`, `presence`) — both written by the
    /// worker's own `stop`. It is a state rather than a flag because two
    /// actors used to race on this one field.
    Stopping,
    /// It is not running and we know why. The reason is data: this crate
    /// names what it observed, and the caller owns the words. The `detail`
    /// payloads (an io error, the last line of stderr) are for logs and must
    /// never reach the screen as-is.
    Failed {
        reason: Failure,
    },
}

/// Why the server is not running, as the caller can match on it. One variant
/// per user-actionable story, not per internal call site: what the user can
/// do about a wedged state file and an unwritable one is the same restart.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Failure {
    /// A program that is not ours holds the port. Never signalled, only
    /// reported.
    PortTaken,
    /// A server from an earlier run is alive, but its state file cannot be
    /// read, so it can be neither reused nor identified.
    InstanceUnreadable { detail: String },
    /// The state file could not be written, so this run cannot be identified
    /// later as ours.
    InstanceUnwritable { detail: String },
    /// The server binary could not be started.
    ServerNotStarted { detail: String },
    /// The server stopped by itself. `detail` is a filtered fatal diagnostic,
    /// its last stderr line, or its exit status when it said nothing.
    ServerExited {
        detail: String,
        exit_code: Option<i64>,
        exit_signal: Option<i64>,
    },
    /// It never answered the readiness probe within the deadline.
    NotReady { seconds: u64 },
    /// The command line did not bind loopback on the supervised port: a
    /// server the supervisor could not find, or one exposed off loopback.
    /// The start refused it before any process was made.
    UnsafeBinding { detail: String },
    /// A stop could not prove the server is gone, so the drain ended HERE
    /// instead of `Stopped` — a stop that declared success over a live
    /// engine is how a ghost survives a restart cycle (§9). `measures` is
    /// DATA: the walk (pid if known, what was tried, each grace), the
    /// process witness, and whether the port answers. It goes to logs and
    /// to this record; `failure::words` never prints it as-is.
    StopUnconfirmed { measures: String },
}

enum Command {
    Start(
        Box<ServerConfig>,
        mpsc::Sender<StartOutcome>,
        /// The worker's report after the handshake (or its failure): what
        /// THIS start did, so a caller can settle without reading the
        /// shared state.
        mpsc::Sender<StartSettled>,
    ),
    /// The state the drain was declared over (`drain::declare`'s return):
    /// by the time the worker reads the state it says `Stopping`, so this
    /// is the only record of what the FIRST stop left behind (§18).
    Stop { prior: Option<ServerState> },
    Shutdown { prior: Option<ServerState> },
    /// Test-only: the worker gets an owned run without a real start (which
    /// needs a serving engine this file has no fixture for), so an API test
    /// can watch a first stop reach `StopUnconfirmed` the way every real one
    /// does — through the owned walk.
    #[cfg(test)]
    Plant(Box<Owned>),
}

/// What the worker decided about a start request. `Accepted` means the
/// request became the supervisor's business: the described server is the one
/// coming up. `Refused` means this request started nothing — a server was
/// already owned, or the supervisor went away before answering.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartOutcome {
    Accepted,
    Refused,
}

/// The pending verdict on a start request. Ownership of "already on" lives on
/// the worker thread, so the answer can only arrive from it:
/// [`StartWaiter::outcome`] blocks until the worker has decided. `#[must_use]`
/// because a caller that records a launch for a verdict it never asked for is
/// publishing an argv nobody runs.
#[must_use = "a start whose verdict is ignored cannot tell a taken start from a refused one"]
pub struct StartWaiter {
    verdict: mpsc::Receiver<StartOutcome>,
    settled: mpsc::Receiver<StartSettled>,
}

/// What THIS start did once its handshake landed or failed — the worker's
/// own report, so the answer cannot be a state transition somebody else
/// observed late, and never a stale failure from a start before it.
#[derive(Clone, Debug)]
pub enum StartSettled {
    /// Up: the child this start spawned is running and answering.
    Up,
    /// The start failed; the reason is the caller's to word.
    Failed(Failure),
}

impl StartWaiter {
    /// Blocks until the worker decides. The wait is bounded by the command
    /// the worker is currently serving — a start request is answered before
    /// any handshake begins, so only another start's handshake can delay it.
    pub fn outcome(&self) -> StartOutcome {
        self.verdict.recv().unwrap_or(StartOutcome::Refused)
    }

    /// Blocks until THIS start has settled: running, or failed with the
    /// reason. `None` when no answer will come — the worker died, the start
    /// was never taken (the settle sender is dropped with the refused
    /// command), or the app is going away. A dropped answer is not a
    /// failure: callers treat `None` as "leave it alone".
    pub fn settle(&self) -> Option<StartSettled> {
        self.settled.recv().ok()
    }
}

enum Started {
    Spawned {
        child: ChildHandle,
        instance: InstanceFile,
    },
}

/// The server we believe is running, and how we came to own it.
struct Owned {
    child: Option<ChildHandle>,
    /// Never set by a start, which adopts nothing; the stop paths still read it.
    adopted_pid: Option<u32>,
    instance: Option<InstanceFile>,
    config: ServerConfig,
}

pub struct Supervisor {
    commands: Sender<Command>,
    state: Arc<Mutex<ServerState>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    /// The engine's killable identity, published at the spawn and held only
    /// while a signal through it can reach no process but the engine (see
    /// `engine_id`). The exit watchdog and the exit handler load it at their
    /// deadline and after their steps.
    engine: Arc<EngineId>,
    /// How many model releases the server has announced on stderr (see
    /// `MODEL_RELEASED_LINE` in `child`). The drain thread adds; readers
    /// compare against their last-seen value and act on the difference — an
    /// event no poll can miss, because the count never goes back down.
    releases: Arc<AtomicU64>,
    /// Whether the model is in memory right now, toggled by the same drain
    /// thread from both lines the server prints around a release (see
    /// `child::Residency`). A fact of its own, not a reading of `releases`:
    /// a count that never goes down can say a release happened, never that
    /// the model is back.
    residency: Residency,
    /// Each start snapshots the file configuration; without it, only the
    /// in-memory tail is kept.
    stderr_dir: Arc<Mutex<Option<crate::stderr_log::StderrLogConfig>>>,
}

/// Read-only, `Clone`able view of the facts the supervisor owns: the
/// server's state, whether its model is in memory, and the pid of the engine
/// it owns. Built for watchers that must not hold the supervisor — the disk
/// tier's tick thread reads it every second with no command and no webview
/// behind it, and the app's exit watchdog loads the pid at its deadline.
///
/// **Trap: two types, one name.** The `residency` behind `model_asleep` is
/// `child::Residency`: whether the SERVER holds the MODEL. The door's
/// `kalsa_door::paging::Residency` says which CHAT lives in one SLOT. Same
/// word, two facts, no conversion between them — a released model is the
/// *reason* the door's map may be believed no more, never a reading of it.
#[derive(Clone)]
pub struct Watch {
    state: Arc<Mutex<ServerState>>,
    residency: Residency,
    engine: Arc<EngineId>,
}

impl Watch {
    /// The server's state, as the field holds it — NOT the dead-worker read
    /// `Supervisor::state` performs: this view carries no worker handle, by
    /// design (it is what can outlive or travel without the supervisor), so
    /// for a drain whose worker died it keeps answering `Stopping`. Nothing
    /// in the tick acts on `Stopping`; declared as a stale read, not a
    /// state — see `Supervisor::state` for the closure.
    pub fn state(&self) -> ServerState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or(ServerState::Stopped)
    }

    /// `model_asleep`'s answer: `Some(true)` released, `Some(false)` in
    /// memory, `None` nothing has said (a server with no pipe of ours).
    pub fn model_asleep(&self) -> Option<bool> {
        self.residency.asleep()
    }

    /// The pid of the engine this supervisor holds a killable identity for
    /// right now. Loaded fresh every call, so a pid a stop already proved
    /// gone is never handed out. `None` when no engine was started, or when
    /// the engine's going is proven.
    pub fn engine_pid(&self) -> Option<u32> {
        self.engine.pid()
    }

    /// The exit's last resort, on the identity the supervisor still holds:
    /// the engine the stop could not prove gone. `None` — the common exit —
    /// when nothing is held, in which case nothing is killed and nothing is
    /// said. This is the one kill path the app has: the exit handler runs it
    /// after its steps come back, the exit watchdog at its deadline, and
    /// both reach here so neither can drift into signalling a pid the
    /// supervisor no longer vouches for.
    pub fn finish_engine(&self, grace: Duration) -> Option<Termination> {
        self.engine.kill(grace)
    }
}

impl Supervisor {
    pub fn new() -> Self {
        let (commands, inbox) = mpsc::channel();
        let state = Arc::new(Mutex::new(ServerState::Stopped));
        let releases = Arc::new(AtomicU64::new(0));
        let engine = Arc::new(EngineId::new());
        let residency = Residency::new();
        let stderr_dir = Arc::new(Mutex::new(None));
        let worker = std::thread::spawn({
            let state = Arc::clone(&state);
            let releases = Arc::clone(&releases);
            let residency = residency.clone();
            let engine = Arc::clone(&engine);
            let stderr_dir = Arc::clone(&stderr_dir);
            move || work(inbox, state, releases, residency, engine, presence::probe, stderr_dir)
        });
        Self {
            commands,
            state,
            worker: Mutex::new(Some(worker)),
            engine,
            releases,
            residency,
            stderr_dir,
        }
    }

    /// Configure the rotating stderr file with the app's identifying-data redactor.
    /// Call before starting the engine so its first lines are covered.
    pub fn keep_stderr_in(
        &self,
        dir: PathBuf,
        redact: impl Fn(&str) -> String + Send + Sync + 'static,
    ) {
        if let Ok(mut held) = self.stderr_dir.lock() {
            *held = Some(crate::stderr_log::StderrLogConfig {
                dir,
                redact: Arc::new(redact),
            });
        }
    }

    /// The release count, shared with the stderr drain: a consumer that owns
    /// the model's session state (the app's metrics) keeps its last-applied
    /// value and applies every release it has not seen yet. Releases arrive on
    /// the stderr pipe of the child this run spawned, and nothing else is read.
    pub fn release_watcher(&self) -> Arc<AtomicU64> {
        Arc::clone(&self.releases)
    }

    /// Whether the server holds the model in memory right now. `None` when
    /// nothing has said yet since the server was spawned: the drain thread has
    /// not looked. This answers about the model, never about whether the server
    /// counts as up.
    pub fn model_asleep(&self) -> Option<bool> {
        self.residency.asleep()
    }

    /// A cheap handle on the two facts above, for a watcher that outlives or
    /// never holds the supervisor: the disk tier's tick thread carries one
    /// so an engine release or death is acted on without any poll.
    pub fn watch(&self) -> Watch {
        Watch {
            state: Arc::clone(&self.state),
            residency: self.residency.clone(),
            engine: Arc::clone(&self.engine),
        }
    }

    /// The server's state — and the closure of the one wedge no WRITER can
    /// reach. If the worker DIED mid-drain, nobody will ever write that
    /// drain's end: the guard takes only the drain's own ends, the command
    /// channel died with the thread, and the next `stop()` restores the
    /// `Stopping` it read. So this is a READ: with the state at `Stopping`
    /// AND the worker that owns it already finished, the drain is provably
    /// orphaned — the answer becomes the failed-to-stop state carrying the
    /// measures this side actually has: the dead worker, and NO port,
    /// because nothing is left that could ask (inventing one would be a
    /// measurement nobody took). A worker still alive keeps the plain
    /// reading: the declaration stands while somebody can still perform it.
    pub fn state(&self) -> ServerState {
        let current = self
            .state
            .lock()
            .map(|s| s.clone())
            .unwrap_or(ServerState::Stopped);
        if matches!(current, ServerState::Stopping) && self.worker_finished() {
            return ServerState::Failed {
                reason: Failure::StopUnconfirmed {
                    measures: "the worker that owns this drain exited without writing its end; \
                     the state has stood at Stopping since — no port was probed, because there \
                     is no worker left to walk or to ask"
                        .to_string(),
                },
            };
        }
        current
    }

    /// Whether the worker thread has finished. A handle already TAKEN by
    /// `shutdown`'s join reads as NOT finished on purpose: the join is in
    /// progress, its worker is alive until it returns, and nothing may be
    /// reported over a drain somebody is still performing.
    fn worker_finished(&self) -> bool {
        self.worker
            .lock()
            .ok()
            .map(|worker| worker.as_ref().is_some_and(|handle| handle.is_finished()))
            .unwrap_or(false)
    }

    /// Sends the start to the worker and returns at once with the handle to
    /// its verdict: the takeover, the handshake and the spawn all happen on the
    /// worker thread, the UI watches `state()`, and a caller that must know
    /// whether the request was taken blocks on the waiter's outcome.
    pub fn start(&self, config: ServerConfig) -> StartWaiter {
        let (sender, receiver) = mpsc::channel();
        let (settled_sender, settled_receiver) = mpsc::channel();
        let _ = self.commands.send(Command::Start(
            Box::new(config),
            sender,
            settled_sender,
        ));
        StartWaiter {
            verdict: receiver,
            settled: settled_receiver,
        }
    }

    /// Asks the worker to stop the server and reaps it there. NON-BLOCKING:
    /// it returns at once, and the drain it starts is declared HERE — before
    /// the command is queued — so a `brain_state` poll landing anywhere in
    /// the teardown reads `Stopping` rather than the `Running` that used to
    /// send it into the door's raising arm. A caller that must block uses
    /// `shutdown`.
    pub fn stop(&self) {
        let declared = drain::declare(&self.state);
        // The declaration travels: the worker cannot read it back off the
        // state (that now says `Stopping`), and §18's second stop is decided
        // by what the state said BEFORE this drain was declared. `restore`
        // still gets the declaration itself on a send that never left.
        if self
            .commands
            .send(Command::Stop {
                prior: declared.clone(),
            })
            .is_err()
        {
            // No worker to receive it (already joined, or dead): a drain
            // nobody performs must not stand as a state.
            drain::restore(&self.state, declared);
        }
    }

    /// Stops the server and joins the worker: call this on app exit, so the
    /// child is gone before we are. Declares the drain first, exactly as
    /// `stop` does, and still joins afterwards. The app's exit handler runs
    /// on `ExitRequested` AND on `Exit`, so its second call finds no worker
    /// left: that is the declaration `restore` takes back.
    pub fn shutdown(&self) {
        let declared = drain::declare(&self.state);
        // Same carry as `stop`: the walk this command performs decides on the
        // pre-declare state, not on `Stopping`.
        if self
            .commands
            .send(Command::Shutdown {
                prior: declared.clone(),
            })
            .is_err()
        {
            drain::restore(&self.state, declared);
        }
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(handle) = worker.take() {
                let _ = handle.join();
            }
        }
    }
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::new()
    }
}

fn work(
    inbox: Receiver<Command>,
    state: Arc<Mutex<ServerState>>,
    releases: Arc<AtomicU64>,
    residency: Residency,
    engine: Arc<EngineId>,
    // The port probe the stop walk asks, exactly as `stop` takes it:
    // production always passes `presence::probe` — the API has no probe
    // parameter, and the test that drives `Supervisor::stop` must not
    // depend on a socket it (or a neighbour) can rebind under its feet.
    probe: presence::Probe,
    // Snapshot the file configuration for each child when handling its start.
    stderr_dir: Arc<Mutex<Option<crate::stderr_log::StderrLogConfig>>>,
) {
    let mut owned: Option<Owned> = None;
    // The last start's config, kept after `owned` goes: §18's second stop
    // probes the address it remembers when nothing is owned anymore.
    let mut last: Option<ServerConfig> = None;
    // Starts this process has asked for, as the number the log names them by:
    // a report then sees a restart as a second start, not as a gap.
    let mut starts: u64 = 0;
    loop {
        match inbox.recv_timeout(TICK) {
            Ok(Command::Start(config, outcome, settled)) => {
                if owned.is_some() {
                    let _ = outcome.send(StartOutcome::Refused);
                    // `settled` is dropped with the command: no answer for
                    // a start nobody took, and a waiter that asks gets None.
                    continue; // already on: the switch is not a restart button
                }
                last = Some(config.as_ref().clone());
                starts += 1;
                // The verdict comes before the work: a caller that records
                // the launch on acceptance must not wait out a handshake
                // whose answer decides whether the record exists at all.
                let _ = outcome.send(StartOutcome::Accepted);
                set(&state, ServerState::Starting);
                // This start owns the residency cell from here. The previous
                // server's answer must not outlive it, and the new server's
                // drain thread has not looked yet: between those two moments the
                // honest answer is "not known", and the reset is synchronous so
                // that no poll can land on the older server's answer. It sits
                // before the handshake, because the handshake's success is what
                // reports the new server as running.
                residency.forget();
                let stderr_dir = stderr_dir.lock().ok().and_then(|held| held.clone());
                let started = start_blocking(
                    &config,
                    Arc::clone(&releases),
                    residency.clone(),
                    starts,
                    &engine,
                    stderr_dir.as_ref(),
                );
                match started {
                    Ok(Started::Spawned { child, instance }) => {
                        set(
                            &state,
                            ServerState::Running {
                                pid: child.pid(),
                                port: config.port,
                            },
                        );
                        // The identity was published at the spawn, inside
                        // `start_blocking`, before the readiness wait.
                        let _ = settled.send(StartSettled::Up);
                        owned = Some(Owned {
                            child: Some(child),
                            adopted_pid: None,
                            instance: Some(instance),
                            config: *config,
                        });
                    }
                    Err(reason) => {
                        set(
                            &state,
                            ServerState::Failed {
                                reason: reason.clone(),
                            },
                        );
                        engine.clear();
                        log::warn!("engine start failed: {reason:?}");
                        let _ = settled.send(StartSettled::Failed(reason));
                    }
                }
            }
            Ok(Command::Stop { prior }) => {
                stop(&mut owned, last.as_ref(), &state, probe, prior, &engine);
            }
            Ok(Command::Shutdown { prior }) => {
                stop(&mut owned, last.as_ref(), &state, probe, prior, &engine);
                return;
            }
            #[cfg(test)]
            Ok(Command::Plant(run)) => {
                // A planted run stands in for a start: it brings the config
                // exactly as one would leave it, or §18's second stop would
                // have no address to probe and the API test could not see
                // the probe path.
                last = Some(run.config.clone());
                match run.child.as_ref() {
                    // A planted child stands for a spawned engine, identity
                    // and all; a planted adopted pid for the never-held kind.
                    Some(child) => engine.publish(child.pid()),
                    None => engine.clear(),
                }
                owned = Some(*run);
            }
            Err(RecvTimeoutError::Timeout) => {
                // The server can die on its own at any moment (an assertion, an
                // OS kill, a model it could not load). Reporting it is the whole
                // point of hosting it in another process.
                if let Some(run) = owned.as_mut() {
                    match run.child.as_mut() {
                        Some(child) => {
                            if let Ok(Some(status)) = child.try_wait() {
                                let reason = exit_reason(child, status);
                                log::warn!("engine exit code: {}", exit_code(status));
                                log::warn!("engine exited: {reason:?}");
                                log_stderr_tail(child);
                                owned = None;
                                engine.clear();
                                set(&state, ServerState::Failed { reason });
                            }
                        }
                        // A child-less server with a pid is watched by pid; one
                        // without a pid is watched by health, which is the
                        // stricter of the two: a recycled pid looks alive, a
                        // dead server answers nothing.
                        None => {
                            if let Some(pid) = run.adopted_pid {
                                if !child::pid_alive(pid) {
                                    owned = None;
                                    engine.clear();
                                    set(
                                        &state,
                                        ServerState::Failed {
                                            reason: Failure::ServerExited {
                                                exit_code: None,
                                                exit_signal: None,
                                                detail: format!(
                                                    "the adopted server (pid {pid}) is no longer alive"
                                                ),
                                            },
                                        },
                                    );
                                }
                            } else if !health::health_ok(
                                run.config.address(),
                                health::HEALTH_PATH,
                                PROBE_TIMEOUT,
                            ) {
                                owned = None;
                                engine.clear();
                                set(
                                    &state,
                                    ServerState::Failed {
                                        reason: Failure::ServerExited {
                                            exit_code: None,
                                            exit_signal: None,
                                            detail: "the adopted server stopped answering /health"
                                                .to_string(),
                                        },
                                    },
                                );
                            }
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// The identity outlives the walk only in the one case the exit still has
/// to finish it: the spawned child that was killed but never reaped, whose
/// pid is still ours alone and still signalable. Every other walk end
/// clears it — a reaped child's pid is recyclable, and an adopted pid was
/// never held (see `Watch::finish_engine`).
fn stop(
    owned: &mut Option<Owned>,
    // The last start's config, kept by the worker after `owned` is gone:
    // the only address a SECOND stop has to probe (§18). None where nothing
    // was ever started.
    config: Option<&ServerConfig>,
    state: &Arc<Mutex<ServerState>>,
    // The port probe arrives as an argument: production passes `presence::
    // probe`, and the tests that assert the POLICY below pass a script — a
    // policy test must not depend on a socket it (or a neighbour) can
    // rebind under its feet.
    probe: presence::Probe,
    // What the state read BEFORE the caller declared the drain —
    // `drain::declare`'s return, carried by the command. The declaration
    // set `Stopping`, so the carried prior is the only record of what the
    // first stop left behind (§18).
    prior: Option<ServerState>,
    engine: &EngineId,
) {
    let prior = match prior {
        Some(declared) => Some(declared),
        // No declaration was carried: an undeclared direct call's prior is
        // simply the state as it reads, and a poisoned lock is nothing
        // known — never unconfirmed.
        None => state.lock().ok().map(|current| current.clone()),
    };
    // Kept only when it says the previous stop could not prove absence:
    // `StopUnconfirmed` means absence was never proved, and `owned` is gone
    // already — this is all a second stop has to go on (§18).
    let unconfirmed = match prior {
        Some(
            state @ ServerState::Failed {
                reason: Failure::StopUnconfirmed { .. },
            },
        ) => Some(state),
        _ => None,
    };
    // Every entry to a stop passes here and declares the drain — a caller
    // that already declared it is re-declared, not doubled (`drain` drops the
    // duplicate write). What the walk below writes is the drain's END, and
    // there are exactly two: `Stopped` (absence proved, `presence::settle`)
    // or the failed-to-stop state carrying the measures of what could not be
    // proved. `§9`: a stop must not declare success while the engine lives.
    set(state, ServerState::Stopping);
    // Default for a stop with nothing owned from a quiet state: nothing of
    // ours to prove gone. The §18 arm below overrides it only when the last
    // stop said otherwise.
    let mut end = ServerState::Stopped;
    if let Some(mut run) = owned.take() {
        // The PROCESS half's witness, from what the teardown reported — the
        // `let _ =` walk that used to swallow its own result is gone: a
        // grace expiry, a survivor and an io error are all data now.
        let (witness, walk, escalated) = match (run.child.take(), run.adopted_pid, run.instance.take()) {
            (Some(mut child), _, instance) => {
                let pid = child.pid();
                let report = child.terminate(run.config.stop_grace);
                // Reaped is the boundary: from the reap on, the pid can be
                // recycled, so it must never be signalled again — not even
                // by an exit that found the stop unconfirmed. Unreaped (the
                // kill was issued and no status landed) it is still ours
                // alone, and the exit may still have to finish it.
                if matches!(report, child::Termination::Gone { .. }) {
                    engine.clear();
                }
                let escalated = matches!(
                    report,
                    child::Termination::Gone { needed: child::Step::Kill }
                );
                let walk = format!(
                    "spawned child pid {pid}, {}: {report:?}",
                    child::walk_line(run.config.stop_grace)
                );
                if let Some(file) = instance {
                    file.release();
                }
                let witness = match &report {
                    // Reaped: the kernel's own proof about OUR child.
                    child::Termination::Gone { .. } => presence::Witness::Reaped,
                    child::Termination::Survived { .. } => presence::Witness::PidAlive { pid },
                    child::Termination::Unknown { .. } => {
                        if child::pid_alive(pid) {
                            presence::Witness::PidAlive { pid }
                        } else {
                            presence::Witness::PidDead { pid }
                        }
                    }
                };
                (witness, walk, escalated)
            }
            (None, Some(pid), _) => {
                // A pid held without a child. No start produces one, so only a
                // planted pid gets here. The proof it was ours was the lock,
                // and time has passed: if the server died and the pid was
                // recycled, the lock is gone and the pid now names somebody
                // else's program. Terminate only a pid the file still vouches
                // for; when it does not, THAT is reported as the unknown it is
                // instead of being skipped in silence.
                engine.clear();
                let report = match InstanceFile::inspect(&run.config.state_file) {
                    Ok(Existing::Live { pid: current, .. }) => {
                        let outcome = if current == pid {
                            child::terminate_pid(pid, run.config.stop_grace)
                        } else {
                            child::Termination::Unknown {
                                detail: format!(
                                    "the state file vouches for pid {current}, not {pid}: not signalled"
                                ),
                            }
                        };
                        let _ = std::fs::remove_file(&run.config.state_file);
                        outcome
                    }
                    Ok(existing) => child::Termination::Unknown {
                        detail: format!(
                            "the state file no longer vouches for pid {pid} ({existing:?}): not signalled"
                        ),
                    },
                    Err(error) => child::Termination::Unknown {
                        detail: format!("the state file cannot be read ({error}): pid {pid} not signalled"),
                    },
                };
                let escalated = matches!(
                    report,
                    child::Termination::Gone { needed: child::Step::Kill }
                );
                let walk =
                    format!("adopted pid {pid}, {:?} per rung: {report:?}", run.config.stop_grace);
                let witness = match &report {
                    child::Termination::Gone { .. } => presence::Witness::PidDead { pid },
                    child::Termination::Survived { .. } => presence::Witness::PidAlive { pid },
                    child::Termination::Unknown { .. } => {
                        if child::pid_alive(pid) {
                            presence::Witness::PidAlive { pid }
                        } else {
                            presence::Witness::PidDead { pid }
                        }
                    }
                };
                (witness, walk, escalated)
            }
            // No pid was ever recorded, so the process half can never be
            // proven here — only the port can speak (§9:
            // `Stopped` only after the probe fails), and what it could not
            // prove becomes the suspicion record beside the state file.
            (None, None, _) => {
                engine.clear();
                (
                    presence::Witness::Unwatched,
                    "adopted blind: no pid was ever recorded, so no process could be signalled"
                        .to_string(),
                    false,
                )
            }
        };
        // The PORT half's witness, and the join (§9's two halves). NOT
        // `health_ok`: a refused connection is absence, a 503 or a silence
        // after a successful connect is presence (`presence`).
        let addr = run.config.address();
        let answer = probe(addr, presence::PROBE_TIMEOUT);
        let settled = presence::settle(&witness, &answer);
        let measures = format!("{walk}; process {witness:?}; port {addr} — {answer:?}");
        // The walk registers itself when it is not a plain exit: a SIGKILL
        // escalation or an unconfirmed stop is a line the operator can read,
        // never a `let _ =`.
        if escalated || !settled.stopped {
            log::warn!("stop walk: {measures}");
        }
        if settled.record {
            // §9's suspicion, carried to the next start: absence was not
            // proved on both halves, so `<state file>.orphan` says what this
            // stop could not — recovered or replaced when the next start
            // finds out which (`suspect`).
            let _ = Suspect::of(&run.config.state_file).write(&measures);
        }
        end = if settled.stopped {
            ServerState::Stopped
        } else {
            ServerState::Failed {
                reason: Failure::StopUnconfirmed { measures },
            }
        };
    } else if let Some(previous) = unconfirmed {
        // §18: the first stop took what was owned — whatever it ended in —
        // and the state it left says absence was never proved. Writing
        // `Stopped` here would claim a success with nothing checked. The
        // port is the half that still speaks, and the last start's config
        // still knows where it is: ask it the way the blind rule does —
        // `Gone` proves it (and, as always when only one half spoke, leaves
        // the suspicion record), anything else keeps `StopUnconfirmed` with
        // fresh measures. Every other nothing-owned state keeps its old
        // answer: from `Stopped` or `Idle` there is nothing to prove.
        match config {
            Some(config) => {
                let addr = config.address();
                let answer = probe(addr, presence::PROBE_TIMEOUT);
                let settled = presence::settle(&presence::Witness::Unwatched, &answer);
                let measures =
                    format!("a second stop, nothing owned: port {addr} — {answer:?}");
                if !settled.stopped {
                    log::warn!("stop walk: {measures}");
                }
                if settled.record {
                    let _ = Suspect::of(&config.state_file).write(&measures);
                }
                end = if settled.stopped {
                    ServerState::Stopped
                } else {
                    ServerState::Failed {
                        reason: Failure::StopUnconfirmed { measures },
                    }
                };
            }
            // Nothing to ask (nothing was ever started here): the old word
            // stands — the trap this arm exists for is claiming `Stopped`.
            None => end = previous,
        }
    }
    set(state, end);
}

/// Stops or clears a previous instance, then spawns and waits for readiness.
fn start_blocking(
    config: &ServerConfig,
    releases: Arc<AtomicU64>,
    residency: Residency,
    start: u64,
    engine: &EngineId,
    stderr_dir: Option<&crate::stderr_log::StderrLogConfig>,
) -> Result<Started, Failure> {
    // Before anything exists: an unsafe binding must be refused, not started
    // and then failed to be found.
    config
        .verified_binding()
        .map_err(|detail| Failure::UnsafeBinding { detail })?;
    // The suspicion a previous stop could not disprove, settled FIRST: a
    // refusing port means there was nothing — recovered, deleted before this
    // walk goes on, whatever it then does. An answering port leaves the
    // record standing; a start that fails with a stranger or an orphan still
    // on the port keeps it, because the suspicion is still open.
    let suspect = Suspect::of(&config.state_file);
    suspect.settle_before_start(presence::probe, config.address(), presence::PROBE_TIMEOUT);
    take_over(config)?;
    // The port is confirmed free before the child exists — see
    // `await_port_free`: a launch that raced a dying engine bound beside it,
    // or reported a stranger's engine as its own ready one.
    await_port_free(config, PORT_FREE_TIMEOUT)?;
    let mut instance =
        InstanceFile::claim(&config.state_file).map_err(|e| Failure::InstanceUnwritable {
            detail: format!("could not write our state file: {e}"),
        })?;
    // The record before the thing: port and exact command are on disk before
    // the child exists, so a writer that dies past this point still leaves a
    // file that names its heir's server. The pid completes it below.
    instance
        .announce(config.port, &config.binding())
        .map_err(|e| Failure::InstanceUnwritable {
            detail: format!("could not write our state file: {e}"),
        })?;
    let mut child = ChildHandle::spawn(
        &config.exe,
        &config.argv,
        Some(instance.handle()),
        releases,
        residency,
        stderr_dir,
        &config.api_key,
    )
    .map_err(|e| Failure::ServerNotStarted {
        detail: format!("could not start the server: {e}"),
    })?;
    // The identity is published the moment the child exists, before the
    // readiness wait below: an exit that lands while the engine is still
    // starting — the wait can run a whole `ready_timeout` — must already
    // find it, or the engine is orphaned with the identity empty.
    engine.publish(child.pid());
    // The engine start, as the launch describes it: the binary's own name
    // (it carries the pinned build) and the flags and paths it was handed,
    // rendered by [`argv_line`] — never Debug, whose doubled backslashes a
    // Windows path would smuggle past the log sink's redaction. Flags and
    // paths only: the argv's renderer cannot emit a verbose flag, so no
    // prompt text can ever ride the engine's stderr tail.
    log::info!(
        "engine start #{start}: {} argv {}",
        engine_name(&config.exe),
        argv_line(&config.argv)
    );
    let began = Instant::now();
    instance
        .describe(child.pid(), config.port)
        .map_err(|e| {
            // The child this Err leaves behind is killed and reaped by its
            // own Drop, which this function cannot observe: a pid left
            // published over an unobserved reap is a pid the exit might
            // signal after it stopped being ours alone.
            engine.clear();
            Failure::InstanceUnwritable {
                detail: format!("could not write our state file: {e}"),
            }
        })?;

    let deadline = Instant::now() + config.ready_timeout;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let reason = exit_reason(&child, status);
            log::warn!("engine exit code: {}", exit_code(status));
            log::warn!("engine exited before it was ready: {reason:?}");
            log_stderr_tail(&child);
            // `try_wait` above was the reap: the pid is no longer ours alone.
            engine.clear();
            return Err(reason);
        }
        match health::who_answers(config.address(), config.api_key.as_str(), PROBE_TIMEOUT) {
            health::Who::Ready => {
                // Ready takes BOTH halves as proof: the handshake has just
                // shown that whoever holds the port is this run's engine, and
                // `Ok(None)` is the only answer from the child that means
                // alive. A reap is `Some` — the arm above reports it — and an
                // error is not an answer at all. Neither is life, and this
                // arm falls through to the deadline rather than looping on a
                // child this can no longer read.
                if matches!(child.try_wait(), Ok(None)) {
                    log::info!("engine ready in {:.1}s", began.elapsed().as_secs_f64());
                    suspect.clear();
                    return Ok(Started::Spawned { child, instance });
                }
            }
            // Something that is not our engine holds the port and is serving:
            // it answered, and it refused the key this run minted for its own
            // child. Adopting it would report a stale server — running
            // yesterday's model under yesterday's key — as this start's
            // engine, and every measurement after it would be that server's.
            // Never signalled: it is not ours to signal.
            health::Who::Stranger => {
                let walked = child.terminate(config.stop_grace);
                if matches!(walked, child::Termination::Gone { .. }) {
                    engine.clear();
                }
                log::warn!(
                    "127.0.0.1:{} answers with another engine's key: a server that is not ours holds the port, and this start will not adopt it",
                    config.port
                );
                log_stderr_tail(&child);
                return Err(Failure::PortTaken);
            }
            health::Who::Loading => {}
        }
        if Instant::now() >= deadline {
            let seconds = config.ready_timeout.as_secs();
            let walked = child.terminate(config.stop_grace);
            if matches!(walked, child::Termination::Gone { .. }) {
                engine.clear();
            }
            log::warn!("engine not ready in {seconds}s");
            log_stderr_tail(&child);
            return Err(Failure::NotReady { seconds });
        }
        std::thread::sleep(TICK);
    }
}

/// The binary's own name — the one part of the path that names what is
/// running and, for a shipped engine, which build (the pinned id is in the
/// name). The whole path is the redaction helper's business at the sink.
fn engine_name(exe: &Path) -> String {
    exe.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| exe.to_string_lossy().into_owned())
}

/// The argv as one readable line: args joined by spaces, an argument that
/// itself contains a space wrapped in quotes. Deliberately NOT `{:?}` over
/// the vector — Debug doubles every backslash, and a Windows path in Debug
/// form (`C:\\Users\\name\\…`) is invisible to the log sink's redaction.
fn argv_line(argv: &[String]) -> String {
    argv.iter()
        .map(|arg| {
            if arg.contains(' ') {
                format!("\"{arg}\"")
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// How much of one stderr line reaches the log: enough to carry an error
/// and its context, short enough that a line carrying something it should
/// not cannot carry much of it.
const STDERR_CLIP: usize = 300;

/// The withheld lines' replacement, named once so the log reads the same
/// wherever the filter bites — the app log's stderr lines and the engine's
/// stderr file alike.
pub(crate) const WITHHELD: &str = "<a request error line was withheld>";

/// A withheld line that names an out-of-memory death leaves this instead: `oom.rs`
/// reads the death from its words, and the marker keeps the words but not the line.
pub(crate) const OUT_OF_MEMORY_WITHHELD: &str = "<a line with out of memory was withheld>";

/// The marker one withheld line leaves in its place.
pub(crate) fn withheld_marker(line: &str) -> &'static str {
    if is_out_of_memory_line(line) {
        OUT_OF_MEMORY_WITHHELD
    } else {
        WITHHELD
    }
}

/// The engine's own last words, made safe for the log: a line the engine
/// allowlist does not name becomes a withheld marker, every other line is
/// clipped to [`STDERR_CLIP`] characters. One marker is logged for however many
/// were dropped — the count is the shape of one bad request, not information the
/// log needs. An out-of-memory marker wins over the generic one.
fn sanitized_tail(lines: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut withheld = None;
    for line in lines {
        if is_safe_engine_line(line) {
            let clipped: String = line.chars().take(STDERR_CLIP).collect();
            out.push(clipped);
        } else if withheld != Some(OUT_OF_MEMORY_WITHHELD) {
            withheld = Some(withheld_marker(line));
        }
    }
    out.extend(withheld.map(str::to_owned));
    out
}

/// Only the allowlisted lines reach the app log, which redacts identifying data
/// from what it writes.
fn log_stderr_tail(child: &ChildHandle) {
    for line in sanitized_tail(&child.output_tail()) {
        log::warn!("engine stderr: {line}");
    }
}

/// What the state file says about a previous run.
///
/// Nothing of an earlier run is adopted: its engine key died with that run, so
/// it would answer every authenticated request with 401.
///
/// The lock decides what may be trusted, and the executable decides what may
/// be SIGNALLED — a pid from a file is a name, and a name can be recycled.
/// While the lock is held the process it names is the server the writer
/// started; without it, that pid may be anything, and the only engine this
/// start may close is one whose executable it can prove.
fn take_over(config: &ServerConfig) -> Result<(), Failure> {
    match InstanceFile::inspect(&config.state_file) {
        Ok(Existing::None) => Ok(()),
        // The lock is free: the writer is gone. Its engine may not be. On
        // unix the child inherited the locked descriptor, so an orphan
        // cannot outlive its own state file; on Windows nothing is
        // inherited and the engine keeps serving the port, which is how a
        // crashed app became `PortTaken` on every launch afterwards. So the
        // pid is examined here exactly as the locked branch examines it —
        // proved by executable, then walked — and a pid that fails the proof
        // is reported and left running.
        Ok(Existing::Stale { pid, binding }) => {
            if let Some(pid) = pid {
                if child::pid_alive(pid) {
                    if ours_to_stop(pid, binding.as_deref(), config) {
                        let walked = child::terminate_pid(pid, config.stop_grace);
                        log_termination(walked, &format!("the orphaned engine (pid {pid})"));
                    } else {
                        log::warn!(
                            "the stale state file names pid {pid}, which is not our engine; removing the file without signalling it"
                        );
                    }
                }
            }
            let _ = std::fs::remove_file(&config.state_file);
            Ok(())
        }
        Ok(Existing::Live { pid, binding, .. }) => {
            // Ours, but it holds the previous run's key. Closing it frees the
            // port; if it survives, the port wait that follows refuses — and
            // so does one this run may not signal at all.
            // Not proved to be our engine: leave it running and let the port
            // wait below decide. A stranger may hold no port at all, and a
            // start that refused on a file's say-so would refuse for a
            // process that was never in the way.
            if child::pid_alive(pid) && !ours_to_stop(pid, binding.as_deref(), config) {
                let _ = std::fs::remove_file(&config.state_file);
                return Ok(());
            }
            if child::pid_alive(pid) {
                // The verdict is the record: `let _ =` here is what made a
                // start that raced a still-dying engine look like a clean one.
                let walked = child::terminate_pid(pid, config.stop_grace);
                log_termination(walked, &format!("the earlier run's engine (pid {pid})"));
            }
            let _ = std::fs::remove_file(&config.state_file);
            Ok(())
        }
        Ok(Existing::Unidentified { .. }) => Err(Failure::InstanceUnreadable {
            detail: "an engine from an earlier run holds the port and must be stopped; its state file names no pid"
                .to_string(),
        }),
        Err(e) => Err(Failure::InstanceUnreadable {
            detail: format!("our state file cannot be read: {e}"),
        }),
    }
}

/// One walk's outcome, in the log — the record the verdict is kept in, so a
/// start that raced a still-dying engine cannot look like a clean one.
fn log_termination(walked: child::Termination, what: &str) {
    match walked {
        child::Termination::Gone { .. } => log::info!("stopped {what}"),
        child::Termination::Survived { detail, .. } => {
            log::warn!("{what} survived the walk: {detail}")
        }
        child::Termination::Unknown { detail } => {
            log::warn!("{what} could not be walked: {detail}")
        }
    }
}

/// Whether a pid the state file names may be stopped as OUR engine.
///
/// Two proofs, and either is enough; a pid that fails both is never signalled,
/// because a state file names a pid rather than owning it, and a recycled pid
/// belongs to whoever holds it now. What we check is that the process is
/// running the very binary this start is about to launch — `kalsa-server` out
/// of our runtime builds — not merely that something holds our state file.
fn ours_to_stop(pid: u32, recorded_binding: Option<&str>, config: &ServerConfig) -> bool {
    // The binding a previous run recorded starts with the executable it ran.
    // A state file that names another binary is not describing an engine of
    // ours, whatever else it says.
    if let Some(recorded_exe) = recorded_binding
        .and_then(|binding| binding.split('\u{1f}').next())
        .filter(|exe| !exe.is_empty())
    {
        if !is_our_engine(Path::new(recorded_exe), &config.exe) {
            log::warn!(
                "pid {pid} was recorded running {recorded_exe}, not our engine {}; not signalling it",
                config.exe.display()
            );
            return false;
        }
    }
    match child::pid_executable(pid) {
        // The pid must be running the very binary the record names. The OS
        // may report a different SPELLING of the same file — a hard-linked
        // `/bin/sh`, a runtime directory reached through a symlink — and a
        // start that refused our own engine over that would wedge the app.
        Some(running) if !matches_record(recorded_binding, &running) => {
            // A process that has not exec'd yet is still a fork of this app,
            // and it is about to become the very engine the state file names:
            // the window between the spawn and the exec is microseconds wide,
            // and reading it as a stranger would fail our own start. Anything
            // else running under this pid is somebody else's.
            let ours_before_exec = std::env::current_exe().is_ok_and(|app| app == running);
            if !ours_before_exec {
                log::warn!(
                    "pid {pid} is running {}, not our engine {}; not signalling it",
                    running.display(),
                    config.exe.display()
                );
            }
            ours_before_exec
        }
        Some(_) => true,
        // The OS would not say — no permission, no /proc, a platform without
        // the call. The recorded binding above is all there is, so say so
        // rather than pretend the check ran.
        None => {
            log::info!(
                "the OS would not name the executable of pid {pid}; the recorded binding is the only proof this start has"
            );
            recorded_binding
                .and_then(|binding| binding.split('\u{1f}').next())
                .is_some_and(|exe| is_our_engine(Path::new(exe), &config.exe))
        }
    }
}

/// Whether an executable is an engine of ours, out of this app's own runtime:
/// `<runtime>/builds/<backend>/kalsa-server-<version>/kalsa-server`, the layout
/// `kalsa-runtime` publishes and extracts into.
///
/// The version AND the backend may both differ from this start's — a build
/// upgrade moves the version in the directory's name, and a CPU→Vulkan switch
/// moves the directory between them — and an engine either of them left behind
/// is still ours to close. So the question is not "the same file as this
/// start's" but "out of the same builds root, and named as one engine".
///
/// Nothing else is ours: another server, a shell, a process that inherited our
/// state file, a `kalsa-server` some other product shipped under the same name
/// — a different builds root is a different product's engine, and signalling it
/// stops the user's other app.
fn is_our_engine(running: &Path, ours: &Path) -> bool {
    if same_file(running, ours) {
        return true;
    }
    match (our_builds_root(running), our_builds_root(ours)) {
        (Some(running_root), Some(ours_root)) => running_root == ours_root,
        _ => false,
    }
}

/// The `<runtime>/builds` root an engine belongs to, when the path is an engine
/// in our own layout. `None` for anything else, which is never ours.
fn our_builds_root(exe: &Path) -> Option<&Path> {
    let archive = exe.parent()?; // …/builds/<backend>/kalsa-server-<version>
    if !archive
        .file_name()?
        .to_string_lossy()
        .starts_with("kalsa-server-")
    {
        return None;
    }
    let builds = archive.parent()?.parent()?; // …/builds
    if builds.file_name()? != "builds" {
        return None;
    }
    // The engine inside the archive, not a library shipped beside it.
    let name = exe.file_name()?.to_string_lossy();
    let stem = name.strip_suffix(".exe").unwrap_or(&name);
    matches!(stem, "kalsa-server" | "llama-server").then_some(builds)
}

/// Whether the record's executable and the running one are the same binary.
///
/// Paths are spellings; a process is a file. `same_file` compares what the
/// filesystem says — the same inode on unix — so a hard link or a symlinked
/// directory is recognised as the engine we already named, and a pid that has
/// since been recycled onto a different file is not.
fn matches_record(recorded_binding: Option<&str>, running: &Path) -> bool {
    let Some(recorded) = recorded_binding
        .and_then(|binding| binding.split('\u{1f}').next())
        .filter(|exe| !exe.is_empty())
    else {
        // A record that names no executable has nothing to check a pid
        // against, and nothing may be signalled on its say-so alone.
        return false;
    };
    same_file(Path::new(recorded), running)
}

/// Whether two paths are the same file.
///
/// The filesystem's own answer decides whenever it can — the device and inode
/// on unix, the volume serial and file index on Windows — because paths are
/// spellings and a pid is a file: a hard link, a symlinked runtime directory,
/// or a path that has been written over since the record named it are all
/// things only the file's identity sees. Spelling is the last resort, for the
/// paths the OS will not describe (a binary that is not there yet, a pid that
/// has exited).
fn same_file(a: &Path, b: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        return match (std::fs::metadata(a), std::fs::metadata(b)) {
            (Ok(a), Ok(b)) => a.dev() == b.dev() && a.ino() == b.ino(),
            _ => a == b,
        };
    }
    #[cfg(windows)]
    {
        return match (file_id(a), file_id(b)) {
            (Some(left), Some(right)) => left == right,
            _ => a == b,
        };
    }
    #[cfg(not(any(unix, windows)))]
    {
        a == b
    }
}

/// What the filesystem calls this file on Windows: the volume it lives on and
/// its index there, which together are what two spellings of one file share.
/// std has no stable accessor for either, so the handle it opened is asked
/// directly — the file is already open, the handle belongs to that `File`, and
/// nothing here has to close it.
#[cfg(windows)]
fn file_id(path: &Path) -> Option<(u32, u64)> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let file = std::fs::File::open(path).ok()?;
    let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    let read =
        unsafe { GetFileInformationByHandle(file.as_raw_handle() as HANDLE, &mut information) };
    if read == 0 {
        return None;
    }
    let index = ((information.nFileIndexHigh as u64) << 32) | information.nFileIndexLow as u64;
    Some((information.dwVolumeSerialNumber, index))
}

/// The port, confirmed free before the child exists.
///
/// An earlier run's engine that did not exit cleanly is still bound here, and
/// the walk in `take_over` may only just have asked it to go: `SIGTERM` is a
/// request, and the socket of a dying engine holding a 14.5 GB model is
/// released by the kernel only once the process is really gone. Launching
/// into that gap gives the child a bind that cannot succeed, and hands the
/// readiness handshake a stranger's `/health` to answer with (module
/// `health`). So this is a WAIT, bounded: the port is polled until this
/// process may bind it, and a port that stays held is a start that fails
/// loudly rather than one that adopts whoever is holding it. The bound is
/// short because the walk has already spent its own grace — what is left to
/// wait for is a kernel that has not yet reaped, or a stranger who never
/// lets go at all.
///
/// Still not a guarantee: the listener is dropped at once, and between the
/// drop and the child's own bind any process on the machine may step in. No
/// retry loop or sleep can close that window; only the kernel's own bind is
/// atomic, and the child performs it when it starts.
///
/// Kept because the report is worth more than the race costs: a stranger
/// already on the port is the common case, and `PortTaken` names it plainly
/// instead of letting the spawn fail later in the server's own words. The
/// real protection is elsewhere and threefold: `verified_binding` refuses a
/// non-loopback or wrong-port argv before any process exists; the child's
/// own bind fails loudly when the port is taken (surfaced as `ServerExited`
/// with the server's stderr); and the readiness handshake reports `Running`
/// only while the child it spawned is both alive and answering a route behind
/// this run's own key. A stranger found here is reported (`PortTaken`) and
/// never signalled.
fn await_port_free(config: &ServerConfig, timeout: Duration) -> Result<(), Failure> {
    let deadline = Instant::now() + timeout;
    let mut waited = false;
    loop {
        match TcpListener::bind(config.address()) {
            Ok(listener) => {
                // Freed at once: the child binds it for real — if nobody
                // takes it first, which this check cannot promise.
                drop(listener);
                if waited {
                    log::info!("the port came free while this start waited for it");
                }
                return Ok(());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                if Instant::now() >= deadline {
                    log::warn!(
                        "127.0.0.1:{} is still held {} s after the walk that freed it; this start will not launch into it",
                        config.port,
                        timeout.as_secs()
                    );
                    return Err(Failure::PortTaken);
                }
                waited = true;
                std::thread::sleep(TICK);
            }
            // Any other bind failure is not about a foreign listener: let the
            // server report it in its own words.
            Err(_) => return Ok(()),
        }
    }
}

fn exit_reason(child: &ChildHandle, status: std::process::ExitStatus) -> Failure {
    exit_reason_from(&child.output_tail(), status)
}

// Fatal diagnostics can precede backtrace frames; prefer them, and an out-of-memory
// marker counts as one. A withheld line is never the reason: its marker is what the
// tail ends with.
fn exit_reason_from(raw_tail: &[String], status: std::process::ExitStatus) -> Failure {
    let tail = sanitized_tail(raw_tail);
    let fatal = tail
        .iter()
        .rev()
        .find(|line| is_failure_line(line) || line.as_str() == OUT_OF_MEMORY_WITHHELD);
    Failure::ServerExited {
        exit_code: status.code().map(i64::from),
        exit_signal: exit_signal(status),
        detail: fatal.or_else(|| tail.last()).cloned().unwrap_or_else(|| format!("exit status {status}")),
    }
}

fn exit_signal(status: std::process::ExitStatus) -> Option<i64> {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        status.signal().map(i64::from)
    }
    #[cfg(not(unix))]
    {
        let _ = status;
        None
    }
}


/// The exit as one number for the log. The reason above prefers the engine's
/// own last line, which is the more useful sentence — and which is exactly
/// why the code gets a line of its own: a report must be able to tell a clean
/// exit from an access violation, and the tail cannot say that. A status with
/// no code is a killed process on a platform with signals.
fn exit_code(status: std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => code.to_string(),
        None => format!("none ({status})"),
    }
}

/// The one write to the state. What may land while a drain stands lives in
/// `drain`: a state reading `Stopping` takes only its own end.
fn set(state: &Arc<Mutex<ServerState>>, next: ServerState) {
    drain::set(state, next);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::Mutex;
    // The stranger stand-in and the blocking head it reads are unix fixtures.
    #[cfg(unix)]
    use std::sync::atomic::AtomicBool;
    #[cfg(unix)]
    use std::sync::Condvar;

    #[test]
    fn the_awaiting_trigger_line_is_withheld() {
        // Defence in depth, not an observed line: absent from the shipped
        // build's own strings and from the default verbosity. The allowlist
        // never names it, so a future build that prints it prints it nowhere.
        assert!(!is_safe_engine_line("srv  update_slots: awaiting trigger"));
    }

    /// The exception family the fork's server prints with request bytes in
    /// it, beside an ordinary line and the load banner — the tail as a dead
    /// engine would leave it.
    fn dead_engine_tail() -> Vec<String> {
        vec![
            "load: metal dispatch queue created".to_string(),
            "got exception: {\"messages\":[{\"role\":\"user\",\"content\":\"marco's question\"}]}".to_string(),
            "[json.exception.parse_error.101] parse error at line 1, column 9: syntax error - last read: 'marco's que'".to_string(),
            "unsupported Responses tool type 'interpretive dance' skipped".to_string(),
            "downloading image from 'https://example.invalid/marco-house.jpg'".to_string(),
            "common_chat_parse: unparsed json output: marco's answer".to_string(),
            "anthropic string not as expected: marco's system prompt".to_string(),
            "srv send_error: task id = 7, error: arbitrary marco text".to_string(),
            "Ignoring content part type: marco-custom".to_string(),
            "Tool call mismatch: prev='marco' new='other'".to_string(),
            "srv  update_slots: all slots are idle".to_string(),
        ]
    }

    #[test]
    fn the_engine_stderr_tail_never_carries_request_bytes() {
        let kept = sanitized_tail(&dead_engine_tail());
        let joined = kept.join("\n");
        assert!(
            !joined.contains("marco"),
            "request bytes survived the filter: {joined}"
        );
        assert!(
            !joined.contains("interpretive dance"),
            "a request's tool name survived the filter: {joined}"
        );
        assert_eq!(
            kept.iter().filter(|line| line.as_str() == WITHHELD).count(),
            1,
            "one withheld line, not one per dropped line"
        );
        assert!(
            joined.contains("all slots are idle") && joined.contains("metal dispatch"),
            "the ordinary lines survive: {joined}"
        );
    }

    /// A family the allowlist does not name is withheld, while the start and
    /// crash lines it does name are kept: the test for the default-deny rule.
    #[test]
    fn an_unknown_line_family_is_withheld_and_the_known_lines_survive() {
        let tail = vec![
            "load: metal dispatch queue created".to_string(),
            "slot render: marco's prompt text".to_string(),
            "/src/ggml-vulkan.cpp:1234: GGML_ASSERT(ctx != nullptr) failed".to_string(),
        ];
        let kept = sanitized_tail(&tail);
        assert_eq!(kept, vec![
            "load: metal dispatch queue created".to_string(),
            "/src/ggml-vulkan.cpp:1234: GGML_ASSERT(ctx != nullptr) failed".to_string(),
            WITHHELD.to_string(),
        ]);
    }

    const QUOTED_ASSERT: &str = "/src/llama-context.cpp:1504: GGML_ASSERT(cparams.n_ubatch >= n_tokens && \"encoder requires n_ubatch >= n_tokens\") failed";

    /// The quoted assertion is the crash's own line: kept verbatim, because the
    /// telemetry signature and the exit reason both read it.
    #[test]
    fn a_quoted_assert_line_is_kept_verbatim() {
        assert_eq!(sanitized_tail(&[QUOTED_ASSERT.to_string()]), vec![QUOTED_ASSERT.to_string()]);
    }

    /// The exit detail names the quoted assertion, not the generic marker.
    #[cfg(unix)]
    #[test]
    fn the_exit_detail_names_a_quoted_assert_line() {
        let tail = vec!["slot render: marco's prompt".to_string(), QUOTED_ASSERT.to_string()];
        let status = std::os::unix::process::ExitStatusExt::from_raw(6);
        match exit_reason_from(&tail, status) {
            Failure::ServerExited { detail, .. } => assert_eq!(detail, QUOTED_ASSERT),
            other => panic!("unexpected {other:?}"),
        }
    }

    /// A request's line never reads as an out-of-memory death, even when it quotes
    /// the words: `oom.rs` would skip the restart for a prompt's sake.
    #[test]
    fn a_request_line_about_out_of_memory_leaves_the_generic_marker() {
        let request = vec!["slot render: marco asks about out of memory".to_string()];
        assert_eq!(sanitized_tail(&request), vec![WITHHELD.to_string()]);
    }

    /// A backend's out-of-memory line leaves a marker that still says the words, and
    /// it wins over the generic marker.
    #[test]
    fn a_backend_out_of_memory_line_leaves_the_marker_that_names_the_death() {
        let backend = "ggml_backend_cuda_buffer_type_alloc_buffer: allocating 512.00 MiB on device 0: cudaMalloc failed: out of memory";
        assert_eq!(sanitized_tail(&[backend.to_string()]), vec![OUT_OF_MEMORY_WITHHELD.to_string()]);
        assert!(OUT_OF_MEMORY_WITHHELD.contains("out of memory"));
        let both = vec![
            "slot render: marco's prompt".to_string(),
            backend.to_string(),
            "slot render: more prompt".to_string(),
        ];
        assert_eq!(sanitized_tail(&both), vec![OUT_OF_MEMORY_WITHHELD.to_string()]);
    }

    /// The exit's own number, on the line of its own the log writes: the
    /// reason beside it prefers the engine's last stderr line, so without
    /// this a report cannot tell a clean exit from a crash.
    #[test]
    fn an_exit_code_is_the_number_the_log_names() {
        #[cfg(unix)]
        let status = std::os::unix::process::ExitStatusExt::from_raw(3 << 8);
        #[cfg(windows)]
        let status = std::os::windows::process::ExitStatusExt::from_raw(3);
        assert_eq!(exit_code(status), "3");
    }

    /// The two walls the prompt-text leak has: the environment the child
    /// inherits names no `LLAMA_*` knob, and the stderr family those knobs
    /// print is filtered besides.
    #[test]
    fn the_prompt_debug_and_key_lines_never_reach_the_log() {
        let tail = vec![
            "slot 0 processing prompt, old: ... marco's question so far | and more".to_string(),
            "slot 0 processing prompt, new: ... marco's question edited | and more".to_string(),
            "api_keys: ****7f2a".to_string(),
        ];
        let kept = sanitized_tail(&tail);
        assert!(
            kept.iter().all(|line| line == WITHHELD),
            "every one of them is withheld: {kept:?}"
        );
    }

    /// The engine child's environment carries no `LLAMA_*` variable,
    /// whatever the launching shell exported: the fork's debug and
    /// verbosity knobs live there, and they are the ones that print prompt
    /// text and key fragments. `GGML_*` are performance knobs and stay.
    #[test]
    fn the_spawned_child_inherits_no_llama_environment() {
        use std::ffi::OsString;
        let env = vec![
            (OsString::from("LLAMA_SERVER_SLOTS_DEBUG"), OsString::from("1")),
            (OsString::from("llama_arg_log_verbosity"), OsString::from("10")),
            (
                OsString::from("GGML_CUDA_ENABLE_UNIFIED_MEMORY"),
                OsString::from("1"),
            ),
            (OsString::from("PATH"), OsString::from("/usr/bin")),
        ];
        let mut cmd = std::process::Command::new("llama-server");
        cmd.envs(env.clone());
        child::strip_llama_env(&mut cmd, env.into_iter());
        let seen: Vec<_> = cmd
            .get_envs()
            .map(|(name, value)| (name.to_string_lossy().into_owned(), value))
            .collect();
        for (name, value) in &seen {
            let removed = value.is_none();
            let llama = name.to_ascii_uppercase().starts_with("LLAMA_");
            assert!(!(llama && !removed), "{name} would still reach the child");
        }
        // Both spellings are removed; the performance knob and the PATH
        // are explicitly set and untouched.
        assert!(
            seen.iter().any(|(name, value)| name == "LLAMA_SERVER_SLOTS_DEBUG" && value.is_none())
        );
        assert!(
            seen.iter()
                .any(|(name, value)| name == "llama_arg_log_verbosity" && value.is_none()),
            "case-insensitive: a lowercase export is stripped too"
        );
        assert!(
            seen.iter()
                .any(|(name, value)| name == "GGML_CUDA_ENABLE_UNIFIED_MEMORY" && value.is_some())
        );
        assert!(seen.iter().any(|(name, value)| name == "PATH" && value.is_some()));
    }

    /// One variable no shell promised to be UTF-8 — a value here, and a
    /// whole NAME below — must neither panic the strip (which would crash
    /// every engine start) nor stop it stripping the knobs it exists for.
    /// The LLAMA_ prefix is ASCII, so it survives lossy comparison even
    /// with junk behind it; a non-UTF-8 name cannot be one of the fork's
    /// ASCII knobs and stays put.
    #[cfg(unix)]
    #[test]
    fn a_non_utf8_environment_neither_panics_nor_stops_the_strip() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let env = vec![
            // The knob, with a value that is not UTF-8: values are never
            // read, so this is stripped like any other.
            (
                OsString::from("LLAMA_SERVER_SLOTS_DEBUG"),
                OsString::from_vec(vec![0xff, 0xfe, 0x80]),
            ),
            // The knob's own NAME not valid UTF-8 after the prefix.
            (OsString::from_vec(b"LLAMA_\xff\x8f".to_vec()), OsString::from("1")),
            // A foreign, non-UTF-8 name: not ours, left alone.
            (OsString::from_vec(vec![0x87, 0xff]), OsString::from("1")),
            // A performance knob with junk: kept.
            (OsString::from("GGML_A"), OsString::from_vec(vec![0xff])),
        ];
        let mut cmd = std::process::Command::new("llama-server");
        cmd.envs(env.clone());
        child::strip_llama_env(&mut cmd, env.into_iter());
        let seen: Vec<_> = cmd
            .get_envs()
            .map(|(name, value)| (name.to_string_lossy().into_owned(), value))
            .collect();
        assert!(
            seen.iter()
                .any(|(name, value)| name == "LLAMA_SERVER_SLOTS_DEBUG" && value.is_none()),
            "the knob with the odd value is stripped: {seen:?}"
        );
        assert!(
            seen.iter()
                .any(|(name, value)| name.starts_with("LLAMA_") && name.contains('\u{fffd}') && value.is_none()),
            "the odd-named knob is stripped too (lossy prefix match): {seen:?}"
        );
        assert!(
            seen.iter().any(|(name, value)| name.contains('\u{fffd}') && name.starts_with('\u{fffd}') && value.is_some()),
            "the foreign non-UTF-8 name stays: {seen:?}"
        );
        assert!(
            seen.iter().any(|(name, value)| name == "GGML_A" && value.is_some()),
            "the performance knob with the odd value stays: {seen:?}"
        );
    }

    #[test]
    fn a_long_engine_stderr_line_is_clipped_to_three_hundred_characters() {
        let long = format!("load: {}", "x".repeat(STDERR_CLIP + 200));
        let kept = sanitized_tail(&[long]);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].chars().count(), STDERR_CLIP);
    }

    /// The argv line is written into a log whose redaction matches real
    /// separators: Debug's doubled backslashes would hide a Windows path
    /// from it, so the renderer must keep single separators and quote only
    /// the argument that needs it.
    #[test]
    fn the_argv_line_keeps_single_separators_and_quotes_spaced_arguments() {
        let argv = vec![
            "--model".to_string(),
            "C:\\Users\\marco\\models\\weights gguf.gguf".to_string(),
            "--threads".to_string(),
            "4".to_string(),
        ];
        let line = argv_line(&argv);
        assert!(
            line.contains("C:\\Users\\marco\\models\\weights gguf.gguf")
                || line.contains("\"C:\\Users\\marco\\models\\weights gguf.gguf\""),
            "{line}"
        );
        assert!(line.contains("\""), "the spaced argument is quoted: {line}");
        assert!(!line.contains("\\\\"), "no doubled separators: {line}");
        assert!(line.ends_with("--threads 4"), "{line}");
    }

    /// The line the start log prints. The key is in the child's environment
    /// and in no argument, so this renderer — the one thing that writes argv
    /// anywhere — cannot put it in the log.
    #[test]
    fn the_logged_argv_line_carries_no_key() {
        let config = config(unique_port());
        let line = argv_line(&config.argv);
        assert!(
            !line.contains(config.api_key.as_str()),
            "the engine key reached the argv log line: {line}"
        );
    }

    /// A port and a state file no other test in this binary holds.
    ///
    /// The state file is named after the port, so a port two tests share is a
    /// state file two tests share: one test's start writes the instance record
    /// the next one reads, and a test that leaves one behind turns the next
    /// into an `InstanceUnreadable`. The range is this crate's own integration
    /// range shifted up, so a unit run and an integration run cannot collide
    /// either.
    fn unique_port() -> u16 {
        static NEXT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(43000);
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    }

    fn config(port: u16) -> ServerConfig {
        ServerConfig {
            exe: PathBuf::from("/nonexistent/llama-server"),
            argv: vec![
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                port.to_string(),
            ],
            api_key: crate::engine_key::EngineKey::mint().unwrap(),
            state_file: std::env::temp_dir().join(format!("kalsa-supervisor-unit-{port}.state")),
            port,
            ready_timeout: Duration::from_secs(1),
            stop_grace: Duration::from_millis(50),
        }
    }

    #[test]
    fn an_argv_that_leaves_loopback_is_refused_before_any_process_exists() {
        let port = unique_port();
        let mut config = config(port);
        config.argv = vec![
            "--host".into(),
            "0.0.0.0".into(),
            "--port".into(),
            port.to_string(),
        ];
        let err = start_blocking(&config, Arc::new(AtomicU64::new(0)), Residency::new(), 1, &EngineId::new(), None)
            .err()
            .expect("the spawn had to fail on a nonexistent exe");
        match err {
            Failure::UnsafeBinding { detail } => assert!(detail.contains("0.0.0.0"), "{detail}"),
            other => panic!("a non-loopback argv reached the spawn path: {other:?}"),
        }
    }

    #[test]
    fn an_argv_on_another_port_is_refused_before_any_process_exists() {
        // The health handshake and the port guard read config.port; an argv
        // that binds elsewhere would start a server this one can never find.
        let port = unique_port();
        let mut config = config(port);
        config.argv = vec![
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            "9999".into(),
        ];
        let err = start_blocking(&config, Arc::new(AtomicU64::new(0)), Residency::new(), 1, &EngineId::new(), None)
            .err()
            .expect("the spawn had to fail on a nonexistent exe");
        match err {
            Failure::UnsafeBinding { detail } => assert!(detail.contains("9999"), "{detail}"),
            other => panic!("a port mismatch reached the spawn path: {other:?}"),
        }
    }

    #[test]
    fn a_well_bound_argv_passes_the_gate_and_fails_later_at_the_spawn() {
        // The exe does not exist: getting as far as ServerNotStarted proves
        // the binding gate let a correct argv through.
        let config = config(unique_port());
        let err = start_blocking(&config, Arc::new(AtomicU64::new(0)), Residency::new(), 1, &EngineId::new(), None)
            .err()
            .expect("the spawn had to fail on a nonexistent exe");
        match err {
            Failure::ServerNotStarted { .. } => {}
            other => panic!("unexpected outcome for a well-bound argv: {other:?}"),
        }
        let _ = std::fs::remove_file(&config.state_file);
    }

    #[cfg(unix)]
    #[test]
    fn a_live_orphan_of_an_earlier_run_is_stopped_and_never_adopted() {
        // An earlier run's engine is alive, answers /health, and is named by a
        // state file this run holds the lock of. Its key died with that run, so
        // it must be stopped, and the fresh start must not take it over.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind the stand-in health port");
        let port = listener
            .local_addr()
            .expect("the stand-in's own address")
            .port();
        let stop = Arc::new(AtomicBool::new(false));
        let stand_in = std::thread::spawn({
            let stop = Arc::clone(&stop);
            move || {
                let _ = listener.set_nonblocking(true);
                while !stop.load(Ordering::Relaxed) {
                    match listener.accept() {
                        // Every probe gets a 200, so the adoption rule would
                        // have taken this server over.
                        Ok((mut stream, _)) => {
                            let _ = std::io::Write::write_all(&mut stream, b"HTTP/1.0 200 OK\r\n\r\n");
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(10)),
                    }
                }
            }
        });
        // The shell backgrounds a `sleep` and exits, as a crashed run leaves
        // it: the sleep is reparented, so it is not this test's child to reap.
        let orphan = std::process::Command::new("/bin/sh")
            .args(["-c", "sleep 30 </dev/null >/dev/null 2>&1 & echo $!"])
            .output()
            .expect("start the earlier run's engine");
        let orphan_pid: u32 = String::from_utf8_lossy(&orphan.stdout)
            .trim()
            .parse()
            .expect("the shell prints the orphan's pid");
        // The walk may only signal a pid it has shown to be running our
        // engine, so this orphan must BE one: the config names the very
        // binary the stand-in process runs, and the state file records that
        // binding the way a real earlier run's would.
        let mut config = config(port);
        config.exe = {
            // The shell forks the orphan and only then execs `sleep`, so for
            // an instant its pid names the shell. Wait for the exec this
            // fixture's proof depends on — by condition, not by a guess.
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let exe = child::pid_executable(orphan_pid).expect("the orphan's own pid");
                if exe.file_name().is_some_and(|name| name == "sleep") {
                    break exe;
                }
                assert!(
                    Instant::now() < deadline,
                    "the stand-in never became /bin/sleep (still {exe:?})"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
        };
        std::fs::write(
            &config.state_file,
            format!(
                "kalsa-brain v1\npid={orphan_pid}\nport={port}\nbinding={}\n",
                config.binding()
            ),
        )
        .expect("write the earlier run's state file");
        let lock = std::fs::File::open(&config.state_file).expect("open the state file");
        crate::hold_state_lock(&lock).expect("hold the lock as an earlier run would");

        let started = start_blocking(&config, Arc::new(AtomicU64::new(0)), Residency::new(), 1, &EngineId::new(), None);
        let orphan_alive = child::pid_alive(orphan_pid);

        // Teardown before the assertions, so a failing one cannot leave the
        // listener accepting or the state file behind for the rest of the run.
        // `tests/common` has a `Drop` guard for its own fake health server; this
        // is the unit-test module, so it is done by hand.
        stop.store(true, Ordering::Relaxed);
        let _ = stand_in.join();
        drop(lock);
        let _ = std::fs::remove_file(&config.state_file);

        assert!(!orphan_alive, "the earlier run's engine was left running");
        let refused = started
            .err()
            .expect("the stand-in still holds the port, so the start must be refused, not adopted");
        assert!(matches!(refused, Failure::PortTaken), "{refused:?}");
    }

    /// The whole request head, however many reads it takes: a head cut in
    /// half reads as a request for no path at all, and the stand-in would
    /// answer the open route to a probe that asked a gated one.
    #[cfg(unix)]
    fn read_head(stream: &mut std::net::TcpStream) -> String {
        let mut head = Vec::new();
        let mut scratch = [0u8; 512];
        loop {
            match std::io::Read::read(stream, &mut scratch) {
                Ok(0) => break,
                Ok(read) => {
                    head.extend_from_slice(&scratch[..read]);
                    if String::from_utf8_lossy(&head).contains("\r\n\r\n") {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        String::from_utf8_lossy(&head).into_owned()
    }

    /// A port this test owns and nobody else can be handed: bound, then
    /// released. A port picked with `bind(:0)` and KEPT would be the only way
    /// to be sure of that, but the start under test must find the port free.
    #[cfg(unix)]
    fn free_port() -> u16 {
        let probe = TcpListener::bind("127.0.0.1:0").expect("pick a port");
        let port = probe.local_addr().expect("its own address").port();
        drop(probe);
        port
    }

    /// A stand-in for yesterday's engine: it answers the open route the way a
    /// loaded engine does, and refuses every key on the gated one the way a
    /// loaded engine does too. It takes over the port when `go` says so, which
    /// is how a start is caught between confirming the port free and asking
    /// whether anyone is on it — no sleep decides that.
    #[cfg(unix)]
    fn stale_engine(
        port: u16,
        go: Arc<(Mutex<bool>, Condvar)>,
    ) -> (Arc<AtomicBool>, std::thread::JoinHandle<()>) {
        let stop = Arc::new(AtomicBool::new(false));
        let serving = Arc::new(AtomicBool::new(false));
        let thread = {
            let stop = Arc::clone(&stop);
            let serving = Arc::clone(&serving);
            std::thread::spawn(move || {
                let (lock, go) = &*go;
                let mut ready = lock.lock().expect("the gate lock");
                while !*ready {
                    ready = go.wait(ready).expect("the gate condvar");
                }
                drop(ready);
                let Ok(listener) = TcpListener::bind(("127.0.0.1", port)) else {
                    // Somebody took the port between the two tests agreeing
                    // it was free; there is nothing to stand in for.
                    return;
                };
                serving.store(true, Ordering::SeqCst);
                let _ = listener.set_nonblocking(true);
                while !stop.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            let _ = stream.set_nonblocking(false);
                            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
                            let request = read_head(&mut stream);
                            // A request this stand-in did not read is not one
                            // it may answer: the open route would answer a
                            // probe that asked a gated one.
                            if request.is_empty() {
                                continue;
                            }
                            let answer: &[u8] = if request.contains("/props") {
                                b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"
                            } else {
                                b"HTTP/1.1 200 OK\r\nContent-Length: 15\r\n\r\n{\"status\":\"ok\"}"
                            };
                            let _ = std::io::Write::write_all(&mut stream, answer);
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(5)),
                    }
                }
            })
        };
        (stop, thread)
    }

    /// The bug that cost an evening of CPU-only decoding: a stale engine from
    /// an earlier run takes the port and answers the open route — `/health`,
    /// which the fork serves without a key — with a plain `200`, so a
    /// readiness handshake built on that route alone reports it as the engine
    /// this run just started.
    ///
    /// The stranger here takes the port AFTER this start has confirmed it
    /// free: that is the shape of the race, because a stranger present before
    /// the wait is caught by the wait. The child spawned below is still
    /// loading — it cannot bind, the stranger holds the port — and has served
    /// nothing, so the start must refuse the stranger rather than adopt it.
    #[cfg(unix)]
    #[test]
    fn an_engine_that_is_not_ours_is_never_adopted() {
        let port = free_port();
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let (stop, engine_thread) = stale_engine(port, Arc::clone(&gate));
        let mut config = config(port);
        config.exe = PathBuf::from("/bin/sh");
        // The flags come after the command string: `sh -c 'sleep 30'` runs it
        // with them as positional parameters, so the binding gate sees the
        // pair it requires and the process sleeps.
        config.argv = vec![
            "-c".into(),
            "sleep 30".into(),
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
        ];
        config.ready_timeout = Duration::from_secs(10);
        config.state_file =
            std::env::temp_dir().join(format!("kalsa-supervisor-unit-stranger-{port}.state"));

        let _ = std::fs::remove_file(&config.state_file);
        // The start runs on this thread, so the stranger is let in from
        // another one — as soon as the state file says the port check is
        // behind us, which is the moment it is written.
        let release = {
            let state_file = config.state_file.clone();
            let gate = Arc::clone(&gate);
            std::thread::spawn(move || {
                while !state_file.exists() {
                    std::thread::sleep(Duration::from_millis(5));
                }
                let (lock, condvar) = &*gate;
                *lock.lock().expect("the gate lock") = true;
                condvar.notify_all();
            })
        };
        let started = start_blocking(
            &config,
            Arc::new(AtomicU64::new(0)),
            Residency::new(),
            1,
            &EngineId::new(),
            None,
        );
        release.join().expect("the releasing thread");
        stop.store(true, Ordering::SeqCst);
        let _ = engine_thread.join();

        let _ = std::fs::remove_file(&config.state_file);
        match started.err().expect("a stranger on the port must not be adopted") {
            Failure::PortTaken => {}
            other => panic!("the stale engine was taken for ours: {other:?}"),
        }
    }

    /// The port is CONFIRMED free, not merely probed once: the walk that
    /// stopped an earlier run's engine asks it to go, and the socket is only
    /// released when the process is really gone. A start that launches into
    /// that gap binds nothing and then answers `/health` with the stranger's
    /// `200`, so the wait is the whole difference.
    ///
    /// Two halves, both decided by what the port does rather than by how long
    /// anything takes: a port somebody still holds is never taken as free, and
    /// the same port is accepted the moment it is released.
    #[test]
    fn a_held_port_is_never_taken_as_free_and_a_released_one_is() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a port a dying engine holds");
        let port = listener.local_addr().expect("its own address").port();
        let config = config(port);

        let held = await_port_free(&config, Duration::from_millis(300));
        assert!(
            matches!(held, Err(Failure::PortTaken)),
            "a port still held was taken as free: {held:?}"
        );

        // The engine lets go: the same port is accepted straight away, with no
        // state carried between the two calls.
        drop(listener);
        assert!(
            await_port_free(&config, Duration::from_secs(1)).is_ok(),
            "a port that came free was still refused"
        );
    }

    /// A port nobody frees is a start that fails loudly, before any child is
    /// made — never one that adopts the holder.
    #[test]
    fn a_port_that_stays_held_fails_the_start_instead_of_launching() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind a port a stranger holds");
        let port = listener.local_addr().expect("its own address").port();
        let config = config(port);
        let outcome = await_port_free(&config, Duration::from_millis(300));
        drop(listener);
        assert!(
            matches!(outcome, Err(Failure::PortTaken)),
            "a port still held after the wait launched anyway: {outcome:?}"
        );
    }

    /// A pid the state file names is a pid, not a handle: the walk may only
    /// signal it once the process is shown to be running OUR engine.
    #[cfg(unix)]
    #[test]
    fn a_pid_running_something_else_is_never_signalled() {
        let mut config = config(unique_port());
        config.exe = PathBuf::from("/bin/sh");
        let mut other = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("a process that is not our engine");
        let pid = other.id();

        let ours = ours_to_stop(pid, Some(&config.binding()), &config);
        // And what the recorded binding alone says: a state file that names
        // another binary is not describing an engine of ours.
        let foreign_binding = format!("/usr/bin/sleep{}", "\u{1f}--host");
        let recorded_foreign = ours_to_stop(pid, Some(&foreign_binding), &config);

        let _ = other.kill();
        let _ = other.wait();

        assert!(!ours, "a /bin/sleep was accepted as our kalsa-server");
        assert!(
            !recorded_foreign,
            "a state file naming another binary was accepted as ours"
        );
    }

    /// Our own engine, named by both proofs, may be stopped.
    #[cfg(unix)]
    #[test]
    fn our_own_engine_may_be_stopped() {
        let port = unique_port();
        let mut config = config(port);
        config.exe = PathBuf::from("/bin/sleep");
        config.argv = vec!["30".into(), "--host".into(), "127.0.0.1".into(), "--port".into(), port.to_string()];
        let mut engine = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("stand in for our engine");

        let ours = ours_to_stop(engine.id(), Some(&config.binding()), &config);

        let _ = engine.kill();
        let _ = engine.wait();
        assert!(ours, "our own engine was refused by the walk's own proof");
    }

    #[cfg(unix)]
    #[test]
    fn a_start_forgets_what_the_previous_server_announced() {
        // The residency cell describes the server that owns it. Server A
        // announced a release; the owner stopped it and asked for a start. The
        // new server cannot be reported running until its health handshake
        // answers, but until its own drain thread has looked, the cell would
        // still hold A's answer — and the page, polling every second, would say
        // "On, asleep" about a server that is loading its model. The reset is
        // synchronous, on the path that begins the start.
        let releases = Arc::new(AtomicU64::new(0));
        let residency = Residency::new();
        let mut announcing = ChildHandle::spawn(
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                "printf '%s\\n' 'I srv  handle_sleep: server is entering sleeping state' >&2; sleep 30"
                    .into(),
            ],
            None,
            Arc::clone(&releases),
            residency.clone(),
            None,
            &crate::engine_key::EngineKey::mint().unwrap(),
        )
        .expect("spawn the server that released its model");
        let deadline = Instant::now() + Duration::from_secs(5);
        while residency.asleep() != Some(true) {
            assert!(
                Instant::now() < deadline,
                "the announcing server never reached the cell"
            );
            std::thread::sleep(Duration::from_millis(5));
        }

        // The supervisor's own worker over that same cell, with nothing running:
        // A is the server before this start, and this start is the new one. The
        // exe does not exist, so the new drain never looks — which is the window
        // under test, held open for the length of the assertion below.
        let (commands, inbox) = mpsc::channel();
        let state = Arc::new(Mutex::new(ServerState::Stopped));
        let worker = std::thread::spawn({
            let state = Arc::clone(&state);
            let releases = Arc::clone(&releases);
            let residency = residency.clone();
            move || work(inbox, state, releases, residency, Arc::new(EngineId::new()), presence::probe, Arc::new(Mutex::new(None)))
        });
        let config = config(unique_port());
        let state_file = config.state_file.clone();
        let _ = std::fs::remove_file(&state_file);
        let (outcome, _verdict) = mpsc::channel();
        let (settled, _settle) = mpsc::channel();
        let _ = commands.send(Command::Start(Box::new(config), outcome, settled));

        let deadline = Instant::now() + Duration::from_secs(5);
        while residency.asleep().is_some() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        let forgot = residency.asleep();

        // Teardown before the assertion, so failing leaves nothing behind: the
        // worker stops, the announcing child is reaped, and the state file the
        // failed start wrote is removed — the same "assertions included" shape
        // `ScratchDir` gives the tests next door in `main.rs`.
        let _ = commands.send(Command::Shutdown { prior: None });
        let _ = worker.join();
        let _ = announcing.terminate(Duration::from_millis(50));
        let _ = std::fs::remove_file(&state_file);

        assert_eq!(
            forgot, None,
            "a new start kept the released model of the server before it"
        );
    }

    #[test]
    fn stopping_an_adopted_server_spares_a_recycled_pid() {
        // The orphan died and its pid was recycled onto this innocent sleeper:
        // the state file says Live but nobody holds the lock, so the pid must
        // not be signalled.
        let port = unique_port();
        let stand_in_path = std::env::temp_dir().join(format!("kalsa-recycle-{port}.bin"));
        // A live foreign process the stop must not signal. `ping -n` is the
        // Windows sleep: it stays alive across the whole test either way.
        #[cfg(unix)]
        let mut stand_in = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn the stand-in for a recycled pid");
        #[cfg(windows)]
        let mut stand_in = std::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .spawn()
            .expect("spawn the stand-in for a recycled pid");
        let stand_in_pid = stand_in.id();
        std::fs::write(
            &config(port).state_file,
            format!("kalsa-brain v1\npid={stand_in_pid}\nport={port}\n"),
        )
        .expect("write a state file nobody holds");
        let _ = std::fs::remove_file(&stand_in_path);

        let mut owned = Some(Owned {
            child: None,
            adopted_pid: Some(stand_in_pid),
            instance: None,
            config: config(port),
        });
        let state = Arc::new(Mutex::new(ServerState::Running {
            pid: stand_in_pid,
            port,
        }));
        stop(&mut owned, None, &state, presence::probe, None, &EngineId::new());
        assert!(
            stand_in.try_wait().expect("poll the stand-in").is_none(),
            "a recycled pid was signalled: we killed somebody else's program"
        );
        let _ = stand_in.kill();
        let _ = stand_in.wait();
        let _ = std::fs::remove_file(&config(port).state_file);
    }

    #[test]
    fn a_survivor_is_a_failed_stop_with_its_measures_not_a_stopped_one() {
        // §9: a stop must not declare success while the engine is alive.
        // The adopted pid is still there — the state file stopped vouching
        // for it, so the walk refused to signal a pid that may now name
        // somebody else's program — AND the port answers. Both halves fail
        // the proof: the state must say the stop is unconfirmed, carrying
        // the measures (pid, port, what was tried, that the port answered),
        // instead of `Stopped`.
        let port = unique_port();
        let state_file = config(port).state_file;
        let _ = std::fs::remove_file(&state_file);
        // A live foreign process again; `ping -n` stands in for sleep on
        // Windows the same way.
        #[cfg(unix)]
        let mut stand_in = std::process::Command::new("/bin/sleep")
            .arg("300")
            .spawn()
            .expect("spawn the survivor");
        #[cfg(windows)]
        let mut stand_in = std::process::Command::new("ping")
            .args(["-n", "300", "127.0.0.1"])
            .spawn()
            .expect("spawn the survivor");
        let pid = stand_in.id();
        // No lock on it: `inspect` reads this as Stale — the file no longer
        // vouches for the pid, which is exactly why nothing may be signalled.
        std::fs::write(
            &state_file,
            format!("kalsa-brain v1\npid={pid}\nport={port}\n"),
        )
        .expect("write a state file nobody holds");

        // Something answering on the port — the second witness — as a
        // SCRIPTED probe: the policy (a survivor is never `Stopped`, port or
        // no port) must not be proven with a socket a neighbour could
        // rebind, and the measures still carry what the script answered.
        let answering: presence::Probe = |_, _| presence::Presence::There {
            evidence: presence::Evidence::Answered {
                status: "200".into(),
            },
        };

        let mut owned = Some(Owned {
            child: None,
            adopted_pid: Some(pid),
            instance: None,
            config: config(port),
        });
        let state = Arc::new(Mutex::new(ServerState::Running { pid, port }));
        stop(&mut owned, None, &state, answering, None, &EngineId::new());

        let ended = state.lock().expect("the state lock").clone();
        let measures = match &ended {
            ServerState::Failed {
                reason: Failure::StopUnconfirmed { measures },
            } => measures.clone(),
            other => panic!(
                "a live engine was reported as {other:?}: the stop declared a success it could not prove"
            ),
        };
        assert!(measures.contains(&pid.to_string()), "the measures miss the pid: {measures}");
        assert!(measures.contains(&port.to_string()), "the measures miss the port: {measures}");
        assert!(measures.contains("Answered"), "the measures do not say the port answered: {measures}");
        assert!(
            measures.contains("no longer vouches"),
            "the measures do not say what was tried: {measures}"
        );
        assert!(
            stand_in.try_wait().expect("poll the stand-in").is_none(),
            "the survivor was signalled"
        );

        let _ = stand_in.kill();
        let _ = stand_in.wait();
        let _ = std::fs::remove_file(&state_file);
    }

    #[test]
    fn a_blind_stop_with_a_silent_port_is_stopped_and_still_leaves_the_record() {
        // §9, literally: an engine adopted blind gets `Stopped` only after
        // the probe on the port FAILS — and the suspicion record is written
        // anyway, because no pid was ever proven (the record is what the
        // port alone cannot carry). SCRIPTED probe, no socket: a policy test
        // that demanded a refusal from a listener it had just dropped could
        // read a ghost `There{Silent}` under concurrent socket activity (the
        // flake this seam retires: three live reproductions, no listener
        // visible at capture time). The answering twin is the next test.
        let port = unique_port();
        let state_file = config(port).state_file;
        let _ = std::fs::remove_file(&state_file);
        let suspect_path = format!("{}.orphan", state_file.display());
        let _ = std::fs::remove_file(&suspect_path);
        let silent: presence::Probe = |_, _| presence::Presence::Gone;

        let mut owned = Some(Owned {
            child: None,
            adopted_pid: None,
            instance: None,
            config: config(port),
        });
        let state = Arc::new(Mutex::new(ServerState::Running { pid: 0, port }));
        stop(&mut owned, None, &state, silent, None, &EngineId::new());

        assert_eq!(
            state.lock().expect("the state lock").clone(),
            ServerState::Stopped,
            "a refusing port did not settle a blind engine's stop"
        );
        let recorded =
            std::fs::read_to_string(&suspect_path).expect("the suspicion record beside the state");
        assert!(
            recorded.contains("adopted blind") && recorded.contains("Gone"),
            "the record carries no measures: {recorded}"
        );
        let _ = std::fs::remove_file(&suspect_path);
    }

    #[test]
    fn a_blind_stop_with_an_answering_port_is_a_failed_stop_and_leaves_the_record() {
        // The answering twin of the silent case above: the port answers, so the
        // stop is unconfirmed, carries its measures, and leaves the record for
        // the next start. SCRIPTED probe, no socket.
        let port = unique_port();
        let state_file = config(port).state_file;
        let _ = std::fs::remove_file(&state_file);
        let suspect_path = format!("{}.orphan", state_file.display());
        let _ = std::fs::remove_file(&suspect_path);
        let answering: presence::Probe = |_, _| presence::Presence::There {
            evidence: presence::Evidence::Answered {
                status: "200".into(),
            },
        };

        let mut owned = Some(Owned {
            child: None,
            adopted_pid: None,
            instance: None,
            config: config(port),
        });
        let state = Arc::new(Mutex::new(ServerState::Running { pid: 0, port }));
        stop(&mut owned, None, &state, answering, None, &EngineId::new());

        match state.lock().expect("the state lock").clone() {
            ServerState::Failed {
                reason: Failure::StopUnconfirmed { measures },
            } => assert!(
                measures.contains("Answered"),
                "the measures miss the port's answer: {measures}"
            ),
            other => panic!("a blind engine with an answering port reported as {other:?}"),
        }
        let recorded =
            std::fs::read_to_string(&suspect_path).expect("the suspicion record beside the state");
        assert!(
            recorded.contains("adopted blind") && recorded.contains("Answered"),
            "the record carries no measures: {recorded}"
        );
        let _ = std::fs::remove_file(&suspect_path);
    }

    // The premise — a just-reaped pid names nothing — is the unix pid
    // counter's. On Windows the freed pid was re-occupied within
    // milliseconds and the walk met a protected owner (OpenProcess,
    // os error 5), twice in isolation and once in the full suite; there
    // is no portable "definitely dead pid" to plant there, so this row
    // is proven on unix. The GONE-child half of the same §9 matrix runs
    // on Windows in `a_reaped_child_with_a_still_answering_port…`.
    #[cfg(unix)]
    #[test]
    fn a_dead_pid_whose_port_still_answers_is_a_failed_stop_with_its_measures() {
        // §9's "pid AND port" from the other side, through `stop()`: the
        // PROCESS half is positive (the pid the state file vouches for does
        // not exist — `terminate_pid` answers Gone{Already} without ever
        // signalling), and the PORT half is not (something answers). Both
        // halves must say gone for `Stopped`: here neither alone is enough,
        // so the drain ends in the failed-to-stop carrying pid, port, what
        // the walk found and what the port said — plus the record. Until
        // now this row existed only in `settle`'s matrix.
        //
        // SCRIPTED probe, no socket: the policy must not be proven with a
        // listener. The decoy pid is spawned and REAPED first, so it names
        // nothing (pids are handed out of a forward-moving counter, so a
        // just-reaped one is not the next one given away).
        let port = unique_port();
        let state_file = config(port).state_file;
        let _ = std::fs::remove_file(&state_file);
        let suspect_path = format!("{}.orphan", state_file.display());
        let _ = std::fs::remove_file(&suspect_path);
        // A pid to consume and reap — whatever exits immediately and
        // cleanly will do; `cmd /c exit 0` is Windows' `sh -c "exit 0"`.
        #[cfg(unix)]
        let mut decoy = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg("exit 0")
            .spawn()
            .expect("spawn the decoy");
        #[cfg(windows)]
        let mut decoy = std::process::Command::new("cmd")
            .args(["/c", "exit", "0"])
            .spawn()
            .expect("spawn the decoy");
        let pid = decoy.id();
        let _ = decoy.wait(); // reaped: the pid names no process any more
        std::fs::write(
            &state_file,
            format!("kalsa-brain v1\npid={pid}\nport={port}\n"),
        )
        .expect("write the state file");
        let lock = std::fs::File::open(&state_file).expect("open the state file");
        // The product's own lock: std's whole-file try_lock is mandatory on
        // Windows and would make this very record unreadable (os 33) —
        // `hold_state_lock` takes the byte the readers read around, which
        // is what the integration tests plant with too.
        crate::hold_state_lock(&lock).expect("hold the lock as the heir would");

        let answering: presence::Probe = |_, _| presence::Presence::There {
            evidence: presence::Evidence::Answered {
                status: "200".into(),
            },
        };
        let mut owned = Some(Owned {
            child: None,
            adopted_pid: Some(pid),
            instance: None,
            config: config(port),
        });
        let state = Arc::new(Mutex::new(ServerState::Running { pid, port }));
        stop(&mut owned, None, &state, answering, None, &EngineId::new());

        match state.lock().expect("the state lock").clone() {
            ServerState::Failed {
                reason: Failure::StopUnconfirmed { measures },
            } => {
                assert!(
                    measures.contains(&pid.to_string()),
                    "the measures miss the pid: {measures}"
                );
                assert!(
                    measures.contains("Already"),
                    "the measures miss what the walk found: {measures}"
                );
                assert!(
                    measures.contains("Answered"),
                    "the measures miss what the port said: {measures}"
                );
            }
            other => panic!(
                "a dead pid with a held port reported as {other:?}: pid AND port must BOTH say gone"
            ),
        }
        assert!(
            std::path::Path::new(&suspect_path).exists(),
            "a half-proved stop left no record for the next start"
        );
        drop(lock);
        let _ = std::fs::remove_file(&state_file);
        let _ = std::fs::remove_file(&suspect_path);
    }

    #[test]
    fn a_reaped_child_with_a_still_answering_port_stops_and_records_the_doubt() {
        // The other half of the same row, through `stop()`: the kernel
        // reaped OUR child, so the port does NOT veto `Stopped` — but it
        // still owes the suspicion record, because something answered what
        // the reap could not explain. Integration covers this with a real
        // stand-in listener (`suspect_record.rs`); this version drives the
        // policy with a script, which is what makes it churn-proof.
        let port = unique_port();
        let state_file = config(port).state_file;
        let suspect_path = format!("{}.orphan", state_file.display());
        let _ = std::fs::remove_file(&state_file);
        let _ = std::fs::remove_file(&suspect_path);
        let residency = Residency::new();
        // Our child, already on its way out — `cmd /c exit 0` is Windows'
        // own `sh -c "exit 0"`.
        #[cfg(unix)]
        let child = ChildHandle::spawn(
            Path::new("/bin/sh"),
            &["-c".into(), "exit 0".into()],
            None,
            Arc::new(AtomicU64::new(0)),
            residency,
            None,
            &crate::engine_key::EngineKey::mint().unwrap(),
        )
        .expect("spawn the child that is already on its way out");
        #[cfg(windows)]
        let child = ChildHandle::spawn(
            Path::new("cmd"),
            &["/c".into(), "exit".into(), "0".into()],
            None,
            Arc::new(AtomicU64::new(0)),
            residency,
            None,
            &crate::engine_key::EngineKey::mint().unwrap(),
        )
        .expect("spawn the child that is already on its way out");
        let answering: presence::Probe = |_, _| presence::Presence::There {
            evidence: presence::Evidence::Answered {
                status: "200".into(),
            },
        };
        let mut owned = Some(Owned {
            child: Some(child),
            adopted_pid: None,
            instance: None,
            config: config(port),
        });
        let state = Arc::new(Mutex::new(ServerState::Running { pid: 1, port }));
        stop(&mut owned, None, &state, answering, None, &EngineId::new());

        assert_eq!(
            state.lock().expect("the state lock").clone(),
            ServerState::Stopped,
            "the port vetoed a child the kernel reaped"
        );
        let recorded =
            std::fs::read_to_string(&suspect_path).expect("the suspicion record beside the state");
        assert!(
            recorded.contains("Reaped") && recorded.contains("Answered"),
            "the record does not carry the doubt: {recorded}"
        );
        let _ = std::fs::remove_file(&suspect_path);
    }

    /// §18's second stop: the first took what was owned, whatever it ended
    /// in, so a second stop with nothing owned must not write `Stopped`
    /// with nothing checked — the port still answers (scripted), and the
    /// state stays `StopUnconfirmed` with fresh measures.
    #[test]
    fn a_second_stop_with_the_port_still_answering_stays_unconfirmed() {
        let port = unique_port();
        let config = config(port);
        let answering: presence::Probe = |_, _| presence::Presence::There {
            evidence: presence::Evidence::Answered {
                status: "200".into(),
            },
        };

        // First stop: adopted blind — no pid, so only the port can speak,
        // and it speaks "there". `owned` is taken and never given back.
        let mut owned = Some(Owned {
            child: None,
            adopted_pid: None,
            instance: None,
            config: config.clone(),
        });
        let state = Arc::new(Mutex::new(ServerState::Running { pid: 0, port }));
        stop(&mut owned, Some(&config), &state, answering, None, &EngineId::new());
        assert!(owned.is_none(), "the first stop took what was owned");
        let first = state.lock().expect("the state lock").clone();
        assert!(
            matches!(
                first,
                ServerState::Failed {
                    reason: Failure::StopUnconfirmed { .. }
                }
            ),
            "the first stop may not prove absence while the port answers: {first:?}"
        );

        // Second stop, nothing owned: the port is asked (§18) and answers
        // again — `Stopped` must not appear.
        stop(&mut owned, Some(&config), &state, answering, None, &EngineId::new());
        let second = state.lock().expect("the state lock").clone();
        assert!(
            matches!(
                second,
                ServerState::Failed {
                    reason: Failure::StopUnconfirmed { .. }
                }
            ),
            "a second stop declared Stopped with nothing checked: {second:?}"
        );
    }

    /// The other half of §18: with the port refusing, the second stop
    /// proves absence the way the blind rule does and may say `Stopped`.
    #[test]
    fn a_second_stop_with_the_port_refusing_proves_gone() {
        let port = unique_port();
        let config = config(port);
        let answering: presence::Probe = |_, _| presence::Presence::There {
            evidence: presence::Evidence::Answered {
                status: "200".into(),
            },
        };
        let mut owned = Some(Owned {
            child: None,
            adopted_pid: None,
            instance: None,
            config: config.clone(),
        });
        let state = Arc::new(Mutex::new(ServerState::Running { pid: 0, port }));
        stop(&mut owned, Some(&config), &state, answering, None, &EngineId::new());
        assert!(
            matches!(
                state.lock().expect("the state lock").clone(),
                ServerState::Failed {
                    reason: Failure::StopUnconfirmed { .. }
                }
            ),
            "the setup must be an unconfirmed stop"
        );

        let silent: presence::Probe = |_, _| presence::Presence::Gone;
        stop(&mut owned, Some(&config), &state, silent, None, &EngineId::new());
        assert_eq!(
            state.lock().expect("the state lock").clone(),
            ServerState::Stopped,
            "a refusing port proves absence at a second stop"
        );
    }

    /// The API path's fixture: the real worker on the real command channel
    /// behind a real `Supervisor`, with a run planted and the state
    /// `Running` — the §18 precondition reached without a serving engine
    /// (a real `Start` spawns and health-checks one). The planted run is
    /// adopted-pid so the tick's watch is `pid_alive` and cannot race the
    /// stop; the probe is injected because the public API has no parameter
    /// for it and a policy test must not depend on a socket.
    fn api_supervisor(port: u16, pid: u32, probe: presence::Probe) -> Supervisor {
        planted_supervisor(
            Owned {
                child: None,
                adopted_pid: Some(pid),
                instance: None,
                config: config(port),
            },
            probe,
        )
    }

    /// A real worker on the real command channel, with `run` planted and the
    /// state set as the plant's start would leave it.
    fn planted_supervisor(run: Owned, probe: presence::Probe) -> Supervisor {
        let pid = run
            .child
            .as_ref()
            .map(|child| child.pid())
            .or(run.adopted_pid)
            .unwrap_or(0);
        let port = run.config.port;
        let (commands, inbox) = mpsc::channel();
        let state = Arc::new(Mutex::new(ServerState::Stopped));
        let releases = Arc::new(AtomicU64::new(0));
        let engine = Arc::new(EngineId::new());
        let residency = Residency::new();
        let worker = std::thread::spawn({
            let state = Arc::clone(&state);
            let releases = Arc::clone(&releases);
            let residency = residency.clone();
            let engine = Arc::clone(&engine);
            move || work(inbox, state, releases, residency, engine, probe, Arc::new(Mutex::new(None)))
        });
        let _ = commands.send(Command::Plant(Box::new(run)));
        set(&state, ServerState::Running { pid, port });
        Supervisor {
            commands,
            state,
            worker: Mutex::new(Some(worker)),
            engine,
            releases,
            residency,
            stderr_dir: Arc::new(Mutex::new(None)),
        }
    }

    /// An unconfirmed stop over an ADOPTED engine retains nothing: the pid's
    /// only voucher is a state file a previous run wrote, stale by exit
    /// time — a recycled pid may name a stranger, and the exit's last-resort
    /// kill must never signal one, unconfirmed or not.
    #[cfg(unix)]
    #[test]
    fn an_unconfirmed_stop_retains_no_adopted_pid() {
        let port = unique_port();
        let mut stand_in = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn the stand-in");
        let answering: presence::Probe = |_, _| presence::Presence::There {
            evidence: presence::Evidence::Answered {
                status: "200".into(),
            },
        };
        let supervisor = api_supervisor(port, stand_in.id(), answering);
        // The plant is a command the worker takes before any later one; an
        // adopted pid is never held, from the plant on.
        assert_eq!(
            supervisor.watch().engine_pid(),
            None,
            "an adopted pid is never held for the exit's kill"
        );
        supervisor.shutdown();
        let end = supervisor.state();
        assert!(
            matches!(
                end,
                ServerState::Failed {
                    reason: Failure::StopUnconfirmed { .. }
                }
            ),
            "an unvouched pid and an answering port cannot prove absence: {end:?}"
        );
        assert_eq!(
            supervisor.watch().engine_pid(),
            None,
            "the unconfirmed stop leaves the adopted pid unheld: it may no \
             longer name the engine"
        );
        assert_eq!(
            supervisor.watch().finish_engine(Duration::from_millis(50)),
            None,
            "the exit's kill has nothing safe to signal"
        );
        let _ = stand_in.kill();
        let _ = stand_in.wait();
    }

    /// The exit's kill reaches the supervisor's watch: the identity a live
    /// planted engine holds is the one the exit handler and the watchdog
    /// both load. The kill's own power is proven in `engine_id`'s tests —
    /// here the subject is the path from the watch.
    #[cfg(unix)]
    #[test]
    fn the_exits_kill_takes_the_identity_the_watch_holds() {
        let releases = Arc::new(AtomicU64::new(0));
        let child = ChildHandle::spawn(
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 30".into()],
            None,
            Arc::clone(&releases),
            Residency::new(),
            None,
            &crate::engine_key::EngineKey::mint().unwrap(),
        )
        .expect("spawn the stand-in engine");
        let pid = child.pid();
        let gone: presence::Probe = |_, _| presence::Presence::Gone;
        let supervisor = planted_supervisor(
            Owned {
                child: Some(child),
                adopted_pid: None,
                instance: None,
                config: config(unique_port()),
            },
            gone,
        );
        let deadline = Instant::now() + Duration::from_secs(2);
        while supervisor.watch().engine_pid() != Some(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(supervisor.watch().engine_pid(), Some(pid), "the planted child");
        assert!(
            supervisor
                .watch()
                .finish_engine(Duration::from_millis(100))
                .is_some(),
            "a live engine was held, so a kill was owed"
        );
        // The walk afterwards must still come back clean: whatever the
        // by-pid kill left behind, the child's own handle reaps it.
        supervisor.shutdown();
        assert_eq!(supervisor.state(), ServerState::Stopped, "nothing is left");
    }

    /// A starting engine is already killable: the identity is published at
    /// the spawn, before the readiness wait that can run a whole
    /// `ready_timeout` — an exit in that window must not find it empty.
    /// The stand-in never serves /health, so the start can only fail; where
    /// that failure reaped the child, the identity is spent again.
    #[cfg(unix)]
    #[test]
    fn a_starting_engine_is_publishable_before_it_is_ready() {
        let free = TcpListener::bind("127.0.0.1:0").expect("borrow a free port");
        let port = free.local_addr().unwrap().port();
        drop(free);
        let config = ServerConfig {
            exe: PathBuf::from("/bin/sh"),
            argv: vec![
                "-c".into(),
                "sleep 30".into(),
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                port.to_string(),
            ],
            api_key: crate::engine_key::EngineKey::mint().unwrap(),
            state_file: std::env::temp_dir().join("kalsa-supervisor-publish-at-spawn.state"),
            port,
            ready_timeout: Duration::from_secs(1),
            stop_grace: Duration::from_millis(50),
        };
        let engine = Arc::new(EngineId::new());
        let shared = Arc::clone(&engine);
        let state_file = config.state_file.clone();
        let (done, finished) = mpsc::channel();
        let walker = std::thread::spawn(move || {
            let _ = done.send(start_blocking(
                &config,
                Arc::new(AtomicU64::new(0)),
                Residency::new(),
                1,
                &shared,
                None,
            ));
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut seen = None;
        while seen.is_none() && Instant::now() < deadline {
            if finished.try_recv().is_ok() {
                break; // the start failed before any pid was observed
            }
            seen = engine.pid();
            if seen.is_none() {
                std::thread::sleep(Duration::from_millis(1));
            }
        }
        assert!(
            seen.is_some_and(|pid| pid != 0),
            "the engine was never killable while it was starting"
        );
        let outcome = finished
            .recv_timeout(Duration::from_secs(5))
            .expect("the start never settled");
        assert!(
            matches!(outcome, Err(Failure::NotReady { .. })),
            "a stand-in that serves nothing never becomes ready"
        );
        let _ = walker.join();
        assert_eq!(
            engine.pid(),
            None,
            "the failed start reaped the child, so the identity is spent"
        );
        let _ = std::fs::remove_file(&state_file);
    }

    /// A stop that PROVED the engine gone clears the pid: at its deadline the
    /// watchdog must never signal a pid the walk already reaped, because a
    /// reaped pid can be somebody else's process by then.
    #[cfg(unix)]
    #[test]
    fn a_stop_that_proved_the_engine_gone_clears_the_pid() {
        let releases = Arc::new(AtomicU64::new(0));
        let residency = Residency::new();
        let child = ChildHandle::spawn(
            Path::new("/bin/sh"),
            &["-c".into(), "sleep 30".into()],
            None,
            Arc::clone(&releases),
            residency.clone(),
            None,
            &crate::engine_key::EngineKey::mint().unwrap(),
        )
        .expect("spawn the stand-in engine");
        let pid = child.pid();
        let gone: presence::Probe = |_, _| presence::Presence::Gone;
        let supervisor = planted_supervisor(
            Owned {
                child: Some(child),
                adopted_pid: None,
                instance: None,
                config: config(unique_port()),
            },
            gone,
        );
        let deadline = Instant::now() + Duration::from_secs(2);
        while supervisor.watch().engine_pid() != Some(pid) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(supervisor.watch().engine_pid(), Some(pid), "the planted child's pid");
        supervisor.shutdown();
        assert_eq!(
            supervisor.state(),
            ServerState::Stopped,
            "a reaped child and a refusing port prove absence"
        );
        assert_eq!(
            supervisor.watch().engine_pid(),
            None,
            "a proven stop leaves nothing to signal"
        );
    }

    /// The script for the refusing-second-stop API test: answers while the
    /// first stop needs `StopUnconfirmed`, refuses once the test asks
    /// again. One static, one function, one test — the module shares the
    /// names, not the state.
    static SECOND_STOP_ASK: AtomicU8 = AtomicU8::new(0);
    fn answering_then_gone(_: std::net::SocketAddr, _: Duration) -> presence::Presence {
        if SECOND_STOP_ASK.load(Ordering::Relaxed) == 0 {
            presence::Presence::There {
                evidence: presence::Evidence::Answered {
                    status: "200".into(),
                },
            }
        } else {
            presence::Presence::Gone
        }
    }

    /// `Supervisor::stop` returns at once; the walk it queued runs on the
    /// worker. Read the state it settles on, bounded — `Stopping` past the
    /// bound is the wedge the drain module already reports, and the
    /// assertions below say so with it in the message.
    fn drain_end(supervisor: &Supervisor) -> ServerState {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let state = supervisor.state();
            if !matches!(state, ServerState::Stopping) || Instant::now() >= deadline {
                return state;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    /// The carry, end to end: `Supervisor::stop` declares the drain and
    /// sends the declaration, so the worker's §18 arm knows what the first
    /// stop left — the state already reads `Stopping` when it looks.
    /// Two stops through the real API; the port answers both times.
    #[test]
    fn a_second_stop_through_the_api_keeps_an_unconfirmed_state_while_the_port_answers() {
        let port = unique_port();
        // A live foreign process the walk must not signal (no state file
        // vouches for it). `ping -n` is the Windows sleep.
        #[cfg(unix)]
        let mut stand_in = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn the stand-in");
        #[cfg(windows)]
        let mut stand_in = std::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .spawn()
            .expect("spawn the stand-in");
        let answering: presence::Probe = |_, _| presence::Presence::There {
            evidence: presence::Evidence::Answered {
                status: "200".into(),
            },
        };
        let supervisor = api_supervisor(port, stand_in.id(), answering);

        // First stop: the unvouched pid is not signalled and the port
        // answers, so the drain ends StopUnconfirmed — reached through the
        // owned walk, the way every real first stop reaches it.
        supervisor.stop();
        let first = drain_end(&supervisor);
        assert!(
            matches!(
                first,
                ServerState::Failed {
                    reason: Failure::StopUnconfirmed { .. }
                }
            ),
            "the first stop through the API did not reach StopUnconfirmed: {first:?}"
        );

        // Second stop, nothing owned: with the carried declaration the
        // worker asks the port and keeps the doubt — never `Stopped`.
        supervisor.stop();
        let second = drain_end(&supervisor);
        assert!(
            !matches!(second, ServerState::Stopped),
            "a second stop claimed Stopped with nothing checked: {second:?}"
        );
        assert!(
            matches!(
                &second,
                ServerState::Failed {
                    reason: Failure::StopUnconfirmed { measures },
                } if measures.contains("a second stop")
            ),
            "the second stop's own probe did not run: {second:?}"
        );

        let _ = stand_in.kill();
        let _ = stand_in.wait();
    }

    /// The same API path when the port turns refusing at the second stop:
    /// absence is then proved the way the blind rule proves it, and
    /// `Stopped` is honest.
    #[test]
    fn a_second_stop_through_the_api_proves_gone_when_the_port_refuses() {
        let port = unique_port();
        #[cfg(unix)]
        let mut stand_in = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn the stand-in");
        #[cfg(windows)]
        let mut stand_in = std::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .spawn()
            .expect("spawn the stand-in");
        SECOND_STOP_ASK.store(0, Ordering::Relaxed);
        let supervisor = api_supervisor(port, stand_in.id(), answering_then_gone);

        supervisor.stop();
        let first = drain_end(&supervisor);
        assert!(
            matches!(
                first,
                ServerState::Failed {
                    reason: Failure::StopUnconfirmed { .. }
                }
            ),
            "the first stop must reach StopUnconfirmed before the second is asked: {first:?}"
        );

        SECOND_STOP_ASK.store(1, Ordering::Relaxed);
        supervisor.stop();
        assert_eq!(
            drain_end(&supervisor),
            ServerState::Stopped,
            "a refusing port proves absence at a second stop"
        );

        let _ = stand_in.kill();
        let _ = stand_in.wait();
    }

    #[test]
    fn a_drain_whose_worker_died_reads_as_a_failed_stop_not_as_eternally_stopping() {
        // The wedge `drain` declared, closed here as a READ: no write, no
        // guard widening, no invented port. The worker that owned the drain
        // is finished — it exited between `declare` and `Stopped` — so
        // nothing on the writing path can ever finish that drain, and the
        // state() answer must become the failed-to-stop with the measures
        // this side actually has.
        let (commands, inbox) = mpsc::channel();
        drop(inbox); // the dead worker's channel: nobody is listening
        let worker = std::thread::spawn(|| {});
        while !worker.is_finished() {
            std::thread::sleep(Duration::from_millis(1));
        }
        let supervisor = Supervisor {
            commands,
            state: Arc::new(Mutex::new(ServerState::Stopping)),
            worker: Mutex::new(Some(worker)),
            engine: Arc::new(EngineId::new()),
            releases: Arc::new(AtomicU64::new(0)),
            residency: Residency::new(),
            stderr_dir: Arc::new(Mutex::new(None)),
        };
        match supervisor.state() {
            ServerState::Failed {
                reason: Failure::StopUnconfirmed { measures },
            } => {
                assert!(
                    measures.contains("exited without writing its end"),
                    "the measures miss the reason: {measures}"
                );
                assert!(
                    !measures.contains("127.0.0.1"),
                    "a port nobody could ask was invented: {measures}"
                );
            }
            other => panic!("a dead worker's drain read as {other:?}: Stopping stands forever"),
        }

        // A worker still ALIVE: the declaration stands — nothing is reported
        // over a drain somebody may still perform (a `shutdown` mid-join
        // takes the handle, which reads as not-finished for the same reason).
        let living = std::thread::spawn(|| std::thread::park());
        let live = Supervisor {
            commands: mpsc::channel().0,
            state: Arc::new(Mutex::new(ServerState::Stopping)),
            worker: Mutex::new(Some(living)),
            engine: Arc::new(EngineId::new()),
            releases: Arc::new(AtomicU64::new(0)),
            residency: Residency::new(),
            stderr_dir: Arc::new(Mutex::new(None)),
        };
        assert_eq!(
            live.state(),
            ServerState::Stopping,
            "a live drain was reported as a failed stop"
        );
    }
}
