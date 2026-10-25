//! JSON-RPC envelopes, however a service sends them.
//!
//! A reply may be one JSON object, or an event stream whose `data:` lines each
//! carry one — the same message in two wrappers. Only the envelope answering
//! the id we asked under is returned, so a notification or somebody else's
//! answer is never mistaken for ours.

/// The JSON-RPC envelope answering `id`, from either a plain JSON body or an
/// event stream whose `data:` lines each carry one envelope.
pub(crate) fn envelope(body: &str, id: u64) -> Option<serde_json::Value> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(found) = matching(&value, id) {
            return Some(found);
        }
    }
    // SSE allows CRLF separators, and a stream of more than one such frame
    // would otherwise be read as a single frame with two JSON texts inside it.
    let body = body.replace("\r\n", "\n");
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
    fn reads_an_envelope_from_a_crlf_event_stream() {
        let body = "event: message\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\r\n\r\n\
                    event: message\r\ndata: {\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"ok\":true}}\r\n\r\n";
        let found = envelope(body, 2).expect("the second CRLF frame is the answer");
        assert_eq!(found.pointer("/result/ok").unwrap(), true);
    }

    #[test]
    fn nothing_to_read_is_not_a_panic() {
        assert!(envelope("", 1).is_none());
        assert!(envelope("not json at all", 1).is_none());
    }
}
