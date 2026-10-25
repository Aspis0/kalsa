//! The transcript's disk hygiene and its recovery: owner-only creation,
//! narrowing a wider file, the damaged-bytes copy, and the prefix rewrite.
//! Nothing here decides WHAT is valid — `log` parses and judges; this
//! module only makes the file safe and keeps every byte the recovery
//! drops.

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::RoomError;

/// Keeps every byte the recovery is about to drop and rewrites the live
/// file to its intact prefix. Both writes ride the pairing publication
/// (owner-only temp, flushed, renamed, the directory fsynced). `false`
/// means the recovery did not land: the original file is untouched and the
/// caller opens read-only. A copy that succeeded before a rewrite that
/// failed leaves a spare copy behind; the next open simply makes another,
/// and nothing is ever lost for trying.
///
/// After a recovery that landed, the NEWEST two damaged copies are all
/// that stay: damage is rare, two whole transcripts of it is already an
/// extravagance, and older ones would accumulate at full size forever.
pub(super) fn recover(path: &Path, bytes: &[u8], prefix_len: usize) -> bool {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or(0);
    let damaged = path.with_file_name(format!("room-log.damaged-{stamp}.jsonl"));
    if kalsa_pairing::store::write_owner_only(&damaged, bytes).is_err() {
        return false;
    }
    if kalsa_pairing::store::write_owner_only(path, &bytes[..prefix_len]).is_err() {
        return false;
    }
    prune_damaged(path, &damaged);
    true
}

/// Removes the older damaged copies beyond the two newest, the one just
/// written among them. Sorted by name, which the nanosecond stamp keeps in
/// time order; a removal that fails is left for the next recovery — a
/// stale copy costs disk, never correctness.
fn prune_damaged(path: &Path, keep_newest: &Path) {
    let Some(dir) = path.parent() else {
        return;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut copies: Vec<std::path::PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            let kept = path == keep_newest;
            let named = path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("room-log.damaged-"));
            named && !kept
        })
        .collect();
    copies.sort();
    let excess = copies.len().saturating_sub(1);
    for stale in copies.into_iter().take(excess) {
        let _ = fs::remove_file(stale);
    }
}

/// Rewrites the newline a complete last entry lost. Nothing is dropped, so
/// no damaged copy is owed; `false` leaves the room read-only rather than
/// appending after a fragment.
pub(super) fn repair_newline(path: &Path) -> bool {
    match OpenOptions::new().append(true).open(path) {
        Ok(mut file) => file.write_all(b"\n").and_then(|()| file.sync_all()).is_ok(),
        Err(_) => false,
    }
}

/// The first creation: owner-only from its first byte, flushed, and the
/// directory fsynced after it, so the name cannot vanish under a power
/// loss and leave the room believing a transcript exists.
pub(super) fn create(path: &Path) -> Result<File, RoomError> {
    let mut options = OpenOptions::new();
    options.read(true).append(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(file) => {
            let _ = file.sync_all();
            sync_dir(path);
            Ok(file)
        }
        // Another writer created it between the read and this create: one
        // process per room is the app's to guarantee (the pairing store
        // states the same), and the caller serves what the file holds.
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            OpenOptions::new()
                .read(true)
                .append(true)
                .open(path)
                .map_err(RoomError::Io)
        }
        Err(error) => Err(RoomError::Io(error)),
    }
}

/// Narrows an existing file wider than `0600`. Never widens: a file
/// already stricter is the owner's choice.
#[cfg(unix)]
pub(super) fn tighten(path: &Path) -> Result<(), RoomError> {
    use std::os::unix::fs::PermissionsExt;
    let mode = fs::metadata(path)?.permissions().mode() & 0o777;
    if mode & !0o600 != 0 {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(not(unix))]
pub(super) fn tighten(_path: &Path) -> Result<(), RoomError> {
    Ok(())
}

/// The pairing store's directory discipline: a file is on disk when the
/// directory holding its name is. Failures are not reported — the creation
/// has already happened, and a caller told it failed would roll back a
/// memory state the directory has moved past.
#[cfg(unix)]
pub(super) fn sync_dir(path: &Path) {
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let _ = File::open(parent).and_then(|directory| directory.sync_all());
}

#[cfg(not(unix))]
pub(super) fn sync_dir(_path: &Path) {}
