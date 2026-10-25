//! Phishing signals: sender and reply domains, display-name spoofs, link checks,
//! and a credential or payment word with an urgency word from a sender never seen.

use super::Reason;
use crate::domain;
use crate::link::Link;
use crate::mail::ParsedMail;
use regex::Regex;
use std::sync::OnceLock;

/// `\b` is ASCII here, as it is in the lab's JavaScript: "verifica" after an
/// accented letter is still a word boundary in a language-agnostic engine only.
fn credential() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r"(?-u)\bpassword\b|\bverific|\bconto\b|\bbonific|\biban\b")
            .expect("valid pattern")
    })
}

fn urgency() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r"(?-u)\bentro\b|\bscade|\bimmediat|\b24\s*ore\b").expect("valid pattern")
    })
}

pub fn reply_to_reasons(mail: &ParsedMail) -> Vec<Reason> {
    let reply_to = mail.reply_to.as_deref().unwrap_or_default();
    if reply_to.is_empty() {
        return Vec::new();
    }
    let from_domain = domain::of_address(&mail.from_address);
    let reply_domain = domain::of_address(reply_to);
    if domain::mismatch(from_domain.as_ref(), reply_domain.as_ref()) {
        vec![Reason::ReplyToMismatch]
    } else {
        Vec::new()
    }
}

pub fn display_spoof_reasons(mail: &ParsedMail) -> Vec<Reason> {
    let from_domain = domain::of_address(&mail.from_address);
    if domain::domains_in(&mail.from_display)
        .iter()
        .any(|shown| domain::mismatch(Some(shown), from_domain.as_ref()))
    {
        vec![Reason::DisplaySpoof]
    } else {
        Vec::new()
    }
}

pub fn link_reasons(links: &[Link]) -> Vec<Reason> {
    let mut reasons = Vec::new();
    for link in links {
        let Some(host) = domain::host_of(&link.href) else {
            continue;
        };
        if domain::is_ip_host(&host) {
            reasons.push(Reason::IpLink);
        }
        if domain::is_shortener(&host) {
            reasons.push(Reason::Shortener);
        }
        if domain::is_punycode(&host) {
            reasons.push(Reason::Punycode);
        }
        let target = domain::registrable(&host);
        if domain::domains_in(&link.text)
            .iter()
            .any(|shown| domain::mismatch(Some(shown), target.as_ref()))
        {
            reasons.push(Reason::LinkMismatch);
        }
    }
    reasons
}

/// A first-contact mail asking for a payment stays suspicious even when genuine:
/// the IBAN-change scam has exactly that shape, and a rule cannot tell them apart.
pub fn payment_urgency_reasons(mail: &ParsedMail, saw_sender_before: bool) -> Vec<Reason> {
    let haystack = format!("{}\n{}", mail.subject, mail.text).to_lowercase();
    if credential().is_match(&haystack) && urgency().is_match(&haystack) && !saw_sender_before {
        vec![Reason::PaymentUrgencyNewSender]
    } else {
        Vec::new()
    }
}
