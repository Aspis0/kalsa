//! The carve-out: a genuine CORS preflight is answered before the credential
//! scan, and nothing that is not one takes that path. The answers the door
//! and the upstream send back are held to their own rule in `cors_answers`.

use super::support::*;
use super::*;

#[test]
fn a_preflight_is_answered_before_authentication_and_reaches_no_upstream() {
    let upstream = RecordingUpstream::start();
    let (door, address) = door(upstream.port, &[&credential()]);

    let response = exchanged(address, &preflight(ORIGIN));
    let head = response_head(&response);
    assert!(
        response.starts_with(b"HTTP/1.1 204 No Content\r\n"),
        "the preflight was not answered with 204: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(allowed_origins(&response), vec![ORIGIN.to_string()]);
    assert_eq!(
        header_values(head, "access-control-allow-methods"),
        vec!["POST, OPTIONS".to_string()]
    );
    assert_eq!(
        header_values(head, "access-control-allow-headers"),
        vec!["Authorization, Content-Type".to_string()]
    );
    assert!(
        !header_values(head, "access-control-max-age").is_empty(),
        "the preflight names no cache lifetime: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(
        header_values(head, "vary"),
        vec!["Origin".to_string()],
        "an answer that depends on the origin must say so"
    );
    assert_eq!(header_values(head, "content-length"), vec!["0".to_string()]);
    assert_eq!(header_values(head, "connection"), vec!["close".to_string()]);
    assert!(
        door.active_devices().is_empty(),
        "a preflight was counted as an active device"
    );
    no_upstream_connection(&upstream);
    door.shutdown();
}

#[test]
fn a_preflight_from_an_origin_the_desktop_cannot_have_is_told_nothing() {
    let upstream = RecordingUpstream::start();
    let (door, address) = door(upstream.port, &[&credential()]);

    let response = exchanged(address, &preflight("https://evil.example"));
    assert!(
        response.starts_with(b"HTTP/1.1 204 No Content\r\n"),
        "a preflight is answered, whatever the origin: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(
        allowed_origins(&response).is_empty(),
        "the door reflected an origin the desktop cannot have: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(
        header_values(response_head(&response), "vary"),
        vec!["Origin".to_string()]
    );
    no_upstream_connection(&upstream);
    door.shutdown();
}

#[test]
fn an_options_that_is_not_a_preflight_is_still_refused() {
    let upstream = RecordingUpstream::start();
    let (door, address) = door(upstream.port, &[&credential()]);

    let bare = "OPTIONS /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
                Connection: close\r\n\r\n";
    let response = exchanged(address, bare);
    assert!(
        response.starts_with(b"HTTP/1.1 401 Unauthorized\r\n"),
        "an OPTIONS with no Origin and no requested method is not a preflight: {}",
        String::from_utf8_lossy(&response)
    );
    assert!(allowed_origins(&response).is_empty());

    // An `Origin` alone is not a preflight either: a browser always names
    // the method it is about to use.
    let half = "OPTIONS /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
                Origin: tauri://localhost\r\nConnection: close\r\n\r\n";
    let response = exchanged(address, half);
    assert!(
        response.starts_with(b"HTTP/1.1 401 Unauthorized\r\n"),
        "an OPTIONS with an Origin but no requested method is not a preflight: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(
        allowed_origins(&response),
        vec![ORIGIN.to_string()],
        "the refusal a browser reads must name its origin"
    );
    no_upstream_connection(&upstream);
    door.shutdown();
}

#[test]
fn a_preflight_with_a_body_is_answered_and_the_body_goes_nowhere() {
    let upstream = RecordingUpstream::start();
    let (door, address) = door(upstream.port, &[&credential()]);

    // A browser sends no body with a preflight. The answer is still the 204,
    // and the bytes after the blank line are neither read as a request of
    // their own nor left in the socket for the close to reset away.
    let request = format!(
        "OPTIONS /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n\
         Access-Control-Request-Method: POST\r\nContent-Length: 5\r\n\
         Connection: close\r\n\r\nhello"
    );
    let response = exchanged(address, &request);
    let text = String::from_utf8_lossy(&response);
    assert!(
        text.starts_with("HTTP/1.1 204 No Content\r\n"),
        "the preflight with a body was not answered: {text}"
    );
    assert_origin_aware(&response, Some(ORIGIN), "the preflight answer");
    assert_eq!(
        text.matches("HTTP/1.1 ").count(),
        1,
        "the body was read as a second request: {text}"
    );
    no_upstream_connection(&upstream);
    door.shutdown();
}

#[test]
fn a_duplicated_origin_is_not_a_preflight_and_is_not_reflected() {
    let upstream = RecordingUpstream::start();
    let (door, address) = door(upstream.port, &[&credential()]);

    // Two copies of the one header the door reflects: an ambiguity, not an
    // origin, so this is not the preflight it looks like and the refusal
    // names nobody.
    let doubled = format!(
        "OPTIONS /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n\
         Origin: {ORIGIN}\r\nAccess-Control-Request-Method: POST\r\n\
         Connection: close\r\n\r\n"
    );
    let response = exchanged(address, &doubled);
    let text = String::from_utf8_lossy(&response);
    assert!(
        text.starts_with("HTTP/1.1 401 Unauthorized\r\n"),
        "a duplicated Origin was answered as a preflight: {text}"
    );
    assert_origin_aware(&response, None, "the refusal of a duplicated origin");
    no_upstream_connection(&upstream);
    door.shutdown();
}

#[test]
fn a_hostile_requested_method_is_never_echoed() {
    let upstream = RecordingUpstream::start();
    let (door, address) = door(upstream.port, &[&credential()]);

    // The allowed methods are the door's own list, never the client's value.
    // A bare CR in that value is not a header line, and a head the door
    // cannot parse is refused outright.
    for (value, status, expected) in [
        ("DELETE, X-Injected: yes", "HTTP/1.1 204 No Content\r\n", Some(ORIGIN)),
        ("POST\rextra", "HTTP/1.1 401 Unauthorized\r\n", None),
    ] {
        let request = format!(
            "OPTIONS /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n\
             Access-Control-Request-Method: {value}\r\nConnection: close\r\n\r\n"
        );
        let response = exchanged(address, &request);
        let text = String::from_utf8_lossy(&response);
        assert!(
            text.starts_with(status),
            "a hostile requested method changed the answer: {text}"
        );
        assert_origin_aware(&response, expected, "the answer to a hostile method");
        for smuggled in ["X-Injected", "DELETE", "extra"] {
            assert!(
                !text.contains(smuggled),
                "the client's {smuggled} reached the answer: {text}"
            );
        }
        if expected.is_some() {
            assert_eq!(
                header_values(response_head(&response), "access-control-allow-methods"),
                vec!["POST, OPTIONS".to_string()],
                "the preflight answered with something other than the door's list: {text}"
            );
        }
    }
    no_upstream_connection(&upstream);
    door.shutdown();
}
