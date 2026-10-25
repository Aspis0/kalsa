//! The live stream: numbered transcript entries and unnumbered room news,
//! one order, and cursors for both a fresh follower and a reconnect.
//! Numbered entries land only through posting, which owns the transcript's
//! seq; unnumbered news has its own publish path, and later steps add the
//! AI's status and deltas through it as more unnumbered kinds.

use std::sync::Arc;
use std::time::{Duration, Instant};

use std::sync::MutexGuard;

use crate::log::Message;
use crate::room::Room;
use crate::{Entry, MemberId};

/// One deliverable event on the room's stream. A [`Event::Message`] is
/// numbered — its identity is the transcript's seq — and is replayed on
/// reconnect; a [`Event::Member`] is news, carries no seq, and is
/// re-derived from room info by anyone who missed it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Message(Entry),
    Member(MemberEvent),
    Ai(AiEvent),
    Media(MediaEvent),
}

/// The AI guest's unnumbered news: a status change (the word says which),
/// or a chunk of the answer being streamed, carrying the turn it belongs
/// to so a phone can assemble one turn and discard stale partials.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AiEvent {
    /// The state the room moved to, and the note some moves owe the room:
    /// a stable machine `note_code` the client translates by, with the
    /// English sentence as the fallback — the app ships in several
    /// languages, and the codes are the contract. Both `None` on the
    /// moves that explain themselves. The sentence is owned because one
    /// of them names a number only the failing call knows.
    Status {
        state: &'static str,
        note_code: Option<&'static str>,
        note: Option<String>,
    },
    Delta {
        turn: u64,
        text: String,
    },
}

/// The shelf's unnumbered news: it is not a member and it carries no seq,
/// so it rides the same road the member news does — re-derivable by
/// anyone who missed it, because a download that answers `media_not_found`
/// says the same thing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MediaEvent {
    /// The host cleared the shelf: every blob and in-flight upload is
    /// gone, the quota starts from zero, the transcript is untouched.
    Cleared,
}

/// The unnumbered news: who appeared, who is called what now, who left.
/// Names only, ever — nothing about what anyone asked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MemberEvent {
    /// A device was allowed and appears in the room. The door publishes
    /// this when the pairing store records the owner's Allow.
    Joined {
        member: MemberId,
        name: String,
    },
    Renamed {
        member: MemberId,
        name: String,
    },
    /// A device was forgotten; the member will not post again. Its past
    /// entries keep their author and the name it had.
    Left {
        member: MemberId,
    },
}

/// The store's internal log: the same events, holding each entry by
/// reference-count so a slow reader costs a pointer, not a copy.
pub(crate) enum StoredEvent {
    Message(Arc<Message>),
    Member(MemberEvent),
    Ai(AiEvent),
    Media(MediaEvent),
}

/// What a blocking read got.
#[derive(Debug, PartialEq, Eq)]
pub enum Take {
    Events,
    TimedOut,
    /// The cursor claims events the room never had — a Last-Event-ID above
    /// the newest seq maps here. Waiting would be a promise, not an
    /// answer.
    BadCursor,
}

impl Room {
    /// The publish path for unnumbered news. Order is the push order; a
    /// follower that misses any of it refetches room info, which is the
    /// whole reason unnumbered events carry no seq.
    pub fn publish_member(&self, event: MemberEvent) {
        {
            let mut state = self.lock_state();
            state.events.push(StoredEvent::Member(event));
        }
        self.notify();
    }

    /// The AI guest's news, the same road: one push, one order, no seq.
    pub fn publish_ai(&self, event: AiEvent) {
        {
            let mut state = self.lock_state();
            state.events.push(StoredEvent::Ai(event));
        }
        self.notify();
    }

    /// The shelf's news, the same road again: one push, one order, no seq.
    pub fn publish_media(&self, event: MediaEvent) {
        {
            let mut state = self.lock_state();
            state.events.push(StoredEvent::Media(event));
        }
        self.notify();
    }

    /// The cursor a fresh follower starts from: everything after now.
    /// Cursor 0 is everything the room holds.
    pub fn next_cursor(&self) -> usize {
        self.lock_state().events.len()
    }

    /// Where a reconnect resumes after the last seq it saw. `None` is a
    /// bad cursor: a seq above the newest claims events that never
    /// happened. Member news before the resume point is skipped — it is
    /// re-derivable from room info and carries no seq of its own.
    pub fn resume_after_seq(&self, seen: u64) -> Option<usize> {
        let state = self.lock_state();
        // An empty room's newest is 0, so `seen = 0` is a real cursor
        // there — the one a room's first stream opens from.
        let newest = state
            .messages
            .last()
            .map(|message| message.seq)
            .unwrap_or(0);
        if seen > newest {
            return None;
        }
        let mut resume = 0;
        for (index, event) in state.events.iter().enumerate() {
            if let StoredEvent::Message(message) = event {
                if message.seq <= seen {
                    resume = index + 1;
                }
            }
        }
        Some(resume)
    }

    /// Blocks until events after `cursor` exist or the deadline passes,
    /// then hands them out in order and moves the cursor past them. The
    /// door's job log is the shape being copied (`kalsa-door/src/jobs.rs`):
    /// wait on the shared condvar, clone under the lock, serve outside it.
    pub fn read_since(&self, cursor: &mut usize, deadline: Instant, out: &mut Vec<Event>) -> Take {
        let mut state = self.lock_state();
        if *cursor > state.events.len() {
            return Take::BadCursor;
        }
        loop {
            if *cursor < state.events.len() {
                out.extend(state.events[*cursor..].iter().map(|event| match event {
                    StoredEvent::Message(message) => Event::Message(Entry::of(message)),
                    StoredEvent::Member(event) => Event::Member(event.clone()),
                    StoredEvent::Ai(event) => Event::Ai(event.clone()),
                    StoredEvent::Media(event) => Event::Media(event.clone()),
                }));
                *cursor = state.events.len();
                return Take::Events;
            }
            let Some(wait) = deadline.checked_duration_since(Instant::now()) else {
                return Take::TimedOut;
            };
            state = self.wait_events(state, wait);
        }
    }
}

impl Room {
    /// Waits on the stream's condvar. This is the one method a waiter uses
    /// to sleep, so the poison policy is written once, here and at the
    /// lock helpers in `room`: see that module's comment.
    pub(crate) fn wait_events<'a>(
        &self,
        state: MutexGuard<'a, crate::room::State>,
        wait: Duration,
    ) -> MutexGuard<'a, crate::room::State> {
        self.signal
            .wait_timeout(state, wait)
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .0
    }
}
