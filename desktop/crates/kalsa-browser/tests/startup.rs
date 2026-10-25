//! The page's own startup, and every write that comes after it.
//!
//! A page's own request — a fetch, an XHR, a beacon — is not the person acting,
//! and it goes out like a normal browser's lets it go: while the page is still
//! loading, after the model has read it, after the model has acted on it. What
//! it carries of the person's is the exception, and it is held.

mod common;

use common::write::{path_of, ref_of, two_sites, wait_for_card, wait_for_post, wait_for_posts, Sites};
use kalsa_browser::hold;
use kalsa_browser::input;
use kalsa_browser::mcp;
use kalsa_browser::snapshot;
use playwright_rs::protocol::Page;

/// **A page whose content appears only once its own write has gone out.** This
/// is the shape a site's challenge has: the handshake is answered, and then the
/// page is served. The handshake is a JavaScript expression, so a page can
/// write to another site under another name.
fn gated(handshake: &str) -> String {
    format!(
        r#"
<h1 id="gate">waiting for the handshake</h1>
<script>
  fetch({handshake}, {{method: 'POST', headers: {{'Content-Type': 'application/x-www-form-urlencoded'}}, body: 'solution=the-pages-own'}})
    .then(() => {{ document.getElementById('gate').textContent = 'the page is served'; }})
    .catch(() => {{ document.getElementById('gate').textContent = 'the page is served'; }});
</script>
"#
    )
}

/// **The handshake to the same server under another name.** The port is the
/// one the page is already on, and only the host name is another.
const ANOTHER_NAME: &str =
    "location.protocol + '//' + location.host.replace('127.0.0.1', 'localhost') + '/handshake'";

/// **A page with a control to press and a write of its own.** The write carries
/// ordinary contact data: a name and a note, and nothing secret in them.
fn page_with_a_write() -> String {
    r#"
<h1>the page that writes on its own</h1>
<button type="button" id="press">press me</button>
<label for="note">a note</label>
<input id="note" name="note" type="text">
<script>
  window.writeIt = (where) => {
    fetch(where + '/lead', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'name=giulia&note=hello there'}).catch(() => {});
  };
</script>
"#
    .to_owned()
}

/// **A page whose own button sends the note.** The body is ordinary contact
/// data, and it is the page's handler that sends it.
fn page_with_a_handler() -> String {
    r#"
<h1>the page with a note to send</h1>
<button type="button" onclick="fetch('/comment', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'name=giulia&note=hello there'})">send the note</button>
"#
    .to_owned()
}

/// A write the page makes, to the site's the person is on and to another one.
async fn writing_to_both_sites(page: &Page, sites: &Sites) {
    page.evaluate::<String, ()>(
        r#"where => {
            window.writeIt(where);
            window.writeIt(where.replace('127.0.0.1', 'localhost'));
        }"#,
        Some(&sites.base),
    )
    .await
    .ok();
}

/// **What the person is told, and what the server has received.** A card and
/// an arrival are two different claims, and a proof about a write that went out
/// needs both: the server says it arrived, and the person says they were asked
/// about nothing.
async fn went_out_and_nobody_asked(holds: &hold::Holds, sites: &Sites, path: &str, how_many: usize) {
    let lines = wait_for_posts(&sites.arrived, path, how_many).await;
    let sent = lines.iter().filter(|line| line.starts_with(&format!("POST {path}"))).count();
    assert_eq!(sent, how_many, "the write went out: {lines:?}");
    assert_eq!(holds.waiting().await, 0, "and the person is asked about nothing");
    assert!(holds.cards().await.is_empty(), "and there is no card");
    assert!(holds.take_outcomes(common::CHAT).await.is_empty(), "and the model is not told");
}

/// **A write the page makes while it is loading goes out, and the page is
/// served.** The handshake a site makes the browser answer before it serves
/// anything is the page's own business: holding it stops the page from ever
/// existing, and the model is told there is nothing there to work with.
#[tokio::test]
async fn a_boot_write_to_the_same_site_goes_out_and_the_page_is_served() {
    let (base, arrived) = common::serve(&[
        common::page(&gated("'/handshake'")),
        common::page_at("/handshake", "<h1>the handshake</h1>"),
    ])
    .await;
    let (_sessions, page, holds) = common::window_for("startup-boot-same", &base, None).await;

    let lines = wait_for_post(&arrived, "/handshake").await;
    assert!(lines.iter().any(|line| line.starts_with("POST /handshake")), "the boot write went out: {lines:?}");
    assert_eq!(holds.waiting().await, 0, "and the person is asked about nothing");
    assert!(holds.cards().await.is_empty(), "and there is no card");
    assert!(holds.take_outcomes(common::CHAT).await.is_empty(), "and the model is not told");

    // The page is served because the write went out: its content is there only
    // once the handshake has been answered.
    let read = snapshot::snapshot(&page, 1).await.expect("the page reads");
    assert!(read.contains("the page is served"), "the page is served: {read}");
}

/// **The same, for a write that goes to another site.** The rule is about the
/// page's own bytes, not about where they go.
#[tokio::test]
async fn a_boot_write_to_another_site_goes_out_and_the_page_is_served() {
    let sites = two_sites(&[
        common::page(&gated(ANOTHER_NAME)),
        common::page_at("/handshake", "<h1>the handshake</h1>"),
    ])
    .await;
    let (_sessions, page, holds) = common::window_for("startup-boot-other", &sites.base, Some(&sites.other)).await;

    let lines = wait_for_post(&sites.arrived, "/handshake").await;
    assert!(lines.iter().any(|line| line.starts_with("POST /handshake")), "the boot write went out: {lines:?}");
    assert_eq!(holds.waiting().await, 0, "and the person is asked about nothing");
    assert!(holds.cards().await.is_empty(), "and there is no card");

    let read = snapshot::snapshot(&page, 1).await.expect("the page reads");
    assert!(read.contains("the page is served"), "the page is served: {read}");
}

/// **A write the page makes after it has been read goes out — to the site's the
/// person is on and to another one alike.** The bytes are ordinary: a name and
/// a note, and nothing secret in them.
#[tokio::test]
async fn a_write_after_the_page_has_been_read_goes_out_wherever_it_goes() {
    let sites = two_sites(&[common::page(&page_with_a_write()), common::page_at("/lead", "<h1>the lead</h1>")]).await;
    let (_sessions, page, holds) = common::window_for("startup-after-read", &sites.base, Some(&sites.other)).await;

    writing_to_both_sites(&page, &sites).await;
    went_out_and_nobody_asked(&holds, &sites, "/lead", 2).await;
}

/// **A write after a click goes out too.** The model is acting on the page, and
/// the page's own writes are nobody's business either way.
#[tokio::test]
async fn a_write_after_a_click_goes_out_wherever_it_goes() {
    let sites = two_sites(&[common::page(&page_with_a_write()), common::page_at("/lead", "<h1>the lead</h1>")]).await;
    let (_sessions, page, holds) = common::window_for("startup-after-click", &sites.base, Some(&sites.other)).await;

    let press = ref_of(&page, "press me").await;
    let before = holds.ids().await;
    let (clicked, _held) =
        mcp::acting(&page, &holds, common::CHAT, &before, common::the_fixture, input::click(&page, &press)).await;
    clicked.expect("the click lands");

    writing_to_both_sites(&page, &sites).await;
    went_out_and_nobody_asked(&holds, &sites, "/lead", 2).await;
}

/// **A write after a typing goes out as well.**
#[tokio::test]
async fn a_write_after_a_typing_goes_out_wherever_it_goes() {
    let sites = two_sites(&[common::page(&page_with_a_write()), common::page_at("/lead", "<h1>the lead</h1>")]).await;
    let (_sessions, page, holds) = common::window_for("startup-after-typing", &sites.base, Some(&sites.other)).await;

    let note = ref_of(&page, "a note").await;
    let before = holds.ids().await;
    let (filled, _held) =
        mcp::acting(&page, &holds, common::CHAT, &before, common::the_fixture, input::fill(&page, &note, "hello there")).await;
    filled.expect("the field is filled");

    writing_to_both_sites(&page, &sites).await;
    went_out_and_nobody_asked(&holds, &sites, "/lead", 2).await;
}

/// **A write that carries what the person typed is held, wherever it goes.** The
/// rule is about the page's own bytes; a secret is the person's, and it is held.
#[tokio::test]
async fn a_write_carrying_what_the_person_typed_is_still_held() {
    let (base, arrived) = common::serve(&[common::page(&page_with_a_write())]).await;
    let (_sessions, page, holds) = common::window_for("startup-boot-secret", &base, None).await;
    holds.typed_in(1, "hunter2-the-passphrase").await;

    page.evaluate::<(), ()>(
        r#"() => {
            fetch('/lead', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'name=giulia&note=hunter2-the-passphrase'}).catch(() => {});
        }"#,
        None,
    )
    .await
    .ok();

    let card = wait_for_card(&holds).await;
    assert_eq!(path_of(&card.url), "/lead");
    let lines = arrived.except_icons();
    assert!(!lines.iter().any(|line| line.starts_with("POST")), "nothing was sent: {lines:?}");
}

/// **A page's own handler that sends a write goes out, and raises no card.** The
/// bytes are ordinary contact data, and they are the page's to send: the
/// request is not a submission the person has to answer for.
#[tokio::test]
async fn a_javascript_handler_that_sends_a_write_goes_out_and_raises_no_card() {
    let (base, arrived) = common::serve(&[common::page(&page_with_a_handler())]).await;
    let (_sessions, page, holds) = common::confirming_window("startup-handler", &base).await;

    let send = ref_of(&page, "send the note").await;
    let before = holds.ids().await;
    let (clicked, held) =
        mcp::acting(&page, &holds, common::CHAT, &before, common::the_fixture, input::click(&page, &send)).await;
    clicked.expect("the click lands");
    assert!(held.is_none(), "and the click raises no card: {held:?}");

    let lines = wait_for_post(&arrived, "/comment").await;
    assert!(lines.iter().any(|line| line.starts_with("POST /comment")), "the write went out: {lines:?}");
    assert_eq!(holds.waiting().await, 0, "and the person is asked about nothing");
    assert!(holds.cards().await.is_empty(), "and there is no card");
    assert!(holds.take_outcomes(common::CHAT).await.is_empty(), "and the model is not told");
}
