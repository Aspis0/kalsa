//! Hidden text: something in the mail that a person would not read — an element
//! styled out of sight, a tag block or a bidi control, a pair of halves that
//! say different things.
//!
//! The verdict comes from the one pass that also produced the text a model
//! reads. Two passes over the same mail is two answers to one question, and a
//! sender only needs the one this server did not check.

use super::Reason;
use crate::mail::ParsedMail;

pub fn reasons(mail: &ParsedMail) -> Vec<Reason> {
    if mail.hidden {
        vec![Reason::HiddenText]
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mail_with(hidden: bool) -> ParsedMail {
        ParsedMail {
            headers: Vec::new(),
            from_address: "a@b.example.it".to_string(),
            from_display: String::new(),
            reply_to: None,
            date_ms: 0,
            message_id: None,
            subject: String::new(),
            text: String::new(),
            body: String::new(),
            hidden,
            links: Vec::new(),
            attachments: Vec::new(),
            thread_ids: Vec::new(),
        }
    }

    #[test]
    fn the_verdict_comes_from_the_parse_and_nowhere_else() {
        assert_eq!(reasons(&mail_with(true)), vec![Reason::HiddenText]);
        assert!(reasons(&mail_with(false)).is_empty());
    }
}
