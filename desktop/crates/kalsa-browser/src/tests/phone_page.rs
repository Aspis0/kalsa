//! A phone's read, find, click and type touch only the page its own conversation
//! opened. The browser is one window; a desktop conversation reads what is on it,
//! as it always has, and a phone does not get that.

use crate::hold::Holds;
use crate::landing::Landings;
use crate::mcp::phone_may_touch;

/// **A public address the test answers itself, for the reads.** The read judges
/// the page by the landing it was served from, and a page served from this
/// computer's own network is refused before the phone ever is — so a loopback
/// fixture cannot carry a read these proofs run.
const SERVED_FROM: &str = "http://93.184.216.34";

/// A one-pixel GIF, for the image a page's `load` waits on.
const A_PIXEL: &[u8] = b"GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;";

/// **A page whose `load` waits on an image the test holds.** The read and the
/// find both settle the page before they take its text, and a page whose load
/// is held is a call parked at a known point: the person can take the window
/// while the call is between its two stamp judgements, and the image is let go
/// when the proof wants the call to finish. Nothing races a clock.
async fn a_page_the_test_holds_the_load_of() -> (
    playwright_rs::protocol::Playwright,
    playwright_rs::protocol::BrowserContext,
    playwright_rs::protocol::Page,
    crate::session::Sessions,
    Holds,
    std::sync::Arc<tokio::sync::Notify>,
) {
    let (playwright, context, page) = super::headless().await;
    let asked = std::sync::Arc::new(tokio::sync::Notify::new());
    let open = std::sync::Arc::new(tokio::sync::Notify::new());
    let body = r#"<body><h1>the phone's page</h1><img src="/held"></body>"#.to_string();
    {
        let (asked, open) = (asked.clone(), open.clone());
        page.route(&format!("{SERVED_FROM}/**"), move |route| {
            let (asked, open, body) = (asked.clone(), open.clone(), body.clone());
            async move {
                if !route.request().url().ends_with("/held") {
                    let html = playwright_rs::protocol::FulfillOptions::builder()
                        .content_type("text/html")
                        .body(body.into_bytes())
                        .build();
                    return route.fulfill(Some(html)).await;
                }
                asked.notify_one();
                open.notified().await;
                let pixel = playwright_rs::protocol::FulfillOptions::builder()
                    .content_type("image/gif")
                    .body(A_PIXEL.to_vec())
                    .build();
                route.fulfill(Some(pixel)).await
            }
        })
        .await
        .expect("the test answers the public address");
    }
    let landings = Landings::holding(vec![(&format!("{SERVED_FROM}/one"), "93.184.216.34")]).await;
    let holds = Holds::new();
    let sessions = crate::session::Sessions::with_window(
        playwright.clone(),
        context.clone(),
        page.clone(),
        landings,
        holds.clone(),
    );
    // The document is parsed without waiting for the image, so the page is
    // there to be judged while its load — and so the call reading it — is held.
    // **The playwright handle is returned, not dropped here**: dropping any one
    // of its clones shuts the driver down, and the session's own clone is not
    // enough to keep it.
    let parsed = playwright_rs::protocol::GotoOptions::new()
        .wait_until(playwright_rs::protocol::WaitUntil::DomContentLoaded);
    page.goto(&format!("{SERVED_FROM}/one"), Some(parsed)).await.expect("the page starts");
    asked.notified().await;
    (playwright, context, page, sessions, holds, open)
}

/// The page a desktop conversation opened is the desktop's: a phone is refused it.
#[tokio::test]
async fn a_phone_may_not_touch_a_page_a_desktop_conversation_opened() {
    let holds = Holds::default();
    holds.claim_for_turn("chat-desk").await.expect("the page was free to take");
    assert!(!phone_may_touch(&holds, "phone:1").await, "a desktop's page was let through to a phone");
    assert!(phone_may_touch(&holds, "chat-desk").await, "a desktop reads what is on the window, as before");
}

/// The page a phone opened is that phone's, and another phone's is not.
#[tokio::test]
async fn a_phone_touches_only_the_page_its_own_conversation_opened() {
    let holds = Holds::default();
    holds.claim_for_turn("phone:1").await.expect("the page was free to take");
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
    holds.claim_for_turn("chat-desk").await.expect("the page was free to take");
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

/// **A desktop turn does not open over a page a phone's turn holds.** One page is
/// driven by one turn, and the rule is the same both ways: while the phone's turn
/// runs, the desktop's open is refused as busy, the phone's page stays where it
/// was, and its owner stays the phone's.
#[tokio::test]
async fn a_desktop_does_not_open_over_a_page_a_phone_holds() {
    let (_playwright, _context, page, sessions) = window().await;
    let holds = sessions.holds().await;
    holds.claim_for_turn("phone:1").await.expect("the page was free to take");
    let driving = holds.drive("phone:1");
    page.goto("https://example.com/", None).await.expect("the phone's page loads");
    driving.release();

    let args =
        serde_json::from_value(serde_json::json!({"url": "https://example.org/", "conversation": "chat-desk"}))
            .expect("the open's arguments");
    let answer = crate::mcp::open(&sessions, args).await;

    assert!(said(&answer).contains("busy"), "the desktop was let open over the phone's page: {}", said(&answer));
    assert!(said(&answer).contains("nothing was opened over it"), "and nothing was opened: {}", said(&answer));
    assert!(page.url().starts_with("https://example.com"), "the phone's page was replaced: {}", page.url());
    assert_eq!(holds.stamp_for_the_page().await, "phone:1", "and the page's owner changed");
}

/// **A page's claim belongs to a turn, and the turn's end lets it go.** While the
/// turn runs, a second driver is refused; when the turn ends, the page is nobody's
/// and the next turn may take it. A release that is not the claim's own lets
/// nothing go: a turn that ended late must not take the page away from the one
/// that holds it now.
#[tokio::test]
async fn the_claim_is_released_when_the_turn_ends() {
    let holds = Holds::default();
    assert!(holds.claim_for_turn("phone:1").await.is_some(), "the phone took the page nobody held");

    // A release in another conversation's name leaves the page exactly as it is.
    assert!(!holds.forget_owner("chat-desk").await, "another conversation's release was obeyed");
    assert_eq!(holds.stamp_for_the_page().await, "phone:1", "the page changed hands");

    // The turn's own release, and the page is open to the next turn.
    assert!(holds.forget_owner("phone:1").await, "the turn's own release was refused");
    assert_eq!(holds.stamp_for_the_page().await, "", "the page is still the phone's");
    assert!(holds.claim_for_turn("chat-desk").await.is_some(), "the next turn was refused a page nobody holds");
    // And releasing twice says so the second time: there was nothing left to let go.
    assert!(!holds.forget_owner("phone:1").await, "a release that found nothing let something go");
}

/// **A page the person moves by hand is nobody's, even one a phone's turn
/// opened.** The person has the window; the turn's claim does not outlive the
/// page they actually left behind — and the next turn may open over it.
#[tokio::test]
async fn a_manual_navigation_ends_a_phones_claim() {
    let holds = Holds::default();
    holds.claim_for_turn("phone:1").await.expect("the page was free to take");
    assert_eq!(holds.stamp_for_the_page().await, "phone:1");

    // The person's own navigation: nobody is driving the window.
    holds.a_main_frame_navigation().await;

    assert_eq!(holds.stamp_for_the_page().await, "", "the phone's claim outlived the page it was about");
    assert!(holds.claim_for_turn("chat-desk").await.is_some(), "the next turn was refused a page nobody holds");
}

/// **A phone's claim of a page is one step.** A page another conversation holds is refused,
/// and the refusal writes nothing. A page nobody holds is claimed, and the stamps it replaced
/// come back, so a failed open can give them back.
#[tokio::test]
async fn a_phone_claims_a_page_only_when_no_other_conversation_holds_it() {
    let holds = Holds::default();
    holds.claim_for_turn("chat-desk").await.expect("the page was free to take");
    assert!(holds.claim_for_turn("phone:1").await.is_none(), "a desktop's page was claimed by a phone");
    assert_eq!(holds.stamp_for_the_page().await, "chat-desk", "and the refused claim wrote nothing");
    assert_eq!(holds.stamp_for_our_call().await, "chat-desk", "not even the last actor");

    let fresh = Holds::default();
    let replaced = fresh.claim_for_turn("phone:1").await.expect("a page nobody holds can be claimed");
    assert_eq!(replaced, (String::new(), String::new()), "the claim replaced nobody's stamps");
    assert_eq!(fresh.stamp_for_the_page().await, "phone:1");
    assert!(fresh.claim_for_turn("phone:1").await.is_some(), "and the phone may claim its own page again");
}

/// **A read that was under way when the person took the window is refused
/// after the read, not handed over.** The stamp is judged before the read and
/// again once the text is in hand: the person's navigation between the two
/// clears the stamps, and the refusal is the only thing between the phone and
/// the words of the page the person opened. The read is parked on a load the
/// test holds while the person acts, so the moment is made, not raced.
#[tokio::test]
async fn a_read_under_way_when_the_person_takes_the_window_is_refused_after_the_read() {
    let (_playwright, _context, _page, sessions, holds, open) = a_page_the_test_holds_the_load_of().await;
    holds.claim_for_turn("phone:1").await.expect("the page was free to take");

    // The read parks on the held load. Its first stamp judgement is behind it
    // — the task needs only to be scheduled, not to win a race — and its
    // second is not until the image goes.
    let reading = tokio::spawn({
        let sessions = std::sync::Arc::new(sessions);
        async move {
            let args = serde_json::from_value(serde_json::json!({"conversation": "phone:1"}))
                .expect("the read's arguments");
            crate::mcp::read_page(&sessions, args).await
        }
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // The person takes the window, and the load is let go so the read carries
    // on to the text it will now be refused over.
    holds.a_main_frame_navigation().await;
    open.notify_one();
    let answer = reading.await.expect("the read finished");

    let mark = said(&answer);
    assert!(mark.contains("was not opened by this phone's conversation"), "the read was handed over: {mark}");
    assert!(!mark.contains("the phone's page"), "and the page's own words are not in the answer: {mark}");
}

/// **The find is judged the same way.** Its matches are in hand only while the
/// page is still the phone's: the same navigation while the find is under way
/// refuses the answer rather than handing over the page the person opened.
#[tokio::test]
async fn a_find_under_way_when_the_person_takes_the_window_is_refused_after_the_find() {
    let (_playwright, _context, _page, sessions, holds, open) = a_page_the_test_holds_the_load_of().await;
    holds.claim_for_turn("phone:1").await.expect("the page was free to take");

    let finding = tokio::spawn({
        let sessions = std::sync::Arc::new(sessions);
        async move {
            let args = serde_json::from_value(serde_json::json!({
                "text": "the phone's page",
                "conversation": "phone:1",
            }))
            .expect("the find's arguments");
            crate::mcp::find(&sessions, args).await
        }
    });
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    holds.a_main_frame_navigation().await;
    open.notify_one();
    let answer = finding.await.expect("the find finished");

    let mark = said(&answer);
    assert!(mark.contains("was not opened by this phone's conversation"), "the find was handed over: {mark}");
    assert!(!mark.contains("the phone's page"), "and the page's own words are not in the answer: {mark}");
}
