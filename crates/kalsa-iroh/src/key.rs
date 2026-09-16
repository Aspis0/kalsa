//! The node's long-lived identity: 32 secret bytes, persisted owner-only
//! beside the pairing file.
//!
//! The secret is the iroh node's key seed. It must survive restarts — a node
//! that reinvents itself at every boot changes its public id, and the phone
//! can no longer find the computer it paired with. The file is written the
//! way `kalsa-pairing`'s store writes the credential: the bytes land in a
//! sibling temp file created `0600`, are flushed, then renamed onto the
//! final name, so a reader sees one complete file or the other, never a
//! torn half, and a crash mid-write leaves a temp the next write replaces.
//! On Windows the owner-only restriction is an explicit protected DACL
//! through `windows-sys`, the same declared-not-proven path the pairing
//! store takes: it never compiles or runs on this machine.
//!
//! [`NodeKey`] has a redacted `Debug` on purpose, the same decision
//! `kalsa-pairing`'s one-time code made: a derived `Debug` would print the
//! key the first time anything logged the struct, and a key riding a log
//! line, an error message, or an event payload is the leak every audit here
//! looks for first. Only the public half, [`NodeId`], is printable — hex,
//! the form the pairing square carries.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use getrandom::fill;

use crate::error::BridgeError;

/// 32 bytes: the key seed on the secret side, the public id on the other.
const KEY_BYTES: usize = 32;

/// The format tag on the first line of the stored file.
const FILE_TAG: &str = "kalsa-iroh-node-key-v1";

/// The node's secret key: exactly 32 bytes, created once, owner-only on
/// disk, printable never.
pub struct NodeKey {
    bytes: [u8; KEY_BYTES],
}

impl NodeKey {
    /// Draw 32 bytes from the operating system's entropy pool.
    pub fn generate() -> Result<Self, BridgeError> {
        let mut bytes = [0u8; KEY_BYTES];
        fill(&mut bytes).map_err(|_| BridgeError::Entropy)?;
        Ok(Self { bytes })
    }

    /// The bytes the transport turns into a node key. They never leave this
    /// crate except toward the one file allowed to talk to iroh.
    pub fn to_bytes(&self) -> [u8; KEY_BYTES] {
        self.bytes
    }

    /// Load the key at `path`, creating and persisting a new one if no file
    /// is there yet. The parent directory must exist; where the app keeps
    /// its data is the shell's business. An existing file is authoritative —
    /// the node keeps its identity across restarts — and a corrupt file is
    /// refused, never silently replaced: replacement would quietly hand the
    /// node a new identity and strand the paired phone.
    pub fn load_or_create(path: &Path) -> Result<Self, BridgeError> {
        match fs::read(path) {
            Ok(bytes) => parse_stored(&bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let key = Self::generate()?;
                key.store(path)?;
                Ok(key)
            }
            Err(e) => Err(BridgeError::Io(e)),
        }
    }

    fn store(&self, path: &Path) -> Result<(), BridgeError> {
        let temp = temp_path(path);
        let result = write_temp(&temp, &hex::encode(self.bytes))
            .and_then(|()| publish_temp(&temp, path).map_err(BridgeError::Io));
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
}

// A derived Debug would print the key the first time anything logged the
// struct. This hand-written impl is the only Debug the type will ever have.
impl fmt::Debug for NodeKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("NodeKey(_)")
    }
}

fn write_temp(temp: &Path, key_hex: &str) -> Result<(), BridgeError> {
    use std::io::Write;
    let mut file = open_temp(temp)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // The open file, not the path: a temp left behind by a crash with
        // wide permissions is narrowed here, before a key byte lands in it.
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(BridgeError::Io)?;
    }
    // Restrict before any key byte exists on disk (on Unix this path is a
    // no-op; the permissions were set on the open file above).
    restrict_to_owner(temp)?;
    let body = format!("{FILE_TAG}\n{key_hex}\n");
    file.write_all(body.as_bytes())
        .and_then(|()| file.sync_all())
        .map_err(BridgeError::Io)
}

/// The sibling name the bytes land in before publication.
fn temp_path(path: &Path) -> PathBuf {
    path.with_extension("tmp")
}

fn publish_temp(temp: &Path, path: &Path) -> std::io::Result<()> {
    fs::rename(temp, path)
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

// Unix achieved owner-only at creation (`0600`).
#[cfg(unix)]
fn restrict_to_owner(_temp: &Path) -> Result<(), BridgeError> {
    Ok(())
}

// Windows: the POSIX mode bits do not exist, so owner-only is done by hand —
// an explicit *protected* DACL granting full access to SYSTEM,
// Administrators and the file's owner, nothing to anyone else. DECLARED, NOT
// PROVEN: like the pairing store's twin, this never compiles or runs here.
#[cfg(windows)]
fn restrict_to_owner(temp: &Path) -> Result<(), BridgeError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::{
        ConvertStringSecurityDescriptorToSecurityDescriptorW, SetFileSecurityW,
        DACL_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    };

    const SDDL_REVISION_1: u32 = 1;
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
        return Err(BridgeError::Io(std::io::Error::last_os_error()));
    }
    let ok = unsafe {
        SetFileSecurityW(
            wide.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        )
    };
    unsafe {
        LocalFree(descriptor);
    }
    if ok == 0 {
        Err(BridgeError::Io(std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

#[cfg(windows)]
const _: () = ();

/// The node's public identity: 32 bytes, hex-printed — the string the
/// pairing square carries so the phone can dial this computer by key alone.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct NodeId {
    bytes: [u8; KEY_BYTES],
}

impl NodeId {
    pub fn from_bytes(bytes: [u8; KEY_BYTES]) -> Self {
        Self { bytes }
    }

    pub fn to_bytes(&self) -> [u8; KEY_BYTES] {
        self.bytes
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&hex::encode(self.bytes))
    }
}

impl fmt::Debug for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "NodeId({self})")
    }
}

impl std::str::FromStr for NodeId {
    type Err = BridgeError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let mut bytes = [0u8; KEY_BYTES];
        if s.len() != KEY_BYTES * 2 || hex::decode_to_slice(s, &mut bytes).is_err() {
            return Err(BridgeError::Corrupt("node id is not 64 hex characters"));
        }
        Ok(Self { bytes })
    }
}

fn parse_stored(bytes: &[u8]) -> Result<NodeKey, BridgeError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| BridgeError::Corrupt("node key file is not UTF-8"))?;
    let mut lines = text.lines();
    let tag = lines.next().unwrap_or("");
    if tag != FILE_TAG {
        return Err(BridgeError::Corrupt("unknown node key file version"));
    }
    let key_hex = lines.next().unwrap_or("");
    let mut key = [0u8; KEY_BYTES];
    if key_hex.len() != KEY_BYTES * 2 || hex::decode_to_slice(key_hex, &mut key).is_err() {
        return Err(BridgeError::Corrupt("node key is not 64 hex characters"));
    }
    Ok(NodeKey { bytes: key })
}

#[cfg(test)]
mod tests;
