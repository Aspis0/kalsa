//! The room's store: the one transcript a Kalsa computer hosts, its
//! members, and the stream both feed — no routes (the door's step), no AI
//! beyond its finished entries (a later step), no presentation.
//!
//! Members are the room's own. The roster (`roster`) mints a member id for
//! each pairing device at first sight and retires it when the device is
//! forgotten, because a pairing id is re-minted after a forget and a room
//! that used pairing ids would hand a new phone an old member's name and
//! words. The host and the AI are fixed, unforgeable variants of
//! [`MemberId`].
//!
//! The transcript is `room-log.jsonl`, one JSON line per entry, written in
//! one `write_all` and flushed with `sync_all` before the entry exists to
//! anyone — the atomic unit is the line, so a crash costs at most a torn
//! last line, never anything before it. The file's first creation is
//! owner-only (`0600`) and fsyncs the directory it landed in, so a
//! transcript a crash can forget whole is a transcript that never was.
//! Damage is recovered, never deleted and never fatal: every byte the
//! recovery drops is first copied whole beside the transcript
//! (`room-log.damaged-<time>.jsonl`, owner-only) and the room reopens on
//! the longest intact prefix (`log`). The roster and those copies ride the
//! pairing store's owner-only publication.
//!
//! Two locks keep readers off the writer's disk: writers serialize under
//! the write lock (every fsync inside it), then publish the new entry into
//! the readers' state under a short lock and wake the stream's waiters
//! (`room`, `events`). The door's threading model is plain std threads —
//! there is no async runtime to fit, so none is imported.
//!
//! One process owns a room's directory: this crate locks nothing against a
//! second one, the same single-writer assumption the pairing store states.
//!
//! The transcript's line version is 1 and assumes no file written before
//! the `kind` field existed: none can be, this crate was unwired until it
//! gained the field. The version must be bumped the day that assumption
//! stops being true.

use std::fmt;

mod append;
mod events;
mod history;
mod names;
mod log;
mod members;
mod mention;
mod recovery;
mod roster;
mod room;

#[cfg(test)]
mod tests;

pub use events::{Event, MemberEvent, Take};
pub use mention::calls_ai;
pub use history::{Page, PageError};
pub use room::{PostError, Room};
pub use names::NameError;

/// A room member: the host, the AI, or a member the room's roster minted.
/// The host and the AI are their own variants so a device id can never
/// wear either: the ids a phone can hold are the room's own, minted far
/// below the two reserved numbers, and the reserved two exist only as
/// these variants.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MemberId {
    Host,
    Ai,
    /// Room-local and retired with the member (see `roster`).
    Member(u32),
}

impl MemberId {
    /// The number the wire carries, matching the protocol's two fixed ids:
    /// the host is 4294967295, the AI is 4294967294, a member is its
    /// roster number.
    pub fn wire(self) -> u32 {
        match self {
            Self::Host => u32::MAX,
            Self::Ai => u32::MAX - 1,
            Self::Member(number) => number,
        }
    }

    /// The member a wire number names. Total by construction: the two
    /// reserved values are the variants above, and every other number is a
    /// member.
    pub fn from_wire(value: u32) -> Self {
        match value {
            u32::MAX => Self::Host,
            value if value == u32::MAX - 1 => Self::Ai,
            value => Self::Member(value),
        }
    }
}

/// One transcript entry as the room hands it out. The store's internal
/// shape keeps the `client_msg_id` for idempotency; this — the shape posts
/// and pages answer with — does not, because the protocol never carries it
/// back out. `Debug` is written by hand: a derived one would reprint what
/// people wrote.
#[derive(Clone, PartialEq, Eq)]
pub struct Entry {
    pub seq: u64,
    pub member: MemberId,
    pub text: String,
    pub time: u64,
    pub call_ai: bool,
}

impl Entry {
    pub(crate) fn of(message: &log::Message) -> Self {
        Self {
            seq: message.seq,
            member: message.member,
            text: message.text.clone(),
            time: message.time,
            call_ai: message.call_ai,
        }
    }
}

impl fmt::Debug for Entry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "entry {} by {:?} at {} ({} bytes)",
            self.seq,
            self.member,
            self.time,
            self.text.len()
        )
    }
}

/// An open failure. `Display` never carries the io error's own words — an
/// OS message happily names a full path, and nothing the door may send a
/// phone should; the value keeps the error for the app's local logs, where
/// paths belong.
#[derive(Debug)]
pub enum RoomError {
    Io(std::io::Error),
    Corrupt(&'static str),
    /// The roster's member counter reached the reserved range. No
    /// household gets here; no store may wrap it.
    RosterFull,
}

impl fmt::Display for RoomError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(_) => f.write_str("the room's store failed on disk"),
            Self::Corrupt(why) => write!(f, "the room's store is corrupt: {why}"),
            Self::RosterFull => f.write_str("the room has more members than it can name"),
        }
    }
}

impl std::error::Error for RoomError {}

impl From<std::io::Error> for RoomError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
