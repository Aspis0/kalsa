//! The lifetime's own parts, with no process in sight: the closure of a
//! lifetime once both gates have spoken, the alias strip, and the identity.

use super::*;

/// The samples of a dead child count for nothing: the port was free
/// before the spawn, so a child that died means the answers may have
/// been somebody else's — however good they look.
#[test]
fn the_answers_of_a_dead_child_count_for_nothing() {
    assert_eq!(
        conclude(Ok(vec![9.9]), false, true),
        Err(Refusal::DidNotStart)
    );
    assert_eq!(
        conclude(Err::<Vec<f64>, _>(Refusal::NoUsableAnswer), true, true),
        Err(Refusal::NoUsableAnswer),
        "a refusal the request earned stands when the child is ours"
    );
    assert_eq!(conclude(Ok(vec![7.5]), true, true), Ok(vec![7.5]));
}

/// The identity gate: samples taken while the port serves somebody
/// else's model are somebody else's samples.
#[test]
fn answers_from_a_port_serving_another_model_count_for_nothing() {
    assert_eq!(
        conclude(Ok(vec![99.9]), true, false),
        Err(Refusal::DidNotStart),
        "a fast answer from the wrong server is not our measurement"
    );
}

/// The caller's aliases come off in the two forms the engine's parser
/// actually knows — whole-token lookup, value in the next token — and
/// nothing else moves: an `=`-shaped token is not an alias to this
/// parser, so it is left as it was given.
#[test]
fn the_callers_aliases_are_removed_and_nothing_else() {
    let argv = vec![
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--alias".to_string(),
        "owner-name".to_string(),
        "--model".to_string(),
        "/m.gguf".to_string(),
        "-a".to_string(),
        "short".to_string(),
        "--alias=equals".to_string(),
        "--port".to_string(),
        "8131".to_string(),
    ];
    assert_eq!(
        without_aliases(argv),
        vec![
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--model".to_string(),
            "/m.gguf".to_string(),
            "--alias=equals".to_string(),
            "--port".to_string(),
            "8131".to_string(),
        ]
    );
}

/// No entropy, no panic: the lifetime refuses without spawning.
#[test]
fn a_nonce_that_cannot_be_drawn_is_a_refusal_not_a_panic() {
    assert_eq!(nonce_from(|_| Err::<(), _>("no entropy")), None);
    assert!(nonce_from(|_| Ok::<(), ()>(())).is_some());
}

/// The nonce's shape and freshness — the `kalsa-tune-` prefix, 128
/// bits of hex, and two draws that differ. It does not prove no model
/// on earth is called that; the aliases check proves ours is listed.
#[test]
fn a_nonce_is_unlike_any_model_name() {
    let nonce = fresh_nonce().expect("this machine has entropy");
    assert!(nonce.starts_with("kalsa-tune-"), "{nonce}");
    assert_eq!(nonce.len(), "kalsa-tune-".len() + 32, "{nonce}");
    assert_ne!(
        fresh_nonce().expect("this machine has entropy"),
        nonce,
        "a fresh identity per lifetime"
    );
}

/// A loopback server that answers one request after `delay` with a room
/// ask's timings, the way a slow processor does.
fn slow_engine(delay: Duration) -> SocketAddr {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let addr = listener.local_addr().expect("addr");
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            // The whole request first: closing on unread bytes resets the
            // connection and the client never sees the answer.
            let mut request = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let Ok(read) = stream.read(&mut chunk) else {
                    break;
                };
                request.extend_from_slice(&chunk[..read]);
                let text = String::from_utf8_lossy(&request);
                let Some((head, body)) = text.split_once("\r\n\r\n") else {
                    continue;
                };
                let length = head
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length: ")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if read == 0 || body.len() >= length {
                    break;
                }
            }
            std::thread::sleep(delay);
            let body = r#"{"timings":{"prompt_n":2252,"prompt_per_second":22.7}}"#;
            let _ = write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        }
    });
    addr
}

/// A slow shape is measured, not refused: an answer that takes longer than
/// a decode request is allowed to is still the room ask's rate while it
/// lands inside the room ask's own bound — and a hang past it is refused.
#[test]
fn a_slow_room_ask_is_measured_inside_its_bound_and_refused_past_it() {
    let rate = room_prompt_rate(
        slow_engine(Duration::from_millis(600)),
        Duration::from_secs(5),
    );
    assert_eq!(rate, Ok(22.7));
    let hung = room_prompt_rate(
        slow_engine(Duration::from_secs(3)),
        Duration::from_millis(300),
    );
    assert_eq!(hung, Err(Refusal::NoUsableAnswer));
}

/// The bound the lifetime really uses: the Surface's 99 s prefill fits with
/// room to spare, a decode request's bound would not, and the longest
/// lifetime stays a bounded number.
#[test]
fn the_room_ask_is_given_a_bound_a_slow_processor_fits_in() {
    assert!(ROOM_REQUEST_TIMEOUT >= Duration::from_secs(3 * 99));
    assert!(ROOM_REQUEST_TIMEOUT > REQUEST_TIMEOUT);
    assert_eq!(
        LIFETIME_LIMIT,
        Duration::from_secs(120 + 60 + 300 + 180 + 10)
    );
}
