//! A reply, as an object. Nothing is sent and nothing is stored: a draft in this
//! phase never reaches the server, so no write command exists to reach one with.

use crate::mail::ParsedMail;
use serde::Serialize;

#[derive(Serialize, Debug)]
pub struct Draft {
    /// From the message's Reply-To when it has one, else its From. Never an
    /// argument: a model that could name the recipient could redirect a reply
    /// that the person approved for somebody else.
    pub to: String,
    pub subject: String,
    pub body: String,
    pub in_reply_to: Option<String>,
}

const NO_RECIPIENT: &str = "that message has no address to reply to";

pub fn reply_to(mail: &ParsedMail, body: &str) -> Result<Draft, &'static str> {
    let to = mail
        .reply_to
        .as_deref()
        .unwrap_or(&mail.from_address)
        .trim();
    if to.is_empty() {
        return Err(NO_RECIPIENT);
    }
    Ok(Draft {
        to: to.to_lowercase(),
        subject: subject_of(&mail.subject),
        body: body.to_string(),
        in_reply_to: mail.message_id.clone(),
    })
}

/// `Re: …`, and never `Re: Re: …`.
fn subject_of(subject: &str) -> String {
    let subject = subject.trim();
    if subject.to_lowercase().starts_with("re:") {
        subject.to_string()
    } else {
        format!("Re: {subject}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mail_with(
        from: &str,
        reply_to: Option<&str>,
        subject: &str,
        id: Option<&str>,
    ) -> ParsedMail {
        ParsedMail {
            headers: Vec::new(),
            from_address: from.to_string(),
            from_display: String::new(),
            reply_to: reply_to.map(str::to_string),
            date_ms: 0,
            message_id: id.map(str::to_string),
            subject: subject.to_string(),
            text: String::new(),
            body: String::new(),
            links: Vec::new(),
            attachments: Vec::new(),
            thread_ids: Vec::new(),
        }
    }

    #[test]
    fn the_recipient_comes_from_the_message_not_from_the_body() {
        let mail = mail_with(
            "Andrea@StudioFontana.example.it",
            Some(" reception@fontana-docs.example.net"),
            "Riunione",
            Some("<a@studio.example.it>"),
        );
        let draft = reply_to(&mail, "Va bene").expect("draft");
        assert_eq!(draft.to, "reception@fontana-docs.example.net");
        assert_eq!(draft.subject, "Re: Riunione");
        assert_eq!(draft.in_reply_to.as_deref(), Some("<a@studio.example.it>"));
    }

    #[test]
    fn without_a_reply_to_it_falls_back_to_the_from() {
        let mail = mail_with("segreteria@scuola.example.it", None, "Modulo", None);
        assert_eq!(
            reply_to(&mail, "Inviato").expect("draft").to,
            "segreteria@scuola.example.it"
        );
    }

    #[test]
    fn a_second_reply_does_not_stack_the_prefix() {
        let mail = mail_with("a@b.example.it", None, "RE: Modulo", None);
        assert_eq!(reply_to(&mail, "").expect("draft").subject, "RE: Modulo");
    }

    #[test]
    fn a_message_with_no_address_cannot_be_replied_to() {
        let mail = mail_with("", None, "Senza mittente", None);
        assert_eq!(reply_to(&mail, "ciao").err(), Some(NO_RECIPIENT));
    }
}
