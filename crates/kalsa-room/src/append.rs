//! The append path: posting with idempotency, the AI's own entries, and
//! what happens when the disk write's fate is unknown. Everything here
//! runs under the room's write lock, publishes into the readers' state
//! under the short lock, and keeps one seq order.

use std::fs::File;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::events::StoredEvent;
use crate::log::{self, Message};
use crate::mention::calls_ai;
use crate::room::{Room, Writer};
use crate::{Entry, MemberId, PostError, RoomError};

impl Room {
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
        // The call rule is the store's to apply, not a caller's to
        // remember: the flag is one way to call, the token is the other,
        // and the entry carries the OR of both.
        let call_ai = call_ai || calls_ai(text);
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
        if let Err(error) = append(&mut writer.file, &fresh) {
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
        if let Err(error) = append(&mut writer.file, &fresh) {
            return self.after_failed_append(&mut writer, fresh, error);
        }
        Ok(self.land(fresh))
    }

    /// The append's fate is unknown, so the file is asked. A reopen that
    /// holds exactly one entry more than the room remembered, and it is
    /// ours, proves it landed — answer it as the entry it now is. A reopen
    /// that holds what memory holds says nothing landed: the io error
    /// itself, read-only when the reopen could not repair. Anything else —
    /// entries gone, entries nobody here wrote — is a transcript the room
    /// cannot explain, and the room stops writing rather than adopt one.
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
        let memory = self.lock_state().messages.len();
        let landed = match reopened.messages.len().checked_sub(memory) {
            Some(1) => reopened
                .messages
                .last()
                .filter(|landed| {
                    landed.seq == message.seq
                        && landed.member == message.member
                        && landed.client_msg_id == message.client_msg_id
                        && landed.text == message.text
                })
                .cloned(),
            _ => None,
        };
        match landed {
            Some(landed) => Ok(self.land(landed)),
            None if reopened.messages.len() == memory => match writer.writable {
                false => Err(PostError::ReadOnly),
                true => Err(PostError::Io(error)),
            },
            None => {
                writer.writable = false;
                Err(PostError::ReadOnly)
            }
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

/// The one append call, with the test seam in it: a test can pretend the
/// disk write failed so the recovery path runs against a file the test
/// controls. Thread-local, so an injected failure cannot touch the posts
/// other threads make; compiled out of the real build entirely.
fn append(file: &mut File, message: &Message) -> std::io::Result<()> {
    #[cfg(test)]
    if fails_injected() {
        return Err(std::io::Error::other("a test injected the failure"));
    }
    log::append(file, message)
}

#[cfg(test)]
thread_local! {
    static INJECT_FAILURE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

#[cfg(test)]
fn fails_injected() -> bool {
    INJECT_FAILURE.with(std::cell::Cell::get)
}

#[cfg(test)]
pub(crate) fn inject_append_failure() {
    INJECT_FAILURE.with(|flag| flag.set(true));
}

#[cfg(test)]
pub(crate) fn clear_append_failure() {
    INJECT_FAILURE.with(|flag| flag.set(false));
}
