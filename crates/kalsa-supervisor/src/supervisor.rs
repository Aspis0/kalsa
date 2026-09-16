//! The supervisor: one worker thread owns the child, the UI only reads a state
//! and sends commands. Nothing here blocks the caller.
//!
//! Why a child process at all: `GGML_ASSERT` calls `abort()`, which
//! `catch_unwind` does not contain, so an inference crash takes down whatever
//! process hosts it. Death of the server is therefore a normal case this module
//! must report, not an exception it may assume away.

use std::net::TcpListener;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::atomic::AtomicU64;
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
        /// The server's pid — 0 when adopted blind (see `take_over`): ours,
        /// pid unknown, watched by health instead of by pid, and never a
        /// signal target. `terminate_pid` refuses 0 outright.
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
    /// The command line did not bind loopback on the supervised port: a
    /// server the supervisor could not find, or one exposed off loopback.
    /// The start refused it before any process was made.
    UnsafeBinding { detail: String },
}

enum Command {
    Start(Box<ServerConfig>, mpsc::Sender<StartOutcome>),
    Stop,
    Shutdown,
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
    receiver: mpsc::Receiver<StartOutcome>,
}

impl StartWaiter {
    /// Blocks until the worker decides. The wait is bounded by the command
    /// the worker is currently serving — a start request is answered before
    /// any handshake begins, so only another start's handshake can delay it.
    pub fn outcome(self) -> StartOutcome {
        self.receiver.recv().unwrap_or(StartOutcome::Refused)
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
    /// How many model releases the server has announced on stderr (see
    /// `MODEL_RELEASED_LINE` in `child`). The drain thread adds; readers
    /// compare against their last-seen value and act on the difference — an
    /// event no poll can miss, because the count never goes back down.
    releases: Arc<AtomicU64>,
}

impl Supervisor {
    pub fn new() -> Self {
        let (commands, inbox) = mpsc::channel();
        let state = Arc::new(Mutex::new(ServerState::Stopped));
        let releases = Arc::new(AtomicU64::new(0));
        let worker = std::thread::spawn({
            let state = Arc::clone(&state);
            let releases = Arc::clone(&releases);
            move || work(inbox, state, releases)
        });
        Self {
            commands,
            state,
            worker: Mutex::new(Some(worker)),
            releases,
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

    pub fn state(&self) -> ServerState {
        self.state
            .lock()
            .map(|s| s.clone())
            .unwrap_or(ServerState::Stopped)
    }

    /// Sends the start to the worker and returns at once with the handle to
    /// its verdict: adoption, the handshake and the spawn all happen on the
    /// worker thread, the UI watches `state()`, and a caller that must know
    /// whether the request was taken blocks on the waiter's outcome.
    pub fn start(&self, config: ServerConfig) -> StartWaiter {
        let (sender, receiver) = mpsc::channel();
        let _ = self.commands.send(Command::Start(Box::new(config), sender));
        StartWaiter { receiver }
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

fn work(
    inbox: Receiver<Command>,
    state: Arc<Mutex<ServerState>>,
    releases: Arc<AtomicU64>,
) {
    let mut owned: Option<Owned> = None;
    loop {
        match inbox.recv_timeout(TICK) {
            Ok(Command::Start(config, outcome)) => {
                if owned.is_some() {
                    let _ = outcome.send(StartOutcome::Refused);
                    continue; // already on: the switch is not a restart button
                }
                // The verdict comes before the work: a caller that records
                // the launch on acceptance must not wait out a handshake
                // whose answer decides whether the record exists at all.
                let _ = outcome.send(StartOutcome::Accepted);
                set(&state, ServerState::Starting);
                match start_blocking(&config, Arc::clone(&releases)) {
                    Ok(Started::Adopted { pid }) => {
                        set(
                            &state,
                            ServerState::Running {
                                pid: pid.unwrap_or(0),
                                port: config.port,
                            },
                        );
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
                    match run.child.as_mut() {
                        Some(child) => {
                            if let Ok(Some(status)) = child.try_wait() {
                                let reason = exit_reason(child, status);
                                owned = None;
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
                // Adopted from an earlier run. The proof it was ours was the
                // lock, and time has passed: if the server died and the pid
                // was recycled, the lock is gone and the pid now names
                // somebody else's program. Terminate only a pid the file
                // still vouches for.
                if let Ok(Existing::Live { pid: current, .. }) =
                    InstanceFile::inspect(&run.config.state_file)
                {
                    if current == pid {
                        let _ = child::terminate_pid(pid, run.config.stop_grace);
                    }
                    let _ = std::fs::remove_file(&run.config.state_file);
                }
            }
            // Adopted blind: no pid was ever recorded, so there is nothing
            // to signal and no lock of ours to release — the heir still
            // holds it. Left running by necessity; the next start re-adopts
            // it by port and health, so a stop followed by a start keeps
            // working. Only a stop that stays stopped leaks it, until reboot.
            (None, None, _) => {}
        }
    }
    set(state, ServerState::Stopped);
}

/// Reuses or clears a previous instance, then spawns and waits for readiness.
fn start_blocking(config: &ServerConfig, releases: Arc<AtomicU64>) -> Result<Started, Failure> {
    // Before anything exists: an unsafe binding must be refused, not started
    // and then failed to be found.
    config
        .verified_binding()
        .map_err(|detail| Failure::UnsafeBinding { detail })?;
    if let Some(started) = take_over(config)? {
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
    let mut child =
        ChildHandle::spawn(&config.exe, &config.argv, Some(instance.handle()), releases)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

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
        let err = start_blocking(&config, Arc::new(AtomicU64::new(0)))
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
        let err = start_blocking(&config, Arc::new(AtomicU64::new(0)))
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
        let err = start_blocking(&config, Arc::new(AtomicU64::new(0)))
            .err()
            .expect("the spawn had to fail on a nonexistent exe");
        match err {
            Failure::ServerNotStarted { .. } => {}
            other => panic!("unexpected outcome for a well-bound argv: {other:?}"),
        }
        let _ = std::fs::remove_file(&config.state_file);
    }

    #[test]
    fn stopping_an_adopted_server_spares_a_recycled_pid() {
        // The orphan died and its pid was recycled onto this innocent sleeper:
        // the state file says Live but nobody holds the lock, so the pid must
        // not be signalled.
        let port = 8293;
        let stand_in_path = std::env::temp_dir().join(format!("kalsa-recycle-{port}.bin"));
        let mut stand_in = std::process::Command::new("/bin/sleep")
            .arg("30")
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
        stop(&mut owned, &state);
        assert!(
            stand_in.try_wait().expect("poll the stand-in").is_none(),
            "a recycled pid was signalled: we killed somebody else's program"
        );
        let _ = stand_in.kill();
        let _ = stand_in.wait();
        let _ = std::fs::remove_file(&config(port).state_file);
    }
}
