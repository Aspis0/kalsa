//! The credential store: the handshake result, on disk, owner-only.
//!
//! Publication is atomic, in the spirit of `kalsa-download`'s publish: the
//! bytes land in a sibling temp file, are flushed with `sync_all`, and only
//! then is the temp renamed onto the credential's name — a reader of the
//! final path sees the old complete file or the new complete file, never a
//! torn half, and a crash mid-write leaves a temp that the next write
//! replaces, never a credential wedged behind `AlreadyPaired`.
//!
//! Owner-only means two different machines here, and both are said plainly.
//! On Unix the temp file is created `0600` — owner read and write, nothing
//! for group or other — and a test checks the mode, not the intention. On
//! Windows the mode bits do not exist, so the temp is restricted by an
//! explicit protected DACL (system, administrators, and the file's owner
//! get access; Everyone gets nothing) through the raw `windows-sys`
//! bindings. The ACL is applied before any credential bytes are written. That
//! Windows path is *declared, not proven*: it never compiles or runs on this
//! machine, and nothing in the test suite covers it.
//!
//! Refusing is not forbidding. A stored credential is replaced only by the
//! owner's explicit replacement decision, and that publication is atomic;
//! [`forget`] is the separate explicit discard operation. `forget` does not
//! read the file, so a credential too corrupt to `load` is not too corrupt to
//! be let go.
//!
//! The `Stored*` structs are a serialization shell, not a second description
//! of the phone: `PhoneModel` lives in `kalsa-catalog` and deliberately
//! carries no `serde`, so this file writes its fields down and every read
//! rebuilds a `PhoneModel` from them. Every rule about what the phone's
//! numbers mean keeps living in the catalog; nothing is interpreted here.
//! The shell itself is shared with the wire (`messages::PhoneFields`) —
//! same fields on disk and in the completion message, one conversion.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

use crate::error::StoreError;
use crate::handshake::{Credential, Handshake};
use crate::messages::{PairingSeal, PhoneFields};

const STORE_VERSION: u8 = 1;

/// A sealed completion kept beside the credential until the phone confirms it
/// received the response. It is private-by-construction: callers can create
/// one only from a signed delivery token, a seal, and the QR's deadline.
#[derive(Clone, Serialize, Deserialize)]
pub struct Delivery {
    token: String,
    seal: PairingSeal,
    expires_at: u64,
}

impl Delivery {
    pub fn new(token: &str, seal: PairingSeal, expires_at: SystemTime) -> Option<Self> {
        let mut bytes = [0u8; 16];
        hex::decode_to_slice(token, &mut bytes).ok()?;
        let expires_at = expires_at.duration_since(UNIX_EPOCH).ok()?.as_secs();
        Some(Self {
            token: token.to_string(),
            seal,
            expires_at,
        })
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub fn seal(&self) -> &PairingSeal {
        &self.seal
    }

    pub fn expires_at(&self) -> Option<SystemTime> {
        UNIX_EPOCH.checked_add(Duration::from_secs(self.expires_at))
    }

    /// The token is a fixed-size, signed delivery identity. Decode both
    /// values before comparing them so the seal retrieval path does not use a
    /// variable-time string comparison.
    pub fn token_matches(&self, presented: &str) -> bool {
        let mut saved = [0u8; 16];
        let mut candidate = [0u8; 16];
        let saved_ok = hex::decode_to_slice(&self.token, &mut saved).is_ok();
        let candidate_ok = hex::decode_to_slice(presented, &mut candidate).is_ok();
        saved_ok && candidate_ok && bool::from(saved.ct_eq(&candidate))
    }

    fn is_valid(&self) -> bool {
        let Some(expires_at) = self.expires_at() else {
            return false;
        };
        Self::new(self.token.as_str(), self.seal.clone(), expires_at).is_some()
    }
}

// No Debug on purpose: the credential travels through these structs in hex.
#[derive(Serialize, Deserialize)]
struct StoredHandshake {
    v: u8,
    credential_hex: String,
    phone: PhoneFields,
    #[serde(default)]
    delivery: Option<Delivery>,
}

/// Write the handshake result as a new file. The parent directory must exist;
/// where the app keeps its data is the shell's business, not the store's.
///
/// If a credential is already stored the answer is
/// [`StoreError::AlreadyPaired`] — a refusal the shell can act on, not an
/// io error to squint at. The way forward is [`forget`], then `persist`
/// again. The existence check and the publication are two steps on a
/// single-process machine; the shell runs pairing in one loop, and this
/// store does not pretend to arbitrate between processes. A deliberate
/// replacement uses [`replace`] instead of this refusal.
pub fn persist(handshake: &Handshake, path: &Path) -> Result<(), StoreError> {
    persist_record(handshake, path, None)
}

/// Persist a handshake and the sealed response as one atomic record. The
/// response survives a crash between publication and the phone's retry.
pub fn persist_with_delivery(
    handshake: &Handshake,
    path: &Path,
    delivery: Delivery,
) -> Result<(), StoreError> {
    persist_record(handshake, path, Some(delivery))
}

fn persist_record(
    handshake: &Handshake,
    path: &Path,
    delivery: Option<Delivery>,
) -> Result<(), StoreError> {
    if path.exists() {
        return Err(StoreError::AlreadyPaired);
    }
    write_temp(handshake, path, delivery)?;
    publish_temp(&temp_path(path), path).map_err(StoreError::Io)
}

/// Atomically publish a replacement. The old credential remains at `path`
/// until the complete, owner-only temp file is renamed over it; a write or a
/// crash before that rename therefore leaves the old credential usable.
pub fn replace(handshake: &Handshake, path: &Path) -> Result<(), StoreError> {
    replace_record(handshake, path, None)
}

/// Atomically replace a handshake and retain its sealed response for retry.
pub fn replace_with_delivery(
    handshake: &Handshake,
    path: &Path,
    delivery: Delivery,
) -> Result<(), StoreError> {
    replace_record(handshake, path, Some(delivery))
}

fn replace_record(
    handshake: &Handshake,
    path: &Path,
    delivery: Option<Delivery>,
) -> Result<(), StoreError> {
    write_temp(handshake, path, delivery)?;
    publish_temp(&temp_path(path), path).map_err(StoreError::Io)
}

fn write_temp(
    handshake: &Handshake,
    path: &Path,
    delivery: Option<Delivery>,
) -> Result<(), StoreError> {
    let stored = StoredHandshake {
        v: STORE_VERSION,
        credential_hex: handshake.credential_hex(),
        phone: PhoneFields::of(handshake.phone),
        delivery,
    };
    let temp = temp_path(path);
    let mut file = open_temp(&temp).map_err(StoreError::Io)?;
    // On Windows this changes the temp's DACL while it is still empty. No
    // credential bytes exist during the brief interval before restriction.
    restrict_to_owner(&temp).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e
    })?;
    let written = serde_json::to_writer(&mut file, &stored)
        .map_err(StoreError::Serde)
        .and_then(|()| file.sync_all().map_err(StoreError::Io));
    if let Err(e) = written {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    Ok(())
}

fn publish_temp(temp: &Path, path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        return fs::rename(temp, path).map_err(|e| {
            let _ = fs::remove_file(temp);
            e
        });
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

        let mut source: Vec<u16> = temp.as_os_str().encode_wide().collect();
        source.push(0);
        let mut destination: Vec<u16> = path.as_os_str().encode_wide().collect();
        destination.push(0);
        let ok = unsafe {
            MoveFileExW(
                source.as_ptr(),
                destination.as_ptr(),
                0x0000_0001 | 0x0000_0008, // replace existing, write through
            )
        };
        if ok == 0 {
            let _ = fs::remove_file(temp);
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(any(unix, windows)))]
    {
        fs::rename(temp, path).map_err(|e| {
            let _ = fs::remove_file(temp);
            e
        })
    }
}

/// The sibling name the bytes land in before publication.
fn temp_path(path: &Path) -> PathBuf {
    path.with_extension("tmp")
}

#[cfg(unix)]
fn open_temp(temp: &Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(temp)
}

#[cfg(not(unix))]
fn open_temp(temp: &Path) -> std::io::Result<std::fs::File> {
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(temp)
}

// Unix achieved owner-only at creation (`0600`); there is nothing further
// to do, and a test checks the published file's mode.
#[cfg(unix)]
fn restrict_to_owner(_temp: &Path) -> Result<(), StoreError> {
    Ok(())
}

// Windows: the POSIX mode bits do not exist, so owner-only is done by hand —
// an explicit *protected* DACL (no inherited ACEs) granting full access to
// SYSTEM, Administrators and the file's owner, and nothing to anyone else.
// DECLARED, NOT PROVEN: this code never compiles or runs on this machine
// (it is behind `cfg(windows)`), and the report says so rather than claiming
// a test covered it.
#[cfg(windows)]
fn restrict_to_owner(temp: &Path) -> Result<(), StoreError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityDescriptorDacl,
        SetFileSecurityW, DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    };

    const SDDL_REVISION_1: u32 = 1;
    // Protected DACL: System, Administrators, Owner Rights — full access.
    // Everyone, and anything inherited: nothing.
    let sddl: Vec<u16> = "D:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;OW)"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut wide: Vec<u16> = temp.as_os_str().encode_wide().collect();
    wide.push(0);

    let mut descriptor = std::ptr::null_mut();
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(StoreError::Io(std::io::Error::last_os_error()));
    }
    let mut present = 0;
    let mut defaulted = 0;
    let mut dacl = std::ptr::null_mut();
    let ok =
        unsafe { GetSecurityDescriptorDacl(descriptor, &mut present, &mut dacl, &mut defaulted) };
    let applied = if ok == 0 || present == 0 || dacl.is_null() {
        Err(StoreError::Io(std::io::Error::other(
            "the security descriptor carried no DACL",
        )))
    } else {
        let ok = unsafe {
            SetFileSecurityW(
                wide.as_ptr(),
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                descriptor,
            )
        };
        if ok == 0 {
            Err(StoreError::Io(std::io::Error::last_os_error()))
        } else {
            Ok(())
        }
    };
    unsafe {
        LocalFree(descriptor);
    }
    applied
}

/// The computer forgets the phone it was paired with. This is an explicit
/// discard; normal owner-approved replacement uses [`replace`] and never
/// needs a delete-first gap.
///
/// Forgetting an unpaired computer is doing nothing, successfully: the
/// postcondition — no credential stored — already holds. And this reads
/// nothing, so it clears a credential whose file has gone corrupt just as
/// it clears a healthy one; the decision to forget is the owner's, and the
/// store does not demand the file be legible to accept it.
pub fn forget(path: &Path) -> Result<(), StoreError> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(StoreError::Io(e)),
    }
}

/// Read a handshake result back.
pub fn load(path: &Path) -> Result<Handshake, StoreError> {
    load_with_delivery(path).map(|(handshake, _)| handshake)
}

/// Read the handshake and any response that still needs delivery.
pub fn load_with_delivery(path: &Path) -> Result<(Handshake, Option<Delivery>), StoreError> {
    let bytes = fs::read(path).map_err(StoreError::Io)?;
    let stored: StoredHandshake = serde_json::from_slice(&bytes).map_err(StoreError::Serde)?;
    if stored.v != STORE_VERSION {
        return Err(StoreError::Corrupt("unsupported stored version"));
    }
    let credential = Credential::from_hex(&stored.credential_hex)
        .ok_or(StoreError::Corrupt("credential is not 64 hex characters"))?;
    let phone = stored
        .phone
        .into_phone()
        .ok_or(StoreError::Corrupt("stored parameters cannot exist"))?;
    if stored
        .delivery
        .as_ref()
        .is_some_and(|delivery| !delivery.is_valid())
    {
        return Err(StoreError::Corrupt("stored delivery is invalid"));
    }
    Ok((Handshake::new(phone, credential), stored.delivery))
}

/// Remove only the retained response while preserving the paired handshake.
pub fn clear_delivery(path: &Path) -> Result<(), StoreError> {
    let (handshake, _) = load_with_delivery(path)?;
    replace_record(&handshake, path, None)
}

#[cfg(test)]
mod tests;
