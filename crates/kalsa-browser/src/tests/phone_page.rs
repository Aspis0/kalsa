//! A phone's read, find, click and type touch only the page its own conversation
//! opened. The browser is one window; a desktop conversation reads what is on it,
//! as it always has, and a phone does not get that.

use crate::hold::Holds;
use crate::mcp::phone_may_touch;

/// The page a desktop conversation opened is the desktop's: a phone is refused it.
#[tokio::test]
async fn a_phone_may_not_touch_a_page_a_desktop_conversation_opened() {
    let holds = Holds::default();
    holds.navigated_by("chat-desk").await;
    assert!(!phone_may_touch(&holds, "phone:1").await, "a desktop's page was let through to a phone");
    assert!(phone_may_touch(&holds, "chat-desk").await, "a desktop reads what is on the window, as before");
}

/// The page a phone opened is that phone's, and another phone's is not.
#[tokio::test]
async fn a_phone_touches_only_the_page_its_own_conversation_opened() {
    let holds = Holds::default();
    holds.navigated_by("phone:1").await;
    assert!(phone_may_touch(&holds, "phone:1").await, "the page the phone opened is its own");
    assert!(!phone_may_touch(&holds, "phone:2").await, "and another phone's conversation is refused it");
}

/// A page nobody opened, or one the person moved by hand, is nobody's: a phone is refused.
#[tokio::test]
async fn a_phone_is_refused_a_page_nobody_opened() {
    let holds = Holds::default();
    assert!(!phone_may_touch(&holds, "phone:1").await, "a page with no owner was let through to a phone");
}

/// The window, the product's own rules installed, and the sessions a call is answered by.
async fn window() -> (
    playwright_rs::protocol::Playwright,
    playwright_rs::protocol::BrowserContext,
    playwright_rs::protocol::Page,
    crate::session::Sessions,
) {
    let (playwright, context, page) = super::headless().await;
    let landings = crate::landing::Landings::new();
    let holds = Holds::new();
    crate::guard::install(&context, &landings, &holds).await.expect("the rules are installed");
    let sessions = crate::session::Sessions::with_window(
        playwright.clone(),
        context.clone(),
        page.clone(),
        landings,
        holds,
    );
    (playwright, context, page, sessions)
}

/// The text a call answers with.
fn said(answer: &rmcp::model::CallToolResult) -> String {
    match answer.content.first() {
        Some(rmcp::model::ContentBlock::Text(text)) => text.text.clone(),
        _ => String::new(),
    }
}

/// **A phone does not open a page over one that is not its own.** The desktop has a
/// page on the window; the phone's open is refused, the desktop's page stays where it
/// was, and its owner stays the desktop's.
#[tokio::test]
async fn a_phone_does_not_open_over_a_page_that_is_not_its_own() {
    let (_playwright, _context, page, sessions) = window().await;
    let holds = sessions.holds().await;
    holds.navigated_by("chat-desk").await;
    let driving = holds.drive("chat-desk");
    page.goto("https://example.com/", None).await.expect("the desktop's page loads");
    driving.release();

    let args = serde_json::from_value(serde_json::json!({"url": "https://example.org/", "conversation": "phone:1"}))
        .expect("the open's arguments");
    let answer = crate::mcp::open(&sessions, args).await;

    assert!(said(&answer).contains("busy"), "the phone was let open over the desktop's page: {}", said(&answer));
    assert!(said(&answer).contains("nothing was opened over it"), "and nothing was opened: {}", said(&answer));
    assert!(page.url().starts_with("https://example.com"), "the desktop's page was replaced: {}", page.url());
    assert_eq!(holds.stamp_for_the_page().await, "chat-desk", "and the page's owner changed");
}

/// **An open that never lands gives the page's owner back.** The window is blank, so the
/// phone may open on it; the address does not load, and the page is nobody's again, not
/// the phone's.
#[tokio::test]
async fn a_failed_open_by_a_phone_gives_the_page_back_to_its_owner() {
    let (_playwright, _context, _page, sessions) = window().await;
    let holds = sessions.holds().await;
    assert_eq!(holds.stamp_for_the_page().await, "", "the window starts with nobody's page on it");

    // A public address that refuses the connection: the guard lets it through, and the load fails.
    let args = serde_json::from_value(serde_json::json!({"url": "https://example.com:1/", "conversation": "phone:1"}))
        .expect("the open's arguments");
    let answer = crate::mcp::open(&sessions, args).await;

    // It must fail at the driver: a refusal by the guard never reaches the stamps, and
    // this test would then prove nothing about the restore.
    let stage = answer.structured_content.as_ref().and_then(|value| value["kalsa"]["failure"].as_str());
    assert_eq!(stage, Some("open_driver"), "the open did not fail at the driver: {}", said(&answer));
    assert_eq!(holds.stamp_for_the_page().await, "", "a page that never landed was stamped with the phone");
    assert_eq!(holds.stamp_for_our_call().await, "", "and the last actor went back to nobody, as the window did not move");
}

/// **A phone opens a page nobody holds.** The person moved the window by hand, so no
/// conversation holds the page on it: the phone may open over it, and the page becomes
/// the phone's, so the phone can then drive it.
#[tokio::test]
async fn a_phone_opens_over_a_page_no_conversation_holds() {
    let (_playwright, _context, page, sessions) = window().await;
    // The page is there, and nobody stamped it.
    page.goto("https://example.com/", None).await.expect("the page loads");
    let holds = sessions.holds().await;
    assert_eq!(holds.stamp_for_the_page().await, "", "the page starts with nobody holding it");

    let args = serde_json::from_value(serde_json::json!({"url": "https://example.org/", "conversation": "phone:1"}))
        .expect("the open's arguments");
    let answer = crate::mcp::open(&sessions, args).await;

    assert!(!said(&answer).contains("busy"), "the phone was refused a page nobody holds: {}", said(&answer));
    assert!(page.url().starts_with("https://example.org"), "the phone did not open the page: {}", page.url());
    assert_eq!(holds.stamp_for_the_page().await, "phone:1", "and the page is the phone's now");
}
