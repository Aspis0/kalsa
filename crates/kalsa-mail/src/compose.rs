//! The reply a person confirmed, as a mail message. The recipient and the threading
//! come from the mail being answered; the subject and the body are the person's own.

use lettre::message::{Mailbox, Message, SinglePart};
use lettre::Address;

use crate::draft;
use crate::invisible;
use crate::mail::ParsedMail;

/// The address a value is, or nothing. Parsing and drafting use the same test, so a
/// reply is never addressed to text that only contains an `@`. Only the domain is
/// lowercased: the local part may be case-sensitive at the receiving server.
pub(crate) fn as_address(value: &str) -> Option<String> {
    value
        .trim()
        .parse::<Address>()
        .ok()
        .map(|address| format!("{}@{}", address.user(), address.domain().to_lowercase()))
}

#[derive(Debug, PartialEq, Eq)]
pub enum ComposeError {
    NoRecipient,
    Invalid,
}

pub struct Reply {
    pub to: String,
    pub message: Message,
}

pub fn reply(original: &ParsedMail, from: &str, subject: &str, body: &str) -> Result<Reply, ComposeError> {
    let draft = draft::reply_to(original, body).map_err(|_| ComposeError::NoRecipient)?;
    let from: Mailbox = from.parse().map_err(|_| ComposeError::Invalid)?;
    let to: Mailbox = draft.to.parse().map_err(|_| ComposeError::Invalid)?;
    let subject = match invisible::one_line(subject).as_str() {
        "" => draft.subject,
        typed => typed.to_owned(),
    };
    let mut builder = Message::builder().from(from).to(to).subject(subject);
    if let Some(id) = &original.message_id {
        builder = builder.in_reply_to(angled(id)).references(references_of(original));
    }
    let message = builder
        .singlepart(SinglePart::plain(body.to_owned()))
        .map_err(|_| ComposeError::Invalid)?;
    Ok(Reply { to: draft.to, message })
}

/// The thread so far, then the mail being answered, each id once. The answered id is
/// last even when the thread already named it.
fn references_of(original: &ParsedMail) -> String {
    let answered = original.message_id.as_deref().map(angled);
    let mut ids: Vec<String> = Vec::new();
    for id in original.thread_ids.iter().map(|id| angled(id)) {
        if Some(&id) != answered.as_ref() && !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids.extend(answered);
    ids.join(" ")
}

/// Parsed ids come without their angle brackets, and a header carries them with.
fn angled(id: &str) -> String {
    if id.starts_with('<') {
        id.to_owned()
    } else {
        format!("<{id}>")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn original(references: &str) -> ParsedMail {
        let raw = format!(
            "From: Studio <andrea@studio.example.it>\r\nReply-To: Segreteria <segreteria@studio.example.it>\r\nMessage-ID: <orig@studio.example.it>\r\nReferences: {references}\r\nSubject: Riunione\r\n\r\nSe va bene giovedì?"
        );
        crate::mail::parse(raw.as_bytes())
    }

    fn text_of(reply: &Reply) -> String {
        String::from_utf8_lossy(&reply.message.formatted()).into_owned()
    }

    #[test]
    fn the_recipient_is_the_reply_to_and_the_threading_comes_from_the_original() {
        let reply = reply(&original("<root@studio.example.it>"), "Maria <maria@example.it>", "", "Va bene.").expect("composed");
        assert_eq!(reply.to, "segreteria@studio.example.it");
        let wire = text_of(&reply);
        assert!(wire.contains("In-Reply-To: <orig@studio.example.it>"), "{wire}");
        assert!(wire.contains("References: <root@studio.example.it> <orig@studio.example.it>"), "{wire}");
        assert!(wire.contains("Subject: Re: Riunione"), "{wire}");
    }

    #[test]
    fn a_subject_the_person_typed_replaces_the_default() {
        let reply = reply(&original("<root@studio.example.it>"), "maria@example.it", "Giovedi alle 11", "Va bene.").expect("composed");
        assert!(text_of(&reply).contains("Subject: Giovedi alle 11"));
    }

    #[test]
    fn a_recipient_keeps_its_local_part_as_written_and_lowercases_the_domain() {
        let raw = b"From: Studio <andrea@studio.example.it>\r\nReply-To: Luca.Ferri@Studio.Example.IT\r\nMessage-ID: <orig@studio.example.it>\r\nSubject: Riunione\r\n\r\nTesto";
        let reply = reply(&crate::mail::parse(raw), "maria@example.it", "", "Va bene.").expect("composed");
        assert_eq!(reply.to, "Luca.Ferri@studio.example.it");
    }

    #[test]
    fn a_typed_subject_is_one_line_and_cannot_add_a_header() {
        let typed = "Ciao\r\nBcc: x@y.example";
        let reply = reply(&original("<root@studio.example.it>"), "Maria <maria@example.it>", typed, "Va bene.").expect("composed");
        let wire = text_of(&reply);
        assert!(!wire.lines().any(|line| line.starts_with("Bcc:")), "{wire}");
        assert!(wire.contains("Subject: Ciao Bcc: x@y.example\r\n"), "{wire}");
    }

    #[test]
    fn a_mail_without_an_address_or_a_bad_sender_is_refused() {
        let nowhere = crate::mail::parse(b"Subject: x\r\n\r\ntesto");
        assert_eq!(reply(&nowhere, "maria@example.it", "", "ciao").err(), Some(ComposeError::NoRecipient));
        assert_eq!(reply(&original("<root@studio.example.it>"), "non un indirizzo", "", "ciao").err(), Some(ComposeError::Invalid));
    }

    #[test]
    fn a_reply_declares_its_body_as_utf8_text() {
        let reply = reply(&original("<root@studio.example.it>"), "maria@example.it", "", "Ti invierò il preventivo giovedì.").expect("composed");
        let wire = text_of(&reply);
        assert!(wire.contains("MIME-Version: 1.0"), "{wire}");
        assert!(wire.contains("Content-Type: text/plain; charset=utf-8"), "{wire}");
        assert!(wire.contains("invier=C3=B2"), "the body is UTF-8 on the wire: {wire}");
    }

    #[test]
    fn the_answered_id_appears_once_and_last_even_when_the_thread_already_names_it() {
        let thread = original("<root@studio.example.it> <orig@studio.example.it>");
        let wire = text_of(&reply(&thread, "maria@example.it", "", "Va bene.").expect("composed"));
        assert!(
            wire.contains("References: <root@studio.example.it> <orig@studio.example.it>\r\n"),
            "{wire}"
        );
        assert_eq!(wire.matches("<orig@studio.example.it>").count(), 2, "In-Reply-To and References: {wire}");
    }
}
