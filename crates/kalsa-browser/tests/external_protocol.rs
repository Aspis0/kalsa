//! Whether a page can hand an address to another program through us.
//!
//! This is the one refusal that is not made by our route. `mailto:` and `tel:`
//! do not become network requests: Chromium routes them to the operating system,
//! and an app handler is not something a network layer can intercept. So the
//! question this file answers is mechanical and it is answered by running it —
//! **does a navigation to a non-http(s) scheme reach the route at all?**
//!
//! The scheme here is `kalsaprobe:`, deliberately one no machine has a handler
//! for. A registered scheme would prove the same thing and would also open the
//! mail client on whoever's machine ran the test.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// A page whose submit button names an external protocol, in every shape that
/// can reach one: the form's own action, a button's `formaction`, and a link.
const EXTERNAL: &str = r#"
  <form id="f" action="kalsaprobe://from-form"><input name="q" value="x"></form>
  <button id="b" form="f" formaction="kalsaprobe://from-button">go</button>
  <a id="a" href="kalsaprobe://from-link">link</a>
"#;

/// **The finding, pinned so it cannot change by accident.**
///
/// Route interception does not see an external-protocol navigation, in any of
/// the three shapes that can reach one. Chromium hands `mailto:`, `tel:` and the
/// rest to the operating system before anything becomes a network request, so
/// there is no request for our route to refuse — and the guard's refusal of
/// non-http(s) schemes in `input.rs` is therefore the **only** thing standing
/// between a page and a program on this computer.
///
/// There is no launch flag or policy that closes this. Chromium's only related
/// switches are `disable-sandbox-external-protocols`, which does the opposite —
/// it re-allows external protocols from sandboxed iframes — and the
/// `SandboxExternalProtocolBlocked` policy, which applies only inside a
/// sandboxed iframe and does nothing for a top-level navigation. That is why
/// `input.rs` computes the submitter the browser would really use, and why the
/// destination is re-read immediately before Enter.
///
/// The scheme here is `kalsaprobe:`, one no machine has a handler for: a
/// registered scheme would prove the same thing and would open the mail client
/// on whoever's machine ran this.
///
/// If this ever fails, a browser or a driver has started offering these to the
/// route, and the scheme refusal can move into `guard` where it belongs.
#[tokio::test]
async fn a_navigation_to_an_external_protocol_is_never_offered_to_the_route() {
    let (base, _arrived) = common::serve(&[common::page(EXTERNAL)]).await;

    let (_playwright, context, page) = common::browser_on("external-protocol", &base).await;
    let seen: Arc<AtomicUsize> = Arc::new(AtomicUsize::new(0));
    let ours = Arc::clone(&seen);
    context
        .route("**/*", move |route| {
            let ours = Arc::clone(&ours);
            async move {
                if !route.request().url().starts_with("kalsaprobe:") {
                    return route.fallback(None).await;
                }
                ours.fetch_add(1, Ordering::SeqCst);
                route.abort(Some("blockedbyclient")).await
            }
        })
        .await
        .expect("a listener");

    page.goto(&base, None).await.expect("the page loads");

    // Each of the three shapes, one at a time, so a hit could be attributed.
    for (name, script) in [
        ("formaction", "document.getElementById('b').click()"),
        ("form action", "document.getElementById('f').submit()"),
        ("anchor href", "document.getElementById('a').click()"),
    ] {
        let before = seen.load(Ordering::SeqCst);
        page.evaluate::<(), ()>(script, None).await.expect("the script runs");
        tokio::time::sleep(std::time::Duration::from_millis(600)).await;
        println!("EXTERNAL_PROTOCOL {name} reached the route: {}", seen.load(Ordering::SeqCst) > before);
    }

    assert_eq!(
        seen.load(Ordering::SeqCst),
        0,
        "a navigation to an external protocol reached the route: the browser now offers these to us, so \
         the scheme refusal belongs in `guard` and not only in `input.rs`"
    );
}
