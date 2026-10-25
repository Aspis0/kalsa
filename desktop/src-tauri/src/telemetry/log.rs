//! The redacted log that rides with a serious report.
//!
//! A crash, a failed start or a failed tune makes the tester's own log the
//! most useful thing we can send, so the report carries a reference to it:
//! the same body and the same endpoint the manual Send uses, at most
//! [`UPLOADS_PER_DAY`] times a UTC day per install. This module decides what
//! an item's log owes and what an upload's answer means; the sending cycle
//! in `network` owns the consent checks that surround both transmissions.

use regex::Regex;
use serde_json::{Value, json};

use super::spec;
use super::store::Item;
use super::Inner;

/// Automatic log uploads one install may make per UTC day.
pub(super) const UPLOADS_PER_DAY: u8 = 3;

/// Whether this item's report still owes a log upload.
pub(super) enum Owed {
    /// It does: the UTC day the reference will name.
    Day(String),
    /// It does not, and the queued item has stopped owing one.
    None,
}

/// What an item's log owes, under the caller's lock. A day whose uploads are
/// spent clears the flag here: the report goes alone and never retries the
/// upload.
pub(super) fn owed(inner: &mut Inner, work: &Item, now: u64) -> Owed {
    if !owes_log(work) {
        return Owed::None;
    }
    let day = super::resources::date(now);
    if inner.store.log_budget_left(&day, UPLOADS_PER_DAY) {
        return Owed::Day(day);
    }
    clear(inner, work);
    Owed::None
}

/// What a finished upload means for the item's log.
pub(super) enum Answered {
    /// The log is stored under this id.
    Stored(String),
    /// No reference will ride: the server refused it, or the id it answered
    /// with is not the contract's shape. The word is the refusal's own
    /// stable code.
    Refused(&'static str),
    /// No network reached the endpoint.
    Offline,
}

pub(super) fn answered(sent: Result<String, crate::report::SendFailure>) -> Answered {
    match sent {
        Ok(id) => Answered::Stored(id),
        // Offline is the one answer that keeps the item waiting; every
        // server answer, its refusals included, lets the report go alone.
        Err(crate::report::SendFailure::Offline) => Answered::Offline,
        Err(failure) => Answered::Refused(failure.code()),
    }
}

/// The report's `logRef`: the UTC day and the id the Worker answered with,
/// both checked against the contract's own shape before it is written down.
pub(super) fn reference(day: &str, id: &str) -> Option<String> {
    let log_ref = format!("{day}/{id}");
    matches(spec::LOG_REF_PATTERN, &log_ref).then_some(log_ref)
}

/// The report to send with its reference: the queued item carries the same
/// reference and stops owing a log, and the upload is billed against the
/// day — the upload happened whether or not the item is still queued to be
/// found.
pub(super) fn attach(inner: &mut Inner, work: &Item, day: &str, log_ref: String) -> Value {
    let mut report = work.report.clone();
    report["diagnostics"]["logRef"] = json!(log_ref);
    inner.store.note_log_upload(day);
    if let Some(item) = find(inner, work) {
        item.report = report.clone();
        item.log_pending = false;
    }
    if inner.store.save().is_err() {
        inner.store.enabled = false;
    }
    report
}

/// The queued item stops owing a log, so a later retry does not upload it
/// again.
pub(super) fn clear(inner: &mut Inner, work: &Item) {
    if let Some(item) = find(inner, work) {
        item.log_pending = false;
        if inner.store.save().is_err() {
            inner.store.enabled = false;
        }
    }
}

/// True while this item still owes an automatic log upload.
fn owes_log(work: &Item) -> bool {
    work.log_pending && !work.report["diagnostics"]["logRef"].is_string()
}

fn find<'a>(inner: &'a mut Inner, work: &Item) -> Option<&'a mut Item> {
    inner
        .store
        .queue
        .iter_mut()
        .find(|item| item.report == work.report)
}

fn matches(pattern: &str, text: &str) -> bool {
    Regex::new(pattern).is_ok_and(|re| re.is_match(text))
}
