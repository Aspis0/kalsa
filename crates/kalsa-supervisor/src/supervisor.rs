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
use crate::health;
use crate::instance::{Existing, InstanceFile};
use crate::presence;
use crate::suspect::Suspect;

/// How often the worker thread looks for a command or a dead child.
const TICK: Duration = Duration::from_millis(200);
/// Per-probe budget during the ready handshake.
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ServerState {
    Stopped,
    Starting,
    Running {
        /// The server's pid — 0 when adopted blind (see `take_over`): ours,
        /// pid unknown, watched by health instead of by pid, and never a
        /// signal target. `terminate_pid` refuses 0 outright.
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
    /// The server stopped by itself. `detail` is its last stderr line, or its
    /// exit status when it said nothing.
    ServerExited { detail: String },
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
    /// Up: running, or adopted and running.
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
    /// A server from an earlier run of this app is alive and answering. Use it:
    /// loading a model again costs the user tens of seconds. The pid is `None`
    /// when the state file's writer died before recording one: adopted blind,
    /// watched by health, never signalled.
    Adopted { pid: Option<u32> },
    Spawned {
        child: ChildHandle,
        instance: InstanceFile,
    },
}

/// The server we believe is running, and how we came to own it.
struct Owned {
    child: Option<ChildHandle>,
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
    /// Where the engine's stderr keeps itself (`keep_stderr_in`), read at
    /// each start. `None` until the app names its log folder, and in every
    /// test: a child spawned against `None` keeps its tail in memory only,
    /// which is the shape every test before the file existed still sees.
    stderr_dir: Arc<Mutex<Option<PathBuf>>>,
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
    /// gone is never handed out. `None` when no engine was started, when one
    /// was adopted (an adopted pid is never held — see `finish_engine`), or
    /// when the engine's going is proven.
    pub fn engine_pid(&self) -> Option<u32> {
        self.engine.pid()
    }

    /// The exit's last resort, on the identity the supervisor still holds:
    /// the engine the stop could not prove gone. `None` — the common exit —
    /// when nothing is held, in which case nothing is killed and nothing is
    /// said. This is the one kill path the app has: the exit handler runs it
    /// after its steps come back, the exit watchdog at its deadline, and
    /// both reach here so neither can drift into signalling a pid the
    /// supervisor no longer vouches for. An adopted engine is never killed
    /// through it: its only voucher is a state file a previous run wrote,
    /// stale by exit time — a recycled pid may name a stranger, and the stop
    /// walk already signalled the pid while the file still vouched for it.
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

    /// Names the folder the engine's stderr keeps itself in: a
    /// size-capped, rotating file beside the app's other logs
    /// (`kalsa-engine.log`), every line through the drain's denylist.
    /// Called once, when the app knows its log folder and before any start
    /// can run; a start queued before it ran keeps its stderr to the
    /// in-memory tail, which is the honest fallback, not a fault.
    pub fn keep_stderr_in(&self, dir: PathBuf) {
        if let Ok(mut held) = self.stderr_dir.lock() {
            *held = Some(dir);
        }
    }

    /// The release count, shared with the stderr drain: a consumer that owns
    /// the model's session state (the app's metrics) keeps its last-applied
    /// value and applies every release it has not seen yet. An adopted server
    /// is the gap: we hold no pipe to it, so releases during adoption are
    /// unannounced to us.
    pub fn release_watcher(&self) -> Arc<AtomicU64> {
        Arc::clone(&self.releases)
    }

    /// Whether the server holds the model in memory right now. `None` when
    /// nothing can say: a server adopted from an earlier run is reused without
    /// a `ChildHandle` (`take_over`), so there is no pipe and its releases and
    /// reloads are never announced. An adopted server is still serving — the
    /// door answers and the model comes back when a message arrives — so this
    /// answers about the model, never about whether the server counts as up.
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
    /// its verdict: adoption, the handshake and the spawn all happen on the
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
    // Where the engine's stderr keeps itself, set once by the app before
    // any start can run (and `None` where nobody did — the tests): read at
    // each start, so the value the child's drain sees is the one that
    // was standing when the start was queued.
    stderr_dir: Arc<Mutex<Option<PathBuf>>>,
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
                    stderr_dir.as_deref(),
                );
                match started {
                    Ok(Started::Adopted { pid }) => {
                        set(
                            &state,
                            ServerState::Running {
                                pid: pid.unwrap_or(0),
                                port: config.port,
                            },
                        );
                        // An adopted engine's pid is never held: its only
                        // voucher is a state file a previous run wrote, and
                        // by exit time that word is stale.
                        engine.clear();
                        log::info!(
                            "engine adopted #{starts}: {} (pid {})",
                            engine_name(&config.exe),
                            pid.map(|pid| pid.to_string())
                                .unwrap_or_else(|| "unknown".to_string())
                        );
                        let _ = settled.send(StartSettled::Up);
                        owned = Some(Owned {
                            child: None,
                            adopted_pid: pid,
                            instance: None,
                            config: *config,
                        });
                    }
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
                        // An adopted server with a pid is watched by pid; one
                        // adopted blind has no pid to watch, so its health is
                        // the watch — which is the stricter of the two anyway:
                        // a recycled pid looks alive, a dead server answers
                        // nothing.
                        None => {
                            if let Some(pid) = run.adopted_pid {
                                if !child::pid_alive(pid) {
                                    owned = None;
                                    engine.clear();
                                    set(
                                        &state,
                                        ServerState::Failed {
                                            reason: Failure::ServerExited {
                                                detail: format!(
                                                    "the adopted server (pid {pid}) is no longer alive"
                                                ),
                                            },
                                        },
                                    );
                                }
                            } else if !health::health_ok(
                                run.config.address(),
                                "/health",
                                PROBE_TIMEOUT,
                            ) {
                                owned = None;
                                engine.clear();
                                set(
                                    &state,
                                    ServerState::Failed {
                                        reason: Failure::ServerExited {
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
                // Adopted from an earlier run. The proof it was ours was the
                // lock, and time has passed: if the server died and the pid
                // was recycled, the lock is gone and the pid now names
                // somebody else's program. Terminate only a pid the file
                // still vouches for; when it does not, THAT is reported as
                // the unknown it is instead of being skipped in silence.
                // The identity was never held for an adopted engine, and
                // this walk does not start holding it.
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
            // Adopted blind: no pid was ever recorded, so the process half
            // can never be proven here — only the port can speak (§9:
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

/// Reuses or clears a previous instance, then spawns and waits for readiness.
fn start_blocking(
    config: &ServerConfig,
    releases: Arc<AtomicU64>,
    residency: Residency,
    start: u64,
    engine: &EngineId,
    stderr_dir: Option<&Path>,
) -> Result<Started, Failure> {
    // Before anything exists: an unsafe binding must be refused, not started
    // and then failed to be found.
    config
        .verified_binding()
        .map_err(|detail| Failure::UnsafeBinding { detail })?;
    // The suspicion a previous stop could not disprove, settled FIRST: a
    // refusing port means there was nothing — recovered, deleted before this
    // walk goes on, whatever it then does. An answering port leaves the
    // record standing for the adoption below, which replaces it the moment
    // an instance of ours is alive; a start that fails with a stranger
    // still on the port keeps it, because the suspicion is still open.
    let suspect = Suspect::of(&config.state_file);
    suspect.settle_before_start(presence::probe, config.address(), presence::PROBE_TIMEOUT);
    if let Some(started) = take_over(config)? {
        suspect.clear();
        return Ok(started);
    }
    preflight_port(config)?;
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
        if health::health_ok(config.address(), "/health", PROBE_TIMEOUT) {
            log::info!("engine ready in {:.1}s", began.elapsed().as_secs_f64());
            suspect.clear();
            return Ok(Started::Spawned { child, instance });
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

/// Substrings that mark an engine stderr line as carrying REQUEST bytes.
/// Each was read out of the fork's own sources (`tools/server` in
/// kalsallama) — at default verbosity these are the lines that print what
/// somebody sent:
///
/// - `got exception` / `got another exception` — `server.cpp:79,81`, the
///   whole request body (`res->data`) and the exception text;
/// - `last read`, `parse_error`, `json.exception` — nlohmann's parse
///   errors quote the input around the failure, whatever printed them;
/// - `unsupported Responses tool type` — `server-chat.cpp:277`, a field
///   value out of the request;
/// - `downloading image from`, `loading image from local file` —
///   `server-common.cpp:1094,1115`, a URL or path out of the request;
/// - `old: ...` / `new: ...` — the prompt-cache debug dump
///   (`server-context.cpp:3712-3747`), which prints PROMPT TEXT as
///   `old: ...`/`new: ...` lines when `LLAMA_SERVER_SLOTS_DEBUG` is set —
///   the spawn strips that variable, and this is the second wall;
/// - `api_keys:` — `server-http.cpp:229-234`, the key's last characters,
///   printed when verbosity was raised (also stripped at the spawn);
/// - `awaiting trigger` — the scheduler's idle wake line, not printed at
///   default verbosity and absent from the shipped build's own strings;
///   kept out as defence in depth (docs/BACKLOG.md, "Log and report").
///
/// Everything else the fork prints at this verbosity is argv, model paths
/// or counters — checked across `server.cpp`, `server-chat.cpp`,
/// `server-common.cpp` and `server-context.cpp`.
const REQUEST_LINE_MARKS: [&str; 12] = [
    "got exception",
    "got another exception",
    "last read",
    "parse_error",
    "json.exception",
    "unsupported Responses tool type",
    "downloading image from",
    "loading image from local file",
    "old: ...",
    "new: ...",
    "api_keys:",
    "awaiting trigger",
];

/// The withheld lines' replacement, named once so the log reads the same
/// wherever the filter bites — the app log's stderr lines and the engine's
/// stderr file alike.
pub(crate) const WITHHELD: &str = "<a request error line was withheld>";

pub(crate) fn carries_request_text(line: &str) -> bool {
    REQUEST_LINE_MARKS.iter().any(|mark| line.contains(mark))
}

/// The engine's own last words, made safe for the log: a line that carries
/// request bytes becomes the one withheld sentence, every other line is
/// clipped to [`STDERR_CLIP`] characters. One withheld line is logged for
/// however many were dropped — the count is the shape of one bad request,
/// not information the log needs.
fn sanitized_tail(lines: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut withheld = false;
    for line in lines {
        if carries_request_text(line) {
            withheld = true;
            continue;
        }
        let clipped: String = line.chars().take(STDERR_CLIP).collect();
        out.push(clipped);
    }
    if withheld {
        out.push(WITHHELD.to_string());
    }
    out
}

/// The engine's own last words on the record, after an exit or a failed
/// start: the in-memory stderr tail through [`sanitized_tail`], one log
/// line per stderr line. The argv renderer cannot emit a verbose flag
/// (`kalsa-launch/src/argv.rs` pins it), so at default verbosity the only
/// request text llama-server can print is the exception family the filter
/// takes out.
fn log_stderr_tail(child: &ChildHandle) {
    for line in sanitized_tail(&child.output_tail()) {
        log::warn!("engine stderr: {line}");
    }
}

/// What the state file says about a previous run.
///
/// The lock decides what may be trusted: while it is held, the process it names
/// is the server we started, so we may reuse it or close it. Without the lock
/// the pid means nothing (it may have been recycled) and is never signalled.
fn take_over(config: &ServerConfig) -> Result<Option<Started>, Failure> {
    match InstanceFile::inspect(&config.state_file) {
        Ok(Existing::None) => Ok(None),
        Ok(Existing::Stale) => {
            let _ = std::fs::remove_file(&config.state_file);
            Ok(None)
        }
        Ok(Existing::Live { pid, port, binding }) => {
            // The lock vouches for the pid being a server we started; the
            // binding says it is the server we are asking for. Same binary
            // under different arguments is a different server — adopting it
            // would run a model and flags nobody asked for. A file with no
            // binding predates the record and describes a server started
            // under the old contract: nothing to mismatch.
            let same_command = binding.as_deref().map_or(true, |b| b == config.binding());
            if port == config.port
                && same_command
                && child::pid_alive(pid)
                && health::health_ok(config.address(), "/health", PROBE_TIMEOUT)
            {
                return Ok(Some(Started::Adopted { pid: Some(pid) }));
            }
            // Ours, but not usable as configured: wedged, or left on a port the
            // app no longer uses. Close it and start fresh.
            if child::pid_alive(pid) {
                let _ = child::terminate_pid(pid, config.stop_grace);
            }
            let _ = std::fs::remove_file(&config.state_file);
            Ok(None)
        }
        Ok(Existing::Unidentified { port, binding }) => {
            // The writer died between the spawn and the describe: the record
            // names the server but no pid, so nothing here may be signalled
            // — a pid found anywhere else is somebody else's. What is known
            // is enough to reuse: the lock proves an heir of ours is alive,
            // and port plus exact command say which server it must be. The
            // heir is likely still loading its model, so its health is
            // awaited the way the start handshake awaits it. Adopted blind
            // when it answers; reported, never touched, otherwise.
            let same_command = binding.as_deref().map_or(true, |b| b == config.binding());
            if port == config.port && same_command && await_healthy(config) {
                return Ok(Some(Started::Adopted { pid: None }));
            }
            Err(Failure::InstanceUnreadable {
                detail: "our state file names a server but no pid, and it cannot be adopted as configured"
                    .to_string(),
            })
        }
        Err(e) => Err(Failure::InstanceUnreadable {
            detail: format!("our state file cannot be read: {e}"),
        }),
    }
}

/// The heir of a mid-sentence writer is likely still loading its model:
/// await its health the way the start handshake does — a probe with a
/// deadline, never a sleep. There is no child handle to watch for an early
/// exit, because the child is not ours to wait on; silence through the
/// deadline is the answer.
fn await_healthy(config: &ServerConfig) -> bool {
    let deadline = Instant::now() + config.ready_timeout;
    loop {
        if health::health_ok(config.address(), "/health", PROBE_TIMEOUT) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(TICK);
    }
}

/// A courtesy pre-check, not a guarantee: binding the port proves it was
/// free at the moment of the bind, and the very next moment belongs to
/// anyone — the bind is dropped so the child can take it for real, and
/// between the drop and the child's own bind any process on the machine may
/// step in. No retry loop or sleep can close that window; only the kernel's
/// own bind is atomic, and the child performs it when it starts.
///
/// Kept because the report is worth more than the race costs: a stranger
/// already on the port is the common case, and `PortTaken` names it plainly
/// instead of letting the spawn fail later in the server's own words. The
/// real protection is elsewhere and threefold: `verified_binding` refuses a
/// non-loopback or wrong-port argv before any process exists; the child's
/// own bind fails loudly when the port is taken (surfaced as `ServerExited`
/// with the server's stderr); and the readiness handshake reports `Running`
/// only while the child it spawned is both alive and answering. A stranger
/// found here is reported (`PortTaken`) and never signalled.
fn preflight_port(config: &ServerConfig) -> Result<(), Failure> {
    match TcpListener::bind(config.address()) {
        Ok(listener) => {
            // Freed at once: the child binds it for real — if nobody takes
            // it first, which this check cannot promise.
            drop(listener);
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => Err(Failure::PortTaken),
        // Any other bind failure is not about a foreign listener: let the
        // server report it in its own words.
        Err(_) => Ok(()),
    }
}

/// What the supervisor knows when the server stopped by itself: its last
/// stderr line, or its exit status when it said nothing. The detail is for
/// logs; the caller owns the words. A last line that carries request bytes
/// is not repeated here either — the detail travels into the log through
/// the failure itself, so it goes through the same rule.
fn exit_reason(child: &ChildHandle, status: std::process::ExitStatus) -> Failure {
    Failure::ServerExited {
        detail: match sanitized_tail(&child.output_tail()).last() {
            Some(line) => line.clone(),
            None => format!("exit status {status}"),
        },
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
    use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

    #[test]
    fn the_awaiting_trigger_line_is_withheld() {
        // Defence in depth, not an observed line: absent from the shipped
        // build's own strings and from the default verbosity, kept on the
        // list so a future build that prints it prints it nowhere.
        assert!(carries_request_text("srv  update_slots: awaiting trigger"));
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
            "srv  update_slots: all slots are idle".to_string(),
        ]
    }

    #[test]
    fn the_engine_stderr_tail_never_carries_request_bytes() {
        let kept = sanitized_tail(&dead_engine_tail());
        let joined = kept.join("\n");
        for mark in REQUEST_LINE_MARKS {
            assert!(!joined.contains(mark), "a request line survived: {mark}");
        }
        assert!(
            !joined.contains("marco"),
            "request bytes survived the filter: {joined}"
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
        let long = format!("E backend scan: {}", "x".repeat(STDERR_CLIP + 200));
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

    fn config(port: u16) -> ServerConfig {
        ServerConfig {
            exe: PathBuf::from("/nonexistent/llama-server"),
            argv: vec![
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                port.to_string(),
            ],
            state_file: std::env::temp_dir().join(format!("kalsa-supervisor-unit-{port}.state")),
            port,
            ready_timeout: Duration::from_secs(1),
            stop_grace: Duration::from_millis(50),
        }
    }

    #[test]
    fn an_argv_that_leaves_loopback_is_refused_before_any_process_exists() {
        let mut config = config(8290);
        config.argv = vec![
            "--host".into(),
            "0.0.0.0".into(),
            "--port".into(),
            "8290".into(),
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
        let mut config = config(8291);
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
        let config = config(8292);
        let err = start_blocking(&config, Arc::new(AtomicU64::new(0)), Residency::new(), 1, &EngineId::new(), None)
            .err()
            .expect("the spawn had to fail on a nonexistent exe");
        match err {
            Failure::ServerNotStarted { .. } => {}
            other => panic!("unexpected outcome for a well-bound argv: {other:?}"),
        }
        let _ = std::fs::remove_file(&config.state_file);
    }

    #[test]
    fn an_adopted_server_has_no_answer_about_its_model() {
        // The gap the residency's third value exists for: a server from an
        // earlier run of this app is reused by `take_over` without a
        // `ChildHandle`, so no stderr pipe is ever held and nothing can
        // announce a release or a reload. The answer must be "not known",
        // never "in memory".
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
                        // Every probe gets a 200: an adopted server is one that
                        // answers, which is how it came to be adopted.
                        Ok((mut stream, _)) => {
                            let _ = std::io::Write::write_all(&mut stream, b"HTTP/1.0 200 OK\r\n\r\n");
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(10)),
                    }
                }
            }
        });
        // A state file this very process holds the lock on, naming a live pid:
        // the shape `inspect` reports as Live, which `take_over` adopts when the
        // port answers. No `binding` line, so no command to mismatch.
        let config = config(port);
        std::fs::write(
            &config.state_file,
            format!("kalsa-brain v1\npid={}\nport={port}\n", std::process::id()),
        )
        .expect("write the earlier run's state file");
        let lock = std::fs::File::open(&config.state_file).expect("open the state file");
        crate::hold_state_lock(&lock).expect("hold the lock as an earlier run would");

        let residency = Residency::new();
        let adopted = start_blocking(&config, Arc::new(AtomicU64::new(0)), residency.clone(), 1, &EngineId::new(), None);
        let announced = residency.asleep();

        // Teardown before the assertions, so a failing one cannot leave the
        // listener accepting or the state file behind for the rest of the run.
        // `tests/common` has a `Drop` guard for its own fake health server; this
        // is the unit-test module, so it is done by hand.
        stop.store(true, Ordering::Relaxed);
        let _ = stand_in.join();
        drop(lock);
        let _ = std::fs::remove_file(&config.state_file);

        match adopted.expect("the earlier run's server must be adopted, not started again") {
            Started::Adopted { pid } => assert!(pid.is_some(), "a Live state file names a pid"),
            Started::Spawned { .. } => panic!("the earlier run's server was spawned a second time"),
        }
        assert_eq!(
            announced,
            None,
            "an adopted server has no pipe: its model's residency must stay unknown, not be assumed loaded"
        );
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
        let config = config(8294);
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
        let port = 8293;
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
        let port = 8295;
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
        // visible at capture time). The answering twin of this case runs the
        // full worker integration in `suspect_record.rs`.
        let port = 8296;
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
        let port = 8297;
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
        let port = 8298;
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
        let port = 8297;
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
        let port = 8299;
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
        let port = 8315;
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
        )
        .expect("spawn the stand-in engine");
        let pid = child.pid();
        let gone: presence::Probe = |_, _| presence::Presence::Gone;
        let supervisor = planted_supervisor(
            Owned {
                child: Some(child),
                adopted_pid: None,
                instance: None,
                config: config(8317),
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
        )
        .expect("spawn the stand-in engine");
        let pid = child.pid();
        let gone: presence::Probe = |_, _| presence::Presence::Gone;
        let supervisor = planted_supervisor(
            Owned {
                child: Some(child),
                adopted_pid: None,
                instance: None,
                config: config(8316),
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
        let port = 8311;
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
        let port = 8313;
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
