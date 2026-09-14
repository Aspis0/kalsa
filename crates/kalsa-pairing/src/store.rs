//! The credential store: the handshake result, on disk, owner-only.
//!
//! On Unix the file is created `0600` — owner read and write, nothing for
//! group or other — and a test checks the mode, not the intention. On Windows
//! the POSIX mode bits do not exist, so nothing carries over and nothing is
//! pretended: what is achieved is `create_new`, which refuses to overwrite a
//! credential that is already there (a second pairing must never silently
//! destroy the first); what is *not* achieved is an owner-only ACL — the file
//! is exactly as readable as the directory it is created in, which on a
//! normal install means the user's own profile and no tighter because of
//! anything done here.
//!
//! The `Stored*` structs are a serialization shell, not a second description
//! of the phone: `PhoneModel` lives in `kalsa-catalog` and deliberately
//! carries no `serde`, so this file writes its fields down and every read
//! rebuilds a `PhoneModel` from them. Every rule about what the phone's
//! numbers mean keeps living in the catalog; nothing is interpreted here.

use std::fs;
use std::path::Path;

use kalsa_catalog::{Parameters, PhoneModel};
use serde::{Deserialize, Serialize};

use crate::error::StoreError;
use crate::handshake::{Credential, Handshake};

const STORE_VERSION: u8 = 1;

// No Debug on purpose: the credential travels through these structs in hex.
#[derive(Serialize, Deserialize)]
struct StoredHandshake {
    v: u8,
    credential_hex: String,
    phone: StoredPhone,
}

#[derive(Serialize, Deserialize)]
struct StoredPhone {
    weights_bytes: u64,
    parameters: Option<StoredParameters>,
    measured_tokens_per_second: Option<f64>,
    battery_powered: Option<bool>,
}

/// `total == active` is a dense model; anything else must satisfy
/// `1 <= active <= total` — the constraint `Parameters::mixture` asserts on,
/// which is why it is checked here and a file that fails it is corrupt
/// rather than a crash.
#[derive(Serialize, Deserialize)]
struct StoredParameters {
    total: u64,
    active: u64,
}

/// Write the handshake result as a new file. The parent directory must exist;
/// where the app keeps its data is the shell's business, not the store's.
pub fn persist(handshake: &Handshake, path: &Path) -> Result<(), StoreError> {
    let stored = StoredHandshake {
        v: STORE_VERSION,
        credential_hex: handshake.credential_hex(),
        phone: StoredPhone::of(handshake.phone),
    };
    let mut file = create_exclusive(path).map_err(StoreError::Io)?;
    serde_json::to_writer(&mut file, &stored).map_err(StoreError::Serde)
}

/// Read a handshake result back.
pub fn load(path: &Path) -> Result<Handshake, StoreError> {
    let bytes = fs::read(path).map_err(StoreError::Io)?;
    let stored: StoredHandshake = serde_json::from_slice(&bytes).map_err(StoreError::Serde)?;
    if stored.v != STORE_VERSION {
        return Err(StoreError::Corrupt("unsupported stored version"));
    }
    let credential = Credential::from_hex(&stored.credential_hex)
        .ok_or(StoreError::Corrupt("credential is not 64 hex characters"))?;
    let phone = stored.phone.into_phone()?;
    Ok(Handshake::new(phone, credential))
}

#[cfg(unix)]
fn create_exclusive(path: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
}

#[cfg(not(unix))]
fn create_exclusive(path: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
}

impl StoredPhone {
    fn of(phone: PhoneModel) -> Self {
        Self {
            weights_bytes: phone.weights_bytes,
            parameters: phone.parameters.map(|p| StoredParameters {
                total: p.total().count(),
                active: p.active().count(),
            }),
            measured_tokens_per_second: phone.measured_tokens_per_second,
            battery_powered: phone.battery_powered,
        }
    }

    fn into_phone(self) -> Result<PhoneModel, StoreError> {
        let parameters = match self.parameters {
            None => None,
            Some(p) if p.total == p.active => Some(Parameters::dense(p.total)),
            Some(p) if p.active >= 1 && p.active < p.total => {
                Some(Parameters::mixture(p.total, p.active))
            }
            Some(_) => return Err(StoreError::Corrupt("stored parameters cannot exist")),
        };
        Ok(PhoneModel {
            weights_bytes: self.weights_bytes,
            parameters,
            measured_tokens_per_second: self.measured_tokens_per_second,
            battery_powered: self.battery_powered,
        })
    }
}

#[cfg(test)]
mod tests;
