//! The media guard: what the engine may be asked to load, applied to a body
//! the proxy already holds in memory.
//!
//! llama-server reads a media part's source out of the request and loads it
//! itself. An `http(s)://` source is downloaded by the engine; a `file://`
//! source is read from disk under the directory its `--media-path` names; any
//! other spelling is decoded as base64. The first two make the *computer* the
//! one that reaches: a paired phone would be naming a host the engine, on
//! loopback, can reach while the phone cannot — or a file only that machine can
//! open. The door admits one source form, a `data:` URI carried inline in the
//! body, so the engine never performs a request a client chose.
//!
//! The guard never rewrites the bytes it accepts; the proxy relays the body
//! byte for byte. Each shape below describes what the engine's own parser
//! would read, not a schema this door imposes: a body that is not JSON, or is
//! JSON without a source in it, is left exactly as it was.

use serde_json::{Map, Value};

/// The decision about one request body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Verdict {
    /// The engine may be handed these bytes, unchanged.
    Allowed,
    /// A part named a source the engine would reach for itself.
    Refused,
}

/// The word a refusal answers with and logs. It names the rule and never the
/// source: a refused body's bytes are not the door's to write anywhere.
pub(super) const REFUSED: &str = "media_source_refused";

/// The keys the engine reads a media source from — the chat dialect's
/// `image_url`, the audio and video parts, the engine's `video_url` alias for
/// `input_video`, and the `source` object the Messages dialect uses.
const SOURCE_KEYS: &[&str] = &[
    "image_url",
    "input_audio",
    "input_video",
    "video_url",
    "source",
];

/// The data-URI families a part may carry. The engine accepts any family under
/// any source key; the door holds a part to its own kind, so a mislabelled
/// part is refused rather than decoded as another medium.
const IMAGE: &str = "data:image/";
const AUDIO: &str = "data:audio/";
const VIDEO: &str = "data:video/";

/// Inspects one request body.
pub(super) fn inspect(body: &[u8]) -> Verdict {
    match serde_json::from_slice::<Value>(body) {
        Ok(value) => walk(&value, false),
        Err(_) => unreadable(body),
    }
}

/// The answer a refused body gets: a 400 whose body says what the door
/// accepts, in the error shape the clients already read. The refused source is
/// named nowhere in it — the client knows what it sent.
pub(super) fn refusal_response(origin: Option<&[u8]>) -> Vec<u8> {
    let body = serde_json::json!({
        "error": {
            "message": "Media must travel inline in the request, as a data: URI. \
                        This door does not pass a URL or a file on to the engine.",
            "type": "invalid_request_error",
            "code": REFUSED,
        }
    })
    .to_string();
    let origin_headers = crate::cors::origin_headers(origin);
    format!(
        "HTTP/1.1 400 Bad Request\r\n{origin_headers}Content-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

/// Walks the parsed body. Every object is read wherever it sits: a source
/// under one of [`SOURCE_KEYS`] is a source to the engine's parser no matter
/// how the object arrived there. The one rule that needs its surroundings is
/// the url rule — an unknown part is refused for naming a url only inside a
/// `content` array, because anywhere else a `url` is a tool's schema or the
/// arguments a model chose, and neither is a source.
fn walk(value: &Value, part: bool) -> Verdict {
    match value {
        Value::Array(items) => {
            for item in items {
                if walk(item, part) == Verdict::Refused {
                    return Verdict::Refused;
                }
            }
            Verdict::Allowed
        }
        Value::Object(map) => {
            if inspect_sources(map) == Verdict::Refused || (part && names_a_url(map)) {
                return Verdict::Refused;
            }
            for (key, child) in map {
                let child_is_part = key == "content" && child.is_array();
                if walk(child, child_is_part) == Verdict::Refused {
                    return Verdict::Refused;
                }
            }
            Verdict::Allowed
        }
        _ => Verdict::Allowed,
    }
}

/// Every source spelling this object carries, each held to an inline
/// `data:` URI of its own kind.
fn inspect_sources(map: &Map<String, Value>) -> Verdict {
    for key in SOURCE_KEYS {
        let Some(part) = map.get(*key) else { continue };
        let inline = match *key {
            // The image part's source lives in `url`, and a bare string is
            // the Responses dialect's spelling of the same thing.
            "image_url" => source_is_inline(part, IMAGE, true),
            // The audio and video parts read `data`, falling back to `url`
            // when it is absent; only `data` is inline by contract.
            "input_audio" => source_is_inline(part, AUDIO, false),
            "input_video" | "video_url" => source_is_inline(part, VIDEO, false),
            // The Messages dialect wraps the source one level down, and its
            // `source.data` is raw base64: the engine's own converter wraps it
            // in a `data:` URI before loading it, so only `source.url` can
            // name anything to reach for.
            "source" => message_source_is_inline(part),
            _ => true,
        };
        if !inline {
            return Verdict::Refused;
        }
    }
    Verdict::Allowed
}

/// One source value: a bare string, or an object with `url` and/or `data`.
/// `url_allowed` is false where the engine's own parser would prefer `data`
/// and the door does not have to accept the fallback — the clients send the
/// inline spelling, and a spelling the door does not need is one it should not
/// guess about. A value with no source shape at all (a number, an empty
/// object) names nothing for the engine to load.
fn source_is_inline(value: &Value, family: &str, url_allowed: bool) -> bool {
    match value {
        Value::String(text) => inline_base64(text, family),
        Value::Object(map) => {
            if let Some(url) = map.get("url") {
                let inline = url.as_str().is_some_and(|url| inline_base64(url, family));
                if !url_allowed || !inline {
                    return false;
                }
            }
            if let Some(data) = map.get("data") {
                if !data.as_str().is_some_and(|data| inline_base64(data, family)) {
                    return false;
                }
            }
            true
        }
        _ => true,
    }
}

/// The Messages dialect's `source` object. Its `url` is the one field the
/// engine's converter hands to the downloader; its `data` is raw base64.
fn message_source_is_inline(source: &Value) -> bool {
    let Value::Object(map) = source else {
        return true;
    };
    match map.get("url") {
        None => true,
        Some(Value::String(url)) => [IMAGE, AUDIO, VIDEO]
            .iter()
            .any(|family| inline_base64(url, family)),
        Some(_) => false,
    }
}

/// Whether the whole string is an inline base64 URI of this family — the exact
/// shape the engine decodes: the family prefix, then a header ending in
/// `base64` and the comma that begins the payload.
fn inline_base64(value: &str, family: &str) -> bool {
    let Some(rest) = value.strip_prefix(family) else {
        return false;
    };
    let Some((header, _)) = rest.split_once(',') else {
        return false;
    };
    header.ends_with("base64")
}

/// A part object at the door's own level — inside a `content` array — must not
/// name a url the source rules above did not already account for. The value
/// may be anything: a part type this door has never heard of may well read a
/// source out of a key named `url`, and a url is not something to relay on the
/// chance that nothing reads it.
fn names_a_url(map: &Map<String, Value>) -> bool {
    match map.get("url") {
        None => false,
        Some(Value::String(url)) => !url.starts_with("data:"),
        Some(_) => true,
    }
}

/// The body this door's parser could not read. The engine's JSON reader is
/// more permissive than serde_json — it accepts `NaN` and `Infinity` — so a
/// body that is unreadable here may still be a body to the engine, and one
/// that spells a source is refused rather than relayed on trust. A body in
/// JSON's own shape is where that can happen: a multipart upload or any other
/// binary is not a message, and scanning its bytes for these words would be
/// scanning noise.
fn unreadable(body: &[u8]) -> Verdict {
    if !starts_like_json(body) {
        return Verdict::Allowed;
    }
    if body.contains(&b'\\') || SOURCE_SPELLINGS.iter().any(|spelling| contains(body, spelling)) {
        return Verdict::Refused;
    }
    Verdict::Allowed
}

/// The spellings a source can wear for a parser more permissive than this
/// door's. A backslash is one of them on purpose: an escape is how a spelling
/// hides from a byte scan, so `image\u005furl` and `h\u0074tp://` are refused
/// as the escapes they are.
const SOURCE_SPELLINGS: &[&[u8]] = &[
    b"image_url",
    b"input_audio",
    b"input_video",
    b"video_url",
    b"\"url\"",
    b"http:",
    b"file:",
];

/// Whether the body's first meaningful byte puts it in the JSON shape the
/// engine's media loader runs on. A leading UTF-8 BOM counts, because the
/// engine tolerates one and this door's parser does not.
fn starts_like_json(body: &[u8]) -> bool {
    let body = body.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(body);
    matches!(
        body.iter().find(|byte| !byte.is_ascii_whitespace()),
        Some(b'{') | Some(b'[')
    )
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|window| window == needle)
}
