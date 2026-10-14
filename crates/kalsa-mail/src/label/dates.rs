//! Explicit dates in a text, for the deadline signal: `dd/mm`, `dd/mm/yyyy`, and a day
//! beside a month name in Italian or English, in either order.

use chrono::{Datelike, NaiveDate};

const MONTHS: [&str; 24] = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre",
    "novembre", "dicembre", "january", "february", "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december",
];

/// Whether a date named in `text` falls on the reference day or within `days` after it.
pub fn within_days(text: &str, reference: NaiveDate, days: i64) -> bool {
    let end = reference + chrono::Duration::days(days);
    named_dates(text, reference.year()).any(|date| date >= reference && date <= end)
}

/// Every reading of a date in the text. A date without a year could be last year,
/// this year or the next, so each is offered and only the window decides.
fn named_dates(text: &str, year: i32) -> impl Iterator<Item = NaiveDate> {
    let words: Vec<&str> = text
        .split(|c: char| !c.is_alphanumeric() && c != '/')
        .filter(|word| !word.is_empty())
        .collect();
    let numeric = words.iter().filter_map(|word| numeric_day_month(word));
    let named = (0..words.len()).filter_map(|index| named_month(&words, index));
    numeric
        .chain(named)
        .flat_map(move |(day, month, explicit)| years(day, month, explicit, year))
        .collect::<Vec<_>>()
        .into_iter()
}

/// `dd/mm` or `dd/mm/yyyy` as one token.
fn numeric_day_month(token: &str) -> Option<(u32, u32, Option<i32>)> {
    let parts: Vec<&str> = token.split('/').collect();
    if !(2..=3).contains(&parts.len()) {
        return None;
    }
    let day: u32 = parts[0].parse().ok()?;
    let month: u32 = parts[1].parse().ok()?;
    let explicit = match parts.get(2) {
        None => None,
        Some(year) if year.len() == 4 => Some(year.parse().ok()?),
        Some(year) if year.len() == 2 => Some(2000 + year.parse::<i32>().ok()?),
        Some(_) => return None,
    };
    Some((day, month, explicit))
}

/// A day beside a month name: `12 ottobre`, `ottobre 12`, `12 October 2026`.
fn named_month(words: &[&str], index: usize) -> Option<(u32, u32, Option<i32>)> {
    let month = month_number(words[index])?;
    if let Some(day) = index.checked_sub(1).and_then(|before| day_of(words[before])) {
        return Some((day, month, year_at(words, index + 1)));
    }
    let day = words.get(index + 1).and_then(|word| day_of(word))?;
    Some((day, month, year_at(words, index + 2)))
}

fn years(day: u32, month: u32, explicit: Option<i32>, reference_year: i32) -> impl Iterator<Item = NaiveDate> {
    let candidates = match explicit {
        Some(year) => vec![year],
        None => vec![reference_year - 1, reference_year, reference_year + 1],
    };
    candidates
        .into_iter()
        .filter_map(move |year| NaiveDate::from_ymd_opt(year, month, day))
}

fn year_at(words: &[&str], index: usize) -> Option<i32> {
    words
        .get(index)
        .filter(|word| word.len() == 4)
        .and_then(|word| word.parse().ok())
}

fn day_of(word: &str) -> Option<u32> {
    if !(1..=2).contains(&word.len()) {
        return None;
    }
    word.parse().ok().filter(|day| (1..=31).contains(day))
}

fn month_number(word: &str) -> Option<u32> {
    let lower = word.to_ascii_lowercase();
    MONTHS
        .iter()
        .position(|month| *month == lower)
        .map(|at| (at % 12) as u32 + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).expect("a real date")
    }

    #[test]
    fn a_day_and_month_in_the_next_week_is_within() {
        let reference = day(2026, 10, 10);
        assert!(within_days("consegna entro il 15/10", reference, 7));
        assert!(within_days("consegna il 12 ottobre", reference, 7));
        assert!(within_days("due by October 12", reference, 7));
        assert!(within_days("scadenza 15/10/2026", reference, 7));
    }

    #[test]
    fn a_date_outside_the_week_or_in_the_past_is_not() {
        let reference = day(2026, 10, 10);
        assert!(!within_days("consegna il 2 novembre", reference, 7));
        assert!(!within_days("firma il 15/10/2025", reference, 7));
        assert!(!within_days("la versione 1.5 è pronta", reference, 7), "a decimal is not a date");
    }

    #[test]
    fn a_day_that_does_not_exist_is_ignored() {
        assert!(!within_days("il 31/02", day(2026, 2, 20), 7));
    }

    #[test]
    fn a_year_less_date_can_fall_in_the_window_across_a_year_end() {
        assert!(within_days("entro il 2/1", day(2026, 12, 29), 7));
    }
}
