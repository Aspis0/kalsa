//! The room's state and rules: posting with idempotency, history pages,
//! and the subscribe primitive. The transcript file underneath it is
//! `log`'s business, the display names are `names`' business; who the
//! members are is nobody's here.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::log::{self, Message};
use crate::names::{self, NameError};
use crate::{MemberId, RoomError};

/// The most text one message may carry, in UTF-8 bytes.
const MAX_TEXT_BYTES: usize = 8000;
/// The most a client message id may be. ASCII graphic characters only, so
/// it survives logs, JSON, and a phone's storage unchanged.
const MAX_CLIENT_MSG_ID: usize = 64;

/// What `read_since` got for its wait.
#[derive(Debug, PartialEq, Eq)]
pub enum Take {
    Events,
    TimedOut,
}

/// Why a post was refused. The caller turns these into sentences; the store
/// only refuses.
#[derive(Debug)]
pub enum PostError {
    EmptyText,
    TextTooLong,
    BadClientMsgId,
    Io(std::io::Error),
}

impl std::fmt::Display for PostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyText => f.write_str("a message needs text"),
            Self::TextTooLong => f.write_str("the message is too long"),
            Self::BadClientMsgId => f.write_str("the client message id is malformed"),
            Self::Io(error) => write!(f, "room store: {error}"),
        }
    }
}

/// The open room. Shared as `Arc<Room>`: one writer at a time under the
/// lock, any number of readers, new entries waking every waiter.
pub struct Room {
    inner: Mutex<Inner>,
    signal: Condvar,
}

struct Inner {
    /// The transcript, seq-ascending by construction: entry `i` has seq
    /// `i + 1`. This is what makes a cursor an index and history a slice.
    messages: Vec<Message>,
    /// The idempotency table: `(member, client_msg_id)` to the seq it
    /// already got. Rebuilt from the transcript at every open, so a retry
    /// that crosses a restart still finds its message.
    by_client: HashMap<(u32, String), u64>,
    /// Display names members set. A member absent here is showing its
    /// device label, which the pairing store holds, not this crate.
    names: HashMap<MemberId, String>,
    file: File,
    names_path: PathBuf,
}

impl Room {
    /// Opens the room in `dir`, which the app owns and must already exist —
    /// the same rule the pairing store states. Creates the transcript file
    /// if this is the room's first opening, recovers a torn last line if it
    /// is not, and refuses a transcript that disagrees with itself.
    pub fn open(dir: &Path) -> Result<Self, RoomError> {
        let file = OpenOptions::new()
            .read(true)
            .append(true)
            .create(true)
            .open(dir.join("room-log.jsonl"))?;
        let names_path = dir.join("room-names.json");
        let messages = log::load(&file)?;
        let by_client = rebuild_by_client(&messages)?;
        let names = names::load(&names_path)?;
        Ok(Self {
            inner: Mutex::new(Inner {
                messages,
                by_client,
                names,
                file,
                names_path,
            }),
            signal: Condvar::new(),
        })
    }

    /// Appends one message and answers it. The same `(member,
    /// client_msg_id)` never posts twice: the seq the first attempt got is
    /// the seq every retry sees, so a phone that queues messages while the
    /// host sleeps can retry on every wake without a duplicate ever
    /// landing.
    pub fn post(
        &self,
        member: MemberId,
        client_msg_id: &str,
        text: &str,
        call_ai: bool,
    ) -> Result<Message, PostError> {
        if client_msg_id.is_empty()
            || client_msg_id.len() > MAX_CLIENT_MSG_ID
            || !client_msg_id
                .bytes()
                .all(|byte| (0x21..=0x7e).contains(&byte))
        {
            return Err(PostError::BadClientMsgId);
        }
        if text.is_empty() {
            return Err(PostError::EmptyText);
        }
        if text.len() > MAX_TEXT_BYTES {
            return Err(PostError::TextTooLong);
        }
        let mut inner = self.lock();
        if let Some(seq) = inner.by_client.get(&(member.value(), client_msg_id.to_string())) {
            return Ok(inner.messages[*seq as usize - 1].clone());
        }
        let message = Message {
            seq: inner.messages.len() as u64 + 1,
            member,
            client_msg_id: client_msg_id.to_string(),
            text: text.to_string(),
            time: now(),
            call_ai,
        };
        // Disk first, memory second: an entry exists when it is on disk,
        // not when a `Vec` says so. If the append's fate is uncertain, the
        // reload learns it from the file — a write that landed is found and
        // answered as the idempotent replay it now is; a torn fragment is
        // truncated away and the refusal is honest.
        if let Err(error) = log::append(&inner.file, &message) {
            inner.messages = match log::load(&inner.file) {
                Ok(messages) => messages,
                Err(recovery) => return Err(PostError::Io(io_of(recovery))),
            };
            inner.by_client = rebuild_by_client(&inner.messages)
                .map_err(|error| PostError::Io(io_of(error)))?;
            return match inner.by_client.get(&(member.value(), client_msg_id.to_string())) {
                Some(seq) => Ok(inner.messages[*seq as usize - 1].clone()),
                None => Err(PostError::Io(error)),
            };
        }
        inner.by_client.insert(
            (member.value(), client_msg_id.to_string()),
            message.seq,
        );
        inner.messages.push(message.clone());
        drop(inner);
        self.signal.notify_all();
        Ok(message)
    }

    /// Sets the member's display name. Setting the name it already has
    /// changes nothing and writes nothing. The file is published before the
    /// memory changes, on the same disk-first rule as a post.
    pub fn set_name(&self, member: MemberId, name: &str) -> Result<String, NameError> {
        let name = names::valid(name)?;
        let mut inner = self.lock();
        if inner.names.get(&member).map(String::as_str) == Some(name.as_str()) {
            return Ok(name);
        }
        let mut updated = inner.names.clone();
        updated.insert(member, name.clone());
        names::publish(&inner.names_path, &updated).map_err(NameError::Io)?;
        inner.names = updated;
        Ok(name)
    }

    /// The display name a member set, if it set one.
    pub fn name_of(&self, member: MemberId) -> Option<String> {
        self.lock().names.get(&member).cloned()
    }

    /// Up to `limit` entries older than `before`, oldest first — the page a
    /// scroll-up asks for. `before` beyond the newest is the whole
    /// transcript's tail, which is also what a page with no cursor means.
    pub fn page_before(&self, before: u64, limit: usize) -> Vec<Message> {
        let inner = self.lock();
        let end = inner
            .messages
            .partition_point(|message| message.seq < before);
        let start = end.saturating_sub(limit);
        inner.messages[start..end].to_vec()
    }

    /// Up to `limit` entries newer than `after`, oldest first — the page a
    /// catch-up asks for.
    pub fn page_after(&self, after: u64, limit: usize) -> Vec<Message> {
        let inner = self.lock();
        let start = inner
            .messages
            .partition_point(|message| message.seq <= after);
        let end = (start + limit).min(inner.messages.len());
        inner.messages[start..end].to_vec()
    }

    /// The cursor a fresh subscriber starts from to see only what happens
    /// from now on. Cursor 0 replays the whole transcript.
    pub fn next_cursor(&self) -> usize {
        self.lock().messages.len()
    }

    /// Blocks until transcript entries after `cursor` exist or the deadline
    /// passes, then hands them out in order and moves the cursor past them.
    /// The door's job log is the shape being copied (`kalsa-door/src/jobs.rs`):
    /// wait on the shared condvar, clone under the lock, serve outside it.
    pub fn read_since(
        &self,
        cursor: &mut usize,
        deadline: Instant,
        out: &mut Vec<Message>,
    ) -> Take {
        let mut inner = self.lock();
        loop {
            if *cursor < inner.messages.len() {
                out.extend(inner.messages[*cursor..].iter().cloned());
                *cursor = inner.messages.len();
                return Take::Events;
            }
            let Some(wait) = deadline.checked_duration_since(Instant::now()) else {
                return Take::TimedOut;
            };
            let (next, timed_out) = self
                .signal
                .wait_timeout(inner, wait)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            inner = next;
            if timed_out.timed_out() && Instant::now() >= deadline {
                return Take::TimedOut;
            }
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Rebuilds the idempotency table from a transcript. A `(member,
/// client_msg_id)` appearing twice would mean the store promised one seq
/// for an id and logged another — corrupt, not to be served.
fn rebuild_by_client(messages: &[Message]) -> Result<HashMap<(u32, String), u64>, RoomError> {
    let mut by_client = HashMap::new();
    for message in messages {
        let key = (message.member.value(), message.client_msg_id.clone());
        if by_client.insert(key, message.seq).is_some() {
            return Err(RoomError::Corrupt(
                "one client message id holds two transcript entries",
            ));
        }
    }
    Ok(by_client)
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the clock is set after 1970")
        .as_secs()
}

/// A failed append's recovery failure, as the io error the caller sees. A
/// corrupt transcript is not retryable, so it does not become one.
fn io_of(error: RoomError) -> std::io::Error {
    match error {
        RoomError::Io(error) => error,
        RoomError::Corrupt(why) => std::io::Error::other(why),
    }
}
