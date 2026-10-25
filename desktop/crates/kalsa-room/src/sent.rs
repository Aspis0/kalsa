//! The day a call was sent, in English words, for the AI's wire. Read once,
//! when the call is posted, and kept with its entry: every later turn replays
//! those same bytes, which is what the engine's prefix cache needs.

use chrono::{DateTime, Local, NaiveDate};

/// The phrase's shape: "Thursday, 8 October 2026".
const PHRASE: &str = "%A, %-d %B %Y";
/// The longest phrase the writer makes: "Wednesday, 30 September 2026".
const MAX_BYTES: usize = 32;

/// The local day of a unix time in seconds, as "Thursday, 8 October 2026".
pub(crate) fn sent_on(unix_secs: u64) -> Option<String> {
    let at = DateTime::from_timestamp(i64::try_from(unix_secs).ok()?, 0)?;
    Some(day_phrase(at.with_timezone(&Local).date_naive()))
}

/// Whether a stored day is exactly what the writer makes: short, and the one
/// date it names, spelled the one way the writer spells it.
pub(crate) fn is_sent_on(day: &str) -> bool {
    day.len() <= MAX_BYTES
        && NaiveDate::parse_from_str(day, PHRASE).is_ok_and(|parsed| day_phrase(parsed) == day)
}

/// English on purpose: chrono's names are fixed English, whatever the
/// desktop's language, because the wire is English.
fn day_phrase(day: NaiveDate) -> String {
    day.format(PHRASE).to_string()
}

#[cfg(test)]
mod tests {
    use chrono::NaiveDate;

    use super::{day_phrase, is_sent_on};

    #[test]
    fn the_day_is_english_words_with_no_time() {
        let thursday = NaiveDate::from_ymd_opt(2026, 10, 8).unwrap();
        assert_eq!(day_phrase(thursday), "Thursday, 8 October 2026");
        let new_year = NaiveDate::from_ymd_opt(2026, 1, 1).unwrap();
        assert_eq!(day_phrase(new_year), "Thursday, 1 January 2026");
    }

    #[test]
    fn only_the_writers_own_spelling_is_a_day() {
        assert!(is_sent_on("Thursday, 8 October 2026"));
        assert!(is_sent_on("Wednesday, 30 September 2026"));
        assert!(
            !is_sent_on("Friday, 8 October 2026"),
            "the weekday must match the date"
        );
        assert!(
            !is_sent_on("8 October 2026"),
            "the weekday is part of the phrase"
        );
        assert!(!is_sent_on("Thursday, 08 October 2026"), "no zero padding");
        assert!(!is_sent_on("Thursday, 8 October 2026."), "no trailing text");
        assert!(!is_sent_on(""), "an empty day is not a day");
        assert!(
            !is_sent_on(&"x".repeat(200)),
            "an oversized value is refused"
        );
    }
}
