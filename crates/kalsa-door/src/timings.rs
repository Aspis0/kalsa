//! The engine's per-completion timing numbers, read off the bytes the door
//! relays anyway.
//!
//! llama-server signs each completion with counters: a `timings` object
//! (`prompt_n`, `prompt_ms`, `predicted_n`, `predicted_ms`) and the prompt
//! cache's size as `cache_n` inside it or as `tokens_cached` beside it (the
//! shipped build's binary carries `tokens_cached`; both spellings are read).
//! They are what splits a slow completion into re-reading the prompt versus
//! generating — the door's own line has status and bytes only.
//!
//! Nothing is buffered and nothing waits: a byte search for the key names
//! first, and only a hit pays a parse of the one event or window that hit.
//! The parse is JSON-typed, so a model that echoes the key names inside its
//! own text is not misread — except on a non-stream body, where the search
//! runs over a small window of the body's tail and takes the LAST key hit,
//! because the engine's object is the response's last field. Only numbers
//! survive into the log line, through fixed format strings.

use serde_json::Value;

/// How much of a non-stream body's tail the window keeps: the `timings`
/// object is the response's last field, a few hundred bytes, so the last
/// 4 KiB hold it whole whatever the content above it ran to.
const WINDOW: usize = 4 * 1024;

#[derive(Default)]
pub(crate) struct Timings {
    prompt_n: Option<u64>,
    prompt_ms: Option<f64>,
    predicted_n: Option<u64>,
    predicted_ms: Option<f64>,
    cache: Option<u64>,
}

impl Timings {
    /// The line's suffix: ` prompt 1452/313ms predicted 97/3001ms cache
    /// 1408`, each part only when the engine sent both of its numbers. A
    /// count without its milliseconds, or the reverse, is left off rather
    /// than half-reported. Empty when nothing arrived.
    pub(crate) fn line_suffix(&self) -> String {
        let mut out = String::new();
        if let (Some(n), Some(ms)) = (self.prompt_n, self.prompt_ms) {
            out.push_str(&format!(" prompt {n}/{ms:.0}ms"));
        }
        if let (Some(n), Some(ms)) = (self.predicted_n, self.predicted_ms) {
            out.push_str(&format!(" predicted {n}/{ms:.0}ms"));
        }
        if let Some(cache) = self.cache {
            out.push_str(&format!(" cache {cache}"));
        }
        out
    }

    /// The numbers one `timings` object carries, plus the cache size when
    /// the body spelled it at the top level. `None` when the object held
    /// none of the fields — a hit on the key names alone records nothing.
    fn from_parts(timings: Option<&Value>, top_cache: Option<u64>) -> Option<Self> {
        let count = |value: Option<&Value>| value.and_then(|value| value.as_u64());
        let ms = |value: Option<&Value>| value.and_then(|value| value.as_f64());
        let timings = Timings {
            prompt_n: count(timings.and_then(|value| value.get("prompt_n"))),
            prompt_ms: ms(timings.and_then(|value| value.get("prompt_ms"))),
            predicted_n: count(timings.and_then(|value| value.get("predicted_n"))),
            predicted_ms: ms(timings.and_then(|value| value.get("predicted_ms"))),
            cache: count(timings.and_then(|value| value.get("cache_n")))
                .or_else(|| count(timings.and_then(|value| value.get("tokens_cached"))))
                .or(top_cache),
        };
        let arrived = timings.prompt_n.is_some()
            || timings.prompt_ms.is_some()
            || timings.predicted_n.is_some()
            || timings.predicted_ms.is_some()
            || timings.cache.is_some();
        arrived.then_some(timings)
    }
}

/// The timing numbers one relayed SSE event carries. `None` unless the
/// event's bytes name the keys at all — the common chunk pays for one byte
/// search, not a parse.
pub(crate) fn from_event(raw: &[u8]) -> Option<Timings> {
    if !contains(raw, b"\"timings\"") && !contains(raw, b"\"tokens_cached\"") {
        return None;
    }
    // The slab is the event's lines joined with `\n`, each ending in one:
    // the data payload this engine sends is the first line, `data: {json}`.
    let line = raw
        .split(|byte| *byte == b'\n')
        .find(|line| line.starts_with(b"data:"))?;
    let after_colon = &line[b"data:".len()..];
    let payload = after_colon.strip_prefix(b" ").unwrap_or(after_colon);
    let value: Value = serde_json::from_slice(payload).ok()?;
    Timings::from_parts(
        value.get("timings"),
        value.get("tokens_cached").and_then(|value| value.as_u64()),
    )
}

/// The last [`WINDOW`] bytes of a body, scanned as they go past: for a
/// non-stream completion the engine's counters sit at the end, so the tail
/// is all a parser needs and no body is ever held whole.
pub(crate) struct Tail {
    window: [u8; WINDOW],
    used: usize,
}

impl Tail {
    pub(crate) fn new() -> Self {
        Self {
            window: [0; WINDOW],
            used: 0,
        }
    }

    /// Feeds one relayed chunk; answers the numbers when this chunk's bytes
    /// completed a parse, so a caller feeding the whole body ends on the
    /// final values.
    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Option<Timings> {
        if bytes.len() >= WINDOW {
            self.window.copy_from_slice(&bytes[bytes.len() - WINDOW..]);
            self.used = WINDOW;
        } else {
            let keep = (self.used + bytes.len()).min(WINDOW);
            let slide = self.used + bytes.len() - keep;
            self.window.copy_within(slide..self.used, 0);
            self.window[self.used - slide..self.used - slide + bytes.len()]
                .copy_from_slice(bytes);
            self.used = keep;
        }
        parse_tail(&self.window[..self.used])
    }
}

/// The numbers in a body tail: the last `timings` key and the last
/// `tokens_cached` key, each followed by a complete JSON value. LAST, not
/// first — the engine's object is the body's last field, so nothing real
/// can sit after it, while content text may echo the key names before it.
fn parse_tail(tail: &[u8]) -> Option<Timings> {
    let timings = value_after_key(tail, b"\"timings\"");
    let top_cache = value_after_key(tail, b"\"tokens_cached\"").and_then(|value| value.as_u64());
    Timings::from_parts(timings.as_ref(), top_cache)
}

/// The JSON value that follows `"key":` in `tail`, parsed whole: `None`
/// when the key is not there or what follows it is not one complete value
/// (a value the window's start cut, the key inside content text).
fn value_after_key(tail: &[u8], key: &[u8]) -> Option<Value> {
    let at = rfind(tail, key)?;
    let colon = tail[at + key.len()..]
        .iter()
        .position(|byte| *byte == b':')?;
    let after = at + key.len() + colon + 1;
    let mut stream = serde_json::Deserializer::from_slice(&tail[after..]).into_iter::<Value>();
    stream.next()?.ok()
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}

fn rfind(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    (0..=haystack.len() - needle.len())
        .rev()
        .find(|at| &haystack[*at..*at + needle.len()] == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The tail of a recorded completion stream, as the engine sends it:
    /// the last content chunk, the final chunk with the counters, and the
    /// sentinel that closes every OpenAI-style stream.
    const RECORDED_TAIL: &[u8] = concat!(
        r#"data: {"content":" day","stop":false,"id_slot":0,"n_ctx":32768}"#,
        "\n\n",
        r#"data: {"content":"","stop":true,"id_slot":0,"n_ctx":32768,"tokens_predicted":97,"tokens_evaluated":1452,"timings":{"prompt_n":1452,"prompt_ms":312.53,"predicted_n":97,"predicted_ms":3001.25,"predicted_per_second":32.31,"prompt_per_second":4646.36},"tokens_cached":1408}"#,
        "\n\n",
        "data: [DONE]\n\n",
    )
    .as_bytes();

    #[test]
    fn a_recorded_final_chunk_yields_the_counters() {
        // The door parses one event at a time (the splitter's output), so
        // the recorded tail is fed event by event: the content chunk and
        // the sentinel name no keys, the final chunk carries them all.
        let mut timings = None;
        for line in RECORDED_TAIL.split(|byte| *byte == b'\n') {
            if line.is_empty() {
                continue;
            }
            if let Some(found) = from_event(line) {
                timings = Some(found);
            }
        }
        let suffix = timings.expect("the final chunk carries timings").line_suffix();
        assert_eq!(
            suffix,
            " prompt 1452/313ms predicted 97/3001ms cache 1408",
            "{suffix}"
        );
    }

    #[test]
    fn a_chunk_without_counters_parses_to_nothing() {
        let chunk = b"data: {\"content\":\" day\",\"stop\":false}\n\n";
        assert!(from_event(chunk).is_none());
        // The sentinel, and a keep-alive, name no keys either.
        assert!(from_event(b"data: [DONE]\n\n").is_none());
        assert!(from_event(b": ping\n\n").is_none());
    }

    #[test]
    fn the_cache_answer_uses_whichever_spelling_the_body_carries() {
        let cache_n = r#"data: {"timings":{"prompt_n":10,"prompt_ms":5.0,"predicted_n":2,"predicted_ms":8.0,"cache_n":7}}"#;
        assert_eq!(
            from_event(cache_n.as_bytes()).unwrap().line_suffix(),
            " prompt 10/5ms predicted 2/8ms cache 7"
        );
        let nested = r#"data: {"timings":{"prompt_n":10,"prompt_ms":5.0,"predicted_n":2,"predicted_ms":8.0,"tokens_cached":7}}"#;
        assert!(from_event(nested.as_bytes())
            .unwrap()
            .line_suffix()
            .ends_with("cache 7"));
        let top = r#"data: {"timings":{"prompt_n":10,"prompt_ms":5.0,"predicted_n":2,"predicted_ms":8.0},"tokens_cached":7}"#;
        assert!(from_event(top.as_bytes())
            .unwrap()
            .line_suffix()
            .ends_with("cache 7"));
    }

    #[test]
    fn a_model_echoing_the_keys_in_its_text_is_not_misread_as_an_event() {
        // The payload is parsed as one JSON object first, so a string value
        // that contains the key names stays a string: the counters the
        // object actually carries win.
        let echo = r#"data: {"content":"she wrote \"timings\" down","stop":false,"timings":{"prompt_n":1452,"prompt_ms":312.0,"predicted_n":97,"predicted_ms":3001.0}}"#;
        assert_eq!(
            from_event(echo.as_bytes()).unwrap().line_suffix(),
            " prompt 1452/312ms predicted 97/3001ms"
        );
        // An event that is not the object the engine sends parses to
        // nothing at all.
        assert!(from_event(b"data: not json\n").is_none());
        // And a key hit with no numbers behind it records nothing.
        assert!(from_event(b"data: {\"timings\":\"later\"}\n").is_none());
    }

    #[test]
    fn a_non_stream_body_yields_its_counters_from_the_tail() {
        let mut tail = Tail::new();
        // The body arrives in awkward chunks: the keys straddle boundaries.
        let body = r#"{"content":"a long answer nobody buffered","id_slot":0,"tokens_evaluated":1452,"timings":{"prompt_n":1452,"prompt_ms":312.53,"predicted_n":97,"predicted_ms":3001.25},"tokens_cached":1408}"#;
        let mut result = None;
        for chunk in body.as_bytes().chunks(7) {
            result = tail.feed(chunk);
        }
        let suffix = result
            .expect("the body's tail carried the counters")
            .line_suffix();
        assert_eq!(suffix, " prompt 1452/313ms predicted 97/3001ms cache 1408");
    }

    #[test]
    fn a_tail_that_never_carries_the_keys_answers_nothing() {
        let mut tail = Tail::new();
        let mut result = None;
        for chunk in b"{\"content\":\"no counters here at all\"}".chunks(5) {
            result = tail.feed(chunk);
        }
        assert!(result.is_none());
    }

    #[test]
    fn a_body_bigger_than_the_window_still_answers_its_counters() {
        // The window keeps the newest slice, and the counters sit at the
        // end of the body: they outlive content that scrolled them out.
        let mut tail = Tail::new();
        let filler = "x".repeat(WINDOW + 100);
        let body = format!(
            r#"{{"content":"{filler}","timings":{{"prompt_n":9,"prompt_ms":1.0,"predicted_n":2,"predicted_ms":3.0}}}}"#
        );
        let mut result = None;
        for chunk in body.as_bytes().chunks(64) {
            result = tail.feed(chunk);
        }
        assert_eq!(
            result.expect("the counters outlived the window").line_suffix(),
            " prompt 9/1ms predicted 2/3ms"
        );
    }

    #[test]
    fn half_reported_pairs_are_left_off_the_line() {
        let timings = Timings {
            prompt_n: Some(1452),
            prompt_ms: None,
            predicted_n: None,
            predicted_ms: Some(3001.0),
            cache: Some(1408),
        };
        assert_eq!(timings.line_suffix(), " cache 1408");
        assert_eq!(Timings::default().line_suffix(), "");
    }
}
