//! The pairing desk: the ceremony's state as the Pairing page reads it, and
//! the one place that writes the credential to disk.
//!
//! `kalsa-pairing` owns the ceremony and deliberately owns no socket; this
//! module is the shell's side of that boundary — it holds the live ceremony,
//! hands the listener (`transport`) the two moves a phone can make, and turns
//! whatever state it is in into the page's DTO.
//!
//! Two rules are structural rather than remembered:
//!
//! * **The square advertises loopback and nothing else.** `reachable` is
//!   built here from the listener's own bound address, which `transport`
//!   binds on `127.0.0.1`. The phone arrives through a tunnel, exactly as it
//!   does for the inference server; nothing is opened on the LAN, not even
//!   for the length of a window.
//! * **The owner's Allow is the authorisation.** Nobody reaches the
//!   ceremony without scanning a code this computer displayed, but showing
//!   the square is not the decision: a completed ceremony stores the phone
//!   WAITING — its credential answers the door's 401 — and the owner's
//!   Allow on the Devices page is what admits it to the house. The one
//!   refusal that is not an addition is a credential the store already
//!   holds — a replay — and that one never asks the owner anything; it
//!   consumes the ceremony and reports that the connection could not be
//!   saved.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use kalsa_catalog::PhoneModel;
use kalsa_pairing::store::DeviceKind;
use kalsa_pairing::{Pairing, PairingSeal, PhoneDeclaration, StoreError};
use serde::Serialize;

/// How long a square is good for. Long enough to pick the phone up and point
/// it, short enough that a square left on a screen is not a standing offer.
const WINDOW: Duration = Duration::from_secs(120);

/// Why the square on screen is a fresh one. `None` for the first square of a
/// session — nothing was replaced.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Refreshed {
    Expired,
    WrongCode,
}

impl Refreshed {
    fn word(self) -> &'static str {
        match self {
            Self::Expired => "expired",
            Self::WrongCode => "wrong-code",
        }
    }
}

/// What the desk is doing, in the page's terms.
enum State {
    /// No ceremony: the server is not running, so there is nothing for a
    /// phone to connect to.
    Idle,
    /// A square is on screen, or a phone is part-way through.
    Live {
        pairing: Pairing,
        qr: String,
        refreshed: Option<Refreshed>,
        previous: Option<PhoneModel>,
    },
    /// This computer works with a phone, and the credential is on disk —
    /// though a phone stored by a just-completed ceremony may still be
    /// waiting for the owner's Allow.
    ///
    /// No name travels with the protocol. The phone's declaration carries
    /// capability — weights, parameters, a measured rate — and nothing a
    /// person would call a name, because the MAC binds what is declared and
    /// nobody has declared one yet. The page already says "your phone" when
    /// it is given nothing, which is true; a name made up here would not be.
    Paired {
        phone: PhoneModel,
        /// Retained so a lost HTTP response can be retried idempotently.
        pending: Option<PendingDelivery>,
    },
    /// The ceremony finished and the credential could not be written. A
    /// replayed credential lands here too, on purpose: it must never become
    /// an owner-facing question about a phone it is not.
    CouldNotSave,
    /// The path exists but cannot be read or is corrupt. It must never look
    /// like an unpaired machine, because that could make the catalog choose
    /// for a phone that is already configured.
    StoreUnavailable,
    /// The listener died after startup. Pairing is disabled until restart;
    /// silently drawing another square would make the QR lie.
    ServiceUnavailable,
}

struct PendingDelivery {
    delivery_token: String,
    seal: PairingSeal,
    expires_at: SystemTime,
}

impl PendingDelivery {
    fn from_store(delivery: kalsa_pairing::store::Delivery) -> Option<Self> {
        Some(Self {
            delivery_token: delivery.token().to_string(),
            seal: delivery.seal().clone(),
            expires_at: delivery.expires_at()?,
        })
    }

    fn as_store_delivery(&self) -> Option<kalsa_pairing::store::Delivery> {
        kalsa_pairing::store::Delivery::new(
            &self.delivery_token,
            self.seal.clone(),
            self.expires_at,
        )
    }

    fn token_matches(&self, presented: &str) -> bool {
        self.as_store_delivery()
            .is_some_and(|delivery| delivery.token_matches(presented))
    }
}

/// The live ceremony, shared between the Tauri commands and the listener
/// thread. One mutex: two phones racing the same square serialise here, and
/// the ceremony's own one-shot rule does the rest.
pub(crate) struct Desk {
    state: Mutex<State>,
    file: PathBuf,
    serving: AtomicBool,
    listener_failed: AtomicBool,
}

/// What the Devices surface reads, polled. The field names and vocabulary are
/// the frontend contract, not this module's to rename.
#[derive(Serialize)]
pub(crate) struct PairingDto {
    kind: &'static str,
    state: &'static str,
    qr_svg: Option<String>,
    refreshed: Option<&'static str>,
    phone: Option<String>,
    /// The whole house: every stored device, its id, its label and its
    /// capability sentence. `forget_device(id)` removes one.
    devices: Vec<PairedDeviceDto>,
    delivery_pending: bool,
    failure: Option<&'static str>,
    door_port: Option<u16>,
    /// The loopback port the desk's own listener holds and whether it is
    /// the preferred one — the fallback makes the first a fact the owner
    /// must read rather than a constant, and the second a fact the Tailscale
    /// note must state, because a standing serve rule keeps pointing at the
    /// preferred port after a fallback.
    desk_port: Option<u16>,
    desk_port_preferred: bool,
}

/// One stored device, as the page may see it: the store's id and label, what
/// it is, and the capability sentence the page has always shown for a phone.
/// A host carries no capability sentence — it has no phone fields — and the
/// page renders its row as "This computer" with no Forget.
#[derive(Serialize)]
pub(crate) struct PairedDeviceDto {
    id: u32,
    label: String,
    kind: &'static str,
    phone: String,
    /// The owner has not allowed this device yet: its credential answers
    /// the door's 401 until Allow, and the page draws Allow/Refuse with
    /// no success sentence for it.
    waiting: bool,
}

impl PairingDto {
    pub(crate) fn with_door_port(mut self, door_port: Option<u16>) -> Self {
        self.door_port = door_port;
        self
    }

    pub(crate) fn with_desk_port(mut self, desk_port: Option<(u16, bool)>) -> Self {
        match desk_port {
            Some((port, preferred)) => {
                self.desk_port = Some(port);
                self.desk_port_preferred = preferred;
            }
            None => self.desk_port = None,
        }
        self
    }
}

/// Why the page's one-device forget did not happen. The store's own
/// `forget_device` deliberately holds no such opinion — the hatch that must
/// empty any file cannot afford one — so this gesture carries both reasons
/// itself, and they stay distinct for whoever reports them.
#[derive(Debug)]
pub(crate) enum ForgetError {
    /// This computer's own record: no Forget, anywhere. The command says
    /// this to the owner's face; a caller that bypassed the command meets
    /// the same wall here.
    Host,
    /// The store's own refusal, unchanged.
    Store(StoreError),
}

impl Desk {
    /// A desk for the credential kept at `file`. A credential already on disk
    /// is the paired state — a stored phone may still be waiting for the
    /// owner's Allow — so the owner sees the house without any ceremony
    /// running.
    pub(crate) fn new(file: PathBuf) -> Self {
        let state = Self::state_from_store(&file);
        Self {
            state: Mutex::new(state),
            file,
            serving: AtomicBool::new(false),
            listener_failed: AtomicBool::new(false),
        }
    }

    /// The desk's state as the store alone tells it. The WHOLE set decides,
    /// and only a phone counts as a pairing: a host is this machine's own
    /// record, not a phone it is paired with, so a store holding only a
    /// host is an unpaired computer and the square still appears. The
    /// first record alone cannot say whether the set holds a phone, so the
    /// kind-bearing set reader decides. The paired snapshot it returns
    /// names the FIRST phone in store order and awaits that phone's
    /// retained delivery, kept only while unexpired; a store that cannot
    /// be read is StoreUnavailable, never a silent Idle.
    fn state_from_store(file: &Path) -> State {
        match kalsa_pairing::store::load_devices(file) {
            Ok(devices) => match devices
                .iter()
                .find(|device| device.kind == DeviceKind::Phone)
                .and_then(|device| {
                    device
                        .handshake
                        .phone
                        .map(|phone| (phone, device.delivery.clone()))
                }) {
                Some((phone, delivery)) => {
                    let pending = delivery
                        .and_then(PendingDelivery::from_store)
                        .filter(|pending| SystemTime::now() < pending.expires_at);
                    State::Paired { phone, pending }
                }
                None => State::Idle,
            },
            Err(_) => State::StoreUnavailable,
        }
    }

    /// The phone this computer works with, for the catalog. `None` until a
    /// ceremony has been completed AND the owner has allowed the phone: a
    /// completed ceremony stores the phone waiting, and an unpaired or
    /// not-yet-allowed computer must not be handed a phone it invented.
    pub(crate) fn phone(&self) -> Result<Option<kalsa_catalog::PhoneModel>, StoreError> {
        // Serialise the read with replacement. The file is atomically
        // published, but this lock also keeps the in-memory state and the
        // catalog's observation from crossing the owner's decision.
        let _state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        // The catalog is handed a PHONE or nothing. The host is skipped, not
        // converted: a zero-weight guest would be a phone this computer
        // invented, and inventing one is the thing this function must never
        // do. The host has no phone fields to return.
        let devices = kalsa_pairing::store::load_devices(&self.file)?;
        Ok(devices.into_iter().find_map(|device| match device.kind {
            // A waiting phone is skipped, not converted: find_map keeps
            // scanning, so an allowed phone behind it still reaches the
            // catalog.
            DeviceKind::Phone if device.waiting => None,
            DeviceKind::Phone => device.handshake.phone,
            DeviceKind::Host => None,
        }))
    }

    /// Stop pairing immediately when the inference server stops. The listener
    /// remains bound so its address can stay in future squares, but every
    /// route sees this gate and refuses while the server is down.
    pub(crate) fn stop_serving(&self) {
        self.serving.store(false, Ordering::SeqCst);
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(*state, State::Live { .. }) {
            *state = State::Idle;
        }
    }

    pub(crate) fn listener_failed(&self) {
        self.listener_failed.store(true, Ordering::SeqCst);
        self.serving.store(false, Ordering::SeqCst);
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        *state = State::ServiceUnavailable;
    }

    pub(crate) fn is_serving(&self) -> bool {
        self.serving.load(Ordering::SeqCst) && !self.listener_failed.load(Ordering::SeqCst)
    }

    /// The page's read. `serving` is whether there is anything for a phone to
    /// connect to; a square is only offered while the server is up, because a
    /// phone that scans one and finds nothing behind it has been lied to.
    ///
    /// This is also where a window closes: the page polls, and the poll is
    /// the clock. An expired square is replaced by a fresh one rather than
    /// left on screen, and the page says why.
    pub(crate) fn read(
        &self,
        serving: bool,
        reachable: &str,
        node: Option<&str>,
        now: SystemTime,
    ) -> PairingDto {
        if self.listener_failed.load(Ordering::SeqCst) {
            return dto(&State::ServiceUnavailable, self.stored_devices());
        }
        if serving {
            self.serving.store(true, Ordering::SeqCst);
        } else {
            self.stop_serving();
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let State::Live { pairing, .. } = &mut *state {
            pairing.expire_if_due(now);
            if matches!(pairing, Pairing::Expired) {
                let previous = match &*state {
                    State::Live { previous, .. } => *previous,
                    _ => None,
                };
                *state = Self::fresh(reachable, node, now, Some(Refreshed::Expired), previous);
            }
        }
        match &*state {
            State::Paired { .. }
            | State::CouldNotSave
            | State::StoreUnavailable
            | State::ServiceUnavailable => {}
            _ if !serving => *state = State::Idle,
            State::Idle => *state = Self::fresh(reachable, node, now, None, None),
            State::Live { .. } => {}
        }
        let devices = self.stored_devices();
        dto(&state, devices)
    }

    /// The house, as the page may read it: every stored device's id, label
    /// and capability sentence. Empty when the store cannot be read — the
    /// failed state says that in its own words.
    fn stored_devices(&self) -> Vec<PairedDeviceDto> {
        kalsa_pairing::store::load_devices(&self.file)
            .unwrap_or_default()
            .into_iter()
            .map(|device| PairedDeviceDto {
                id: device.id,
                label: device.label,
                kind: device.kind.word(),
                // The capability sentence is a phone's; a host has none to
                // give, and the row's rendering is a later commit's decision.
                phone: device.handshake.phone.map_or_else(String::new, phone_label),
                waiting: device.waiting,
            })
            .collect()
    }

    /// The store this desk reads and writes. The shell needs the path to put
    /// this computer back in its seat after the hatch has emptied the store.
    pub(crate) fn file(&self) -> &Path {
        &self.file
    }

    /// Whether this stored device is this computer's own record. The page's
    /// Forget is a gesture about a paired phone, and the host's row has none
    /// — the command asks this before it can be reached by one, so the
    /// decision is not the rendering's alone. A store this app cannot read
    /// answers false: the caller then runs the ordinary forget, whose own
    /// error says what happened.
    pub(crate) fn is_host(&self, id: u32) -> bool {
        kalsa_pairing::store::load_devices(&self.file).is_ok_and(|devices| {
            devices
                .iter()
                .any(|device| device.id == id && device.kind == DeviceKind::Host)
        })
    }

    /// The owner removes ONE device from the house. The others keep their
    /// credentials and their ids; a PAIRED desk recomputes itself from the
    /// store afterwards — `new`'s rule — so the phone it names and the
    /// delivery it awaits belong to a phone that is still there, and the
    /// last phone leaving lands Idle. A live ceremony is left alone:
    /// forgetting a stored phone never burns a square another phone is
    /// part-way through.
    ///
    /// The host is refused HERE as well as at the command: the page draws
    /// no Forget for its row and the command asks `is_host` first for its
    /// own sentence, but a gesture that reaches this method must still not
    /// take the app's own key out of the store while the running door holds
    /// it. The store's own `forget_device` keeps no such opinion — the
    /// hatch that must empty any file is a different road, and it is not
    /// this one.
    pub(crate) fn forget_device(&self, id: u32) -> Result<(), ForgetError> {
        if self.is_host(id) {
            return Err(ForgetError::Host);
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        kalsa_pairing::store::forget_device(&self.file, id).map_err(ForgetError::Store)?;
        // Only a desk that was paired: a live ceremony must survive the
        // owner tidying the stored set.
        if matches!(*state, State::Paired { .. }) {
            *state = Self::state_from_store(&self.file);
        }
        Ok(())
    }

    /// The owner pressed Allow. The store flips one record; the door's set
    /// picks it up through the same once-a-second reconcile a forget rides
    /// (`start_door_if_paired`) - no new loop. The state lock is the one
    /// forget_device takes for the same reason: the catalog's observation
    /// must not cross the owner's decision.
    pub(crate) fn allow_device(&self, id: u32) -> Result<(), StoreError> {
        let _state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        kalsa_pairing::store::allow_device(&self.file, id)
    }

    /// The owner asked for another square. Anything in flight is abandoned:
    /// a square the owner has given up on must not still be completable.
    pub(crate) fn retry(&self, serving: bool, reachable: &str, node: Option<&str>, now: SystemTime) {
        if !serving {
            self.stop_serving();
            return;
        }
        if !self.is_serving() {
            return;
        }
        self.serving.store(true, Ordering::SeqCst);
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if matches!(
            *state,
            State::StoreUnavailable | State::ServiceUnavailable
        ) {
            return;
        }
        let previous = match &*state {
            State::Paired { phone, .. } => Some(*phone),
            State::Live { previous, .. } => *previous,
            _ => None,
        };
        let refreshed = matches!(*state, State::Live { .. }).then_some(Refreshed::WrongCode);
        *state = Self::fresh(reachable, node, now, refreshed, previous);
    }

    /// A phone presents the code from the square. Nothing is returned but
    /// whether the ceremony moved: the proof comes next, and a claim that
    /// says more than "go on" is a claim that can be probed.
    pub(crate) fn claim(&self, code: &str, now: SystemTime) -> bool {
        if !self.is_serving() {
            return false;
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let State::Live { pairing, .. } = &mut *state else {
            return false;
        };
        matches!(
            pairing.claim(code, now),
            kalsa_pairing::ClaimResult::Claimed
        )
    }

    /// A phone presents its proof. The scanned square was the
    /// authorisation, so a completed ceremony ADDS a device to the house —
    /// it never asks an owner which phone to evict — and the seal goes back
    /// to the phone that earned it.
    pub(crate) fn complete(
        &self,
        declaration: PhoneDeclaration,
        now: SystemTime,
    ) -> Option<PairingSeal> {
        if !self.is_serving() {
            return None;
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let State::Paired { pending, .. } = &mut *state {
            let Some(delivery) = pending.as_ref() else {
                return None;
            };
            if now >= delivery.expires_at {
                let token = delivery.delivery_token.clone();
                *pending = None;
                let _ = kalsa_pairing::store::clear_delivery(&self.file, &token);
                return None;
            }
            return declaration
                .delivery_token_matches(&delivery.delivery_token)
                .then(|| delivery.seal.clone());
        }
        let State::Live { pairing, .. } = &mut *state else {
            return None;
        };
        let delivery_token = declaration.delivery_token().to_string();
        let expires_at = pairing.expires_at()?;
        let (handshake, seal) = pairing.complete(declaration, now).ok()?;
        let pending = PendingDelivery {
            delivery_token,
            seal: seal.clone(),
            expires_at,
        };
        // The label is assigned HERE, locally — the pairing protocol
        // deliberately carries no name. It is numbered after the id the
        // store will mint, by the same never-reuse rule the store mints ids
        // with (one above every id in the set, under the single-writer
        // assumption both sides already make): a minted number is never
        // handed out twice, so no two devices can carry the same label,
        // however many devices leave.
        let stored = kalsa_pairing::store::load_devices(&self.file).unwrap_or_default();
        let next_id = stored
            .iter()
            .map(|device| device.id)
            .max()
            .map_or(0, |highest| highest.saturating_add(1));
        let label = if next_id == 0 {
            "Paired phone".to_string()
        } else {
            // Saturating, like the display it is: at the very top of the id
            // range the store's own refusal is what fires, not this text.
            format!("Paired phone {}", next_id.saturating_add(1))
        };
        // The delivery rides the add: the store keeps the sealed response,
        // so a crash before the phone's retry is answered by the retry path
        // for EVERY device, the way it always was for the first.
        let delivery = pending.as_store_delivery().ok_or(State::CouldNotSave).ok()?;
        match kalsa_pairing::store::add_device_with_delivery(
            &self.file,
            &label,
            &handshake,
            delivery,
        ) {
            Ok(_) => {
                let Some(phone) = handshake.phone else {
                    // A completed ceremony always declares a phone, and a
                    // host never completes one; the impossible is answered
                    // as a save failure, not a panic on the serving thread.
                    *state = State::CouldNotSave;
                    return None;
                };
                *state = State::Paired {
                    phone,
                    pending: Some(pending),
                };
                Some(seal)
            }
            // Every refusal consumes the ceremony without an owner-facing
            // question. A replayed credential in particular —
            // `CredentialAlreadyStored` — is exactly what the store's split
            // variants exist to keep apart from a replacement decision.
            Err(_) => {
                *state = State::CouldNotSave;
                None
            }
        }
    }

    /// A response was written successfully, so its retry record is spent.
    /// The transport calls this only AFTER the write succeeded, and the
    /// token is the one that response went to, so the store copy is cleared
    /// in EVERY desk state: a late ack - the owner retried and another phone
    /// completed between the write and this call - must not be dropped for
    /// arriving after the state moved on. The in-memory pending goes
    /// whenever it matches the token, whether or not the store clear
    /// succeeded: an unreadable store must not put the seal back in reach.
    /// The write-FAILED case never gets here (the transport does not
    /// acknowledge a response it did not write), so the phone's retry path
    /// is untouched.
    pub(crate) fn acknowledge(&self, delivery_token: &str) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let _ = kalsa_pairing::store::clear_delivery(&self.file, delivery_token);
        if let State::Paired { pending, .. } = &mut *state {
            if pending
                .as_ref()
                .is_some_and(|saved| saved.token_matches(delivery_token))
            {
                *pending = None;
            }
        }
    }

    /// The owner explicitly discards an unreadable store so pairing can
    /// recover. It never silently forgets a readable pairing.
    ///
    /// The gate keys on the door's verdict — the SET reader — not on this
    /// desk's single-record view. A set whose later records cannot be
    /// realized stops the door on every poll while record 0 alone still
    /// loads; that is exactly the state this button exists to clear, and
    /// gating on anything else would leave the store unrecoverable from
    /// inside the app. A fully readable store is still refused: forgetting
    /// a healthy pairing is never implicit.
    pub(crate) fn forget(&self) -> Result<(), StoreError> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if kalsa_pairing::store::load_devices(&self.file).is_ok() {
            return Ok(());
        }
        kalsa_pairing::store::forget(&self.file)?;
        *state = State::Idle;
        Ok(())
    }

    /// A new square, or the idle state when one cannot be made. A failure to
    /// draw a square is not a failure of the pairing: the page shows nothing
    /// to scan and the next poll tries again.
    fn fresh(
        reachable: &str,
        node: Option<&str>,
        now: SystemTime,
        refreshed: Option<Refreshed>,
        previous: Option<PhoneModel>,
    ) -> State {
        let Ok(pairing) = Pairing::offer(reachable, node, now, WINDOW) else {
            return State::Idle;
        };
        let Some(payload) = pairing.qr_payload() else {
            return State::Idle;
        };
        match kalsa_pairing::qr_svg(&payload) {
            Ok(qr) => State::Live {
                pairing,
                qr,
                refreshed,
                previous,
            },
            Err(_) => State::Idle,
        }
    }
}

/// The desk as the page reads it. `claiming` is a live ceremony a phone has
/// already claimed: the square is gone from the screen because it is spent.
fn dto(state: &State, devices: Vec<PairedDeviceDto>) -> PairingDto {
    let empty = PairingDto {
        kind: "pairing",
        state: "idle",
        qr_svg: None,
        refreshed: None,
        phone: None,
        devices: Vec::new(),
        delivery_pending: false,
        failure: None,
        door_port: None,
        desk_port: None,
        desk_port_preferred: false,
    };
    match state {
        State::Idle => empty,
        State::Live {
            pairing,
            qr,
            refreshed,
            ..
        } => match pairing {
            Pairing::Claimed(_) => PairingDto {
                state: "claiming",
                ..empty
            },
            _ => PairingDto {
                state: "waiting",
                qr_svg: Some(qr.clone()),
                refreshed: refreshed.map(Refreshed::word),
                ..empty
            },
        },
        State::Paired { phone, pending } => PairingDto {
            state: "paired",
            phone: Some(phone_label(*phone)),
            devices,
            delivery_pending: pending.is_some(),
            ..empty
        },
        State::CouldNotSave => PairingDto {
            state: "failed",
            failure: Some("could-not-save"),
            ..empty
        },
        State::StoreUnavailable => PairingDto {
            state: "failed",
            failure: Some("could-not-read"),
            ..empty
        },
        State::ServiceUnavailable => PairingDto {
            state: "failed",
            failure: Some("service-unavailable"),
            ..empty
        },
    }
}

fn phone_label(phone: PhoneModel) -> String {
    format!(
        "phone with {} GB of model weights",
        phone.weights_bytes / 1_000_000_000
    )
}

/// The desk, shared with the listener thread.
pub(crate) type SharedDesk = Arc<Desk>;

#[cfg(test)]
impl Desk {
    pub(crate) fn test_square(&self) -> Option<String> {
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        match &*state {
            State::Live { pairing, .. } => pairing.qr_payload(),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_catalog::{Parameters, PhoneModel};

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-brain-pairing-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch");
        dir.join("pairing.json")
    }

    fn a_phone() -> PhoneModel {
        PhoneModel {
            weights_bytes: 2_000_000_000,
            parameters: Some(Parameters::mixture(8_000_000_000, 1_000_000_000)),
            measured_tokens_per_second: Some(11.5),
            battery_powered: Some(true),
        }
    }

    /// The square's two secrets, as the phone reads them out of the QR.
    fn secrets(payload: &str) -> (String, String, String) {
        let value: serde_json::Value = serde_json::from_str(payload).expect("payload is json");
        (
            value["code"].as_str().expect("code").to_string(),
            value["nonce"].as_str().expect("nonce").to_string(),
            value["reachable"].as_str().expect("reachable").to_string(),
        )
    }

    fn declaration_for(desk: &Desk, phone: PhoneModel, now: SystemTime) -> PhoneDeclaration {
        let payload = desk.test_square().expect("square");
        let (code, nonce, reachable) = secrets(&payload);
        assert!(desk.claim(&code, now));
        PhoneDeclaration::sign(&code, &nonce, &reachable, None, phone).expect("declaration")
    }

    /// A phone walks the whole ceremony: it scans, claims, proves, and only
    /// then does this computer know what it is serving. Before that the
    /// catalog is handed nothing — which is the state the product shipped in
    /// until this transport existed. Completion alone now stores the phone
    /// waiting: the catalog is also handed nothing until the owner presses
    /// Allow, and both halves are this test's.
    #[test]
    fn the_catalog_learns_the_phone_only_after_a_completed_ceremony() {
        let desk = Desk::new(scratch("completes"));
        let now = SystemTime::now();

        assert!(desk.phone().unwrap().is_none(), "nothing is paired yet");
        desk.read(true, "http://127.0.0.1:1", None, now);
        let payload = desk.test_square().expect("a square is on screen");
        let (code, nonce, reachable) = secrets(&payload);

        assert!(
            desk.claim(&code, now),
            "the code off the square is the code"
        );
        let declaration = PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone())
            .expect("the phone can sign what it scanned");
        assert!(desk.complete(declaration, now).is_some(), "sealed");

        // Completion stores the phone WAITING: the ceremony alone no longer
        // teaches the catalog (the behaviour this change made) - the
        // owner's Allow does. The test's name still states the half the
        // catalog needed before, and the body now pins both.
        assert!(
            desk.phone().unwrap().is_none(),
            "a completed ceremony alone must not teach the catalog: the phone waits for Allow"
        );
        desk.allow_device(0).expect("the owner presses Allow");

        let phone = desk
            .phone()
            .unwrap()
            .expect("the phone reached the catalog after Allow");
        assert_eq!(phone.weights_bytes, 2_000_000_000);
        let dto = serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert_eq!(dto["phone"], "phone with 2 GB of model weights");
        assert_eq!(dto["delivery_pending"], true);
    }

    /// A set the door refuses (record 1 declares parameters that cannot
    /// exist) must be recoverable from inside the app: the desk agrees with
    /// the door's reader — StoreUnavailable, not a healthy pairing — and
    /// the escape hatch actually opens.
    #[test]
    fn a_store_the_door_cannot_fully_read_is_recoverable_from_the_desk() {
        let file = scratch("half-broken");
        let fine = "ab".repeat(32);
        let other = "cd".repeat(32);
        let impossible = r#"{"total":8,"active":9}"#;
        std::fs::write(
            &file,
            format!(
                r#"{{"v":2,"devices":[
                    {{"id":0,"label":"Fine","credential_hex":"{fine}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}},
                    {{"id":1,"label":"Broken","credential_hex":"{other}","phone":{{"weights_bytes":1,"parameters":{impossible},"measured_tokens_per_second":null,"battery_powered":null}}}}]}}"#
            ),
        )
        .unwrap();

        // The single-record view would call this a healthy pairing; the
        // desk must take the door's verdict instead.
        let desk = Desk::new(file.clone());
        assert!(matches!(
            *desk.state.lock().unwrap(),
            State::StoreUnavailable
        ));

        // The old gate refused here, because record 0 loads — the store
        // was unrecoverable from inside the app.
        desk.forget().expect("the escape hatch opens for a set the door refuses");
        assert!(!file.exists(), "the store is gone");
        assert!(matches!(*desk.state.lock().unwrap(), State::Idle));
    }

    /// And the protection keeps its other edge: a store the door accepts is
    /// never forgotten implicitly.
    #[test]
    fn forget_still_refuses_a_readable_store() {
        let file = scratch("forget-healthy");
        let fine = "ab".repeat(32);
        std::fs::write(
            &file,
            format!(
                r#"{{"v":2,"devices":[{{"id":0,"label":"Fine","credential_hex":"{fine}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}}]}}"#
            ),
        )
        .unwrap();
        let desk = Desk::new(file.clone());
        desk.forget().unwrap();
        assert!(
            file.exists(),
            "a readable pairing is never forgotten implicitly"
        );
    }

    /// One ceremony per scanned square, and every ceremony ADDS: the second
    /// device joins the house and the first keeps its credential and its id.
    #[test]
    fn a_second_completed_ceremony_adds_a_device_and_the_first_survives() {
        let file = scratch("adds");
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();

        desk.read(true, "http://127.0.0.1:1", None, now);
        let first = declaration_for(&desk, a_phone(), now);
        assert!(desk.complete(first, now).is_some(), "the first pairing seals");

        // The owner asks for another square ("Pair another phone"): the new
        // ceremony is a new authorisation, so it adds a second device.
        desk.retry(true, "http://127.0.0.1:1", None, now);
        let second = declaration_for(&desk, a_phone(), now);
        assert!(desk.complete(second, now).is_some(), "the second pairing seals too");

        let devices = kalsa_pairing::store::load_devices(&file).unwrap();
        assert_eq!(devices.len(), 2, "both devices are in the house");
        assert_eq!(devices[0].id, 0);
        assert_eq!(devices[0].label, "Paired phone");
        assert_eq!(devices[1].id, 1);
        assert_eq!(devices[1].label, "Paired phone 2");
        assert_ne!(
            devices[0].handshake.credential_hex(),
            devices[1].handshake.credential_hex()
        );
    }

    /// Forgetting one device leaves the others paired and reachable, and
    /// forgetting the last one empties the desk into Idle.
    #[test]
    fn forgetting_one_device_leaves_the_others_reachable() {
        let file = scratch("forget-one-desk");
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();

        desk.read(true, "http://127.0.0.1:1", None, now);
        desk.complete(declaration_for(&desk, a_phone(), now), now).unwrap();
        desk.retry(true, "http://127.0.0.1:1", None, now);
        desk.complete(declaration_for(&desk, a_phone(), now), now).unwrap();

        desk.forget_device(0).unwrap();
        let devices = kalsa_pairing::store::load_devices(&file).unwrap();
        assert_eq!(devices.len(), 1, "only the forgotten device left");
        assert_eq!(devices[0].id, 1, "the survivor keeps its own id");

        // The next pairing numbers its label after the id the store mints —
        // never reused — so no device can arrive bearing a name another
        // device already carries, however many devices leave.
        desk.retry(true, "http://127.0.0.1:1", None, now);
        desk.complete(declaration_for(&desk, a_phone(), now), now).unwrap();
        let labels: Vec<String> =
            kalsa_pairing::store::load_devices(&file).unwrap().into_iter().map(|d| d.label).collect();
        assert_eq!(
            labels,
            vec!["Paired phone 2".to_string(), "Paired phone 3".to_string()],
            "labels are distinct, like the ids they follow"
        );

        desk.forget_device(1).unwrap();
        desk.forget_device(2).unwrap();
        assert!(!file.exists(), "the last device leaving empties the store");
        assert!(matches!(*desk.state.lock().unwrap(), State::Idle));
    }

    /// The production shape end to end: the host is enrolled FIRST, a phone
    /// pairs and acknowledges, and the acknowledgement truly lands in the
    /// store — a fresh desk rebuilds no pending delivery, and the same
    /// token cannot collect the seal again inside the window.
    #[test]
    fn an_acknowledged_delivery_stays_cleared_after_a_restart() {
        let file = scratch("ack-restart");
        kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();

        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().unwrap());
        assert!(desk.claim(&code, now));
        let declaration =
            PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone()).unwrap();
        let token = declaration.delivery_token().to_string();
        let replay = declaration
            .sign_again(&code, &nonce, &reachable, None, a_phone())
            .unwrap();
        assert!(desk.complete(declaration, now).is_some(), "the pairing seals");
        desk.acknowledge(&token);

        let fresh = Desk::new(file.clone());
        let dto = serde_json::to_value(fresh.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert_eq!(
            dto["delivery_pending"], false,
            "a restart must not rebuild an acknowledged delivery"
        );
        assert!(
            fresh.complete(replay, now).is_none(),
            "the acknowledged seal must not replay inside the window"
        );
    }

    /// A LATE ack: between writing A's response and acknowledging it, the
    /// owner retries and phone B completes, so the desk's state no longer
    /// holds A's pending. The ack must still clear A's store record - and
    /// only A's: B's delivery survives, and a fresh desk rebuilds no pending
    /// for A.
    #[test]
    fn a_late_acknowledgement_still_clears_its_own_delivery() {
        let file = scratch("late-ack");
        kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();

        desk.read(true, "http://127.0.0.1:1", None, now);
        let first = declaration_for(&desk, a_phone(), now);
        let first_token = first.delivery_token().to_string();
        assert!(desk.complete(first, now).is_some(), "phone A pairs");

        // The ack lands in the gap: the owner has retried (the desk is
        // Live again) and phone B has not completed yet, so the in-memory
        // state holds nothing of A's.
        desk.retry(true, "http://127.0.0.1:1", None, now);
        desk.acknowledge(&first_token);

        let second = declaration_for(
            &desk,
            PhoneModel {
                weights_bytes: 3_000_000_000,
                ..a_phone()
            },
            now,
        );
        assert!(desk.complete(second, now).is_some(), "phone B pairs behind A");

        let devices = kalsa_pairing::store::load_devices(&file).unwrap();
        let deliveries: Vec<(u32, bool)> = devices
            .iter()
            .filter(|device| device.kind == DeviceKind::Phone)
            .map(|device| (device.id, device.delivery.is_some()))
            .collect();
        assert!(
            deliveries.iter().any(|&(id, held)| id == 1 && !held),
            "A's delivery is cleared by the late ack"
        );
        // B completes AFTER the ack here, so B's delivery cannot speak to
        // the ack's selectivity - that is the next test's subject. What this
        // half shows is the restart: nothing is rebuilt for A.
        let fresh = Desk::new(file.clone());
        let dto = serde_json::to_value(fresh.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert_eq!(
            dto["delivery_pending"], false,
            "a restart must not rebuild A's acknowledged delivery"
        );
        let _ = std::fs::remove_dir_all(file.parent().expect("scratch dir"));
    }

    /// The reproduced ordering: the ack lands AFTER phone B has completed,
    /// so the in-memory state is Paired around B and holds nothing of A's -
    /// the exact state whose token-mismatch return used to drop A's ack.
    /// The clear must still reach A's record by token, and only A's.
    #[test]
    fn an_ack_landing_after_another_phone_completes_clears_only_its_own_delivery() {
        let file = scratch("ack-after-b");
        kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();

        desk.read(true, "http://127.0.0.1:1", None, now);
        let first = declaration_for(&desk, a_phone(), now);
        let first_token = first.delivery_token().to_string();
        assert!(desk.complete(first, now).is_some(), "phone A pairs");

        desk.retry(true, "http://127.0.0.1:1", None, now);
        let second = declaration_for(
            &desk,
            PhoneModel {
                weights_bytes: 3_000_000_000,
                ..a_phone()
            },
            now,
        );
        assert!(desk.complete(second, now).is_some(), "phone B pairs");

        desk.acknowledge(&first_token);

        let devices = kalsa_pairing::store::load_devices(&file).unwrap();
        let by_id = |id: u32| devices.iter().find(|d| d.id == id).unwrap();
        assert!(
            by_id(1).delivery.is_none(),
            "A's delivery is cleared by an ack that arrives after B completed"
        );
        assert!(
            by_id(2).delivery.is_some(),
            "B's delivery must survive A's ack - the clear is keyed by token"
        );
        let _ = std::fs::remove_dir_all(file.parent().expect("scratch dir"));
    }

    /// An ack against an UNREADABLE store: the response was written, which
    /// is what an ack means, so the in-memory pending must go even though
    /// the store copy could not be cleared - and complete must not serve
    /// that seal again to a matching token.
    #[test]
    fn an_acknowledgement_spends_the_pending_even_when_the_store_cannot_be_read() {
        let file = scratch("ack-unreadable");
        kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();

        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().unwrap());
        assert!(desk.claim(&code, now));
        let declaration =
            PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone()).unwrap();
        let token = declaration.delivery_token().to_string();
        let replay = declaration
            .sign_again(&code, &nonce, &reachable, None, a_phone())
            .unwrap();
        assert!(desk.complete(declaration, now).is_some(), "the pairing seals");

        // A later record the PARSER refuses: a valid JSON document whose
        // record is missing required fields, so every store read fails.
        // (A record that merely fails to realize no longer stops the clear:
        // clear_delivery matches raw records by token and never realizes,
        // so the parse-refusing record is the unreadable case that
        // remains.)
        let mut doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        doc["devices"]
            .as_array_mut()
            .expect("the store document holds a device array")
            .push(serde_json::json!({"id": 99, "label": "broken"}));
        std::fs::write(&file, doc.to_string()).unwrap();

        desk.acknowledge(&token);
        assert!(
            desk.complete(replay, now).is_none(),
            "the in-memory pending must be spent even though the store clear failed"
        );
        let _ = std::fs::remove_dir_all(file.parent().expect("scratch dir"));
    }

    /// Refusing the last phone must leave an UNPAIRED desk: the host's own
    /// record is always in the store, so emptiness is never what happens —
    /// `new`'s rule is, and a desk that stayed Paired would keep drawing the
    /// refused phone's success sentence.
    #[test]
    fn refusing_the_last_phone_leaves_the_host_only_desk_idle() {
        let file = scratch("refuse-last");
        let host = "aa".repeat(32);
        let phone = "bb".repeat(32);
        let fields = r#"{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}"#;
        std::fs::write(
            &file,
            format!(
                r#"{{"v":2,"devices":[
                    {{"id":0,"label":"This computer","kind":"Host","credential_hex":"{host}"}},
                    {{"id":1,"label":"Waiting phone","credential_hex":"{phone}","phone":{fields},"approval":"Waiting"}}]}}"#
            ),
        )
        .unwrap();
        let desk = Desk::new(file);
        assert!(
            matches!(*desk.state.lock().unwrap(), State::Paired { .. }),
            "the store holds a phone, so the desk is paired as new reads it"
        );

        desk.forget_device(1).expect("the owner refuses it");

        assert!(
            matches!(*desk.state.lock().unwrap(), State::Idle),
            "a host-only store is an unpaired desk"
        );
    }

    /// Forgetting a stored phone must not burn a live ceremony: "Pair
    /// another phone" and Forget sit on the same card, so the owner can be
    /// tidying the old phone out while a new one is part-way through. Only
    /// a PAIRED desk falls back to Idle (the test above); a desk holding a
    /// claimed square keeps it.
    #[test]
    fn forgetting_the_last_phone_spares_a_live_ceremony() {
        let file = scratch("forget-live");
        kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();

        desk.read(true, "http://127.0.0.1:1", None, now);
        desk.complete(declaration_for(&desk, a_phone(), now), now)
            .expect("the first pairing seals");
        let old_id = kalsa_pairing::store::load_devices(&file)
            .unwrap()
            .into_iter()
            .find(|device| device.kind == DeviceKind::Phone)
            .unwrap()
            .id;

        // The owner pairs another phone: a fresh square, claimed by it.
        desk.retry(true, "http://127.0.0.1:1", None, now);
        let in_flight = declaration_for(&desk, a_phone(), now);

        desk.forget_device(old_id).unwrap();
        assert!(
            matches!(*desk.state.lock().unwrap(), State::Live { .. }),
            "forgetting a stored phone must not burn the ceremony another phone is in"
        );
        assert!(
            desk.complete(in_flight, now).is_some(),
            "the claimed ceremony still completes"
        );
    }

    /// Paired is a snapshot of ONE phone, so a forget that leaves phones
    /// behind must rebuild it from the store: after the owner refuses the
    /// newest phone, the page names the phone that remains and awaits only
    /// its delivery — never the refused phone's name or its pending
    /// response. The host is seated FIRST, the production shape:
    /// clear_delivery keys on the delivery token, so A's acknowledgement
    /// reaches A's record even behind the host's.
    #[test]
    fn refusing_a_phone_rebuilds_the_paired_snapshot_from_the_store() {
        let file = scratch("forget-snapshot");
        kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();

        desk.read(true, "http://127.0.0.1:1", None, now);
        let first = declaration_for(&desk, a_phone(), now);
        let first_token = first.delivery_token().to_string();
        assert!(desk.complete(first, now).is_some(), "phone A pairs");
        desk.acknowledge(&first_token);

        desk.retry(true, "http://127.0.0.1:1", None, now);
        let second = declaration_for(
            &desk,
            PhoneModel {
                weights_bytes: 3_000_000_000,
                ..a_phone()
            },
            now,
        );
        assert!(desk.complete(second, now).is_some(), "phone B pairs");

        let refused_id = kalsa_pairing::store::load_devices(&file)
            .unwrap()
            .into_iter()
            .filter(|device| device.kind == DeviceKind::Phone)
            .map(|device| device.id)
            .max()
            .unwrap();
        desk.forget_device(refused_id).unwrap();

        let dto = serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert_eq!(
            dto["phone"], "phone with 2 GB of model weights",
            "the paired snapshot must name the phone that remains, not the refused one"
        );
        assert_eq!(
            dto["delivery_pending"], false,
            "the remaining phone acknowledged its response; nothing is pending"
        );
    }

    /// An add that cannot happen — the ids are exhausted here — consumes
    /// the ceremony and reports could-not-save. It can never become an
    /// owner-facing question: the replace state no longer exists.
    #[test]
    fn a_failed_add_is_refused_without_becoming_a_prompt() {
        let file = scratch("add-refused");
        let credential = "ef".repeat(32);
        std::fs::write(
            &file,
            format!(
                r#"{{"v":2,"devices":[{{"id":4294967295,"label":"Last","credential_hex":"{credential}","phone":{{"weights_bytes":1,"parameters":null,"measured_tokens_per_second":null,"battery_powered":null}}}}]}}"#
            ),
        )
        .unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        desk.retry(true, "http://127.0.0.1:1", None, now);
        let declaration = declaration_for(&desk, a_phone(), now);
        assert!(desk.complete(declaration, now).is_none(), "no id, no seal");

        let dto = serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert_eq!(dto["state"], "failed");
        assert_eq!(dto["failure"], "could-not-save");
        assert_eq!(
            kalsa_pairing::store::load_devices(&file).unwrap().len(),
            1,
            "the refused add stored nothing"
        );
    }

    /// A proof keyed on anything but this square mints nothing, and moves
    /// nothing either: the refusal changes no state, so the ceremony is
    /// still the real phone's to finish.
    #[test]
    fn a_proof_from_another_square_mints_nothing() {
        let desk = Desk::new(scratch("wrong-proof"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().expect("square"));
        assert!(desk.claim(&code, now));

        let stranger = "0".repeat(code.len());
        let forged = PhoneDeclaration::sign(&stranger, &nonce, &reachable, None, a_phone())
            .expect("a well-formed message keyed on the wrong secret");
        assert!(desk.complete(forged, now).is_none(), "no seal");
        assert!(desk.phone().unwrap().is_none(), "and no credential");
    }

    /// A wrong proof spends nothing: it is refused, the claim stands, and
    /// the real phone's correct proof afterwards pairs.
    #[test]
    fn a_wrong_proof_leaves_the_square_to_the_real_phone() {
        let desk = Desk::new(scratch("wrong-then-right"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().expect("square"));
        assert!(desk.claim(&code, now));

        let stranger = "0".repeat(code.len());
        let forged = PhoneDeclaration::sign(&stranger, &nonce, &reachable, None, a_phone()).unwrap();
        assert!(desk.complete(forged, now).is_none());

        let honest = PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone()).unwrap();
        assert!(
            desk.complete(honest, now).is_some(),
            "the refusal spent nothing: the real phone still pairs"
        );
        let devices = kalsa_pairing::store::load_devices(desk.file()).expect("the store reads");
        assert!(
            devices
                .iter()
                .any(|device| device.kind == DeviceKind::Phone),
            "the phone is in the house"
        );
    }

    /// A square is only offered while there is something behind it.
    #[test]
    fn nothing_is_offered_while_the_server_is_down() {
        let desk = Desk::new(scratch("idle"));
        desk.read(false, "http://127.0.0.1:1", None, SystemTime::now());
        assert!(desk.test_square().is_none());
    }

    #[test]
    fn a_failed_first_save_never_returns_success_to_the_phone() {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-brain-pairing-missing-parent-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let desk = Desk::new(dir.join("pairing.json"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);

        let declaration = declaration_for(&desk, a_phone(), now);
        assert!(desk.complete(declaration, now).is_none());
        let dto = serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert_eq!(dto["state"], "failed");
        assert_eq!(dto["failure"], "could-not-save");
        assert!(desk.phone().unwrap().is_none());
    }

    #[test]
    fn a_saved_pairing_can_retry_when_its_success_response_was_lost() {
        let desk = Desk::new(scratch("delivery-retry"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().unwrap());
        assert!(desk.claim(&code, now));
        let declaration = PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone()).unwrap();
        let retry = declaration
            .sign_again(&code, &nonce, &reachable, None, a_phone())
            .unwrap();
        assert!(desk.complete(declaration, now).is_some());
        // The first response may have been written to a dead socket. The
        // same phone's idempotent retry gets the same sealed credential.
        assert!(desk.complete(retry, now).is_some());
        // The catalog needs Allow now; this test's subject - the
        // idempotent retry - is unchanged, so Allow, then the same read.
        desk.allow_device(0).expect("the owner allows the phone");
        assert_eq!(desk.phone().unwrap().unwrap().weights_bytes, 2_000_000_000);
    }

    #[test]
    fn a_different_attempt_cannot_collect_a_saved_seal() {
        let desk = Desk::new(scratch("delivery-identity"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().unwrap());
        assert!(desk.claim(&code, now));
        let declaration = PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone()).unwrap();
        let changed_measurement = declaration
            .sign_again(
                &code,
                &nonce,
                &reachable,
                None,
                PhoneModel {
                    weights_bytes: 3_000_000_000,
                    ..a_phone()
                },
            )
            .unwrap();
        let stranger = PhoneDeclaration::sign(
            &code,
            &nonce,
            &reachable,
            None,
            PhoneModel {
                weights_bytes: 4_000_000_000,
                ..a_phone()
            },
        )
        .unwrap();

        assert!(desk.complete(declaration, now).is_some());
        assert!(desk.complete(changed_measurement, now).is_some());
        assert!(desk.complete(stranger, now).is_none());
    }

    #[test]
    fn a_saved_seal_expires_with_the_square() {
        let desk = Desk::new(scratch("delivery-expiry"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().unwrap());
        assert!(desk.claim(&code, now));
        let declaration = PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone()).unwrap();
        let retry = declaration
            .sign_again(&code, &nonce, &reachable, None, a_phone())
            .unwrap();
        assert!(desk.complete(declaration, now).is_some());
        assert!(desk
            .complete(retry, now + WINDOW + Duration::from_secs(1))
            .is_none());
        // The catalog needs Allow now; this test's subject - the seal's
        // expiry - is unchanged, so Allow, then the same read.
        desk.allow_device(0).expect("the owner allows the phone");
        assert!(desk.phone().unwrap().is_some());
    }

    #[test]
    fn a_saved_delivery_survives_a_restart_and_a_changed_measurement() {
        let path = scratch("delivery-restart");
        let now = SystemTime::now();
        let desk = Desk::new(path.clone());
        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().unwrap());
        assert!(desk.claim(&code, now));
        let declaration = PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone()).unwrap();
        let retry = declaration
            .sign_again(
                &code,
                &nonce,
                &reachable,
                None,
                PhoneModel {
                    weights_bytes: 3_000_000_000,
                    ..a_phone()
                },
            )
            .unwrap();
        assert!(desk.complete(declaration, now).is_some());
        drop(desk);

        let restored = Desk::new(path);
        let dto = serde_json::to_value(restored.read(
            true,
            "http://127.0.0.1:1",
            None,
            now + Duration::from_secs(1),
        ))
        .unwrap();
        assert_eq!(dto["delivery_pending"], true);
        assert!(restored
            .complete(retry, now + Duration::from_secs(1))
            .is_some());
    }

    #[test]
    fn a_retried_declaration_after_a_completed_ceremony_receives_the_same_seal() {
        let file = scratch("replay");
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().unwrap());
        assert!(desk.claim(&code, now));
        let first = PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone()).unwrap();
        let retry_declaration = first
            .sign_again(&code, &nonce, &reachable, None, a_phone())
            .unwrap();
        assert!(desk.complete(first, now).is_some());

        // The same declaration again — a lost HTTP reply — is answered from
        // the retained delivery, idempotently, and stores nothing twice.
        assert!(desk.complete(retry_declaration, now).is_some());
        assert_eq!(
            kalsa_pairing::store::load_devices(&file).unwrap().len(),
            1,
            "the retry added no device"
        );
    }

    #[test]
    fn stopping_the_server_retires_the_square_and_blocks_routes() {
        let desk = Desk::new(scratch("stop"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        let payload = desk.test_square().unwrap();
        let (code, _, _) = secrets(&payload);
        desk.stop_serving();
        assert!(!desk.is_serving());
        assert!(!desk.claim(&code, now));
        assert!(desk.test_square().is_none());
        desk.retry(false, "http://127.0.0.1:1", None, now);
        assert!(desk.test_square().is_none());
        desk.retry(true, "http://127.0.0.1:1", None, now);
        assert!(desk.test_square().is_none());
    }

    #[test]
    fn an_unreadable_store_is_not_reported_as_unpaired() {
        let path = scratch("unreadable");
        std::fs::write(&path, b"not a pairing file").unwrap();
        let desk = Desk::new(path);
        let dto =
            serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, SystemTime::now())).unwrap();
        assert_eq!(dto["state"], "failed");
        assert_eq!(dto["failure"], "could-not-read");
        assert!(desk.phone().is_err());
    }

    #[test]
    fn an_owner_can_forget_an_unreadable_store_and_pair_again() {
        let path = scratch("forget-unreadable");
        std::fs::write(&path, b"not a pairing file").unwrap();
        let desk = Desk::new(path);
        assert_eq!(
            serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, SystemTime::now())).unwrap()
                ["failure"],
            "could-not-read"
        );
        desk.forget().unwrap();
        let dto =
            serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, SystemTime::now())).unwrap();
        assert_eq!(dto["state"], "waiting");
        assert!(dto["qr_svg"].as_str().is_some_and(|qr| !qr.is_empty()));
        assert!(desk.phone().unwrap().is_none());
    }

    #[test]
    fn the_listener_failure_is_visible_and_does_not_offer_a_square() {
        let desk = Desk::new(scratch("listener-failed"));
        desk.read(true, "http://127.0.0.1:1", None, SystemTime::now());
        desk.listener_failed();
        let dto =
            serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, SystemTime::now())).unwrap();
        assert_eq!(dto["state"], "failed");
        assert_eq!(dto["failure"], "service-unavailable");
        assert_eq!(dto["qr_svg"], serde_json::Value::Null);
    }

    /// A host is the machine's own record, not a phone it is paired with:
    /// the desk stays Idle, the square still appears, and the catalog gets
    /// no phone model — never a zero-weight guest.
    #[test]
    fn a_host_alone_is_not_a_pairing() {
        let file = scratch("host-only");
        kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        assert!(matches!(*desk.state.lock().unwrap(), State::Idle));
        assert!(
            desk.phone().unwrap().is_none(),
            "the host is no phone to hand the catalog"
        );

        let dto =
            serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, SystemTime::now()))
                .unwrap();
        assert_eq!(dto["state"], "waiting", "the square still appears");
        assert!(dto["qr_svg"].as_str().is_some_and(|qr| !qr.is_empty()));
    }

    /// The command's pre-check: the host's row is recognisable, so the
    /// Forget call can refuse it even though the page does not draw the
    /// button. The store itself can still forget a host; this is the page's
    /// one-device gesture that may not.
    #[test]
    fn the_host_is_recognised_and_a_phone_is_not() {
        let file = scratch("host-is-host");
        let host = kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        assert!(desk.is_host(host.id), "the host's own id is the host");
        assert!(
            !desk.is_host(host.id + 1),
            "an id the store does not hold is not the host"
        );

        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        desk.complete(declaration_for(&desk, a_phone(), now), now)
            .expect("a phone pairs beside the host");
        let phones = kalsa_pairing::store::load_devices(&file)
            .unwrap()
            .into_iter()
            .filter(|device| device.kind == DeviceKind::Phone)
            .map(|device| device.id)
            .collect::<Vec<_>>();
        assert_eq!(phones.len(), 1);
        assert!(
            !desk.is_host(phones[0]),
            "a paired phone is not this computer"
        );
    }

    /// The host has no Forget, end to end: the page draws no button for its
    /// row, the command asks `is_host` first for its sentence — and THIS is
    /// the layer beneath both, where a gesture that reached the method
    /// anyway is refused, the store's bytes do not move, and the phone
    /// beside it still forgets like any phone.
    #[test]
    fn forgetting_the_host_is_refused_and_leaves_the_store_unchanged() {
        let file = scratch("forget-host-refused");
        let host = kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        desk.complete(declaration_for(&desk, a_phone(), now), now)
            .expect("a phone pairs beside the host");
        let before = std::fs::read(&file).expect("the store's bytes");

        let error = desk
            .forget_device(host.id)
            .expect_err("the host has no Forget");
        assert!(matches!(error, ForgetError::Host), "{error:?}");
        assert_eq!(
            std::fs::read(&file).expect("the store's bytes again"),
            before,
            "a refused forget must not touch a byte of the store"
        );

        // The gesture still does what it is for.
        let phone = kalsa_pairing::store::load_devices(&file)
            .unwrap()
            .into_iter()
            .find(|device| device.kind == DeviceKind::Phone)
            .expect("the phone")
            .id;
        desk.forget_device(phone).expect("a phone forgets");
        let after = kalsa_pairing::store::load_devices(&file).unwrap();
        assert_eq!(after.len(), 1, "only one record is left");
        assert!(
            after.iter().all(|device| device.kind == DeviceKind::Host),
            "and it is the host, still in its seat"
        );
    }

    /// The host credential leaves by one road only — the expression
    /// `brain_host_credential` answers with, asserted as the positive
    /// control below. Every other surface this page is handed must be free
    /// of it: the dd4a12d rule for prompts, applied to the PC's own key.
    /// Covered, exhaustively for shapes fed from the STORE the credential
    /// lives in: the pairing DTO with its devices list, the whole state
    /// answer (its metrics as production's `snapshot` builds them, its
    /// failure arm as `failure::words` builds it), the failure sentences
    /// themselves, and the `StoredDevice` probe. Every other `Serialize`
    /// struct in src-tauri — capability's Machine/ModelChoice/Capability/
    /// Speed, files' Roots/Listing/Search, measurement's Record, options'
    /// Advanced, startup's Progress, main's ModelDto — is built from
    /// machine, catalog, file or settings data that never reads the store,
    /// so the credential has no road into them. And whatever could PRINT
    /// it must not: the record that holds it answers through `DebugText`,
    /// which reports what a `{:?}` would emit (nothing at all when the type
    /// offers no Debug — the store's deliberate "No Debug on purpose") —
    /// so a Debug that leaks the credential reddens this test while a
    /// redacting Debug passes it.
    #[test]
    fn the_host_credential_leaves_only_by_its_own_command() {
        use crate::failure::StartupFailure;

        struct DebugText<'a, T>(&'a T);
        // The specific answer first: an inherent method wins whenever the
        // bound holds, so a type WITH Debug is printed for real.
        impl<'a, T: std::fmt::Debug> DebugText<'a, T> {
            fn debug_output(&self) -> String {
                format!("{:?}", self.0)
            }
        }
        // The blanket behind it answers for a type with no Debug at all:
        // method resolution falls through when the inherent bound fails —
        // that fall-through is the whole probe, and `String::new()` is what
        // "prints nothing" means.
        trait NoDebugOutput {
            fn debug_output(&self) -> String;
        }
        impl<'a, T> NoDebugOutput for DebugText<'a, T> {
            fn debug_output(&self) -> String {
                String::new()
            }
        }
        // What this probe does NOT cover: it is applied to StoredDevice
        // alone. A hand-written `impl Debug` on Handshake, PairedDeviceDto
        // or Desk would sit outside its reach — those shapes are seen only
        // by the serialised-form patrol above, and only as serialised, never
        // as a `{:?}`. The gap is stated rather than silently assumed; a
        // probe per type is the day one of them grows a Debug worth fearing.

        let file = scratch("credential-patrol");
        let host = kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        desk.complete(declaration_for(&desk, a_phone(), now), now)
            .expect("a phone pairs beside the host");
        let devices = kalsa_pairing::store::load_devices(&file).unwrap();
        let host_device = devices
            .iter()
            .find(|device| device.id == host.id)
            .expect("the host record");
        // The positive control: this is the exact string the page's
        // brain_host_credential command answers with.
        let credential = host_device.handshake.credential_hex();
        assert!(!credential.is_empty(), "the secret this test patrols");

        // The pairing DTO, devices list included, as the page receives it —
        // with the host row really in it, so the absence below means
        // something.
        let pairing =
            serde_json::to_string(&desk.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert!(
            pairing.contains("This computer"),
            "the host row is in the DTO"
        );
        assert!(
            !pairing.contains(&credential),
            "the pairing DTO carries the host credential"
        );

        // The state answer the page polls, carrying the metrics AS
        // PRODUCTION BUILDS THEM: the real `RuntimeMetrics::snapshot` over
        // the door's own shapes (the host among the busy), a tier with a
        // disk scan beside it — the Running arm's whole nest in one
        // serialised value: ActiveDeviceDto, TierDto, DiskScanDto and
        // RuntimeMetricsDto together.
        let runtime = crate::metrics::RuntimeMetrics::new(std::sync::Arc::new(
            std::sync::atomic::AtomicU64::new(0),
        ));
        let metrics = runtime.snapshot(
            Some(vec![
                crate::metrics::ActiveDeviceDto {
                    id: host.id,
                    label: kalsa_pairing::store::HOST_LABEL.to_string(),
                    kind: "host",
                },
                crate::metrics::ActiveDeviceDto {
                    id: host.id + 1,
                    label: "Pixel 9a (stub)".to_string(),
                    kind: "phone",
                },
            ]),
            Some(crate::metrics::TierDto {
                capacity: 4,
                residents: 1,
                disk: Some(crate::metrics::DiskScanDto {
                    bytes: 1,
                    files: 1,
                    unreadable: 0,
                }),
            }),
        );
        let state = crate::StateDto::Running {
            port: 8131,
            endpoint: Some("http://127.0.0.1:8131/v1".to_string()),
            model: Some("a row".to_string()),
            reason: Some("a reason".to_string()),
            asleep: Some(false),
            metrics,
        };
        let state_json = serde_json::to_string(&state).unwrap();
        assert!(
            state_json.contains("This computer"),
            "the state DTO was built with the busy host in it"
        );
        assert!(
            !state_json.contains(&credential),
            "the state DTO carries the host credential"
        );
        // The other arm of the same enum, as the page reads a failure.
        let failed = serde_json::to_string(&crate::StateDto::Failed {
            reason: crate::failure::words(&StartupFailure::NothingFits),
        })
        .unwrap();
        assert!(
            !failed.contains(&credential),
            "the failed state carries the host credential"
        );

        // Every failure sentence the walk can say, exhaustively over the
        // enum the sentences are exhaustive over.
        let sentences = [
            StartupFailure::Supervisor(kalsa_supervisor::Failure::PortTaken),
            StartupFailure::NoBuildForThisMachine,
            StartupFailure::ServerUnverified,
            StartupFailure::NoBackendWorked,
            StartupFailure::ServerFetchFailed,
            StartupFailure::MachineNotMeasured,
            StartupFailure::NothingFits,
            StartupFailure::NothingBetter,
            StartupFailure::NothingFastEnough,
            StartupFailure::ChosenModelUnfundable,
            StartupFailure::ChosenModelContextUnreadable,
            StartupFailure::ContextTooLarge {
                maximum_tokens: 0,
                cache: None,
            },
            StartupFailure::ChosenModelUnresolved,
            StartupFailure::MeasurementUnreliable(vec!["a note".to_string()]),
            StartupFailure::SlotSavePathUnwritable,
            StartupFailure::WeightsUnverified,
            StartupFailure::NotEnoughDisk,
            StartupFailure::DownloadCorrupted,
            StartupFailure::ConnectionLost,
            StartupFailure::DownloadRefused,
            StartupFailure::ModelFileUnwritable,
        ];
        for failure in &sentences {
            let words = crate::failure::words(failure);
            assert!(
                !words.contains(&credential),
                "a failure sentence carries the host credential: {words}"
            );
        }

        // The stored device itself, as any {:?} would print it.
        let printed = DebugText(host_device).debug_output();
        assert!(
            !printed.contains(&credential),
            "a Debug of the stored device prints the host credential: {printed}"
        );
    }

    /// A host and a phone: the PHONE decides the state, and the catalog gets
    /// the phone's model. The host rides in the device list with its kind.
    #[test]
    fn the_phone_still_decides_when_a_host_is_present() {
        let file = scratch("host-and-phone");
        // The host is enrolled first, as a fresh install would: id 0.
        kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        desk.complete(declaration_for(&desk, a_phone(), now), now)
            .expect("the phone pairs beside the host");

        // A fresh desk reads the store back: Paired - a waiting phone is
        // still a stored phone, so the STATE half of the old behaviour is
        // unchanged. The catalog half needs Allow: the host took id 0, so
        // the phone holds id 1.
        let desk = Desk::new(file.clone());
        assert!(matches!(*desk.state.lock().unwrap(), State::Paired { .. }));
        desk.allow_device(1).expect("the owner allows the phone");
        let phone = desk.phone().unwrap().expect("the phone is still the phone");
        assert_eq!(phone.weights_bytes, 2_000_000_000);

        let dto = serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert_eq!(dto["devices"][0]["kind"], "host");
        assert_eq!(dto["devices"][1]["kind"], "phone");
    }

    /// Forgetting the host from a host-only store leaves the desk where it
    /// already was — Idle — because a host never made it Paired. Two roads
    /// may reach that store forget: the page's one-device gesture, which
    /// now refuses the host (pinned above), and the store's own — the
    /// hatch's, which must be able to empty any file, host included.
    #[test]
    fn forgetting_the_host_leaves_the_desk_idle() {
        let file = scratch("forget-host-desk");
        let host = kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        assert!(matches!(*desk.state.lock().unwrap(), State::Idle));

        desk.forget_device(host.id)
            .expect_err("the page's gesture refuses the host");
        kalsa_pairing::store::forget_device(&file, host.id).expect("the store's own forget");
        assert!(!file.exists(), "the host was the whole store");
        assert!(matches!(*desk.state.lock().unwrap(), State::Idle));
    }
}
