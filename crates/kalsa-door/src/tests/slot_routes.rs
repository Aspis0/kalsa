//! The engine's own slot routes at the door. They address a slot by URL and
//! never consult `X-Kalsa-Slot`, so the door refuses them itself — after the
//! credential, before any lease — rather than leaning on an engine-side check
//! to keep two devices apart.
//!
//! The spellings below are the engine's decoder's, not this test's invention:
//! `cpp-httplib` decodes `%uXXXX` as well as `%XX` before it compares a path,
//! so `/slots` has many spellings and the door has to refuse all of them.

use super::support::*;
use super::*;

/// The one sentence the refusal carries, exactly as a device reads it.
const SENTENCE: &str =
    "The door assigns each device its slot; the engine's slot routes are not served through it.";

/// Why a spelling is refused. `Engine` is a path the engine really routes to
/// one of the slot routes; `Defence` is refused only because the door refuses
/// a broader set of spellings than the engine routes, so a difference between
/// the two decoders cannot become a bypass.
#[derive(Clone, Copy)]
enum Why {
    Engine,
    Defence,
}

/// The refusal as a device reads it: the status, the sentence, the length
/// PARSED from the head and checked against the body, the close, and the
/// origin headers every answer that can name an origin carries.
fn assert_refused(response: &[u8], case: &str, why: Why) {
    let text = String::from_utf8_lossy(response);
    let refusal = match why {
        Why::Engine => "an engine slot route",
        Why::Defence => "a defence-in-depth spelling",
    };
    assert!(
        text.starts_with("HTTP/1.1 403 Forbidden\r\n"),
        "{case} ({refusal}) was not refused with the door's own 403: {text}"
    );
    let head_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|at| at + 4)
        .unwrap_or_else(|| panic!("{case} has no head terminator: {text}"));
    let (head, body) = response.split_at(head_end);
    assert_eq!(
        body,
        SENTENCE.as_bytes(),
        "{case} does not carry the one sentence: {text}"
    );
    let declarations = header_values(head, "content-length");
    assert_eq!(
        declarations.len(),
        1,
        "{case} declares its length {} times: {text}",
        declarations.len()
    );
    assert_eq!(
        declarations[0].parse::<usize>().unwrap(),
        body.len(),
        "{case} declares a length that is not its body's: {text}"
    );
    assert_eq!(
        header_values(head, "connection"),
        vec!["close".to_string()],
        "{case} does not close its connection: {text}"
    );
    assert_origin_aware(response, Some(ORIGIN), case);
}

/// A request for one route: the webview's origin, the credential when there
/// is one, and nothing else the decision could depend on.
fn slot_request(method: &str, target: &str, token: Option<&str>, extra: &str) -> String {
    let auth = token
        .map(|token| format!("Authorization: Bearer {token}\r\n"))
        .unwrap_or_default();
    format!(
        "{method} {target} HTTP/1.1\r\nHost: localhost\r\nOrigin: {ORIGIN}\r\n{auth}{extra}\
         Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
}

/// Every spelling the door must refuse, with what the refusal rests on. The
/// escapes are the engine's own: `%uXXXX` writes a UTF-16 code point as UTF-8,
/// `%XX` writes one byte, and both are undone before the engine compares.
const REFUSED: &[(&str, &str, &str, Why)] = &[
    ("POST", "/slots/0?action=save", "", Why::Engine),
    ("POST", "/slots/1?action=restore", "", Why::Engine),
    ("POST", "/slots/2?action=erase", "", Why::Engine),
    ("GET", "/slots", "", Why::Engine),
    ("GET", "/slots", "X-Kalsa-Slot: 0\r\n", Why::Engine),
    ("GET", "/slots/", "", Why::Defence),
    ("GET", "/slots?a", "", Why::Engine),
    ("GET", "/slots#a", "", Why::Engine),
    ("DELETE", "/slots/3", "", Why::Defence),
    ("OPTIONS", "/slots/0", "", Why::Defence),
    // The bypass this matcher exists to close: `%uXXXX`, which reaches the
    // engine as `/slots` while a `%XX`-only decoder sees a literal.
    ("GET", "/%u0073%u006c%u006f%u0074%u0073", "", Why::Engine),
    ("GET", "/%73lots", "", Why::Engine),
    ("GET", "/slots%2F0", "", Why::Defence),
    // Refused by the broad clause alone: the engine does not route these.
    ("GET", "/%u002fslots", "", Why::Defence),
    ("GET", "/%2Fslots", "", Why::Defence),
    ("GET", "//slots", "", Why::Defence),
    ("GET", "/./slots", "", Why::Defence),
    ("GET", "/x/../slots", "", Why::Defence),
];

/// Spellings that are not the slot routes and must reach the upstream: the
/// word in a query and in a header, as a prefix, in another segment, with the
/// engine's own literals after it, in absolute form, and as a homoglyph.
const SERVED: &[(&str, &str, &str)] = &[
    ("GET", "/slots;x", ""),
    ("GET", "/SLOTS", ""),
    ("GET", "/slots%3f", ""),
    ("GET", "/slotsy", ""),
    ("GET", "/v1/slots", ""),
    ("GET", "http://x/slots", ""),
    ("GET", "/v1/models?slots=1", ""),
    ("GET", "/v1/models", "Referer: http://localhost/slots/0\r\n"),
    ("GET", "/%73%6c%D0%BE%74%73", ""),
    ("GET", "/%73%6c%u043E%74%73", ""),
];

#[test]
fn every_spelling_of_the_slot_routes_is_refused_whatever_it_asks() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);

    for &(method, target, extra, why) in REFUSED {
        let response = exchanged(address, &slot_request(method, target, Some(&token), extra));
        assert_refused(&response, &format!("{method} {target}"), why);
    }
    // Refused before the lease: every refusal leaves the single slot and the
    // upstream exactly as they were.
    no_upstream_connection(&upstream);
    assert_eq!(upstream.heads().len(), 0, "a refusal forwarded a head");
    door.shutdown();
}

#[test]
fn a_spelling_that_is_not_a_slot_route_is_still_served() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);

    for &(method, target, extra) in SERVED {
        let response = exchanged(address, &slot_request(method, target, Some(&token), extra));
        assert!(
            response.starts_with(b"HTTP/1.1 200 OK"),
            "{method} {target} was refused as a slot route: {}",
            String::from_utf8_lossy(&response)
        );
    }
    assert_eq!(
        upstream.accepts(),
        SERVED.len(),
        "a request that is not a slot route did not reach the upstream"
    );
    door.shutdown();
}

#[test]
fn an_authenticated_get_slots_is_refused_here_and_never_downstream() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);

    let response = exchanged(address, &slot_request("GET", "/slots", Some(&token), ""));
    assert_refused(&response, "an authenticated GET /slots", Why::Engine);

    // The refusal is the door's: no upstream socket was opened for it, so
    // neither the slot report nor any forwarded byte was ever in reach.
    no_upstream_connection(&upstream);
    assert_eq!(upstream.heads().len(), 0, "the refusal forwarded a head");
    door.shutdown();
}

#[test]
fn an_unauthenticated_slot_route_is_told_nothing_but_unauthorized() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);

    let stranger = exchanged(address, &slot_request("GET", "/slots", None, ""));
    assert!(
        stranger.starts_with(b"HTTP/1.1 401 Unauthorized\r\n"),
        "an unauthenticated slot route was not refused as unauthorized: {}",
        String::from_utf8_lossy(&stranger)
    );
    // Byte for byte the answer any other route gives a stranger: the refusal
    // must not tell an unauthenticated caller which routes exist.
    let ordinary = exchanged(
        address,
        &slot_request("POST", "/v1/chat/completions", None, ""),
    );
    assert_eq!(
        stranger, ordinary,
        "the 401 for a slot route differs from the 401 for any other route"
    );
    assert!(
        !String::from_utf8_lossy(&stranger)
            .to_ascii_lowercase()
            .contains("slot"),
        "the 401 names the route it refused: {}",
        String::from_utf8_lossy(&stranger)
    );

    no_upstream_connection(&upstream);
    door.shutdown();
}

#[test]
fn an_ordinary_chat_post_is_still_served() {
    let upstream = RecordingUpstream::start();
    let token = credential();
    let (door, address) = door(upstream.port, &[&token]);

    let response = request(address, Some(&format!("Bearer {token}")));
    assert!(
        response.starts_with(b"HTTP/1.1 200 OK"),
        "an ordinary chat POST was refused: {}",
        String::from_utf8_lossy(&response)
    );
    assert_eq!(
        upstream.accepts(),
        1,
        "the chat POST did not reach the upstream"
    );
    door.shutdown();
}
