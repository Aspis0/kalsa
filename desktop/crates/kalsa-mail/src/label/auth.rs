//! Authentication-Results: only the topmost header stamped by our own provider counts.

use super::{values, Reason};
use regex::Regex;
use std::sync::OnceLock;

fn method() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(r"(?i)\b(dmarc|spf|dkim)=(\w+)").expect("valid pattern"))
}

/// Without a known `authserv-id` nothing is trusted, our own header included: a
/// forwarded mail keeps the old provider's header further down, and a naive reader
/// takes that one.
pub fn reasons(headers: &[(String, String)], trusted_authserv_id: Option<&str>) -> Vec<Reason> {
    let Some(trusted) = trusted_authserv_id.map(str::to_lowercase) else {
        return Vec::new();
    };
    let own = values(headers, "authentication-results").find(|value| {
        value
            .split(';')
            .next()
            .unwrap_or_default()
            .trim()
            .to_lowercase()
            == trusted
    });
    let Some(own) = own else {
        return Vec::new();
    };
    let failed = method().captures_iter(own).any(|caps| {
        caps.get(2)
            .is_some_and(|result| result.as_str().eq_ignore_ascii_case("fail"))
    });
    if failed {
        vec![Reason::AuthFail]
    } else {
        Vec::new()
    }
}
