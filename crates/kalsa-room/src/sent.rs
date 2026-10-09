//! The day a call was sent, in English words, for the AI's wire. Read once,
//! when the call is posted, and kept with its entry: every later turn replays
//! those same bytes, which is what the engine's prefix cache needs.

use chrono::{DateTime, Local, NaiveDate};

/// The local day of a unix time in seconds, as "Thursday, 8 October 2026".
pub(crate) fn sent_on(unix_secs: u64) -> Option<String> {
    let at = DateTime::from_timestamp(i64::try_from(unix_secs).ok()?, 0)?;
    Some(day_phrase(at.with_timezone(&Local).date_naive()))
}

/// English on purpose: chrono's names are fixed English, whatever the
/// desktop's language, because the wire is English.
pub(crate) fn day_phrase(day: NaiveDate) -> String {
    day.format("%A, %-d %B %Y").to_string()
}
