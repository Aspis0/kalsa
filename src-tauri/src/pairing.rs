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
//! * **Replacing a phone is the owner's act.** A completed ceremony whose
//!   credential cannot be stored because one is already stored does not
//!   overwrite it and does not throw it away: it waits, in `Replace`, until
//!   the owner says which phone is theirs.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use kalsa_catalog::PhoneModel;
use kalsa_pairing::{Handshake, Pairing, PairingSeal, PhoneDeclaration, StoreError};
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
    /// No name travels with it. The phone's declaration carries capability —
    /// weights, parameters, a measured rate — and nothing a person would
    /// call a name, because the MAC binds what is declared and nobody has
    /// declared one yet. The page already says "your phone" when it is given
    /// nothing, which is true; a name made up here would not be.
    Paired {
        phone: PhoneModel,
        /// Retained so a lost HTTP response can be retried idempotently.
        pending: Option<PendingDelivery>,
    },
    /// A phone completed the ceremony, but a credential is already stored.
    /// The new handshake waits here for the owner's decision; it is never
    /// written without one.
    Replace {
        phone: PhoneModel,
        incoming: Box<Handshake>,
        pending: PendingDelivery,
    },
    /// The ceremony finished and the credential could not be written.
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

/// What the Pairing page reads, polled. The field names and the vocabulary
/// are the page's contract (`src/pages/pairing.js`), not this module's to
/// rename.
#[derive(Serialize)]
pub(crate) struct PairingDto {
    kind: &'static str,
    state: &'static str,
    qr_svg: Option<String>,
    refreshed: Option<&'static str>,
    phone: Option<String>,
    new_phone: Option<String>,
    delivery_pending: bool,
    failure: Option<&'static str>,
    door_port: Option<u16>,
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
        let state = match kalsa_pairing::store::load_with_delivery(&file) {
            Ok((handshake, delivery)) => {
                let pending = delivery
                    .and_then(PendingDelivery::from_store)
                    .filter(|pending| SystemTime::now() < pending.expires_at);
                State::Paired {
                    phone: handshake.phone,
                    pending,
                }
            }
            Err(StoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                State::Idle
            }
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
        match kalsa_pairing::store::load(&self.file) {
            Ok(handshake) => Ok(Some(handshake.phone)),
            Err(StoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error),
        }
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
            return dto(&State::ServiceUnavailable);
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
            | State::Replace { .. }
            | State::CouldNotSave
            | State::StoreUnavailable
            | State::ServiceUnavailable => {}
            _ if !serving => *state = State::Idle,
            State::Idle => *state = Self::fresh(reachable, node, now, None, None),
            State::Live { .. } => {}
        }
        dto(&state)
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
            State::Replace { .. } | State::StoreUnavailable | State::ServiceUnavailable
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

    /// The owner's decision on a phone that asked to take over. `replace`
    /// writes the waiting credential over the stored one; keeping does not
    /// write anything and the new phone is simply dropped.
    pub(crate) fn decide(&self, replace: bool, now: SystemTime) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let previous = std::mem::replace(&mut *state, State::CouldNotSave);
        let State::Replace {
            phone,
            incoming,
            pending,
        } = previous
        else {
            *state = previous;
            return;
        };
        if !replace {
            *state = State::Paired {
                phone,
                pending: None,
            };
            return;
        }
        if now >= pending.expires_at {
            *state = State::Paired {
                phone,
                pending: None,
            };
            return;
        }
        // Replacement is one atomic publication. The old file remains until
        // the new, verified file is ready, so a failed write cannot lose both
        // phones. The waiting phone got a refusal before this owner decision;
        // after a successful choice it retries its declaration and receives
        // the retained seal below. Keeping the old phone drops that seal.
        let Some(delivery) = pending.as_store_delivery() else {
            *state = State::Paired {
                phone,
                pending: None,
            };
            return;
        };
        *state = match kalsa_pairing::store::replace_with_delivery(&incoming, &self.file, delivery)
        {
            Ok(()) => State::Paired {
                phone: incoming.phone,
                pending: Some(pending),
            },
            Err(_) => State::Paired {
                phone,
                pending: None,
            },
        };
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

    /// A phone presents its proof. On success the credential is written here
    /// and the seal goes back to the phone; a credential that is already
    /// stored parks the result in `Replace` for the owner to decide.
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
        let State::Live {
            pairing, previous, ..
        } = &mut *state
        else {
            return None;
        };
        let previous_phone = *previous;
        let delivery_token = declaration.delivery_token().to_string();
        let expires_at = pairing.expires_at()?;
        let (handshake, seal) = pairing.complete(declaration, now).ok()?;
        let pending = PendingDelivery {
            delivery_token,
            seal: seal.clone(),
            expires_at,
        };
        let Some(delivery) = pending.as_store_delivery() else {
            *state = State::CouldNotSave;
            return None;
        };
        match kalsa_pairing::store::persist_with_delivery(&handshake, &self.file, delivery) {
            Ok(()) => {
                *state = State::Paired {
                    phone: handshake.phone,
                    pending: Some(pending),
                };
                Some(seal)
            }
            Err(StoreError::AlreadyPaired) => {
                let Some(phone) = previous_phone else {
                    *state = State::CouldNotSave;
                    return None;
                };
                *state = State::Replace {
                    phone,
                    incoming: Box::new(handshake),
                    pending,
                };
                // The owner must decide before this phone can be told that it
                // succeeded; transport turns this None into the uniform 403.
                None
            }
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
    pub(crate) fn forget(&self) -> Result<(), StoreError> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if !matches!(*state, State::StoreUnavailable) {
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
fn dto(state: &State) -> PairingDto {
    let empty = PairingDto {
        kind: "pairing",
        state: "idle",
        qr_svg: None,
        refreshed: None,
        phone: None,
        new_phone: None,
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
            delivery_pending: pending.is_some(),
            ..empty
        },
        State::Replace {
            phone, incoming, ..
        } => PairingDto {
            state: "replace",
            phone: Some(phone_label(*phone)),
            new_phone: Some(phone_label(incoming.phone)),
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
    fn replacement_waits_for_the_owner_and_retries_delivery_after_publish() {
        let desk = Desk::new(scratch("replace-flow"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", None, now);
        let first = declaration_for(&desk, a_phone(), now);
        assert!(desk.complete(first, now).is_some());

        desk.retry(true, "http://127.0.0.1:1", None, now);
        let second_phone = PhoneModel {
            weights_bytes: 3_000_000_000,
            ..a_phone()
        };
        let second = declaration_for(&desk, second_phone, now);
        assert!(desk.complete(second, now).is_none());
        let dto = serde_json::to_value(desk.read(true, "http://127.0.0.1:1", None, now)).unwrap();
        assert_eq!(dto["state"], "replace");
        assert_eq!(dto["phone"], "phone with 2 GB of model weights");
        assert_eq!(dto["new_phone"], "phone with 3 GB of model weights");
        assert_eq!(desk.phone().unwrap().unwrap().weights_bytes, 2_000_000_000);

        // Keeping the old phone is a real refusal, not a delayed success.
        desk.decide(false, now);
        assert_eq!(desk.phone().unwrap().unwrap().weights_bytes, 2_000_000_000);

        desk.retry(true, "http://127.0.0.1:1", None, now);
        let third_phone = PhoneModel {
            weights_bytes: 4_000_000_000,
            ..a_phone()
        };
        let (code, nonce, reachable) = secrets(&desk.test_square().unwrap());
        assert!(desk.claim(&code, now));
        let third = PhoneDeclaration::sign(&code, &nonce, &reachable, None, third_phone).unwrap();
        let retry_declaration = third
            .sign_again(
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
        // The third completion is parked too; retrying that exact declaration
        // after the owner's approval receives the saved seal.
        assert!(desk.complete(third, now).is_none());
        desk.decide(true, now);
        assert_eq!(desk.phone().unwrap().unwrap().weights_bytes, 4_000_000_000);
        assert!(desk.complete(retry_declaration, now).is_some());
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
}
