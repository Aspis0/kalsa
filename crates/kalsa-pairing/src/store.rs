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
//!
//! The store holds SEVERAL devices, one record each, and the format is
//! versioned. Version 2 is the set; version 1 — the single-device file
//! every installed copy has today — is read and lifted into a one-device
//! set on load. Migration happens on READ, never by rewriting: a load has
//! no business publishing (the shell polls this file once a second), and
//! the v1 bytes stay exactly where they are until the next legitimate
//! write publishes the set as v2.
//!
//! What an older build does with a v2 file is measured, not guessed. The
//! old build deserializes its whole single-device record BEFORE it ever
//! reaches its version check, and a set file has no top-level
//! `credential_hex` — so its answer is serde's, `StoreError::Serde`
//! ("missing field `credential_hex`"), never its `Corrupt` version
//! refusal. Either way the outcome is the one that matters: the old build
//! refuses, deletes nothing, and pairing comes back when the newer build
//! runs again. A failed load never destroys the file.
//!
//! The write paths also read first — they must, to add to the set without
//! disturbing ids and labels — so an unreadable store refuses the write
//! instead of overwriting bytes nobody could understand. This narrows
//! what `replace` accepts: where an older build would happily publish a
//! new credential over any file at all, this one requires the file it is
//! replacing to be legible. The refusal is recoverable by design:
//! [`forget`] still reads nothing, so an owner can always clear a store
//! no reader can open, and the next pairing starts from empty.
//!
//! All of this assumes a single writing process, and the assumption is
//! stated rather than hidden: every write is read-modify-write now, so a
//! second writer cannot merely tear a publication — it can LOSE a device,
//! by publishing a set that never saw the other writer's record. This
//! crate locks nothing; ensuring one writer is the application's job.
//!
//! Device ids come from the store, are minted once, and are never reused:
//! the next id is one above every id in the set, so a forgotten device's id
//! is never handed to a different device later. The label is assigned
//! locally by whoever adds the device — the pairing protocol deliberately
//! carries no name — and the store only holds what it is given.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

use crate::error::StoreError;
use crate::handshake::{Credential, Handshake};
use crate::messages::{PairingSeal, PhoneFields};

/// The version this build writes.
const STORE_VERSION: u8 = 2;
/// The version every installed copy wrote before the store held a set.
const V1_VERSION: u8 = 1;
/// The label a device gets when its caller does not name one: the name the
/// app has always shown for the phone it was paired with.
const DEFAULT_LABEL: &str = "Paired phone";

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

/// The version-2 shell: one file, several devices.
#[derive(Serialize, Deserialize)]
struct StoredV2 {
    v: u8,
    devices: Vec<StoredDeviceRecord>,
}

/// One device's record inside the v2 file.
#[derive(Clone, Serialize, Deserialize)]
struct StoredDeviceRecord {
    id: u32,
    label: String,
    credential_hex: String,
    phone: PhoneFields,
    #[serde(default)]
    delivery: Option<Delivery>,
}

/// The version-1 shell, kept for reading: every installed copy has one of
/// these files, and it must keep loading for as long as anyone runs this
/// app. Never written again.
#[derive(Serialize, Deserialize)]
struct StoredHandshake {
    v: u8,
    credential_hex: String,
    phone: PhoneFields,
    #[serde(default)]
    delivery: Option<Delivery>,
}

/// One paired device, as the store hands it back: its stable id, the label
/// the owner sees, and the handshake it paired with.
pub struct StoredDevice {
    pub id: u32,
    pub label: String,
    pub handshake: Handshake,
}

/// Write the handshake result as the store's first device. The parent
/// directory must exist; where the app keeps its data is the shell's
/// business, not the store's.
///
/// If the store already holds devices the answer is
/// [`StoreError::AlreadyPaired`] — a refusal the shell can act on, not an
/// io error to squint at. The desk parks the completed phone behind it for
/// the owner's decision; the owner-approved path is [`replace`], and adding
/// a device without displacing anyone is [`add_device`].
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
    // The single-device entry keeps its exact refusal, and it is not the
    // duplicate check: the desk parks a newly completed phone behind this
    // error for the owner to approve, so an existing store never gains a
    // device through here. The multi-device entry is [`add_device`], which
    // the desk will adopt together with its own decision flow.
    let mut records = read_records_or_empty(path)?;
    if !records.is_empty() {
        return Err(StoreError::AlreadyPaired);
    }
    records.push(record_from(handshake, 0, DEFAULT_LABEL.to_owned(), delivery));
    write_records(&records, path)
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
    let mut records = read_records_or_empty(path)?;
    match records.first_mut() {
        // The single-device API has always meant "the" device, which is the
        // first record; its id and label survive the replacement, because
        // the seat does. How a many-device desk scopes a replacement is
        // that job's decision, not this function's.
        Some(record) => {
            record.credential_hex = handshake.credential_hex();
            record.phone = PhoneFields::of(handshake.phone);
            record.delivery = delivery;
        }
        None => records.push(record_from(handshake, 0, DEFAULT_LABEL.to_owned(), delivery)),
    }
    write_records(&records, path)
}

fn record_from(
    handshake: &Handshake,
    id: u32,
    label: String,
    delivery: Option<Delivery>,
) -> StoredDeviceRecord {
    StoredDeviceRecord {
        id,
        label,
        credential_hex: handshake.credential_hex(),
        phone: PhoneFields::of(handshake.phone),
        delivery,
    }
}

/// Adds a device to the store and answers with the record as stored,
/// including the fresh id the store minted for it. Ids are one above every
/// id in the set, so they are stable across restarts and never reused: a
/// forgotten device's id is never handed to a different device later.
///
/// On duplicates, the honest answer is narrow. Every pairing ceremony mints
/// a fresh credential, so "the same phone asking twice" and "a new phone"
/// are indistinguishable here — nothing at this layer can refuse the same
/// device, and that decision belongs to the layer that runs the ceremony.
/// What the store can see, it refuses: the same credential stored twice is
/// [`StoreError::CredentialAlreadyStored`], a caller mistake or a replay,
/// never a new pairing.
pub fn add_device(
    path: &Path,
    label: &str,
    handshake: &Handshake,
) -> Result<StoredDevice, StoreError> {
    let credential_hex = handshake.credential_hex();
    let mut records = read_records_or_empty(path)?;
    if records
        .iter()
        .any(|record| record.credential_hex == credential_hex)
    {
        return Err(StoreError::CredentialAlreadyStored);
    }
    let id = match records.iter().map(|record| record.id).max() {
        None => 0,
        // A silent saturation at u32::MAX would mint a DUPLICATE id, and the
        // reader refuses a set whose devices share one — one saturation
        // would cost every pairing the user has. Refusing this one add is
        // the cheap direction.
        Some(highest) => highest.checked_add(1).ok_or(StoreError::StoreFull)?,
    };
    records.push(record_from(
        handshake,
        id,
        label.to_owned(),
        None,
    ));
    write_records(&records, path)?;
    Ok(StoredDevice {
        id,
        label: label.to_owned(),
        handshake: handshake.clone(),
    })
}

/// The store forgets one device and keeps the others. An id that is already
/// absent is success — including when the store itself is not there, the
/// same postcondition [`forget`] rests on.
pub fn forget_device(path: &Path, id: u32) -> Result<(), StoreError> {
    let mut records = read_records_or_empty(path)?;
    let before = records.len();
    records.retain(|record| record.id != id);
    // Emptiness is checked before "nothing changed": a set holding no
    // devices must end up as no file, whatever it looked like going in.
    if records.is_empty() {
        return forget(path);
    }
    if records.len() == before {
        return Ok(());
    }
    write_records(&records, path)
}

fn write_temp(stored: &impl Serialize, path: &Path) -> Result<(), StoreError> {
    let temp = temp_path(path);
    let mut file = open_temp(&temp).map_err(StoreError::Io)?;
    // On Windows this changes the temp's DACL while it is still empty. No
    // credential bytes exist during the brief interval before restriction.
    restrict_to_owner(&temp).map_err(|e| {
        let _ = fs::remove_file(&temp);
        e
    })?;
    let written = serde_json::to_writer(&mut file, stored)
        .map_err(StoreError::Serde)
        .and_then(|()| file.sync_all().map_err(StoreError::Io));
    if let Err(e) = written {
        let _ = fs::remove_file(&temp);
        return Err(e);
    }
    Ok(())
}

/// Publishes the whole set. An empty set is never written: the store's
/// empty state is no file at all.
fn write_records(records: &[StoredDeviceRecord], path: &Path) -> Result<(), StoreError> {
    if records.is_empty() {
        return forget(path);
    }
    let stored = StoredV2 {
        v: STORE_VERSION,
        devices: records.to_vec(),
    };
    write_temp(&stored, path)?;
    publish_temp(&temp_path(path), path).map_err(StoreError::Io)
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
///
/// The credential lives in TWO places after a crashed write: the store and
/// its sibling temp. Both go, because this is the one operation whose
/// entire promise is that the secret is gone. A file that was never there
/// is success; a file that exists and cannot be removed is a failure to
/// discard, and saying `Ok` there would be this function lying about the
/// only thing it promises.
pub fn forget(path: &Path) -> Result<(), StoreError> {
    let store = discard(path);
    let temp = discard(&temp_path(path));
    store.and(temp)
}

/// Removes one file. Already gone is success; present but unremovable is
/// an error.
fn discard(file: &Path) -> Result<(), StoreError> {
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(StoreError::Io(e)),
    }
}

/// Read a handshake result back.
pub fn load(path: &Path) -> Result<Handshake, StoreError> {
    load_with_delivery(path).map(|(handshake, _)| handshake)
}

/// Read the handshake and any response that still needs delivery. The
/// single-device view of the set: the first record — the one every
/// installed copy has today.
///
/// Only the FIRST record is realized. A later record that cannot be
/// realized (a phone field that refuses, an invalid delivery) makes
/// [`load_devices`] fail the whole set while this reader still answers.
/// The asymmetry is deliberate, and is stated here because two readers of
/// one file disagreeing otherwise looks like a bug: the desk's view must
/// keep working no matter what record follows its device in the file, and
/// the set view must not promise a set it cannot fully deliver.
pub fn load_with_delivery(path: &Path) -> Result<(Handshake, Option<Delivery>), StoreError> {
    match read_records_or_empty(path)?.into_iter().next() {
        Some(record) => realize(record).map(|(device, delivery)| (device.handshake, delivery)),
        None => Err(empty_store()),
    }
}

/// Every paired device, oldest first — a migrated v1 file reads back as its
/// one device. An absent file is an empty set, not an error: that is the
/// same "unpaired" the single-device readers report as not-found.
///
/// Every record is realized: one bad record fails the whole set, unlike
/// [`load_with_delivery`], which answers from the first record alone and
/// says nothing about the rest. Same file, two contracts, on purpose —
/// see that function's comment before "fixing" either side.
pub fn load_devices(path: &Path) -> Result<Vec<StoredDevice>, StoreError> {
    read_records_or_empty(path)?
        .into_iter()
        .map(|record| realize(record).map(|(device, _)| device))
        .collect()
}

/// An empty set, in the words the existing single-device callers already
/// understand: not-found is what the shell and the desk match on to mean
/// "this computer is not paired".
fn empty_store() -> StoreError {
    StoreError::Io(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        "no device is stored",
    ))
}

/// Turns a stored record back into what the app works with, refusing every
/// way a record can be wrong with the one error, as the single-device load
/// always did.
fn realize(record: StoredDeviceRecord) -> Result<(StoredDevice, Option<Delivery>), StoreError> {
    let credential = Credential::from_hex(&record.credential_hex)
        .ok_or(StoreError::Corrupt("credential is not 64 hex characters"))?;
    let phone = record
        .phone
        .into_phone()
        .ok_or(StoreError::Corrupt("stored parameters cannot exist"))?;
    if record
        .delivery
        .as_ref()
        .is_some_and(|delivery| !delivery.is_valid())
    {
        return Err(StoreError::Corrupt("stored delivery is invalid"));
    }
    Ok((
        StoredDevice {
            id: record.id,
            label: record.label,
            handshake: Handshake::new(phone, credential),
        },
        record.delivery,
    ))
}

/// The records on disk, in either format the store has ever written, with
/// the v1 file lifted into a one-device set. The bytes are never rewritten
/// here — see the module comment on migration.
fn read_records(path: &Path) -> Result<Vec<StoredDeviceRecord>, StoreError> {
    let bytes = fs::read(path).map_err(StoreError::Io)?;
    let probe: VersionProbe = serde_json::from_slice(&bytes).map_err(StoreError::Serde)?;
    let records = match probe.v {
        STORE_VERSION => {
            let stored: StoredV2 = serde_json::from_slice(&bytes).map_err(StoreError::Serde)?;
            stored.devices
        }
        V1_VERSION => {
            let stored: StoredHandshake = serde_json::from_slice(&bytes).map_err(StoreError::Serde)?;
            // The lift: the one device keeps the id and the label the app
            // has been giving it all along, and any delivery still waiting
            // for the phone's retry travels with it.
            vec![StoredDeviceRecord {
                id: 0,
                label: DEFAULT_LABEL.to_owned(),
                credential_hex: stored.credential_hex,
                phone: stored.phone,
                delivery: stored.delivery,
            }]
        }
        _ => return Err(StoreError::Corrupt("unsupported stored version")),
    };
    // A set that cannot tell two of its devices apart is corrupt, for the
    // same reason the door refuses such a set of credentials.
    for (index, record) in records.iter().enumerate() {
        for other in &records[..index] {
            if record.id == other.id {
                return Err(StoreError::Corrupt("two devices share an id"));
            }
            if record.credential_hex == other.credential_hex {
                return Err(StoreError::Corrupt("two devices share a credential"));
            }
        }
    }
    Ok(records)
}

/// The write-side view of the same read: no file yet means an empty set a
/// first device can be added to.
fn read_records_or_empty(path: &Path) -> Result<Vec<StoredDeviceRecord>, StoreError> {
    match read_records(path) {
        Ok(records) => Ok(records),
        Err(StoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(Vec::new())
        }
        Err(error) => Err(error),
    }
}

/// The one field the version probe needs; parsing anything bigger before
/// the version is known would attribute a v1 file's shape errors to v2.
#[derive(Deserialize)]
struct VersionProbe {
    v: u8,
}

/// Remove only the retained response while preserving the paired handshake.
pub fn clear_delivery(path: &Path) -> Result<(), StoreError> {
    let (handshake, _) = load_with_delivery(path)?;
    replace_record(&handshake, path, None)
}

#[cfg(test)]
mod tests;
