//! The model's picture of the page, against a real browser.
//!
//! **The same guards as the phone's, and the model's own answer.** The
//! capture is shared — the same ownership, the same pause, the same landing
//! rule, the same JPEG — and the answer is not: the model's is the one that
//! carries the bytes, the host and the moment, in the shape the app reads.
//!
//! **And the ownership is the model's own conversation.** A page the model
//! opened is the model's; a page the person took the window to is nobody's,
//! and the model is refused the way the phone is.
//!
//! The window is headless and isolated, and the page is a read-only public
//! one: the product's own rule refuses this computer's own network (a
//! picture of the door is not a picture of a page), so the page here is the
//! same one the phone's preview is proved against.

use super::headless;
use crate::hold::Holds;
use crate::landing::Landings;
use crate::preview::{self, Refusal};
use crate::session::Sessions;
use playwright_rs::protocol::{BrowserContext, Page, Playwright};

/// A public page, read only: one navigation, no form, no cookie worth keeping.
const PAGE: &str = "https://example.com/";

/// Another public page, read only: where the person takes the window when they
/// move it by hand.
const ELSEWHERE: &str = "https://example.org/";

/// The conversation that opened the page: the model's own.
const MODEL: &str = "browser:model";

/// The window, the product's own rules installed, and the session the model
/// answers through.
async fn window() -> (Playwright, BrowserContext, Page, Sessions) {
    let (playwright, context, page) = headless().await;
    let landings = Landings::new();
    let holds = Holds::new();
    crate::guard::install(&context, &landings, &holds).await.expect("the rules are installed");
    let sessions = Sessions::with_window(
        playwright.clone(),
        context.clone(),
        page.clone(),
        landings,
        holds,
    );
    (playwright, context, page, sessions)
}

/// The page, opened the way the product opens one: the conversation that
/// opened it is stamped first, so the page belongs to it, and the call that
/// opens it is driving the window, so the navigation it causes is ours.
async fn opened(sessions: &Sessions, page: &Page, to: &str) {
    let holds = sessions.holds().await;
    holds.claim_for_turn(MODEL).await.expect("the page was free to take");
    let driving = holds.drive(MODEL);
    page.goto(to, None).await.expect("the page loads");
    driving.release();
}

/// The text the answer carries.
fn said(answer: &rmcp::model::CallToolResult) -> String {
    match answer.content.first() {
        Some(rmcp::model::ContentBlock::Text(text)) => text.text.clone(),
        _ => String::new(),
    }
}

/// The answer, read as the app reads it.
async fn answered(sessions: &Sessions, conversation: &str) -> serde_json::Value {
    let answer = preview::answer_model(sessions, conversation).await;
    serde_json::from_str(&said(&answer)).expect("the answer is JSON the app reads")
}

/// **The model gets a picture of the page its own conversation opened.** The
/// answer is JSON the app reads: the bytes, the host the page was on, and the
/// moment the picture was taken.
#[tokio::test]
async fn the_model_gets_a_picture_of_the_page_its_own_conversation_opened() {
    let (_playwright, _context, page, sessions) = window().await;
    opened(&sessions, &page, PAGE).await;

    let answer = answered(&sessions, MODEL).await;
    assert_eq!(answer["ok"], serde_json::Value::Bool(true), "the picture was taken: {answer}");
    assert_eq!(answer["media_type"], "image/jpeg", "the picture is a JPEG");
    let image = answer["image"].as_str().expect("the bytes are there");
    assert!(!image.is_empty(), "and they are not empty");
    assert!(!image.starts_with("data:"), "the bytes carry no prefix of their own");
    assert!(image.len() <= 349_528, "the picture is {} characters on the road", image.len());
    // The host of the page it was taken from: the model is told whose page it
    // is looking at.
    assert_eq!(answer["host"], "example.com", "the bare host of the page it was taken from");
    assert!(answer["taken_at"].as_u64().expect("the moment is there") > 1_600_000_000_000);
}

/// **A page the person took the window to is nobody's.** The window was ours,
/// the person moved it by hand, and the page on the screen is now one they
/// opened: no conversation owns it, and the model is refused as `not_yours`
/// rather than shown a picture of somebody else's page.
#[tokio::test]
async fn a_page_the_person_moved_by_hand_is_not_the_model_s_either() {
    let (_playwright, _context, page, sessions) = window().await;
    opened(&sessions, &page, PAGE).await;

    // **The person takes the window and moves it by hand**: the navigation is
    // made from the page itself, as a link the person pressed would.
    let _ = page
        .evaluate::<(), ()>(&format!("location.href = '{ELSEWHERE}'"), None)
        .await;
    page.wait_for_url(ELSEWHERE, None)
        .await
        .expect("the page lands where the person sent it");

    let answer = answered(&sessions, MODEL).await;
    assert_eq!(answer["ok"], serde_json::Value::Bool(false), "no picture was taken: {answer}");
    assert_eq!(answer["error"], "not_yours", "and the reason is the page's own");
    // **And the reason says what a model can act on**, in the fixed words the
    // refusals always carry.
    let message = answer["message"].as_str().expect("the refusal says something");
    assert!(message.contains("not this conversation's"), "the refusal is a sentence: {message}");
    assert!(answer.get("image").is_none(), "and no bytes rode with it");
}

/// **Another conversation gets nothing.** A page the model opened is the
/// model's, and a model that did not open it is refused: reading a page does
/// not make it yours.
#[tokio::test]
async fn another_conversation_gets_no_picture_of_the_page() {
    let (_playwright, _context, page, sessions) = window().await;
    opened(&sessions, &page, PAGE).await;

    let answer = answered(&sessions, "browser:another").await;
    assert_eq!(answer["ok"], serde_json::Value::Bool(false), "no picture was taken: {answer}");
    assert_eq!(answer["error"], "not_yours", "and the reason is the page's own");
}

/// **The person takes the window between the judgement and the picture.** The
/// page was ours when the picture was asked for, and the person moved it by hand
/// before the address was read: the picture would carry example.org's bytes
/// while the ownership was judged on example.com. The model is refused, and no
/// picture of a page nobody owns leaves the window.
#[tokio::test]
async fn a_window_moved_between_the_judgement_and_the_picture_is_refused() {
    let (_playwright, _context, page, sessions) = window().await;
    opened(&sessions, &page, PAGE).await;
    let (shot_page, landings, holds) = sessions.page_if_started().await.expect("the page is open");

    let hand = page.clone();
    let refused = preview::shot_then(&shot_page, &landings, &holds, MODEL, move || async move {
        // The person's own navigation, made after the judgement and before the address.
        let _ = hand.evaluate::<(), ()>(&format!("location.href = '{ELSEWHERE}'"), None).await;
        hand.wait_for_url(ELSEWHERE, None).await.expect("the page lands where the person sent it");
    })
    .await
    .err()
    .expect("no picture");

    assert_eq!(refused.refusal, Refusal::NotYours, "the window moved, so the page is not the model's");
    assert_eq!(holds.stamp_for_the_page().await, "", "and the page belongs to nobody");
}
