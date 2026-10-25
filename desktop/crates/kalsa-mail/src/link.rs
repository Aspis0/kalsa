//! Every link in a bounded body: anchors with their visible text, and every bare
//! http(s) URL. Bare URLs are taken from the raw body too, so one hidden in an
//! HTML comment still counts as a link the mail carries.

use crate::domain;
use regex::Regex;
use std::sync::OnceLock;

pub struct Link {
    pub href: String,
    /// The words the person would see. Empty for a bare URL.
    pub text: String,
}

fn anchor() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r#"(?is)<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>"#)
            .expect("valid pattern")
    })
}

fn bare() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(r#"(?i)https?://[^\s"'<>)]+"#).expect("valid pattern"))
}

fn tag() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(r"(?s)<[^>]+>").expect("valid pattern"))
}

pub fn links_in(body: &str) -> Vec<Link> {
    let anchors: Vec<Link> = anchor()
        .captures_iter(body)
        .filter_map(|caps| {
            let href = caps.get(1)?.as_str().to_string();
            let inner = caps.get(2).map_or("", |m| m.as_str());
            let text = tag().replace_all(inner, " ").into_owned();
            Some(Link {
                href,
                text: text.trim().to_string(),
            })
        })
        .collect();
    let bare: Vec<Link> = bare()
        .find_iter(body)
        .map(|m| Link {
            href: m.as_str().to_string(),
            text: String::new(),
        })
        .collect();
    anchors.into_iter().chain(bare).collect()
}

/// The body a person and a model both read, with every URL left as the host it
/// points at.
///
/// A sender's html-to-text alternative writes each tracking redirect in full, and
/// a redirect target is the sender's own words read back by a model: the host is
/// the part that says where a mail came from. This is for the readable text only.
/// The rules that judge a link read `links_in` and keep the real hrefs.
///
/// A URL whose host cannot be read is left exactly as it arrived: half of a URL
/// says less than the whole of it.
pub fn domains_only(text: &str) -> String {
    bare()
        .replace_all(text, |caps: &regex::Captures<'_>| match domain::host_of(&caps[0]) {
            Some(host) => host,
            None => caps[0].to_string(),
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The lab stops a bare URL at whitespace. Without that, a safe URL swallows the
    /// shortener in the next word and the link check never sees it.
    #[test]
    fn a_bare_url_stops_at_whitespace() {
        let links = links_in("Vai su https://safe.example/pagina\npoi su https://bit.ly/3Xq9pLk");
        let hrefs: Vec<&str> = links.iter().map(|l| l.href.as_str()).collect();
        assert_eq!(
            hrefs,
            vec!["https://safe.example/pagina", "https://bit.ly/3Xq9pLk"]
        );
    }

    #[test]
    fn a_url_in_a_comment_is_still_a_link_the_mail_carries() {
        let links = links_in("<!-- see https://bit.ly/3Xq9pLk -->");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].href, "https://bit.ly/3Xq9pLk");
        assert!(links[0].text.is_empty());
    }

    #[test]
    fn an_anchor_keeps_the_words_a_person_would_see() {
        let links = links_in("<a href=\"https://a.example.it/x\"><b>Verifica</b> subito</a>");
        // The lab swaps each tag for a space and trims: two words, two spaces.
        assert_eq!(links[0].text, "Verifica  subito");
    }

    /// What the owner's own newsletter looked like: an image wrapped in a link,
    /// written out by the sender's alternative as the alt text and the href.
    #[test]
    fn a_tracking_redirect_in_the_body_reads_as_its_host() {
        let body = "logo-nebius\n(https://email.nebius.com/e3t/Ctc/X+113/d38dPw04/VVCq4Y4P)\nCiao Marco,";
        assert_eq!(
            domains_only(body),
            "logo-nebius\n(email.nebius.com)\nCiao Marco,"
        );
    }

    #[test]
    fn a_bare_url_reads_as_its_host_too() {
        assert_eq!(domains_only("Vai su https://example.it/pagina"), "Vai su example.it");
    }

    /// The words around it are the reason the body is read at all.
    #[test]
    fn a_url_inside_prose_keeps_the_prose() {
        let body = "Conferma qui: https://example.it/ordini/1234 entro venerdì.";
        assert_eq!(domains_only(body), "Conferma qui: example.it entro venerdì.");
    }

    #[test]
    fn a_body_with_no_link_reads_exactly_as_it_arrived() {
        let body = "Ciao Marco,\nla fattura è in arrivo.\nA presto.";
        assert_eq!(domains_only(body), body);
    }
}
