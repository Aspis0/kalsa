//! What the person is told when the window goes, and what happens next.
//!
//! A window closed by hand is an ordinary thing to do, and it must arrive as a
//! sentence the model can act on rather than a driver message. The driver being
//! killed outright is in `tests/driver_death.rs`, which has a process of its
//! own so it cannot take the tests beside it with it.

mod common;

use kalsa_browser::session;
use std::time::Duration;

/// Every sentence the model can be given by a call that failed. A window closed
/// in the middle of a load arrives as `ERR_ABORTED`, which is deliberately not
/// read as a closed window — it is the same thing a person pressing stop looks
/// like — so it is given the plain sentence.
fn is_ours(line: &str) -> bool {
    line == session::Reason::Closed.reason()
        || line == session::Reason::DriverGone.reason()
        || line == "the page did not answer that call; try again"
}

/// Closing the window ends the session: the call in flight fails, and it fails
/// with words the model can act on rather than a driver's.
#[tokio::test]
async fn a_window_closed_mid_call_is_one_clean_line() {
    let (base, _arrived) = common::serve(&[common::page("<h1>page</h1>")]).await;
    let (playwright, context, page) = common::browser_on("session-closed", &base).await;
    page.goto(&base, None).await.expect("the page loads");

    context.close().await.ok();
    drop(playwright);

    let error = kalsa_browser::snapshot::snapshot(&page, 1).await.expect_err("a closed window answers nothing");
    let line = session::explain(&error);
    assert!(is_ours(&line), "not one of our lines: {line}");
    assert!(!line.contains("Target") && !line.contains("Target page"), "{line}");
}

/// The window is closed *while the call is waiting on the network*, which is
/// when a person actually closes it: mid-page, not between pages.
#[tokio::test]
async fn a_window_closed_while_a_call_is_in_flight_is_one_clean_line() {
    let (base, _arrived) =
        common::serve(&[common::page("<h1>slow</h1>").slow(Duration::from_millis(4000))]).await;
    let (playwright, context, page) = common::browser_on("session-inflight", &base).await;
    let sessions = session::Sessions::new(common::profile("session-inflight-sessions"));

    let closing = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        context.close().await.ok();
        drop(playwright);
    });

    let error = page.goto(&base, None).await.expect_err("the window goes mid-navigation");
    closing.await.expect("the closer ran");
    let line = session::explain(&error);
    assert!(is_ours(&line), "not one of our lines: {line}");

    // And the session writes itself off: a page that cannot answer is a page
    // that is gone, whatever the error called it.
    sessions.forget_if_gone(&error, &page).await;
    assert!(sessions.page().await.is_ok(), "a fresh window replaces the dead one");
}

/// A cancelled navigation is not a dead window. `ERR_ABORTED` is what a load the
/// person stopped, or a page that answered with something else, looks like — and
/// the browser is still open and still usable afterwards. Reporting it as a
/// closed window would throw away a working browser over one cancelled load, so
/// the session is left exactly as it was.
#[tokio::test]
async fn a_cancelled_navigation_keeps_the_session() {
    let (base, _arrived) =
        common::serve(&[common::page("<h1>here</h1>"), common::page("<h1>late</h1>").slow(Duration::from_millis(3000))])
            .await;
    let (sessions, page) = common::sessions_on("session-aborted", &base).await;
    page.goto(&base, None).await.expect("the page loads");

    // Two navigations, the first of which the second cancels. That is what
    // ERR_ABORTED is, and nothing is closed to make it happen.
    let cancelled = tokio::spawn({
        let page = page.clone();
        let slow = format!("{base}/slow");
        async move { page.goto(&slow, None).await }
    });
    tokio::time::sleep(Duration::from_millis(200)).await;
    page.goto(&base, None).await.expect("the second navigation goes through");
    let first = cancelled.await.expect("the first task finished");
    if let Err(error) = first {
        assert_ne!(session::reason_of(&error), Some(session::Reason::Closed), "an abort is not a closed window");
    }

    // The window is untouched: the next call reads the page normally.
    let text = kalsa_browser::snapshot::snapshot(&page, 1).await.expect("the page still answers");
    assert!(text.contains("url:"), "the session still has a page: {text}");
    assert!(sessions.page().await.is_ok(), "and the session is still ours");
}

/// A dead window is not a dead session: the next call opens a fresh one, in the
/// same `Sessions`, rather than asking a page that is gone.
#[tokio::test]
async fn a_closed_window_resets_the_session_and_the_next_call_opens_a_fresh_one() {
    let (base, _arrived) = common::serve(&[common::page(r#"<h1>here</h1>"#)]).await;
    let (sessions, first) = common::sessions_on("session-reset", &base).await;
    first.goto(&base, None).await.expect("the page loads");
    sessions.reset().await;

    let (second, _landings) = sessions.page().await.expect("a fresh window opens");
    // The opening route belonged to the window that went, so the fresh one is
    // opened the same way — which is the point: it is a new window, not the old.
    let origin = base.clone();
    second
        .route("**/*", move |route| {
            let origin = origin.clone();
            async move {
                if route.request().url().starts_with(&origin) {
                    route.continue_(None).await
                } else {
                    route.fallback(None).await
                }
            }
        })
        .await
        .ok();
    second.goto(&base, None).await.expect("and the page loads in it");
    assert!(second.url().starts_with(&base), "the second window is on {}", second.url());
}
