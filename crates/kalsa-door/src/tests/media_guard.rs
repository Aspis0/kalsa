//! The media guard's own cases, one body each: what the door admits, what it
//! refuses, and what it leaves to the engine. The guard is a pure decision over
//! bytes, so each case here is a body and a verdict; how a refusal travels
//! through the door is `tests::media`'s subject.

use crate::media::{inspect, refusal_response, Refusal, Verdict};

fn verdict(body: &str) -> Verdict {
    inspect(body.as_bytes())
}

fn allowed(body: &str) -> bool {
    verdict(body) == Verdict::Allowed
}

fn refused(body: &str, refusal: Refusal) -> bool {
    verdict(body) == Verdict::Refused(refusal)
}

fn base64_payload(seed: &str, bytes: usize) -> String {
    // The alphabet has no backslash and no quote, so a generated payload
    // cannot hide a spelling the guard would otherwise scan for.
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut payload = String::with_capacity(bytes);
    for index in 0..bytes {
        payload.push(alphabet[(index + seed.len()) % alphabet.len()] as char);
    }
    payload
}

fn image(url: &str) -> String {
    format!(
        "{{\"messages\":[{{\"role\":\"user\",\"content\":[\
         {{\"type\":\"text\",\"text\":\"what is this\"}},\
         {{\"type\":\"image_url\",\"image_url\":{{\"url\":\"{url}\"}}}}]}}]}}"
    )
}

/// The one form the door admits, in every spelling the clients use: an
/// image part, a bare string under the Responses dialect's key, the audio
/// part, and a plain text conversation.
#[test]
fn inline_media_passes() {
    assert!(allowed(&image("data:image/jpeg;base64,/9j/4AAQSkZJRg")));
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":"a plain string"}]}"#
    ));
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"text","text":"see http://example.com/x now"},{"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}]}]}"#
    ));
    assert!(allowed(
        r#"{"input":[{"content":[{"type":"input_image","image_url":"data:image/png;base64,iVBORw0KGgo="}]}]}"#
    ));
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"data:audio/wav;base64,UklGRg==","format":"wav"}}]}]}"#
    ));
    // The Messages dialect's inline spellings: a wrapped url, and the raw
    // base64 the engine's own converter wraps before loading.
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"image","source":{"type":"url","url":"data:image/jpeg;base64,/9j/4A=="}}]}]}"#
    ));
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"image/jpeg","data":"/9j/4AAQSkZJRg"}}]}]}"#
    ));
}

/// Every source form the engine would reach for itself, refused wherever
/// it sits: the chat dialect, the bare strings, the audio part, the
/// Messages dialect, and a source split across a JSON escape.
#[test]
fn a_named_source_is_refused() {
    let sources = [
        "http://169.254.169.254/latest/meta-data/",
        "https://example.com/pixel.png",
        "file:///etc/passwd",
        "ftp://example.com/a.png",
        "//example.com/a.png",
        "/etc/passwd",
        "rawbase64notauri",
        "data:text/html;base64,PHNjcmlwdD4=",
        "data:image/svg+xml,<svg/>",
    ];
    for source in sources {
        assert!(
            refused(&image(source), Refusal::Source),
            "an image source was relayed: {source}"
        );
        assert!(
            refused(
                &format!(
                    "{{\"messages\":[{{\"role\":\"user\",\"content\":[{{\"type\":\"image_url\",\"image_url\":\"{source}\"}}]}}]}}"
                ),
                Refusal::Source
            ),
            "a bare-string image source was relayed: {source}"
        );
    }
    // A part of the other dialects, and the fields the engine prefers.
    for body in [
        r#"{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"http://example.com/a.wav"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"data:audio/wav;base64,UklGRg==","url":"http://example.com/a.wav"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"image","source":{"type":"url","url":"https://example.com/a.png"}}]}]}"#,
        r#"{"input":[{"content":[{"type":"input_image","image_url":"https://example.com/a.png"}]}]}"#,
        r#"{"image_url":{"url":"http://example.com/a.png"}}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"image_url","image\u005furl":{"url":"http://example.com/a.png"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"future_media","url":"https://example.com/a.png"}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"future_media","url":{"url":"https://example.com/a.png"}}]}]}"#,
    ] {
        assert!(
            refused(body, Refusal::Source),
            "a source was relayed: {body}"
        );
    }
}

/// Video is refused whole, whatever it is dressed as and wherever it sits.
/// The engine would not decode it itself: it hands the bytes to whatever
/// `ffmpeg`/`ffprobe` is on PATH.
#[test]
fn video_is_refused_whole() {
    for body in [
        // The chat dialect's video part, in either spelling, with data or url.
        r#"{"messages":[{"role":"user","content":[{"type":"input_video","input_video":{"data":"data:video/mp4;base64,AAAAIGZ0eXA="}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"input_video","input_video":{"url":"http://example.com/a.mp4"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"video_url","video_url":{"url":"data:video/mp4;base64,AAAAIGZ0eXA="}}]}]}"#,
        // The key alone is the part: what it holds is never read.
        r#"{"input_video":null}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"text","text":"hi","video_url":{}}]}]}"#,
        // A video's bytes are refused wherever they are, not only under the
        // video keys: any position, any part type, any string.
        r#"{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:video/mp4;base64,AAAAIGZ0eXA="}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"data:video/mp4;base64,AAAAIGZ0eXA="}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"text","text":"data:video/mp4;base64,AAAA"}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"image","source":{"type":"url","url":"data:video/mp4;base64,AAAA"}}]}]}"#,
        // The Messages dialect names the medium beside raw base64, and the
        // engine's own converter turns it into the data URI above.
        r#"{"messages":[{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"video/mp4","data":"AAAAIGZ0eXA="}}]}]}"#,
    ] {
        assert!(
            refused(body, Refusal::Kind),
            "a video part was not refused as one: {body}"
        );
    }
    // Audio is not video: it stays admitted inline, under its own key and
    // under the Messages dialect's wrapped source.
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"data:audio/wav;base64,UklGRg=="}}]}]}"#
    ));
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"image","source":{"type":"base64","media_type":"audio/wav","data":"UklGRg=="}}]}]}"#
    ));
}

/// Mixed content is decided by its worst part: one inline image passes
/// beside a text part, and the same conversation with one named source is
/// refused whole. Nested messages are reached at any depth.
#[test]
fn mixed_and_nested_parts_are_all_read() {
    assert!(refused(
        r#"{"messages":[
            {"role":"system","content":"you are a helper"},
            {"role":"user","content":[
                {"type":"text","text":"look"},
                {"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}]},
            {"role":"user","content":[
                {"type":"image_url","image_url":{"url":"http://example.com/a.png"}}]}]}"#,
        Refusal::Source
    ));
    assert!(refused(
        r#"{"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}],
            "tools":[{"type":"function","function":{"parameters":{"properties":{}}}}],
            "input":[{"content":[{"content":[{"type":"image_url","image_url":{"url":"https://example.com/a.png"}}]}]}]}"#,
        Refusal::Source
    ));
}

/// A tool's definition and the arguments a model chose are not media: a
/// url schema property, an example, and an object-form argument all pass,
/// because none of them is a content part.
#[test]
fn tool_shapes_are_not_media_parts() {
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":"fetch it"}],
            "tools":[{"type":"function","function":{"name":"web_fetch","parameters":{
                "type":"object",
                "properties":{"url":{"type":"string","description":"an address"},
                              "image_url":{"type":"string"}},
                "examples":[{"url":"https://example.com/a"}],
                "required":["url"]}}}]}"#
    ));
    assert!(allowed(
        r#"{"messages":[{"role":"assistant","content":"","tool_calls":[
            {"id":"1","type":"function","function":{"name":"web_fetch","arguments":{"url":"https://example.com/a"}}}]}]}"#
    ));
}

/// A body this door's parser cannot read keeps the answer it always had —
/// the engine's own 400 — unless it still spells a source or a video part,
/// which a more permissive parser than this one's could still read out of it.
#[test]
fn an_unreadable_body_is_refused_only_when_it_spells_a_source() {
    assert!(allowed(r#"{"messages":[{"role":"user","content":"truncated"#));
    assert!(allowed("not json at all"));
    assert!(allowed(""));
    assert!(allowed("--boundary\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\n"));
    assert!(refused(
        r#"{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"http://example.com/a.png"}}]}],"temperature":NaN}"#,
        Refusal::Source
    ));
    assert!(refused(
        r#"{"messages":[{"role":"user","content":[{"type":"image\u005furl","image_url":{"url":"h\u0074tp://example.com/a.png"}}]}],"temperature":NaN}"#,
        Refusal::Source
    ));
    assert!(refused(
        r#"{"messages":[{"role":"user","content":[{"type":"input_video","input_video":{"data":"data:video/mp4;base64,AAAA"}}]}],"temperature":NaN}"#,
        Refusal::Kind
    ));
}

/// The cap the head parser enforces is what bounds a base64 payload, and a
/// large inline image under it passes: the guard reads the body it was
/// given and allocates nothing beyond it.
#[test]
fn a_large_inline_image_inside_the_cap_passes() {
    let payload = base64_payload("image", 4 * 1024 * 1024);
    let body = format!(
        "{{\"messages\":[{{\"role\":\"user\",\"content\":[{{\"type\":\"image_url\",\"image_url\":{{\"url\":\"data:image/jpeg;base64,{payload}\"}}}}]}}]}}"
    );
    assert!(body.len() > 4 * 1024 * 1024 && body.len() < 16 * 1024 * 1024);
    assert!(allowed(&body));
}

/// Each refusal names its own rule, in the answer and in the word the proxy
/// logs; neither names the bytes the client sent.
#[test]
fn each_refusal_carries_its_own_code() {
    assert_eq!(Refusal::Source.audit_reason(), "door.media_source_refused");
    assert_eq!(Refusal::Kind.audit_reason(), "door.media_kind_refused");
    for (refusal, code, words) in [
        (Refusal::Source, "media_source_refused", "inline"),
        (Refusal::Kind, "media_kind_refused", "still frames"),
    ] {
        let response = String::from_utf8(refusal_response(refusal, None)).unwrap();
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"), "{response}");
        let body = response.split_once("\r\n\r\n").unwrap().1;
        let json: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(json["error"]["code"], code);
        assert_eq!(json["error"]["type"], "invalid_request_error");
        assert!(json["error"]["message"].as_str().unwrap().contains(words), "{body}");
        let with_origin =
            String::from_utf8(refusal_response(refusal, Some(b"tauri://localhost"))).unwrap();
        assert!(
            with_origin.contains("Access-Control-Allow-Origin: tauri://localhost\r\n")
                && with_origin.contains("Vary: Origin\r\n"),
            "{with_origin}"
        );
    }
}
