//! The app shell: three pages — status, model, pairing — and the commands
//! they read.
//!
//! All supervision lives in `kalsa-supervisor`; "Turn on" is the walk in
//! `startup`: decide the backend, place the chosen model, start the server —
//! off the main thread, reporting progress, refusing a second press while a
//! walk is still going. Model choice is `kalsa-catalog`'s, downloads are
//! `kalsa-download`'s, and every failure becomes a sentence in `failure`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capability;
#[cfg(test)]
mod contract;
mod door;
mod failure;
mod files;
mod instance;
mod metrics;
mod options;
mod pairing;
mod road;
mod startup;
mod ticker;
mod transport;
mod web;

use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use kalsa_pairing::store::DeviceKind;
use kalsa_probe::{Measurement, ProbeConfig};
use kalsa_supervisor::{ServerState, StartOutcome, Supervisor, Watch};
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
/// The directory, under the data directory, the engine saves a chat's KV
/// state into. The walk creates it (0700) before the launch; the flag is
/// rendered from the path resolved here.
const SLOTS_DIR: &str = "slots";
/// The one window, declared with this label in tauri.conf.json. Lookups
/// go through this constant, so the two can never drift apart silently.
const MAIN_WINDOW_LABEL: &str = "main";

struct Brain {
    supervisor: Supervisor,
    /// The door slot, an `Arc` because the disk tier's timer holds it weakly: the
    /// tick runs on its own thread ([`ticker`]) and must not read a door through
    /// the webview's command. Weak on purpose — the thread watches this slot and
    /// ends with it, and it keeps no app alive to do it.
    door: Arc<Mutex<Option<ActiveDoor>>>,
    launch: Mutex<Option<startup::LaunchInfo>>,
    /// Whether the engine the walk mounted consumes the door's private
    /// headers, read from that engine's own bytes when the start was
    /// accepted. `None` before any start and after a stop: a door built with
    /// no mounted engine declares no support and serves one device.
    engine: Mutex<Option<kalsa_door::EnginePrivateHeaders>>,
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
    /// This computer's own seat, when the store holds one. Kept beside the
    /// set because the door answers only ids and labels, and the page must
    /// not read this computer's own traffic as a phone's.
    host: Option<kalsa_door::DeviceId>,
    address: SocketAddr,
    /// An `Arc` because the timer's thread takes it out of the lock and calls the
    /// door on its own: a save can wait on the engine for ten seconds, and a
    /// synchronous command holding the same lock would freeze the window.
    door: Arc<kalsa_door::RunningDoor>,
}

/// What makes the door's resident map a possible lie: the engine released its
/// model (`--sleep-idle-seconds`, announced on its stderr) or the server
/// FAILED — a crash announces nothing, and this is the observer that acts on
/// it without a poll. `None` is a server with no pipe of ours, and is NOT
/// this: nothing has said its state is gone, and a door born against one
/// starts every slot `Unknown` anyway.
///
/// DECLARED LOSS, the save/warmth side of answering `None` this way: an
/// adopted server announces nothing — its residency cell stays `None` for the
/// life of that server (`kalsa_supervisor::child`) — so an invisible release
/// never reaches this predicate, and every slot the app named AFTER the door
/// was born goes on reading `Resident` in a map nothing relaxes (only the
/// born-`Unknown` door is covered: its first activate drives the restore).
/// Mounting the chat already in such a slot is then the no-op that skips the
/// restore — it returns cold, the warmth the piped server's invalidation
/// buys. The other half of that stale map is CLOSED, not declared: the tick
/// cannot write an emptied slot over the chat's file — `n_saved` 0 renames
/// nothing, and `save_idle`'s `Nothing` arm then relaxes the map to
/// `Unknown` instead of retrying (T4a-fix4, `dbe23b3`). And in the ordinary
/// case no attempt fires at all — the pre-release save already cleared the
/// mark — which is exactly why the cold mount is the half that survives and
/// is written down (docs/PLAN-DISK-TIER.md, T5).
fn engine_lost_its_state(state: &ServerState, asleep: Option<bool>) -> bool {
    matches!(state, ServerState::Failed { .. }) || asleep == Some(true)
}

/// One tick of the disk tier's clock: first what the supervisor says the door
/// may no longer claim — observed HERE, on the ticker's thread, so the
/// invalidation happens whether or not any webview ever polled. `brain_state`
/// reads the same facts, but it is a command the window asks for: with no
/// poll the door, the map and this timer would outlive a dead engine, and
/// `save_idle` would keep writing against it. Then every slot a completion
/// changed that has been quiet long enough. Called by the ticker's thread,
/// never by a command — the save can wait on the engine for `PATIENCE`, and
/// the webview's `brain_state` reads this same lock. The door is taken out of
/// the lock and the lock is released before the call, which is the whole
/// reason it is an `Arc`.
fn tick(door: &Mutex<Option<ActiveDoor>>, watch: &Watch) {
    let lost = engine_lost_its_state(&watch.state(), watch.model_asleep());
    let active = match door.lock() {
        Ok(stored) => stored.as_ref().map(|active| Arc::clone(&active.door)),
        // A panic with the lock in hand poisons it, and `.ok()` used to
        // swallow that and stop the timer in silence, for good. One line, and
        // once: the tick would otherwise print it every second until the app
        // rebuilds the door. Recovering the lock is not this thread's call to
        // make — the state a panic left behind is not known to be whole.
        Err(_) => {
            static POISONED: std::sync::Once = std::sync::Once::new();
            POISONED.call_once(|| {
                eprintln!(
                    "kalsa-brain: the disk tier's timer lost the door to a panicked \
                     thread, so a chat is now saved only when it is switched"
                );
            });
            None
        }
    };
    if let Some(active) = active {
        // Before the save of this same tick: an engine that released its
        // model or died must not be asked to write anything, and no slot it
        // no longer holds may keep claiming a chat.
        if lost {
            active.invalidate_residency();
        }
        active.save_idle(Instant::now());
    }
}

/// The disk tier's numbers as the page receives them: one read of the
/// running door, through the door's own getters. The residents come from the
/// residency map and the capacity from the slots the door built — never from
/// `active_devices` (in-flight requests, 0 at rest) and never from `/props`'
/// `total_slots` (the engine's number, clamped to 1 when it ignores the
/// private headers): three slot numbers can diverge and the panel shows the
/// door's.
fn tier_facts(door: &kalsa_door::RunningDoor) -> metrics::TierDto {
    metrics::TierDto {
        capacity: door.capacity(),
        residents: door.residents(),
        disk: door.disk_usage().map(|scan| metrics::DiskScanDto {
            bytes: scan.bytes,
            files: scan.files,
            unreadable: scan.unreadable,
        }),
    }
}

/// The capacity the door is built with, given the engine it will forward to.
/// An engine that cannot isolate is not asked to: the door serves ONE device
/// rather than refusing to build, so a machine whose engine ignores
/// `X-Kalsa-Slot` (upstream archives, and the Windows rows today) keeps a
/// working single-device door. Clamping here rather than letting the
/// constructor refuse also removes a race: a poll that lands before the
/// inlet probe has finished sees `NotConsumed` and builds a one-device door
/// instead of failing.
fn door_capacity(capacity: u32, engine: kalsa_door::EnginePrivateHeaders) -> u32 {
    match engine {
        kalsa_door::EnginePrivateHeaders::Consumed => capacity,
        kalsa_door::EnginePrivateHeaders::NotConsumed => 1,
    }
}

/// How many hex characters of the model's pinned sha256 name a saved chat's
/// file. The door refuses any other length or case (`Door::with_model_hash`),
/// so this is the app's one truncation and the door is the one validator.
const MODEL_HASH_CHARS: usize = 8;

/// Why the door cannot be given a disk tier, when it is a state the door
/// serves through rather than refuses: the sentence goes on the record.
const NO_LAUNCH_RECORD: &str =
    "the disk tier was not wired: no launch record, so the door cannot name a saved chat";
const NO_MODEL_IDENTITY: &str =
    "the disk tier was not wired: the running model has no catalog identity (a pinned \
     development model), so the door cannot name a saved chat";

/// Why the door is not given a disk tier.
enum DiskTierRefusal {
    /// No launch record, or a model with no catalog identity (the pinned
    /// development path): the door serves WITHOUT the tier, and this sentence
    /// goes on the record. A door without the tier answers both chat routes
    /// with 501, which is exactly why the sentence exists.
    NoIdentity(&'static str),
    /// A digest the door's own constructor refuses. The record is the app's
    /// own, so this is a bug: no door is built rather than one whose chat
    /// routes answer 501 unnamed.
    Malformed,
}

/// The disk tier's three parts, from the record of what was launched.
struct DiskTier {
    /// The first [`MODEL_HASH_CHARS`] hex characters of the catalog row's
    /// pinned sha256.
    model_hash: String,
    /// `--slot-save-path` exactly as the engine received it.
    slot_dir: PathBuf,
    /// How quiet a dirty slot has to be before the app's tick writes it out,
    /// derived from the unload clock *this engine* was launched with — not from
    /// a constant, because the panel can lower that clock to a minute, and an
    /// interval longer than the clock saves a slot the engine has already
    /// released.
    idle_save: Duration,
}

/// The disk tier the door must be built with, from the launch record.
///
/// All three values come from the same record, and none is invented now: the
/// digest is the catalog row's pinned sha256 as the walk that launched this
/// engine recorded it — the one the download already verified, never the
/// weights re-hashed here — the directory is the `--slot-save-path` the engine
/// itself received, so the door reads where the engine writes, and the clock is
/// the `--sleep-idle-seconds` it itself received. `Err` carries why a chat
/// cannot be named; the caller does not then build a door whose two chat routes
/// answer 501 with nobody told.
fn disk_tier(launch: Option<&startup::LaunchInfo>) -> Result<DiskTier, DiskTierRefusal> {
    let info = launch.ok_or(DiskTierRefusal::NoIdentity(NO_LAUNCH_RECORD))?;
    let digest = info
        .model_sha256
        .as_deref()
        .ok_or(DiskTierRefusal::NoIdentity(NO_MODEL_IDENTITY))?;
    let model_hash = digest.get(..MODEL_HASH_CHARS).ok_or(DiskTierRefusal::Malformed)?;
    Ok(DiskTier {
        model_hash: model_hash.to_string(),
        slot_dir: info.args.slot_save_path.clone(),
        idle_save: Duration::from_secs(
            kalsa_launch::idle_save_seconds(info.args.idle_unload_seconds).into(),
        ),
    })
}

impl Brain {
    fn new() -> Self {
        let supervisor = Supervisor::new();
        let metrics = Arc::new(metrics::RuntimeMetrics::new(supervisor.release_watcher()));
        Self {
            supervisor,
            door: Arc::new(Mutex::new(None)),
            launch: Mutex::new(None),
            engine: Mutex::new(None),
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

    /// Keeps what the walk mounted, beside the launch record it explains:
    /// the door's declaration is read from that engine's own bytes, and those
    /// bytes arrived as a download. Gated on the same outcome as
    /// `record_launch` for the same reason — a refused start leaves another
    /// server running, and the record of that server must keep describing
    /// the engine the door is talking to.
    fn record_engine(&self, exe: &Path, outcome: StartOutcome) {
        if outcome == StartOutcome::Accepted {
            if let Ok(mut engine) = self.engine.lock() {
                *engine = Some(door::engine_declaration(exe));
            }
        }
    }

    /// The declaration for the door built now. No mounted engine, or one
    /// whose bytes carry no inlet, means one device: against an engine that
    /// ignores `X-Kalsa-Slot`, several devices are auto-scheduled into the
    /// same slot and the engine's `id_slot % slots.size()` hides it. The door
    /// does not merely refuse that combination — [`door_capacity`] takes the
    /// capacity down to one — so a machine whose engine cannot isolate keeps
    /// working with one device instead of failing to build a door.
    fn engine_headers(&self) -> kalsa_door::EnginePrivateHeaders {
        self.engine
            .lock()
            .ok()
            .and_then(|stored| *stored)
            .unwrap_or(kalsa_door::EnginePrivateHeaders::NotConsumed)
    }

    fn clear_launch(&self) {
        if let Ok(mut launch) = self.launch.lock() {
            *launch = None;
        }
        // The engine goes with it: a stopped server has no mounted engine to
        // read a capability from, and a stale declaration must not outlive
        // the record it belongs to.
        if let Ok(mut engine) = self.engine.lock() {
            *engine = None;
        }
    }

    fn clear_launch_for_state(&self, state: &ServerState) {
        match state {
            // `Stopping` belongs with the two that are down. A stop in
            // flight means this record's engine is being torn down:
            // `brain_stop` already clears the record by hand before it sends
            // anything, and a walk that publishes its record AFTER that clear
            // would otherwise leave a record describing the draining engine.
            // Clearing here makes the state — not the caller's hand — the
            // thing that decides it, and a stale record is exactly what
            // would hand `start_door_if_paired` the capacity and the
            // capability of a server that is going away.
            ServerState::Stopped | ServerState::Failed { .. } | ServerState::Stopping => {
                self.clear_launch()
            }
            ServerState::Starting | ServerState::Running { .. } => {}
        }
    }

    /// The Model page's read, from the launch record: the catalog's own name
    /// while a catalog-chosen launch stands, and the catalog's own reason for
    /// that choice. A development override configures a model the catalog
    /// never chose, so `chosen` is true with no name and no reason to show.
    /// One lock answers both fields.
    fn model_dto(&self) -> ModelDto {
        let launch = self.launch.lock().ok();
        let info = launch.as_deref().and_then(|stored| stored.as_ref());
        let display_name = info.and_then(|info| info.display_name.clone());
        let reason = info.and_then(|info| info.reason.clone());
        ModelDto {
            chosen: model_chosen(display_name.as_deref(), std::env::var(MODEL_ENV).is_ok()),
            display_name,
            reason,
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
                    kind: if Some(id) == active.host {
                        "host"
                    } else {
                        "phone"
                    },
                })
                .collect(),
        )
    }

    /// The disk tier's numbers for the panel, when there is a door to ask:
    /// `None` is "no door", which the page reads as no rows — a missing
    /// number never arrives as a zero.
    fn tier(&self) -> Option<metrics::TierDto> {
        let stored = self.door.lock().ok()?;
        let active = stored.as_ref()?;
        Some(tier_facts(&active.door))
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
            // A store this app cannot read stands the door down — it does
            // not fail the brain, which may be running and answering the
            // local chat with no phone anywhere in the path. The problem
            // stays visible where pairing lives: the Devices page reads the
            // same store every poll and shows StoreUnavailable, with the
            // escape hatch that keys on this same reader.
            Err(_) => {
                self.stop_door();
                return Ok(());
            }
        };
        // The host's id, before the set is consumed: the door reports ids
        // only, so the app is the one place that can still say which id is
        // this computer's own.
        let host = stored_devices
            .iter()
            .find(|device| device.kind == DeviceKind::Host)
            .map(|device| kalsa_door::DeviceId::new(device.id));
        // A waiting phone has no door until the owner allows it: its
        // credential answers the door's ordinary 401, and Allow reaches
        // this same set on the next pass - the path a forget rides.
        let entries = stored_devices
            .into_iter()
            .filter(|device| !device.waiting)
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
        // The door's capacity is the engine's slot count: the same
        // `--parallel` value the launcher rendered, read from the launch
        // record as data. There is no second constant — if the server runs
        // one slot, the door serves one device and refuses the rest rather
        // than let the engine wrap an id onto somebody else's cache. Tests
        // and any path with no launch record yet take the shared default.
        let capacity = self
            .launch
            .lock()
            .ok()
            .and_then(|launch| launch.as_ref().map(|info| info.args.parallel))
            .unwrap_or(kalsa_launch::DEFAULT_PARALLEL);
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
                active.host = host;
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
                // The declaration follows the engine actually mounted, never
                // a constant: this app downloads its engine, so what it can
                // do is a runtime fact.
                let engine = self.engine_headers();
                let capacity = door_capacity(capacity, engine);
                let metrics = Arc::clone(&self.metrics);
                let door = kalsa_door::Door::new_with_engine(
                    listener,
                    upstream_port,
                    devices.clone(),
                    capacity,
                    engine,
                )
                .map_err(|_| "The authenticated door could not start.".to_string())?;
                // The disk tier's two halves, from the record of the engine
                // this door forwards to. A record that cannot name a chat
                // leaves the door serving WITHOUT the tier — the two chat
                // routes then answer 501 — and the line below is why, never
                // silence. The door's own refusal stays as the last line.
                let tier = {
                    let launch = self.launch.lock().ok();
                    disk_tier(launch.as_deref().and_then(|stored| stored.as_ref()))
                };
                let door = match tier {
                    Ok(tier) => match door
                        .with_slot_dir(tier.slot_dir)
                        .with_idle_save(tier.idle_save)
                        .with_model_hash(&tier.model_hash)
                    {
                        Ok(door) => door,
                        // The digest is the app's own record, so one the door
                        // refuses is a bug: no door is built rather than one
                        // that answers a chat route with 501 unnamed.
                        Err(_) => {
                            eprintln!(
                                "kalsa-brain: the launch record's model digest is not eight \
                                 lowercase hex characters; the door was not built"
                            );
                            return Err("The authenticated door could not start.".to_string());
                        }
                    },
                    Err(DiskTierRefusal::NoIdentity(reason)) => {
                        eprintln!("kalsa-brain: {reason}");
                        door
                    }
                    Err(DiskTierRefusal::Malformed) => {
                        eprintln!(
                            "kalsa-brain: the launch record's model digest is shorter than \
                             eight characters; the door was not built"
                        );
                        return Err("The authenticated door could not start.".to_string());
                    }
                };
                let door = door.with_response_observer(move || {
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
                    host,
                    address,
                    door: Arc::new(running),
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
        // No tick in this command: a save can wait on the engine for ten
        // seconds, and this command is the webview's. The tier's clock is
        // [`ticker`]'s own thread.
        Ok(())
    }

    fn advanced(&self, state_file: &Path) -> options::AdvancedDto {
        let overrides = options::load(state_file);
        let launch = self.launch.lock().ok();
        let active = launch.as_ref().and_then(|stored| stored.as_ref());
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
        batch_size: Option<u32>,
        ubatch_size: Option<u32>,
        kv_cache: Option<kalsa_launch::KvCache>,
    ) -> Result<options::AdvancedDto, String> {
        let kept = options::load(state_file);
        let next = options::LaunchOverrides {
            // The model choice is the capability page's, and this panel does
            // not own it: carried through untouched so saving the launch knobs
            // cannot silently un-pick the model.
            model: kept.model.clone(),
            context_tokens,
            idle_unload_seconds,
            batch_size,
            ubatch_size,
            kv_cache,
            internet_road: internet_road.unwrap_or(kept.internet_road),
        };
        // The refusal for a value that breaks the machine carries the numbers,
        // and an out-of-range micro-batch never reaches the file.
        next.validate()?;
        {
            // Scoped so the lock is released before `self.advanced` takes it.
            let launch = self.launch.lock().ok();
            if let Some(info) = launch.as_ref().and_then(|stored| stored.as_ref()) {
                // The guard reads the maximum for the cache being saved, not
                // the one for the cache that happens to be running: choosing
                // f16 and keeping a context only q8_0 could fund must be
                // refused here too.
                let cache = kv_cache.unwrap_or_default();
                if let (Some(context), Some(maximum)) = (
                    context_tokens,
                    info.maximum_context.for_cache(cache),
                ) {
                    if context > maximum {
                        return Err(format!(
                            "That context is larger than the {maximum} tokens this model funds on this computer with the {} cache.",
                            cache.flag()
                        ));
                    }
                }
            }
        }
        let internet_road = next.internet_road;
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
        self.reconcile_road(internet_road, address, pairing_file, true);
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
    /// A stop in flight, `kind: "stopping"`: the page reports the drain
    /// instead of the `Running` the field kept reading until the worker
    /// wrote `Stopped`, and the arm below LOWERS the door — raising it is
    /// the re-raise this state exists to suppress.
    Stopping,
    Running {
        port: u16,
        /// The door's OpenAI-style address, and the only road this page
        /// takes: the desktop is a device with its own credential, exactly
        /// like a phone, so its own conversation gets its own slot and its
        /// own cache. `None` while the door is not up. The engine's own port
        /// is deliberately not offered as a fallback — forwarding there
        /// would be the one conversation in the system with no credential,
        /// no slot and no salt.
        endpoint: Option<String>,
        /// The catalog's own name for what launched — the one model
        /// identity the user is shown. Absent on the development path,
        /// where the developer pinned a file no catalog choice named.
        model: Option<String>,
        /// The catalog's own reason for this launch, in the words built to
        /// be shown as-is. Absent on the development path, where the
        /// developer pinned a file and no catalog choice was made to
        /// explain.
        reason: Option<String>,
        /// Whether the server holds the model in memory right now, as its own
        /// stderr announces it ("... entering sleeping state", "... exiting
        /// sleeping state"). `None` is "not known", never "loaded": a server
        /// adopted from an earlier run is reused without a stderr pipe, so
        /// nothing can announce its release or its reload. An asleep server is
        /// still serving — the door answers and the model comes back on
        /// demand — so this says nothing about `kind`.
        asleep: Option<bool>,
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
            // The door is the phone path, not the brain: if it cannot stand
            // up — a credential store this app cannot read, a listener that
            // would not bind — the brain is still running and says so. The
            // door's problem is reported where the door lives: the Devices
            // page reads the same store every poll and carries the escape
            // hatch. The square comes down either way: advertising a door
            // that cannot complete a request lies to the phone that scans.
            if brain
                .start_door_if_paired(port, &desk.pairing_file, internet_road)
                .is_err()
            {
                brain.stop_door();
                desk.desk.stop_serving();
            }
            let active_devices = brain.active_devices();
            let tier = brain.tier();
            let model = brain.model_dto();
            StateDto::Running {
                port,
                endpoint: brain
                    .door_port()
                    .map(|door_port| format!("http://127.0.0.1:{door_port}/v1")),
                model: model.display_name,
                reason: model.reason,
                asleep: brain.supervisor.model_asleep(),
                metrics: brain.metrics.snapshot(active_devices, tier),
            }
        }
        ServerState::Starting => {
            brain.stop_door();
            // The upstream is not ready while it starts, so a pairing square
            // would point at a door that cannot complete a request.
            desk.desk.stop_serving();
            StateDto::Starting
        }
        ServerState::Stopping => {
            // The drain's arm, and the reason the state exists: this poll
            // must LOWER the door the stop is taking down, never raise it.
            // Before this state the field read `Running` through the whole
            // teardown — the poll is the reconciler — and this is where it
            // re-raised the door the stop had lowered. Lowering is
            // idempotent: `brain_stop` may already have taken the door.
            brain.stop_door();
            // The square points at a door that is going away with the engine.
            desk.desk.stop_serving();
            StateDto::Stopping
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
    Ok(brain.advanced(&state_file).with_desk_port(desk_port(&app)))
}

/// The desk listener's port and whether it is the preferred one, for the
/// panels' Tailscale note: a desk on a fallback port means the owner's
/// standing serve rule points somewhere else, and the note must say so.
/// The desk is managed before any command can run (its startup failure
/// aborts the app), so `None` is the dead-app case, not a live one.
fn desk_port(app: &tauri::AppHandle) -> Option<(u16, bool)> {
    app.try_state::<Desk>()
        .map(|desk| (desk.listener.port(), desk.listener.on_preferred_port()))
}

#[tauri::command]
fn brain_set_advanced(
    app: tauri::AppHandle,
    brain: State<Brain>,
    context_tokens: Option<u64>,
    idle_unload_seconds: Option<u32>,
    internet_road: Option<bool>,
    batch_size: Option<u32>,
    ubatch_size: Option<u32>,
    kv_cache: Option<kalsa_launch::KvCache>,
) -> Result<options::AdvancedDto, String> {
    let state_file = state_file(&app)?;
    let pairing_file = pairing_file(&app)?;
    brain.set_advanced(
        &state_file,
        &pairing_file,
        context_tokens,
        idle_unload_seconds,
        internet_road,
        batch_size,
        ubatch_size,
        kv_cache,
    )
    .map(|dto| dto.with_desk_port(desk_port(&app)))
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
/// `display_name` is the catalog's own human name, built to be shown, and
/// `reason` is the catalog's own sentence for why this one; the development
/// override configures a model with no catalog choice, so both are optional
/// and `chosen` stands on its own. A filename never crosses this boundary,
/// because the user has no use for one.
#[derive(Serialize)]
struct ModelDto {
    chosen: bool,
    display_name: Option<String>,
    reason: Option<String>,
}

/// What this computer can do and what it would run, computed from the kept
/// measurement. Answers `Unmeasured` rather than measuring: measuring takes
/// seconds and belongs to the turn-on walk, which keeps a reliable reading
/// on the way through (`settle_walk`, on the success and the failure arm
/// alike), so this answers `Unmeasured` until the first turn-on, by design.
#[tauri::command]
fn brain_capability(app: tauri::AppHandle, brain: State<Brain>) -> capability::CapabilityDto {
    let measurement = brain
        .measurement
        .lock()
        .ok()
        .and_then(|stored| stored.clone());
    let Some(measurement) = measurement else {
        return capability::CapabilityDto::Unmeasured;
    };
    // An unreadable phone store is not the same fact as an unpaired phone,
    // but the catalog's answer to "no phone" — pair first — is the sentence
    // the owner can act on either way, and it is already written for them.
    let phone = phone(&app).ok().flatten();
    capability::dto(&measurement, startup::ram_bytes(), phone)
}

/// "Turn on": decide the backend, place the chosen model, start the server.
///
/// Returns at once from the window's point of view — the walk runs on a
/// blocking thread and reports progress as `brain_progress` events — but the
/// command's answer is the walk's verdict: `Ok` once the supervisor has been
/// started (the screen then follows `brain_state` through starting to
/// running), or the failure's own words. A second press while a walk is
/// still going is refused, not queued.
/// Remember which model to run, or `None` to let this computer choose again.
///
/// The token is the opaque string `brain_capability` handed the page. It is not
/// resolved here: the next launch resolves it, and a token nothing answers to is
/// ignored there with a sentence — a choice must never be able to stop the walk.
#[tauri::command]
fn brain_choose_model(app: tauri::AppHandle, token: Option<String>) -> Result<(), String> {
    let state_file = state_file(&app)?;
    let mut next = options::load(&state_file);
    next.model = token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    next.validate()?;
    options::save(&state_file, next).map_err(|_| "The choice could not be saved.".to_string())
}

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
    let slot_save_path = slots_dir(&app)?;
    let server_override = std::env::var(SERVER_BIN_ENV).ok().map(PathBuf::from);
    let model_override = std::env::var(MODEL_ENV).ok().map(PathBuf::from);
    let phone = phone(&app)?;
    // How many seats the door must hold: this computer and every paired
    // phone. A seat is reserved per stored device for as long as it is
    // stored, so this is the enrolled set, not who is talking right now.
    let devices = enrolled_devices(&pairing_file(&app)?);
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
        let verdict = startup::run(
            server_override,
            machine,
            phone,
            devices,
            model_override,
            state_file,
            slot_save_path,
            &runtime_root,
            &mut progress,
        )
        .map_err(|failure| failure::words(&failure));
        // The measurement rides the refusal too: a walk that failed still
        // measured a real machine.
        (verdict, measured)
    })
    .await;

    // The walk is over either way; the next press may start again.
    brain.turning_on.store(false, Ordering::SeqCst);

    match outcome {
        Ok(walked) => settle_walk(&brain, walked),
        // The blocking task itself died and nothing came back: nothing to
        // keep, and the standing sentence for it.
        Err(_) => Err("The starting did not finish. Trying again usually works.".into()),
    }
}

/// What the blocking walk hands back: the verdict for the screen, and the
/// measurement it may have made on the way. The measurement rides both arms,
/// because a walk that failed — a phone not paired, nothing that fits, a
/// download lost — still measured a real machine, and measuring is seconds of
/// the owner's time that must not be spent twice for the same refusal.
type Walk = (Result<startup::PreparedStart, String>, Option<Measurement>);

/// Settles the walk: keeps the machine's fact, then answers the walk's. A
/// measurement is a fact about the machine; the verdict is a fact about the
/// catalog, the network or the disk — and the first survives the second. The
/// walk is what measures this machine, so the keeping rule lives here: only
/// a reading the probe itself believes is kept, on the success and the
/// failure arm alike. On the verdict side the supervisor reports starting,
/// running and its own failures through brain_state; the record follows the
/// verdict, not the wish: only a start the supervisor took may replace what
/// the panel describes.
fn settle_walk(brain: &Brain, walked: Walk) -> Result<(), String> {
    if let Some(measured) = walked.1.filter(|m| m.is_reliable()) {
        if let Ok(mut stored) = brain.measurement.lock() {
            *stored = Some(measured);
        }
    }
    match walked.0 {
        Ok(prepared) => {
            // Read the mounted engine's own bytes before the supervisor takes
            // the config: the door's declaration is a property of that
            // binary, not of this build of the shell.
            let engine = prepared.server.exe.clone();
            let outcome = brain.supervisor.start(prepared.server).outcome();
            brain.record_launch(prepared.info, outcome);
            brain.record_engine(&engine, outcome);
            Ok(())
        }
        Err(sentence) => Err(sentence),
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

/// Where the engine writes a chat's saved KV state. Resolved here, under the
/// same data directory as the pairing store; `startup::run` creates and
/// permissions it before the launch, so this function never touches the disk.
fn slots_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|_| {
        "The assistant could not save its place on this computer, so it could not start. Restarting the computer usually clears it.".to_string()
    })?;
    Ok(dir.join(SLOTS_DIR))
}

/// Where the pairing handshake is kept — the same directory the road's
/// node key lives beside.
fn pairing_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|_| {
        "The assistant could not save its place on this computer, so it could not start. Restarting the computer usually clears it.".to_string()
    })?;
    Ok(dir.join(PAIRING_FILE))
}

/// How many devices this computer has taken in — its own record and every
/// paired phone. The door reserves one slot per stored device for as long as
/// the device is stored, so this is a count of seats, not of who is talking:
/// a phone that is away still holds its seat. An unreadable store answers
/// zero, and the plan then keeps the one-slot default rather than promising
/// seats nothing can be built from.
fn enrolled_devices(file: &Path) -> u32 {
    kalsa_pairing::store::load_devices(file)
        .map(|devices| u32::try_from(devices.len()).unwrap_or(u32::MAX))
        .unwrap_or(0)
}

/// This computer's own seat, taken in the same store as the phones. The
/// setup hook calls it before the desk reads the store; the hatch calls it
/// again after emptying the store, so the store is never left host-less.
/// `enrol_host` is idempotent, so every call after the first writes nothing
/// and changes no credential. Split out of the setup hook so the one wiring
/// line a launch runs is the function its tests drive.
fn take_own_seat(file: &Path) -> Result<(), kalsa_pairing::StoreError> {
    kalsa_pairing::store::enrol_host(file).map(|_| ())
}

#[tauri::command]
fn brain_stop(brain: State<Brain>, desk: State<Desk>) {
    // The declaration first, and it is not a formality: `stop` is
    // non-blocking and sets `Stopping` before it queues the command, so from
    // this line on every poll enters the drain's arm and lowers the door
    // itself. Lowering the door first — what this used to do — left the
    // field reading `Running` while the door was already down, and a poll in
    // that gap raised it again.
    brain.supervisor.stop();
    brain.stop_door();
    brain.clear_launch();
    desk.desk.stop_serving();
}

/// The Pairing page's one read, polled. A square is only offered while the
/// server is running: a phone that scans one and finds nothing behind it has
/// been lied to, so "not running" is `idle` and the page sends the owner to
/// Status instead.
#[tauri::command]
fn brain_pairing(brain: State<Brain>, desk: State<Desk>) -> pairing::PairingDto {
    pairing_dto(&brain, &desk)
}

/// The Devices page's read: the desk's own state, plus both ports the owner
/// can point a road at — the door's, and the desk's own listener, which can
/// be the fallback port and so must be read, not assumed.
fn pairing_dto(brain: &Brain, desk: &Desk) -> pairing::PairingDto {
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
        .with_desk_port(Some((
            desk.listener.port(),
            desk.listener.on_preferred_port(),
        )))
}

/// The owner asked for another square. Whatever was in flight is abandoned.
#[tauri::command]
fn brain_pairing_retry(brain: State<Brain>, desk: State<Desk>) {
    let serving = matches!(brain.supervisor.state(), ServerState::Running { .. });
    let road_node_id = brain.road_node_id();
    desk.desk
        .retry(serving, &desk.reachable, road_node_id.as_deref(), SystemTime::now());
}

/// The owner says a device is no longer part of the house. The others keep
/// their credentials and their ids.
#[tauri::command]
fn brain_pairing_forget_device(desk: State<Desk>, id: u32) -> Result<(), String> {
    // This computer's own record has no Forget. The page does not draw the
    // button, and this refuses the call anyway: forgetting the host would
    // take the app's own credential out of the store while the running door
    // still holds it, so the local chat would answer 401 until the next
    // launch minted a fresh key — and with it a fresh cache salt and a cold
    // model. The store can still forget a host (its escape hatch must empty
    // any file); this page's one-device gesture may not.
    if desk.desk.is_host(id) {
        return Err(
            "This computer's own connection cannot be forgotten; it is the key this app uses on this computer."
                .to_string(),
        );
    }
    desk.desk.forget_device(id).map_err(|_| {
        "This device could not be forgotten. Fixing permissions and trying again may help."
            .to_string()
    })
}

/// The owner pressed Allow: the phone that completed its ceremony may now
/// use its credential at the door. Refuse remains the existing forget -
/// this command only flips the record, and the running door learns the new
/// set through the same once-a-second reconcile a forget rides.
#[tauri::command]
fn brain_pairing_allow_device(desk: State<Desk>, id: u32) -> Result<(), String> {
    desk.desk.allow_device(id).map_err(|_| {
        "This device could not be allowed. Fixing permissions and trying again may help."
            .to_string()
    })
}

/// This computer's own credential, for the page's own chat to present at the
/// door. The value is a secret and stays one: it is the command's own answer,
/// never a field of an object some log might render, and it comes from the
/// same store the door was built from, so the page and the door cannot hold
/// two different keys for one machine. The page keeps it in memory for the
/// life of the window; nothing here writes it to settings, and no sentence
/// below echoes it.
///
/// There is deliberately no way to rotate this key alone. The host's row on
/// the Devices page offers no Forget, because forgetting it would take away
/// this app's own way in to its own door; the store-level hatch re-mints it
/// along with every phone, and that is the recovery path if a key is ever
/// suspected of leaking.
#[tauri::command]
fn brain_host_credential(app: tauri::AppHandle) -> Result<String, String> {
    let file = pairing_file(&app)?;
    let devices = kalsa_pairing::store::load_devices(&file)
        .map_err(|_| "This computer could not read its own connection key.".to_string())?;
    devices
        .into_iter()
        .find(|device| device.kind == DeviceKind::Host)
        .map(|device| device.handshake.credential_hex())
        .ok_or_else(|| "This computer has not made its own connection key yet.".to_string())
}

/// The whole store goes, and this computer takes its own seat back in the
/// same breath. Without the re-enrolment the store is host-less afterwards:
/// this computer stops being a device even after a phone is paired again,
/// and the credential the running door held for it exists in no store. A
/// failure to take the seat back is logged, not fatal, for the same reason
/// the startup one is: the store's problem must not become an app that
/// cannot run a model.
fn forget_store_and_keep_own_seat(desk: &pairing::Desk) -> Result<(), String> {
    desk.forget().map_err(|_| {
        "This computer could not forget the old phone connection. Check its permissions and try again."
            .to_string()
    })?;
    if let Err(error) = take_own_seat(desk.file()) {
        eprintln!("kalsa-brain: this computer could not take its own seat back: {error}");
    }
    Ok(())
}

/// The owner explicitly discards an unreadable pairing file. This is the only
/// way out of `StoreUnavailable`; a read error is never silently treated as
/// an unpaired computer.
#[tauri::command]
fn brain_pairing_forget(brain: State<Brain>, desk: State<Desk>) -> Result<(), String> {
    brain.stop_door();
    forget_store_and_keep_own_seat(&desk.desk)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // First statement: claim the knock port. This is convenience, not
    // authority — the binder cannot tell the running app from a stranger
    // on the port, so losing the bind costs this launch nothing; it knocks
    // (which brings the running window forward) and goes on. The authority
    // is the directory lock in the setup hook, the first place the data
    // directory is knowable, taken before anything can read or write the
    // store. Shared with the setup hook, because the hook can outlive this
    // frame: the guard must live as long as the app, not as long as the
    // hook.
    let guard = std::sync::Arc::new(instance::claim());
    let app = tauri::Builder::default()
        .manage(Brain::new())
        .manage(web::WebCalls::default())
        .manage(files::Searches::default())
        .invoke_handler(tauri::generate_handler![
            brain_state,
            brain_advanced,
            brain_set_advanced,
            brain_choose_model,
            brain_capability,
            brain_start,
            brain_stop,
            brain_pairing,
            brain_pairing_retry,
            brain_pairing_forget_device,
            brain_pairing_allow_device,
            brain_pairing_forget,
            brain_host_credential,
            web::brain_web_search,
            web::brain_web_fetch,
            web::brain_web_stop,
            web::brain_open_url,
            files::brain_files_roots,
            files::brain_files_list,
            files::brain_files_read,
            files::brain_files_search
        ])
        .setup({
            let guard = std::sync::Arc::clone(&guard);
            move |app| {
            // The desk needs this machine's data directory, and the square
            // needs the listener's port: both are only knowable once the app
            // has a handle, so this is where the pairing side is born.
            let file = app.path().app_data_dir()?.join(PAIRING_FILE);
            // Not an `if let`: the store below must be unreachable without
            // the lock, not reachable-but-not-today. A path built by join
            // always has a parent.
            let parent = file
                .parent()
                .expect("a path built by join always has a parent");
            std::fs::create_dir_all(parent)?;
            // The authority, before anything below can read or write the
            // store: one exclusive lock on this account's own data
            // directory, held for the app's whole life. A refusal is the
            // ordinary second launch, not a setup error — tauri runs this
            // hook on the event loop's Ready and panics on its Err — so
            // the refusal is handled here: say why, close the windows
            // tauri has already built by the time this hook runs, and let
            // the empty window list end the app by the ordinary exit path.
            let lock = match instance::acquire_dir_lock(parent) {
                Ok(lock) => lock,
                Err(instance::LockFailure::AlreadyRunning) => {
                    eprintln!("Kalsa is already running — its window is coming forward.");
                    for window in app.webview_windows().values() {
                        let _ = window.close();
                    }
                    return Ok(());
                }
                // The machine failing under the app: the lock failure
                // carries the directory and the cause, and that text is
                // what the owner is told.
                Err(failure) => return Err(Box::new(failure)),
            };
            // A duplicate manage returns false and drops the value — the
            // flock would be released under a running app. That is a
            // programming error, and it fails loudly.
            if !app.manage(lock) {
                return Err(io::Error::other("the instance lock was already managed").into());
            }
            // This computer takes its own seat before the desk reads the
            // store: the host is the first device, its own conversation gets
            // a slot and a cache salt like a phone's, and a store that holds
            // the host is never empty — which is what lets the door start on
            // a machine with no phones yet. The desk ignores the host when it
            // asks paired-or-not, so the square still appears for a second
            // device. `enrol_host` is idempotent, so this runs every launch
            // and mints nothing new.
            //
            // A failure here is the store's problem, not a reason to refuse
            // to start: the brain still runs, and the door serves only what
            // is actually stored. What the owner sees depends on the store.
            // An EXISTING file this app cannot read is the desk's
            // StoreUnavailable, whose Devices page carries the one escape
            // hatch, "Forget and pair again". No file at all plus a data
            // directory that cannot be written is the ordinary unpaired
            // computer: the desk reads no file as Idle, the square appears,
            // and the missing host seat has no visible trace anywhere.
            // Refusing to launch would turn a store this app cannot write
            // into a computer whose owner cannot run a model at all.
            if let Err(error) = take_own_seat(&file) {
                eprintln!("kalsa-brain: this computer could not take its own seat: {error}");
            }
            // A pairing-side loopback bind failure is a startup failure,
            // not an empty pairing state: `?` aborts the hook, and tauri
            // turns that into a loud panic on the event loop rather than a
            // QR that cannot work.
            app.manage(pairing_desk(file)?);
            // The disk tier's tick, on a thread of its own and with a `Weak` to
            // the door slot: it runs while this window is an icon — the phone's
            // case, and the one the webview's poll degraded in — and it holds no
            // app alive to do it. A thread that will not start costs the timer
            // and not the tier: a switch still saves. The `Watch` it carries is
            // the supervisor's own state, so a released or dead engine is acted
            // on here whether or not any window ever polls.
            let doors = Arc::downgrade(&app.state::<Brain>().door);
            let watch = app.state::<Brain>().supervisor.watch();
            match ticker::Ticker::start(ticker::PERIOD, move || {
                if let Some(doors) = doors.upgrade() {
                    tick(&doors, &watch);
                }
            }) {
                Ok(ticker) => {
                    app.manage(ticker);
                }
                Err(error) => eprintln!(
                    "kalsa-brain: the disk tier's timer did not start, so a chat is saved \
                     only when it is switched: {error}"
                ),
            }
            // A knock means a second instance was launched: bring this
            // window forward, so the owner sees the app they already have.
            let handle = app.handle().clone();
            guard.watch(move || {
                if let Some(window) = handle.get_webview_window(MAIN_WINDOW_LABEL) {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });
            Ok(())
        }})
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
mod tests;
