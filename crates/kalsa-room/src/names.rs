//! The members' display names: the one rule a name must pass, and the
//! owner-only file the accepted names live in beside the transcript.
//!
//! The file is a whole-document state, not an append log, so it rides the
//! pairing store's temp-and-rename publication instead of growing a second
//! one whose permissions could drift apart from the credential's. The rule
//! is shared by the setter and the loader: a name the store refused to
//! take is also a name it refuses to read back, so a hand edit cannot put
//! past the store what the store would not accept from a member.

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::{MemberId, RoomError};

/// The most a display name may be, after trimming.
const MAX_NAME_BYTES: usize = 40;
const NAMES_VERSION: u8 = 1;

#[derive(Serialize, Deserialize)]
struct StoredNames {
    v: u8,
    names: HashMap<String, String>,
}

/// Why a name was refused.
#[derive(Debug)]
pub enum NameError {
    Empty,
    TooLong,
    ControlCharacter,
    Io(std::io::Error),
}

impl std::fmt::Display for NameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => f.write_str("a name cannot be empty"),
            Self::TooLong => f.write_str("the name is too long"),
            Self::ControlCharacter => f.write_str("a name cannot hold control characters"),
            Self::Io(error) => write!(f, "room store: {error}"),
        }
    }
}

/// The one name rule: trimmed, some text, short enough, no control
/// characters. Measured in bytes, as the protocol states.
pub fn valid(name: &str) -> Result<String, NameError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(NameError::Empty);
    }
    if name.len() > MAX_NAME_BYTES {
        return Err(NameError::TooLong);
    }
    if name.chars().any(char::is_control) {
        return Err(NameError::ControlCharacter);
    }
    Ok(name.to_string())
}

/// Reads the names file back. No file yet is an empty set — the same
/// "unpaired" absence every store in this app reads as a fresh start.
pub fn load(path: &Path) -> Result<HashMap<MemberId, String>, RoomError> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(error.into()),
    };
    let stored: StoredNames = serde_json::from_slice(&bytes)
        .map_err(|_| RoomError::Corrupt("names file does not parse"))?;
    if stored.v != NAMES_VERSION {
        return Err(RoomError::Corrupt("names file is from a newer format"));
    }
    stored
        .names
        .into_iter()
        .map(|(member, name)| {
            let member = member
                .parse::<u32>()
                .map_err(|_| RoomError::Corrupt("a names file key is not a member id"))?;
            match valid(&name) {
                Ok(name) => Ok((MemberId::device(member), name)),
                Err(_) => Err(RoomError::Corrupt("a stored display name is invalid")),
            }
        })
        .collect()
}

/// Publishes the whole name set atomically, before the caller touches its
/// memory: a name exists when it is on disk, not when a `HashMap` says so.
pub fn publish(path: &Path, names: &HashMap<MemberId, String>) -> std::io::Result<()> {
    let stored = StoredNames {
        v: NAMES_VERSION,
        names: names
            .iter()
            .map(|(member, name)| (member.value().to_string(), name.clone()))
            .collect(),
    };
    let bytes = serde_json::to_vec(&stored).expect("the names document always serializes");
    kalsa_pairing::store::write_owner_only(path, &bytes)
}
