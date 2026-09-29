//! The room itself: what it holds and how it opens. The transcript file
//! is `log`'s business, the roster is `roster`'s, the name rules are
//! `names`', enrollment is `members`', posting is `append`'s, history
//! pages are `history`'s, the live stream is `events`'.
//!
//! Two locks, one rule each. The WRITE lock serializes writers and holds
//! every disk fsync; the STATE lock guards only what readers see, so a
//! reader never waits on a writer's fsync — the entry is appended and
//! synced first, then published into the readers' state under the short
//! lock, then the waiters are woken. Writers take the locks in one order
//! (write, then state) and readers take only state, so the two never
//! circle; the write lock is held across the publish, which is what keeps
//! one seq order under concurrency.

use std::collections::HashMap;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use crate::events::StoredEvent;
use crate::log::{self, Message};
use crate::roster::{self, Roster};
use crate::{MemberId, RoomError};

/// Why a post was refused. The words below are all a client ever sees; the
/// io error stays in the value for the app's local log, where paths
/// belong.
#[derive(Debug)]
pub enum PostError {
    EmptyText,
    TextTooLong,
    BadClientMsgId,
    /// One client_msg_id, one message: a retry with different words or a
    /// different flag is a disagreement, not a retry.
    ClientIdReused,
    NotAMember,
    /// The transcript could not be repaired at open. Reads serve what is
    /// intact; writes are refused until a reopen succeeds.
    ReadOnly,
    Io(std::io::Error),
}

impl std::fmt::Display for PostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyText => f.write_str("a message needs text"),
            Self::TextTooLong => f.write_str("the message is too long"),
            Self::BadClientMsgId => f.write_str("the client message id is malformed"),
            Self::ClientIdReused => {
                f.write_str("that client message id was already used for a different message")
            }
            Self::NotAMember => f.write_str("that member cannot post in this room"),
            Self::ReadOnly => {
                f.write_str("the room's transcript needs repair; posts are refused until it is reopened")
            }
            Self::Io(_) => f.write_str("the room's store failed on disk"),
        }
    }
}

pub struct Room {
    pub(crate) dir: PathBuf,
    write: Mutex<Writer>,
    state: Mutex<State>,
    pub(crate) signal: Condvar,
}

pub(crate) struct Writer {
    pub(crate) file: File,
    pub(crate) writable: bool,
}

pub(crate) struct State {
    pub(crate) messages: Vec<Arc<Message>>,
    /// (author, client_msg_id) → the seq it got. Only member entries are
    /// keyed: an AI entry has no idempotency key.
    pub(crate) by_client: HashMap<(MemberId, String), u64>,
    pub(crate) events: Vec<StoredEvent>,
    pub(crate) roster: Roster,
}

impl Room {
    /// Opens the room in `dir`, which the app owns and must already exist —
    /// the same rule the pairing store states. The directory is narrowed
    /// to owner-only (the transcript, the roster and the damaged-byte
    /// copies all live in it); the transcript is created owner-only or
    /// recovered from damage; a roster the store cannot trust refuses the
    /// room whole.
    ///
    /// The room owns exactly one directory — `room`, created inside the
    /// given data directory if absent — and only that one is narrowed to
    /// owner-only. A room never chmods a directory it did not make; the
    /// app's data directory is the app's.
    pub fn open(data_dir: &Path) -> Result<Self, RoomError> {
        let dir = data_dir.join(ROOM_DIR);
        std::fs::create_dir_all(&dir).map_err(RoomError::Io)?;
        tighten_dir(&dir)?;
        let opened = log::open(&dir.join(log::LOG_NAME))?;
        let roster = roster::load(&dir.join(roster::ROSTER_NAME))?;
        let messages: Vec<Arc<Message>> = opened.messages.into_iter().map(Arc::new).collect();
        let events = messages
            .iter()
            .map(|message| StoredEvent::Message(Arc::clone(message)))
            .collect();
        Ok(Self {
            dir: dir.to_path_buf(),
            write: Mutex::new(Writer {
                file: opened.file,
                writable: opened.writable,
            }),
            state: Mutex::new(State {
                by_client: by_client_of(&messages),
                messages,
                events,
                roster,
            }),
            signal: Condvar::new(),
        })
    }

    // Poison policy, decided once for both locks: a panicked critical
    // section does not lock the room out. Every write is disk-first — the
    // file is the truth and memory only catches up — so the state a panic
    // leaves behind is at worst BEHIND the file, never ahead of it. The
    // one divergence a panic can strand (the instant between a successful
    // fsync and the memory publish) heals at the next reopen; a panic
    // inside the publish itself is a bug no policy here could paper over.
    // The door's job log keeps the same discipline.

    pub(crate) fn lock_write(&self) -> MutexGuard<'_, Writer> {
        self.write
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn lock_state(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn notify(&self) {
        self.signal.notify_all();
    }
}

/// The idempotency table off a transcript the loader already validated:
/// one key on two entries is refused there, so it cannot happen here —
/// collect, don't re-check.
fn by_client_of(messages: &[Arc<Message>]) -> HashMap<(MemberId, String), u64> {
    messages
        .iter()
        .filter(|message| message.member != MemberId::Ai)
        .map(|message| {
            (
                (message.member, message.client_msg_id.clone()),
                message.seq,
            )
        })
        .collect()
}

/// The directory the room owns inside the app's data directory. Everything
/// the store writes — transcript, roster, damaged-byte copies — lives in
/// it, and nothing above it is ever touched.
const ROOM_DIR: &str = "room";

/// The room's directory is owner-only: the transcript, the roster and the
/// damaged-byte copies all live in it, and a wider directory would undo
/// their 0600 files for anyone who can walk the path. Narrowed, never
/// widened: a directory already stricter than 0700 is the owner's choice.
#[cfg(unix)]
fn tighten_dir(dir: &Path) -> Result<(), RoomError> {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(dir)?.permissions().mode() & 0o777;
    if mode & !0o700 != 0 {
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn tighten_dir(_dir: &Path) -> Result<(), RoomError> {
    Ok(())
}
