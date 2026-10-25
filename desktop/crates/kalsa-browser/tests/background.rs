//! A write the page makes on its own, with no person behind it.
//!
//! It goes out like a normal browser's lets it go: no card, nothing said to the
//! model, and no place taken in the person's queue. What it carries of the
//! person's is the one thing that holds it, and a form the page submits is the
//! person's own business however empty it is.
//!
//! The fixture checks both cards and received requests: a pending card alone
//! does not prove that anything was sent.

mod common;

use common::write::{path_of, ref_of, wait_for_post, wait_for_posts};
use kalsa_browser::hold;
use kalsa_browser::input;
use kalsa_browser::mcp;
use playwright_rs::protocol::Page;
use std::time::Duration;

/// A write with nothing in it but its address: the shape a tracking request
/// has.
const ADDRESS_ONLY: &str = "fetch('/collect?en=page_view&tid=AW-1', {method: 'POST'}).catch(() => {});";

/// A page that writes by itself, and two forms to send: one with fields, one
/// without.
fn page_with(writes: &str) -> String {
    format!(
        r#"
<h1>the page that writes on its own</h1>
<form id="order" action="/order" method="post">
  <label for="city">the city</label>
  <input id="city" name="city" type="text">
  <button type="submit">buy it</button>
</form>
<form id="empty" action="/subscribe" method="post">
  <button type="submit">subscribe</button>
</form>
<script>
  {writes}
</script>
"#
    )
}

/// A click, through the product's own action, so a write the action causes is
/// judged as ours. The id is the card's.
async fn clicking(page: &Page, holds: &hold::Holds, id: &str) -> String {
    let before = holds.ids().await;
    let (clicked, held) = mcp::acting(page, holds, common::CHAT, &before, common::the_fixture, input::click(page, id)).await;
    clicked.expect("the click lands");
    held.expect("the write is held")
}

/// **A write that carries nothing but its own address goes out, like a normal
/// browser's.** There is nobody behind it, so there is nobody to ask.
#[tokio::test]
async fn a_write_the_page_makes_with_nothing_in_it_but_its_address_goes_out() {
    let (base, arrived) = common::serve(&[common::page(&page_with(ADDRESS_ONLY))]).await;
    let (_sessions, _page, holds) = common::confirming_window("background-address-only", &base).await;

    let lines = wait_for_post(&arrived, "/collect").await;
    assert!(lines.iter().any(|line| line.starts_with("POST /collect")), "the write went out: {lines:?}");
    assert_eq!(holds.waiting().await, 0, "and the person is asked about nothing");
    assert!(holds.cards().await.is_empty(), "and there is no card");
    assert!(holds.take_outcomes(common::CHAT).await.is_empty(), "and the model is not told");
}

/// **The control: without the hold this write really does go out.** A card that
/// exists proves a request was offered, never that it went, and this is what
/// says the fixture would have received it.
#[tokio::test]
async fn the_same_write_goes_out_when_nothing_is_holding_it() {
    let (base, arrived) = common::serve(&[common::page(&page_with(ADDRESS_ONLY))]).await;
    let (_playwright, _context, page) = common::browser_without_our_rules().await;
    page.goto(&base, None).await.expect("the fixture loads");

    let lines = wait_for_post(&arrived, "/collect").await;
    assert!(
        lines.iter().any(|line| line.starts_with("POST /collect")),
        "the page's own write reached the site: {lines:?}"
    );
}

/// **A write the page makes with a body goes out as well.** The body is ordinary
/// contact data and nobody is behind it, so there is nothing to confirm: this
/// is the trade, and it is the page's own request that is sent.
#[tokio::test]
async fn a_write_the_page_makes_with_a_body_goes_out_and_is_not_held() {
    let (base, arrived) = common::serve(&[common::page(&page_with(""))]).await;
    let (_sessions, page, holds) = common::confirming_window("background-with-body", &base).await;

    page.evaluate::<(), ()>(
        r#"() => {
            fetch('/lead', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'city=Bologna&item=lamp'}).catch(() => {});
        }"#,
        None,
    )
    .await
    .ok();

    let lines = wait_for_post(&arrived, "/lead").await;
    assert_eq!(lines.iter().filter(|line| line.starts_with("POST /lead")).count(), 1, "it went once: {lines:?}");
    assert_eq!(arrived.body_of("/lead").as_deref(), Some("city=Bologna&item=lamp"), "and it went as it was written");
    assert_eq!(holds.waiting().await, 0, "and the person is asked about nothing");
    assert!(holds.cards().await.is_empty(), "and there is no card");
    assert!(holds.take_outcomes(common::CHAT).await.is_empty(), "and the model is not told");
}

/// **A write in a body no card could show goes out as well.** A body nobody can
/// read is not a secret the person typed, and the person's secret is the only
/// thing a write of the page's own is held for.
#[tokio::test]
async fn a_write_the_page_makes_in_a_body_a_card_cannot_show_goes_out() {
    let (base, arrived) = common::serve(&[common::page(&page_with(""))]).await;
    let (_sessions, page, holds) = common::confirming_window("background-opaque", &base).await;

    page.evaluate::<(), ()>(
        r#"() => {
            fetch('/upload', {method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: 'not a form at all'}).catch(() => {});
        }"#,
        None,
    )
    .await
    .ok();

    let lines = wait_for_post(&arrived, "/upload").await;
    assert!(lines.iter().any(|line| line.starts_with("POST /upload")), "the write went out: {lines:?}");
    assert_eq!(holds.waiting().await, 0, "and the person is asked about nothing");
    assert!(holds.cards().await.is_empty(), "and there is no card");
    assert!(holds.take_outcomes(common::CHAT).await.is_empty(), "and the model is not told");
}

/// **The limit, and it is a limit and not a rule: with something recorded, a
/// body nobody can read cannot be called harmless.** It is refused rather than
/// sent, and the model is told why.
#[tokio::test]
async fn a_write_in_a_body_a_card_cannot_show_is_refused_when_the_person_has_typed_a_secret() {
    let (base, arrived) = common::serve(&[common::page(&page_with(""))]).await;
    let (_sessions, page, holds) = common::confirming_window("background-opaque-secret", &base).await;
    holds.typed_in(1, "hunter2-the-passphrase").await;

    page.evaluate::<(), ()>(
        r#"() => {
            fetch('/upload', {method: 'POST', headers: {'Content-Type': 'application/octet-stream'}, body: 'not a form at all'}).catch(() => {});
        }"#,
        None,
    )
    .await
    .ok();
    tokio::time::sleep(Duration::from_millis(300)).await;

    let lines = arrived.except_icons();
    assert!(!lines.iter().any(|line| line.starts_with("POST")), "nothing was sent: {lines:?}");
    let outcomes = holds.take_outcomes(common::CHAT).await;
    assert_eq!(outcomes.len(), 1, "and the model is told: {outcomes:?}");
    assert!(
        matches!(outcomes[0], hold::Outcome::Unrenderable(_)),
        "and what it is told is that nothing was sent: {outcomes:?}"
    );
}

/// **A form the person fills is still a card.** This is the road the catcher
/// takes, and the rule about the page's own writes does not reach it.
#[tokio::test]
async fn a_form_the_person_fills_is_still_held_and_only_the_person_sends_it() {
    let (base, arrived) = common::serve(&[common::page(&page_with(""))]).await;
    let (_sessions, page, holds) = common::confirming_window("background-form", &base).await;

    let city = ref_of(&page, "the city").await;
    let before = holds.ids().await;
    let (filled, _) = mcp::acting(
        &page,
        &holds,
        common::CHAT,
        &before,
        common::the_fixture,
        input::fill(&page, &city, "Bologna"),
    )
    .await;
    filled.expect("the field is filled");

    let buy = ref_of(&page, "buy it").await;
    let id = clicking(&page, &holds, &buy).await;
    let card = holds.card(&id).await.expect("a card");
    assert_eq!(path_of(&card.url), "/order");
    let lines = arrived.except_icons();
    assert!(!lines.iter().any(|line| line.starts_with("POST")), "the form was not sent: {lines:?}");

    assert!(matches!(
        holds.answer(&id, common::CHAT, true).await,
        hold::Answer::Spent(hold::Outcome::Sent { .. })
    ));
    let lines = wait_for_post(&arrived, "/order").await;
    assert_eq!(lines.iter().filter(|line| line.starts_with("POST /order")).count(), 1, "it went once: {lines:?}");
    assert_eq!(arrived.body_of("/lead").as_deref(), None, "and the page's own write is still not mixed in");
    assert_eq!(arrived.body_of("/order").as_deref(), Some("city=Bologna"), "and it went as it was written");
}

/// **A form with no fields is still a card.** Its body is empty, and it is a
/// submission the page made and the person agreed to, not a write the page made
/// by itself.
#[tokio::test]
async fn a_form_with_no_fields_is_still_held_and_only_the_person_sends_it() {
    let (base, arrived) = common::serve(&[common::page(&page_with(""))]).await;
    let (_sessions, page, holds) = common::confirming_window("background-empty-form", &base).await;

    let subscribe = ref_of(&page, "subscribe").await;
    let id = clicking(&page, &holds, &subscribe).await;
    let card = holds.card(&id).await.expect("a card");
    assert_eq!(path_of(&card.url), "/subscribe");
    assert!(card.fields.is_empty(), "and it has nothing to show: {:?}", card.fields);
    let lines = arrived.except_icons();
    assert!(!lines.iter().any(|line| line.starts_with("POST")), "the form was not sent: {lines:?}");

    assert!(matches!(
        holds.answer(&id, common::CHAT, true).await,
        hold::Answer::Spent(hold::Outcome::Sent { .. })
    ));
    let lines = wait_for_post(&arrived, "/subscribe").await;
    assert_eq!(lines.iter().filter(|line| line.starts_with("POST /subscribe")).count(), 1, "it went once: {lines:?}");
}

/// **A page that writes by itself does not take the person's queue.** Eight
/// automatic requests go out, and the form the person is asked about is still
/// there to be answered.
#[tokio::test]
async fn a_page_that_writes_by_itself_leaves_the_queue_for_a_real_form() {
    let writes: String = (0..8)
        .map(|number| {
            format!("fetch('/collect{number}?en=page_view', {{method: 'POST'}}).catch(() => {{}});")
        })
        .collect();
    let (base, arrived) = common::serve(&[common::page(&page_with(&writes))]).await;
    let (_sessions, page, holds) = common::confirming_window("background-queue", &base).await;

    let lines = wait_for_posts(&arrived, "/collect", 8).await;
    assert_eq!(
        lines.iter().filter(|line| line.starts_with("POST /collect")).count(),
        8,
        "the page wrote eight times, and every one went out: {lines:?}"
    );
    assert_eq!(holds.waiting().await, 0, "and none of them took a place");

    let city = ref_of(&page, "the city").await;
    let before = holds.ids().await;
    let (filled, _) = mcp::acting(
        &page,
        &holds,
        common::CHAT,
        &before,
        common::the_fixture,
        input::fill(&page, &city, "Bologna"),
    )
    .await;
    filled.expect("the field is filled");

    let buy = ref_of(&page, "buy it").await;
    let id = clicking(&page, &holds, &buy).await;
    assert!(holds.card(&id).await.is_some(), "the form is a card the person can answer");
    assert!(matches!(
        holds.answer(&id, common::CHAT, true).await,
        hold::Answer::Spent(hold::Outcome::Sent { .. })
    ));
    let lines = wait_for_post(&arrived, "/order").await;
    assert_eq!(lines.iter().filter(|line| line.starts_with("POST /order")).count(), 1, "it went once: {lines:?}");
}
