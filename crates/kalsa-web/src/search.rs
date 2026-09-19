//! The plumbing a web search goes through, whatever service answers it.
//!
//! One agent that cannot reach this machine, one request at a time — each
//! stoppable, bounded, and turned into a sentence when it fails. The provider's
//! own dialect lives beside the results it shapes, in [`crate::exa`].
//!
//! **A second provider would supply** a module next to `exa.rs` that builds its
//! own request bodies and reads its own answers, taking one [`Budget`] for the
//! operation and calling [`post`] with `budget.agent()` per request, plus a line
//! in [`search`] choosing between them. Nothing in this file, `fetch.rs`,
//! `url.rs`, `body.rs` or `text.rs` would move.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::body::read_capped;
use crate::exa;
use crate::failure;
use crate::url;
use crate::{WebError, REQUEST_BUDGET};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(20);
const USER_AGENT: &str = "kalsa-brain/0.0.1";

/// Search the web and return the results as numbered text with their URLs.
pub fn search(query: &str, stop: &AtomicBool) -> Result<String, WebError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok("No search was made: the query was empty.".to_string());
    }
    // One provider exists, so one is named here. This is where a second one
    // would be chosen between.
    exa::search(query, stop)
}

/// When a search operation started, and how long it may run in total. A search
/// is several requests — a handshake and a call — and each one gets only what
/// is left of this, so a provider that stalls every leg cannot hold a tool call
/// for a multiple of the budget.
pub(crate) struct Budget(Instant);

impl Budget {
    pub(crate) fn starts() -> Self {
        Budget(Instant::now() + REQUEST_BUDGET)
    }

    /// The agent for the next request: the address gate, the resolver, no
    /// redirects, and the time this operation has left.
    pub(crate) fn agent(&self) -> Result<ureq::Agent, WebError> {
        let left = remaining(self.0, Instant::now())?;
        Ok(ureq::AgentBuilder::new()
            .timeout_connect(CONNECT_TIMEOUT)
            .timeout(left)
            .timeout_read(READ_TIMEOUT)
            .redirects(0)
            .resolver(url::resolver)
            .user_agent(USER_AGENT)
            .build())
    }
}

/// What is left of a deadline, or a timeout once it has passed.
fn remaining(deadline: Instant, now: Instant) -> Result<Duration, WebError> {
    let left = deadline.saturating_duration_since(now);
    if left.is_zero() {
        return Err(WebError::Timeout);
    }
    Ok(left)
}

/// One JSON request against a search service, its answer read under `cap`.
///
/// `send` is a header the provider needs on the way out — a session it must
/// echo, an `Authorization` it carries — and `read_back` is one it wants from
/// the answer. They are deliberately separate: the initialize request sends no
/// session and is exactly the one that is handed a new one, so tying the two
/// together loses the handshake. The stop flag is checked before the request and
/// while the body reads.
pub(crate) fn post(
    agent: &ureq::Agent,
    url: &str,
    send: Option<(&str, &str)>,
    read_back: Option<&str>,
    body: &str,
    cap: usize,
    stop: &AtomicBool,
) -> Result<(Option<String>, String), WebError> {
    if stop.load(Ordering::Relaxed) {
        return Err(WebError::Stopped);
    }
    let mut request = agent
        .post(url)
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream");
    if let Some((name, value)) = send {
        request = request.set(name, value);
    }
    let response = match request.send_string(body) {
        Ok(response) => response,
        Err(ureq::Error::Status(code, _)) => return Err(WebError::Status(code)),
        Err(ureq::Error::Transport(transport)) => return Err(failure::classify(&transport)),
    };
    // ureq calls only 4xx and 5xx an error, so a 3xx arrives here as an answer.
    // A search service that redirects is not answering, and following one is
    // something this crate never does.
    if !(200..300).contains(&response.status()) {
        return Err(WebError::Status(response.status()));
    }
    let handed_out = read_back.and_then(|name| response.header(name)).map(str::to_string);
    let (bytes, truncated) = read_capped(response.into_reader(), cap, stop)?;
    if truncated {
        return Err(WebError::Oversize);
    }
    Ok((handed_out, String::from_utf8_lossy(&bytes).into_owned()))
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicBool;

    use super::post;
    use crate::WebError;

    /// One canned HTTP answer on a loopback listener, for the checks that need
    /// a service and cannot have one.
    fn answer_once(response: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listener.local_addr().expect("an address").port();
        std::thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut scratch = [0u8; 1024];
                let _ = socket.read(&mut scratch);
                let _ = socket.write_all(response.as_bytes());
                let _ = socket.flush();
                // Half-close so the reader sees a clean end of body, and stay
                // alive a moment so it is not a reset.
                let _ = socket.shutdown(std::net::Shutdown::Write);
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
        });
        format!("http://127.0.0.1:{port}/")
    }

    /// The agent refuses this machine, so these build their own: what is under
    /// test is what `post` makes of a status, not the address gate.
    fn plain_agent() -> ureq::Agent {
        ureq::AgentBuilder::new().redirects(0).build()
    }

    #[test]
    fn a_redirect_is_a_failure_and_not_a_body() {
        // ureq calls only 4xx and 5xx an error, so without `post`'s own status
        // check a 302 would be read as the answer. Found 2026-09-19 by reading
        // ureq's `request.rs` while splitting this file.
        let url = answer_once("HTTP/1.1 302 Found\r\nlocation: /\r\ncontent-length: 5\r\n\r\nhello");
        let answer = post(&plain_agent(), &url, None, None, "{}", 4096, &AtomicBool::new(false));
        assert_eq!(answer, Err(WebError::Status(302)));
    }

    #[test]
    fn a_body_comes_back_with_the_header_it_was_asked_for() {
        let url = answer_once(
            "HTTP/1.1 200 OK\r\nmcp-session-id: abc123\r\ncontent-length: 2\r\n\r\nhi",
        );
        let answer = post(
            &plain_agent(),
            &url,
            Some(("mcp-session-id", "first")),
            Some("mcp-session-id"),
            "{}",
            4096,
            &AtomicBool::new(false),
        );
        assert_eq!(answer, Ok((Some("abc123".to_string()), "hi".to_string())));
    }

    /// The handshake: no session to send, and the answer is where one comes
    /// from. Reading back only what was sent loses it (found by review,
    /// 2026-09-19; Exa happens to tolerate the loss today, which is why no live
    /// test caught it).
    #[test]
    fn the_header_that_is_only_read_back_arrives() {
        let url = answer_once(
            "HTTP/1.1 200 OK\r\nmcp-session-id: minted\r\ncontent-length: 2\r\n\r\nhi",
        );
        let answer = post(
            &plain_agent(),
            &url,
            None,
            Some("mcp-session-id"),
            "{}",
            4096,
            &AtomicBool::new(false),
        );
        assert_eq!(answer, Ok((Some("minted".to_string()), "hi".to_string())));
    }

    #[test]
    fn an_answer_over_the_cap_is_refused_rather_than_parsed() {
        let url = answer_once("HTTP/1.1 200 OK\r\ncontent-length: 11\r\n\r\nhellohello!");
        let answer = post(&plain_agent(), &url, None, None, "{}", 4, &AtomicBool::new(false));
        assert_eq!(answer, Err(WebError::Oversize));
    }

    #[test]
    fn a_spent_budget_is_a_timeout() {
        let now = std::time::Instant::now();
        assert_eq!(
            super::remaining(now + std::time::Duration::from_secs(5), now),
            Ok(std::time::Duration::from_secs(5))
        );
        assert_eq!(
            super::remaining(now, now),
            Err(WebError::Timeout),
            "a budget that has run out must not be read as no time at all"
        );
        assert_eq!(
            super::remaining(now - std::time::Duration::from_secs(1), now),
            Err(WebError::Timeout)
        );
    }

    #[test]
    fn a_stopped_call_is_not_sent() {
        let url = answer_once("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nhi");
        let answer = post(&plain_agent(), &url, None, None, "{}", 4096, &AtomicBool::new(true));
        assert_eq!(answer, Err(WebError::Stopped));
    }
}
