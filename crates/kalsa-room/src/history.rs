//! History pages: the three cursor modes, the limit, the edges. The
//! transcript itself lives in `room`'s state; this file only shapes views
//! of it.

use crate::room::{Room, State};
use crate::Entry;

/// A history page is 1..=200 entries. The range is the store's to keep;
/// phrasing the refusal is the door's.
const MAX_PAGE: usize = 200;

/// Why a page was refused.
#[derive(Debug, PartialEq, Eq)]
pub enum PageError {
    BadLimit,
}

impl std::fmt::Display for PageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("a history page holds between 1 and 200 messages")
    }
}

/// One history page, oldest first, with the edges the protocol names:
/// whether another page exists beyond each side.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    pub messages: Vec<Entry>,
    pub has_older: bool,
    pub has_newer: bool,
}

impl Room {
    /// The newest `limit` entries, oldest first — what a chat shows on
    /// open, the page a request with no cursor means.
    pub fn newest_page(&self, limit: usize) -> Result<Page, PageError> {
        check_limit(limit)?;
        let state = self.lock_state();
        let end = state.messages.len();
        let start = end.saturating_sub(limit);
        Ok(page_of(&state, start, end))
    }

    /// Up to `limit` entries older than `before`, oldest first — the page
    /// a scroll-up asks for. `before` may name the message one past the
    /// newest (the whole transcript is older than that); beyond it the
    /// cursor names a place the transcript never reached, and the page is
    /// empty, not the newest page in disguise.
    pub fn page_before(&self, before: u64, limit: usize) -> Result<Page, PageError> {
        check_limit(limit)?;
        let state = self.lock_state();
        let newest = state
            .messages
            .last()
            .map(|message| message.seq)
            .unwrap_or(0);
        if before.saturating_sub(1) > newest {
            return Ok(Page {
                messages: Vec::new(),
                // A cursor past the newest names a place the transcript
                // never reached: no page exists relative to it, not even
                // the one behind.
                has_older: false,
                has_newer: false,
            });
        }
        let end = state.messages.partition_point(|message| message.seq < before);
        let start = end.saturating_sub(limit);
        Ok(page_of(&state, start, end))
    }

    /// Up to `limit` entries newer than `after`, oldest first — the page a
    /// catch-up asks for. `after` at or beyond the newest seq is an empty
    /// page, not an error.
    pub fn page_after(&self, after: u64, limit: usize) -> Result<Page, PageError> {
        check_limit(limit)?;
        let state = self.lock_state();
        let start = state
            .messages
            .partition_point(|message| message.seq <= after);
        let end = start.saturating_add(limit).min(state.messages.len());
        Ok(page_of(&state, start, end))
    }
}

fn check_limit(limit: usize) -> Result<(), PageError> {
    (1..=MAX_PAGE)
        .contains(&limit)
        .then_some(())
        .ok_or(PageError::BadLimit)
}

fn page_of(state: &State, start: usize, end: usize) -> Page {
    Page {
        messages: state.messages[start..end]
            .iter()
            .map(|message| Entry::of(message))
            .collect(),
        has_older: start > 0,
        has_newer: end < state.messages.len(),
    }
}
