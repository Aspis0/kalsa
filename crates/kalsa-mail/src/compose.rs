//! The reply a person confirmed, as a mail message. The recipient and the threading
//! come from the mail being answered; the subject and the body are the person's own.

use lettre::message::{Mailbox, Message};

use crate::draft;
use crate::mail::ParsedMail;

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
    let subject = match subject.trim() {
        "" => draft.subject,
        typed => typed.to_owned(),
    };
    let mut builder = Message::builder().from(from).to(to).subject(subject);
    if let Some(id) = &original.message_id {
        builder = builder.in_reply_to(angled(id)).references(references_of(original));
    }
    let message = builder.body(body.to_owned()).map_err(|_| ComposeError::Invalid)?;
    Ok(Reply { to: draft.to, message })
}

/// The thread so far, then the mail being answered.
fn references_of(original: &ParsedMail) -> String {
    let mut ids: Vec<String> = original.thread_ids.iter().map(|id| angled(id)).collect();
    ids.extend(original.message_id.as_deref().map(angled));
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

    fn original(extra_headers: &str) -> ParsedMail {
        let raw = format!(
            "From: Studio <andrea@studio.example.it>\r\nReply-To: Segreteria <segreteria@studio.example.it>\r\nMessage-ID: <orig@studio.example.it>\r\nReferences: <root@studio.example.it>\r\n{extra_headers}Subject: Riunione\r\n\r\nSe va bene giovedì?"
        );
        crate::mail::parse(raw.as_bytes())
    }

    fn text_of(reply: &Reply) -> String {
        String::from_utf8_lossy(&reply.message.formatted()).into_owned()
    }

    #[test]
    fn the_recipient_is_the_reply_to_and_the_threading_comes_from_the_original() {
        let reply = reply(&original(""), "Maria <maria@example.it>", "", "Va bene.").expect("composed");
        assert_eq!(reply.to, "segreteria@studio.example.it");
        let wire = text_of(&reply);
        assert!(wire.contains("In-Reply-To: <orig@studio.example.it>"), "{wire}");
        assert!(wire.contains("References: <root@studio.example.it> <orig@studio.example.it>"), "{wire}");
        assert!(wire.contains("Subject: Re: Riunione"), "{wire}");
    }

    #[test]
    fn a_subject_the_person_typed_replaces_the_default() {
        let reply = reply(&original(""), "maria@example.it", "Giovedi alle 11", "Va bene.").expect("composed");
        assert!(text_of(&reply).contains("Subject: Giovedi alle 11"));
    }

    #[test]
    fn a_mail_without_an_address_or_a_bad_sender_is_refused() {
        let nowhere = crate::mail::parse(b"Subject: x\r\n\r\ntesto");
        assert_eq!(reply(&nowhere, "maria@example.it", "", "ciao").err(), Some(ComposeError::NoRecipient));
        assert_eq!(reply(&original(""), "non un indirizzo", "", "ciao").err(), Some(ComposeError::Invalid));
    }
}
