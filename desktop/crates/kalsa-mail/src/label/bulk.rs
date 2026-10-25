//! Bulk and automatic mail, from headers and the sender's local part.
//! Nothing in here is a threat signal.

use super::{first, Reason};
use crate::mail::ParsedMail;
use regex::Regex;
use std::sync::OnceLock;

const BULK_PRECEDENCE: [&str; 3] = ["bulk", "list", "junk"];

fn noreply() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(r"(?i)^no-?reply").expect("valid pattern"))
}

pub fn reasons(mail: &ParsedMail) -> Vec<Reason> {
    let mut reasons = Vec::new();
    let precedence = first(&mail.headers, "precedence")
        .unwrap_or_default()
        .to_lowercase();
    let auto_submitted = first(&mail.headers, "auto-submitted")
        .unwrap_or_default()
        .to_lowercase();

    let bulk_header = mail
        .headers
        .iter()
        .any(|(name, _)| name == "list-unsubscribe")
        || BULK_PRECEDENCE.contains(&precedence.as_str())
        || (!auto_submitted.is_empty() && auto_submitted != "no");
    if bulk_header {
        reasons.push(Reason::BulkHeader);
    }

    let local_part = mail.from_address.split('@').next().unwrap_or_default();
    if noreply().is_match(local_part) {
        reasons.push(Reason::BulkNoreply);
    }
    reasons
}
