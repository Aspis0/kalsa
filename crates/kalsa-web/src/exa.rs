//! Exa: the one search service this build talks to, and the shape of its answers.
//!
//! The protocol is MCP over streamable HTTP — initialize, tell the server we
//! are ready, then one `tools/call` carrying the question. No API key: the free
//! plan is per-IP, which is what the phone uses too (kalsa
//! `src/search/ExaMCP.ts`). The plumbing it stands on is [`crate::search`].
//!

use std::sync::atomic::AtomicBool;

use crate::jsonrpc;
use crate::search::{post, Budget};
use crate::WebError;

const ENDPOINT: &str = "https://mcp.exa.ai/mcp";
const PROTOCOL_VERSION: &str = "2025-03-26";
/// The header the handshake hands back, echoed on everything after it.
const SESSION: &str = "mcp-session-id";
/// Exa clamps at five; four is enough to answer from and cheap to read.
const RESULTS: usize = 4;
/// A JSON-RPC envelope is small. Past this it is not one, and reading it whole
/// would be the crate's only unbounded read.
const BODY_CAP: usize = 512 * 1024;
/// A service's complaint is a sentence, not a document.
const MESSAGE_CAP: usize = 300;

/// Ask Exa and return the results as the model reads them.
pub(crate) fn search(query: &str, stop: &AtomicBool) -> Result<String, WebError> {
    // One budget for the handshake and the call together: three requests each
    // allowed the full time would be three times the bound.
    let budget = Budget::starts();
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
    // The initialize answer is where the session comes from, and this request
    // sends none: the header sent and the header read back are separate things.
    let (session, body) = post(
        &budget.agent()?,
        ENDPOINT,
        None,
        Some(SESSION),
        &initialize.to_string(),
        BODY_CAP,
        stop,
    )?;
    if jsonrpc::envelope(&body, 1).is_none() {
        return Err(WebError::Network);
    }

    // The handshake notification takes no id and needs no answer; a server that
    // dislikes it is not one this crate can talk to.
    let ready = serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    let carried = session.as_deref().map(|value| (SESSION, value));
    post(&budget.agent()?, ENDPOINT, carried, None, &ready.to_string(), BODY_CAP, stop)?;

    let call = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": "web_search_exa",
            "arguments": { "query": query, "numResults": RESULTS },
        },
    });
    let carried = session.as_deref().map(|value| (SESSION, value));
    let (_, body) = post(&budget.agent()?, ENDPOINT, carried, None, &call.to_string(), BODY_CAP, stop)?;
    let answer = jsonrpc::envelope(&body, 2).ok_or(WebError::Network)?;
    if let Some(said) = refusal(&answer) {
        return Err(WebError::Provider(shorten(said)));
    }
    let text = answer
        .pointer("/result/content/0/text")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    Ok(results(text, query))
}

/// A refusal inside an envelope, in the provider's own words. Two shapes matter:
/// JSON-RPC's own `error`, and MCP's `result.isError` — a tool that refused
/// arrives as a *successful* envelope carrying that flag, so without this the
/// refusal prose is shaped as if it were results and the run is recorded as a
/// success.
fn refusal(answer: &serde_json::Value) -> Option<&str> {
    if let Some(error) = answer.get("error") {
        return Some(
            error
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("no reason was given"),
        );
    }
    let refused = answer.pointer("/result/isError").and_then(|value| value.as_bool()) == Some(true);
    if refused {
        return Some(
            answer
                .pointer("/result/content/0/text")
                .and_then(|value| value.as_str())
                .unwrap_or("no reason was given"),
        );
    }
    None
}

fn shorten(message: &str) -> String {
    let message = message.trim();
    if message.chars().count() <= MESSAGE_CAP {
        return message.to_string();
    }
    let cut = message.char_indices().nth(MESSAGE_CAP).map(|(i, _)| i).unwrap_or(message.len());
    format!("{}…", &message[..cut])
}

/// What the model reads.
const TEXT_CAP: usize = 2_500;

/// Format the tool's text as numbered results with their URLs. Empty when the
/// text held no usable result.
pub(crate) fn results(text: &str, query: &str) -> String {
    let found = parse(text);
    if found.is_empty() {
        return format!("No results were found for “{query}”.");
    }

    let mut out = String::new();
    for (index, result) in found.iter().enumerate() {
        out.push_str(&format!("{}. {}\n   URL: {}\n", index + 1, result.title, result.url));
        if !result.snippet.is_empty() {
            out.push_str(&format!("   {}\n", result.snippet));
        }
        out.push('\n');
    }
    let out = out.trim_end();
    if out.chars().count() <= TEXT_CAP {
        return out.to_string();
    }
    let cut = out.char_indices().nth(TEXT_CAP).map(|(i, _)| i).unwrap_or(out.len());
    format!("{}\n\n[Only the first {TEXT_CAP} characters are shown.]", &out[..cut])
}

struct Found {
    title: String,
    url: String,
    snippet: String,
}

fn parse(text: &str) -> Vec<Found> {
    let mut reader = Reader::default();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line == "---" {
            continue;
        }
        if let Some(rest) = line.strip_prefix("Title:") {
            reader.next_result();
            reader.title = Some(rest.trim().to_string());
        } else if let Some(rest) = line.strip_prefix("URL:") {
            reader.url = rest.trim().to_string();
        } else if line.starts_with("Published:")
            || line.starts_with("Author:")
            || line.starts_with("Highlights:")
        {
            continue;
        } else if reader.title.is_some() {
            reader.highlights.push(line.to_string());
        }
    }
    reader.finish()
}

#[derive(Default)]
struct Reader {
    found: Vec<Found>,
    title: Option<String>,
    url: String,
    highlights: Vec<String>,
}

impl Reader {
    /// Close the result being read. Headers without a title (the separator
    /// between blocks, stray prose) never become a result of their own.
    fn next_result(&mut self) {
        if let Some(title) = self.title.take() {
            if !self.url.is_empty() {
                self.found.push(Found {
                    title,
                    url: std::mem::take(&mut self.url),
                    snippet: self.highlights.join(" "),
                });
            }
        }
        self.url.clear();
        self.highlights.clear();
    }

    fn finish(mut self) -> Vec<Found> {
        self.next_result();
        self.found.truncate(4);
        self.found
    }
}

#[cfg(test)]
mod tests {
    use super::{refusal, results};

    #[test]
    fn a_json_rpc_error_is_a_refusal() {
        let answer = serde_json::json!({ "jsonrpc": "2.0", "id": 2, "error": { "code": -32000, "message": "rate limited" } });
        assert_eq!(refusal(&answer), Some("rate limited"));
    }

    #[test]
    fn a_tool_that_refused_inside_a_successful_envelope_is_a_refusal() {
        let answer = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": { "isError": true, "content": [{ "type": "text", "text": "quota exhausted" }] },
        });
        assert_eq!(refusal(&answer), Some("quota exhausted"));
    }

    #[test]
    fn an_ordinary_answer_is_not_a_refusal() {
        let answer = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": { "isError": false, "content": [{ "type": "text", "text": "Title: One\nURL: https://example.com/" }] },
        });
        assert_eq!(refusal(&answer), None);
        assert!(results("Title: One\nURL: https://example.com/", "q").starts_with("1. One"));
    }

    const EXA_TEXT: &str = "Title: Rust 1.85 released\nURL: https://blog.rust-lang.org/1.85\n\
                            Published: 2025-02-20\nHighlights:\nAsync closures are stable.\nThe edition is 2024.\n\
                            ---\nTitle: Second result\nURL: https://example.com/two\nAuthor: Someone\n\
                            Highlights:\nA second highlight.";

    #[test]
    fn reads_results_out_of_exa_flat_text() {
        let out = results(EXA_TEXT, "rust");
        assert!(out.starts_with("1. Rust 1.85 released\n   URL: https://blog.rust-lang.org/1.85\n"));
        assert!(out.contains("Async closures are stable. The edition is 2024."));
        assert!(out.contains("2. Second result"));
        assert!(out.contains("A second highlight."));
    }

    #[test]
    fn a_result_without_a_url_is_dropped() {
        let out = results("Title: No address\nHighlights:\nNothing.", "q");
        assert_eq!(out, "No results were found for “q”.");
    }

    #[test]
    fn prose_before_the_first_title_is_ignored() {
        let out = results("Searching…\nTitle: One\nURL: https://example.com/1", "q");
        assert!(out.starts_with("1. One"));
    }

    #[test]
    fn the_output_is_cut_with_a_marker() {
        let long = format!("Title: One\nURL: https://example.com/1\nHighlights:\n{}", "x".repeat(9000));
        let out = results(&long, "q");
        assert!(out.ends_with("[Only the first 2500 characters are shown.]"));
        assert!(out.chars().count() < 2600, "{} chars", out.chars().count());
    }
}
