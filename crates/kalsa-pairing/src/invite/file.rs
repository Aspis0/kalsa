//! The invite file: one envelope, one record per invitation the phone has
//! not claimed yet, each record carrying the square's own JSON byte for
//! byte.
//!
//! Byte for byte is the point. The record's `payload` is exactly what
//! `qr_payload` produced, so the link handed out before a restart decodes to
//! the very document the phone parses after it — nothing is re-serialised,
//! no field is dropped or reworded on the way to disk and back.
//!
//! A claim leaves no record: the set writes the file without a ceremony the
//! phone has claimed, so a restart can never hand a used code to a second
//! phone. An invitation whose window closed is dropped on read, and the file
//! itself is not rewritten by a read — a load has no business publishing,
//! and the next legitimate write carries the shrunk set.
//!
//! The file holds secrets, so it is written by the store's own road
//! (`store::publish_json`): sibling temp at `0600` on unix, a protected DACL
//! on Windows, flushed, renamed over. Permissions here cannot drift wider
//! than `pairing.json`'s because they are the same code.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::ceremony::Pairing;
use crate::error::InviteError;
use crate::store::publish_json;

/// The envelope this build writes. A reader that meets another version
/// refuses the file whole rather than guessing what its records mean.
const FILE_VERSION: u8 = 1;

/// One invitation as the set hands it over and the file keeps it: the id
/// the page lists, the deadline it counts down to, and the square's JSON as
/// the link carries it.
///
/// No `Debug`: the payload IS the code in the clear, and a derived Debug
/// would print it the first time anything logged a failed write.
#[derive(Serialize, Deserialize)]
pub(super) struct Record {
    pub(super) id: u32,
    pub(super) expires_at: SystemTime,
    pub(super) payload: String,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    v: u8,
    invites: Vec<Record>,
}

/// Every invitation still on the table, rebuilt as the ceremonies they
/// were. No file is an empty set — no links are out. An invitation whose
/// window has closed is dropped here rather than rewritten, and one whose
/// payload this build cannot read refuses the whole file: a link half read
/// is a link that would pair nobody, and the file is left untouched so the
/// owner loses nothing by the refusal.
pub(super) fn read(path: &Path, now: SystemTime) -> Result<Vec<(u32, Pairing)>, InviteError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(InviteError::Io(error)),
    };
    let envelope: Envelope = serde_json::from_slice(&bytes).map_err(InviteError::Serde)?;
    if envelope.v != FILE_VERSION {
        return Err(InviteError::Corrupt(
            "an invite file version this build does not read",
        ));
    }
    let mut restored = Vec::with_capacity(envelope.invites.len());
    for record in envelope.invites {
        if record.expires_at <= now {
            continue;
        }
        let ceremony = restore(&record).ok_or(InviteError::Corrupt(
            "an invitation is not a square this build reads",
        ))?;
        restored.push((record.id, ceremony));
    }
    Ok(restored)
}

/// Publish the invitations the owner still has out. The set hands over the
/// records themselves, so this is the only place the file's shape is built.
pub(super) fn write(path: &Path, invites: Vec<Record>) -> Result<(), InviteError> {
    let envelope = Envelope {
        v: FILE_VERSION,
        invites,
    };
    publish_json(&envelope, path).map_err(InviteError::Io)
}

/// One record back into the ceremony it was written from. The payload is
/// read for exactly the fields the completion MAC is keyed on — the address,
/// the code, the nonce, the node id when the road was open. The version is
/// required to be there (that is what makes the document a square rather
/// than any JSON with a code in it) but not counted against a constant: the
/// fields are what this build reads, and a future square that renames them
/// is refused as a whole instead of being half understood.
fn restore(record: &Record) -> Option<Pairing> {
    let payload: serde_json::Value = serde_json::from_str(&record.payload).ok()?;
    if payload.get("v").and_then(|value| value.as_u64()).is_none() {
        return None;
    }
    let text = |key: &str| payload.get(key).and_then(|value| value.as_str());
    Pairing::restore(
        text("reachable")?,
        text("code")?,
        text("nonce")?,
        text("node"),
        text("tailnet"),
        record.expires_at,
    )
}

#[cfg(test)]
mod tests;
