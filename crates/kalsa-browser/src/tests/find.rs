//! What a find matches, and what it prints. An address is not what the page
//! shows, and a page of links whose addresses name a product is not the answer.

use super::{headless, page};
use crate::snapshot;

#[tokio::test]
async fn a_find_with_no_match_does_not_print_an_address_from_its_needle() {
    let (_playwright, _browser, page) = headless().await;
    page.goto(&super::page("<h1>Only the catalog</h1>"), None).await.expect("the page loads");
    let needle = "https://absent.example/collect?value=not-on-the-page";
    let found = snapshot::find(&page, needle, 1, 40).await.expect("the page finds");
    assert!(!found.contains(needle), "a query is not a page-owned address");
    assert!(!found.contains("absent.example"));
    assert!(found.contains("nothing on this page matches that text"));
}

/// A page of links whose addresses all name a product, and one product of its
/// own: the product is what the page shows, the addresses are what it links to.
fn shop() -> String {
    let mut body = String::from("<h1>the shop</h1>");
    for n in 0..24 {
        body.push_str(&format!(
            "<a href=\"https://shop.example/account?next=16GB\">Account {n}</a>"
        ));
    }
    body.push_str("<h2>16GB notebook</h2>");
    body.push_str("<a href=\"https://shop.example/dp/B0CX23V2ZK\">the notebook itself</a>");
    page(&body)
}

/// A page with more lines that match than one answer may hold.
fn many() -> String {
    let mut body = String::from("<h1>many</h1>");
    for n in 0..60 {
        body.push_str(&format!("<a href=\"https://shop.example/item/{n}\">widget {n}</a>"));
    }
    page(&body)
}

/// **The product the page shows is found, and the addresses that merely name
/// it are not.** A find answers with what the page shows.
#[tokio::test]
async fn a_visible_product_is_found_and_the_addresses_that_name_it_are_not() {
    let (_playwright, _browser, page) = headless().await;
    page.goto(&shop(), None).await.expect("the page loads");

    let found = snapshot::find_with_main(&page, "16GB", 1, 40).await.expect("the page finds");
    assert!(found.text.contains("16GB notebook"), "the product is in the answer:\n{}", found.text);
    // Context may include an account link, but URL-only matches must not consume the answer.
    let body = found.text.split_once("\n\n").map(|(_, body)| body).unwrap_or(&found.text);
    let accounts = body.matches("shop.example/account").count();
    assert!(accounts <= 2, "the addresses that merely name it are not the answer:\n{body}");
}

/// **A word that is only ever in an address is still found.** A product code is
/// not shown on the page, so the answer has to come from the addresses.
#[tokio::test]
async fn a_word_only_in_an_address_is_still_found_with_its_address_and_ref() {    let (_playwright, _browser, page) = headless().await;
    page.goto(&shop(), None).await.expect("the page loads");

    let found = snapshot::find_with_main(&page, "B0CX23V2ZK", 1, 40).await.expect("the page finds");
    let body = found.text.split_once("\n\n").expect("a header and body").1;
    let link = body.lines().find(|line| line.contains("https://shop.example/dp/B0CX23V2ZK"))
        .expect("the whole destination is in a returned element line, beyond the data-URL header");
    assert!(link.trim_start().starts_with("- ["), "the address and actionable ref share a line: {link}");
}

/// **An answer that had to leave matches out says so, and says what it left
/// out.** The cap is on the lines of the answer, and the answer says that.
#[tokio::test]
async fn an_answer_that_left_matches_out_says_so_and_names_the_line_cap() {    let (_playwright, _browser, page) = headless().await;
    page.goto(&many(), None).await.expect("the page loads");

    let found = snapshot::find_with_main(&page, "widget", 1, 40).await.expect("the page finds");
    assert!(found.text.contains("more matches not shown"), "the answer says what it left out:\n{}", found.text);
    assert!(found.text.contains("40 line cap"), "and names the cap it left out at:\n{}", found.text);
    assert!(!found.text.contains("char cap"), "the cap is on the lines, not the characters");
}
