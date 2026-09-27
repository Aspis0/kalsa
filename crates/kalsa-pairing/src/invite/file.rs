//! The invite file: one envelope, one record per invitation the phone has
//! not claimed yet, each record carrying the square's own JSON byte for
//! byte.
//!
//! Byte for byte is the point. The record's `payload` is exactly what
//! `qr_payload` produced, so the link handed out before a restart decodes to
//! the very document the phone parses after it — nothing is re-serialised,
//! no field is dropped or reworded on the way to disk and back.
//!
//! What the reader honours is narrow, and every refusal is the same shape:
//! **an invitation can only be lost here, never extended and never created.**
//! A record whose window has closed, whose deadline sits further out than an
//! invite this build could have minted, or whose square carries no node to
//! dial is dropped on its own; a file that does not parse, names another
//! version, or holds a square this build cannot read hands back nothing at
//! all. The file itself is never rewritten by a read and never deleted by a
//! refusal — the next legitimate write replaces it atomically, and nothing
//! that failed to read is ever honoured again.
//!
//! A claim leaves no record: the set writes the file without a ceremony the
//! phone has claimed, so a restart can never hand a used code to a second
//! phone.
//!
//! The file holds secrets, so it is written by the store's own road
//! (`store::publish_json`): sibling temp at `0600` on unix, a protected DACL
//! on Windows, flushed, renamed over and the directory fsynced after it.
//! Permissions here cannot drift wider than `pairing.json`'s because they
//! are the same code.

use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

use crate::ceremony::Pairing;
use crate::error::InviteError;
use crate::store::publish_json;
use super::INVITE_TTL;

/// The envelope this build writes. A reader that meets another version
/// honours none of it: its records may be shaped however this build cannot
/// guess.
const FILE_VERSION: u8 = 2;

/// How far a recorded deadline may sit beyond the window an invite could
/// have been minted with before the record is refused. A few seconds of
/// clock skew between the write and the read, and no more: a deadline
/// further out than this build could ever have written is not a deadline
/// this build wrote, and a reader that honoured it would be handing an
/// attacker (or a clock that went backwards) a longer window than the
/// owner ever granted.
const CLOCK_SKEW: Duration = Duration::from_secs(5);

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
    /// The id the NEXT invitation takes, moved forward and never back: an
    /// id is not minted from whatever records survived a read, so a
    /// cancelled or expired invitation's id stays spent for as long as this
    /// file lives and a stale row cannot come to name a different, live
    /// invitation.
    next_id: u32,
    invites: Vec<Record>,
}

/// What a read gave back. `discarded` says the file held invitations this
/// build did NOT bring back — unreadable, another version, or a record the
/// window and node rules refused. Records that merely expired are not
/// discarded: the owner was always told the day would end.
pub(super) struct Loaded {
    pub(super) invites: Vec<(u32, Pairing)>,
    pub(super) next_id: u32,
    pub(super) discarded: bool,
}

/// Read the invitations back. This never fails: a file that cannot be
/// honoured yields an EMPTY set, so one bad file cannot end the feature —
/// nothing in it is ever honoured, and the next mint, cancel or claim
/// replaces it. No file is an empty set — no links are out — which is the
/// same answer the credential store gives for a store that is not there.
pub(super) fn read(path: &Path, now: SystemTime) -> Loaded {
    let mut loaded = Loaded {
        invites: Vec::new(),
        next_id: 0,
        discarded: false,
    };
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == ErrorKind::NotFound => return loaded,
        Err(_) => {
            loaded.discarded = true;
            return loaded;
        }
    };
    let Ok(envelope) = serde_json::from_slice::<Envelope>(&bytes) else {
        loaded.discarded = true;
        return loaded;
    };
    if envelope.v != FILE_VERSION {
        loaded.discarded = true;
        return loaded;
    }
    loaded.next_id = envelope.next_id;
    for record in envelope.invites {
        if record.expires_at <= now {
            continue;
        }
        if record.expires_at > now + INVITE_TTL + CLOCK_SKEW {
            loaded.discarded = true;
            continue;
        }
        let Some(payload) = square_of(&record) else {
            // Not a square this build reads: the file is refused as a
            // whole and nothing from it is honoured — fail closed, never
            // half. The counter survives, so ids already spent in this file
            // stay spent.
            loaded.invites.clear();
            loaded.discarded = true;
            return loaded;
        };
        if node_of(&payload).is_none() {
            loaded.discarded = true;
            continue;
        }
        let Some(pairing) = restore(&payload, record.expires_at) else {
            loaded.invites.clear();
            loaded.discarded = true;
            return loaded;
        };
        loaded.invites.push((record.id, pairing));
    }
    // A file may name records above its own counter (hand-edited, or
    // written by a build that counted differently): the counter never sits
    // below an id this file has already handed out.
    if let Some(next) = loaded
        .invites
        .iter()
        .map(|(id, _)| *id)
        .max()
        .and_then(|highest| highest.checked_add(1))
    {
        loaded.next_id = loaded.next_id.max(next);
    }
    loaded
}

/// Publish the invitations the owner still has out. The set hands over the
/// records themselves and the counter they were minted against, so this is
/// the only place the file's shape is built.
pub(super) fn write(path: &Path, next_id: u32, invites: Vec<Record>) -> Result<(), InviteError> {
    let envelope = Envelope {
        v: FILE_VERSION,
        next_id,
        invites,
    };
    publish_json(&envelope, path).map_err(InviteError::Io)
}

/// The square a record carries: its JSON, with the version that makes it a
/// square rather than any JSON with a code in it. `None` when the payload
/// is not a document this build can read at all — the reader then refuses
/// the file whole. The version is required but not counted against a
/// constant: the fields below are what this build reads, and a future
/// square that renames them is refused as a whole instead of being half
/// understood.
fn square_of(record: &Record) -> Option<serde_json::Value> {
    let payload: serde_json::Value = serde_json::from_str(&record.payload).ok()?;
    payload.get("v").and_then(|value| value.as_u64())?;
    Some(payload)
}

/// The node id a square names, when it names one worth dialing. An invite
/// without it is a link that stops at the code — this build never mints one
/// — so a record carrying neither is dropped like any other invitation that
/// cannot be honoured.
fn node_of(payload: &serde_json::Value) -> Option<&str> {
    payload
        .get("node")
        .and_then(|value| value.as_str())
        .filter(|node| !node.is_empty())
}

/// One square back into the ceremony it was written from: the fields the
/// completion MAC is keyed on, handed to the ceremony's own rebuild.
fn restore(payload: &serde_json::Value, expires_at: SystemTime) -> Option<Pairing> {
    let text = |key: &str| payload.get(key).and_then(|value| value.as_str());
    Pairing::restore(
        text("reachable")?,
        text("code")?,
        text("nonce")?,
        text("node"),
        text("tailnet"),
        expires_at,
    )
}

#[cfg(test)]
mod tests;
