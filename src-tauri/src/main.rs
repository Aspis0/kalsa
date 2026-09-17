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
mod road;
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
    /// The second road to the door (iroh). It lives and dies with the door:
    /// opened beside it, closed by `stop_door`. Its failures are the road's
    /// own — the door does not answer for them.
    road: Arc<road::Road>,
    /// One walk at a time: a second press while the first is still deciding,
    /// downloading or starting must not start a second of anything.
    turning_on: AtomicBool,
}

struct ActiveDoor {
    /// The set the running door was built from, kept so the once-a-second
    /// poll can tell "the store still holds what the door serves" from "the
    /// store changed and the door must be rebuilt".
    devices: kalsa_door::Devices,
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
            road: Arc::new(road::Road::new()),
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

    /// The road's public identity, exactly while it is open and announced.
    /// The pairing square carries it only then: advertising a node id while
    /// the switch is off, or while the road is still opening, would promise
    /// a way in that does not exist yet.
    pub(crate) fn road_node_id(&self) -> Option<String> {
        match self.road.snapshot() {
            road::RoadState::Open { node_id } => Some(node_id),
            _ => None,
        }
    }

    fn stop_door(&self) {
        // Deliberately no metrics call here: shutting the door is not
        // releasing the model. The sentinel learns of a release only from the
        // server's own announcement, which RuntimeMetrics applies wherever it
        // is next read; a note_unload on door shutdown fired once a second
        // against a stopped server and reset evidence nobody had challenged.
        // The road dies here too: it pointed at this door and only at this
        // door. A road that outlived its door would carry traffic to a dead
        // listener, and an in-flight attempt would answer to nobody.
        self.road.close();
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

    /// The Model page's read, from the launch record: the catalog's own name
    /// while a catalog-chosen launch stands. A development override
    /// configures a model the catalog never chose, so `chosen` is true with
    /// no name to show.
    fn model_dto(&self) -> ModelDto {
        let display_name = self
            .launch
            .lock()
            .ok()
            .and_then(|stored| stored.as_ref().and_then(|info| info.display_name.clone()));
        ModelDto {
            chosen: model_chosen(display_name.as_deref(), std::env::var(MODEL_ENV).is_ok()),
            display_name,
        }
    }

    fn door_port(&self) -> Option<u16> {
        self.door
            .lock()
            .ok()
            .and_then(|stored| stored.as_ref().map(|active| active.address.port()))
    }

    /// Which devices are being served right now, as the page may see them:
    /// the owner's label and the id, nothing else. No prompt, no path, no
    /// content ever crosses here — the door reports ids, and the only
    /// translation this does is the label the pairing store already gave.
    fn active_devices(&self) -> Option<Vec<metrics::ActiveDeviceDto>> {
        let stored = self.door.lock().ok()?;
        let active = stored.as_ref()?;
        Some(
            active
                .door
                .active_devices()
                .into_iter()
                .map(|id| metrics::ActiveDeviceDto {
                    id: id.value(),
                    label: active
                        .devices
                        .label(id)
                        .map(str::to_owned)
                        // A device draining its last exchange after a removal:
                        // its label left with the set, so the honest name is
                        // the fact, not a placeholder that reads like a bug.
                        .unwrap_or_else(|| "Removed device".to_string()),
                })
                .collect(),
        )
    }

    fn start_door_if_paired(
        &self,
        upstream_port: u16,
        file: &Path,
        internet_road: bool,
    ) -> Result<(), String> {
        // Every stored device travels to the door under its own id and its
        // own label, the identity the store minted when the device paired.
        // An empty set is "not paired" — the same answer the absent file
        // used to get, without an io error to squint at.
        //
        // One un-realizable record refuses the WHOLE set, on purpose: this
        // store never writes one (the pairing ceremony validates the same
        // fields the reader validates), so the trigger is a file this app
        // did not write — a hand edit or another build. Serving the part
        // that parses while the file disagrees with itself would make the
        // door's answer depend on record order; the refusal is honest and,
        // because the desk's escape hatch keys on this same reader, it is
        // recoverable from inside the app.
        let stored_devices = match kalsa_pairing::store::load_devices(file) {
            Ok(devices) if !devices.is_empty() => devices,
            Ok(_) => {
                self.stop_door();
                return Ok(());
            }
            Err(_) => {
                self.stop_door();
                return Err("The authenticated door could not read its credential.".to_string());
            }
        };
        let entries = stored_devices
            .into_iter()
            .map(|device| {
                kalsa_door::DeviceEntry::new(
                    kalsa_door::DeviceId::new(device.id),
                    device.label,
                    device.handshake.credential_hex(),
                )
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "The authenticated door could not read its credential.".to_string())?;
        let devices =
            kalsa_door::Devices::new(entries).map_err(|_| {
                "The authenticated door could not read its credential.".to_string()
            })?;
        let mut stored = self
            .door
            .lock()
            .map_err(|_| "The authenticated door could not start.".to_string())?;
        match stored.as_mut() {
            Some(active) if active.devices == devices => {
                // The door is already the right one — and the switch still
                // governs the road. This poll reads the same file the panel
                // reads; without the reconcile, a switch flipped outside the
                // panel would leave the machine announced while the owner is
                // told the road is off. The address comes from the lock this
                // function already holds.
                let address = active.address;
                self.reconcile_road(internet_road, Some(address), file, false);
            }
            Some(active) => {
                // The set changed; the door did not need to. The new
                // credentials go in place: the listener never rebinds, so
                // pairing a device disturbs no conversation already in
                // flight, and a forgotten device is revoked by the door
                // itself, mid-exchange. The road points at the same bound
                // address — nothing it names stops being served — and the
                // switch still governs it, as on the fast path.
                active.door.set_devices(devices.clone());
                active.devices = devices;
                let address = active.address;
                self.reconcile_road(internet_road, Some(address), file, false);
            }
            None => {
                // No door is running: the one case that truly needs a new
                // listener. (The old take-then-rebuild arm is gone with the
                // behavior that needed it — a set change never lands here.)
                let listener = door::bind(file).map_err(|_| {
                    "The authenticated door could not bind.".to_string()
                })?;
                let metrics = Arc::clone(&self.metrics);
                let door = kalsa_door::Door::new(listener, upstream_port, devices.clone())
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
                    devices,
                    address,
                    door: running,
                });
                // The road opens only while the owner's switch has it on, and
                // toward the address the running door itself reported — never
                // a port reconstructed from elsewhere. A road that cannot open
                // says so in the panel and leaves the door standing.
                if internet_road {
                    road::open(&self.road, address, road::key_path(file));
                }
            }
        }
        Ok(())
    }

    fn advanced(&self, state_file: &Path) -> options::AdvancedDto {
        let overrides = options::load(state_file);
        let launch = self.launch.lock().ok();
        let active = launch
            .as_ref()
            .and_then(|stored| stored.as_ref())
            .map(|info| (&info.args, info.maximum_context_tokens));
        let iroh_sentence = if overrides.internet_road {
            self.road.sentence()
        } else {
            road::OFF_SENTENCE.to_string()
        };
        options::dto(overrides, active, self.door_port(), iroh_sentence)
    }

    fn set_advanced(
        &self,
        state_file: &Path,
        pairing_file: &Path,
        context_tokens: Option<u64>,
        idle_unload_seconds: Option<u32>,
        internet_road: Option<bool>,
    ) -> Result<options::AdvancedDto, String> {
        let kept = options::load(state_file);
        let next = options::LaunchOverrides {
            context_tokens,
            idle_unload_seconds,
            internet_road: internet_road.unwrap_or(kept.internet_road),
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
        options::save(state_file, next)
            .map_err(|_| "The advanced settings could not be saved.".to_string())?;
        // The road switch is one of the settings that can act at once: a
        // door that is up right now opens or closes its second road with
        // the save, not at the next turn-on. A save is a gesture, so a
        // failed road is retried; a poll may not.
        let address = self
            .door
            .lock()
            .ok()
            .and_then(|stored| stored.as_ref().map(|active| active.address));
        self.reconcile_road(next.internet_road, address, pairing_file, true);
        Ok(self.advanced(state_file))
    }

    /// Brings the road in line with the switch, for a door that is up right
    /// now. This is what keeps the panel and the machine from diverging:
    /// the panel reads the same file, so a road left open against a file
    /// that says off would be a machine announced in a public directory
    /// while its owner is told it is off.
    ///
    /// `retry_failed` separates a gesture from a poll: a save that turns
    /// the road on may re-open a road that failed before — the owner acted.
    /// A once-a-second poll may not re-attack a dead relay every second;
    /// the next door restart or save does that.
    fn reconcile_road(
        &self,
        internet_road: bool,
        address: Option<SocketAddr>,
        pairing_file: &Path,
        retry_failed: bool,
    ) {
        match (internet_road, address) {
            (false, _) => self.road.close(),
            (true, Some(address)) => {
                let retryable = match self.road.snapshot() {
                    road::RoadState::Closed => true,
                    road::RoadState::Unavailable => retry_failed,
                    _ => false,
                };
                if retryable {
                    road::open(&self.road, address, road::key_path(pairing_file));
                }
            }
            (true, None) => {}
        }
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
fn brain_state(app: tauri::AppHandle, brain: State<Brain>, desk: State<Desk>) -> StateDto {
    let state = brain.supervisor.state();
    brain.clear_launch_for_state(&state);
    match state {
        ServerState::Running { port, .. } => {
            let internet_road = state_file(&app)
                .map(|path| persisted_internet_road(&path))
                .unwrap_or(false);
            if brain
                .start_door_if_paired(port, &desk.pairing_file, internet_road)
                .is_err()
            {
                brain.stop_door();
                desk.desk.stop_serving();
                // This fails on every poll until the store is cleared, so
                // the sentence must point at the escape hatch, not at a
                // retry that cannot work.
                return StateDto::Failed {
                    reason: "The credential store could not be read, so this computer is not \
                             reachable by any phone. Forgetting the stored pairing on the Pairing \
                             page and pairing again will fix it."
                        .to_string(),
                };
            }
            let active_devices = brain.active_devices();
            StateDto::Running {
                port,
                metrics: brain.metrics.snapshot(active_devices),
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
    internet_road: Option<bool>,
) -> Result<options::AdvancedDto, String> {
    let state_file = state_file(&app)?;
    let pairing_file = pairing_file(&app)?;
    brain.set_advanced(
        &state_file,
        &pairing_file,
        context_tokens,
        idle_unload_seconds,
        internet_road,
    )
}

/// The owner's road switch, as last saved. Read once per poll, alongside
/// the pairing read this branch already does: it is what lets the switch
/// act on a door that is already running.
fn persisted_internet_road(state_file: &Path) -> bool {
    options::load(state_file).internet_road
}

/// Whether the Model page may say a model is configured. Two different
/// facts make it true: a catalog-chosen launch carries its name, and the
/// development override chooses a model without the catalog — so the flag
/// cannot hang off the name alone. A pure decision, so the dev half is
/// testable without setting process-wide environment variables inside a
/// parallel test binary.
fn model_chosen(display_name: Option<&str>, override_env_set: bool) -> bool {
    display_name.is_some() || override_env_set
}

/// Whether a model is configured, and which one when the catalog chose it.
/// `display_name` is the catalog's own human name, built to be shown; the
/// development override configures a model with no catalog choice, so the
/// name is optional and `chosen` stands on its own. A filename never
/// crosses this boundary, because the user has no use for one.
#[derive(Serialize)]
struct ModelDto {
    chosen: bool,
    display_name: Option<String>,
}

#[tauri::command]
fn brain_model(brain: State<Brain>) -> ModelDto {
    brain.model_dto()
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

/// Where the pairing handshake is kept — the same directory the road's
/// node key lives beside.
fn pairing_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|_| {
        "The assistant could not save its place on this computer, so it could not start. Restarting the computer usually clears it.".to_string()
    })?;
    Ok(dir.join(PAIRING_FILE))
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
    let road_node_id = brain.road_node_id();
    desk.desk
        .read(
            serving,
            &desk.reachable,
            road_node_id.as_deref(),
            SystemTime::now(),
        )
        .with_door_port(brain.door_port())
}

/// The owner asked for another square. Whatever was in flight is abandoned.
#[tauri::command]
fn brain_pairing_retry(brain: State<Brain>, desk: State<Desk>) {
    let serving = matches!(brain.supervisor.state(), ServerState::Running { .. });
    let road_node_id = brain.road_node_id();
    desk.desk
        .retry(serving, &desk.reachable, road_node_id.as_deref(), SystemTime::now());
}

/// The owner says the new phone is theirs. The stored credential is replaced;
/// the old phone stops working, which is what replacing means.
/// The owner says a device is no longer part of the house. The others keep
/// their credentials and their ids.
#[tauri::command]
fn brain_pairing_forget_device(desk: State<Desk>, id: u32) -> Result<(), String> {
    desk.desk.forget_device(id).map_err(|_| {
        "This device could not be forgotten. Fixing permissions and trying again may help."
            .to_string()
    })
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
            brain_pairing_forget_device,
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
    use std::time::Duration;

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
    fn the_model_page_reads_the_name_from_the_launch_record() {
        let brain = Brain::new();
        assert_eq!(
            brain.model_dto().display_name,
            None,
            "nothing launched, no name invented"
        );
        brain.record_launch(
            startup::LaunchInfo {
                args: launch_args("/models/chosen.gguf", startup::PORT),
                maximum_context_tokens: Some(8192),
                display_name: Some("IBM Granite 4 Tiny".to_string()),
            },
            StartOutcome::Accepted,
        );
        let dto = brain.model_dto();
        assert_eq!(
            dto.display_name.as_deref(),
            Some("IBM Granite 4 Tiny"),
            "the catalog's own name, not a filename"
        );
        assert!(dto.chosen, "a catalog-chosen launch is chosen");
    }

    #[test]
    fn a_development_override_counts_as_chosen_without_a_catalog_name() {
        // The dev override configures a model the catalog never chose and
        // the launch record cannot name: the page must still say "chosen",
        // which is the override's whole purpose.
        assert!(model_chosen(Some("IBM Granite 4 Tiny"), false));
        assert!(model_chosen(None, true));
        assert!(!model_chosen(None, false), "neither fact, no model");
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
            cache_ram_mib: 0,
            threads: Some(4),
            offload: kalsa_launch::Offload::NoGpuBuild,
            idle_unload_seconds: 300,
        };
        if let Ok(mut launch) = brain.launch.lock() {
            *launch = Some(startup::LaunchInfo {
                args,
                maximum_context_tokens: Some(8192),
                display_name: None,
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
            display_name: None,
        };
        let rejected = startup::LaunchInfo {
            args: launch_args("/models/rejected.gguf", 8138),
            maximum_context_tokens: Some(4096),
            display_name: None,
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
            cache_ram_mib: 0,
            threads: Some(4),
            offload: kalsa_launch::Offload::NoGpuBuild,
            idle_unload_seconds: 300,
        }
    }

    /// A real persisted pairing, the way the phone leaves it, so the door
    /// can be started for real in these tests.
    fn persist_pairing(file: &Path) {
        let now = SystemTime::now();
        let mut pairing = kalsa_pairing::Pairing::offer(
            "http://127.0.0.1:8131",
            None,
            now,
            Duration::from_secs(60),
        )
        .unwrap();
        let payload: serde_json::Value =
            serde_json::from_str(&pairing.qr_payload().unwrap()).unwrap();
        let code = payload["code"].as_str().unwrap();
        let nonce = payload["nonce"].as_str().unwrap();
        assert!(matches!(
            pairing.claim(code, now),
            kalsa_pairing::ClaimResult::Claimed
        ));
        let declaration = kalsa_pairing::PhoneDeclaration::sign(
            code,
            nonce,
            payload["reachable"].as_str().unwrap(),
            None,
            kalsa_catalog::PhoneModel {
                weights_bytes: 1,
                parameters: None,
                measured_tokens_per_second: None,
                battery_powered: None,
            },
        )
        .unwrap();
        let (handshake, _) = pairing.complete(declaration, now).unwrap();
        kalsa_pairing::store::persist(&handshake, file).unwrap();
    }

    /// What llama-server answers behind the door in this test.
    const UPSTREAM_RESPONSE: &[u8] =
        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello";

    /// The canned upstream behind the door in the wiring tests: one response
    /// per connection, stopped and joined on drop, so a failed assert does
    /// not leave a thread spinning behind it.
    struct TestUpstream {
        stop: Arc<AtomicBool>,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl TestUpstream {
        fn start() -> (Self, u16) {
            Self::serve(|mut stream| {
                let _ = std::io::Write::write_all(&mut stream, &UPSTREAM_RESPONSE);
            })
        }

        /// Answers with the same head but a body that arrives in six
        /// 8-byte steps, 40 ms apart: long enough that a test can change
        /// the device set while an answer is genuinely in flight.
        fn slow_start() -> (Self, u16) {
            Self::serve(|mut stream| {
                let _ = std::io::Write::write_all(
                    &mut stream,
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 48\r\nConnection: close\r\n\r\n",
                );
                for _ in 0..6 {
                    std::thread::sleep(Duration::from_millis(40));
                    // `#` never appears in an HTTP head, so the client can
                    // count body bytes by counting the marker.
                    let _ = std::io::Write::write_all(&mut stream, b"########");
                }
            })
        }

        fn serve(answer: impl Fn(std::net::TcpStream) + Send + 'static) -> (Self, u16) {
            let upstream =
                std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
            let port = upstream.local_addr().unwrap().port();
            let stop = Arc::new(AtomicBool::new(false));
            let thread = {
                let stop = Arc::clone(&stop);
                std::thread::spawn(move || {
                    upstream.set_nonblocking(true).unwrap();
                    while !stop.load(Ordering::SeqCst) {
                        match upstream.accept() {
                            Ok((mut stream, _)) => {
                                // macOS inherits the listener's flag on the
                                // accepted socket; the relay is blocking.
                                stream.set_nonblocking(false).unwrap();
                                let mut head = Vec::new();
                                let mut byte = [0u8; 1];
                                loop {
                                    use std::io::Read;
                                    if stream.read(&mut byte).unwrap_or(0) == 0
                                        || (head.push(byte[0]), head.ends_with(b"\r\n\r\n")).1
                                    {
                                        break;
                                    }
                                }
                                answer(stream);
                            }
                            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                                std::thread::sleep(Duration::from_millis(2));
                            }
                            Err(_) => return,
                        }
                    }
                })
            };
            (Self { stop, thread: Some(thread) }, port)
        }
    }

    impl Drop for TestUpstream {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    /// A scratch directory that removes itself — assertions included.
    struct ScratchDir(PathBuf);

    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn scratch_pairing(name: &str) -> (ScratchDir, PathBuf) {
        let directory = std::env::temp_dir().join(format!(
            "kalsa-brain-road-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("pairing.json");
        persist_pairing(&file);
        (ScratchDir(directory), file)
    }

    fn wait_for_road(brain: &Brain, wanted: road::RoadState) {
        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while brain.road.snapshot() != wanted {
            assert!(
                std::time::Instant::now() < deadline,
                "the road never reached {wanted:?}"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn a_road_that_cannot_open_leaves_the_door_serving() {
        // The key path is a directory, so the bridge fails before any
        // network is touched. The road must own that failure — the door
        // keeps standing, and the panel says the road is not available.
        let (_dir, file) = scratch_pairing("failure");
        std::fs::create_dir_all(road::key_path(&file)).unwrap();
        let brain = Brain::new();
        let started = brain.start_door_if_paired(8130, &file, true);
        assert!(
            started.is_ok(),
            "a road failure must not fail the door: {started:?}"
        );
        assert!(brain.door_port().is_some(), "the door must be serving");
        wait_for_road(&brain, road::RoadState::Unavailable);
        assert_eq!(
            brain.road.sentence(),
            "The internet road could not open on this computer. The other roads to it still work."
        );
        brain.stop_door();
        assert!(matches!(brain.road.snapshot(), road::RoadState::Closed));
    }

    #[test]
    fn a_road_turned_off_by_its_switch_stays_closed_while_the_door_serves() {
        // The road exists only while the owner has asked for it: with the
        // switch off, a running door does not open one — and the door keeps
        // serving, because the road was always additive.
        let (dir, file) = scratch_pairing("switch-off");
        let brain = Brain::new();
        let started = brain.start_door_if_paired(8130, &file, false);
        assert!(started.is_ok(), "{started:?}");
        assert!(brain.door_port().is_some(), "the door must be serving");
        std::thread::sleep(Duration::from_millis(50));
        assert!(matches!(brain.road.snapshot(), road::RoadState::Closed));
        // What the owner is told is the switch's own words, not the road's.
        let state_file = dir.0.join("server.state");
        let panel = brain.advanced(&state_file);
        assert!(!panel.internet_road);
        assert_eq!(
            panel.iroh_sentence,
            "The internet road is turned off. The phone reaches this computer the Tailscale way."
        );
    }

    #[test]
    fn a_poll_reconciles_the_road_with_the_switch_the_file_carries() {
        // The file is what the panel reads and what the poll reads: when it
        // says off while the door is up with the road open, the poll must
        // close the road — a machine announced in a public directory while
        // its owner is told the road is off is the one state that may not
        // exist. The switch here is flipped in the file, not through the
        // panel, the way a manual edit or a restore would do it.
        let (dir, file) = scratch_pairing("reconcile");
        let state_file = dir.0.join("server.state");
        let book = kalsa_iroh::AddressBook::new();
        let mut brain = Brain::new();
        brain.road = Arc::new(road::Road::offline(book.clone()));
        brain
            .start_door_if_paired(8130, &file, true)
            .expect("the door starts with the road on");
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !matches!(brain.road.snapshot(), road::RoadState::Open { .. }) {
            assert!(
                std::time::Instant::now() < deadline,
                "the road never opened"
            );
            std::thread::sleep(Duration::from_millis(10));
        }

        options::save(
            &state_file,
            options::LaunchOverrides {
                context_tokens: None,
                idle_unload_seconds: None,
                internet_road: false,
            },
        )
        .expect("flip the switch off in the file");
        let internet_road = persisted_internet_road(&state_file);
        assert!(!internet_road, "the file must carry the switch");
        brain
            .start_door_if_paired(8130, &file, internet_road)
            .expect("the poll still serves the door");
        assert!(
            matches!(brain.road.snapshot(), road::RoadState::Closed),
            "the road stayed open against a file that says off"
        );
    }

    #[test]
    fn a_second_poll_with_the_same_door_does_not_restart_the_road() {
        // start_door_if_paired runs once a second; the road, like the door,
        // must not be torn down and rebuilt by every poll.
        let (_dir, file) = scratch_pairing("idempotent");
        std::fs::create_dir_all(road::key_path(&file)).unwrap();
        let brain = Brain::new();
        brain.start_door_if_paired(8130, &file, true).unwrap();
        wait_for_road(&brain, road::RoadState::Unavailable);
        let before = brain.road.snapshot();
        brain.start_door_if_paired(8130, &file, true).unwrap();
        assert_eq!(
            before,
            brain.road.snapshot(),
            "the same door restarted the road"
        );
        brain.stop_door();
    }

    #[test]
    fn stopping_the_door_closes_the_road() {
        let brain = Brain::new();
        let epoch = brain.road.begin();
        brain.road.finish(epoch, None);
        assert!(matches!(
            brain.road.snapshot(),
            road::RoadState::Unavailable
        ));
        brain.stop_door();
        assert!(
            matches!(brain.road.snapshot(), road::RoadState::Closed),
            "the road outlived its door"
        );
    }

    #[test]
    fn the_road_reaches_the_door_the_app_started() {
        // The full loop, offline: relays disabled, addresses through one
        // in-process book — the crate's own seam, the same way its
        // round-trip test runs. The road attempt goes through the app's own
        // wiring (start_door_if_paired), so a bridge opened toward any
        // address but the running door's own leaves this response unborn.
        let (_dir, file) = scratch_pairing("full-loop");
        let credential = kalsa_pairing::store::load(&file)
            .unwrap()
            .credential_hex();

        // The upstream behind the door: one canned response per connection,
        // stopped and joined with the test whatever way the test ends.
        let (upstream, upstream_port) = TestUpstream::start();

        let book = kalsa_iroh::AddressBook::new();
        let mut brain = Brain::new();
        brain.road = Arc::new(road::Road::offline(book.clone()));
        brain.start_door_if_paired(upstream_port, &file, true).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let node_id = loop {
            match brain.road.snapshot() {
                road::RoadState::Open { node_id } => break node_id,
                road::RoadState::Opening => {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "the road never opened against the running door"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
                other => panic!("the road gave up instead of opening: {other:?}"),
            }
        };

        // The phone side: another bridge sharing the book, dialing the road
        // by its public bytes alone, then speaking HTTP to it — with the
        // door's own credential, so authentication must pass too.
        let client_key = file.with_file_name("client-node.key");
        let client = road::runtime().block_on(async {
            kalsa_iroh::Bridge::start(
                kalsa_iroh::BridgeConfig::new(SocketAddr::from((
                    std::net::Ipv4Addr::LOCALHOST,
                    8131,
                )))
                .with_relay(kalsa_iroh::RelayChoice::Disabled)
                .with_address_book(book),
                &client_key,
            )
            .await
            .expect("a relayless client bridge binds locally")
        });
        let response: Vec<u8> = road::runtime().block_on(async {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let remote = node_id.parse().expect("the node id is 64 hex characters");
            let mut stream = client.connect(remote).await.expect("the tunnel dials");
            let request = format!(
                "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
                 Authorization: Bearer {credential}\r\nContent-Length: 0\r\n\
                 Connection: close\r\n\r\n"
            );
            stream.write_all(request.as_bytes()).await.unwrap();
            stream.shutdown().await.unwrap();
            let mut response = Vec::new();
            tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut response))
                .await
                .expect("the tunnel answer arrived")
                .unwrap();
            response
        });
        assert!(
            response.starts_with(b"HTTP/1.1 200 OK") && response.ends_with(b"hello"),
            "the tunnel did not reach the door the app started: {response:?}"
        );

        brain.stop_door();
        drop(upstream);
        let _ = std::fs::remove_file(&client_key);
    }

    /// A plain HTTP exchange with the door on `port`, using the same
    /// bearer-credential shape the phone uses.
    fn door_response(port: u16, credential: &str) -> Vec<u8> {
        use std::io::{Read, Write};
        let mut stream = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        write!(
            stream,
            "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
             Authorization: Bearer {credential}\r\nContent-Length: 0\r\n\
             Connection: close\r\n\r\n"
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        response
    }

    #[test]
    fn a_set_change_takes_the_new_devices_in_place() {
        // The whole point of the swap: pairing a second device must not
        // kill the door. The proof is an answer IN FLIGHT across the
        // device-set change — a rebuilt door would cut it mid-body, the
        // swap must carry it to its last byte — and then both credentials
        // working through the same listener.
        let (_dir, file) = scratch_pairing("set-swap");
        let (upstream, port) = TestUpstream::slow_start();
        let brain = Brain::new();
        brain.start_door_if_paired(port, &file, false).unwrap();
        let original = kalsa_pairing::store::load(&file).unwrap().credential_hex();
        let newcomer = "cd".repeat(32);

        // A device is mid-answer when the household grows.
        let mut stream =
            std::net::TcpStream::connect(("127.0.0.1", brain.door_port().unwrap())).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        std::io::Write::write_all(
            &mut stream,
            format!(
                "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
                 Authorization: Bearer {original}\r\nContent-Length: 0\r\n\
                 Connection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(80));

        // The same file, now a set of two, written the way the store
        // writes them.
        std::fs::write(
            &file,
            format!(
                r#"{{"v":2,"devices":[
                    {{"id":0,"label":"Paired phone","credential_hex":"{original}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}},
                    {{"id":1,"label":"Second phone","credential_hex":"{newcomer}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}}]}}"#
            ),
        )
        .unwrap();
        brain.start_door_if_paired(port, &file, false).unwrap();

        // The in-flight answer survives the swap, to its last byte.
        let mut answer = Vec::new();
        std::io::Read::read_to_end(&mut stream, &mut answer).unwrap();
        assert_eq!(
            answer.iter().filter(|&&byte| byte == b'#').count(),
            48,
            "the in-flight answer was cut by a set change: the door was rebuilt"
        );

        // And both credentials open the same listener afterwards.
        let door_port = brain.door_port().unwrap();
        let newcomer_response = door_response(door_port, &newcomer);
        assert!(
            newcomer_response.starts_with(b"HTTP/1.1 200 OK"),
            "the added device's credential does not open the door: {}",
            String::from_utf8_lossy(&newcomer_response)
        );
        let original_response = door_response(door_port, &original);
        assert!(
            original_response.starts_with(b"HTTP/1.1 200 OK"),
            "the first device was disturbed by the add: {}",
            String::from_utf8_lossy(&original_response)
        );
        brain.stop_door();
        drop(upstream);
    }

    #[test]
    fn setting_advanced_values_writes_the_file_used_by_startup() {
        let root =
            std::env::temp_dir().join(format!("kalsa-brain-main-advanced-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let state_file = root.join("server.state");
        let brain = Brain::new();
        let pairing = root.join("pairing.json");
        let dto = brain
            .set_advanced(&state_file, &pairing, Some(2048), None, Some(false))
            .unwrap();
        let stored = options::load(&state_file);
        assert_eq!(stored.context_tokens, Some(2048));
        assert_eq!(stored.idle_unload_seconds, None);
        assert_eq!(dto.idle_override, None);
        let _ = std::fs::remove_dir_all(root);
    }
}
