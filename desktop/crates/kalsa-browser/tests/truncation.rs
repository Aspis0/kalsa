//! A page too long for one read: what the model is told, and what it can find.
//! Proved against a real browser, because only a real tree has a real size.

mod common;

use kalsa_browser::snapshot;
use playwright_rs::protocol::{AriaSnapshotMode, AriaSnapshotOptions, Page};

// A late match must lie beyond this prefix to exercise the large-page path.
const OLD_TREE_CHARS: usize = 200_000;

/// The contract as the model is told it: the part a read carries, the budget a
/// page's tree may hold, and the notice a cut page carries.
const PART_CHARS: usize = 6_000;
const TREE_BUDGET: usize = 1_000_000;
const NOTE: &str = "note: partial snapshot — some content omitted";

/// The words on the link that lies beyond the old budget.
const LATE: &str = "zqx-late-marker-4711";

/// The tree as the driver read it, measured rather than assumed.
async fn raw_tree(page: &Page) -> String {
    page.aria_snapshot(Some(AriaSnapshotOptions::default().mode(AriaSnapshotMode::Ai)))
        .await
        .expect("the driver reads the tree")
}

/// **A page long enough to be cut, and one link at the end of it.** The
/// headings are what make the tree big; the link is what the model is after.
fn long_page(headings: usize) -> String {
    let filler = "Filler text for a page that is longer than one read may carry, \
                  so that the tree the driver reads is bigger than the budget.";
    let mut page = String::from("<html><head><title>Shop</title></head><body>");
    // The page sets its own title, blank line and all: the browser folds a
    // title's whitespace into one line before the product reads it.
    page.push_str("<script>document.title = \"First line\\n\\nSecond line\";</script>");
    for n in 0..headings {
        page.push_str(&format!("<h2>{filler} {n}</h2>"));
    }
    page.push_str(&format!("<a href=\"/late/target\">{LATE}</a>"));
    page.push_str("</body></html>");
    page
}

/// The body of a window: everything between the header and the footer.
fn body_of(text: &str) -> &str {
    let rest = text.split_once("\n\n").map(|(_, rest)| rest).unwrap_or(text);
    rest.rsplit_once("\n\n").map(|(body, _)| body).unwrap_or(rest)
}

/// The address a printed line carries, if it carries one.
fn address_of(line: &str) -> Option<&str> {
    let start = line.find("[url=")? + "[url=".len();
    let end = start + line[start..].find(']')?;
    Some(&line[start..end])
}

/// **How many refs a printed line carries, when every one of them is whole.** A
/// ref cut in half is a ref the model cannot act on.
fn whole_refs(line: &str) -> Option<usize> {
    let mut rest = line;
    let mut count = 0;
    while let Some(at) = rest.find("[e") {
        rest = &rest[at + 2..];
        let digits = rest.chars().take_while(char::is_ascii_digit).count();
        if digits == 0 || !rest[digits..].starts_with(']') {
            return None;
        }
        count += 1;
        rest = &rest[digits + 1..];
    }
    Some(count)
}

/// The header of a part: everything before the first blank line.
fn header_of(part: &str) -> &str {
    part.split_once("\n\n").map(|(head, _)| head).unwrap_or(part)
}

// A find reaches a late link without reading every intervening part.
#[tokio::test]
async fn a_link_past_the_old_budget_is_found_with_its_ref_and_its_address() {
    let (base, _arrived) = common::serve(&[common::page(&long_page(1_600))]).await;
    let (_playwright, _context, page) = common::browser_on("truncation-late", &base).await;
    page.goto(&format!("{base}/"), None).await.expect("the page loads");

    let raw = raw_tree(&page).await;
    let chars = raw.chars().count();
    assert!(chars > OLD_TREE_CHARS, "the fixture is over the old budget: {chars}");
    assert!(chars < TREE_BUDGET, "and inside the budget: {chars}");
    let at = raw.find(LATE).expect("the late link is in the tree");
    assert!(at > OLD_TREE_CHARS, "the late link lies beyond the old budget: {at}");

    let found = snapshot::find(&page, LATE, 1, 10).await.expect("the page finds");
    let address = format!("{base}/late/target");
    assert!(found.contains(&address), "the whole address is there: {found}");
    let line = found
        .lines()
        .find(|line| line.contains(LATE))
        .unwrap_or_else(|| panic!("the late link is in the answer: {found}"));
    assert!(whole_refs(line).is_some_and(|count| count > 0), "the line carries a whole ref: {line}");
}

/// **A page over the budget is bounded, and every window says so.** The notice is
/// in the header: a cut mentioned only at the end is a cut read past.
#[tokio::test]
async fn a_page_over_the_budget_is_bounded_and_says_so_in_every_window() {
    let (base, _arrived) = common::serve(&[common::page(&long_page(6_400))]).await;
    let (_playwright, _context, page) = common::browser_on("truncation-over", &base).await;
    page.goto(&format!("{base}/"), None).await.expect("the page loads");

    let raw = raw_tree(&page).await;
    let chars = raw.chars().count();
    assert!(chars > TREE_BUDGET, "the fixture is over the budget: {chars}");

    let first = snapshot::snapshot(&page, 1).await.expect("the page reads");
    assert!(first.contains(NOTE), "the first window says so: {first}");
    let (_, _, total) = common::window_of(&first);
    assert!(total > 1, "the page is longer than one window: {total} lines");
    assert!(
        body_of(&first).chars().count() <= PART_CHARS,
        "the window is within the budget: {}",
        body_of(&first).chars().count()
    );

    let last = snapshot::snapshot_from(&page, total - 1).await.expect("the last window reads");
    assert!(last.contains(NOTE), "and so does the last window: {last}");

    for part in [&first, &last] {
        let head = header_of(part);
        assert!(head.contains(NOTE), "the notice is in the header: {head}");
        for line in part.lines() {
            assert!(whole_refs(line).is_some(), "no ref is cut in half: {line}");
            if let Some(address) = address_of(line) {
                assert!(address.starts_with("http"), "an address is whole: {address}");
                assert!(!address.contains('…'), "an address is not elided: {address}");
            }
        }
    }
}
