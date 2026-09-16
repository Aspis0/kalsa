//! The app shell: three pages — status, model, pairing — and the commands
//! they read.
//!
//! All supervision lives in `kalsa-supervisor`; "Turn on" is the walk in
//! `startup`: decide the backend, place the chosen model, start the server —
//! off the main thread, reporting progress, refusing a second press while a
//! walk is still going. Model choice is `kalsa-catalog`'s, downloads are
//! `kalsa-download`'s, and every failure becomes a sentence in `failure`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod door;
mod failure;
mod metrics;
mod options;
mod pairing;
mod startup;
mod transport;

use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::SystemTime;

use kalsa_probe::{Measurement, ProbeConfig};
use kalsa_supervisor::{ServerState, StartOutcome, Supervisor};
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
    door: Mutex<Option<ActiveDoor>>,
    launch: Mutex<Option<startup::LaunchInfo>>,
    metrics: Arc<metrics::RuntimeMetrics>,
    /// The measurement of this machine, kept so a turn-on does not measure
    /// again and the Model page can say whether numbers exist. Memory only:
    /// a restart measures again rather than pretending a result survived.
    measurement: Mutex<Option<Measurement>>,
    /// One walk at a time: a second press while the first is still deciding,
    /// downloading or starting must not start a second of anything.
    turning_on: AtomicBool,
}

struct ActiveDoor {
    credential: String,
    address: SocketAddr,
    door: kalsa_door::RunningDoor,
}

impl Brain {
    fn new() -> Self {
        let supervisor = Supervisor::new();
        let metrics = Arc::new(metrics::RuntimeMetrics::new(supervisor.release_watcher()));
        Self {
            supervisor,
            door: Mutex::new(None),
            launch: Mutex::new(None),
            metrics,
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

    fn stop_door(&self) {
        // Deliberately no metrics call here: shutting the door is not
        // releasing the model. The sentinel learns of a release only from the
        // server's own announcement, which RuntimeMetrics applies wherever it
        // is next read; a note_unload on door shutdown fired once a second
        // against a stopped server and reset evidence nobody had challenged.
        let door = self.door.lock().ok().and_then(|mut stored| stored.take());
        if let Some(door) = door {
            door.door.shutdown();
        }
    }

    /// Keeps the record of what the walk built, but only for a start the
    /// supervisor took. A refusal means the running server kept its own argv:
    /// overwriting the record would make the panel describe a server nobody
    /// started, and the context guard would defend a plan that never ran.
    fn record_launch(&self, info: startup::LaunchInfo, outcome: StartOutcome) {
        if outcome == StartOutcome::Accepted {
            if let Ok(mut launch) = self.launch.lock() {
                *launch = Some(info);
            }
        }
    }

    fn clear_launch(&self) {
        if let Ok(mut launch) = self.launch.lock() {
            *launch = None;
        }
    }

    fn clear_launch_for_state(&self, state: &ServerState) {
        match state {
            ServerState::Stopped | ServerState::Failed { .. } => self.clear_launch(),
            ServerState::Starting | ServerState::Running { .. } => {}
        }
    }

    fn door_port(&self) -> Option<u16> {
        self.door
            .lock()
            .ok()
            .and_then(|stored| stored.as_ref().map(|active| active.address.port()))
    }

    fn door_connected(&self) -> Option<bool> {
        self.door.lock().ok().map(|stored| {
            stored
                .as_ref()
                .is_some_and(|active| active.door.has_active_connection())
        })
    }

    fn start_door_if_paired(&self, upstream_port: u16, file: &Path) -> Result<(), String> {
        let credential = match kalsa_pairing::store::load(file) {
            Ok(handshake) => handshake.credential_hex(),
            Err(kalsa_pairing::StoreError::Io(error))
                if error.kind() == io::ErrorKind::NotFound =>
            {
                self.stop_door();
                return Ok(());
            }
            Err(_) => {
                self.stop_door();
                return Err("The authenticated door could not read its credential.".to_string());
            }
        };
        let mut stored = self
            .door
            .lock()
            .map_err(|_| "The authenticated door could not start.".to_string())?;
        if stored
            .as_ref()
            .is_some_and(|active| active.credential == credential)
        {
            return Ok(());
        }
        if let Some(old) = stored.take() {
            old.door.shutdown();
        }
        let listener =
            door::bind(file).map_err(|_| "The authenticated door could not bind.".to_string())?;
        let metrics = Arc::clone(&self.metrics);
        let door = kalsa_door::Door::new(listener, upstream_port, credential.clone())
            .map_err(|_| "The authenticated door could not start.".to_string())?
            .with_response_observer(move || {
                let metrics = Arc::clone(&metrics);
                let scanner = Mutex::new(metrics::TimingScanner::new());
                move |bytes| {
                    let rate = scanner
                        .lock()
                        .ok()
                        .and_then(|mut scanner| scanner.feed(bytes));
                    if let Some(rate) = rate {
                        metrics.observe_decode(rate);
                    }
                }
            });
        let running = door
            .start()
            .map_err(|_| "The authenticated door could not start.".to_string())?;
        let address = running.address();
        *stored = Some(ActiveDoor {
            credential,
            address,
            door: running,
        });
        Ok(())
    }

    fn advanced(&self, state_file: &Path) -> options::AdvancedDto {
        let overrides = options::load(state_file);
        let launch = self.launch.lock().ok();
        let active = launch
            .as_ref()
            .and_then(|stored| stored.as_ref())
            .map(|info| (&info.args, info.maximum_context_tokens));
        options::dto(overrides, active, self.door_port())
    }

    fn set_advanced(
        &self,
        state_file: &Path,
        context_tokens: Option<u64>,
        idle_unload_seconds: Option<u32>,
    ) -> Result<options::AdvancedDto, String> {
        let next = options::LaunchOverrides {
            context_tokens,
            idle_unload_seconds,
        };
        next.validate().map_err(str::to_string)?;
        if let Some(maximum) = self
            .launch
            .lock()
            .ok()
            .and_then(|stored| stored.as_ref().and_then(|info| info.maximum_context_tokens))
        {
            if context_tokens.is_some_and(|context| context > maximum) {
                return Err("That context is larger than this model's funded maximum.".to_string());
            }
        }
        options::save(state_file, next)
            .map_err(|_| "The advanced settings could not be saved.".to_string())?;
        Ok(self.advanced(state_file))
    }
}

/// The phone's declaration, from the persisted pairing. Unpaired is a normal
/// state, not an error: the catalog answers it with a refusal the user can
/// act on.
fn phone(app: &tauri::AppHandle) -> Result<Option<kalsa_catalog::PhoneModel>, String> {
    let desk = app.try_state::<Desk>().ok_or_else(|| {
        "The pairing service is not ready. Restarting the computer usually clears it.".to_string()
    })?;
    desk.desk.phone().map_err(|_| {
        "This computer could not read its existing phone connection. Fixing permissions and trying again may help.".to_string()
    })
}

/// The pairing desk and the address its square advertises, made once at
/// startup because the listener's port is what the square has to carry.
/// Absent only when loopback itself could not be bound, which is a machine
/// with no working network stack: the page then has nothing to show, and
/// says so rather than drawing a square nothing can reach.
struct Desk {
    desk: pairing::SharedDesk,
    reachable: String,
    listener: transport::Listener,
    pairing_file: PathBuf,
}

fn pairing_desk(file: PathBuf) -> Result<Desk, Box<dyn std::error::Error>> {
    pairing_desk_with(file, transport::serve)
}

fn pairing_desk_with<S>(file: PathBuf, serve: S) -> Result<Desk, Box<dyn std::error::Error>>
where
    S: FnOnce(pairing::SharedDesk) -> io::Result<transport::Listener>,
{
    let pairing_file = file.clone();
    let desk = Arc::new(pairing::Desk::new(file));
    let listener = serve(desk.clone())?;
    let reachable = listener.address().to_string();
    Ok(Desk {
        desk,
        reachable,
        listener,
        pairing_file,
    })
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StateDto {
    Stopped,
    Starting,
    Running {
        port: u16,
        metrics: metrics::RuntimeMetricsDto,
    },
    /// Already in the user's words, produced only by `failure::words`.
    Failed {
        reason: String,
    },
}

#[tauri::command]
fn brain_state(brain: State<Brain>, desk: State<Desk>) -> StateDto {
    let state = brain.supervisor.state();
    brain.clear_launch_for_state(&state);
    match state {
        ServerState::Running { port, .. } => {
            if brain
                .start_door_if_paired(port, &desk.pairing_file)
                .is_err()
            {
                brain.stop_door();
                desk.desk.stop_serving();
                return StateDto::Failed {
                    reason: "The authenticated door could not start. Trying again usually works."
                        .to_string(),
                };
            }
            let phone_connected = brain.door_connected();
            StateDto::Running {
                port,
                metrics: brain.metrics.snapshot(phone_connected),
            }
        }
        ServerState::Starting => {
            brain.stop_door();
            // The upstream is not ready while it starts, so a pairing square
            // would point at a door that cannot complete a request.
            desk.desk.stop_serving();
            StateDto::Starting
        }
        ServerState::Stopped => {
            brain.stop_door();
            desk.desk.stop_serving();
            StateDto::Stopped
        }
        ServerState::Failed { reason } => {
            brain.stop_door();
            desk.desk.stop_serving();
            StateDto::Failed {
                reason: failure::words(&failure::StartupFailure::Supervisor(reason)),
            }
        }
    }
}

#[tauri::command]
fn brain_advanced(
    app: tauri::AppHandle,
    brain: State<Brain>,
) -> Result<options::AdvancedDto, String> {
    let state_file = state_file(&app)?;
    Ok(brain.advanced(&state_file))
}

#[tauri::command]
fn brain_set_advanced(
    app: tauri::AppHandle,
    brain: State<Brain>,
    context_tokens: Option<u64>,
    idle_unload_seconds: Option<u32>,
) -> Result<options::AdvancedDto, String> {
    let state_file = state_file(&app)?;
    brain.set_advanced(&state_file, context_tokens, idle_unload_seconds)
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
    brain.metrics.reset();
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
    let phone = phone(&app)?;
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
        Ok(Ok((prepared, measured))) => {
            if let Some(measured) = measured {
                if let Ok(mut stored) = brain.measurement.lock() {
                    *stored = Some(measured);
                }
            }
            // The supervisor reports starting, running and its own failures
            // through brain_state; its sentences live in failure too. The
            // record follows the verdict, not the wish: only a start the
            // supervisor took may replace what the panel describes.
            let outcome = brain.supervisor.start(prepared.server).outcome();
            brain.record_launch(prepared.info, outcome);
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
fn brain_stop(brain: State<Brain>, desk: State<Desk>) {
    brain.stop_door();
    brain.clear_launch();
    desk.desk.stop_serving();
    brain.supervisor.stop();
}

/// The Pairing page's one read, polled. A square is only offered while the
/// server is running: a phone that scans one and finds nothing behind it has
/// been lied to, so "not running" is `idle` and the page sends the owner to
/// Status instead.
#[tauri::command]
fn brain_pairing(brain: State<Brain>, desk: State<Desk>) -> pairing::PairingDto {
    let serving = matches!(brain.supervisor.state(), ServerState::Running { .. });
    desk.desk
        .read(serving, &desk.reachable, SystemTime::now())
        .with_door_port(brain.door_port())
}

/// The owner asked for another square. Whatever was in flight is abandoned.
#[tauri::command]
fn brain_pairing_retry(brain: State<Brain>, desk: State<Desk>) {
    let serving = matches!(brain.supervisor.state(), ServerState::Running { .. });
    desk.desk.retry(serving, &desk.reachable, SystemTime::now());
}

/// The owner says the new phone is theirs. The stored credential is replaced;
/// the old phone stops working, which is what replacing means.
#[tauri::command]
fn brain_pairing_replace(brain: State<Brain>, desk: State<Desk>) {
    brain.stop_door();
    desk.desk.decide(true, SystemTime::now());
}

/// The owner says the new phone is not theirs. Nothing is written and the
/// asking phone is dropped.
#[tauri::command]
fn brain_pairing_keep(desk: State<Desk>) {
    desk.desk.decide(false, SystemTime::now());
}

/// The owner explicitly discards an unreadable pairing file. This is the only
/// way out of `StoreUnavailable`; a read error is never silently treated as
/// an unpaired computer.
#[tauri::command]
fn brain_pairing_forget(brain: State<Brain>, desk: State<Desk>) -> Result<(), String> {
    brain.stop_door();
    desk.desk.forget().map_err(|_| {
        "This computer could not forget the old phone connection. Check its permissions and try again."
            .to_string()
    })
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = tauri::Builder::default()
        .manage(Brain::new())
        .invoke_handler(tauri::generate_handler![
            brain_state,
            brain_advanced,
            brain_set_advanced,
            brain_model,
            brain_measured,
            brain_measure,
            brain_start,
            brain_stop,
            brain_pairing,
            brain_pairing_retry,
            brain_pairing_replace,
            brain_pairing_keep,
            brain_pairing_forget
        ])
        .setup(|app| {
            // The desk needs this machine's data directory, and the square
            // needs the listener's port: both are only knowable once the app
            // has a handle, so this is where the pairing side is born.
            let file = app.path().app_data_dir()?.join(PAIRING_FILE);
            if let Some(parent) = file.parent() {
                std::fs::create_dir_all(parent)?;
            }
            // A loopback bind failure is a startup failure, not an empty
            // pairing state: `?` aborts setup and the outer error mapper
            // reports it instead of drawing a QR that cannot work.
            app.manage(pairing_desk(file)?);
            Ok(())
        })
        .build(tauri::generate_context!())
        .map_err(|error| {
            eprintln!("kalsa-brain: pairing service could not start: {error}");
            error
        })?;
    app.run(|app, event| {
        // Take the child with us on the way out, on both exit paths the
        // runtime reports. The platform backstop (job object, pdeathsig)
        // covers the exits that run no handler at all.
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            if let Some(desk) = app.try_state::<Desk>() {
                desk.desk.stop_serving();
                desk.listener.shutdown();
            }
            if let Some(brain) = app.try_state::<Brain>() {
                brain.stop_door();
                brain.supervisor.shutdown();
            }
        }
    });
    Ok(())
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

    #[test]
    fn a_listener_bind_error_aborts_pairing_startup() {
        let result = pairing_desk_with(PathBuf::from("pairing-startup-test.json"), |_| {
            Err(io::Error::other("loopback unavailable"))
        });
        assert_eq!(result.err().unwrap().to_string(), "loopback unavailable");
    }

    #[test]
    fn starting_keeps_the_launch_record_until_the_server_is_running() {
        let brain = Brain::new();
        let args = kalsa_launch::ServerArgs {
            model_path: PathBuf::from("/models/model.gguf"),
            port: startup::PORT,
            context_tokens: 4096,
            threads: Some(4),
            offload: kalsa_launch::Offload::NoGpuBuild,
            idle_unload_seconds: 300,
        };
        if let Ok(mut launch) = brain.launch.lock() {
            *launch = Some(startup::LaunchInfo {
                args,
                maximum_context_tokens: Some(8192),
            });
        }
        brain.clear_launch_for_state(&ServerState::Starting);
        assert!(brain.launch.lock().unwrap().is_some());
        brain.clear_launch_for_state(&ServerState::Stopped);
        assert!(brain.launch.lock().unwrap().is_none());
    }

    #[test]
    fn a_refused_start_never_publishes_its_record() {
        // The second walk of a double start is refused by the supervisor:
        // its argv must not replace the record of the server that kept
        // running, and an accepted start must still publish.
        let brain = Brain::new();
        let running = startup::LaunchInfo {
            args: launch_args("/models/running.gguf", 8137),
            maximum_context_tokens: Some(8192),
        };
        let rejected = startup::LaunchInfo {
            args: launch_args("/models/rejected.gguf", 8138),
            maximum_context_tokens: Some(4096),
        };
        brain.record_launch(running, StartOutcome::Accepted);
        brain.record_launch(rejected, StartOutcome::Refused);
        let launch = brain.launch.lock().unwrap();
        let published = launch.as_ref().expect("an accepted start published");
        assert_eq!(
            published.args.model_path,
            PathBuf::from("/models/running.gguf"),
            "a refused start overwrote the record of the server that runs"
        );
    }

    fn launch_args(model: &str, port: u16) -> kalsa_launch::ServerArgs {
        kalsa_launch::ServerArgs {
            model_path: PathBuf::from(model),
            port,
            context_tokens: 4096,
            threads: Some(4),
            offload: kalsa_launch::Offload::NoGpuBuild,
            idle_unload_seconds: 300,
        }
    }

    #[test]
    fn setting_advanced_values_writes_the_file_used_by_startup() {
        let root =
            std::env::temp_dir().join(format!("kalsa-brain-main-advanced-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let state_file = root.join("server.state");
        let brain = Brain::new();
        let dto = brain.set_advanced(&state_file, Some(2048), None).unwrap();
        let stored = options::load(&state_file);
        assert_eq!(stored.context_tokens, Some(2048));
        assert_eq!(stored.idle_unload_seconds, None);
        assert_eq!(dto.idle_override, None);
        let _ = std::fs::remove_dir_all(root);
    }
}
