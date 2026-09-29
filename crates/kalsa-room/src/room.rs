//! The room itself: opening the store, posting with idempotency, and
//! history pages. The transcript file is `log`'s business, the roster is
//! `roster`'s, enrollment and names are `members`', the live stream is
//! `events`'.
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
use std::time::{SystemTime, UNIX_EPOCH};

use crate::events::StoredEvent;
use crate::log::{self, Message};
use crate::roster::{self, Roster};
use crate::{Entry, MemberId, RoomError};

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
    file: File,
    writable: bool,
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
    pub fn open(dir: &Path) -> Result<Self, RoomError> {
        tighten_dir(dir)?;
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

    /// Appends one message and answers it. The same `(member,
    /// client_msg_id)`, with the same text and flag, never posts twice:
    /// the seq the first attempt got is the seq every retry sees, so a
    /// phone that queues messages while the host sleeps can retry on every
    /// wake without a duplicate ever landing. The same id with DIFFERENT
    /// words or flag is refused: one id, one message.
    pub fn post(
        &self,
        member: MemberId,
        client_msg_id: &str,
        text: &str,
        call_ai: bool,
    ) -> Result<Entry, PostError> {
        if !log::is_client_msg_id(client_msg_id) {
            return Err(PostError::BadClientMsgId);
        }
        if text.is_empty() {
            return Err(PostError::EmptyText);
        }
        if text.len() > log::MAX_TEXT_BYTES {
            return Err(PostError::TextTooLong);
        }
        let mut writer = self.lock_write();
        if !writer.writable {
            return Err(PostError::ReadOnly);
        }
        let fresh = {
            let state = self.lock_state();
            if !state.roster.is_live(member) {
                return Err(PostError::NotAMember);
            }
            match state
                .by_client
                .get(&(member, client_msg_id.to_string()))
                .copied()
            {
                Some(seq) => {
                    let stored = &state.messages[seq as usize - 1];
                    if stored.text == text && stored.call_ai == call_ai {
                        return Ok(Entry::of(stored));
                    }
                    return Err(PostError::ClientIdReused);
                }
                None => Message {
                    seq: state.messages.len() as u64 + 1,
                    member,
                    client_msg_id: client_msg_id.to_string(),
                    text: text.to_string(),
                    time: now(),
                    call_ai,
                },
            }
        };
        if let Err(error) = log::append(&mut writer.file, &fresh) {
            return self.after_failed_append(&mut writer, fresh, error);
        }
        Ok(self.land(fresh))
    }

    /// The AI's own finished answer, appended to the transcript like any
    /// entry — its own seq, no idempotency key, because nobody retries an
    /// AI turn by id. The flag is true because an answer belongs to a
    /// called turn, the only way the AI ever speaks (the protocol's
    /// `ai_message` shape).
    pub fn post_ai(&self, text: &str) -> Result<Entry, PostError> {
        if text.is_empty() {
            return Err(PostError::EmptyText);
        }
        if text.len() > log::MAX_TEXT_BYTES {
            return Err(PostError::TextTooLong);
        }
        let mut writer = self.lock_write();
        if !writer.writable {
            return Err(PostError::ReadOnly);
        }
        let fresh = {
            let state = self.lock_state();
            Message {
                seq: state.messages.len() as u64 + 1,
                member: MemberId::Ai,
                client_msg_id: String::new(),
                text: text.to_string(),
                time: now(),
                call_ai: true,
            }
        };
        if let Err(error) = log::append(&mut writer.file, &fresh) {
            return self.after_failed_append(&mut writer, fresh, error);
        }
        Ok(self.land(fresh))
    }

    /// The append's fate is unknown, so the file is asked. A reopen that
    /// finds the entry proves it landed — answer it as the entry it now
    /// is; anything else refuses, read-only when the reopen could not
    /// repair, the io error itself when it could and the entry simply is
    /// not there.
    fn after_failed_append(
        &self,
        writer: &mut Writer,
        message: Message,
        error: std::io::Error,
    ) -> Result<Entry, PostError> {
        let reopened = log::open(&self.dir.join(log::LOG_NAME))
            .map_err(|failure| PostError::Io(io_of(failure)))?;
        writer.file = reopened.file;
        writer.writable = reopened.writable;
        let landed = reopened
            .messages
            .last()
            .filter(|landed| {
                landed.seq == message.seq
                    && landed.member == message.member
                    && landed.client_msg_id == message.client_msg_id
                    && landed.text == message.text
            })
            .cloned();
        match landed {
            Some(landed) => Ok(self.land(landed)),
            None if !writer.writable => Err(PostError::ReadOnly),
            None => Err(PostError::Io(error)),
        }
    }

    /// Publishes a durable entry to the readers: the memory, the
    /// idempotency key, the numbered event, then the wake. Called with the
    /// write lock held, after the entry is on disk — the disk leads, the
    /// memory follows, and a reader between the two sees the room as it
    /// was, never a room that is not.
    fn land(&self, message: Message) -> Entry {
        let shared = Arc::new(message);
        {
            let mut state = self.lock_state();
            if shared.member != MemberId::Ai {
                state
                    .by_client
                    .insert((shared.member, shared.client_msg_id.clone()), shared.seq);
            }
            state.events.push(StoredEvent::Message(Arc::clone(&shared)));
            state.messages.push(Arc::clone(&shared));
        }
        self.notify();
        Entry::of(&shared)
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

/// Unix seconds, and 0 — an honest unknown — on a clock set before the
/// epoch: never a panic, and never inside a lock's critical section.
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0)
}

/// A recovery failure as the io error the caller sees. A corrupt file is
/// not retryable, so it does not become one.
fn io_of(error: RoomError) -> std::io::Error {
    match error {
        RoomError::Io(error) => error,
        RoomError::Corrupt(why) => std::io::Error::other(why),
        RoomError::RosterFull => std::io::Error::other("the room has more members than it can name"),
    }
}

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
