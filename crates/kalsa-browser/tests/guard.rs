//! What the browser is not allowed to reach, on a real window.
//!
//! The refusal rule is a pure function and is proved over a table in
//! `tests/addresses.rs`. These tests prove the half that cannot be: that a
//! refused request never reaches the network, and that a permitted one does.

mod common;

use kalsa_browser::guard;
use kalsa_browser::landing;
use std::time::Duration;

/// A site that records every request that reaches it, and a browser pointed at
/// it. The window is ours to point anywhere, because the rules are enforced in
/// the route and the test route only opens the address the site is on.
async fn window_on(base: &str, name: &str) -> (playwright_rs::protocol::Playwright, playwright_rs::protocol::Page) {
    let (playwright, _context, page) = common::browser_on(name, base).await;
    (playwright, page)
}

/// The control: a request the rules allow does arrive. Without it, "nothing
/// arrived" could mean the fixture was never reached in the first place.
#[tokio::test]
async fn a_request_that_is_allowed_reaches_the_site() {
    let (base, arrived) = common::serve(&[common::page("<h1>here</h1>")]).await;
    let (_playwright, page) = window_on(&base, "guard-control").await;
    page.goto(&base, None).await.expect("the page loads");
    tokio::time::sleep(Duration::from_millis(400)).await;

    assert!(arrived.asked_for("/"), "the site saw nothing: {:?}", arrived.requests());
}

/// The proof, against a listener that is listening.
///
/// One server, one port. The test route opens one path on it and hands
/// everything else back to the product guard, so the two halves are on the same
/// socket: the allowed path arrives, and the refused one never touches it. A
/// port nothing was listening on would prove nothing — a refused request never
/// gets far enough to notice whether anyone is there.
#[tokio::test]
async fn a_refused_request_never_arrives_at_a_listener_that_is_listening() {
    let (base, arrived) = common::serve(&[common::page("<h1>here</h1>")]).await;
    let (_playwright, _context, page) = common::browser_allowing("guard-refused", &base, "/allowed").await;

    // The control: the path the test route opens, arriving at the listener.
    page.evaluate::<String, ()>(
        r#"async base => { await fetch(base + '/allowed', { mode: 'no-cors' }); }"#,
        Some(&base),
    )
    .await
    .ok();
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(arrived.asked_for("/allowed"), "the allowed request did not arrive: {:?}", arrived.requests());

    // The refusal: the same listener, the same page, a path the guard answers for.
    page.evaluate::<String, ()>(
        r#"async base => { await fetch(base + '/denied', { mode: 'no-cors' }); }"#,
        Some(&base),
    )
    .await
    .ok();
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(!arrived.asked_for("/denied"), "the refused request arrived: {:?}", arrived.requests());
    assert_eq!(arrived.requests().len(), 1, "only the allowed request arrived: {:?}", arrived.requests());
}

/// A direct navigation to a refused address is stopped before it leaves, against
/// a listener that is listening. This is the control for what follows: the same
/// address, reached the same way a person would reach it, does not arrive.
#[tokio::test]
async fn a_direct_navigation_to_a_refused_address_never_arrives() {
    let (base, arrived) = common::serve(&[common::page("<h1>here</h1>")]).await;
    let (_playwright, _context, page) = common::browser_allowing("guard-direct", &base, "/open").await;

    let refused = page.goto(&format!("{base}/denied"), None).await;
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(refused.is_err(), "the navigation must not succeed");
    assert!(!arrived.asked_for("/denied"), "it arrived: {:?}", arrived.requests());
}

/// **A known gap, proved rather than asserted away.** In this stack a redirect
/// followed within a navigation is never offered to a route handler: the first
/// hop is judged, and the second is not. A site can therefore answer with a
/// `302` to this computer's own network and the browser will follow it.
///
/// What is left is smaller but real: the landing check refuses to read a page we
/// ended up on, so the model is never shown what a redirected page says. It does
/// not unmake the request, and this test says so rather than pretending the
/// second hop never arrived.
#[tokio::test]
async fn a_redirect_is_judged_after_it_happens_and_the_page_is_not_read() {
    let (base, arrived) = common::serve(&[common::page("<h1>here</h1>"), common::redirect_here("/secret")]).await;
    let (_playwright, _context, page) = common::browser_allowing("guard-redirect", &base, "/go").await;

    let followed = page.goto(&format!("{base}/go"), None).await;
    tokio::time::sleep(Duration::from_millis(600)).await;

    assert!(arrived.asked_for("/go"), "the first hop is judged and allowed: {:?}", arrived.requests());
    assert!(followed.is_err() || page.url().ends_with("/secret"), "the redirect was not followed, it is on {}", page.url());

    // The second hop is judged where the address is known — after the fact, and
    // by the same function every read goes through.
    let refusal = landing::Landings::new().refused(&page.url()).await;
    assert!(refusal.is_some(), "the address we landed on is refused: {}", page.url());
    assert!(
        !arrived.asked_for("/secret") || refusal.is_some(),
        "either the hop never happened, or we noticed where it went"
    );
}

/// The rule is the same whether the address was navigated to or loaded, because
/// the same function answers both.
#[tokio::test]
async fn the_same_address_is_refused_whether_it_was_navigated_to_or_loaded() {
    for address in [
        "http://127.0.0.1:9/",
        "http://192.168.0.1/",
        "http://[::1]:9/",
        "http://169.254.169.254/latest/meta-data/",
        "http://router.local/",
    ] {
        assert!(matches!(guard::verdict(address), guard::Verdict::Refused(_)), "{address}");
    }
}

/// The rules are read before any resolver is asked, so a refused address costs
/// nothing and cannot be talked round by a name that answers.
#[tokio::test]
async fn an_address_refused_on_its_own_never_reaches_the_network() {
    let (base, arrived) = common::serve(&[common::page("<h1>here</h1>")]).await;
    let (_playwright, page) = window_on(&base, "guard-literal").await;
    page.goto(&base, None).await.expect("the page loads");
    // **The icon is not a request this test made.** Chromium fetches a tab's
    // `/favicon.ico` whenever it gets round to it, from no navigation here, so
    // it is left out of the count rather than waited for.
    let allowed = arrived.except_icons();

    for address in ["http://100.64.0.1/", "http://127.0.0.1:9/", "http://localhost./"] {
        assert!(page.goto(address, None).await.is_err(), "{address} loaded");
    }
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(arrived.except_icons(), allowed, "nothing extra arrived: {:?}", arrived.requests());
}