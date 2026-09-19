//! The plumbing a web search goes through, whatever service answers it.
//!
//! One agent that cannot reach this machine, one request at a time — each
//! stoppable, bounded, and turned into a sentence when it fails. The provider's
//! own dialect lives beside the results it shapes, in [`crate::exa`].
//!
//! **A second provider would supply** a module next to `exa.rs` that builds its
//! own request bodies and reads its own answers, calling [`post`] per request
//! and [`agent`] once, plus a line in [`search`] choosing between them. Nothing
//! in this file, `fetch.rs`, `url.rs`, `body.rs` or `text.rs` would move.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

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
    exa::search(&agent(), query, stop)
}

/// The agent every search request goes through: the address gate, the resolver,
/// the deadline, and no redirects — a redirect would be a request to an address
/// the gate never saw.
pub(crate) fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        // One request, however slowly the service feeds it (see REQUEST_BUDGET).
        .timeout(REQUEST_BUDGET)
        .timeout_read(READ_TIMEOUT)
        .redirects(0)
        .resolver(url::resolver)
        .user_agent(USER_AGENT)
        .build()
}

/// One JSON request against a search service, its answer read under `cap`.
///
/// `header` is the provider's own: a header it must send whose value on the
/// answer comes back alongside the body — MCP hands out a session that way, and
/// a bearer token simply ignores the reply. The stop flag is checked before the
/// request and while the body reads.
pub(crate) fn post(
    agent: &ureq::Agent,
    url: &str,
    header: Option<(&str, &str)>,
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
    let name = header.map(|(name, _)| name);
    if let Some((name, value)) = header {
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
    let handed_out = name.and_then(|name| response.header(name)).map(str::to_string);
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
        let answer = post(&plain_agent(), &url, None, "{}", 4096, &AtomicBool::new(false));
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
            "{}",
            4096,
            &AtomicBool::new(false),
        );
        assert_eq!(answer, Ok((Some("abc123".to_string()), "hi".to_string())));
    }

    #[test]
    fn an_answer_over_the_cap_is_refused_rather_than_parsed() {
        let url = answer_once("HTTP/1.1 200 OK\r\ncontent-length: 11\r\n\r\nhellohello!");
        let answer = post(&plain_agent(), &url, None, "{}", 4, &AtomicBool::new(false));
        assert_eq!(answer, Err(WebError::Oversize));
    }

    #[test]
    fn a_stopped_call_is_not_sent() {
        let url = answer_once("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nhi");
        let answer = post(&plain_agent(), &url, None, "{}", 4096, &AtomicBool::new(true));
        assert_eq!(answer, Err(WebError::Stopped));
    }
}
