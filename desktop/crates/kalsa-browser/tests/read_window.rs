//! A page longer than one answer: the window a read carries, and the line the
//! next one starts at.
//!
//! Proved against a real browser, because only a real tree has a real length.

mod common;

use kalsa_browser::snapshot;

/// **A page long enough to need more than one window.** Two hundred lines, so
/// the tree is several answers long.
fn long_page() -> String {
    let mut body = String::from("<h1>the long page</h1>");
    for n in 0..200 {
        body.push_str(&format!("<p>a line of the page number {n}</p>"));
    }
    body
}

/// **The read says where it stands on the page, and the next window is read
/// from the line the answer ended at.**
///
/// The owner's test of 21 October: a turn that read a long page eight times in
/// a row, every read the same lines, the page never moving, and the model
/// never getting further down it. **The answer says how far it got**, so the
/// next read can start there.
#[tokio::test]
async fn a_read_says_where_it_stands_and_the_next_window_is_read_from_a_line() {
    let (base, _arrived) = common::serve(&[common::page(&long_page())]).await;
    let (_playwright, _context, page) = common::browser_on("read-window", &base).await;
    page.goto(&format!("{base}/"), None).await.expect("the page loads");

    let first = snapshot::snapshot(&page, 1).await.expect("the page reads");
    let (line, after, total) = common::window_of(&first);
    assert_eq!(line, 1, "the first window starts at the first line");
    assert!(total > after, "the page is longer than the answer: {total} lines, {after} of them read");

    // **The lines that follow are read with the line the answer ended at.**
    let next = snapshot::snapshot_from(&page, after).await.expect("the next window reads");
    let (next_line, next_after, _) = common::window_of(&next);
    assert_eq!(next_line, after + 1, "the next window starts where the last one ended");
    assert!(next_after > next_line, "and it carries lines of its own");
    assert_ne!(first, next, "the two windows are two different texts");

    // **And the same window is the same text.** That is what the refusal of a
    // window the model already has is about, and it is what the owner's turn
    // read eight times over.
    let again = snapshot::snapshot(&page, 1).await.expect("the page reads again");
    assert_eq!(again, first, "the same window is the same text");
}
