//! The browser's side of the door: the CORS preflight, and the one header the
//! door's own answers need for the webview to be able to read them.
//!
//! The desktop frontend is a webview, so its chat POST is a cross-origin
//! request: `Content-Type: application/json` and a bearer credential each
//! force a preflight, and a browser sends that preflight with NO
//! `Authorization` header. Answered by the credential scan it would be a
//! `401`, and the POST would never be sent. The preflight is answered before
//! the scan, therefore — it carries no credential and no data, so answering
//! it grants nothing.

/// The origins the desktop webview can have: exactly one. Tauri serves the
/// bundled frontend through its own scheme, and `src-tauri/tauri.conf.json`
/// declares no `devUrl`, so a dev build loads that same scheme rather than a
/// `localhost` dev server. The comparison is byte for byte: an origin that
/// merely starts with an allowed one, or spells it in different case, is a
/// different origin. A second entry is the one-line change if the app ever
/// gains a real dev server or a build for a platform with another scheme.
const ORIGINS: &[&str] = &["tauri://localhost"];

/// How long a browser may reuse one preflight answer. The permissions cannot
/// change while the door runs, and every preflight is a round trip paid for on
/// a road that carries no answer.
const MAX_AGE_SECONDS: u64 = 600;

/// The two headers of an answer whose content depends on the origin: the
/// permission line, reflected only for an allowlisted origin, and
/// `Vary: Origin`. They travel together on every such answer — including the
/// ones that grant nothing, and including the answer to a request that named
/// no origin at all: a cache in front of the door must never hand one origin
/// an answer computed for another. Never `*`: the request this permits
/// carries a credential.
pub(super) fn origin_headers(origin: Option<&[u8]>) -> String {
    let allowed = origin.and_then(|origin| ORIGINS.iter().find(|allowed| allowed.as_bytes() == origin));
    match allowed {
        Some(allowed) => format!("Access-Control-Allow-Origin: {allowed}\r\nVary: Origin\r\n"),
        None => String::from("Vary: Origin\r\n"),
    }
}

/// The answer to a genuine preflight. An origin the desktop cannot have is
/// answered with no permission rather than with a refusal: the answer grants
/// nothing either way, so the carve-out must not become an authenticator that
/// tells a stranger which origins are known.
pub(super) fn preflight(origin: Option<&[u8]>) -> Vec<u8> {
    format!(
        "HTTP/1.1 204 No Content\r\n{}\
         Access-Control-Allow-Methods: POST, OPTIONS\r\n\
         Access-Control-Allow-Headers: Authorization, Content-Type\r\n\
         Access-Control-Max-Age: {MAX_AGE_SECONDS}\r\n\
         Content-Length: 0\r\n\
         Connection: close\r\n\r\n",
        origin_headers(origin)
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::{origin_headers, preflight, ORIGINS};

    /// The list is the app's, not the request's: an origin is reflected only
    /// in the exact spelling the webview sends, so a name that resembles an
    /// allowed one is a different origin.
    #[test]
    fn only_the_webviews_own_origin_is_ever_reflected() {
        assert_eq!(ORIGINS, &["tauri://localhost"]);
        let reflected = |origin: &str| {
            origin_headers(Some(origin.as_bytes())).contains("Access-Control-Allow-Origin")
        };
        assert!(reflected("tauri://localhost"));
        for stranger in [
            "tauri://localhost.evil.example",
            "tauri://localhost/",
            "tauri://localhost ",
            "TAURI://localhost",
            "http://tauri.localhost",
            "http://localhost:5173",
            "https://localhost",
            "null",
            "",
        ] {
            assert!(
                !reflected(stranger),
                "{stranger} was reflected as the webview's origin"
            );
        }
        assert_eq!(origin_headers(None), "Vary: Origin\r\n", "no origin, no permission");
    }

    /// The vary is on the answer, not on the origin: every answer that can
    /// name one says so, and says it exactly once.
    #[test]
    fn every_origin_dependent_answer_says_it_varies_by_origin() {
        for origin in [
            None,
            Some(&b"tauri://localhost"[..]),
            Some(&b"https://evil.example"[..]),
        ] {
            let headers = origin_headers(origin);
            assert_eq!(
                headers.matches("Vary: Origin\r\n").count(),
                1,
                "{headers:?} does not vary by origin exactly once"
            );
        }
    }

    /// The preflight answer is complete or it is nothing: every permission the
    /// chat POST needs, and a body that says it is empty.
    #[test]
    fn the_preflight_answer_names_the_permissions_and_the_origin() {
        let answer = String::from_utf8(preflight(Some(b"tauri://localhost"))).unwrap();
        assert!(answer.starts_with("HTTP/1.1 204 No Content\r\n"));
        assert!(answer.contains("Access-Control-Allow-Origin: tauri://localhost\r\n"));
        assert!(answer.contains("Access-Control-Allow-Methods: POST, OPTIONS\r\n"));
        assert!(answer.contains("Access-Control-Allow-Headers: Authorization, Content-Type\r\n"));
        assert!(answer.contains("Access-Control-Max-Age: 600\r\n"));
        assert!(answer.contains("Vary: Origin\r\n"));
        assert!(answer.contains("Content-Length: 0\r\n"));
        assert!(answer.ends_with("Connection: close\r\n\r\n"));
        assert!(!answer.contains('*'), "a credentialed request may not be told `*`");

        let foreign = String::from_utf8(preflight(Some(b"https://evil.example"))).unwrap();
        assert!(!foreign.to_ascii_lowercase().contains("access-control-allow-origin"));
        assert!(foreign.contains("Vary: Origin\r\n"), "the answer still varies on it");
    }
}
