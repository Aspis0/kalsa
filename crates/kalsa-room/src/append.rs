//! The append path: posting with idempotency, the AI's own entries, and
//! what happens when the disk write's fate is unknown. Everything here
//! runs under the room's write lock, publishes into the readers' state
//! under the short lock, and keeps one seq order.

use std::fs::File;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::events::StoredEvent;
use crate::log::{self, Message};
use crate::media::{MediaAsset, MediaError};
use crate::mention::calls_ai;
use crate::room::{Room, Writer};
use crate::roster;
use crate::{Entry, MemberId, PostError, RoomError};

impl Room {
    /// Appends one message and answers it. The same `(member,
    /// client_msg_id)`, with the same text, flag and media, never posts
    /// twice: the seq the first attempt got is the seq every retry sees,
    /// so a phone that queues messages while the host sleeps can retry on
    /// every wake without a duplicate ever landing. The same id with
    /// DIFFERENT words, flag or media is refused: one id, one message.
    ///
    /// Words may be empty when media ride with the post — the fallback
    /// text stands in for them, so every reader of the transcript,
    /// including phones from before media, has something to show.
    pub fn post(
        &self,
        member: MemberId,
        client_msg_id: &str,
        text: &str,
        call_ai: bool,
        media: &[String],
    ) -> Result<Entry, PostError> {
        if !log::is_client_msg_id(client_msg_id) {
            return Err(PostError::BadClientMsgId);
        }
        if text.is_empty() && media.is_empty() {
            return Err(PostError::EmptyText);
        }
        if text.len() > log::MAX_TEXT_BYTES {
            return Err(PostError::TextTooLong);
        }
        // The media are resolved before any lock the posting path holds:
        // the shelf's own lock is never taken inside the write lock's
        // critical section here, and a blob the poster does not own is
        // refused before anything is written.
        let assets = self.own_media(member, media)?;
        let text = if text.is_empty() {
            fallback_text(&assets)
        } else {
            text.to_string()
        };
        // The call rule is the store's to apply, not a caller's to
        // remember: the flag is one way to call, the token is the other,
        // and the entry carries the OR of both.
        let call_ai = call_ai || calls_ai(&text);
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
                    if stored.text == text
                        && stored.call_ai == call_ai
                        && media_ids_of(&stored.media) == media
                    {
                        return Ok(Entry::of(stored));
                    }
                    return Err(PostError::ClientIdReused);
                }
                None => Message {
                    seq: state.messages.len() as u64 + 1,
                    member,
                    client_msg_id: client_msg_id.to_string(),
                    text,
                    time: now(),
                    call_ai,
                    read: 0,
                    media: assets,
                },
            }
        };
        if let Err(error) = append(&mut writer.file, &fresh) {
            return self.after_failed_append(&mut writer, fresh, error);
        }
        // Only now, with the entry on disk, do the blobs it names become
        // the transcript's to serve: a blob is never opened up to a
        // message that does not exist.
        self.media_reference(&fresh.media, fresh.seq);
        Ok(self.land(fresh))
    }

    /// The AI's own finished answer, appended to the transcript like any
    /// entry — its own seq, no idempotency key, because nobody retries an
    /// AI turn by id. The flag is true because an answer belongs to a
    /// called turn, the only way the AI ever speaks (the protocol's
    /// `ai_message` shape), and `read` says how much of the room the
    /// answer was built on.
    pub fn post_ai(&self, text: &str, read: u32) -> Result<Entry, PostError> {
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
                read,
                media: Vec::new(),
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
        let surviving = reopened.messages.len() as u64 + 1;
        if reopened.recovery == log::Recovery::Middle && !self.new_epoch(surviving) {
            // The bytes are gone and the new epoch could not be published:
            // serving the next seqs under the old one is the silent reuse
            // the epoch exists to prevent. Reads keep serving; writes stop.
            writer.writable = false;
        }
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
                        && media_ids_of(&landed.media) == media_ids_of(&message.media)
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

    /// Mints and publishes the next epoch, and clamps every join point to
    /// what survived. Called where a recovery dropped acknowledged entries
    /// — the seqs a phone already saw may be re-used for different words,
    /// and the phone learns that from the epoch, not from a wrong
    /// transcript. `false` means the new epoch is not what the room is
    /// serving.
    fn new_epoch(&self, surviving: u64) -> bool {
        let (identity, roster) = {
            let state = self.lock_state();
            (
                state.identity.clone(),
                state.roster.with_epoch_start(surviving),
            )
        };
        let Ok(re_minted) = identity.next_epoch(&self.dir) else {
            return false;
        };
        if roster::publish(&self.dir.join(roster::ROSTER_NAME), &roster).is_err() {
            return false;
        }
        let mut state = self.lock_state();
        state.identity = re_minted;
        state.roster = roster;
        true
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

/// The ids a posted entry carries, in order, for the idempotency compare.
fn media_ids_of(assets: &[MediaAsset]) -> Vec<&str> {
    assets.iter().map(|asset| asset.id.as_str()).collect()
}

/// The words that stand in when a post carries media and no text: what an
/// old phone — and the AI without vision — shows instead of nothing.
fn fallback_text(assets: &[MediaAsset]) -> String {
    let any_video = assets
        .iter()
        .any(|asset| asset.kind == crate::media::MediaKind::Video);
    if any_video {
        "[Video]".to_string()
    } else {
        "[Image]".to_string()
    }
}

impl Room {
    /// The shelf records behind the ids a post names: each one published,
    /// owned by the poster, and free of duplicates — the poster attaches
    /// its own uploads, nobody else's.
    fn own_media(&self, member: MemberId, ids: &[String]) -> Result<Vec<MediaAsset>, PostError> {
        if ids.len() > crate::media::POST_MEDIA_MAX {
            return Err(PostError::Media(MediaError::BadRequest));
        }
        let mut assets = Vec::with_capacity(ids.len());
        let media = self.media.lock().unwrap_or_else(|p| p.into_inner());
        for id in ids {
            if assets.iter().any(|asset: &MediaAsset| &asset.id == id) {
                return Err(PostError::Media(MediaError::BadRequest));
            }
            match media.asset_of(id) {
                Some((asset, owner)) if *owner == member => assets.push(asset.clone()),
                Some(_) => return Err(PostError::Media(MediaError::NotYours)),
                None => return Err(PostError::Media(MediaError::Unknown)),
            }
        }
        Ok(assets)
    }
}

/// A recovery failure as the io error the caller sees. A corrupt file is
/// not retryable, so it does not become one.
fn io_of(error: RoomError) -> std::io::Error {
    match error {
        RoomError::Io(error) => error,
        RoomError::Corrupt(why) => std::io::Error::other(why),
        RoomError::RosterFull => {
            std::io::Error::other("the room has more members than it can name")
        }
        RoomError::Entropy => std::io::Error::other("the room could not mint an identity"),
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
