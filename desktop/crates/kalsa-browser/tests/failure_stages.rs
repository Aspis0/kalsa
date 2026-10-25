//! Headless fixtures check liveness; started-session retention is tested in mcp.

mod common;

use kalsa_browser::session;
use playwright_rs::protocol::{BrowserContext, BrowserContextOptions, Page, Playwright};

/// A real browser with no window on the desk.
async fn headless(name: &str) -> (Playwright, BrowserContext, Page, common::Profile) {
    let profile = common::profile(name);
    let executable = kalsa_browser::find_browser::installed().await.expect("the installed browser");
    let mut options = BrowserContextOptions::default();
    options.headless = Some(true);
    options.executable_path = Some(executable);
    options.chromium_sandbox = Some(true);
    let playwright = Playwright::launch().await.expect("the verified driver starts");
    let context = playwright
        .chromium()
        .launch_persistent_context_with_options(profile.path(), options)
        .await
        .expect("the browser starts");
    let page = context.new_page().await.expect("the page is there");
    (playwright, context, page, profile)
}

/// A failure that is neither a closed window nor a dead driver: a read that
/// timed out, an element that came detached, a page that was merely slow.
fn ordinary() -> playwright_rs::Error {
    playwright_rs::Error::ProtocolError("Timeout 30000ms exceeded".to_string())
}

/// A failure that says the window is closed.
fn closed() -> playwright_rs::Error {
    playwright_rs::Error::ProtocolError("Target page, context or browser has been closed".to_string())
}

/// **A page that still answers is still there**, and the window is not thrown
/// away over one bad read.
#[tokio::test]
async fn a_page_that_answers_is_not_thrown_away_over_one_bad_read() {
    let (base, _arrived) = common::serve(&[common::page("<title>the window</title><h1>here</h1>")]).await;
    let (_playwright, _context, page, _profile) = headless("failure-live-window").await;
    page.goto(&base, None).await.expect("the page loads");
    assert_eq!(page.title().await.unwrap_or_default(), "the window", "the page is there and answers");

    let sessions = session::Sessions::new("/tmp/a-profile-nobody-uses".to_string());
    assert!(sessions.page_if_started().await.is_none(), "this session never started a window");
    assert!(
        !sessions.forget_if_gone(&ordinary(), &page).await,
        "the window is still there, so it is not ended"
    );
}

/// **A page that cannot answer has ended**, whatever the failure said: there is
/// nothing left to ask, and the next call opens a fresh window.
#[tokio::test]
async fn a_page_that_cannot_answer_is_gone() {
    let (base, _arrived) = common::serve(&[common::page("<title>the window</title><h1>here</h1>")]).await;
    let (playwright, context, page, _profile) = headless("failure-closed-window").await;
    page.goto(&base, None).await.expect("the page loads");

    // The person closed the window: the page can no longer answer a question.
    context.close().await.ok();
    drop(playwright);

    let sessions = session::Sessions::new("/tmp/a-profile-nobody-uses".to_string());
    assert!(
        sessions.forget_if_gone(&ordinary(), &page).await,
        "a page that cannot answer has ended, whatever the failure said"
    );
}

/// **A failure that says the window closed ends it**, whatever the page answers:
/// the page is not asked, because there is nothing left to ask.
#[tokio::test]
async fn a_failure_that_says_the_window_closed_ends_it() {
    let (base, _arrived) = common::serve(&[common::page("<title>the window</title><h1>here</h1>")]).await;
    let (_playwright, _context, page, _profile) = headless("failure-closed-error").await;
    page.goto(&base, None).await.expect("the page loads");

    let sessions = session::Sessions::new("/tmp/a-profile-nobody-uses".to_string());
    assert!(
        sessions.forget_if_gone(&closed(), &page).await,
        "the failure said the window was closed, and that is the end of it"
    );
}
