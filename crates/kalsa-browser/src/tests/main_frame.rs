//! The page's own document's refs, and a frame's. After a real navigation the
//! driver numbers the main frame again, so the shape cannot say which is which.

use super::{serve, window};
use crate::session::Sessions;
use crate::{input, snapshot};
use playwright_rs::protocol::Page;

/// A page long enough to come in parts, with a control of the page's own at
/// the top and a frame's control beside it.
fn long_page(base: &str) -> String {
    let mut body = format!(
        "<h1>the long page</h1><label for=\"first\">the first answer</label>\
         <input id=\"first\" type=\"text\"><iframe src=\"{base}/frame\" width=\"400\" height=\"120\"></iframe>"
    );
    for n in 0..400 {
        body.push_str(&format!(
            "<label for=\"f{n}\">a middle answer {n}</label><input id=\"f{n}\" type=\"text\">"
        ));
    }
    body
}

/// The page of the frame: a control of its own, of the frame's document.
fn frame_page() -> String {
    "<label for=\"inside\">inside the frame</label><input id=\"inside\" type=\"text\">".to_string()
}

/// Another page, so a navigation lands somewhere else.
fn other_page() -> String {
    "<h1>another document</h1>".to_string()
}

/// The ref of the line that names something.
fn ref_of(read: &str, name: &str) -> String {
    let line = read
        .lines()
        .find(|line| line.contains(name) && line.contains('['))
        .unwrap_or_else(|| panic!("no read line names {name}:\n{read}"));
    let open = line.find('[').expect("a ref in brackets");
    let close = line[open..].find(']').expect("a closed ref") + open;
    line[open + 1..close].to_string()
}

/// What the page now holds in a field.
async fn value_of(page: &Page, reference: &str) -> String {
    page.locator(format!("aria-ref={reference}"))
        .evaluate::<String, ()>("el => el.value", None)
        .await
        .expect("the page answers")
}

/// The page moves, and the document number after it, as the product counts it.
async fn navigate(sessions: &Sessions, page: &Page, to: &str) -> u64 {
    let (_, landings, _) = sessions.page_if_started().await.expect("the window is open");
    let before = landings.navigations().await;
    page.goto(to, None).await.expect("the page moves");
    for _ in 0..200 {
        let count = landings.navigations().await;
        if count > before {
            return count;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    landings.navigations().await
}

/// **The page's own refs are kept.** The tree says which document a ref is in,
/// and the shape cannot, so the next read does not take them away.
#[tokio::test]
async fn the_page_s_own_ref_survives_another_part_and_is_filled() {
    let base = serve(|base| vec![
        ("/".to_string(), long_page(base)),
        ("/frame".to_string(), frame_page()),
        ("/other".to_string(), other_page()),
    ])
    .await;
    let (_playwright, _context, page, sessions) = window(&base).await;
    navigate(&sessions, &page, &base).await;
    navigate(&sessions, &page, &format!("{base}/other")).await;
    let document = navigate(&sessions, &page, &base).await;

    let first = snapshot::snapshot_with_main(&page, 1).await.expect("the page reads");
    let second = snapshot::snapshot_with_main(&page, 2).await.expect("the page reads in parts");
    assert!(second.text.contains("Part 2 of"), "the page is long enough to come in parts:\n{}", second.text);

    sessions.remember_classified(&first.text, document, &first.main).await;
    sessions.remember_classified(&second.text, document, &second.main).await;

    let early = ref_of(&first.text, "the first answer");
    assert!(early.starts_with('f'), "the page's own ref carries the frame's shape: {early}");
    assert_eq!(sessions.ref_of(&early).await.expect("the page's own ref is still printed"), early);

    // And the fill really happens, on the field of the first part.
    input::fill(&page, &early, "an early answer").await.expect("the field is filled");
    assert_eq!(value_of(&page, &early).await, "an early answer");
}

/// **A ref a find printed is kept.** The find prints lines of the page, so the
/// ref on one of them belongs to the document the read was made of.
#[tokio::test]
async fn a_ref_a_find_printed_survives_the_next_read_and_is_filled() {
    let base = serve(|base| vec![
        ("/".to_string(), long_page(base)),
        ("/frame".to_string(), frame_page()),
        ("/other".to_string(), other_page()),
    ])
    .await;
    let (_playwright, _context, page, sessions) = window(&base).await;
    navigate(&sessions, &page, &base).await;
    navigate(&sessions, &page, &format!("{base}/other")).await;
    let document = navigate(&sessions, &page, &base).await;

    let first = snapshot::snapshot_with_main(&page, 1).await.expect("the page reads");
    let found = snapshot::find_with_main(&page, "a middle answer 399", 1, 40).await.expect("the page finds");
    let again = snapshot::snapshot_with_main(&page, 1).await.expect("the page reads again");

    sessions.remember_classified(&first.text, document, &first.main).await;
    let late = ref_of(&found.text, "a middle answer 399");
    let printed = format!("[{late}]");
    assert!(!first.text.contains(&printed) && !again.text.contains(&printed),
            "the late reference comes only from the find");
    assert!(sessions.ref_of(&late).await.is_err(), "the first part never admitted the late reference");
    sessions.remember_classified(&found.text, document, &found.main).await;
    sessions.remember_classified(&again.text, document, &again.main).await;

    assert!(late.starts_with('f'), "the page's own ref carries the frame's shape: {late}");
    assert_eq!(sessions.ref_of(&late).await.expect("the find printed it"), late);

    input::fill(&page, &late, "a late answer").await.expect("the field is filled");
    assert_eq!(value_of(&page, &late).await, "a late answer");
}

/// **A frame's ref is from the last read only, and it is found by name.** The
/// frame's own refs carry the same shape as the page's own now.
#[tokio::test]
async fn a_frames_ref_does_not_survive_a_read_that_omits_it() {
    let base = serve(|base| vec![
        ("/".to_string(), long_page(base)),
        ("/frame".to_string(), frame_page()),
        ("/other".to_string(), other_page()),
    ])
    .await;
    let (_playwright, _context, page, sessions) = window(&base).await;
    navigate(&sessions, &page, &base).await;
    navigate(&sessions, &page, &format!("{base}/other")).await;
    let document = navigate(&sessions, &page, &base).await;

    let first = snapshot::snapshot_with_main(&page, 1).await.expect("the page reads");
    let second = snapshot::snapshot_with_main(&page, 2).await.expect("the page reads in parts");

    sessions.remember_classified(&first.text, document, &first.main).await;
    let frame = ref_of(&first.text, "inside the frame");
    assert_eq!(sessions.ref_of(&frame).await.expect("the read printed it"), frame);

    sessions.remember_classified(&second.text, document, &second.main).await;
    assert!(
        sessions.ref_of(&frame).await.is_err(),
        "a frame's ref does not survive a read that omits it"
    );
}

/// **A ref of the document before a navigation is refused.** A new document
/// numbers itself again, so a ref of the document that is gone names something else.
#[tokio::test]
async fn a_ref_of_the_document_before_a_navigation_is_refused() {
    let base = serve(|base| vec![
        ("/".to_string(), long_page(base)),
        ("/frame".to_string(), frame_page()),
        ("/other".to_string(), other_page()),
    ])
    .await;
    let (_playwright, _context, page, sessions) = window(&base).await;
    let document = navigate(&sessions, &page, &base).await;

    let first = snapshot::snapshot_with_main(&page, 1).await.expect("the page reads");
    sessions.remember_classified(&first.text, document, &first.main).await;
    let early = ref_of(&first.text, "the first answer");
    assert_eq!(sessions.ref_of(&early).await.expect("printed"), early);

    let moved = navigate(&sessions, &page, &format!("{base}/other")).await;
    let read = snapshot::snapshot_with_main(&page, 1).await.expect("the page reads");
    sessions.remember_classified(&read.text, moved, &read.main).await;

    assert!(
        sessions.ref_of(&early).await.is_err(),
        "a ref of the document that is gone is refused"
    );
}
