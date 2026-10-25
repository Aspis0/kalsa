//! Hints that help a model pick the important mails. They come from headers and the
//! extracted text, with no model, and they never change a label: a suspicious mail is
//! not made important because it asks a question.

use chrono::NaiveDate;
use serde::Serializer;

use super::bulk;
use super::dates;
use super::language::Language;
use super::{seen_before, values, Sender};
use crate::mail::ParsedMail;

/// The first characters of a text where a question still reads as a request to the reader.
const QUESTION_WINDOW: usize = 600;
/// The days after the reference date that count as a deadline.
const DEADLINE_DAYS: i64 = 7;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Signal {
    KnownSender,
    Direct,
    AsksReply,
    Deadline,
}

impl Signal {
    pub fn code(self) -> &'static str {
        match self {
            Signal::KnownSender => "known_sender",
            Signal::Direct => "direct",
            Signal::AsksReply => "asks_reply",
            Signal::Deadline => "deadline",
        }
    }

    fn tag(self, language: Language) -> &'static str {
        match (language, self) {
            (Language::Italian, Signal::KnownSender) => "noto",
            (Language::Italian, Signal::Direct) => "diretta",
            (Language::Italian, Signal::AsksReply) => "chiede risposta",
            (Language::Italian, Signal::Deadline) => "scadenza",
            (Language::English, Signal::KnownSender) => "known",
            (Language::English, Signal::Direct) => "direct",
            (Language::English, Signal::AsksReply) => "asks reply",
            (Language::English, Signal::Deadline) => "deadline",
        }
    }
}

/// The codes a record carries, in the order the signals were found.
pub fn serialize_codes<S: Serializer>(signals: &[Signal], serializer: S) -> Result<S::Ok, S::Error> {
    serializer.collect_seq(signals.iter().map(|signal| signal.code()))
}

/// The line a model reads, in the language of the mails it is reading.
pub fn tag_line(signals: &[Signal], language: Language) -> String {
    if signals.is_empty() {
        return match language {
            Language::Italian => "nessuno",
            Language::English => "none",
        }
        .to_owned();
    }
    signals
        .iter()
        .map(|signal| signal.tag(language))
        .collect::<Vec<_>>()
        .join(", ")
}

/// What a mail is compared against: the folder's senders, the reader's own address,
/// and the reference date for deadlines (the newest mail listed, or the mail itself).
pub struct Around<'a> {
    pub history: &'a [Sender],
    pub account: Option<&'a str>,
    pub reference_ms: i64,
}

pub fn signals(uid: u32, mail: &ParsedMail, around: &Around) -> Vec<Signal> {
    let mut found = Vec::new();
    if seen_before(around.history, &mail.from_address, uid) {
        found.push(Signal::KnownSender);
    }
    if is_direct(mail, around.account) {
        found.push(Signal::Direct);
    }
    if asks_reply(&mail.text) {
        found.push(Signal::AsksReply);
    }
    if has_deadline(mail, around.reference_ms) {
        found.push(Signal::Deadline);
    }
    found
}

/// The account's own address is in To, and the mail is not bulk. Without a known
/// address the signal is off, so it never guesses whose inbox this is.
fn is_direct(mail: &ParsedMail, account: Option<&str>) -> bool {
    let Some(account) = account.filter(|address| address.contains('@')) else {
        return false;
    };
    if !bulk::reasons(mail).is_empty() {
        return false;
    }
    values(&mail.headers, "to").any(|to| addresses(to).any(|address| address.eq_ignore_ascii_case(account)))
}

fn addresses(header: &str) -> impl Iterator<Item = &str> {
    header
        .split(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | ',' | ';' | '"'))
        .filter(|token| token.contains('@'))
}

const QUESTIONS: &[&[&str]] = &[
    &["puoi"],
    &["potresti"],
    &["fammi", "sapere"],
    &["mi", "confermi"],
    &["mi", "fai", "sapere"],
    &["can", "you"],
    &["could", "you"],
    &["please", "confirm"],
    &["let", "me", "know"],
];

fn asks_reply(text: &str) -> bool {
    text.chars().take(QUESTION_WINDOW).any(|c| c == '?') || QUESTIONS.iter().any(|phrase| contains_phrase(text, phrase))
}

const DEADLINE_WORDS: &[&str] = &["entro", "scade", "scadenza", "oggi", "domani", "due"];
const DEADLINE_PHRASES: &[&[&str]] = &[&["by", "tomorrow"]];

fn has_deadline(mail: &ParsedMail, reference_ms: i64) -> bool {
    let subject_and_text = format!("{}\n{}", mail.subject, mail.text);
    let by_word = words(&subject_and_text)
        .any(|word| DEADLINE_WORDS.iter().any(|marker| word.eq_ignore_ascii_case(marker)));
    if by_word || DEADLINE_PHRASES.iter().any(|phrase| contains_phrase(&subject_and_text, phrase)) {
        return true;
    }
    match reference_date(reference_ms) {
        Some(reference) => dates::within_days(&subject_and_text, reference, DEADLINE_DAYS),
        None => false,
    }
}

fn reference_date(reference_ms: i64) -> Option<NaiveDate> {
    if reference_ms == 0 {
        return None;
    }
    chrono::DateTime::from_timestamp_millis(reference_ms).map(|at| at.date_naive())
}

fn words(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| !c.is_alphanumeric()).filter(|word| !word.is_empty())
}

fn contains_phrase(text: &str, phrase: &[&str]) -> bool {
    let all: Vec<&str> = words(text).collect();
    all.windows(phrase.len()).any(|window| {
        window.iter().zip(phrase).all(|(word, wanted)| word.eq_ignore_ascii_case(wanted))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCOUNT: &str = "mariarossi@example.it";

    fn mail(from: &str, to: &str, subject: &str, text: &str) -> ParsedMail {
        let raw = format!(
            "From: Studio <{from}>\r\nTo: {to}\r\nSubject: {subject}\r\nDate: Sat, 10 Oct 2026 09:00:00 +0000\r\n\r\n{text}"
        );
        crate::mail::parse(raw.as_bytes())
    }

    fn around(history: &[Sender]) -> Around<'_> {
        Around { history, account: Some(ACCOUNT), reference_ms: 0 }
    }

    fn found(uid: u32, mail: &ParsedMail, around: &Around, signal: Signal) -> bool {
        signals(uid, mail, around).contains(&signal)
    }

    #[test]
    fn a_sender_with_a_lower_uid_is_known_and_a_first_mail_is_not() {
        let history = [Sender { address: "studio@example.it".into(), uid: 3 }];
        let later = mail("studio@example.it", ACCOUNT, "s", "testo");
        assert!(found(9, &later, &around(&history), Signal::KnownSender));
        assert!(!found(3, &later, &around(&history), Signal::KnownSender), "the same mail is not earlier than itself");
        let other = mail("altro@example.it", ACCOUNT, "s", "testo");
        assert!(!found(9, &other, &around(&history), Signal::KnownSender));
    }

    #[test]
    fn a_mail_addressed_to_the_account_is_direct_and_one_only_copied_is_not() {
        let to = mail("a@example.it", &format!("Maria <{ACCOUNT}>"), "s", "testo");
        assert!(found(9, &to, &around(&[]), Signal::Direct));
        let copied = {
            let raw = format!("From: a@example.it\r\nTo: altro@example.it\r\nCc: {ACCOUNT}\r\nSubject: s\r\n\r\ntesto");
            crate::mail::parse(raw.as_bytes())
        };
        assert!(!found(9, &copied, &around(&[]), Signal::Direct));
    }

    #[test]
    fn a_bulk_mail_is_never_direct_and_an_unknown_account_switches_the_signal_off() {
        let raw = format!(
            "From: news@example.it\r\nTo: {ACCOUNT}\r\nList-Unsubscribe: <https://x.example>\r\nSubject: s\r\n\r\ntesto"
        );
        let newsletter = crate::mail::parse(raw.as_bytes());
        assert!(!found(9, &newsletter, &around(&[]), Signal::Direct));
        let to = mail("a@example.it", ACCOUNT, "s", "testo");
        let unknown = Around { history: &[], account: None, reference_ms: 0 };
        assert!(!found(9, &to, &unknown, Signal::Direct));
    }

    #[test]
    fn a_question_or_a_request_asks_for_a_reply() {
        let question = mail("a@example.it", ACCOUNT, "s", "Va bene il giovedì?");
        assert!(found(9, &question, &around(&[]), Signal::AsksReply));
        let request = mail("a@example.it", ACCOUNT, "s", "Puoi mandarmi i dati, grazie.");
        assert!(found(9, &request, &around(&[]), Signal::AsksReply));
        let english = mail("a@example.it", ACCOUNT, "s", "Could you please confirm the room?");
        assert!(found(9, &english, &around(&[]), Signal::AsksReply));
    }

    #[test]
    fn a_question_mark_after_the_window_or_a_word_inside_another_is_not_a_request() {
        let late = mail("a@example.it", ACCOUNT, "s", &format!("{} ?", "riempimento ".repeat(60)));
        assert!(!found(9, &late, &around(&[]), Signal::AsksReply));
        let inside = mail("a@example.it", ACCOUNT, "s", "Il tuopuoi non conta, e nemmeno canyou.");
        assert!(!found(9, &inside, &around(&[]), Signal::AsksReply));
    }

    #[test]
    fn a_deadline_word_makes_a_mail_a_deadline() {
        let urgent = mail("a@example.it", ACCOUNT, "Entro venerdì", "Mandami il modulo.");
        assert!(found(9, &urgent, &around(&[]), Signal::Deadline));
        let english = mail("a@example.it", ACCOUNT, "s", "I need it by tomorrow morning.");
        assert!(found(9, &english, &around(&[]), Signal::Deadline));
    }

    #[test]
    fn a_word_that_only_contains_a_deadline_word_is_not_one() {
        let plain = mail("a@example.it", ACCOUNT, "Ciao", "Entrambi siamo d'accordo, scadente non è.");
        assert!(!found(9, &plain, &around(&[]), Signal::Deadline));
    }

    #[test]
    fn an_explicit_date_within_a_week_of_the_reference_is_a_deadline() {
        let reference = chrono::NaiveDate::from_ymd_opt(2026, 10, 10).expect("date");
        let reference_ms = reference.and_hms_opt(9, 0, 0).expect("time").and_utc().timestamp_millis();
        let dated = Around { history: &[], account: Some(ACCOUNT), reference_ms };
        let soon = mail("a@example.it", ACCOUNT, "s", "Consegna il 15/10.");
        assert!(found(9, &soon, &dated, Signal::Deadline));
        let later = mail("a@example.it", ACCOUNT, "s", "Consegna il 2 novembre.");
        assert!(!found(9, &later, &dated, Signal::Deadline));
        assert!(!found(9, &soon, &around(&[]), Signal::Deadline), "no reference, no date rule");
    }

    #[test]
    fn the_tag_line_follows_the_language_and_says_none_when_empty() {
        let both = [Signal::KnownSender, Signal::Direct, Signal::AsksReply, Signal::Deadline];
        assert_eq!(tag_line(&both, Language::Italian), "noto, diretta, chiede risposta, scadenza");
        assert_eq!(tag_line(&both, Language::English), "known, direct, asks reply, deadline");
        assert_eq!(tag_line(&[], Language::Italian), "nessuno");
        assert_eq!(tag_line(&[], Language::English), "none");
    }
}
