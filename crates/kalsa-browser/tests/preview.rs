//! The phone's preview against a real browser: a real page, the product's own
//! rules, and the picture the phone would be shown.
//!
//! **The window is headless and isolated**, so nothing here takes the screen
//! from the person using the machine: the installed browser, a profile of this
//! test's own, and a read-only public page.

mod common;

use base64::Engine;
use kalsa_browser::find_browser;
use kalsa_browser::guard;
use kalsa_browser::hold::Holds;
use kalsa_browser::landing::Landings;
use kalsa_browser::preview::{self, Refusal};
use playwright_rs::protocol::{BrowserContextOptions, Page, Playwright};

/// A public page, read only: one navigation, no form, no cookie worth keeping.
const PAGE: &str = "https://example.com/";

/// Another public page, read only: where the person takes the window when they
/// move it by hand.
const ELSEWHERE: &str = "https://example.org/";

/// The window: the installed browser, headless, on a profile of this test's
/// own, with the product's own rules installed.
///
/// **The profile is held by the caller**, because a profile that went when the
/// function returned would delete the directory Chrome is running in.
async fn window(name: &str) -> (common::Profile, Playwright, playwright_rs::protocol::BrowserContext, Page, Landings, Holds) {
    let profile = common::profile(name);
    let executable = find_browser::installed().await.expect("the installed browser");
    let playwright = Playwright::launch().await.expect("the driver starts");
    let mut options = BrowserContextOptions::default();
    options.headless = Some(true);
    options.executable_path = Some(executable);
    options.chromium_sandbox = Some(true);
    let context = playwright
        .chromium()
        .launch_persistent_context_with_options(profile.path(), options)
        .await
        .expect("a context");
    let landings = Landings::new();
    let holds = Holds::new();
    // **The product's own rules**: the guard, the landing watcher and the
    // holds, exactly as `launch::start` installs them.
    guard::install(&context, &landings, &holds).await.expect("the rules are installed");
    let page = context.new_page().await.expect("a page");
    (profile, playwright, context, page, landings, holds)
}

/// The page, opened the way the product opens one: the conversation that
/// opened it is stamped first, so the page belongs to it, and the call that
/// opens it is driving the window, so the navigation it causes is ours.
async fn opened(page: &Page, holds: &Holds, conversation: &str) {
    holds.navigated_by(conversation).await;
    let driving = holds.drive(conversation);
    page.goto(PAGE, None).await.expect("the page loads");
    driving.release();
}

/// **The person takes the window and moves it by hand.** The main frame goes
/// somewhere else, and nothing of ours caused it: the page they opened is
/// theirs, and ours only until they touch it.
///
/// The navigation is made from the page itself, as a link the person pressed
/// would: the browser is asked for a document, and the product's own route
/// sees the request.
async fn moved_by_hand(page: &Page) {
    // The page may be gone by the time the answer comes back — it is on its
    // way somewhere else — so the answer is not what is waited on.
    let _ = page.evaluate::<(), ()>(&format!("location.href = '{ELSEWHERE}'"), None).await;
    page.wait_for_url(ELSEWHERE, None).await.expect("the page lands where the person sent it");
}

/// **A real page, a real picture.** The bytes are a JPEG of the page as it is
/// on the screen, small enough for the road, and the two facts beside it say
/// which page it was and when.
#[tokio::test]
async fn a_page_yields_a_bounded_jpeg_with_its_host_and_the_moment_it_was_taken() {
    let (_profile, _playwright, _context, page, landings, holds) = window("preview-picture").await;
    opened(&page, &holds, "phone:1").await;

    let taken = preview::shot(&page, &landings, &holds, "phone:1").await.expect("the picture is taken");

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&taken.image)
        .expect("the picture is base64 with no prefix");
    assert_eq!(&bytes[..3], &[0xFF, 0xD8, 0xFF], "the picture is a JPEG");
    assert!(bytes.len() <= preview::MAX_BYTES, "the picture is {} bytes", bytes.len());
    assert!(taken.image.len() <= 349_528, "the picture is {} characters on the road", taken.image.len());
    assert_eq!(taken.host, "example.com", "the bare host of the page it was taken from");
    // Milliseconds since the epoch: this year, and not seconds.
    let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).expect("the clock").as_millis() as u64;
    assert!(taken.taken_at > 1_600_000_000_000, "the moment is in milliseconds: {}", taken.taken_at);
    assert!(taken.taken_at <= now_ms + 1_000, "and it is now, not later");
}

/// **The picture is the conversation's own.** Another conversation watching the
/// same page gets nothing: reading a page does not make it yours.
#[tokio::test]
async fn another_conversation_gets_no_picture_of_the_page() {
    let (_profile, _playwright, _context, page, landings, holds) = window("preview-not-yours").await;
    opened(&page, &holds, "phone:1").await;

    let refused = preview::shot(&page, &landings, &holds, "phone:2").await.err().expect("no picture");
    assert_eq!(refused.refusal, Refusal::NotYours);
}

/// **The picture does not disturb the window.** The stamps are the window's
/// record of who owns it, and a picture takes none of that and adds none.
#[tokio::test]
async fn a_picture_leaves_the_window_as_it_found_it() {
    let (_profile, _playwright, _context, page, landings, holds) = window("preview-unchanged").await;
    opened(&page, &holds, "phone:1").await;
    let before = holds.stamp_for_the_page().await;

    preview::shot(&page, &landings, &holds, "phone:1").await.expect("the picture is taken");

    assert_eq!(holds.stamp_for_the_page().await, before, "the owner of the page changed");
    assert_eq!(holds.stamp_for_our_call().await, "phone:1", "and the last actor with it");
}

/// **A page the person opened by hand is nobody's.** The window was ours, the
/// person took it and moved it by hand, and the page on the screen is now one
/// they opened: no conversation owns it, and the phone is refused as
/// `not_yours` rather than shown a picture of somebody else's page.
#[tokio::test]
async fn a_page_the_person_moved_by_hand_is_not_ours() {
    let (_profile, _playwright, _context, page, landings, holds) = window("preview-person").await;
    opened(&page, &holds, "phone:1").await;

    moved_by_hand(&page).await;

    let refused = preview::shot(&page, &landings, &holds, "phone:1").await.err().expect("no picture");
    assert_eq!(refused.refusal, Refusal::NotYours);
    assert_eq!(holds.stamp_for_the_page().await, "", "and the page belongs to nobody");
    assert_eq!(holds.stamp_for_our_call().await, "", "not even to the last actor");
}

/// **A call that panicked does not keep the window.**
///
/// The release of the driving is on **every** way out of a call — the answer it
/// gave, the error it hit, the panic it took. A release that ran only on the
/// happy path left the window ours after a panic, and the person's next
/// navigation was then read as ours: the page they had opened by hand stayed
/// ours, and a phone was shown a picture of it.
///
/// **The unwind here is the real one**: the guard is dropped by the panic,
/// exactly as a call that panicked in the middle of driving the window would
/// drop it — a `Drop` is what runs on that way out.
#[tokio::test]
async fn a_call_that_panicked_does_not_keep_the_window() {
    let (_profile, _playwright, _context, page, landings, holds) = window("preview-panicked").await;
    opened(&page, &holds, "phone:1").await;

    let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _driving = holds.drive("phone:1");
        panic!("the call went down in the middle of driving the window");
    }));
    assert!(panicked.is_err(), "the call panicked, as this proof says it does");

    // **And the person takes the window and moves it by hand.**
    moved_by_hand(&page).await;

    let refused = preview::shot(&page, &landings, &holds, "phone:1").await.err().expect("no picture");
    assert_eq!(refused.refusal, Refusal::NotYours);
    assert_eq!(holds.stamp_for_the_page().await, "", "and the page belongs to nobody");
}

/// **The honest case still works.** The page we opened is still ours after it
/// was opened, and the phone still gets its picture: the rule is about the
/// person moving the window, and not about the window being opened at all.
#[tokio::test]
async fn the_page_we_opened_is_still_ours() {
    let (_profile, _playwright, _context, page, landings, holds) = window("preview-still-ours").await;
    opened(&page, &holds, "phone:1").await;

    let taken = preview::shot(&page, &landings, &holds, "phone:1").await.expect("the picture is taken");

    assert_eq!(taken.host, "example.com", "the picture is of the page we opened");
    assert_eq!(holds.stamp_for_the_page().await, "phone:1", "and the page is still ours");
}
