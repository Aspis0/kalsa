//! Whether a page can hand an address to another program through this window.
//!
//! Chromium routes `mailto:` and `tel:` to the operating system **before anything
//! becomes a network request**, so no route is offered them. This file is what is
//! left, and it has two halves:
//!
//! - `a_navigation_to_an_external_protocol_is_never_offered_to_the_route` pins
//!   the finding itself, so nobody moves the refusal into `guard` on the strength
//!   of a belief. The scheme here is `kalsaprobe:`, deliberately one no machine
//!   has a handler for: a registered scheme would prove the same thing and would
//!   open the mail client on whoever's machine ran the test.
//! - `every_shape_a_page_can_navigate_from_is_refused_on_the_window` is the
//!   answer. The listener in `src/external.rs` is installed on the whole context
//!   at document start, so it is in every frame of every page this window opens,
//!   and it is the only layer measured to see the shapes below.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

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
/// non-http(s) schemes in `input.rs` is therefore not the **only** thing standing
/// between a page and a program on this computer, because the listener in
/// `src/external.rs` stands there too.
///
/// There is no launch flag or policy that closes it. Chromium's only related
/// switches do the opposite or do not apply: `disable-sandbox-external-protocols`
/// re-allows external protocols from sandboxed iframes, and the
/// `SandboxExternalProtocolBlocked` policy covers sandboxed iframes only, not a
/// top-level navigation. Measured on this browser's own command line: no flag
/// suppresses a confirmation dialog either, and the handler is launched without
/// one — so there is no prompt for the person to decide on.
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
        tokio::time::sleep(Duration::from_millis(600)).await;
        println!("EXTERNAL_PROTOCOL {name} reached the route: {}", seen.load(Ordering::SeqCst) > before);
    }

    assert_eq!(
        seen.load(Ordering::SeqCst),
        0,
        "a navigation to an external protocol reached the route: the browser now offers these to us, so \
         the scheme refusal belongs in `guard` and not only in `input.rs`"
    );
}

/// **Every shape a page can navigate from, refused on the window** — and the
/// shapes are named here because each one is a hole a previous version of this
/// suite did not know about.
///
/// **What the assertion is sensitive to, and how it was made so.** "The page did
/// not move" is worthless on its own: a scheme no machine handles leaves the page
/// where it is whether or not anything refused it, which is how a version of this
/// test passed against a window that did nothing at all. So each shape is tried
/// twice — once at `kalsaprobe:`, which is the real thing, and once at
/// `about:blank`, which this browser resolves to a page all by itself, so a
/// navigation that is *not* stopped is visible. And the **control** is the same
/// five shapes at an ordinary address, where the page is expected to move: if
/// that stops being true, the refusals above are passing for the wrong reason.
///
/// Nothing here can open anything on the machine running it: no destination in
/// this file has a handler.
#[tokio::test]
async fn every_shape_a_page_can_navigate_from_is_refused_on_the_window() {
    let (base, _arrived) = common::serve(&[
        common::page(
            r#"<div id="host"></div>
               <form id="get" method="get"><input name="q" value="1"></form>
               <form id="post" method="post">
                 <input name="q" value="1">
                 <button id="go" type="submit">go</button>
                 <input id="typed" type="text">
               </form>
               <p id="ran">nothing</p>"#,
        ),
        common::page_at("/next", "<h1>next</h1>"),
    ])
    .await;
    let (_playwright, context, page) = common::browser_on("external-shapes", &base).await;
    page.goto(&base, None).await.expect("the page loads");

    // **The five shapes, written once and pointed at one destination.** A shadow
    // tree, a submit button's own `formaction`, a native `submit()` that fires no
    // event, a GET submission, and Enter — which fires a `submit` and no click.
    let shapes: Vec<(&str, String)> = vec![
        ("a link clicked from inside a shadow tree", "const h = document.getElementById('host').attachShadow({mode: 'open'}); h.innerHTML = '<a id=\"inside\" href=\"DEST\">in</a>'; h.querySelector('#inside').click();".into()),
        ("a submit button whose formaction is elsewhere", "document.getElementById('go').setAttribute('formaction', 'DEST'); document.getElementById('go').click();".into()),
        ("a native form.submit()", "document.getElementById('post').setAttribute('action', 'DEST'); document.getElementById('post').submit();".into()),
        ("a GET submission", "document.getElementById('get').setAttribute('action', 'DEST'); document.getElementById('get').submit();".into()),
        ("Enter in a field", "document.getElementById('post').setAttribute('action', 'DEST'); document.getElementById('typed').focus();".into()),
    ];

    // **Where the page is when nothing has happened to it**, which is what every
    // refusal below is measured against. Not "still on this origin" — a control
    // that navigates to another path on the same origin is a move too.
    let home = page.url();

    for (destination, refused) in [("kalsaprobe://from-shape", true), ("about:blank", true), ("/next", false)] {
        for (name, shape) in &shapes {
            let _ = page.goto(&base, None).await;
            let _ = page.evaluate::<String, ()>(&format!("s => {{ {} }}", shape.replace("DEST", destination)), None).await;
            if name.starts_with("Enter") {
                page.keyboard().press("Enter", None).await.expect("the key goes down");
            }
            tokio::time::sleep(Duration::from_millis(400)).await;
            let moved = page.url() != home;
            if refused {
                assert!(!moved, "{name} to {destination}: the page navigated away, to {}", page.url());
            } else {
                assert!(moved, "{name} to {destination}: an ordinary address was refused, so the refusals above prove nothing");
            }
        }
    }

    // **And a page that answers its own click by moving the destination**, which is
    // the shape a check-then-click cannot see: the address is safe when the click
    // starts and is not when the default action runs. It is written as a bubbling
    // listener on the element, which is what a page writes.
    //
    // **The page's own record of having run is kept outside the document**, through
    // a binding: if the guard fails and the page navigates, the element that would
    // have said so is gone with it, and the failure has to name the thing that went
    // wrong rather than the element that happened to leave.
    let ran = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&ran);
    context
        .expose_function("__kalsaThePageRan", move |_args: Vec<serde_json::Value>| {
            counted.fetch_add(1, Ordering::SeqCst);
            async move { serde_json::Value::Null }
        })
        .await
        .expect("a binding");

    let _ = page.goto(&base, None).await;
    let _ = page.evaluate::<(), ()>(
        r#"() => {
            const link = document.createElement('a');
            link.id = 'swapper';
            link.href = '/next';
            link.textContent = 'open it';
            link.addEventListener('click', () => {
              window.__kalsaThePageRan();
              link.href = 'about:blank';
            });
            document.body.appendChild(link);
        }"#,
        None,
    )
    .await;
    let _ = page.evaluate::<(), ()>("() => document.getElementById('swapper').click()", None).await;
    tokio::time::sleep(Duration::from_millis(400)).await;
    assert_eq!(ran.load(Ordering::SeqCst), 1, "the page's own handler did not run, so nothing was refused");
    assert!(
        !page.url().starts_with("about:"),
        "a click handler moved the link to another program and the page followed it: {}",
        page.url()
    );
}

/// **The button a submission names is judged, and not only the form.**
///
/// `requestSubmit(button)` sends **that button's own `formaction`** whatever the
/// form says, and the `submit` event's target is the *form* — so a listener that
/// reads the event's target alone reads a safe address and lets the request go.
///
/// **The dangerous button is deliberately not the form's default one**, and the
/// form's own action is safe too, so nothing about the form says another program:
/// the only thing that names one is the button the submission names. `about:blank`
/// is the destination for the refusal because a page this browser opens by itself
/// is a move a refused submission cannot make, and `/next` is the control —
/// without it, "the page did not move" would prove nothing.
#[tokio::test]
async fn the_button_a_submission_names_is_judged_and_not_only_the_form() {
    let (base, _arrived) = common::serve(&[
        common::page(
            r#"<form id="f" action="/next" method="get">
                 <button id="plain" type="submit">plain</button>
                 <button id="danger" type="submit" formaction="kalsaprobe://from-a-button">danger</button>
               </form>"#,
        ),
        common::page_at("/next", "<h1>next</h1>"),
    ])
    .await;
    let (_playwright, _context, page) = common::browser_on("external-submitter", &base).await;
    page.goto(&base, None).await.expect("the page loads");
    let home = page.url();

    for (destination, refused) in [("about:blank", true), ("/next", false)] {
        let _ = page.goto(&base, None).await;
        let to = destination.to_string();
        let _ = page
            .evaluate::<String, ()>(
                "d => { document.getElementById('danger').setAttribute('formaction', d); \
                 document.getElementById('f').requestSubmit(document.getElementById('danger')); }",
                Some(&to),
            )
            .await;
        tokio::time::sleep(Duration::from_millis(400)).await;
        let moved = page.url() != home;
        if refused {
            assert!(!moved, "requestSubmit(danger) to {destination}: the page went to {}", page.url());
        } else {
            assert!(
                moved,
                "requestSubmit(danger) to {destination} was refused, so the refusal above proves nothing"
            );
        }
    }
}
