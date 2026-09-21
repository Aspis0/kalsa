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
//! * **A completed ceremony is the authorisation.** Nobody reaches the
//!   ceremony without scanning a code this computer displayed, so the owner
//!   showing the square IS the decision: completing the ceremony adds a
//!   device to the house. The one refusal that is not an addition is a
//!   credential the store already holds — a replay — and that one never
//!   asks the owner anything; it consumes the ceremony and reports that
//!   the connection could not be saved.

use std::path::PathBuf;
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
    /// This computer works with a phone, and the credential is on disk.
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
}

/// One stored device, as the page may see it: the store's id and label, what
/// it is, and the capability sentence the page has always shown for a phone.
/// A host carries no capability sentence — it has no phone fields — and the
/// row's rendering of that is a later commit's decision.
#[derive(Serialize)]
pub(crate) struct PairedDeviceDto {
    id: u32,
    label: String,
    kind: &'static str,
    phone: String,
}

impl PairingDto {
    pub(crate) fn with_door_port(mut self, door_port: Option<u16>) -> Self {
        self.door_port = door_port;
        self
    }
}

impl Desk {
    /// A desk for the credential kept at `file`. A credential already on disk
    /// is the paired state: the owner sees who this computer works with
    /// without any ceremony running.
    pub(crate) fn new(file: PathBuf) -> Self {
        // The WHOLE set decides, and only a phone counts as a pairing. A
        // host is this machine's own record, not a phone it is paired with:
        // a store holding only a host is an unpaired computer, and the
        // square still appears. The first record alone cannot say whether
        // the set holds a phone, so the kind-bearing set reader decides.
        let state = match kalsa_pairing::store::load_devices(&file) {
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
        };
        Self {
            state: Mutex::new(state),
            file,
            serving: AtomicBool::new(false),
            listener_failed: AtomicBool::new(false),
        }
    }

    /// The phone this computer works with, for the catalog. `None` until a
    /// ceremony has been completed and its credential written: an unpaired
    /// computer must not be handed a phone it invented.
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
            })
            .collect()
    }

    /// The owner removes ONE device from the house. The others keep their
    /// credentials and their ids; the last one leaving empties the store,
    /// and the desk with it.
    pub(crate) fn forget_device(&self, id: u32) -> Result<(), StoreError> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        kalsa_pairing::store::forget_device(&self.file, id)?;
        if kalsa_pairing::store::load_devices(&self.file)
            .is_ok_and(|devices| devices.is_empty())
        {
            *state = State::Idle;
        }
        Ok(())
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
                *pending = None;
                let _ = kalsa_pairing::store::clear_delivery(&self.file);
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

    /// A response was written successfully. Remove its durable retry record;
    /// if the write failed the record stays, so the phone can ask again.
    pub(crate) fn acknowledge(&self, delivery_token: &str) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let State::Paired { pending, .. } = &mut *state else {
            return;
        };
        let Some(saved) = pending.as_ref() else {
            return;
        };
        if !saved.token_matches(delivery_token) {
            return;
        }
        if kalsa_pairing::store::clear_delivery(&self.file).is_ok() {
            *pending = None;
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
    /// until this transport existed.
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

        let phone = desk
            .phone()
            .unwrap()
            .expect("the phone reached the catalog");
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

    /// A proof keyed on anything but this square mints nothing, and burns the
    /// square: the real phone gets a fresh one rather than a spent one.
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

    /// One attempt. A correct proof presented after a wrong one is still
    /// refused — the square is spent, not merely wrong.
    #[test]
    fn a_burnt_square_refuses_even_the_right_proof() {
        let desk = Desk::new(scratch("burnt"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        let (code, nonce, reachable) = secrets(&desk.test_square().expect("square"));
        assert!(desk.claim(&code, now));

        let stranger = "0".repeat(code.len());
        let forged = PhoneDeclaration::sign(&stranger, &nonce, &reachable, None, a_phone()).unwrap();
        assert!(desk.complete(forged, now).is_none());

        let honest = PhoneDeclaration::sign(&code, &nonce, &reachable, None, a_phone()).unwrap();
        assert!(desk.complete(honest, now).is_none(), "the square is spent");
        assert!(desk.phone().unwrap().is_none());
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

        // A fresh desk reads the store back: Paired, with the phone's model.
        let desk = Desk::new(file.clone());
        assert!(matches!(*desk.state.lock().unwrap(), State::Paired { .. }));
        let phone = desk.phone().unwrap().expect("the phone is still the phone");
        assert_eq!(phone.weights_bytes, 2_000_000_000);

        let dto = serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert_eq!(dto["devices"][0]["kind"], "host");
        assert_eq!(dto["devices"][1]["kind"], "phone");
    }

    /// Forgetting the host from a host-only store leaves the desk where it
    /// already was — Idle — because a host never made it Paired.
    #[test]
    fn forgetting_the_host_leaves_the_desk_idle() {
        let file = scratch("forget-host-desk");
        let host = kalsa_pairing::store::enrol_host(&file).unwrap();
        let desk = Desk::new(file.clone());
        assert!(matches!(*desk.state.lock().unwrap(), State::Idle));

        desk.forget_device(host.id).unwrap();
        assert!(!file.exists(), "the host was the whole store");
        assert!(matches!(*desk.state.lock().unwrap(), State::Idle));
    }
}
