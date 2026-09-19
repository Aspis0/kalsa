//! One web search, through Exa's hosted MCP endpoint.
//!
//! No API key: the free plan is per-IP, which is what the phone uses too
//! (kalsa `src/search/ExaMCP.ts`). The protocol is JSON-RPC 2.0 over
//! streamable HTTP: initialize, notify, then one `tools/call`. What comes
//! back is folded into the model's numbered results by [`crate::exa`].

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::body::read_capped;
use crate::exa;
use crate::url;
use crate::WebError;

const ENDPOINT: &str = "https://mcp.exa.ai/mcp";
const PROTOCOL_VERSION: &str = "2025-03-26";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(20);
/// Exa clamps at five; four is enough to answer from and cheap to read.
const RESULTS: usize = 4;
/// A JSON-RPC envelope is small. Past this it is not one, and reading it whole
/// would be the crate's only unbounded read.
const BODY_CAP: usize = 512 * 1024;
/// A service's complaint is a sentence, not a document.
const MESSAGE_CAP: usize = 300;
const USER_AGENT: &str = "kalsa-brain/0.0.1";

/// Search the web and return the results as numbered text with their URLs.
/// `stop` is checked before every request and while each body is read.
pub fn search(query: &str, stop: &AtomicBool) -> Result<String, WebError> {
    let query = query.trim();
    if query.is_empty() {
        return Ok("No search was made: the query was empty.".to_string());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_TIMEOUT)
        // The endpoint has no business redirecting, and a redirect would be a
        // request to an address the gate never saw. Any 3xx is a failed search.
        .redirects(0)
        .resolver(url::resolver)
        .user_agent(USER_AGENT)
        .build();

    let initialize = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "kalsa-brain", "version": "0.0.1" },
        },
    });
    let (session, body) = post(&agent, None, &initialize.to_string(), stop)?;
    if envelope(&body, 1).is_none() {
        return Err(WebError::Network);
    }

    // The handshake notification takes no id and needs no answer; a server
    // that dislikes it is not one this crate can talk to.
    let notify = serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    post(&agent, session.as_deref(), &notify.to_string(), stop)?;

    let call = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": "web_search_exa",
            "arguments": { "query": query, "numResults": RESULTS },
        },
    });
    let (_, body) = post(&agent, session.as_deref(), &call.to_string(), stop)?;
    let answer = envelope(&body, 2).ok_or(WebError::Network)?;
    if let Some(error) = answer.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("no reason was given");
        return Err(WebError::Provider(shorten(message)));
    }
    let text = answer
        .pointer("/result/content/0/text")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    Ok(exa::results(text, query))
}

/// One JSON-RPC request. Returns the session id the server handed out, if any,
/// and the raw body — JSON or an event stream, both are answered.
fn post(
    agent: &ureq::Agent,
    session: Option<&str>,
    body: &str,
    stop: &AtomicBool,
) -> Result<(Option<String>, String), WebError> {
    if stop.load(Ordering::Relaxed) {
        return Err(WebError::Stopped);
    }
    let mut request = agent
        .post(ENDPOINT)
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream");
    if let Some(session) = session {
        request = request.set("mcp-session-id", session);
    }
    let response = match request.send_string(body) {
        Ok(response) => response,
        // Notifications are answered with a bare 202 by some servers, and
        // ureq reports anything outside 2xx as an error.
        Err(ureq::Error::Status(202, response)) => response,
        Err(ureq::Error::Status(code, _)) => return Err(WebError::Status(code)),
        Err(ureq::Error::Transport(_)) => return Err(WebError::Network),
    };
    let session = response.header("mcp-session-id").map(str::to_string);
    let (bytes, truncated) = read_capped(response.into_reader(), BODY_CAP, stop)?;
    if truncated {
        return Err(WebError::Oversize);
    }
    Ok((session, String::from_utf8_lossy(&bytes).into_owned()))
}

fn shorten(message: &str) -> String {
    let message = message.trim();
    if message.chars().count() <= MESSAGE_CAP {
        return message.to_string();
    }
    let cut = message.char_indices().nth(MESSAGE_CAP).map(|(i, _)| i).unwrap_or(message.len());
    format!("{}…", &message[..cut])
}

/// The JSON-RPC envelope answering `id`, from either a plain JSON body or an
/// event stream whose `data:` lines each carry one envelope.
fn envelope(body: &str, id: u64) -> Option<serde_json::Value> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(found) = matching(&value, id) {
            return Some(found);
        }
    }
    for frame in body.split("\n\n") {
        let mut data = String::new();
        for line in frame.lines() {
            if let Some(rest) = line.strip_prefix("data:") {
                if !data.is_empty() {
                    data.push('\n');
                }
                data.push_str(rest.trim_start());
            }
        }
        if data.is_empty() {
            continue;
        }
        if let Some(found) = serde_json::from_str(&data).ok().and_then(|v| matching(&v, id)) {
            return Some(found);
        }
    }
    None
}

fn matching(value: &serde_json::Value, id: u64) -> Option<serde_json::Value> {
    if value.get("id").and_then(|v| v.as_u64()) == Some(id) {
        Some(value.clone())
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::envelope;

    #[test]
    fn reads_an_envelope_from_a_plain_json_body() {
        let body = r#"{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"hi"}]}}"#;
        let found = envelope(body, 2).expect("id 2 is in the body");
        assert_eq!(found.pointer("/result/content/0/text").unwrap(), "hi");
        assert!(envelope(body, 1).is_none());
    }

    #[test]
    fn reads_an_envelope_from_an_event_stream() {
        let body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n\
                    event: message\ndata: {\"jsonrpc\":\"2.0\",\n\
                    data: \"id\":2,\"result\":{\"ok\":true}}\n\n";
        let found = envelope(body, 2).expect("multiline data is reassembled");
        assert_eq!(found.pointer("/result/ok").unwrap(), true);
    }

    #[test]
    fn nothing_to_read_is_not_a_panic() {
        assert!(envelope("", 1).is_none());
        assert!(envelope("not json at all", 1).is_none());
    }
}
