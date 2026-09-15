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
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

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
    },
    /// This computer works with a phone, and the credential is on disk.
    ///
    /// No name travels with it. The phone's declaration carries capability —
    /// weights, parameters, a measured rate — and nothing a person would
    /// call a name, because the MAC binds what is declared and nobody has
    /// declared one yet. The page already says "your phone" when it is given
    /// nothing, which is true; a name made up here would not be.
    Paired,
    /// A phone completed the ceremony, but a credential is already stored.
    /// The new handshake waits here for the owner's decision; it is never
    /// written without one.
    Replace { incoming: Box<Handshake> },
    /// The ceremony finished and the credential could not be written.
    CouldNotSave,
}

/// The live ceremony, shared between the Tauri commands and the listener
/// thread. One mutex: two phones racing the same square serialise here, and
/// the ceremony's own one-shot rule does the rest.
pub(crate) struct Desk {
    state: Mutex<State>,
    file: PathBuf,
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
    failure: Option<&'static str>,
}

impl Desk {
    /// A desk for the credential kept at `file`. A credential already on disk
    /// is the paired state: the owner sees who this computer works with
    /// without any ceremony running.
    pub(crate) fn new(file: PathBuf) -> Self {
        let state = match kalsa_pairing::store::load(&file) {
            Ok(_) => State::Paired,
            Err(_) => State::Idle,
        };
        Self {
            state: Mutex::new(state),
            file,
        }
    }

    /// The phone this computer works with, for the catalog. `None` until a
    /// ceremony has been completed and its credential written: an unpaired
    /// computer must not be handed a phone it invented.
    pub(crate) fn phone(&self) -> Option<kalsa_catalog::PhoneModel> {
        kalsa_pairing::store::load(&self.file)
            .ok()
            .map(|handshake| handshake.phone)
    }

    /// The page's read. `serving` is whether there is anything for a phone to
    /// connect to; a square is only offered while the server is up, because a
    /// phone that scans one and finds nothing behind it has been lied to.
    ///
    /// This is also where a window closes: the page polls, and the poll is
    /// the clock. An expired square is replaced by a fresh one rather than
    /// left on screen, and the page says why.
    pub(crate) fn read(&self, serving: bool, reachable: &str, now: SystemTime) -> PairingDto {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let State::Live { pairing, .. } = &mut *state {
            pairing.expire_if_due(now);
            if matches!(pairing, Pairing::Expired) {
                *state = Self::fresh(reachable, now, Some(Refreshed::Expired));
            }
        }
        match &*state {
            State::Paired { .. } | State::Replace { .. } | State::CouldNotSave => {}
            _ if !serving => *state = State::Idle,
            State::Idle => *state = Self::fresh(reachable, now, None),
            State::Live { .. } => {}
        }
        dto(&state)
    }

    /// The owner asked for another square. Anything in flight is abandoned:
    /// a square the owner has given up on must not still be completable.
    pub(crate) fn retry(&self, reachable: &str, now: SystemTime) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        *state = Self::fresh(reachable, now, Some(Refreshed::WrongCode));
    }

    /// The owner's decision on a phone that asked to take over. `replace`
    /// writes the waiting credential over the stored one; keeping does not
    /// write anything and the new phone is simply dropped.
    pub(crate) fn decide(&self, replace: bool) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let State::Replace { incoming } = &*state else {
            return;
        };
        if !replace {
            *state = State::Paired;
            return;
        }
        // Forgetting first is what makes this a replacement rather than a
        // second credential: `persist` refuses to overwrite, by design.
        let written = kalsa_pairing::store::forget(&self.file)
            .and_then(|()| kalsa_pairing::store::persist(incoming, &self.file));
        *state = match written {
            Ok(()) => State::Paired,
            Err(_) => State::CouldNotSave,
        };
    }

    /// A phone presents the code from the square. Nothing is returned but
    /// whether the ceremony moved: the proof comes next, and a claim that
    /// says more than "go on" is a claim that can be probed.
    pub(crate) fn claim(&self, code: &str, now: SystemTime) -> bool {
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
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let State::Live { pairing, .. } = &mut *state else {
            return None;
        };
        let (handshake, seal) = pairing.complete(declaration, now).ok()?;
        *state = match kalsa_pairing::store::persist(&handshake, &self.file) {
            Ok(()) => State::Paired,
            Err(StoreError::AlreadyPaired) => State::Replace {
                incoming: Box::new(handshake),
            },
            Err(_) => State::CouldNotSave,
        };
        Some(seal)
    }

    /// A new square, or the idle state when one cannot be made. A failure to
    /// draw a square is not a failure of the pairing: the page shows nothing
    /// to scan and the next poll tries again.
    fn fresh(reachable: &str, now: SystemTime, refreshed: Option<Refreshed>) -> State {
        let Ok(pairing) = Pairing::offer(reachable, now, WINDOW) else {
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
        failure: None,
    };
    match state {
        State::Idle => empty,
        State::Live {
            pairing,
            qr,
            refreshed,
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
        State::Paired => PairingDto {
            state: "paired",
            ..empty
        },
        State::Replace { .. } => PairingDto {
            state: "replace",
            ..empty
        },
        State::CouldNotSave => PairingDto {
            state: "failed",
            failure: Some("could-not-save"),
            ..empty
        },
    }
}

/// The desk, shared with the listener thread.
pub(crate) type SharedDesk = Arc<Desk>;

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_catalog::{Parameters, PhoneModel};

    /// The square this desk is showing, as the phone reads it off the screen.
    /// Test-only: nothing in the product needs the payload — the page shows
    /// the SVG and the phone's camera does the rest.
    impl Desk {
        fn square(&self) -> Option<String> {
            let state = self.state.lock().unwrap();
            match &*state {
                State::Live { pairing, .. } => pairing.qr_payload(),
                _ => None,
            }
        }
    }

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

    /// A phone walks the whole ceremony: it scans, claims, proves, and only
    /// then does this computer know what it is serving. Before that the
    /// catalog is handed nothing — which is the state the product shipped in
    /// until this transport existed.
    #[test]
    fn the_catalog_learns_the_phone_only_after_a_completed_ceremony() {
        let desk = Desk::new(scratch("completes"));
        let now = SystemTime::now();

        assert!(desk.phone().is_none(), "nothing is paired yet");
        desk.read(true, "http://127.0.0.1:1", now);
        let payload = desk.square().expect("a square is on screen");
        let (code, nonce, reachable) = secrets(&payload);

        assert!(
            desk.claim(&code, now),
            "the code off the square is the code"
        );
        let declaration = PhoneDeclaration::sign(&code, &nonce, &reachable, a_phone())
            .expect("the phone can sign what it scanned");
        assert!(desk.complete(declaration, now).is_some(), "sealed");

        let phone = desk.phone().expect("the phone reached the catalog");
        assert_eq!(phone.weights_bytes, 2_000_000_000);
    }

    /// A proof keyed on anything but this square mints nothing, and burns the
    /// square: the real phone gets a fresh one rather than a spent one.
    #[test]
    fn a_proof_from_another_square_mints_nothing() {
        let desk = Desk::new(scratch("wrong-proof"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", now);
        let (code, nonce, reachable) = secrets(&desk.square().expect("square"));
        assert!(desk.claim(&code, now));

        let stranger = "0".repeat(code.len());
        let forged = PhoneDeclaration::sign(&stranger, &nonce, &reachable, a_phone())
            .expect("a well-formed message keyed on the wrong secret");
        assert!(desk.complete(forged, now).is_none(), "no seal");
        assert!(desk.phone().is_none(), "and no credential");
    }

    /// One attempt. A correct proof presented after a wrong one is still
    /// refused — the square is spent, not merely wrong.
    #[test]
    fn a_burnt_square_refuses_even_the_right_proof() {
        let desk = Desk::new(scratch("burnt"));
        let now = SystemTime::now();
        desk.read(true, "http://127.0.0.1:1", now);
        let (code, nonce, reachable) = secrets(&desk.square().expect("square"));
        assert!(desk.claim(&code, now));

        let stranger = "0".repeat(code.len());
        let forged = PhoneDeclaration::sign(&stranger, &nonce, &reachable, a_phone()).unwrap();
        assert!(desk.complete(forged, now).is_none());

        let honest = PhoneDeclaration::sign(&code, &nonce, &reachable, a_phone()).unwrap();
        assert!(desk.complete(honest, now).is_none(), "the square is spent");
        assert!(desk.phone().is_none());
    }

    /// A square is only offered while there is something behind it.
    #[test]
    fn nothing_is_offered_while_the_server_is_down() {
        let desk = Desk::new(scratch("idle"));
        desk.read(false, "http://127.0.0.1:1", SystemTime::now());
        assert!(desk.square().is_none());
    }
}
