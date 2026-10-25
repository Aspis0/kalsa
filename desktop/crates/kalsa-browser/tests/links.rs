//! The addresses a read prints, and the ones it must not make up.
//!
//! Proved against a browser that really loaded the pages: a stub would agree
//! with whatever the test expected.

mod common;

use kalsa_browser::snapshot;

#[tokio::test]
async fn a_read_prints_the_address_of_every_link_it_shows() {
    let (base, _arrived) = common::serve(&[common::page(PAGE), common::page_at(FRAME, FRAME_PAGE)]).await;
    let (_playwright, _context, page) = common::browser_on("links-addresses", &base).await;

    page.goto(&format!("{base}/"), None).await.expect("the page loads");
    let text = snapshot::read_when_ready(&page, 1).await.expect("the page reads");

    // An address that is already whole is printed as it stands.
    assert!(text.contains("https://example.com/absolute"), "{text}");
    // A relative address is resolved in the document the link is in.
    assert!(text.contains(&format!("{base}/root/relative")), "{text}");
    assert!(text.contains(&format!("{base}/plain/relative?q=1")), "{text}");
    // The link inside the frame is resolved in the frame's own document.
    assert!(text.contains(&format!("{base}/frames/deep/inside/frame")), "{text}");
    assert!(!text.contains(&format!("{base}/inside/frame")), "{text}");
    // The link and the ref it is acted on by are still there.
    assert!(text.contains("Root relative"), "{text}");

    // A find prints the same addresses.
    let found = snapshot::find(&page, "Root relative", 1, 10).await.expect("the page finds");
    assert!(found.contains(&format!("{base}/root/relative")), "{found}");
}

#[tokio::test]
async fn a_relative_address_is_resolved_against_the_base_the_page_declares() {
    let (base, _arrived) = common::serve(&[common::page_at("/withbase", BASED_PAGE)]).await;
    let (_playwright, _context, page) = common::browser_on("links-base", &base).await;

    page.goto(&format!("{base}/withbase"), None).await.expect("the page loads");
    let text = snapshot::read_when_ready(&page, 1).await.expect("the page reads");

    assert!(text.contains(&format!("{base}/base/plain/relative?q=1")), "{text}");
    assert!(!text.contains(&format!("{base}/plain/relative?q=1")), "{text}");
}

/// A page with an address of its own, a relative one, and a frame.
const PAGE: &str = r##"<html><body>
<h1>Shop</h1>
<a href="https://example.com/absolute">Absolute</a>
<a href="/root/relative">Root relative</a>
<a href="plain/relative?q=1">Plain relative</a>
<iframe src="/frames/deep/page.html"></iframe>
</body></html>"##;

/// A page in a frame of its own, so the address inside it is relative to the
/// frame's document and not to the page that holds the frame.
const FRAME: &str = "/frames/deep/page.html";

const FRAME_PAGE: &str = r##"<html><body><a href="inside/frame">Inside the frame</a></body></html>"##;

/// A page that says where its relative addresses are.
const BASED_PAGE: &str = r##"<html><head><base href="/base/"></head><body>
<a href="plain/relative?q=1">Based</a>
</body></html>"##;
