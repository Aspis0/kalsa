//! `/props` through the door: the engine's answer names this machine's model
//! path, and a paired device must never see it — it gets every other field,
//! or an error. Never the raw bytes.

use super::support::*;
use super::*;

const MODEL_PATH: &str =
    "/Users/marco/Library/Application Support/kalsa-brain/runtime/models/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf";

fn props_json() -> String {
    serde_json::json!({
        "model_path": MODEL_PATH,
        "n_ctx": 65_536,
        "chat_template": "{{ user }}",
        "default_generation_settings": { "n_ctx": 65_536, "params": { "temp": 0.1 } },
    })
    .to_string()
}

fn props_request(token: &str) -> String {
    format!(
        "GET /props HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n\
         Authorization: Bearer {token}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
    )
}

/// The whole answer a device gets: `model_path` gone, everything else —
/// flat and nested — intact. Both framings the engine can answer with,
/// because the door reads both or it reads neither.
#[test]
fn a_props_answer_reaches_the_device_without_the_model_path() {
    for chunked in [false, true] {
        let (port, stop, upstream) = json_upstream(props_json(), chunked);
        let token = credential();
        let (door, address) = door(port, &[&token]);
        let response = exchanged(address, &props_request(&token));
        let case = if chunked { "chunked" } else { "content-length" };

        assert!(
            response.starts_with(b"HTTP/1.1 200 OK\r\n"),
            "{case}: the device was not served: {}",
            String::from_utf8_lossy(&response)
        );
        let json: serde_json::Value =
            serde_json::from_slice(response_body(&response)).expect("still JSON");
        assert!(
            json.get("model_path").is_none(),
            "{case}: the model path reached the device: {json}"
        );
        assert_eq!(
            json.get("n_ctx").and_then(serde_json::Value::as_u64),
            Some(65_536),
            "{case}: n_ctx did not survive: {json}"
        );
        assert_eq!(
            json["default_generation_settings"]["params"]["temp"].as_f64(),
            Some(0.1),
            "{case}: a nested field did not survive: {json}"
        );
        assert!(
            !String::from_utf8_lossy(response_body(&response)).contains(MODEL_PATH),
            "{case}: the path is in the body by any spelling"
        );
        // The rewritten body is close-delimited with its own framing gone,
        // and the head still says it varies by origin.
        assert!(
            header_values(response_head(&response), "content-length").is_empty(),
            "{case}: the stale length was left on a rewritten body"
        );
        assert_origin_aware(&response, Some(ORIGIN), case);

        stop.store(true, Ordering::SeqCst);
        let _ = upstream.join();
        door.shutdown();
    }
}

/// A body the door cannot rewrite is answered with an error, not relayed:
/// the path in it is a leak, and leaking is worse than a failed /props.
#[test]
fn a_props_body_that_is_not_json_is_refused_not_relayed() {
    let (port, stop, upstream) =
        json_upstream(format!("model_path={MODEL_PATH}"), false);
    let token = credential();
    let (door, address) = door(port, &[&token]);
    let response = exchanged(address, &props_request(&token));
    let text = String::from_utf8_lossy(&response);
    assert!(
        text.starts_with("HTTP/1.1 502"),
        "the unparseable answer was not refused with the upstream failure: {text}"
    );
    assert!(
        !text.contains(MODEL_PATH),
        "the raw body was relayed with the path in it: {text}"
    );

    stop.store(true, Ordering::SeqCst);
    let _ = upstream.join();
    door.shutdown();
}
