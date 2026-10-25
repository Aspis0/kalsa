//! The read of a page that has nothing on it yet.
//!
//! A site that answers a stranger with a challenge serves the page a moment
//! later, and a read that gave up at once would hand the model the challenge
//! instead of the page. So a read waits, briefly, for the page to have
//! something on it — and says so honestly when it never does.

mod common;

use kalsa_browser::snapshot;

/// **A page that shows its content a moment after it loads.** It is empty
/// until the moment comes, so a read that gave up at once would find nothing.
fn late_page() -> String {
    r#"
<div id="gate"></div>
<script>
  setTimeout(() => { document.getElementById('gate').textContent = 'the content is here'; }, 700);
</script>
"#
    .to_owned()
}

/// **A page that gets its content a moment later is read with it.** A read that
/// gave up at once would hand the model an empty page and no refs to act on.
#[tokio::test]
async fn a_page_that_gets_its_content_a_moment_later_is_read_with_it() {
    let (base, _arrived) = common::serve(&[common::page(&late_page())]).await;
    let (_sessions, page, _holds) = common::confirming_window("readiness-late", &base).await;

    let read = snapshot::read_when_ready(&page, 1).await.expect("the page reads");
    assert!(read.contains("the content is here"), "the read waited for the content: {read}");
    assert!(read.contains('['), "and it brought the refs to act on: {read}");
}

/// **A page with nothing on it is reported as a page with nothing on it.** The
/// read waits its bound and then says so, rather than claiming a page it
/// cannot see, and it invents no ref.
#[tokio::test]
async fn a_page_with_nothing_on_it_is_reported_honestly() {
    let (base, _arrived) = common::serve(&[common::page("<div id=\"empty\"></div>")]).await;
    let (_sessions, page, _holds) = common::confirming_window("readiness-empty", &base).await;

    let read = snapshot::read_when_ready(&page, 1).await.expect("the page reads");
    assert!(!read.contains('['), "there is nothing to give a ref for: {read}");
    let said = snapshot::nothing_to_read(&read, true);
    assert!(said.contains("There is nothing to read"), "the model is told there is nothing: {said}");
    assert!(said.contains("it is loaded and has nothing on it"), "and why: {said}");
    assert!(!said.contains('['), "and no ref is invented: {said}");
}
