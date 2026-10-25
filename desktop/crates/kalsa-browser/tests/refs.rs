//! The elements a page printed, and the one a call may act on.
//!
//! A page longer than one message comes in parts, and the driver numbers a
//! document once: a ref printed in one part names the same element in the next.
//! These proofs are against a real browser and a real long form, because the
//! thing being proved is the seam between what a read printed and what a fill
//! is allowed to act on.

mod common;

use kalsa_browser::{input, snapshot};
use playwright_rs::protocol::{Page, WaitUntil};

/// A form long enough that a read of it comes in parts, with a named control at
/// the top so the first part holds something to act on.
fn long_form() -> String {
    let mut body = String::from("<h1>the long form</h1><form action=\"/posted\">");
    body.push_str("<label for=\"first\">the first answer</label><input id=\"first\" type=\"text\">");
    for n in 0..200 {
        body.push_str(&format!(
            "<label for=\"f{n}\">a middle answer {n}</label><input id=\"f{n}\" type=\"text\">"
        ));
    }
    body.push_str("</form>");
    body
}

/// A long page with a frame at the top of it, so that the first part holds a
/// control of the frame and the second part does not.
fn long_page_with_a_frame() -> String {
    let mut body = String::from("<h1>the long page</h1><iframe src=\"/frame\" width=\"400\" height=\"120\"></iframe>");
    body.push_str("<form action=\"/posted\">");
    body.push_str("<label for=\"first\">the first answer</label><input id=\"first\" type=\"text\">");
    for n in 0..200 {
        body.push_str(&format!(
            "<label for=\"f{n}\">a middle answer {n}</label><input id=\"f{n}\" type=\"text\">"
        ));
    }
    body.push_str("</form>");
    body
}

/// The ref a read printed for a control inside a frame, if it printed one.
///
/// **The driver's own shape**: a frame's number is in front of the element's.
fn frame_ref_of(read: &str) -> Option<String> {
    read.lines()
        .filter_map(|line| {
            let open = line.find('[')?;
            let close = line[open..].find(']')? + open;
            Some(line[open + 1..close].to_string())
        })
        .find(|id| {
            let Some(rest) = id.strip_prefix('f') else { return false };
            let Some((frame, element)) = rest.split_once('e') else { return false };
            let digits = |part: &str| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit());
            digits(frame) && digits(element)
        })
}

/// The window, the page and the count of navigations the session sees.
async fn window(name: &str, base: &str) -> (kalsa_browser::session::Sessions, Page, kalsa_browser::landing::Landings) {
    let (sessions, page, landings) = common::sessions_watching(name, base).await;
    page.goto(base, None).await.expect("the page loads");
    page.wait_for_load_state(Some(WaitUntil::Load)).await.ok();
    (sessions, page, landings)
}

/// The ref a line prints.
fn ref_in(line: &str) -> String {
    let open = line.find('[').expect("a ref in brackets");
    let close = line[open..].find(']').expect("a closed ref") + open;
    line[open + 1..close].to_string()
}

/// The ref a read printed for a named control.
fn ref_of(read: &str, name: &str) -> String {
    let line = read
        .lines()
        .find(|line| line.contains(name) && line.contains("[e"))
        .unwrap_or_else(|| panic!("no read line names {name} with a ref:\n{read}"));
    ref_in(line)
}

/// The first control a read printed, whichever part it is in.
fn first_ref_of(read: &str) -> String {
    let line = read
        .lines()
        .find(|line| line.contains("[e"))
        .unwrap_or_else(|| panic!("the read printed no control to act on:\n{read}"));
    ref_in(line)
}

/// What the page now holds in a field.
async fn value_of(page: &Page, reference: &str) -> String {
    page.locator(format!("aria-ref={reference}"))
        .evaluate::<String, ()>("el => el.value", None)
        .await
        .expect("the page answers")
}

/// **A page read in parts is one document, and the driver numbers it once.**
/// A ref printed in one part names the same element in the next, so reading
/// another part does not make the first part's controls unusable — which is
/// what an ordinary form on an ordinary page is made of.
#[tokio::test]
async fn a_ref_printed_in_one_part_is_still_acted_on_after_another_part_is_read() {
    let (base, arrived) = common::serve(&[common::page(&long_form())]).await;
    let (sessions, page, landings) = window("refs-parts", &base).await;

    let document = landings.navigations().await;
    let first = snapshot::snapshot(&page, 1).await.expect("the page reads");
    let second = snapshot::snapshot(&page, 2).await.expect("the page reads in windows");
    let (first_line, first_after, total) = common::window_of(&first);
    let (second_line, _, _) = common::window_of(&second);
    assert!(
        second_line >= first_after && total > first_after,
        "the page is long enough to come in windows, and the answer says where it stands:\n{second}"
    );
    sessions.remember(&first, document).await;
    sessions.remember(&second, document).await;

    // A ref printed in the first part is still the one a call may act on, and so
    // is one printed in the second.
    let early = ref_of(&first, "the first answer");
    let late = first_ref_of(&second);
    assert!(!first.contains(&late), "the two refs are of two different parts");
    assert_eq!(sessions.ref_of(&early).await.expect("still actable"), early);
    assert_eq!(sessions.ref_of(&late).await.expect("printed"), late);

    // And the fills really happen, on a field of each part.
    input::fill(&page, &early, "an early answer").await.expect("the first field is filled");
    input::fill(&page, &late, "a late answer").await.expect("a field of the second part is filled");
    assert_eq!(value_of(&page, &early).await, "an early answer");
    assert_eq!(value_of(&page, &late).await, "a late answer");
    assert!(!arrived.asked_for("/posted"), "and nothing was submitted");
}

/// **A frame numbers its own document, and we cannot see that document
/// change**, so a frame's ref is from the last read only, while the main
/// document's refs belong to the document and are kept.
#[tokio::test]
async fn a_frames_ref_is_from_the_last_read_only_and_the_main_refs_are_not() {
    let (base, _arrived) = common::serve(&[
        common::page(&long_page_with_a_frame()),
        common::page_at("/frame", "<label for=\"inside\">inside the frame</label><input id=\"inside\" type=\"text\">"),
    ])
    .await;
    let (sessions, page, landings) = window("refs-frames", &base).await;

    let document = landings.navigations().await;
    let first = snapshot::snapshot(&page, 1).await.expect("the page reads");
    let second = snapshot::snapshot(&page, 2).await.expect("the page reads in parts");
    sessions.remember(&first, document).await;
    sessions.remember(&second, document).await;

    let frame = frame_ref_of(&first).expect("the read printed a control of the frame");
    let main = ref_of(&first, "the first answer");
    assert_eq!(sessions.ref_of(&main).await.expect("still actable"), main, "the main document's refs survive another part");
    assert!(
        sessions.ref_of(&frame).await.is_err(),
        "a frame's ref is from the last read only, and the second read did not print it"
    );
}

/// The name of a control late in the form, past the first part.
const LATE: &str = "a middle answer 199";

/// **A ref a find printed is a ref a call may act on.** The find's lines are the
/// page's own lines, so the ledger takes them as it takes a read's.
#[tokio::test]
async fn a_ref_a_find_printed_is_acted_on() {
    let (base, arrived) = common::serve(&[common::page(&long_form())]).await;
    let (sessions, page, landings) = window("refs-find", &base).await;

    let document = landings.navigations().await;
    let first = snapshot::snapshot(&page, 1).await.expect("the page reads");
    sessions.remember(&first, document).await;
    assert!(!first.contains(LATE), "the late control is not in the first part:\n{first}");

    let found = snapshot::find(&page, LATE, 1, 10).await.expect("the page finds");
    let late = ref_of(&found, LATE);
    assert!(
        sessions.ref_of(&late).await.is_err(),
        "a ref nothing has printed yet is not acted on: {late}"
    );

    sessions.remember(&found, document).await;
    assert_eq!(sessions.ref_of(&late).await.expect("the find printed it"), late);

    input::fill(&page, &late, "a late answer").await.expect("the field is filled");
    assert_eq!(value_of(&page, &late).await, "a late answer");
    assert!(!arrived.asked_for("/posted"), "and nothing was submitted");
}

/// **A ref of the document before a navigation is not acted on.** A new document
/// numbers itself again, so a ref of the document that is gone names something
/// else now, and is not acted on.
#[tokio::test]
async fn a_ref_of_the_document_before_a_navigation_is_not_acted_on() {
    let (base, _arrived) = common::serve(&[
        common::page(&long_form()),
        common::page_at("/other", "<h1>another document</h1>"),
    ])
    .await;
    let (sessions, page, landings) = window("refs-moved", &base).await;

    let document = landings.navigations().await;
    let first = snapshot::snapshot(&page, 1).await.expect("the page reads");
    sessions.remember(&first, document).await;
    let early = ref_of(&first, "the first answer");
    assert_eq!(sessions.ref_of(&early).await.expect("printed"), early);

    page.goto(&format!("{base}/other"), None).await.expect("the page moves");
    page.wait_for_load_state(Some(WaitUntil::Load)).await.ok();
    assert_ne!(landings.navigations().await, document, "the navigation moved the count");
    assert!(
        sessions.ref_of(&early).await.is_err(),
        "a ref of the document that is gone is not acted on"
    );
}
