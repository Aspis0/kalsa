//! The app shell: three pages — status, model, pairing — and the commands
//! they read.
//!
//! All supervision lives in `kalsa-supervisor`; "Turn on" is the walk in
//! `startup`: decide the backend, place the chosen model, start the server —
//! off the main thread, reporting progress, refusing a second press while a
//! walk is still going. Model choice is `kalsa-catalog`'s, downloads are
//! `kalsa-download`'s, and every failure becomes a sentence in `failure`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod failure;
mod startup;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use kalsa_probe::{Measurement, ProbeConfig};
use kalsa_supervisor::{ServerState, Supervisor};
use serde::Serialize;
use tauri::{Emitter, Manager, RunEvent, State};

/// Development overrides, honoured only while this is a skeleton with no
/// packaging step. The server override replaces the decide step; the model
/// override replaces the choice and the acquisition — in both cases the
/// developer owns the bytes.
const SERVER_BIN_ENV: &str = "KALSA_BRAIN_SERVER_BIN";
const MODEL_ENV: &str = "KALSA_BRAIN_MODEL";
/// Where the pairing handshake is kept, so the catalog knows what the phone
/// runs. The pairing crate persists and loads it; this is its path.
const PAIRING_FILE: &str = "pairing.json";

struct Brain {
    supervisor: Supervisor,
    /// The measurement of this machine, kept so a turn-on does not measure
    /// again and the Model page can say whether numbers exist. Memory only:
    /// a restart measures again rather than pretending a result survived.
    measurement: Mutex<Option<Measurement>>,
    /// One walk at a time: a second press while the first is still deciding,
    /// downloading or starting must not start a second of anything.
    turning_on: AtomicBool,
}

impl Brain {
    fn new() -> Self {
        Self {
            supervisor: Supervisor::new(),
            measurement: Mutex::new(None),
            turning_on: AtomicBool::new(false),
        }
    }

    /// Claims the single walk. False when one is already going.
    fn begin_turn_on(&self) -> bool {
        self.turning_on
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
}

/// The phone's declaration, from the persisted pairing. Unpaired is a normal
/// state, not an error: the catalog answers it with a refusal the user can
/// act on.
fn phone(app: &tauri::AppHandle) -> Option<kalsa_catalog::PhoneModel> {
    let path = app.path().app_data_dir().ok()?.join(PAIRING_FILE);
    kalsa_pairing::store::load(&path)
        .ok()
        .map(|handshake| handshake.phone)
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StateDto {
    Stopped,
    Starting,
    Running {
        port: u16,
    },
    /// Already in the user's words, produced only by `failure::words`.
    Failed {
        reason: String,
    },
}

impl From<ServerState> for StateDto {
    fn from(state: ServerState) -> Self {
        match state {
            ServerState::Stopped => Self::Stopped,
            ServerState::Starting => Self::Starting,
            ServerState::Running { port, .. } => Self::Running { port },
            ServerState::Failed { reason } => Self::Failed {
                reason: failure::words(&failure::StartupFailure::Supervisor(reason)),
            },
        }
    }
}

#[tauri::command]
fn brain_state(brain: State<Brain>) -> StateDto {
    brain.supervisor.state().into()
}

/// Whether a model is configured at all — the development override is the
/// fact today; the catalog's own choice arrives with the Model page's next
/// step. Which model and why are `kalsa-catalog`'s answer; a filename never
/// crosses this boundary, because the user has no use for one.
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

/// Whether a measurement of this machine exists in this run.
#[tauri::command]
fn brain_measured(brain: State<Brain>) -> bool {
    brain
        .measurement
        .lock()
        .map(|stored| stored.is_some())
        .unwrap_or(false)
}

/// Measures this computer — the probe takes seconds, so it runs off the main
/// thread and the window stays responsive. True when the probe believes its
/// own numbers; a rejected measurement is reported, never kept.
#[tauri::command]
async fn brain_measure(brain: State<'_, Brain>) -> Result<bool, String> {
    let measured = tauri::async_runtime::spawn_blocking(|| {
        kalsa_probe::measure_reliable(&ProbeConfig::default())
    })
    .await
    .map_err(|_| "The measuring did not finish. Trying again usually works.".to_string())?;
    let reliable = measured.is_reliable();
    if reliable {
        if let Ok(mut stored) = brain.measurement.lock() {
            *stored = Some(measured);
        }
    }
    Ok(reliable)
}

/// "Turn on": decide the backend, place the chosen model, start the server.
///
/// Returns at once from the window's point of view — the walk runs on a
/// blocking thread and reports progress as `brain_progress` events — but the
/// command's answer is the walk's verdict: `Ok` once the supervisor has been
/// started (the screen then follows `brain_state` through starting to
/// running), or the failure's own words. A second press while a walk is
/// still going is refused, not queued.
#[tauri::command]
async fn brain_start(app: tauri::AppHandle, brain: State<'_, Brain>) -> Result<(), String> {
    if !brain.begin_turn_on() {
        return Err("The assistant is already starting.".into());
    }
    let kept = brain
        .measurement
        .lock()
        .ok()
        .and_then(|stored| stored.clone());
    let ram_bytes = startup::ram_bytes();
    let runtime_root = kalsa_runtime::runtime_root();
    let state_file = state_file(&app)?;
    let server_override = std::env::var(SERVER_BIN_ENV).ok().map(PathBuf::from);
    let model_override = std::env::var(MODEL_ENV).ok().map(PathBuf::from);
    let phone = phone(&app);
    let emitter = app.clone();

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let mut progress = |step: startup::Progress| {
            let _ = emitter.emit("brain_progress", step);
        };
        // A machine nobody has measured yet is measured here, once: turning
        // on must not dead-end on a button the user has to find elsewhere.
        // A kept measurement the probe itself called unreliable decides on
        // noise: dropped, so the walk measures again.
        let kept = kept.filter(|m| m.is_reliable());
        let (machine, measured) = match kept {
            Some(measurement) => (
                startup::Machine {
                    measurement,
                    ram_bytes,
                },
                None,
            ),
            None => {
                progress(startup::Progress::Measuring);
                let measurement = kalsa_probe::measure_reliable(&ProbeConfig::default());
                (
                    startup::Machine {
                        measurement: measurement.clone(),
                        ram_bytes,
                    },
                    Some(measurement),
                )
            }
        };
        startup::run(
            server_override,
            machine,
            phone,
            model_override,
            state_file,
            &runtime_root,
            &mut progress,
        )
        .map(|config| (config, measured))
        .map_err(|failure| failure::words(&failure))
    })
    .await;

    // The walk is over either way; the next press may start again.
    brain.turning_on.store(false, Ordering::SeqCst);

    match outcome {
        Ok(Ok((config, measured))) => {
            if let Some(measured) = measured {
                if let Ok(mut stored) = brain.measurement.lock() {
                    *stored = Some(measured);
                }
            }
            // The supervisor reports starting, running and its own failures
            // through brain_state; its sentences live in failure too.
            brain.supervisor.start(config);
            Ok(())
        }
        Ok(Err(sentence)) => Err(sentence),
        Err(_) => Err("The starting did not finish. Trying again usually works.".into()),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_press_while_a_walk_is_running_starts_nothing() {
        let brain = Brain::new();
        assert!(brain.begin_turn_on(), "the first press goes through");
        assert!(
            !brain.begin_turn_on(),
            "a second press while the first is still going is refused: \
             no second decide, no second download, no second server"
        );
        assert!(!brain.begin_turn_on(), "refusal holds until the walk ends");
        brain.turning_on.store(false, Ordering::SeqCst);
        assert!(brain.begin_turn_on(), "a finished walk frees the next one");
    }
}
