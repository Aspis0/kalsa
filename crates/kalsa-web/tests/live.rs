//! The two calls that need the internet. Ignored by default: `cargo test`
//! must pass on a machine with no connection and no wish to use one.
//!
//! Run them on purpose: `cargo test -p kalsa-web --test live -- --ignored`.

use std::sync::atomic::AtomicBool;

#[test]
#[ignore = "needs the internet; run with --ignored"]
fn a_real_search_answers_with_results() {
    let text = kalsa_web::search("rust async closures", &AtomicBool::new(false)).expect("the search answered");
    assert!(text.contains("URL: https://"), "no urls in:\n{text}");
}

#[test]
#[ignore = "needs the internet; run with --ignored"]
fn a_real_page_reads_as_text() {
    let text = kalsa_web::fetch("https://example.com/", &AtomicBool::new(false)).expect("the page was fetched");
    assert!(text.contains("Example Domain"), "unexpected text:\n{text}");
}

/// The Critical, end to end: a name that resolves to this machine must fail
/// without a request being sent to it. `127.0.0.1.nip.io` and
/// `127.0.0.1.sslip.io` answer with 127.0.0.1, and both pass every spelling
/// rule the gate has — the URL looks like an ordinary public page.
#[test]
#[ignore = "needs the internet (to resolve); run with --ignored"]
fn a_name_that_resolves_inward_is_refused() {
    for url in [
        "http://127.0.0.1.nip.io:8130/v1/models",
        "http://127-0-0-1.sslip.io:8130/v1/models",
    ] {
        let error = kalsa_web::fetch(url, &AtomicBool::new(false))
            .expect_err("loopback must not be reachable through a name");
        assert!(matches!(error, kalsa_web::WebError::Refused), "{url} gave {error:?}");
    }
}

#[test]
#[ignore = "needs the internet; run with --ignored"]
fn a_stopped_call_does_not_run() {
    use std::sync::atomic::AtomicBool;
    let stopped = AtomicBool::new(true);
    assert!(matches!(
        kalsa_web::search("rust", &stopped),
        Err(kalsa_web::WebError::Stopped)
    ));
    assert!(matches!(
        kalsa_web::fetch("https://example.com/", &stopped),
        Err(kalsa_web::WebError::Stopped)
    ));
}
