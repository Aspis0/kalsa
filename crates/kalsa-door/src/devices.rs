//! The door's credentials: one entry per paired device, so the door can
//! tell devices apart, refuse one without refusing all, and be able to say
//! who is connected.
//!
//! The door is handed the whole set at construction and never changes it:
//! it reads no files, persists nothing, and does not know where the set
//! came from. Where entries are born and where they are removed — pairing,
//! revocation — belong to the app. Revocation therefore reaches the door
//! the only way anything does: the app stops this door and builds the next
//! one from a set without the removed device. The decision about the
//! revoked device's in-flight job is the door's own lifecycle, applied
//! without a special case: every job dies with the door that started it,
//! so the restart destroys the revoked device's answer along with all the
//! others. A revoked device finds its next request refused — the one 401,
//! the same for a wrong credential as for an unknown one — and leaves
//! behind no answer that it or anyone could still resume.
//!
//! The credential bytes are secrets. Nothing here derives `Debug` on a type
//! that holds one, and no error carries one: a bad entry is
//! `DoorError::InvalidCredential`, the same words however it was bad,
//! never echoing the value.
//!
//! Each entry also carries a cache salt, derived once from the credential
//! and reachable only through [`Devices::cache_salt`]. The salt labels this
//! device's prompt cache in the engine; it is cache-key material, not a
//! credential and not an authentication: nothing compares it, nothing
//! accepts a client's.

use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

use crate::{DoorError, TOKEN_BYTES};

/// The domain separator for the per-device cache salt. It is part of the
/// hash input, so a digest computed for any other purpose cannot collide
/// with this one. Changing the words changes every slot's warm cache, so
/// the label is versioned (v1) and stated here once.
const CACHE_SALT_LABEL: &[u8] = b"kalsa-cache-salt-v1";

/// The device a credential belongs to. Opaque, small, not a secret: the app
/// mints the ids, the app keeps them stable, and the owner may see them.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct DeviceId(u32);

impl DeviceId {
    pub fn new(value: u32) -> Self {
        Self(value)
    }

    /// The id as the number the owner is shown.
    pub fn value(self) -> u32 {
        self.0
    }
}

// Written by hand like every Debug in this crate that lives near
// credentials, so the habit of deriving never spreads: the id itself is
// public — it is what the owner is shown — and prints as a number.
impl std::fmt::Debug for DeviceId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "device {}", self.0)
    }
}

/// One paired device: who it is, what the owner calls it, and the secret it
/// presents. Built only through [`DeviceEntry::new`], which validates the
/// credential before it exists anywhere.
#[derive(Clone, PartialEq, Eq)]
pub struct DeviceEntry {
    pub id: DeviceId,
    pub label: String,
    credential: [u8; TOKEN_BYTES],
    /// Derived once, in `new`, from the credential. Kept so a request never
    /// hashes anything on the hot path, and reachable only by id through
    /// [`Devices::cache_salt`].
    cache_salt: [u8; 32],
}

impl DeviceEntry {
    /// The credential must be exactly 64 hex characters — the same test the
    /// single credential always went through, now applied per entry.
    pub fn new(
        id: DeviceId,
        label: impl Into<String>,
        credential: String,
    ) -> Result<Self, DoorError> {
        let credential = credential_bytes(&credential).ok_or(DoorError::InvalidCredential)?;
        let cache_salt = cache_salt_of(&credential);
        Ok(Self {
            id,
            label: label.into(),
            credential,
            cache_salt,
        })
    }
}

/// The set itself. `Clone` and `PartialEq` serve the app's reconcile — is
/// the running door built from the set the store holds now? There is
/// deliberately no `Debug`.
#[derive(Clone, PartialEq, Eq)]
pub struct Devices {
    entries: Vec<DeviceEntry>,
}

impl Devices {
    /// Builds the set, refusing every way to be wrong with the one error:
    /// an empty set, a repeated device id, and a repeated credential are
    /// all `InvalidCredential`. A door that opens for nobody and a set
    /// where two devices are indistinguishable are caller mistakes, not
    /// states to serve.
    pub fn new(entries: Vec<DeviceEntry>) -> Result<Self, DoorError> {
        if entries.is_empty() {
            return Err(DoorError::InvalidCredential);
        }
        for (index, entry) in entries.iter().enumerate() {
            for other in entries.iter().take(index) {
                if entry.id == other.id || entry.credential == other.credential {
                    return Err(DoorError::InvalidCredential);
                }
            }
        }
        Ok(Self { entries })
    }

    /// Which device presented this credential, if any.
    ///
    /// The scan is the constant-time one: every entry is compared, the loop
    /// never leaves early, and each per-entry verdict is accumulated into
    /// one answer that is decided only after the last entry. The time taken
    /// says how many entries the set has and nothing about which one
    /// matched — a credential belonging to nobody and one belonging to
    /// another device cost the same.
    pub(crate) fn authenticate(&self, presented: &[u8; TOKEN_BYTES]) -> Option<DeviceId> {
        let mut any = 0u8;
        let mut matched = 0u32;
        for entry in &self.entries {
            let equal = presented.ct_eq(&entry.credential).unwrap_u8();
            any |= equal;
            // All-one-bits when equal, zero when not: a non-match
            // contributes nothing, a match contributes its device id.
            matched |= entry.id.0 & (u32::from(equal)).wrapping_neg();
        }
        (any == 1).then_some(DeviceId(matched))
    }

    /// The owner's label for a device the set holds. The label is the one
    /// thing about a device that may be shown beyond this crate; the
    /// credential never is.
    pub fn label(&self, id: DeviceId) -> Option<&str> {
        self.entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| entry.label.as_str())
    }

    /// The device's cache salt, if the set holds it. Mirrors [`Self::label`]:
    /// a device the set does not hold has no salt here. The salt goes only
    /// to the engine, as a private header the door seals; it is never
    /// returned to a client and never compared against anything.
    pub(crate) fn cache_salt(&self, id: DeviceId) -> Option<&[u8; 32]> {
        self.entries
            .iter()
            .find(|entry| entry.id == id)
            .map(|entry| &entry.cache_salt)
    }

    /// Whether the set still holds this device — the check a streaming
    /// exchange makes between relay steps, so a revoked device is cut.
    pub(crate) fn contains(&self, id: DeviceId) -> bool {
        self.entries.iter().any(|entry| entry.id == id)
    }
}

/// The one credential format: exactly 64 ASCII hex characters, kept as
/// bytes. The hex is never decoded — comparison stays byte-for-byte, the
/// way the single credential was always compared.
fn credential_bytes(credential: &str) -> Option<[u8; TOKEN_BYTES]> {
    if credential.len() != TOKEN_BYTES || !credential.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let mut bytes = [0u8; TOKEN_BYTES];
    bytes.copy_from_slice(credential.as_bytes());
    Some(bytes)
}

/// The labeled digest that becomes a device's cache salt. One labeled hash
/// of the credential bytes, computed in `DeviceEntry::new` and nowhere on
/// the request path. The label is hashed with the credential so this digest
/// cannot be confused with a digest of the credential for any other use.
fn cache_salt_of(credential: &[u8; TOKEN_BYTES]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(CACHE_SALT_LABEL);
    hasher.update(credential);
    hasher.finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: u32, credential: &str) -> DeviceEntry {
        DeviceEntry::new(
            DeviceId::new(id),
            format!("device {id}"),
            credential.to_string(),
        )
        .unwrap()
    }

    #[test]
    fn a_set_answers_with_the_device_whose_credential_matched() {
        let devices = Devices::new(vec![entry(4, &"a".repeat(64)), entry(9, &"b".repeat(64))])
            .expect("two distinct devices");
        let first = credential_bytes(&"a".repeat(64)).unwrap();
        let second = credential_bytes(&"b".repeat(64)).unwrap();
        let nobody = credential_bytes(&"c".repeat(64)).unwrap();
        assert_eq!(devices.authenticate(&first), Some(DeviceId::new(4)));
        assert_eq!(devices.authenticate(&second), Some(DeviceId::new(9)));
        assert_eq!(devices.authenticate(&nobody), None);
    }

    #[test]
    fn the_set_tells_back_the_owners_label_for_a_device_it_holds() {
        let devices = Devices::new(vec![DeviceEntry::new(
            DeviceId::new(3),
            "Paired phone",
            "a".repeat(64),
        )
        .unwrap()])
        .expect("one device");
        assert_eq!(devices.label(DeviceId::new(3)), Some("Paired phone"));
        assert_eq!(
            devices.label(DeviceId::new(4)),
            None,
            "a device the set does not hold has no label here"
        );
    }

    #[test]
    fn every_entry_is_validated_not_just_the_first() {
        let good = entry(0, &"a".repeat(64));
        assert!(matches!(
            DeviceEntry::new(DeviceId::new(1), "bad", "zz".to_string()),
            Err(DoorError::InvalidCredential)
        ));
        assert!(matches!(
            DeviceEntry::new(DeviceId::new(1), "short", "a".repeat(63)),
            Err(DoorError::InvalidCredential)
        ));
        assert!(matches!(
            DeviceEntry::new(DeviceId::new(1), "long", "a".repeat(65)),
            Err(DoorError::InvalidCredential)
        ));
        assert!(Devices::new(vec![good]).is_ok(), "the good one still stands");
    }

    #[test]
    fn a_set_is_never_empty_and_never_ambiguous() {
        let first = entry(0, &"a".repeat(64));
        assert!(matches!(
            Devices::new(Vec::new()),
            Err(DoorError::InvalidCredential)
        ));
        assert!(
            matches!(
                Devices::new(vec![first.clone(), entry(0, &"b".repeat(64))]),
                Err(DoorError::InvalidCredential)
            ),
            "two devices, one id: which one connected would be unanswerable"
        );
        assert!(
            matches!(
                Devices::new(vec![first.clone(), entry(1, &"a".repeat(64))]),
                Err(DoorError::InvalidCredential)
            ),
            "two devices, one credential: the set cannot tell them apart"
        );
        assert!(Devices::new(vec![first]).is_ok());
    }
}
