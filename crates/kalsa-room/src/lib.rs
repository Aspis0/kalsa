//! The room's store: the one transcript a Kalsa computer hosts, on disk and
//! in memory, with nothing else — no routes (the door's step), no AI (a
//! later step), no presentation.
//!
//! Members are the room's people as the protocol names them: a phone is its
//! pairing device id, the host and the AI are fixed ids. The store does not
//! know which devices are paired or what they are called before they name
//! themselves; it keeps what it is given and refuses what it cannot mean.
//!
//! Every transcript entry is one line of `room-log.jsonl` in the directory
//! the app opens the room from. The append is the atomicity: one complete
//! line per entry, written under the room's lock, flushed with `sync_all`
//! before the entry exists to anyone. A crash can therefore lose the line
//! being written or tear it — and nothing else. A torn last line is
//! recovered at the next open, truncated or newline-repaired, never fatal;
//! corruption anywhere before it refuses the whole room, because silently
//! dropping a middle entry would be lying about a transcript people
//! remember. The names file, being a whole-document state, rides the
//! pairing store's temp-and-rename publication instead.
//!
//! The subscribe primitive is the door's job log shape (`jobs.rs`): a
//! shared condvar, a per-reader cursor, events handed out under the lock
//! and used outside it. The door's threading model is plain std threads —
//! there is no async runtime to fit, so none is imported.

use std::fmt;

mod log;
mod names;
mod room;

#[cfg(test)]
mod tests;

pub use log::Message;
pub use names::NameError;
pub use room::{PostError, Room, Take};

/// A room member: a paired phone's device id, or one of the two fixed ids.
///
/// The host and the AI sit at the top of the `u32` range because device
/// ids are minted climbing from zero: these two are the ids a pairing set
/// would reach last, in an app that hosts a household, never a nation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct MemberId(u32);

impl MemberId {
    /// The computer's own user.
    pub const HOST: Self = Self(u32::MAX);
    /// The AI, displayed as "Kalsa". Reserved beside the host so no later
    /// step can give it an id a device could plausibly hold.
    pub const AI: Self = Self(u32::MAX - 1);

    /// The member a paired device is: its id from the pairing store.
    pub fn device(id: u32) -> Self {
        Self(id)
    }

    /// The id as the number the rest of the app knows.
    pub fn value(self) -> u32 {
        self.0
    }
}

/// An open failure. `Corrupt` is deliberately separate from I/O: a
/// transcript that disagrees with itself is not retried, and the value
/// names what was wrong without quoting whatever line said it.
#[derive(Debug)]
pub enum RoomError {
    Io(std::io::Error),
    Corrupt(&'static str),
}

impl fmt::Display for RoomError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "room store: {error}"),
            Self::Corrupt(why) => write!(f, "room store is corrupt: {why}"),
        }
    }
}

impl std::error::Error for RoomError {}

impl From<std::io::Error> for RoomError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
