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
mod exit;
mod failure;
mod files;
mod first_run;
mod instance;
mod invites;
mod legacy_choice;
mod logging;
mod measurement;
mod metrics;
mod options;
mod pairing;
mod room;
mod room_commands;
mod room_events;
mod room_media;
mod placement;
mod progress;
mod report;
mod road;
mod startup;
mod system;
mod tailnet;
mod tune_step;
mod ticker;
mod transport;
mod ui_event;
mod vision;
mod verified;
mod web;
mod window_visibility;

use std::io;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

use kalsa_pairing::store::DeviceKind;
use kalsa_probe::{Measurement, ProbeConfig};
use kalsa_supervisor::{
    Failure, ServerConfig, StartOutcome, StartSettled, StartWaiter, Supervisor, ServerState, Watch,
};
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

/// Page loads this process has seen: each page load's `Started` event
/// increments it, so the first is the app's own start and every later one a
/// reload of a window that never closed.
static PAGE_LOADS: AtomicU64 = AtomicU64::new(0);

/// The app's brain, managed as an `Arc` so the ticker's thread can hold it
/// weakly: that thread carries the disk tier's tick and the door's reconcile
/// ([`ticker`]), and it must never keep the app alive to do its work.
struct Brain {
    supervisor: Supervisor,
    /// The door slot, an `Arc` because the timer's thread takes it out of the
    /// lock and calls the door on its own — a save can wait on the engine for
    /// seconds, and the tick must not hold the slot's lock across it.
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
    /// True while an install from before the stored choice has its model
    /// checked in the background (`legacy_choice`): the home page waits.
    migrating: Arc<AtomicBool>,
    /// The second road to the door (iroh). It lives and dies with the door:
    /// opened beside it, closed by `stop_door`. Its failures are the road's
    /// own — the door does not answer for them.
    road: Arc<road::Road>,
    /// The pairing desk's bound loopback address — the port the listener
    /// actually bound (it falls back to a random one), never the
    /// preferred-port constant. Set once beside the `Desk` at startup; the
    /// road carries it so the desk lane lands on the socket that serves.
    desk_address: Mutex<Option<SocketAddr>>,
    /// One walk at a time: a second press while the first is still deciding,
    /// downloading or starting must not start a second of anything.
    turning_on: AtomicBool,
    /// The room this computer hosts, opened once beside the pairing store
    /// and shared with the door. `None` when its store could not be opened:
    /// the brain still runs, and the door's room routes answer with the one
    /// honest sentence instead of a room that pretends.
    room: OnceLock<Arc<kalsa_room::Room>>,
    /// The room's event feed stop flag, set by the app's exit path so the
    /// follower thread ends with the window it feeds. Under a mutex so a
    /// second spawn attempt walks away instead of doubling the feed.
    room_events: Mutex<Option<Arc<std::sync::atomic::AtomicBool>>>,
    /// How many Turn offs the owner has asked for. A walk captures it at its
    /// start and re-checks it before each start it makes: a stop taken
    /// mid-walk is never undone by the launch that follows. Crate-visible
    /// because vision's enable is a walk too — it reads the generation
    /// before its download begins and vetoes its own restart with it.
    pub(crate) stops: AtomicU64,
    /// One gate across both sides of that race: the Stop side holds it over
    /// bump+send, the walk side over claim+snapshot and check+send — so on
    /// the channel's FIFO no Turn off can land between a check and its send.
    gate: Mutex<()>,
    /// Whether the PREVIOUS session exited uncleanly (its `running` marker
    /// was still in the data directory at this session's start). Read once
    /// by the crash prompt's command, which clears it in the same breath.
    prev_crash: AtomicBool,
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
                log::warn!(
                    "the disk tier's timer lost the door to a panicked \
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

/// Who is asking the shared reconcile: the one thing its two callers disagree
/// about.
enum DoorCaller<'a> {
    /// The webview's `brain_state` poll. It reads the store once a second
    /// anyway — its raise is also the device-set refresh and the road's
    /// reconcile — and it runs on the event loop's thread, where the exit
    /// handler cannot be executing beside it.
    Poll,
    /// The ticker's thread, carrying the app's exit flag. It pays for a raise
    /// only when no door is up, and the flag gets the last word over a raise
    /// it does make.
    Tick { leaving: &'a AtomicBool },
}

/// The door's reconcile, in one place so the webview's poll and the ticker's
/// thread cannot drift into different doors. The rule is the poll's own: a
/// running engine raises the door through its paired store, and every other
/// state takes the door and the pairing square down — the upstream is not
/// ready while one starts, a drain must never be re-raised, and a stopped or
/// failed engine has nothing to forward to. Lowering is idempotent: `brain_stop`
/// may already have taken the door.
///
/// The ticker's half exists for the start no page ever sees — the window
/// behind a lock screen, a stalled webview — where the engine comes up and the
/// poll that used to be the only raiser never runs, leaving the phone outside
/// a door nobody raised.
///
/// Nothing here reads a file on the ways that change nothing: `state_file` is
/// read on the raise path alone, and `pairing_file` only inside
/// [`Brain::start_door_if_paired`].
fn reconcile_door(
    brain: &Brain,
    desk: &pairing::Desk,
    state: &ServerState,
    pairing_file: &Path,
    state_file: Option<&Path>,
    caller: DoorCaller<'_>,
) {
    let leaving = match caller {
        DoorCaller::Poll => None,
        DoorCaller::Tick { leaving } => Some(leaving),
    };
    // An exit that has begun wins over everything below, and this is the first
    // thing the function reads: the exit sets the flag before it stops
    // anything, so a false read here means a raise below can only land before
    // its stop — never after it.
    if leaving.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
        brain.stop_door();
        desk.stop_serving();
        return;
    }
    match state {
        ServerState::Running { port, .. } => {
            let may_raise = match caller {
                DoorCaller::Poll => true,
                // The battery rule: an open door is left to the poll and to
                // pairing's own allow/forget paths, so a quiet tick reads no
                // store. The slot read below is memory, not a file.
                DoorCaller::Tick { .. } => brain.door_port().is_none(),
            };
            // While a walk is still finishing (its speed check included) the
            // raise is skipped — a door already open stays open.
            if may_raise && door_may_raise(brain.turning_on.load(Ordering::SeqCst)) {
                let raised = brain
                    .start_door_if_paired(
                        *port,
                        pairing_file,
                        state_file.map(persisted_internet_road).unwrap_or(false),
                    )
                    .is_ok();
                // A door that could not stand up — a credential store this app
                // cannot read, a listener that would not bind — is not the
                // brain's problem: the brain is still running and says so, and
                // the door's problem is reported where the door lives, on the
                // Devices page, which reads the same store every poll and
                // carries the escape hatch. The square comes down either way:
                // advertising a door that cannot complete a request lies to
                // the phone that scans.
                //
                // The exit flag is read again here, after the raise: the exit
                // may have begun while the door was being built. A true read
                // means its stop either already ran or is still to come, and
                // lowering now makes the order irrelevant — a shutdown never
                // ends with a door up. A false read means the exit had not
                // begun before this point, so its own stop runs after this
                // raise.
                if !raised || leaving.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
                    brain.stop_door();
                    desk.stop_serving();
                }
            }
        }
        ServerState::Starting => {
            brain.stop_door();
            desk.stop_serving();
        }
        ServerState::Stopping => {
            brain.stop_door();
            desk.stop_serving();
        }
        ServerState::Stopped => {
            brain.stop_door();
            desk.stop_serving();
        }
        ServerState::Failed { .. } => {
            brain.stop_door();
            desk.stop_serving();
        }
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
            desk_address: Mutex::new(None),
            measurement: Mutex::new(None),
            migrating: Arc::new(AtomicBool::new(false)),
            turning_on: AtomicBool::new(false),
            stops: AtomicU64::new(0),
            gate: Mutex::new(()),
            prev_crash: AtomicBool::new(false),
            room: OnceLock::new(),
            room_events: Mutex::new(None),
        }
    }

    /// Claims the single walk and takes the stop generation it races, as
    /// one step with any Turn off (both hold `gate`) — a Stop between the
    /// claim and the snapshot would be absorbed into it. `after_claim` is
    /// the window the test steps into. None when a walk is already going.
    fn begin_walk(&self, after_claim: impl FnOnce()) -> Option<u64> {
        let _gate = self.gate.lock().unwrap_or_else(|e| e.into_inner());
        if self
            .turning_on
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return None;
        }
        after_claim();
        Some(self.stops.load(Ordering::SeqCst))
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

    /// Record the desk's address as its listener bound it — once, beside
    /// the `Desk` itself. `None` until then: no desk lane, which the bridge
    /// refuses rather than misroutes.
    fn set_desk_address(&self, address: SocketAddr) {
        if let Ok(mut desk) = self.desk_address.lock() {
            *desk = Some(address);
        }
    }

    fn desk_address(&self) -> Option<SocketAddr> {
        self.desk_address.lock().ok().and_then(|held| *held)
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
            log::info!("door stopped");
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

    /// The launch record as an owned snapshot: the panel and the vision
    /// command read it outside the lock. `None` before any accepted start
    /// and after a stop, exactly what `model_dto` reads.
    pub(crate) fn launch_record(&self) -> Option<startup::LaunchInfo> {
        self.launch
            .lock()
            .ok()
            .and_then(|stored| stored.as_ref().cloned())
    }

    /// The kept measurement, for the fit question a command asks outside a
    /// walk: the same reading the last walk planned with.
    pub(crate) fn kept_measurement(&self) -> Option<Measurement> {
        self.measurement.lock().ok().and_then(|stored| stored.clone())
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
        let host_credential = stored_devices
            .iter()
            .find(|device| device.kind == DeviceKind::Host)
            .map(|device| device.handshake.credential_hex());
        let mut entries = stored_devices
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
        // The room's AI guest takes its own seat beside the household —
        // derived from this computer's own credential, so the set is the
        // same set every second until the host's own credential changes,
        // and the guest's turns lease the seat like any device instead of
        // borrowing the host's private chat.
        if let Some(host_credential) = host_credential.as_deref() {
            if let Some(guest) = kalsa_door::guest_entry(host_credential) {
                entries.push(guest);
            }
        }
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
                // The room follows the set: a device the owner forgot
                // leaves it the same moment the door stops serving its
                // credential, and one just allowed joins under its label.
                if let (Some(room), Some(host_id)) = (self.room.get(), active.host.or(host)) {
                    room::reconcile(room, host_id, &active.devices, &devices);
                }
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
                let door = match (self.room.get(), host) {
                    (Some(room), Some(host)) => door.with_room(Arc::clone(room), host),
                    _ => door,
                };
                let door = match self.launch.lock().ok().and_then(|launch| {
                    launch
                        .as_ref()
                        .map(|info| info.args.context_tokens / u64::from(info.args.parallel.max(1)))
                }) {
                    Some(per_slot) => door.with_slot_context(per_slot),
                    None => door,
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
                            log::error!(
                                "the launch record's model digest is not eight \
                                 lowercase hex characters; the door was not built"
                            );
                            return Err("The authenticated door could not start.".to_string());
                        }
                    },
                    Err(DiskTierRefusal::NoIdentity(reason)) => {
                        log::warn!("{reason}");
                        door
                    }
                    Err(DiskTierRefusal::Malformed) => {
                        log::error!(
                            "the launch record's model digest is shorter than \
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
                log::info!("door started: {address}, {capacity} seats");
                // The road opens only while the owner's switch has it on, and
                // toward the address the running door itself reported — never
                // a port reconstructed from elsewhere. A road that cannot open
                // says so in the panel and leaves the door standing.
                if internet_road {
                    road::open(
                        &self.road,
                        address,
                        self.desk_address(),
                        road::key_path(file),
                    );
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
        let message = if overrides.internet_road {
            self.road.message()
        } else {
            road::RoadSentence {
                code: "road.off".into(),
                text: road::OFF_SENTENCE.to_string(),
            }
        };
        let iroh_sentence = message.text;
        let dto = options::dto(overrides, active, self.door_port(), iroh_sentence);
        options::with_iroh_code(dto, message.code)
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
                    road::open(
                        &self.road,
                        address,
                        self.desk_address(),
                        road::key_path(pairing_file),
                    );
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

/// A command's failure as the wire carries it: a stable code the webview
/// renders in the owner's language, and the English sentence a phone client
/// or an unknown code still shows. Tauri serializes the rejection payload,
/// so the page receives this object, never prose to parse.
#[derive(Clone, Debug, Serialize)]
struct CommandError {
    code: String,
    #[serde(skip_serializing_if = "serde_json::Value::is_null")]
    params: serde_json::Value,
    text: String,
}

impl From<failure::StartupFailure> for CommandError {
    fn from(failure: failure::StartupFailure) -> Self {
        let message = failure.message();
        Self {
            code: message.code,
            params: message.params,
            text: message.text,
        }
    }
}

impl CommandError {
    fn new(code: &str, text: &str) -> Self {
        Self::coded(code, serde_json::Value::Null, text)
    }

    /// The same refusal carrying the values its sentence names (a byte
    /// size), so the webview can render the figure in the owner's words.
    fn coded(code: &str, params: serde_json::Value, text: &str) -> Self {
        Self {
            code: code.into(),
            params,
            text: text.into(),
        }
    }
}

/// A helper's plain-string rejection is a framework or OS surprise this
/// file never worded: it travels under one generic code, its own text
/// riding as the fallback and the log line, never as a sentence to parse.
impl From<&str> for CommandError {
    fn from(text: &str) -> Self {
        Self::from(text.to_string())
    }
}

impl From<String> for CommandError {
    fn from(text: String) -> Self {
        log::warn!("{text}");
        Self {
            code: "app.unexpected".into(),
            params: serde_json::Value::Null,
            text,
        }
    }
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
        /// What this launch can see, as the chat reads it: the row ships no
        /// projector (`none`), or one the owner has not accepted yet
        /// (`offer`, carrying the download's byte size), or a verified
        /// projector this launch passes (`on`). The chat offers vision from
        /// `offer` and sends images only under `on`.
        vision: crate::vision::VisionState,
        metrics: metrics::RuntimeMetricsDto,
    },
    Failed {
        /// The English sentence, kept for phone clients and logs.
        reason: String,
        /// The stable code the webview renders in the owner's language.
        reason_code: String,
        /// The values that sentence may name (a GB figure).
        reason_params: serde_json::Value,
    },
}

#[tauri::command]
fn brain_state(app: tauri::AppHandle, brain: State<Arc<Brain>>, desk: State<Desk>) -> StateDto {
    let state = brain.supervisor.state();
    brain.clear_launch_for_state(&state);
    reconcile_door(
        &brain,
        &desk.desk,
        &state,
        &desk.pairing_file,
        state_file(&app).ok().as_deref(),
        DoorCaller::Poll,
    );
    match state {
        ServerState::Running { port, .. } => {
            let active_devices = brain.active_devices();
            let tier = brain.tier();
            let model = brain.model_dto();
            let launch = brain.launch_record();
            StateDto::Running {
                port,
                // Absent while the door is not standing. The reconcile above
                // is what decides that; the phone path is not the brain.
                endpoint: brain
                    .door_port()
                    .map(|door_port| format!("http://127.0.0.1:{door_port}/v1")),
                model: model.display_name,
                reason: model.reason,
                asleep: brain.supervisor.model_asleep(),
                vision: crate::vision::state(launch.as_ref()),
                metrics: brain.metrics.snapshot(active_devices, tier),
            }
        }
        ServerState::Starting => StateDto::Starting,
        ServerState::Stopping => StateDto::Stopping,
        ServerState::Stopped => StateDto::Stopped,
        ServerState::Failed { reason } => {
            let message = failure::StartupFailure::Supervisor(reason).message();
            StateDto::Failed {
                reason: message.text,
                reason_code: message.code,
                reason_params: message.params,
            }
        }
    }
}

#[tauri::command]
fn brain_advanced(
    app: tauri::AppHandle,
    brain: State<Arc<Brain>>,
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
    brain: State<Arc<Brain>>,
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
/// alike), so this answers `Unmeasured` only until the first turn-on or
/// until startup seeds a record this machine still matches, by design.
#[tauri::command]
fn brain_capability(
    app: tauri::AppHandle,
    brain: State<Arc<Brain>>,
) -> capability::CapabilityDto {
    if brain.migrating.load(Ordering::SeqCst) {
        return capability::CapabilityDto::Migrating;
    }
    let measurement = brain
        .measurement
        .lock()
        .ok()
        .and_then(|stored| stored.clone());
    // A stored choice is the page's one signal for "past the first run" —
    // readable even with no measurement (a record can be deleted while the
    // choice survives), so it is read before the Unmeasured arm. A token no
    // catalog row answers to reads as no choice: the page owes the owner the
    // first run again, not a choice the walk would refuse. A data dir this
    // run cannot read reads the same way.
    let stored = state_file(&app)
        .ok()
        .and_then(|file| first_run::stored_choice(&file));
    let Some(measurement) = measurement else {
        return capability::CapabilityDto::Unmeasured {
            chosen: stored.is_some(),
        };
    };
    // An unreadable phone store is not the same fact as an unpaired phone,
    // but the catalog's answer to "no phone" — pair first — is the sentence
    // the owner can act on either way, and it is already written for them.
    let phone = phone(&app).ok().flatten();
    // With a measurement the choice is held to the walk's own gate: the row
    // must run here now, or the first run is what the page owes.
    let chosen = capability::chosen_stands(&measurement, startup::ram_bytes(), phone, stored);
    capability::dto(
        &measurement,
        startup::ram_bytes(),
        phone,
        chosen,
        &kalsa_runtime::runtime_root(),
    )
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
fn brain_choose_model(
    app: tauri::AppHandle,
    token: Option<String>,
) -> Result<(), CommandError> {
    let state_file = state_file(&app)?;
    let mut next = options::load(&state_file);
    next.model = token
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    next.validate()?;
    options::save(&state_file, next)
        .map_err(|_| CommandError::new("choice.save_failed", "Kalsa couldn't save this choice. Try again."))
}

/// "Start": measure this computer (a reliable kept measurement stands) and
/// answer with its suggestions, each marked when its file is already here.
/// Nothing is downloaded; the pick stores the choice and `brain_start` walks.
#[tauri::command]
async fn brain_test(
    app: tauri::AppHandle,
    brain: State<'_, Arc<Brain>>,
) -> Result<first_run::Suggestions, CommandError> {
    let Some(_stops_seen) = brain.begin_walk(|| {}) else {
        return Err(CommandError::new(
            "startup.already_starting",
            "Kalsa is already starting. Wait a moment.",
        ));
    };
    let _walk = WalkGuard(&brain);
    let ram_bytes = startup::ram_bytes();
    let runtime_root = kalsa_runtime::runtime_root();
    let state_file = state_file(&app)?;
    let phone = phone(&app)?;
    let record_dir = app.path().app_data_dir().ok();
    let emitter = app.clone();
    let kept = brain
        .measurement
        .lock()
        .ok()
        .and_then(|stored| stored.clone())
        .filter(|measurement| measurement.is_reliable());
    if kept.is_none() {
        let reading = tauri::async_runtime::spawn_blocking(move || {
            let _ = emitter.emit("brain_progress", startup::Progress::Measuring);
            let measurement = kalsa_probe::measure_reliable(&ProbeConfig::default());
            (measurement, measurement::now_unix(SystemTime::now()), ram_bytes)
        })
        .await
        .map_err(|_| {
            CommandError::new(
                "startup.check_failed",
                "Kalsa couldn't check this computer. Wait a moment and try again.",
            )
        })?;
        keep_measurement(&brain, Some(reading), record_dir.as_deref());
    }
    let measurement = brain
        .measurement
        .lock()
        .ok()
        .and_then(|stored| stored.clone())
        .ok_or_else(|| {
            CommandError::new(
                "startup.check_failed",
                "Kalsa couldn't check this computer. Wait a moment and try again.",
            )
        })?;
    let chosen = first_run::stored_choice(&state_file).is_some();
    let capability::CapabilityDto::Measured {
        model,
        quicker,
        refusal,
        ..
    } = capability::dto(&measurement, ram_bytes, phone, chosen, &runtime_root)
    else {
        return Err(failure::StartupFailure::MachineNotMeasured.into());
    };
    let entries = unique_rows(
        [model, quicker]
            .into_iter()
            .flatten()
            .filter_map(|option| option.id.as_deref().and_then(startup::row_for_token))
            .collect(),
    );
    tauri::async_runtime::spawn_blocking(move || first_run::suggest(entries, refusal, &runtime_root))
        .await
        .map_err(|_| {
            CommandError::new(
                "startup.check_failed",
                "Kalsa couldn't check this computer. Wait a moment and try again.",
            )
        })
}

#[tauri::command]
async fn brain_start(
    app: tauri::AppHandle,
    brain: State<'_, Arc<Brain>>,
) -> Result<(), CommandError> {
    walk_and_settle(&app, &brain).await
}

/// The walk `brain_start` runs: claim the single walk, then run [`settle`]
/// — the same body vision's restart runs on a claim of its own, so an
/// accept and a Turn on are one kind of walk, never two ways to start.
pub(crate) async fn walk_and_settle(
    app: &tauri::AppHandle,
    brain: &Brain,
) -> Result<(), CommandError> {
    let state_file = state_file(app)?;
    let server_override = std::env::var(SERVER_BIN_ENV).ok().map(PathBuf::from);
    let model_override = std::env::var(MODEL_ENV).ok().map(PathBuf::from);
    first_run::require_choice(&state_file, server_override.is_some() || model_override.is_some())
        .map_err(CommandError::from)?;
    let Some(stops_seen) = brain.begin_walk(|| {}) else {
        return Err(CommandError::new(
            "startup.already_starting",
            "Kalsa is already starting. Wait a moment.",
        ));
    };
    // Every `?` below returns through this: the claim (and the door's
    // raise) must not stay stuck behind a fallible call.
    let _walk = WalkGuard(brain);
    settle(app, brain, state_file, stops_seen).await
}

/// The walk's body once the single-walk claim is held: the measurement,
/// the walk itself and the settlement, all disciplined by `stops_seen`.
/// The generation is the CALLER'S — a Turn on passes the one its own claim
/// took; vision's restart passes the one taken before the projector
/// download began, so a Turn off that landed while the bytes moved is
/// still caught by every check below (`queue_start`'s above all). No
/// `require_choice` here: the restart re-runs a model that already chose,
/// including one the automatic path picked for the owner.
pub(crate) async fn settle(
    app: &tauri::AppHandle,
    brain: &Brain,
    state_file: PathBuf,
    stops_seen: u64,
) -> Result<(), CommandError> {
    brain.metrics.reset();
    let server_override = std::env::var(SERVER_BIN_ENV).ok().map(PathBuf::from);
    let model_override = std::env::var(MODEL_ENV).ok().map(PathBuf::from);
    let kept = brain
        .measurement
        .lock()
        .ok()
        .and_then(|stored| stored.clone());
    let ram_bytes = startup::ram_bytes();
    let runtime_root = kalsa_runtime::runtime_root();
    let slot_save_path = slots_dir(app)?;
    let phone = phone(app)?;
    // How many seats the door must hold: this computer and every paired
    // phone. A seat is reserved per stored device for as long as it is
    // stored, so this is the enrolled set, not who is talking right now.
    let devices = enrolled_devices(&pairing_file(app)?);
    let emitter = app.clone();

    let outcome = tauri::async_runtime::spawn_blocking(move || {
        // Every reading the walk makes on its way to the page — the runtime
        // build, the weights, the drafter, the tune — passes this one gate:
        // a download reports per chunk, and the page gets a bounded handful
        // of events a second instead. See `progress`.
        let mut gate = progress::Gate::new();
        let mut progress = |step: startup::Progress| {
            if gate.allows(&step, Instant::now()) {
                let _ = emitter.emit("brain_progress", step);
            }
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
                // Stamped at the probe's finish, on the walk's own clock:
                // the record's age must count from the measurement, not
                // from the save that may follow minutes of download.
                let taken_unix = measurement::now_unix(SystemTime::now());
                (
                    startup::Machine {
                        measurement: measurement.clone(),
                        ram_bytes,
                    },
                    Some((measurement, taken_unix, ram_bytes)),
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
        .map_err(CommandError::from);
        // The measurement rides the refusal too: a walk that failed still
        // measured a real machine.
        (verdict, measured)
    })
    .await;

    let record_dir = app.path().app_data_dir().ok();
    match outcome {
        Ok(walked) => settle_walk(brain, walked, record_dir.as_deref(), stops_seen),
        // The blocking task itself died and nothing came back: nothing to
        // keep, and the standing sentence for it.
        Err(_) => Err(CommandError::new(
            "startup.could_not_start",
            "Kalsa couldn't start. Try again.",
        )),
    }
}

/// What the blocking walk hands back: the verdict for the screen, and —
/// when it measured — the reading beside the facts that make it a record:
/// the instant the probe finished (stamped where the probe returned, not
/// where the record is written minutes of download later) and the RAM the
/// measured `Machine` was built with.
type Walk = (
    Result<startup::PreparedStart, CommandError>,
    Option<(Measurement, u64, u64)>,
);

/// Settles the walk: keeps the machine's fact, then answers the walk's. A
/// measurement is a fact about the machine; the verdict is a fact about the
/// catalog, the network or the disk — and the first survives the second. The
/// walk is what measures this machine, so the keeping rule lives here: only
/// a reading the probe itself believes is kept, on the success and the
/// failure arm alike. On the verdict side the supervisor reports starting,
/// running and its own failures through brain_state; the record follows the
/// verdict, not the wish: only a start the supervisor took may replace what
/// the panel describes.
fn settle_walk(
    brain: &Brain,
    walked: Walk,
    record_dir: Option<&Path>,
    stops_seen: u64,
) -> Result<(), CommandError> {
    keep_measurement(brain, walked.1, record_dir);
    match walked.0 {
        Ok(mut prepared) => {
            // The plan's own launch, kept before the tuned one goes up: the
            // config the single retry uses if the tuned one cannot load.
            let rule = prepared.rule_launch.clone();
            let tuned_changed = rule.as_ref().is_some_and(|(config, _)| {
                config.argv != prepared.server.argv || config.exe != prepared.server.exe
            });
            let waiter = match queue_start(brain, stops_seen, prepared.server.clone(), || ()) {
                // A Turn off landed while the tune ran: nothing starts here.
                Some(waiter) => waiter,
                None => return Ok(()),
            };
            let mut outcome = waiter.outcome();
            // The verdict answers before the handshake; the settle is THIS
            // start's own report after it.
            let settled = (outcome == StartOutcome::Accepted)
                .then(|| waiter.settle())
                .flatten();
            let mut last = settled.clone();
            if let Some(relaunch) =
                attempt_retry(brain, stops_seen, settled.clone(), tuned_changed, rule)
            {
                (outcome, last) = adopt_relaunch(&mut prepared, relaunch);
            }
            // A graphics launch that still did not come up — a driver that
            // crashes or hangs at model load — hands the slot, once, to the
            // processor launch the tune prepared beside it: a start the
            // card cannot serve must not be a start that fails.
            let processor = prepared.processor.clone();
            let processor_differs = processor.as_ref().is_some_and(|(config, _)| {
                config.argv != prepared.server.argv || config.exe != prepared.server.exe
            });
            if let Some(relaunch) =
                attempt_retry(brain, stops_seen, last, processor_differs, processor)
            {
                outcome = adopt_relaunch(&mut prepared, relaunch).0;
            }
            // The per-start speed check, still inside the walk: while the
            // walk holds `turning_on` no NEW door raise happens — one
            // already open stays open.
            if matches!(settled, Some(StartSettled::Up)) {
                let restart =
                    |config: ServerConfig| restart_after_check(brain, stops_seen, config);
                match speed_check(
                    &mut prepared,
                    |addr| kalsa_tune::checked_rate(addr, kalsa_tune::CHECK_TIMEOUT),
                    || brain.supervisor.stop(),
                    restart,
                ) {
                    CheckResult::Kept => {}
                    CheckResult::Launched(checked_outcome) => outcome = checked_outcome,
                    // Nothing is running; there is nothing to record.
                    CheckResult::Down => return Ok(()),
                }
                if brain.stops.load(Ordering::SeqCst) != stops_seen {
                    // A Turn off during the check: the walk records nothing.
                    return Ok(());
                }
            }
            // The door declares the bytes of what actually launched — the
            // rule's, after a retry.
            let engine = prepared.server.exe.clone();
            brain.record_launch(prepared.info, outcome);
            brain.record_engine(&engine, outcome);
            Ok(())
        }
        Err(message) => Err(message),
    }
}

/// Keeps the walk's measurement, under the rule that only a reading the
/// probe itself believes survives: written down beside the kept copy (a
/// record the disk refuses costs the next launch one re-measurement — it
/// is logged, never fatal) and stored for `brain_capability` until then.
fn keep_measurement(
    brain: &Brain,
    measured: Option<(Measurement, u64, u64)>,
    record_dir: Option<&Path>,
) {
    let Some((measured, taken_unix, ram_bytes)) =
        measured.filter(|(measured, _, _)| measured.is_reliable())
    else {
        return;
    };
    if let Some(dir) = record_dir {
        measurement::save(&measured, dir, taken_unix, ram_bytes);
    }
    if let Ok(mut stored) = brain.measurement.lock() {
        *stored = Some(measured);
    }
}

/// Releases the single-walk claim when dropped — the fallible calls
/// between the claim and the settlement all return through `?`, and the
/// door raises only once `turning_on` is false.
struct WalkGuard<'a>(&'a Brain);

impl Drop for WalkGuard<'_> {
    fn drop(&mut self) {
        self.0.turning_on.store(false, Ordering::SeqCst);
    }
}

/// Whether this poll may raise the door: never while a walk is still
/// finishing (its speed check must not share a slot with a chat). A door
/// already open stays open — this only skips the raise.
fn door_may_raise(walk_in_progress: bool) -> bool {
    !walk_in_progress
}

/// The retry's question: did the tuned start fail the way the rule's
/// launch could fix — not ready, exited while loading, or the exe vanished
/// — and did the tune change the launch at all? No answer counts as "no".
fn retry_after(settled: Option<StartSettled>, tuned_changed: bool) -> bool {
    tuned_changed
        && matches!(
            settled,
            Some(StartSettled::Failed(
                Failure::NotReady { .. }
                    | Failure::ServerExited { .. }
                    | Failure::ServerNotStarted { .. }
            ))
        )
}

/// Queues one start — never one the owner already turned off: `stops_seen`
/// is the generation the walk captured at its beginning, and any Turn off
/// since then must not be undone by a launch that follows it. The check and
/// the send are one step under `gate`, so a Stop's bump+send cannot land
/// between them; `between` is the window the test steps into.
fn queue_start(
    brain: &Brain,
    stops_seen: u64,
    config: ServerConfig,
    between: impl FnOnce(),
) -> Option<StartWaiter> {
    let _gate = brain.gate.lock().unwrap_or_else(|e| e.into_inner());
    if brain.stops.load(Ordering::SeqCst) != stops_seen {
        return None;
    }
    between();
    Some(brain.supervisor.start(config))
}

/// The relaunch decision and its gate in one place: a load failure of the
/// launch that just ran queues the next config — the rule's after a tuned
/// launch, the processor's after a graphics one — unless a Turn off arrived
/// while that failure was being decided. `changed` says the next config is
/// not the one that failed.
fn attempt_retry(
    brain: &Brain,
    stops_seen: u64,
    settled: Option<StartSettled>,
    tuned_changed: bool,
    rule: Option<(ServerConfig, kalsa_launch::ServerArgs)>,
) -> Option<(StartWaiter, ServerConfig, kalsa_launch::ServerArgs)> {
    if !retry_after(settled, tuned_changed) {
        return None;
    }
    let (config, args) = rule?;
    let waiter = queue_start(brain, stops_seen, config.clone(), || ())?;
    Some((waiter, config, args))
}

/// Waits out a relaunch and makes the record describe what now runs: the
/// failed launch's tune record is dropped (best effort — a delete that fails
/// leaves it, and the next start fails and relaunches the same way) and the
/// args and config are the relaunch's. Returns the relaunch's own verdict and
/// settle; the settle is awaited here so the walk's guard outlives it.
fn adopt_relaunch(
    prepared: &mut startup::PreparedStart,
    (waiter, config, args): (StartWaiter, ServerConfig, kalsa_launch::ServerArgs),
) -> (StartOutcome, Option<StartSettled>) {
    if let Some(model_digest) = prepared.info.model_sha256.as_deref() {
        kalsa_tune::record::invalidate(&kalsa_runtime::runtime_root(), model_digest);
    }
    let outcome = waiter.outcome();
    let settled = (outcome == StartOutcome::Accepted)
        .then(|| waiter.settle())
        .flatten();
    prepared.info.args = args;
    prepared.info.tune = None;
    prepared.server = config;
    (outcome, settled)
}

/// Half the recorded best: below it this start is not the launch the record
/// measured, and the processor candidate deserves the slot.
fn worth_switching(checked: f64, recorded: f64) -> bool {
    checked < recorded * 0.5
}

/// A restart the check makes: the same gate as the walk's own start, so a
/// Turn off between the graphics stop and this queue is never undone.
fn restart_after_check(
    brain: &Brain,
    stops_seen: u64,
    config: ServerConfig,
) -> Option<(StartOutcome, Option<StartSettled>)> {
    let waiter = queue_start(brain, stops_seen, config, || ())?;
    let outcome = waiter.outcome();
    Some((outcome, waiter.settle()))
}

/// What the check did: the launch stands as it was; a new launch to
/// record; or nothing running at all (the walk records nothing).
#[derive(Debug, PartialEq)]
pub(crate) enum CheckResult {
    Kept,
    Launched(StartOutcome),
    Down,
}

/// The per-start speed check: a graphics winner — record hit or fresh
/// tune, both end in `Tune::Measured` — answers one short request, and
/// under half its recorded best it hands the slot to the processor
/// candidate. The record is never invalidated: the pressure is transient
/// and the next start checks again.
pub(crate) fn speed_check(
    prepared: &mut startup::PreparedStart,
    rate: impl FnOnce(SocketAddr) -> kalsa_tune::Answer,
    stop: impl FnOnce(),
    mut start: impl FnMut(ServerConfig) -> Option<(StartOutcome, Option<StartSettled>)>,
) -> CheckResult {
    let Some(tune_step::Tune::Measured(record)) = prepared.info.tune.as_ref() else {
        return CheckResult::Kept;
    };
    let Some(winner) = &record.winner else {
        return CheckResult::Kept;
    };
    if !matches!(
        winner.candidate.offload,
        kalsa_launch::Offload::All | kalsa_launch::Offload::EngineFitted
    ) {
        return CheckResult::Kept;
    }
    let recorded = winner.reply.decode_rate;
    let checked = match rate(SocketAddr::from(([127, 0, 0, 1], prepared.server.port))) {
        kalsa_tune::Answer::Rate(rate) => Some(rate),
        // Under ~1 tok/s: the check never came back.
        kalsa_tune::Answer::Timeout => None,
        kalsa_tune::Answer::Failed => {
            // An HTTP error, an unusable body or a rejected timing says
            // nothing about speed: this launch stands, and the line says
            // the check itself failed.
            prepared.info.checked = Some(tune_step::checked_line(
                None,
                recorded,
                tune_step::Checked::Failed,
            ));
            return CheckResult::Kept;
        }
    };
    if !checked.is_none_or(|rate| worth_switching(rate, recorded)) {
        prepared.info.checked = Some(tune_step::checked_line(
            checked,
            recorded,
            tune_step::Checked::Kept,
        ));
        return CheckResult::Kept;
    }
    let Some((processor_config, processor_args)) = prepared.processor.clone() else {
        prepared.info.checked = Some(tune_step::checked_line(
            checked,
            recorded,
            tune_step::Checked::NoProcessor,
        ));
        return CheckResult::Kept;
    };
    let graphics = prepared.server.clone();
    stop();
    match start(processor_config.clone()) {
        // A Turn off landed during the check: nothing may start.
        None => CheckResult::Down,
        Some((outcome, Some(StartSettled::Up))) => {
            prepared.server = processor_config;
            // The panel's "In force" must describe what runs: the
            // processor's own threads and offload.
            prepared.info.args = processor_args;
            prepared.info.checked = Some(tune_step::checked_line(
                checked,
                recorded,
                tune_step::Checked::Switched,
            ));
            CheckResult::Launched(outcome)
        }
        // The processor start failed: the graphics launch, once — slow
        // beats nothing.
        Some(_) => match start(graphics.clone()) {
            Some((outcome, Some(StartSettled::Up))) => {
                prepared.server = graphics;
                prepared.info.checked = Some(tune_step::checked_line(
                    checked,
                    recorded,
                    tune_step::Checked::StillGraphics,
                ));
                CheckResult::Launched(outcome)
            }
            // Both down: the line must not claim either launch stands.
            Some(_) => {
                prepared.info.checked = Some(tune_step::checked_line(
                    checked,
                    recorded,
                    tune_step::Checked::Down,
                ));
                CheckResult::Down
            }
            None => CheckResult::Down,
        },
    }
}

/// Where this instance announces itself. It is locked while our server runs and
/// the lock is inherited by the server, so the next start can tell our own
/// orphan from somebody else's program instead of guessing from a pid.
pub(crate) fn state_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
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
fn brain_stop(brain: State<Arc<Brain>>, desk: State<Desk>) {
    // `stop` is non-blocking and sets `Stopping` before it queues, so every
    // poll from here reads the drain — never `Running` behind a lowered door.
    {
        let _gate = brain.gate.lock().unwrap_or_else(|e| e.into_inner());
        brain.stops.fetch_add(1, Ordering::SeqCst);
        brain.supervisor.stop();
    }
    brain.stop_door();
    brain.clear_launch();
    desk.desk.stop_serving();
}

/// The Pairing page's one read, polled. A square is only offered while the
/// server is running: a phone that scans one and finds nothing behind it has
/// been lied to, so "not running" is `idle` and the page sends the owner to
/// Status instead.
#[tauri::command]
async fn brain_pairing(
    brain: State<'_, Arc<Brain>>,
    desk: State<'_, Desk>,
) -> Result<pairing::PairingDto, String> {
    Ok(pairing_dto(&brain, &desk).await)
}

/// The tailnet URL a square made right now would carry, or `None`. Read off
/// the CLI fresh — nothing cached, the ports passed in every time — on a
/// blocking thread under the detection's own short deadline, so neither
/// command that draws a square waits on it or fails by it.
async fn tailnet_now(brain: &Brain, desk: &Desk) -> Option<String> {
    let door_port = brain.door_port();
    let desk_port = desk.listener.port();
    tauri::async_runtime::spawn_blocking(move || tailnet::detect(door_port, desk_port))
        .await
        .ok()
        .flatten()
}

/// The Devices page's read: the desk's own state, plus both ports the owner
/// can point a road at — the door's, and the desk's own listener, which can
/// be the fallback port and so must be read, not assumed.
async fn pairing_dto(brain: &Brain, desk: &Desk) -> pairing::PairingDto {
    let serving = matches!(brain.supervisor.state(), ServerState::Running { .. });
    let road_node_id = brain.road_node_id();
    let tailnet = tailnet_now(brain, desk).await;
    desk.desk
        .read(
            serving,
            &desk.reachable,
            road_node_id.as_deref(),
            tailnet.as_deref(),
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
async fn brain_pairing_retry(
    brain: State<'_, Arc<Brain>>,
    desk: State<'_, Desk>,
) -> Result<(), String> {
    let serving = matches!(brain.supervisor.state(), ServerState::Running { .. });
    let road_node_id = brain.road_node_id();
    let tailnet = tailnet_now(&brain, &desk).await;
    desk.desk.retry(
        serving,
        &desk.reachable,
        road_node_id.as_deref(),
        tailnet.as_deref(),
        SystemTime::now(),
    );
    Ok(())
}

/// The owner says a device is no longer part of the house. The others keep
/// their credentials and their ids.
#[tauri::command]
fn brain_pairing_forget_device(
    desk: State<Desk>,
    brain: State<Arc<Brain>>,
    id: u32,
) -> Result<(), CommandError> {
    // This computer's own record has no Forget. The page does not draw the
    // button, and this refuses the call anyway: forgetting the host would
    // take the app's own credential out of the store while the running door
    // still holds it, so the local chat would answer 401 until the next
    // launch minted a fresh key — and with it a fresh cache salt and a cold
    // model. The store can still forget a host (its escape hatch must empty
    // any file); this page's one-device gesture may not.
    if desk.desk.is_host(id) {
        // Unreachable from the page — the host row draws no Forget — and
        // kept as a coded refusal for defense in depth and the log.
        log::warn!("a forget reached the host record ({id})");
        return Err(CommandError::new(
            "pairing.host_forget",
            "This computer's own connection cannot be forgotten.",
        ));
    }
    desk.desk.forget_device(id).map_err(|_| {
        CommandError::new(
            "pairing.save_failed",
            "Kalsa couldn't save this change. Try again.",
        )
    })?;
    log::info!("{}", pairing::device_line("forgotten", id));
    // The room follows at once, not at the next poll: the member's posts
    // stop the moment the owner's finger leaves the button.
    room::forget_now(&brain, id)?;
    Ok(())
}

/// The owner pressed Allow: the phone that completed its ceremony may now
/// use its credential at the door. Refuse remains the existing forget -
/// this command only flips the record, and the running door learns the new
/// set through the same once-a-second reconcile a forget rides.
#[tauri::command]
fn brain_pairing_allow_device(desk: State<Desk>, id: u32) -> Result<(), CommandError> {
    desk.desk.allow_device(id).map_err(|_| {
        CommandError::new(
            "pairing.save_failed",
            "Kalsa couldn't save this change. Try again.",
        )
    })?;
    log::info!("{}", pairing::device_line("allowed", id));
    Ok(())
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
    log::info!("pairing: the whole pairing store was forgotten");
    if let Err(error) = take_own_seat(desk.file()) {
        log::warn!("this computer could not take its own seat back: {error}");
    }
    Ok(())
}

/// The owner explicitly discards an unreadable pairing file. This is the only
/// way out of `StoreUnavailable`; a read error is never silently treated as
/// an unpaired computer.
#[tauri::command]
fn brain_pairing_forget(brain: State<Arc<Brain>>, desk: State<Desk>) -> Result<(), CommandError> {
    brain.stop_door();
    // The hatch's own words are logged by the helper; a refusal here is a
    // coded save failure like any other store write.
    forget_store_and_keep_own_seat(&desk.desk).map_err(|_| {
        CommandError::new(
            "pairing.save_failed",
            "Kalsa couldn't save this change. Try again.",
        )
    })
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
    // The one flag the ticker's thread shares with the exit: an exit that has
    // begun must not be undone by a late tick raising the door it just took
    // down. See `reconcile_door` for how the two ends order themselves.
    let exiting = Arc::new(AtomicBool::new(false));
    let app = tauri::Builder::default()
        // The window's own state, for the page: a minimized Windows window
        // keeps `document.hidden` false, so this is the only word the page
        // gets on being an icon.
        .on_window_event(window_visibility::on_window_event)
        // The webview's own lifecycle on the log: the first page load of this
        // process is the app start, every later one a reload — which is what
        // "the app stopped and started again" looks like from the outside
        // when the window never closed. The renderer's crash itself has no
        // hook on Windows (tauri's process-terminate hook is macOS/iOS only);
        // a reload landing after the first load is the reachable fingerprint.
        .on_page_load(|webview, payload| {
            // The start is what counts a load; the finished event names the
            // same one, so a single load is `started #1` then `finished #1`,
            // and a reload is `started #2`.
            let load = match payload.event() {
                tauri::webview::PageLoadEvent::Started => {
                    PAGE_LOADS.fetch_add(1, Ordering::SeqCst) + 1
                }
                tauri::webview::PageLoadEvent::Finished => PAGE_LOADS.load(Ordering::SeqCst),
            };
            let event = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "started",
                tauri::webview::PageLoadEvent::Finished => "finished",
            };
            log::info!(
                "{}",
                ui_event::page_line(load, event, webview.label(), payload.url().as_str())
            );
        })
        .manage(Arc::new(Brain::new()))
        .manage(web::WebCalls::default())
        .manage(files::Searches::default())
        .invoke_handler(tauri::generate_handler![
            brain_state,
            brain_advanced,
            brain_set_advanced,
            brain_choose_model,
            brain_capability,
            brain_test,
            brain_start,
            brain_stop,
            brain_pairing,
            brain_pairing_retry,
            brain_pairing_forget_device,
            brain_pairing_allow_device,
            brain_pairing_forget,
            brain_host_credential,
            vision::brain_vision_enable,
            room_commands::brain_room,
            room_commands::brain_room_history,
            room_commands::brain_room_post,
            room_commands::brain_room_set_name,
            room_commands::brain_room_stop,
            room_media::brain_room_media_create,
            room_media::brain_room_media_chunk,
            room_media::brain_room_media_complete,
            room_media::brain_room_media_read,
            room_media::brain_room_media_clear,
            invites::brain_invite_create,
            invites::brain_invite_list,
            invites::brain_invite_link,
            invites::brain_invite_cancel,
            web::brain_web_search,
            web::brain_web_fetch,
            web::brain_web_stop,
            web::brain_open_url,
            files::brain_files_roots,
            files::brain_files_list,
            files::brain_files_read,
            files::brain_files_search,
            brain_open_log_folder,
            brain_send_log,
            brain_previous_session_crashed,
            brain_log_webview_error,
            ui_event::brain_log_event,
            window_visibility::window_hidden
        ])
        .setup({
            let guard = std::sync::Arc::clone(&guard);
            let exiting = Arc::clone(&exiting);
            move |app| {
            // The log is the first thing that works, so everything after it
            // is on the record — on STDERR, until the instance lock below
            // says this process owns the log: two apps writing one file
            // would interleave their lines, so the file sink is attached
            // only by the launch that won the lock, and a refused second
            // launch keeps its few lines (the refusal itself) on stderr.
            logging::install(None, env!("CARGO_PKG_VERSION"));
            logging::install_panic_hook();
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
                    log::info!("a second launch was refused — the running window comes forward");
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
            // lock would be released under a running app. That is a
            // programming error, and it fails loudly.
            if !app.manage(lock) {
                return Err(io::Error::other("the instance lock was already managed").into());
            }
            // The lock is won: this process owns the log. The file sink
            // attaches now — the session header is written into the file as
            // its first lines of this session — and only now may anything
            // be said on the record.
            logging::attach_file(
                app.path().app_log_dir().unwrap_or_else(|_| parent.to_path_buf()),
                env!("CARGO_PKG_VERSION"),
            );
            log::info!("app start");
            // Under the lock, and only here: the unclean-exit marker is
            // this session's own, so a launch refused as a second one (it
            // returned above, before the lock existed) never touches it.
            // The answer it gives is for the crash prompt to read once the
            // window is up; this is also the one place it is logged.
            if instance::session_marker::begin(parent) {
                log::warn!("the previous session did not exit cleanly");
                app.state::<Arc<Brain>>()
                    .prev_crash
                    .store(true, Ordering::SeqCst);
            }
            // A machine that has not changed does not measure again: seed
            // the kept measurement from the record, before any turn-on can
            // run. A record this machine no longer matches is ignored
            // inside, and the first turn-on measures as it always did.
            measurement::seed(
                &app.state::<Arc<Brain>>().measurement,
                parent,
                SystemTime::now(),
                // Read lazily, inside the seed: a machine with no record
                // pays for none of these.
                || measurement::Facts {
                    ram_bytes: startup::ram_bytes(),
                    backend: kalsa_probe::backend(),
                    chip: kalsa_probe::brand_string(),
                },
            );
            // The session's machine facts, once: what a report is read
            // against. The measurement's bandwidth is included when a kept
            // record already holds one — a first-ever run has none yet, and
            // the block says so by omission.
            let measured = app
                .state::<Arc<Brain>>()
                .measurement
                .lock()
                .ok()
                .and_then(|kept| kept.clone());
            system::log_machine(
                &system::Machine {
                    os: system::os_description(),
                    arch: std::env::consts::ARCH,
                    cpu: kalsa_probe::brand_string(),
                    physical_cores: kalsa_probe::physical_cores(),
                    logical_cores: std::thread::available_parallelism().ok().map(|n| n.get()),
                    ram_total_bytes: startup::ram_bytes(),
                    ram_available_bytes: system::available_ram_bytes(),
                    bandwidth_bytes_per_second: measured
                        .as_ref()
                        .map(|m| m.ceiling_bytes_per_second),
                    adapters: system::adapters(),
                    runs_on: measured
                        .as_ref()
                        .map(|m| format!("{:?}", m.will_run_on))
                        .unwrap_or_else(|| "not measured yet".to_string()),
                },
                &system::host_name(),
            );
            // Under the lock, off this thread: an install from before the
            // stored choice keeps its model, and the window opens meanwhile.
            if let Ok(state) = state_file(app.handle()) {
                legacy_choice::in_background(
                    Arc::clone(&app.state::<Arc<Brain>>().migrating),
                    state,
                    kalsa_runtime::runtime_root(),
                );
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
                log::warn!("this computer could not take its own seat: {error}");
            }
            // The room this computer hosts, opened once in the same data
            // directory the pairing store lives in: the door gets it when
            // it is built, the desktop's own room view gets it through
            // [`room`], and a failure here costs the room alone — the door
            // then answers every room route with the one honest sentence,
            // never a pretend one.
            match kalsa_room::Room::open(
                &file.parent().unwrap_or_else(|| std::path::Path::new("")),
            ) {
                Ok(opened) => {
                    // A second set can only mean the hook ran twice; the
                    // room is opened once and the first one is the room.
                    let _ = app.state::<Arc<Brain>>().room.set(Arc::new(opened));
                    room_events::spawn_event_pump(app.handle().clone(), &app.state::<Arc<Brain>>());
                }
                Err(error) => {
                    log::warn!("the room could not be opened: {error}");
                }
            }
            // A pairing-side loopback bind failure is a startup failure,
            // not an empty pairing state: `?` aborts the hook, and tauri
            // turns that into a loud panic on the event loop rather than a
            // QR that cannot work.
            let desk = pairing_desk(file)?;
            // The road takes the desk's bound port — it may have fallen
            // back to a random one — so its desk lane lands on the socket
            // that actually serves.
            let desk_address = SocketAddr::from(([127, 0, 0, 1], desk.listener.port()));
            app.manage(desk);
            app.state::<Arc<Brain>>().set_desk_address(desk_address);
            // The app's own clock, on a thread of its own and over `Weak`
            // handles to the brain and the pairing desk: it runs while this
            // window is an icon — the phone's case, and the one the webview's
            // poll degraded in — and it holds no app alive to do it. Two jobs
            // ride it. First the door's reconcile, so the phone's door follows
            // the engine with no page behind it — the lock-screen start, where
            // the poll that used to be the only raiser never runs. Then the
            // disk tier's tick, which can wait on the engine for seconds and
            // must not stand between the engine and the door. A thread that
            // will not start costs the timer and the door's Rust side, not the
            // tier: a switch still saves. The `Watch` it carries is the
            // supervisor's own state, so a released or dead engine is acted on
            // here whether or not any window ever polls.
            let brain: Arc<Brain> = Arc::clone(&app.state::<Arc<Brain>>());
            let brain = Arc::downgrade(&brain);
            let desk = Arc::downgrade(&app.state::<Desk>().desk);
            let pairing_file = app.state::<Desk>().pairing_file.clone();
            let state_file = state_file(app.handle()).ok();
            let leaving = Arc::clone(&exiting);
            let watch = app.state::<Arc<Brain>>().supervisor.watch();
            match ticker::Ticker::start(ticker::PERIOD, move || {
                let (Some(brain), Some(desk)) = (brain.upgrade(), desk.upgrade()) else {
                    return;
                };
                reconcile_door(
                    &brain,
                    &desk,
                    &watch.state(),
                    &pairing_file,
                    state_file.as_deref(),
                    DoorCaller::Tick { leaving: &leaving },
                );
                tick(&brain.door, &watch);
            }) {
                Ok(ticker) => {
                    app.manage(ticker);
                }
                Err(error) => log::warn!(
                    "the app's timer did not start, so a chat is saved only when \
                     it is switched and the door follows the engine only while a \
                     page polls: {error}"
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
            log::error!("the app could not be built: {error}");
            error
        })?;
    app.run(move |app, event| {
        // Take the child with us on the way out, on both exit paths the
        // runtime reports. The platform backstop (job object, pdeathsig)
        // covers the exits that run no handler at all. The cleanup runs ONCE
        // for the app — `ExitRequested` and `Exit` both arrive for one quit —
        // and behind the exit's own deadline: the ENGINE first, so a slow exit
        // can never orphan it, then the rest, every wait of it bounded. A step
        // that has not come back at the deadline is named, the engine is
        // killed through the identity the supervisor still holds, and the
        // process leaves.
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit)
            && !exiting.swap(true, std::sync::atomic::Ordering::SeqCst)
        {
            // The watch, not a pid read: the identity is loaded at the
            // deadline, after the steps below have decided what the
            // supervisor still vouches for.
            let engine = app
                .try_state::<Arc<Brain>>()
                .map(|brain| brain.supervisor.watch());
            let watched = engine.clone();
            let deadline = exit::arm(
                exit::DEADLINE,
                "the engine",
                move || {
                    match watched
                        .as_ref()
                        .and_then(|watch| watch.finish_engine(exit::KILL_GRACE))
                    {
                        Some(report) => {
                            format!("the engine was killed at the deadline: {report:?}")
                        }
                        None => "no engine identity was held to kill".to_string(),
                    }
                },
                logging::warn_urgent,
                |code, _pending| std::process::exit(code),
            );
            if let Some(brain) = app.try_state::<Arc<Brain>>() {
                brain.supervisor.shutdown();
                deadline.stage("the room's event pump");
                room_events::stop_event_pump(&brain);
                deadline.stage("the door");
                brain.stop_door();
            }
            if let Some(desk) = app.try_state::<Desk>() {
                deadline.stage("the pairing listener");
                desk.desk.stop_serving();
                desk.listener.shutdown();
            }
            // A stop that came back with the engine's going unproven — a
            // kill issued, no proof it landed — leaves the engine's identity
            // held. The steps have returned, so the watchdog is about to
            // stand down: the kill is finished HERE, on the path the
            // watchdog would have taken, or a timely unconfirmed stop would
            // cancel the promised final kill.
            if let Some(report) = engine
                .as_ref()
                .and_then(|watch| watch.finish_engine(exit::KILL_GRACE))
            {
                log::warn!(
                    "the stop left the engine's going unproven; the exit killed it: {report:?}"
                );
            }
            deadline.finished();
        }
        // `Exit` is the loop's last event, so this reads once per run;
        // a `PreventExit`-ed `ExitRequested` is not an exit and stays
        // unlogged. The marker's removal is what makes THIS exit the
        // clean one the next start will not ask about.
        if matches!(event, RunEvent::Exit) {
            log::info!("app exit");
            if let Ok(dir) = app.path().app_data_dir() {
                instance::session_marker::end_cleanly(&dir);
            }
        }
    });
    Ok(())
}

/// Opens the log folder in the platform's own file manager, so a tester can
/// find `kalsa-brain.log` and send it by hand. No shell: the folder is one
/// argument, and the child is reaped on a thread of its own exactly as the
/// browser opener does — and its exit status is said, because an opener that
/// refuses is the one way this button fails silently otherwise.
#[tauri::command]
fn brain_open_log_folder() -> Result<(), String> {
    let folder = logging::folder()
        .ok_or_else(|| "The log folder is not available on this computer.".to_string())?;
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let opener = "xdg-open";
    std::process::Command::new(opener)
        .arg(&folder)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|mut child| {
            std::thread::spawn(move || {
                match child.wait() {
                    Ok(status) if !status.success() => {
                        log::warn!(
                            "the log-folder opener ({opener}) exited {status}; the folder was {}",
                            folder.display()
                        );
                    }
                    Err(error) => {
                        log::warn!("the log-folder opener could not be waited on: {error}");
                    }
                    _ => {}
                }
            });
        })
        .map_err(|_| "Kalsa couldn't open the log folder.".to_string())
}

/// The tester's press: the log files, joined and trimmed to the newest
/// 4 MiB, POSTed to the one report endpoint. Never called by anything but
/// a button. The answer is the report's id; the refusal is one of the
/// four stable codes the page words (`rate_limited`, `try_tomorrow`,
/// `offline`, `failed`) — never the network's own text.
#[tauri::command]
async fn brain_send_log() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(dir) = logging::folder() else {
            return Err("failed".to_string());
        };
        let body = report::read_body(&dir);
        if body.trim().is_empty() {
            log::warn!("the report was asked for and the log folder holds nothing");
            return Err("failed".to_string());
        }
        log::info!("sending the log report ({} bytes)", body.len());
        let header = report::app_header(
            env!("CARGO_PKG_VERSION"),
            std::env::consts::OS,
            std::env::consts::ARCH,
        );
        match report::send(&body, &header) {
            Ok(id) => {
                log::info!("report accepted: {id}");
                Ok(id)
            }
            Err(failure) => {
                log::warn!("report refused: {}", failure.code());
                Err(failure.code().to_string())
            }
        }
    })
    .await
    .map_err(|_| "failed".to_string())?
}

/// Whether the previous session exited uncleanly — its `running` marker
/// was still there when this one started. Reading it clears it: the prompt
/// is asked once per session, however many times the page mounts.
#[tauri::command]
fn brain_previous_session_crashed(brain: State<Arc<Brain>>) -> bool {
    brain
        .prev_crash
        .swap(false, Ordering::SeqCst)
}

/// The webview's own error, from the boundary that caught it: the error's
/// name and the first stack frame's file:line — component and file names.
/// Never the message, and never component props or state: both can quote a
/// whole conversation.
#[tauri::command]
fn brain_log_webview_error(name: String, frame: String) {
    log::error!("{}", logging::webview_line(&name, &frame));
}

/// One card per row: the pick list is keyed by the model token — repo,
/// name, quant, bytes — so the same row arriving twice cannot render as two
/// cards. The check covers the whole list, not only neighbours: how the
/// rows are ordered is not something the list owns.
fn unique_rows(
    entries: Vec<&'static kalsa_catalog::ModelEntry>,
) -> Vec<&'static kalsa_catalog::ModelEntry> {
    let mut seen = std::collections::HashSet::new();
    entries
        .into_iter()
        .filter(|entry| seen.insert(startup::model_token(entry)))
        .collect()
}

#[cfg(test)]
mod real_walk;
#[cfg(test)]
mod tests;
