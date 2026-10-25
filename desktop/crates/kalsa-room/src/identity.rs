//! The room's two identities, one file: the room id, random once for the
//! life of this computer's room, and the transcript epoch, re-minted every
//! time a recovery drops bytes.
//!
//! The room id is what a phone keys its multi-computer store by — stable,
//! opaque, never re-minted (a re-mint would orphan every phone's cache).
//! The epoch is what makes a seq honest: a recovery can drop entries a
//! phone already saw, and the seq numbers of the next epoch may repeat
//! values from before the drop. An epoch change tells the phone to drop
//! what it cached and refetch. Corrupt bytes here refuse the room: a
//! re-minted id is exactly the orphaning this file exists to prevent, and
//! an epoch nobody can name is a transcript nobody can trust.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::RoomError;

pub(crate) const IDENTITY_NAME: &str = "room-identity.json";
const IDENTITY_VERSION: u8 = 1;
const ID_BYTES: usize = 16;

#[derive(Serialize, Deserialize)]
struct StoredIdentity {
    v: u8,
    room_id: String,
    epoch: String,
}

/// The identities a room answers with.
#[derive(Clone)]
pub(crate) struct Identity {
    room_id: String,
    epoch: String,
}

fn mint() -> Result<String, RoomError> {
    let mut bytes = [0u8; ID_BYTES];
    getrandom::fill(&mut bytes).map_err(|_| RoomError::Entropy)?;
    Ok(hex(&bytes))
}

impl Identity {
    /// Loads the identities, minting and persisting both on the room's
    /// first opening.
    pub(crate) fn open(dir: &Path) -> Result<Self, RoomError> {
        let path = dir.join(IDENTITY_NAME);
        match std::fs::read(&path) {
            Ok(bytes) => return Self::parse(&bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let minted = Self {
            room_id: mint()?,
            epoch: mint()?,
        };
        minted.persist(&path).map_err(RoomError::Io)?;
        Ok(minted)
    }

    fn parse(bytes: &[u8]) -> Result<Self, RoomError> {
        let stored: StoredIdentity = serde_json::from_slice(bytes)
            .map_err(|_| RoomError::Corrupt("identity file does not parse"))?;
        if stored.v != IDENTITY_VERSION {
            return Err(RoomError::Corrupt("identity file is from a newer format"));
        }
        if !is_opaque(&stored.room_id) || !is_opaque(&stored.epoch) {
            return Err(RoomError::Corrupt("identity file holds no identity"));
        }
        Ok(Self {
            room_id: stored.room_id,
            epoch: stored.epoch,
        })
    }

    /// A fresh epoch for the same room: the room id never changes, the
    /// transcript's numbering starts over in meaning, and the new epoch is
    /// persisted before the room serves again.
    pub(crate) fn next_epoch(&self, dir: &Path) -> Result<Self, RoomError> {
        let re_minted = Self {
            room_id: self.room_id.clone(),
            epoch: mint()?,
        };
        re_minted.persist(&dir.join(IDENTITY_NAME)).map_err(RoomError::Io)?;
        Ok(re_minted)
    }

    pub(crate) fn room_id(&self) -> &str {
        &self.room_id
    }

    pub(crate) fn epoch(&self) -> &str {
        &self.epoch
    }

    fn persist(&self, path: &Path) -> std::io::Result<()> {
        let stored = StoredIdentity {
            v: IDENTITY_VERSION,
            room_id: self.room_id.clone(),
            epoch: self.epoch.clone(),
        };
        let bytes = serde_json::to_vec(&stored).expect("the identity always serializes");
        kalsa_pairing::store::write_owner_only(path, &bytes)
    }
}

/// Both identities are 32 lowercase hex characters — the one shape this
/// file writes and the only one it reads back.
fn is_opaque(value: &str) -> bool {
    value.len() == ID_BYTES * 2 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}
