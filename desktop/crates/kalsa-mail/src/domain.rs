//! Domain helpers for the rules. Two domains are the same sender only when they
//! share a registrable domain, so `marketing.amazon.it` and `amazon.it` match.

use regex::Regex;
use std::sync::OnceLock;

/// The lab keeps a short list because `psl` answers for any suffix it has: without
/// it "Dott.ssa" and "S.p.A." read as domains and every mail becomes a spoof.
const KNOWN_TLDS: [&str; 26] = [
    "com", "it", "net", "org", "eu", "io", "info", "biz", "edu", "gov", "co", "uk", "de", "fr",
    "es", "ch", "me", "app", "xyz", "online", "site", "top", "shop", "help", "pro", "ly",
];

const SHORTENERS: [&str; 12] = [
    "bit.ly",
    "tinyurl.com",
    "t.co",
    "goo.gl",
    "is.gd",
    "cutt.ly",
    "rebrand.ly",
    "ow.ly",
    "buff.ly",
    "shorturl.at",
    "tiny.cc",
    "rb.gy",
];

fn domain_in_text() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r"(?i)(?:^|[^a-z0-9.-])((?:[a-z0-9-]+\.)+([a-z]{2,}))").expect("valid pattern")
    })
}

/// A match only counts when the character after it cannot continue a host name.
fn ends_a_host(text: &str, end: usize) -> bool {
    !text[end..].starts_with(|c: char| c.is_ascii_alphanumeric() || c == '-')
}

/// The registrable domain, or `None` for an IP address, `localhost`, or junk.
pub fn registrable(host: &str) -> Option<String> {
    psl::domain_str(host.trim().trim_end_matches('.')).map(str::to_lowercase)
}

/// Every registrable domain that appears literally in the text.
pub fn domains_in(text: &str) -> Vec<String> {
    domain_in_text()
        .captures_iter(text)
        .filter_map(|caps| {
            let whole = caps.get(0)?;
            let domain = caps.get(1)?.as_str().to_lowercase();
            let tld = caps.get(2)?.as_str().to_lowercase();
            if !ends_a_host(text, whole.end()) || !KNOWN_TLDS.contains(&tld.as_str()) {
                return None;
            }
            Some(registrable(&domain).unwrap_or(domain))
        })
        .collect()
}

/// The registrable domain of an email address.
pub fn of_address(address: &str) -> Option<String> {
    registrable(address.rsplit('@').next().unwrap_or_default())
}

/// The host an `href` points at, lowercased. Relative and malformed hrefs are `None`.
pub fn host_of(href: &str) -> Option<String> {
    url::Url::parse(href.trim())
        .ok()
        .map(|url| url.host_str().unwrap_or_default().to_lowercase())
        .filter(|host| !host.is_empty())
}

pub fn is_ip_host(host: &str) -> bool {
    static CELL: OnceLock<Regex> = OnceLock::new();
    let re = CELL.get_or_init(|| Regex::new(r"^\d{1,3}(\.\d{1,3}){3}$").expect("valid pattern"));
    re.is_match(host) || host.starts_with('[')
}

pub fn is_shortener(host: &str) -> bool {
    SHORTENERS
        .iter()
        .any(|short| host == *short || host.ends_with(&format!(".{short}")))
}

pub fn is_punycode(host: &str) -> bool {
    host.split('.').any(|label| label.starts_with("xn--"))
}

/// True only when both sides exist and differ. An absent domain is not a mismatch.
pub fn mismatch(a: Option<&String>, b: Option<&String>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => a != b,
        _ => false,
    }
}
