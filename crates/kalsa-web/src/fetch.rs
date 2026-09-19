//! Open one page and return the text on it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

// `::url` is the crate: the module next door is this crate's own URL gate.
use ::url::Url;

use crate::body::read_capped;
use crate::failure;
use crate::text::html_to_text;
use crate::url;
use crate::{WebError, REQUEST_BUDGET};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(20);
/// Read at most this much of a body. A page longer than this is read to the
/// cap and its text cut with a marker — a bigger cap buys nothing the model
/// can hold anyway, and the cap is what keeps one hostile page from filling
/// memory.
const BODY_CAP: usize = 2_000_000;
/// What the model actually reads, after markup is gone. The server this app
/// talks to runs with a small context (the launch profile asks for 4096
/// tokens), and a page is not worth filling it with.
const TEXT_CAP: usize = 6_000;
/// A redirect chain longer than this is a loop or a maze; stop.
const MAX_REDIRECTS: usize = 5;

const USER_AGENT: &str = "kalsa-brain/0.0.1";

/// Fetch `url` and return its readable text, cut to what the model can use.
/// `stop` is checked before every request and while each body is read.
pub fn fetch(url: &str, stop: &AtomicBool) -> Result<String, WebError> {
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        // The whole request, body included: without it a server that trickles
        // bytes is bounded only by the body cap, which at one byte a second is
        // weeks. Takes precedence over the per-read timeout.
        .timeout(REQUEST_BUDGET)
        .timeout_read(READ_TIMEOUT)
        // Redirects are followed here, not by ureq: every hop must pass the
        // address gate, and ureq would happily follow one to 127.0.0.1.
        .redirects(0)
        // The name is resolved and checked before the connection, so a page
        // that resolves to this machine is never asked for.
        .resolver(url::resolver)
        .user_agent(USER_AGENT)
        .build();

    let mut current = url.trim().to_string();
    let mut hops = 0usize;
    loop {
        if stop.load(Ordering::Relaxed) {
            return Err(WebError::Stopped);
        }
        if !url::fetchable(&current) {
            return Err(WebError::Refused);
        }
        let response = match agent.get(&current).call() {
            Ok(response) => response,
            // ureq hands non-2xx back as an error carrying the response, so a
            // redirect arrives here rather than in the Ok arm.
            Err(ureq::Error::Status(_, response)) => response,
            Err(ureq::Error::Transport(transport)) => return Err(failure::classify(&transport)),
        };

        // The switch can be turned off while the server is thinking; the
        // answer is not worth having once the reader has gone.
        if stop.load(Ordering::Relaxed) {
            return Err(WebError::Stopped);
        }
        let status = response.status();
        if (300..400).contains(&status) {
            let location = response.header("location").unwrap_or("").trim().to_string();
            if location.is_empty() || hops >= MAX_REDIRECTS {
                return Err(WebError::Refused);
            }
            current = next_hop(&current, &location).ok_or(WebError::Refused)?;
            hops += 1;
            continue;
        }
        if !(200..300).contains(&status) {
            return Err(WebError::Status(status));
        }

        let content_type = response
            .header("content-type")
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let is_html = content_type == "text/html" || content_type == "application/xhtml+xml";
        // A missing content-type is common enough to be worth reading as HTML
        // rather than refusing: the alternative is a page the user can open in
        // a browser but the assistant cannot.
        if !is_html && !content_type.is_empty() && content_type != "text/plain" {
            return Err(WebError::Unsupported);
        }
        let (bytes, body_cut) = read_capped(response.into_reader(), BODY_CAP, stop)?;
        if stop.load(Ordering::Relaxed) {
            return Err(WebError::Stopped);
        }
        let body = String::from_utf8_lossy(&bytes).into_owned();

        let (text, truncated) = if is_html || content_type.is_empty() {
            html_to_text(&body, TEXT_CAP)
        } else {
            cut(&body, TEXT_CAP)
        };
        // Two different cuts, said differently: the raw body may have been
        // longer than this app reads at all, and the text that came out of it is
        // cut to what a small context can hold. A reader — and the model — must
        // not mistake a prefix for the whole page.
        let mut note = String::new();
        if body_cut {
            note.push_str(&format!(
                "\n\n[The page was longer than {BODY_CAP} bytes, so only its beginning was read.]"
            ));
        }
        if truncated {
            note.push_str(&format!(
                "\n\n[Only the first {TEXT_CAP} characters of what was read are shown.]"
            ));
        }
        if text.is_empty() {
            return Ok(format!("That page has no readable text on it.{note}"));
        }
        return Ok(format!("{text}{note}"));
    }
}

fn cut(text: &str, max_chars: usize) -> (String, bool) {
    if text.chars().count() <= max_chars {
        return (text.to_string(), false);
    }
    match text.char_indices().nth(max_chars) {
        Some((byte, _)) => (text[..byte].to_string(), true),
        None => (text.to_string(), false),
    }
}

/// Resolve a `Location` against the URL that carried it. The result is checked
/// by the gate before it is used, so a wrong join can only fail closed.
fn next_hop(base: &str, location: &str) -> Option<String> {
    let base = Url::parse(base).ok()?;
    base.join(location).ok().map(|next| next.to_string())
}

#[cfg(test)]
mod tests {
    use super::{cut, next_hop};

    #[test]
    fn joins_absolute_redirects() {
        assert_eq!(
            next_hop("https://a.example/x", "https://b.example/y").as_deref(),
            Some("https://b.example/y")
        );
        assert_eq!(
            next_hop("https://a.example/x", "//b.example/y").as_deref(),
            Some("https://b.example/y")
        );
    }

    #[test]
    fn joins_relative_redirects_against_the_current_url() {
        assert_eq!(
            next_hop("https://a.example/deep/page?q=1", "/root").as_deref(),
            Some("https://a.example/root")
        );
        assert_eq!(
            next_hop("https://a.example/deep/page", "sibling").as_deref(),
            Some("https://a.example/deep/sibling")
        );
        assert_eq!(
            next_hop("https://a.example/page", "here").as_deref(),
            Some("https://a.example/here")
        );
        // A query-only redirect keeps the path it was sent from.
        assert_eq!(
            next_hop("https://a.example/docs/page", "?next").as_deref(),
            Some("https://a.example/docs/page?next")
        );
        assert_eq!(
            next_hop("https://a.example/docs/page?old=1", "#top").as_deref(),
            Some("https://a.example/docs/page?old=1#top")
        );
    }

    #[test]
    fn cuts_on_a_character_boundary() {
        assert_eq!(cut("abc", 5), ("abc".to_string(), false));
        assert_eq!(cut("abcdef", 3), ("abc".to_string(), true));
        assert_eq!(cut("éééé", 2), ("éé".to_string(), true));
    }
}
