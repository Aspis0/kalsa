//! The media guard's own cases, one body each: what the door admits, what it
//! refuses, and what it leaves to the engine. The guard is a pure decision over
//! bytes, so each case here is a body and a verdict; how a refusal travels
//! through the door is `tests::media`'s subject.

use crate::media::{inspect, refusal_response, Verdict};

fn allowed(body: &str) -> bool {
    inspect(body.as_bytes()) == Verdict::Allowed
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
/// and video parts, and a plain text conversation.
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
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"input_video","input_video":{"data":"data:video/mp4;base64,AAAAIGZ0eXA="}}]}]}"#
    ));
    assert!(allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"video_url","video_url":{"data":"data:video/mp4;base64,AAAAIGZ0eXA="}}]}]}"#
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
/// it sits: the chat dialect, the bare strings, the audio and video
/// parts, the Messages dialect, and a source split across a JSON escape.
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
            !allowed(&image(source)),
            "an image source was relayed: {source}"
        );
        assert!(
            !allowed(&format!(
                "{{\"messages\":[{{\"role\":\"user\",\"content\":[{{\"type\":\"image_url\",\"image_url\":\"{source}\"}}]}}]}}"
            )),
            "a bare-string image source was relayed: {source}"
        );
    }
    // A part of the other dialects, and the fields the engine prefers.
    for body in [
        r#"{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"http://example.com/a.wav"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"input_audio","input_audio":{"data":"data:audio/wav;base64,UklGRg==","url":"http://example.com/a.wav"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"input_video","input_video":{"url":"data:video/mp4;base64,AAAA"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"video_url","video_url":{"url":"file:///tmp/a.mp4"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"image","source":{"type":"url","url":"https://example.com/a.png"}}]}]}"#,
        r#"{"input":[{"content":[{"type":"input_image","image_url":"https://example.com/a.png"}]}]}"#,
        r#"{"image_url":{"url":"http://example.com/a.png"}}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"image_url","image\u005furl":{"url":"http://example.com/a.png"}}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"future_media","url":"https://example.com/a.png"}]}]}"#,
        r#"{"messages":[{"role":"user","content":[{"type":"future_media","url":{"url":"https://example.com/a.png"}}]}]}"#,
    ] {
        assert!(!allowed(body), "a source was relayed: {body}");
    }
}

/// Mixed content is decided by its worst part: one inline image passes
/// beside a text part, and the same conversation with one named source is
/// refused whole. Nested messages are reached at any depth.
#[test]
fn mixed_and_nested_parts_are_all_read() {
    assert!(!allowed(
        r#"{"messages":[
            {"role":"system","content":"you are a helper"},
            {"role":"user","content":[
                {"type":"text","text":"look"},
                {"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgo="}}]},
            {"role":"user","content":[
                {"type":"image_url","image_url":{"url":"http://example.com/a.png"}}]}]}"#
    ));
    assert!(!allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}],
            "tools":[{"type":"function","function":{"parameters":{"properties":{}}}}],
            "input":[{"content":[{"content":[{"type":"image_url","image_url":{"url":"https://example.com/a.png"}}]}]}]}"#
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
/// the engine's own 400 — unless it still spells a source, which a more
/// permissive parser than this one's could still read out of it.
#[test]
fn an_unreadable_body_is_refused_only_when_it_spells_a_source() {
    assert!(allowed(r#"{"messages":[{"role":"user","content":"truncated"#));
    assert!(allowed("not json at all"));
    assert!(allowed(""));
    assert!(allowed("--boundary\r\nContent-Disposition: form-data; name=\"file\"\r\n\r\n"));
    assert!(!allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"image_url","image_url":{"url":"http://example.com/a.png"}}]}],"temperature":NaN}"#
    ));
    assert!(!allowed(
        r#"{"messages":[{"role":"user","content":[{"type":"image\u005furl","image_url":{"url":"h\u0074tp://example.com/a.png"}}]}],"temperature":NaN}"#
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

/// The refusal names the rule and never the source, in the answer and in
/// the audit word the proxy logs.
#[test]
fn the_refusal_carries_the_code_and_no_source() {
    let response = String::from_utf8(refusal_response(None)).unwrap();
    assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"), "{response}");
    let body = response.split_once("\r\n\r\n").unwrap().1;
    let json: serde_json::Value = serde_json::from_str(body).unwrap();
    assert_eq!(json["error"]["code"], "media_source_refused");
    assert_eq!(json["error"]["type"], "invalid_request_error");
    assert!(json["error"]["message"].as_str().unwrap().contains("inline"));
    let with_origin =
        String::from_utf8(refusal_response(Some(b"tauri://localhost"))).unwrap();
    assert!(
        with_origin.contains("Access-Control-Allow-Origin: tauri://localhost\r\n")
            && with_origin.contains("Vary: Origin\r\n"),
        "{with_origin}"
    );
}
