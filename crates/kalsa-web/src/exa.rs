//! Exa: the one search service this build talks to, and the shape of its answers.
//!
//! The protocol is MCP over streamable HTTP — initialize, tell the server we
//! are ready, then one `tools/call` carrying the question. No API key: the free
//! plan is per-IP, which is what the phone uses too (kalsa
//! `src/search/ExaMCP.ts`). The plumbing it stands on is [`crate::search`].
//!

use std::sync::atomic::AtomicBool;

use crate::jsonrpc;
use crate::search::post;
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
pub(crate) fn search(
    agent: &ureq::Agent,
    query: &str,
    stop: &AtomicBool,
) -> Result<String, WebError> {
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
    let (session, body) = post(agent, ENDPOINT, None, &initialize.to_string(), BODY_CAP, stop)?;
    if jsonrpc::envelope(&body, 1).is_none() {
        return Err(WebError::Network);
    }

    // The handshake notification takes no id and needs no answer; a server that
    // dislikes it is not one this crate can talk to.
    let ready = serde_json::json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    let carried = session.as_deref().map(|value| (SESSION, value));
    post(agent, ENDPOINT, carried, &ready.to_string(), BODY_CAP, stop)?;

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
    let (_, body) = post(agent, ENDPOINT, carried, &call.to_string(), BODY_CAP, stop)?;
    let answer = jsonrpc::envelope(&body, 2).ok_or(WebError::Network)?;
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
    Ok(results(text, query))
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
    use super::results;

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
