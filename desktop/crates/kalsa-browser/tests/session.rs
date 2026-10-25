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
    let profile = common::profile("session-inflight-sessions");
    let sessions = session::Sessions::new(profile.path());

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

/// A cancelled navigation is not a dead window, and the session is kept.
/// **What is claimed, exactly:** when a navigation is aborted, (1) the error is
/// not classified as a closed window or a dead driver — it gets the plain
/// sentence, because from the driver's side an abort and a stop look the same —
/// and (2) told the window had gone, the session **does not** drop it, so the next
/// call carries on in the same browser instead of opening a fresh one over a load
/// a person cancelled.
///
/// **How the abort is made, and why this is not a race:** the *fixture* aborts the
/// navigation — the test's route handles it and calls `abort("aborted")`, which is
/// what Chromium reports as `net::ERR_ABORTED`. Nothing here starts two
/// navigations at once and nothing waits on a clock for one to overtake the other.
/// The previous shape of this test did both, and could not have won: committing
/// the first navigation makes Chromium commit a `chrome-error://` page for the
/// second, so the second fails whatever the timing, and the test's own `if let
/// Err` then let a run pass by asserting nothing at all. This one asks the
/// browser to cancel the load, exactly as it does for a person pressing stop.
#[tokio::test]
async fn a_cancelled_navigation_keeps_the_session() {
    let (base, _arrived) = common::serve(&[common::page("<title>the window</title><h1>here</h1>")]).await;
    let (sessions, page) = common::sessions_on("session-aborted", &base).await;
    page.goto(&base, None).await.expect("the page loads");
    assert_eq!(page.title().await.unwrap_or_default(), "the window", "the window is the one we opened");

    // Added after the session's own route, so it is the one that sees this
    // request, and only requests for this one path are touched — every other
    // navigation here is the session's own business.
    let aborted = format!("{base}/aborted");
    page.route(&aborted, |route| async move { route.abort(Some("aborted")).await })
        .await
        .expect("the aborting route is installed");

    // The navigation is cancelled by the browser, and it says so.
    let error = page.goto(&aborted, None).await.expect_err("the navigation was aborted");
    assert!(error.to_string().contains("ERR_ABORTED"), "the fixture did not abort it as it meant to: {error}");

    // Claim (1): an abort is not a window that closed and not a driver that
    // died. Either would throw the browser away over one cancelled load.
    assert_eq!(session::reason_of(&error), None, "an abort is neither a closed window nor a dead driver");
    assert_eq!(session::explain(&error), "the page did not answer that call; try again");

    // Claim (2): told the window had gone, the session keeps it — the one place
    // that decision is made. A fresh window would have no title yet, so the
    // title is what says "same window" rather than "a new one".
    sessions.forget_if_gone(&error, &page).await;
    let (again, _landings, _holds) = sessions.page().await.expect("and it is still ours");
    assert_eq!(again.title().await.unwrap_or_default(), "the window", "the session opened a fresh window over one cancelled load");
    let text = kalsa_browser::snapshot::snapshot(&page, 1).await.expect("the page still answers");
    assert!(text.contains("url:"), "and it is the same page: {text}");
}

/// A dead window is not a dead session: the next call opens a fresh one, in the
/// same `Sessions`, rather than asking a page that is gone.
#[tokio::test]
async fn a_closed_window_resets_the_session_and_the_next_call_opens_a_fresh_one() {
    let (base, _arrived) = common::serve(&[common::page(r#"<h1>here</h1>"#)]).await;
    let (sessions, first) = common::sessions_on("session-reset", &base).await;
    first.goto(&base, None).await.expect("the page loads");
    sessions.reset().await;

    let (second, _landings, _holds) = sessions.page().await.expect("a fresh window opens");
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
