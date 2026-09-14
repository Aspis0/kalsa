//! The supervisor: one worker thread owns the child, the UI only reads a state
//! and sends commands. Nothing here blocks the caller.
//!
//! Why a child process at all: `GGML_ASSERT` calls `abort()`, which
//! `catch_unwind` does not contain, so an inference crash takes down whatever
//! process hosts it. Death of the server is therefore a normal case this module
//! must report, not an exception it may assume away.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crate::child::ChildHandle;
use crate::health;

/// How often the worker thread looks for a command or a dead child.
const TICK: Duration = Duration::from_millis(200);
/// Per-probe budget during the ready handshake.
const PROBE_TIMEOUT: Duration = Duration::from_millis(500);
/// How long the server gets to exit after stdin EOF, and again after SIGTERM.
pub const DEFAULT_STOP_GRACE: Duration = Duration::from_secs(5);

/// Conservative defaults for old hardware: the objective is the highest
/// throughput the machine can sustain, not its maximum.
pub const DEFAULT_BATCH: u32 = 512;
pub const DEFAULT_UBATCH: u32 = 128;
pub const DEFAULT_IDLE_SECONDS: u32 = 300;
pub const DEFAULT_CTX: u32 = 8192;

/// Half the logical cores, at least two and at most eight: a machine already
/// busy with a browser and an antivirus should not have every core saturated by
/// an inference server it is not using right now.
pub fn conservative_threads(logical_cores: usize) -> u16 {
    (logical_cores / 2).clamp(2, 8) as u16
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ServerState {
    Stopped,
    Starting,
    Running {
        pid: u32,
        port: u16,
    },
    /// It is not running and we know why: the reason is user-facing copy.
    Failed {
        reason: String,
    },
}

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub exe: PathBuf,
    pub model: PathBuf,
    pub port: u16,
    pub threads: u16,
    pub batch: u32,
    pub ubatch: u32,
    pub ctx: u32,
    pub idle_seconds: u32,
    pub ready_timeout: Duration,
    pub stop_grace: Duration,
}

impl ServerConfig {
    /// Loopback only, conservative thread/batch counts, idle unload on. The
    /// server is never exposed on the LAN: the phone reaches it through a
    /// tunnel, so there is no cleartext surface to reason about.
    pub fn arguments(&self) -> Vec<String> {
        vec![
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            self.port.to_string(),
            "--model".into(),
            self.model.display().to_string(),
            "--threads".into(),
            self.threads.to_string(),
            "--threads-batch".into(),
            self.threads.to_string(),
            "--batch-size".into(),
            self.batch.to_string(),
            "--ubatch-size".into(),
            self.ubatch.to_string(),
            "--ctx-size".into(),
            self.ctx.to_string(),
            // Unloads the model and the KV cache after inactivity; /health,
            // /props and /models do not count as work, so a polling phone does
            // not keep the machine warm.
            "--sleep-idle-seconds".into(),
            self.idle_seconds.to_string(),
            "--no-webui".into(),
        ]
    }

    fn address(&self) -> SocketAddr {
        SocketAddr::from(([127, 0, 0, 1], self.port))
    }
}

enum Command {
    Start(Box<ServerConfig>),
    Stop,
    Shutdown,
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

    /// Starts the server and returns at once: the handshake happens on the
    /// worker thread, and the UI watches `state()`.
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
    let mut running: Option<(ChildHandle, ServerConfig)> = None;
    loop {
        match inbox.recv_timeout(TICK) {
            Ok(Command::Start(config)) => {
                if running.is_some() {
                    continue; // already on: the switch is not a restart button
                }
                set(&state, ServerState::Starting);
                match start_blocking(&config) {
                    Ok(child) => {
                        set(
                            &state,
                            ServerState::Running {
                                pid: child.pid(),
                                port: config.port,
                            },
                        );
                        running = Some((child, *config));
                    }
                    Err(reason) => set(&state, ServerState::Failed { reason }),
                }
            }
            Ok(Command::Stop) => {
                if let Some((mut child, config)) = running.take() {
                    let _ = child.terminate(config.stop_grace);
                }
                set(&state, ServerState::Stopped);
            }
            Ok(Command::Shutdown) => {
                if let Some((mut child, config)) = running.take() {
                    let _ = child.terminate(config.stop_grace);
                }
                set(&state, ServerState::Stopped);
                return;
            }
            Err(RecvTimeoutError::Timeout) => {
                // The server can die on its own at any moment (an assertion, an
                // OS kill, a model it could not load). Reporting it is the whole
                // point of hosting it in another process.
                if let Some((child, _)) = running.as_mut() {
                    if let Ok(Some(status)) = child.try_wait() {
                        let reason = exit_reason(child, status);
                        running = None;
                        set(&state, ServerState::Failed { reason });
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
    }
}

/// Spawns and waits for readiness. The probe is the handshake: there is no
/// startup line to read, so poll the endpoint the server serves when it is up.
fn start_blocking(config: &ServerConfig) -> Result<ChildHandle, String> {
    let mut child = ChildHandle::spawn(&config.exe, &config.arguments())
        .map_err(|e| format!("could not start the server: {e}"))?;
    let deadline = Instant::now() + config.ready_timeout;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(exit_reason(&child, status));
        }
        if health::health_ok(config.address(), "/health", PROBE_TIMEOUT) {
            return Ok(child);
        }
        if Instant::now() >= deadline {
            let _ = child.terminate(config.stop_grace);
            return Err(format!(
                "the server did not answer within {} s",
                config.ready_timeout.as_secs()
            ));
        }
        std::thread::sleep(TICK);
    }
}

/// What to show the user when the server stopped by itself. The last stderr
/// line is the server's own explanation; when there is none, the exit status is.
fn exit_reason(child: &ChildHandle, status: std::process::ExitStatus) -> String {
    match child.output_tail().last() {
        Some(line) => format!("the server stopped: {line}"),
        None => format!("the server stopped ({status})"),
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

    fn config() -> ServerConfig {
        ServerConfig {
            exe: PathBuf::from("/nonexistent/llama-server"),
            model: PathBuf::from("/models/a.gguf"),
            port: 8123,
            threads: 4,
            batch: DEFAULT_BATCH,
            ubatch: DEFAULT_UBATCH,
            ctx: DEFAULT_CTX,
            idle_seconds: DEFAULT_IDLE_SECONDS,
            ready_timeout: Duration::from_secs(1),
            stop_grace: Duration::from_millis(50),
        }
    }

    #[test]
    fn arguments_stay_on_loopback_and_unload_when_idle() {
        let args = config().arguments();
        let joined = args.join(" ");
        assert!(joined.contains("--host 127.0.0.1"));
        assert!(joined.contains("--sleep-idle-seconds 300"));
        assert!(joined.contains("--no-webui"));
        assert!(joined.contains("--model /models/a.gguf"));
        assert!(!joined.contains("0.0.0.0"));
    }

    #[test]
    fn threads_are_conservative() {
        assert_eq!(conservative_threads(1), 2);
        assert_eq!(conservative_threads(4), 2);
        assert_eq!(conservative_threads(8), 4);
        assert_eq!(conservative_threads(64), 8);
    }
}
