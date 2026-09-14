//! The supervisor: one worker thread owns the child, the UI only reads a state
//! and sends commands. Nothing here blocks the caller.
//!
//! Why a child process at all: `GGML_ASSERT` calls `abort()`, which
//! `catch_unwind` does not contain, so an inference crash takes down whatever
//! process hosts it. Death of the server is therefore a normal case this module
//! must report, not an exception it may assume away.

use std::net::TcpListener;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::child::{self, ChildHandle};
use crate::config::ServerConfig;
use crate::health;
use crate::instance::{Existing, InstanceFile};

/// How often the worker thread looks for a command or a dead child.
const TICK: Duration = Duration::from_millis(200);
/// Per-probe budget during the ready handshake.
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ServerState {
    Stopped,
    Starting,
    Running {
        pid: u32,
        port: u16,
    },
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
}

enum Command {
    Start(Box<ServerConfig>),
    Stop,
    Shutdown,
}

enum Started {
    /// A server from an earlier run of this app is alive and answering. Use it:
    /// loading a model again costs the user tens of seconds.
    Adopted { pid: u32 },
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
}

impl Supervisor {
    pub fn new() -> Self {
        let (commands, inbox) = mpsc::channel();
        let state = Arc::new(Mutex::new(ServerState::Stopped));
        let worker = std::thread::spawn({
            let state = Arc::clone(&state);
            move || work(inbox, state)
        });
        Self {
            commands,
            state,
            worker: Mutex::new(Some(worker)),
        }
    }

    pub fn state(&self) -> ServerState {
        self.state
            .lock()
            .map(|s| s.clone())
            .unwrap_or(ServerState::Stopped)
    }

    /// Starts the server and returns at once: adoption, the handshake and the
    /// spawn all happen on the worker thread, and the UI watches `state()`.
    pub fn start(&self, config: ServerConfig) {
        let _ = self.commands.send(Command::Start(Box::new(config)));
    }

    /// Asks the worker to stop the server and reaps it there: the state follows
    /// on the next read, so a caller that must block uses `shutdown` instead.
    pub fn stop(&self) {
        let _ = self.commands.send(Command::Stop);
    }

    /// Stops the server and joins the worker: call this on app exit, so the
    /// child is gone before we are.
    pub fn shutdown(&self) {
        let _ = self.commands.send(Command::Shutdown);
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

fn work(inbox: Receiver<Command>, state: Arc<Mutex<ServerState>>) {
    let mut owned: Option<Owned> = None;
    loop {
        match inbox.recv_timeout(TICK) {
            Ok(Command::Start(config)) => {
                if owned.is_some() {
                    continue; // already on: the switch is not a restart button
                }
                set(&state, ServerState::Starting);
                match start_blocking(&config) {
                    Ok(Started::Adopted { pid }) => {
                        set(
                            &state,
                            ServerState::Running {
                                pid,
                                port: config.port,
                            },
                        );
                        owned = Some(Owned {
                            child: None,
                            adopted_pid: Some(pid),
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
                        owned = Some(Owned {
                            child: Some(child),
                            adopted_pid: None,
                            instance: Some(instance),
                            config: *config,
                        });
                    }
                    Err(reason) => set(&state, ServerState::Failed { reason }),
                }
            }
            Ok(Command::Stop) => stop(&mut owned, &state),
            Ok(Command::Shutdown) => {
                stop(&mut owned, &state);
                return;
            }
            Err(RecvTimeoutError::Timeout) => {
                // The server can die on its own at any moment (an assertion, an
                // OS kill, a model it could not load). Reporting it is the whole
                // point of hosting it in another process.
                if let Some(run) = owned.as_mut() {
                    if let Some(child) = run.child.as_mut() {
                        if let Ok(Some(status)) = child.try_wait() {
                            let reason = exit_reason(child, status);
                            owned = None;
                            set(&state, ServerState::Failed { reason });
                        }
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn stop(owned: &mut Option<Owned>, state: &Arc<Mutex<ServerState>>) {
    if let Some(mut run) = owned.take() {
        match (run.child.take(), run.adopted_pid, run.instance.take()) {
            (Some(mut child), _, instance) => {
                let _ = child.terminate(run.config.stop_grace);
                if let Some(file) = instance {
                    file.release();
                }
            }
            (None, Some(pid), _) => {
                // Adopted from an earlier run: no handle, but the state file's
                // lock proved it is the process we started.
                let _ = child::terminate_pid(pid, run.config.stop_grace);
            }
            (None, None, _) => {}
        }
    }
    set(state, ServerState::Stopped);
}

/// Reuses or clears a previous instance, then spawns and waits for readiness.
fn start_blocking(config: &ServerConfig) -> Result<Started, Failure> {
    if let Some(started) = take_over(config)? {
        return Ok(started);
    }
    refuse_foreign_port(config)?;
    let mut instance =
        InstanceFile::claim(&config.state_file).map_err(|e| Failure::InstanceUnwritable {
            detail: format!("could not write our state file: {e}"),
        })?;
    let mut child = ChildHandle::spawn(&config.exe, &config.arguments(), Some(instance.handle()))
        .map_err(|e| Failure::ServerNotStarted {
        detail: format!("could not start the server: {e}"),
    })?;
    instance
        .describe(child.pid(), config.port)
        .map_err(|e| Failure::InstanceUnwritable {
            detail: format!("could not write our state file: {e}"),
        })?;

    let deadline = Instant::now() + config.ready_timeout;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(exit_reason(&child, status));
        }
        if health::health_ok(config.address(), "/health", PROBE_TIMEOUT) {
            return Ok(Started::Spawned { child, instance });
        }
        if Instant::now() >= deadline {
            let _ = child.terminate(config.stop_grace);
            return Err(Failure::NotReady {
                seconds: config.ready_timeout.as_secs(),
            });
        }
        std::thread::sleep(TICK);
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
        Ok(Existing::Live { pid, port }) => {
            if port == config.port
                && child::pid_alive(pid)
                && health::health_ok(config.address(), "/health", PROBE_TIMEOUT)
            {
                return Ok(Some(Started::Adopted { pid }));
            }
            // Ours, but not usable as configured: wedged, or left on a port the
            // app no longer uses. Close it and start fresh.
            if child::pid_alive(pid) {
                let _ = child::terminate_pid(pid, config.stop_grace);
            }
            let _ = std::fs::remove_file(&config.state_file);
            Ok(None)
        }
        Err(e) => Err(Failure::InstanceUnreadable {
            detail: format!("our state file cannot be read: {e}"),
        }),
    }
}

/// A listener that is not ours is somebody else's program: never signalled,
/// only reported.
fn refuse_foreign_port(config: &ServerConfig) -> Result<(), Failure> {
    match TcpListener::bind(config.address()) {
        Ok(listener) => {
            drop(listener); // the child binds it for real
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
/// logs; the caller owns the words.
fn exit_reason(child: &ChildHandle, status: std::process::ExitStatus) -> Failure {
    Failure::ServerExited {
        detail: match child.output_tail().last() {
            Some(line) => line.clone(),
            None => format!("exit status {status}"),
        },
    }
}

fn set(state: &Arc<Mutex<ServerState>>, next: ServerState) {
    if let Ok(mut current) = state.lock() {
        *current = next;
    }
}
