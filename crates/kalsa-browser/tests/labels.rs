//! The words a page puts beside a field reach the card, cleaned, and the card
//! still shows the request exactly as it would be sent.
//!
//! The fixture is served on this computer's own network, which the guard refuses,
//! so these run through `common::confirming_window` — the same stand-in the other
//! hold proofs use for the address decision and nothing else.

mod common;

use kalsa_browser::{hold, input, mcp, snapshot};
use playwright_rs::protocol::Page;

/// Every way a page labels a field, one per field, and one that labels nothing.
const FORM: &str = r#"
  <h1>the form</h1>
  <form id="order" action="/order" method="post">
    <label for="city">the city</label>
    <input id="city" name="city" type="text">
    <label>the street <input name="street" type="text"></label>
    <input name="zip" aria-label="the postcode" type="text">
    <span id="ph">the phone</span>
    <input name="phone" aria-labelledby="ph" type="text">
    <input name="note" placeholder="a note for the courier" type="text">
    <label for="pin">the code</label>
    <input id="pin" name="pin" type="password">
    <input name="custname" type="text">
    <label for="hostile">HOSTILE</label>
    <input id="hostile" name="hostile" type="text">
    <button type="submit">send it</button>
  </form>
  <button type="button" onclick="fetch('/order', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'city=Bologna&phone=0123&custname=Giulia'})">send by script</button>
"#;

/// A label a page wrote to be hostile: hidden and reordering characters, and far
/// more text than a card can show.
fn hostile_form() -> String {
    let long = "a".repeat(200);
    FORM.replace(
        "HOSTILE",
        &format!("Via&#8238; evil&#8236;&#7; {long}"),
    )
}

/// The ref of the first snapshot line that names `words`.
async fn ref_of(page: &Page, words: &str) -> String {
    let read = snapshot::snapshot(page, 1).await.expect("the page reads");
    let line = read
        .lines()
        .find(|line| line.contains(words) && line.contains("[e"))
        .unwrap_or_else(|| panic!("no ref on a line {words:?} in:\n{read}"));
    let start = line.find("[e").expect("the line carries a ref");
    let end = start + line[start..].find(']').expect("the ref is closed");
    line[start + 1..end].to_owned()
}

/// The label the card gives a field, by name.
fn label_of(card: &hold::Card, name: &str) -> Option<String> {
    card.fields.iter().find(|field| field.name == name).and_then(|field| field.label.clone())
}

/// The first card the window is holding, once the page has made its write.
async fn held_card(holds: &hold::Holds) -> hold::Card {
    for _ in 0..100 {
        if let Some(card) = holds.cards().await.into_iter().next() {
            return card;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    panic!("no write was held");
}

/// Fills the field named by `words` with `text`, which submits its form through the
/// product's own catcher, and returns the card the submission was held as.
async fn fill_and_held(page: &Page, holds: &hold::Holds, words: &str, text: &str) -> hold::Card {
    let target = ref_of(page, words).await;
    let before = holds.ids().await;
    let (filled, held) = mcp::acting(page, holds, common::CHAT, &before, common::the_fixture, input::fill(page, &target, text)).await;
    assert!(filled.is_ok(), "the field is filled: {:?}", filled.as_ref().err().map(|refused| refused.reason()));
    let id = held.expect("the submit is held");
    holds.card(&id).await.expect("the card the person reads")
}

/// **A label that echoes what the person typed into a secret field is not drawn.** The
/// page here writes the typed password into a label around a text field; the card shows
/// the password as dots in its own field and must not show it again in that label.
#[tokio::test]
async fn a_label_that_echoes_a_typed_secret_is_not_drawn() {
    const ECHO: &str = r#"
      <form id="order" action="/order" method="post">
        <label for="city">Città hunter2</label>
        <input id="city" name="city" type="text">
        <input id="pw" name="pw" type="password">
        <button type="submit">send it</button>
      </form>
    "#;
    let (base, _arrived) = common::serve(&[common::page(ECHO)]).await;
    let (_sessions, page, holds) = common::confirming_window("labels-echo", &base).await;
    // The person types the password, in the page, the way a keyboard would.
    page.evaluate::<(), ()>(
        "() => { const pw = document.getElementById('pw'); pw.value = 'hunter2'; pw.dispatchEvent(new Event('input', { bubbles: true })); }",
        None,
    )
    .await
    .expect("the person types");
    let card = fill_and_held(&page, &holds, "Città", "Bologna").await;
    assert_eq!(label_of(&card, "city"), None, "the label carries the typed password, so the name is drawn");
    assert!(card.fields.iter().find(|field| field.name == "pw").expect("the password").secret, "and the password is still dotted");
}

/// **A name carried by more than one control has no label.** A group of checkboxes that
/// share a name has no single label that is the field's: each checkbox's words are its
/// own, so the group is drawn with its name and the one field that is unambiguous keeps
/// its label.
#[tokio::test]
async fn a_name_on_more_than_one_control_gets_no_label() {
    const GROUP: &str = r#"
      <form id="order" action="/order" method="post">
        <label for="city">the city</label>
        <input id="city" name="city" type="text">
        <input id="ca" type="checkbox" name="tag" value="a"><label for="ca">Rosso</label>
        <input id="cb" type="checkbox" name="tag" value="b"><label for="cb">Verde</label>
        <button type="submit">send it</button>
      </form>
    "#;
    let (base, _arrived) = common::serve(&[common::page(GROUP)]).await;
    let (_sessions, page, holds) = common::confirming_window("labels-group", &base).await;
    page.evaluate::<(), ()>("() => { document.getElementById('ca').checked = true; document.getElementById('cb').checked = true; }", None)
        .await
        .expect("the boxes are ticked");
    let card = fill_and_held(&page, &holds, "the city", "Bologna").await;
    assert_eq!(card.fields.iter().filter(|field| field.name == "tag").count(), 2, "both boxes are sent");
    assert!(card.fields.iter().filter(|field| field.name == "tag").all(|field| field.label.is_none()), "neither box's words is the group's");
    assert_eq!(label_of(&card, "city").as_deref(), Some("the city"), "an unambiguous name keeps its label");
}

/// **Only what the person can see is a label.** A `display:none` span inside a label
/// is not part of its words, a hidden input's placeholder is not its label, and an
/// aria-label is not a visible word at all.
#[tokio::test]
async fn hidden_text_is_not_a_label() {
    const HIDDEN: &str = r#"
      <form id="order" action="/order" method="post">
        <label for="zip">CAP<span style="display:none"> SEGRETO</span></label>
        <input id="zip" name="zip" type="text">
        <input name="hid" type="text" style="display:none" placeholder="a placeholder nobody sees">
        <input name="aria" type="text" aria-label="invisible words">
        <input name="city" type="text" aria-label="also invisible">
        <button type="submit">send it</button>
      </form>
    "#;
    let (base, _arrived) = common::serve(&[common::page(HIDDEN)]).await;
    let (_sessions, page, holds) = common::confirming_window("labels-hidden", &base).await;
    page.evaluate::<(), ()>("() => { for (const el of document.querySelectorAll('#order input')) el.value = el.name; }", None)
        .await
        .expect("the page is filled");
    let card = fill_and_held(&page, &holds, "textbox \"CAP\"", "12345").await;
    assert_eq!(label_of(&card, "zip").as_deref(), Some("CAP"), "the words a person reads, and only those");
    assert_eq!(label_of(&card, "hid"), None, "a placeholder on a field nobody sees is not its label");
    assert_eq!(label_of(&card, "aria"), None, "an aria-label is not a visible word");
}

/// **A write made by the page of one document is not labelled from another.** The page
/// is read on page A; the window then goes to page B, which posts on arrival. B's write
/// is drawn with its names, because the words read on A are not B's.
#[tokio::test]
async fn a_write_from_another_document_is_labelled_by_nothing() {
    const A: &str = r#"<h1>a</h1><label for="city">the city</label><input id="city" name="city" type="text"><a href="/b">next page</a>"#;
    const B: &str = r#"<h1>b</h1><script>fetch('/order', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'city=Bologna'});</script>"#;
    let (base, _arrived) = common::serve(&[common::page(A), common::page_at("/b", B)]).await;
    let (_sessions, page, holds) = common::confirming_window("labels-stale", &base).await;
    // Page A is read by the call that acts on it, and that call navigates to page B.
    let next = ref_of(&page, "next page").await;
    let before = holds.ids().await;
    let (clicked, _) = mcp::acting(&page, &holds, common::CHAT, &before, common::the_fixture, input::click(&page, &next)).await;
    clicked.expect("the link is followed");
    let card = held_card(&holds).await;
    assert_eq!(card.fields.iter().find(|field| field.name == "city").expect("the city").value, "Bologna", "what was sent is shown");
    assert_eq!(label_of(&card, "city"), None, "page A's words are not page B's: the name is drawn");
}

/// **A name is secret when any control carrying it is.** A text box and a password box
/// sharing a name are one field to the site, so both entries are dotted.
#[tokio::test]
async fn a_name_with_a_secret_control_is_secret_in_every_entry() {
    const SHARED: &str = r#"
      <form id="order" action="/order" method="post">
        <label for="city">the city</label>
        <input id="city" name="city" type="text">
        <input name="code" type="text">
        <input name="code" type="password">
        <button type="submit">send it</button>
      </form>
    "#;
    let (base, _arrived) = common::serve(&[common::page(SHARED)]).await;
    let (_sessions, page, holds) = common::confirming_window("labels-shared", &base).await;
    page.evaluate::<(), ()>(
        "() => { const codes = document.querySelectorAll('input[name=code]'); codes[0].value = '1234'; codes[1].value = '5678'; }",
        None,
    )
    .await
    .expect("the page is filled");
    let card = fill_and_held(&page, &holds, "the city", "Bologna").await;
    let codes: Vec<_> = card.fields.iter().filter(|field| field.name == "code").collect();
    assert_eq!(codes.len(), 2, "both entries are sent");
    assert!(codes.iter().all(|field| field.secret), "and both are dotted: {codes:?}");
}

/// **A body whose text is not UTF-8 is refused, not shown with replacement characters.**
/// The page sends the bytes `city=\xFF`; no card is made and nothing reaches the server.
#[tokio::test]
async fn a_body_that_is_not_text_is_refused_and_never_sent() {
    let (base, arrived) = common::serve(&[common::page("<h1>the shop</h1>")]).await;
    let (_sessions, page, holds) = common::confirming_window("labels-bytes", &base).await;
    page.evaluate::<(), ()>(
        &format!("() => {{ fetch('{base}/order', {{method: 'POST', headers: {{'Content-Type': 'application/x-www-form-urlencoded'}}, body: new Uint8Array([99, 105, 116, 121, 61, 255])}}); }}"),
        None,
    )
    .await
    .expect("the page runs the write");
    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
    assert!(holds.cards().await.is_empty(), "no card is made from bytes that are not text");
    assert_eq!(arrived.body_of("/order"), None, "and nothing reached the server");
}

/// **A form the person submits: the labels the page gives its fields reach the card.**
/// Each way of labelling a field is covered, and a field with no words is left with
/// none — so the card will draw its name, not an invented label.
#[tokio::test]
async fn a_submitted_form_carries_the_words_the_page_gives_each_field() {
    let (base, _arrived) = common::serve(&[common::page(&hostile_form())]).await;
    let (_sessions, page, holds) = common::confirming_window("labels-form", &base).await;

    // Values for everything, so the card has something to show for each field.
    page.evaluate::<(), ()>(
        "() => { for (const el of document.querySelectorAll('#order input')) el.value = el.name; }",
        None,
    )
    .await
    .expect("the page is filled");
    let city = ref_of(&page, "the city").await;
    let before = holds.ids().await;
    let (filled, held) = mcp::acting(&page, &holds, common::CHAT, &before, common::the_fixture, input::fill(&page, &city, "Bologna")).await;
    assert!(filled.is_ok(), "the field is filled");
    let id = held.expect("the submit is held");

    let card = holds.card(&id).await.expect("the card the person reads");
    assert_eq!(label_of(&card, "city").as_deref(), Some("the city"), "a <label for>");
    assert_eq!(label_of(&card, "street").as_deref(), Some("the street"), "a wrapping <label>");
    // aria-label and aria-labelledby are not words a person can see on the page, so they
    // are not the label: these two fields are drawn with their names.
    assert_eq!(label_of(&card, "zip"), None, "an aria-label is not a visible label");
    assert_eq!(label_of(&card, "phone"), None, "an aria-labelledby is not a visible label");
    assert_eq!(label_of(&card, "note").as_deref(), Some("a note for the courier"), "a placeholder, the last resort");
    assert_eq!(label_of(&card, "custname"), None, "a field with no words is drawn with its name");
    assert_eq!(label_of(&card, "pin").as_deref(), Some("the code"), "a secret is labelled too");
    assert!(card.fields.iter().find(|field| field.name == "pin").expect("the code").secret, "and still a secret");
    assert!(card.fields.iter().find(|field| field.name == "city").expect("the city").value == "Bologna", "the value is as sent");

    let hostile = label_of(&card, "hostile").expect("a hostile label is still a label");
    assert!(hostile.chars().count() <= 60, "capped at sixty characters: {hostile:?}");
    assert!(!hostile.chars().any(|c| c.is_control() || ('\u{202A}'..='\u{202E}').contains(&c)), "stripped: {hostile:?}");
    assert!(hostile.starts_with("Via evil"), "the words that were there are kept: {hostile:?}");
}

/// **A write the page makes itself is labelled from the page it came from**, by name:
/// a field the page labels gets its words, and a field it does not gets none.
#[tokio::test]
async fn a_scripted_write_is_labelled_from_the_page_it_came_from() {
    let (base, _arrived) = common::serve(&[common::page(FORM)]).await;
    let (_sessions, page, holds) = common::confirming_window("labels-route", &base).await;

    // The write is made by the page's own script, caused by a click the person (or
    // the model) makes, so the labels are read for that click.
    let send = ref_of(&page, "send by script").await;
    let before = holds.ids().await;
    let (clicked, held) = mcp::acting(&page, &holds, common::CHAT, &before, common::the_fixture, input::click(&page, &send)).await;
    clicked.expect("the click lands");
    let id = held.expect("the scripted write is held");

    let card = holds.card(&id).await.expect("the card the person reads");
    assert_eq!(label_of(&card, "city").as_deref(), Some("the city"));
    assert_eq!(label_of(&card, "phone"), None, "an aria-labelledby is not a visible label, here either");
    assert_eq!(label_of(&card, "custname"), None, "no label in the document, so none on the card");
    assert_eq!(card.fields.iter().find(|field| field.name == "custname").expect("the field").value, "Giulia");
}

/// **The labels belong to the address they were read at, even without a navigation.** The
/// page changes its address with `history.pushState`, which is not a navigation request,
/// and then posts from the same document: the words read at the old address are not
/// the words of the new one, so the card draws the names.
#[tokio::test]
async fn a_write_after_the_address_changed_without_a_navigation_is_labelled_by_nothing() {
    const PUSH: &str = r#"
      <form id="order" action="/order" method="post">
        <label for="city">the city</label>
        <input id="city" name="city" type="text">
        <button type="button" onclick="history.pushState({}, '', '/elsewhere'); fetch('/order', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'city=Bologna'})">go on</button>
      </form>
    "#;
    let (base, _arrived) = common::serve(&[common::page(PUSH)]).await;
    let (_sessions, page, holds) = common::confirming_window("labels-push", &base).await;
    let go = ref_of(&page, "go on").await;
    let before = holds.ids().await;
    let (clicked, _) = mcp::acting(&page, &holds, common::CHAT, &before, common::the_fixture, input::click(&page, &go)).await;
    clicked.expect("the button is pressed");
    let card = held_card(&holds).await;
    assert_eq!(label_of(&card, "city"), None, "the words were read at the old address: the name is drawn");
}

