//! The app shell: three pages — status, model, pairing — and the commands
//! they read.
//!
//! All supervision lives in `kalsa-supervisor`; this file only resolves where
//! the server binary and the model are, and maps the supervisor's state onto
//! commands the webview can call. Model choice and download live in
//! `kalsa-catalog` and `kalsa-download`; until `brain_choice` exists, the one
//! real step the Model page can offer is `brain_measure` — kalsa-probe's
//! measurement of this machine — and the web shell renders unknown states
//! from `src/data/placeholders.js` rather than inventing answers here.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use kalsa_supervisor::{
    conservative_threads, Failure, ServerConfig, ServerState, Supervisor, DEFAULT_BATCH,
    DEFAULT_CTX, DEFAULT_IDLE_SECONDS, DEFAULT_STOP_GRACE, DEFAULT_UBATCH,
};
use serde::Serialize;
use tauri::{Manager, RunEvent, State};

/// Overrides where the server binary comes from. Development only: a shipped
/// build carries it next to the executable.
const SERVER_BIN_ENV: &str = "KALSA_BRAIN_SERVER_BIN";
const SERVER_BIN_NAME: &str = "llama-server";
/// The GGUF to serve. Required until the model page exists.
const MODEL_ENV: &str = "KALSA_BRAIN_MODEL";
/// Loopback port. The phone reaches it through a tunnel, never over the LAN.
const PORT: u16 = 8130;
/// Loading a model from a slow disk on an old machine is not fast.
const READY_TIMEOUT: Duration = Duration::from_secs(600);
/// Long enough for a clean unload, short enough that closing the window is not
/// a hang: the supervisor escalates to SIGKILL after the second one.
const STOP_GRACE: Duration = Duration::from_secs(2);

struct Brain {
    supervisor: Supervisor,
    /// Whether a probe measurement of this machine has succeeded in this run.
    /// Held in memory only: until kalsa-catalog's command owns the numbers,
    /// a restart measures again rather than pretending a result survived.
    measured: AtomicBool,
}

impl Brain {
    fn new() -> Self {
        Self {
            supervisor: Supervisor::new(),
            measured: AtomicBool::new(false),
        }
    }

    fn config(&self, state_file: PathBuf) -> Result<ServerConfig, String> {
        let model = std::env::var(MODEL_ENV)
            .map(PathBuf::from)
            .map_err(|_| "No model is set up on this computer yet.".to_string())?;
        Ok(ServerConfig {
            exe: server_binary(),
            model,
            state_file,
            port: PORT,
            threads: conservative_threads(
                std::thread::available_parallelism()
                    .map(|n| n.get())
                    .unwrap_or(4),
            ),
            batch: DEFAULT_BATCH,
            ubatch: DEFAULT_UBATCH,
            ctx: DEFAULT_CTX,
            idle_seconds: DEFAULT_IDLE_SECONDS,
            ready_timeout: READY_TIMEOUT,
            stop_grace: STOP_GRACE.max(DEFAULT_STOP_GRACE / 2),
        })
    }
}

/// Our embedded copy beside the executable, or whatever is on PATH while this
/// is still a skeleton with no packaging step.
fn server_binary() -> PathBuf {
    if let Ok(path) = std::env::var(SERVER_BIN_ENV) {
        return PathBuf::from(path);
    }
    if let Ok(current) = std::env::current_exe() {
        if let Some(dir) = current.parent() {
            let beside = dir.join(SERVER_BIN_NAME);
            if Path::new(&beside).exists() {
                return beside;
            }
        }
    }
    PathBuf::from(SERVER_BIN_NAME)
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StateDto {
    Stopped,
    Starting,
    Running {
        port: u16,
    },
    /// Already in the user's words, produced only by `words` below.
    Failed {
        reason: String,
    },
}

/// The words for each failure — the only place the supervisor's observations
/// become sentences. Fail closed: the match is exhaustive, so a reason the
/// supervisor learns to report breaks this build until it is given words, and
/// a `detail` payload never crosses it. Every sentence says what happened and
/// what the user can do, in the language of the screen, not of the crate.
fn words(failure: &Failure) -> String {
    match failure {
        Failure::PortTaken => "Another program is in the way. Restarting the computer usually clears it.".into(),
        Failure::InstanceUnreadable { .. } => {
            "A copy of the assistant left over from earlier is stuck. Restarting the computer usually clears it.".into()
        }
        Failure::InstanceUnwritable { .. } => {
            "The assistant could not save its place on this computer, so it could not start. Restarting the computer usually clears it.".into()
        }
        Failure::ServerNotStarted { .. } => {
            "The assistant did not start. Turning it on again usually works; if it keeps failing, the app may need to be installed again.".into()
        }
        Failure::ServerExited { .. } => {
            "The assistant stopped on its own. Turning it on again usually works.".into()
        }
        Failure::NotReady { .. } => {
            "The assistant took too long to get ready. Turning it on again usually works.".into()
        }
    }
}

impl From<ServerState> for StateDto {
    fn from(state: ServerState) -> Self {
        match state {
            ServerState::Stopped => Self::Stopped,
            ServerState::Starting => Self::Starting,
            ServerState::Running { port, .. } => Self::Running { port },
            ServerState::Failed { reason } => Self::Failed {
                reason: words(&reason),
            },
        }
    }
}

#[tauri::command]
fn brain_state(brain: State<Brain>) -> StateDto {
    brain.supervisor.state().into()
}

/// Whether a model is configured at all — a fact, read from the environment,
/// so the Model page can say "nothing set up yet" instead of inventing an
/// entry. Which model and why are `kalsa-catalog`'s answer and will arrive as
/// their own command; a filename never crosses this boundary, because the
/// user has no use for one.
#[derive(Serialize)]
struct ModelDto {
    chosen: bool,
}

#[tauri::command]
fn brain_model() -> ModelDto {
    ModelDto {
        chosen: std::env::var(MODEL_ENV).is_ok(),
    }
}

/// Whether a measurement of this machine has succeeded in this run.
#[tauri::command]
fn brain_measured(brain: State<Brain>) -> bool {
    brain.measured.load(Ordering::Relaxed)
}

/// Measures this computer — the probe takes seconds, so it runs off the main
/// thread and the window stays responsive. True when the probe believes its
/// own numbers; a rejected measurement is reported, never kept.
#[tauri::command]
async fn brain_measure(brain: State<'_, Brain>) -> Result<bool, String> {
    let reliable = tauri::async_runtime::spawn_blocking(|| {
        kalsa_probe::measure_reliable(&kalsa_probe::ProbeConfig::default()).is_reliable()
    })
    .await
    .map_err(|_| "The measuring did not finish. Trying again usually works.".to_string())?;
    if reliable {
        brain.measured.store(true, Ordering::Relaxed);
    }
    Ok(reliable)
}

/// Returns at once: the handshake runs on the supervisor thread and the screen
/// follows the state, so a slow model load never freezes the window.
#[tauri::command]
fn brain_start(app: tauri::AppHandle, brain: State<Brain>) -> Result<(), String> {
    brain.supervisor.start(brain.config(state_file(&app)?)?);
    Ok(())
}

/// Where this instance announces itself. It is locked while our server runs and
/// the lock is inherited by the server, so the next start can tell our own
/// orphan from somebody else's program instead of guessing from a pid.
fn state_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| {
            // This string goes to the screen: the io error behind it stays here.
            "The assistant could not save its place on this computer, so it could not start. Restarting the computer usually clears it.".to_string()
        })?;
    Ok(dir.join("server.state"))
}

#[tauri::command]
fn brain_stop(brain: State<Brain>) {
    brain.supervisor.stop();
}

fn main() {
    tauri::Builder::default()
        .manage(Brain::new())
        .invoke_handler(tauri::generate_handler![
            brain_state,
            brain_model,
            brain_measured,
            brain_measure,
            brain_start,
            brain_stop
        ])
        .build(tauri::generate_context!())
        .expect("kalsa-brain: could not start")
        .run(|app, event| {
            // Take the child with us on the way out, on both exit paths the
            // runtime reports. The platform backstop (job object, pdeathsig)
            // covers the exits that run no handler at all.
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(brain) = app.try_state::<Brain>() {
                    brain.supervisor.shutdown();
                }
            }
        });
}
