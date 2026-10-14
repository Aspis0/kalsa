//! Labels each mail bulk, suspicious or normal from its headers and a bounded
//! body. No model is involved.
//!
//! Suspicious wins over bulk: a mail is never shown as plainly important, whatever
//! else it is. The rules are a port of the lab labeller (~/lab/mail-lab/src/0b/label),
//! so the numbers on the lab's 48 mails must come out the same.

pub mod auth;
pub mod bulk;
pub mod hidden;
pub mod phishing;

use crate::mail::ParsedMail;
use serde::Serialize;

#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Label {
    Suspicious,
    Bulk,
    Normal,
}

impl Label {
    pub fn name(self) -> &'static str {
        match self {
            Label::Suspicious => "suspicious",
            Label::Bulk => "bulk",
            Label::Normal => "normal",
        }
    }
}

/// Short fixed codes. The host turns them into the person's language, so no rule
/// text crosses the wire and no translation can change what fired.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reason {
    AuthFail,
    ReplyToMismatch,
    DisplaySpoof,
    LinkMismatch,
    IpLink,
    Shortener,
    Punycode,
    PaymentUrgencyNewSender,
    HiddenText,
    BulkHeader,
    BulkNoreply,
}

impl Reason {
    pub fn code(self) -> &'static str {
        match self {
            Reason::AuthFail => "auth_fail",
            Reason::ReplyToMismatch => "reply_to_mismatch",
            Reason::DisplaySpoof => "display_spoof",
            Reason::LinkMismatch => "link_mismatch",
            Reason::IpLink => "ip_link",
            Reason::Shortener => "shortener",
            Reason::Punycode => "punycode",
            Reason::PaymentUrgencyNewSender => "payment_urgency_new_sender",
            Reason::HiddenText => "hidden_text",
            Reason::BulkHeader => "bulk_header",
            Reason::BulkNoreply => "bulk_noreply",
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize)]
pub struct Labels {
    pub label: Label,
    pub suspicious: bool,
    pub bulk: bool,
    pub reasons: Vec<Reason>,
}

/// One sender in the mailbox, and the UID of the mail that carried them. The UID is
/// what says who was first: a sender can write any Date they like into a header.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Sender {
    pub address: String,
    pub uid: u32,
}

/// `history` is every sender in the folder, not only the window being listed: the
/// rule is "a sender never seen in the mailbox before", so it has to look past it.
/// "Before" is a lower UID from the same address, never the Date header: that header
/// is written by whoever sent the mail.
pub fn label(
    uid: u32,
    mail: &ParsedMail,
    history: &[Sender],
    trusted_authserv_id: Option<&str>,
) -> Labels {
    let saw_sender_before = history
        .iter()
        .any(|other| other.address == mail.from_address && other.uid < uid);

    let mut reasons = Vec::new();
    reasons.extend(auth::reasons(&mail.headers, trusted_authserv_id));
    reasons.extend(phishing::reply_to_reasons(mail));
    reasons.extend(phishing::display_spoof_reasons(mail));
    reasons.extend(phishing::link_reasons(&mail.links));
    reasons.extend(phishing::payment_urgency_reasons(mail, saw_sender_before));
    reasons.extend(hidden::reasons(mail));

    let bulk_reasons = bulk::reasons(mail);
    let suspicious = !reasons.is_empty();
    let bulk = !bulk_reasons.is_empty();

    let mut all: Vec<Reason> = reasons.into_iter().chain(bulk_reasons).collect();
    all.sort_unstable();
    all.dedup();

    Labels {
        label: if suspicious {
            Label::Suspicious
        } else if bulk {
            Label::Bulk
        } else {
            Label::Normal
        },
        suspicious,
        bulk,
        reasons: all,
    }
}

/// The header values of one name, in wire order. The rules read position, not
/// uniqueness: a forwarded mail carries the original provider's header below ours.
pub fn values<'a>(headers: &'a [(String, String)], name: &'a str) -> impl Iterator<Item = &'a str> {
    headers
        .iter()
        .filter(move |(key, _)| key == name)
        .map(|(_, value)| value.as_str())
}

pub fn first<'a>(headers: &'a [(String, String)], name: &'a str) -> Option<&'a str> {
    values(headers, name).next()
}
