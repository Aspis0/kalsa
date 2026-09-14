//! The app shell: one screen, one switch.
//!
//! All supervision lives in `kalsa-supervisor`; this file only resolves where
//! the server binary and the model are, and maps the supervisor's state onto
//! commands the webview can call. Model selection and download are later pages:
//! reading them from the environment keeps this skeleton from inventing a
//! catalog that would compete with the app's own.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use std::time::Duration;

use kalsa_supervisor::{
    conservative_threads, ServerConfig, ServerState, Supervisor, DEFAULT_BATCH, DEFAULT_CTX,
    DEFAULT_IDLE_SECONDS, DEFAULT_STOP_GRACE, DEFAULT_UBATCH,
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
}

impl Brain {
    fn new() -> Self {
        Self {
            supervisor: Supervisor::new(),
        }
    }

    fn config(&self, state_file: PathBuf) -> Result<ServerConfig, String> {
        let model = std::env::var(MODEL_ENV)
            .map(PathBuf::from)
            .map_err(|_| format!("no model selected yet ({MODEL_ENV} is not set)"))?;
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
    Running { port: u16 },
    Failed { reason: String },
}

impl From<ServerState> for StateDto {
    fn from(state: ServerState) -> Self {
        match state {
            ServerState::Stopped => Self::Stopped,
            ServerState::Starting => Self::Starting,
            ServerState::Running { port, .. } => Self::Running { port },
            ServerState::Failed { reason } => Self::Failed { reason },
        }
    }
}

#[tauri::command]
fn brain_state(brain: State<Brain>) -> StateDto {
    brain.supervisor.state().into()
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
        .map_err(|e| format!("no app data directory: {e}"))?;
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
