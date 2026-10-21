//! Filling a field, on a page with every shape a field can have.
//!
//! The rule itself is decided by a pure function and proved as one in
//! `input.rs`. What can only be proved here is the half that touches the page:
//! that the three facts read out of the real DOM are the ones the rule reads,
//! and that a password field is refused before anything is typed into it.

mod common;

use kalsa_browser::input::Refused;
use kalsa_browser::{input, snapshot};
use playwright_rs::protocol::{Page, Playwright};
use std::time::Duration;

/// **Every address in here is one no machine has a handler for.** The rule is
/// about the *class* — anything that is not http, https or relative — and
/// `kalsaprobe:` is in the same class as `mailto:`, which is the point: a test
/// that names a real one proves exactly the same thing and hands the address to
/// the person's mail client while it runs. That is not a risk worth taking for
/// a proof, and it has already happened: an Enter key that reached the browser
/// with a `mailto:` `formaction` opened a compose window on every run of this
/// file. `mailto:` itself is still refused on every path that reads a destination
/// — a click, the re-check before Enter, and the window's own listeners — and the
/// scheme rule itself is over a table in `tests/addresses.rs`.
const SHAPES: &str = r#"
  <form action="/posted">
    <label for="inside">one line inside a form</label>
    <input id="inside" type="text">
    <label for="address">an email inside a form</label>
    <input id="address" type="email">
    <label for="telephone">a telephone inside a form</label>
    <input id="telephone" type="tel">
    <label for="the-day">the day of the event</label>
    <input id="the-day" type="date">
    <label for="secret">the secret word</label>
    <input id="secret" type="password" autocomplete="off">
    <label for="long">a long answer</label>
    <textarea id="long"></textarea>
  </form>
  <label for="outside">one line with no form</label>
  <input id="outside" type="text">
  <!-- A search field in a form keeps Enter, and the form is what it submits —
       so the page says it happened rather than navigating off the fixture. -->
  <form id="searching" action="/posted" onsubmit="window.searchSubmitted = true; return false">
    <label for="searcher">a search inside a form</label>
    <input id="searcher" type="search">
  </form>
  <div id="editable" contenteditable="true">an editable answer</div>
  <label for="choice">a choice of answers</label>
  <select id="choice"><option>the first</option><option>the second</option></select>
  <label for="flipper">a field that turns on focus</label>
  <input id="flipper" type="text" onfocus="this.type='password'">
  <label for="otp">a one time code field</label>
  <input id="otp" type="text" autocomplete="one-time-code">
  <label for="email me">write to giulia</label>
  <a id="mailto-link" href="kalsaprobe://giulia@example.com">write to giulia</a>
  <label for="call me">call the shop</label>
  <a id="tel-link" href="kalsaprobe-call:+390000000000">call the shop</a>
  <label for="do it">do it now</label>
  <a id="script-link" href="javascript:void(0)">do it now</a>
  <form id="trap" action="https://example.com/collect">
    <label for="sent-away">a form that posts somewhere else</label>
    <input id="sent-away" type="text">
    <button type="submit" formaction="kalsaprobe://shop">send it</button>
  </form>
  <label for="the swapper">a link that changes on mousedown</label>
  <a id="swapper" href="/open" onmousedown="this.href='kalsaprobe://shop'">open it</a>
  <form id="far" action="kalsaprobe://shop">
    <label for="traveller">a field attached to the far form</label>
    <input id="traveller" type="text" form="far">
    <label for="far-searcher">a search attached to the far form</label>
    <input id="far-searcher" type="search" form="far">
  </form>
  <map name="office"><area id="office-area" shape="rect" coords="0,0,9,9" href="kalsaprobe://shop" alt="the office map"></map>
  <img id="plan" usemap='#office' alt="a floor plan">
  <svg width="60" height="20" xmlns="http://www.w3.org/2000/svg">
    <a id="sign" xlink:href="kalsaprobe://shop"><rect width="60" height="20"></rect><text x="2" y="14">the drawn sign</text></a>
  </svg>
  <form id="by-image" action="/posted">
    <label for="with-image">a field in the image form</label>
    <input id="with-image" type="text">
    <label for="image-searcher">a search in the image form</label>
    <input id="image-searcher" type="search">
    <input id="picture" type="image" alt="the picture button" src="/x.png" formaction="kalsaprobe://shop">
  </form>
  <form id="icon-form" action="kalsaprobe://shop">
    <button type="submit"><svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"></rect></svg><span id="icon-text">send the form</span></button>
  </form>
  <form id="labelled" action="/posted">
    <input id="hidden-submit" type="submit" formaction="kalsaprobe://shop" value="go">
    <label id="its-label" for="hidden-submit">a label for a submit input</label>
  </form>
  <form id="odd-method" method="weird" action="/posted">
    <label for="odd">a field in a method form</label>
    <input id="odd" type="text">
    <label for="odd-searcher">a search in a method form</label>
    <input id="odd-searcher" type="search">
  </form>
"#;

/// The page the model would actually be holding: a read, and the refs in it.
/// The ref a read printed for an element, found by the name it can see.
fn ref_of_text(read: &str, name: &str) -> String {
    let line = read
        .lines()
        .find(|line| line.contains(name) && line.contains("[e"))
        .unwrap_or_else(|| panic!("no read line names {name}:\n{read}"));
    let open = line.find('[').expect("a ref in brackets");
    let close = line[open..].find(']').expect("a closed ref") + open;
    line[open + 1..close].to_string()
}

async fn page_with_shapes(name: &str) -> (Playwright, Page) {
    let (base, _arrived) = common::serve(&[common::page(SHAPES)]).await;
    let (playwright, _context, page) = common::browser_on(name, &base).await;
    page.goto(&base, None).await.expect("the page loads");
    (playwright, page)
}

/// The ref a read printed for an element, found the way a model finds it: by
/// the name it can see. Going through the read is the point — a ref invented
/// here would prove nothing about the ones the model is given.
async fn ref_of(page: &Page, name: &str) -> String {
    let read = snapshot::snapshot(page, 1).await.expect("the page reads");
    // A label reads as its own line, so the ref wanted is the one on the line
    // that carries an element to act on.
    let line = read
        .lines()
        .find(|line| line.contains(name) && line.contains("[e"))
        .unwrap_or_else(|| panic!("no read line names {name} with a ref:\n{read}"));
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

/// Native date assignment can clear an unsupported value without throwing.
/// The call must report that rejection and still permit a valid date or a clear.
#[tokio::test]
async fn a_date_field_that_did_not_take_the_text_is_refused() {
    let (base, arrived) = common::serve(&[common::page(SHAPES)]).await;
    let (_playwright, _context, page) = common::browser_on("input-date", &base).await;
    page.goto(&base, None).await.expect("the page loads");

    let reference = ref_of(&page, "the day of the event").await;
    let refused =
        input::fill(&page, &reference, "30/10/2026").await.expect_err("the field did not take that text");
    assert_eq!(refused, Refused::DateFormat);
    assert_eq!(value_of(&page, &reference).await, "", "and the field is still empty");

    // The native format is the one it takes.
    input::fill(&page, &reference, "2026-10-30").await.expect("a date field takes YYYY-MM-DD");
    assert_eq!(value_of(&page, &reference).await, "2026-10-30");

    // And clearing a field on purpose is not a refusal.
    input::fill(&page, &reference, "").await.expect("clearing a field is allowed");
    assert_eq!(value_of(&page, &reference).await, "");

    assert!(!arrived.asked_for("/posted"), "and nothing was submitted");
}

/// Opens a page and waits until it has finished loading, so a read taken after
/// this is a read of the page and not of a half-built one. A one-link page is
/// small enough that the accessibility tree can be asked for before it is built,
/// and a read that finds nothing is not a finding about the page.
async fn settle(page: &Page, url: &str) {
    page.goto(url, None).await.expect("the page loads");
    let _ = page.wait_for_load_state(Some(playwright_rs::protocol::WaitUntil::Load)).await;
    tokio::time::sleep(Duration::from_millis(200)).await;
}

/// The shapes the plan names, asked in the order that costs least: a field that
/// is not pressed leaves the page exactly where it was, so the ones after it can
/// still be filled.
///
/// **Enter follows a field that is in no form, and leaves a field that is in one
/// alone.** TodoMVC, a chat box and a search box are the first; a form goes on
/// its own submit button.
#[tokio::test]
async fn a_field_in_a_form_is_left_alone_and_one_in_no_form_is_pressed() {
    let (_playwright, page) = page_with_shapes("input-shapes").await;

    for (name, why) in [
        ("a long answer", "a textarea holds several lines by design"),
        ("an editable answer", "an editable block is not an input"),
    ] {
        let reference = ref_of(&page, name).await;
        let pressed = input::fill(&page, &reference, "an answer").await.expect("the field is filled");
        assert!(!pressed, "{name} must not press Enter: {why}");
    }

    // A `<select>` never reaches the rule: there is nothing to type into it, so
    // the fill is refused outright rather than written and left unpressed.
    let reference = ref_of(&page, "a choice of answers").await;
    assert_eq!(
        input::fill(&page, &reference, "an answer").await.expect_err("a select cannot be typed into"),
        Refused::NotFillable
    );

    for name in ["one line inside a form", "an email inside a form", "a telephone inside a form"] {
        let reference = ref_of(&page, name).await;
        let pressed = input::fill(&page, &reference, "an answer").await.expect("the field is filled");
        assert!(!pressed, "{name} is in a form, and a form is submitted by its own button");
        let written: String = page
            .locator(format!("aria-ref={reference}"))
            .evaluate::<String, ()>("el => el.value", None)
            .await
            .expect("the page answers");
        assert_eq!(written, "an answer", "{name} is filled all the same, and left alone");
    }

    let reference = ref_of(&page, "one line with no form").await;
    let pressed = input::fill(&page, &reference, "an answer").await.expect("the field is filled");
    assert!(pressed, "a page whose keydown commits the text is finished by Enter, form or no form");

    // **A search field is the one that keeps Enter inside a form**, and this is
    // what it costs: the key really does submit that form.
    let reference = ref_of(&page, "a search inside a form").await;
    let pressed = input::fill(&page, &reference, "a question").await.expect("the field is filled");
    assert!(pressed, "type=search is a page asking for Enter to mean something");
    let submitted: bool = page
        .evaluate::<(), bool>("() => window.searchSubmitted === true", None)
        .await
        .expect("the page answers");
    assert!(submitted, "and the form it belongs to was submitted, which is the whole of what it is for");
}

/// A password field is refused before it is filled, and the model is told to ask
/// the person rather than to try again.
#[tokio::test]
async fn a_password_field_is_never_typed_into() {
    let (_playwright, page) = page_with_shapes("input-password").await;
    let reference = ref_of(&page, "the secret word").await;

    let refused = input::fill(&page, &reference, "hunter2").await.expect_err("a password field is refused");
    assert!(matches!(refused, input::Refused::Password), "got {refused:?}");
    assert!(refused.reason().contains("person"), "{}", refused.reason());
    assert!(!refused.reason().contains("hunter2"), "the value must not be echoed");

    let typed: String = page
        .evaluate::<(), String>("() => document.getElementById('secret').value", None)
        .await
        .expect("the page answers");
    assert!(typed.is_empty(), "nothing was typed, the field holds {typed:?}");
}

/// A page can turn a field into a password field the moment it is focused, which
/// is what a page asking for a one-time code looks like from the outside. Read
/// before the focus and the value would go into the field the model was shown.
#[tokio::test]
async fn a_field_that_becomes_a_password_field_when_focused_is_never_typed_into() {
    let (_playwright, page) = page_with_shapes("input-flip").await;
    let reference = ref_of(&page, "a field that turns on focus").await;

    let refused = input::fill(&page, &reference, "hunter2").await.expect_err("it turns on focus");
    assert_eq!(refused, input::Refused::Password);
    let typed: String = page
        .evaluate::<(), String>("() => document.getElementById('flipper').value", None)
        .await
        .expect("the page answers");
    assert!(typed.is_empty(), "the value landed in a password field: {typed:?}");
}

/// A one-time code is a password for one use, and it is the one a page is most
/// likely to talk a model into handing over.
#[tokio::test]
async fn a_one_time_code_field_is_never_typed_into() {
    let (_playwright, page) = page_with_shapes("input-otp").await;
    let reference = ref_of(&page, "a one time code field").await;

    let refused = input::fill(&page, &reference, "123456").await.expect_err("one time codes are refused");
    assert_eq!(refused, input::Refused::Password);
    let typed: String = page
        .evaluate::<(), String>("() => document.getElementById('otp').value", None)
        .await
        .expect("the page answers");
    assert!(typed.is_empty(), "a one-time code was written: {typed:?}");
}

/// A link that would hand the address to another program is refused before the
/// click, so no other program is ever offered it.
#[tokio::test]
async fn a_link_to_another_program_is_refused_before_the_click() {
    let (_playwright, page) = page_with_shapes("input-destinations").await;
    for name in ["write to giulia", "call the shop", "do it now"] {
        let reference = ref_of(&page, name).await;
        let refused = input::click(&page, &reference).await.expect_err("that link is refused");
        assert_eq!(refused, input::Refused::Destination, "{name}");
    }
}

/// Password refusal must happen before either the value or an input event is
/// visible to the page.
#[tokio::test]
async fn a_refused_fill_never_writes_a_value_the_page_can_see() {
    let (_playwright, page) = page_with_shapes("input-nothing-written").await;
    page.evaluate::<(), Vec<String>>(
        r#"() => { const log = []; document.addEventListener('input', e => log.push(e.target.id + '=' + e.target.value), true); window.log = log; return log; }"#,
        None,
    )
    .await
    .expect("the page records every value from here on");

    let reference = ref_of(&page, "the secret word").await;
    let refused = input::fill(&page, &reference, "hunter2").await.expect_err("a password field is refused");
    assert_eq!(refused, input::Refused::Password);

    let seen: Vec<String> = page.evaluate::<(), Vec<String>>("() => window.log", None).await.expect("the page answers");
    assert!(seen.is_empty(), "the page saw {seen:?}");

    let typed: String = page
        .evaluate::<(), String>("() => document.getElementById('secret').value", None)
        .await
        .expect("the page answers");
    assert!(typed.is_empty(), "the value landed anyway: {typed:?}");
}

/// JavaScript contact forms must be fillable without submitting; the destination
/// check belongs to the search field that actually takes Enter.
#[tokio::test]
async fn a_contact_form_that_posts_to_javascript_is_filled_the_way_a_person_fills_one_in() {
    const CONTACT: &str = r#"<form action="javascript:void(0)">
      <label for="first">First Name</label>
      <input id="first" type="text" name="first_name">
      <label for="last">Last Name</label>
      <input id="last" type="text" name="last_name">
      <label for="email">Email Address</label>
      <input id="email" type="email" name="email">
      <label for="comments">Comments</label>
      <textarea id="comments" name="comment"></textarea>
      <label for="subject">Subject</label>
      <input id="subject" type="search" name="subject">
      <button type="submit">Send</button>
    </form>"#;
    let (base, arrived) = common::serve(&[common::page(CONTACT)]).await;
    let (playwright, _context, page) = common::browser_on("input-contact", &base).await;
    settle(&page, &base).await;
    page.evaluate::<(), i32>(
        "() => { window.submitted = 0; document.addEventListener('submit', () => { window.submitted += 1; }); return 0; }",
        None,
    )
    .await
    .expect("the page counts its own submits from here on");

    let here = page.url();
    let loaded = arrived.requests().len();

    for (name, what) in [
        ("First Name", "Marco"),
        ("Last Name", "Rossi"),
        ("Email Address", "aspis.launcher@gmail.com"),
        ("Comments", "a table for four on Friday, please"),
    ] {
        let reference = ref_of(&page, name).await;
        let pressed = input::fill(&page, &reference, what).await.expect("an ordinary contact field is filled");
        assert!(!pressed, "{name} is in a form, so nothing is pressed into it");
        let written: String = page
            .locator(format!("aria-ref={reference}"))
            .evaluate::<String, ()>("el => el.value", None)
            .await
            .expect("the page answers");
        assert_eq!(written, what, "{name} holds what was typed into it");
    }

    let submitted: i32 = page.evaluate::<(), i32>("() => window.submitted", None).await.expect("the page answers");
    assert_eq!(submitted, 0, "a contact form is submitted by its own button");
    assert_eq!(page.url(), here, "the page moved while it was being filled: {}", page.url());
    assert_eq!(arrived.requests().len(), loaded, "nothing was sent: {:?}", arrived.requests());

    // Search takes Enter, so its destination must still be checked.
    let searching = ref_of(&page, "Subject").await;
    let refused = input::fill(&page, &searching, "a booking").await.expect_err("the form's own action is refused");
    assert_eq!(refused, input::Refused::Destination);
    let submitted: i32 = page.evaluate::<(), i32>("() => window.submitted", None).await.expect("the page answers");
    assert_eq!(submitted, 0, "and the key was not pressed, so the form was not submitted");
    drop(playwright);
}

/// **A page that moves its own link between mousedown and click.** The shape that
/// got through, and the one the old version of this test claimed to cover while
/// proving nothing twice: it wrote the page with `set_content`, so the document's
/// address was `about:blank` and the link was refused as unnameable before any
/// click happened; and it drove the link with `el.click()`, which fires **no
/// `mousedown`** — so the handler it was written to catch never ran.
///
/// Three steps, and which layer answers each is the point:
///
///  1. **A real pointer click.** Mousedown, mouseup, click — and the handler moves
///     the destination in between, so the address the browser is about to use is
///     not the one anybody read. The window listener in `external.rs` stops it; the
///     page does not move. **The destination here is `about:blank` rather than a
///     scheme with a handler**, and that is the whole trick: a page moved to
///     `kalsaprobe://` stays where it is whether or not anything refused it, so
///     "the page did not move" would be a claim about nothing. `about:blank` is a
///     page this browser opens by itself, so a navigation that was *not* stopped
///     is visible.
///  2. **The tool's click on the same page, afterwards.** The handler has run now,
///     so the address is in the document and the tool refuses it and says why.
///  3. **An ordinary link on the same page**, which goes — or the rule above would
///     be "refuse every click".
#[tokio::test]
async fn a_link_that_swaps_its_destination_before_the_click_does_not_go() {
    let (base, arrived) = common::serve(&[
        common::page(
            r#"<a id="swapper" href="/next" onmousedown="this.href = 'about:blank'">open it</a>
               <a id="plain" href="/next">just next</a>"#
        ),
        common::page_at("/next", "<h1>next</h1>"),
    ])
    .await;
    let (playwright, _context, page) = common::browser_on("input-swap", &base).await;
    // **Settled before it is read**: a one-link page is small enough that the
    // accessibility tree can be asked for before it is built, and a read that
    // finds nothing is not a finding about the page.
    settle(&page, &base).await;
    let read = kalsa_browser::snapshot::snapshot(&page, 1).await.expect("the page reads");
    let swapper = ref_of_text(&read, "open it");
    let plain = ref_of_text(&read, "just next");

    // **1. The pointer click**, which is where the destination moves.
    let before = arrived.requests().len();
    let here = page.url();
    page.locator(format!("aria-ref={swapper}")).click(None).await.expect("the pointer clicks");
    tokio::time::sleep(Duration::from_millis(600)).await;
    // **The page is asked where it is first**, because that is the claim: reading
    // the link afterwards is only possible if the claim holds.
    assert_eq!(page.url(), here, "a click handler moved the link and the page followed it: {}", page.url());
    let moved_to: String = page
        .evaluate::<(), String>("() => document.getElementById('swapper').getAttribute('href')", None)
        .await
        .expect("the page answers");
    assert_eq!(moved_to, "about:blank", "the handler moves the destination on mousedown, as it says it does");
    assert_eq!(arrived.requests().len(), before, "and nothing went to the server: {:?}", arrived.requests());

    // **2. The tool, on the page as it now is.** The address is in the document,
    // so this one is refused and the model is told rather than nothing happening.
    let refused = input::click(&page, &swapper).await.expect_err("the moved address is refused");
    assert_eq!(refused, input::Refused::Destination, "the tool must refuse the address the page is now offering");


    // **3. And an ordinary link on the same page still goes.**
    input::click(&page, &plain).await.expect("an ordinary address is not a destination");
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(page.url(), format!("{here}next"), "an ordinary address on the person's own site still goes");
    drop(playwright);
}

/// Filling a field must work even when its submit button cannot be activated.
#[tokio::test]
async fn a_form_whose_default_submitter_posts_to_another_program_is_refused_on_the_click() {
    let (_playwright, page) = page_with_shapes("input-formaction").await;
    let field = ref_of(&page, "a form that posts somewhere else").await;

    let pressed = input::fill(&page, &field, "an answer").await.expect("a write is not a navigation");
    assert!(!pressed, "the field is in a form, so nothing is pressed into it");
    let written: String = page
        .evaluate::<(), String>("() => document.getElementById('sent-away').value", None)
        .await
        .expect("the page answers");
    assert_eq!(written, "an answer", "where the form would post does not stop a person filling a field in it");

    // **And where the address is actually followed, it is refused.**
    let button = ref_of(&page, "send it").await;
    let refused = input::click(&page, &button).await.expect_err("the formaction is refused");
    assert_eq!(refused, input::Refused::Destination);
}

/// A click on something that is not there is the model's mistake to fix, and the
/// line says so without repeating what it wrote.
#[tokio::test]
async fn an_element_that_is_not_on_the_page_is_said_plainly() {
    let (_playwright, page) = page_with_shapes("input-gone").await;
    let refused = input::click(&page, "e9999").await.expect_err("there is no such ref");
    assert_eq!(refused.reason(), "the element is not on the page any more: read the page again");
}
/// Enter follows the browser's form association, including the `form` attribute.
#[tokio::test]
async fn a_field_associated_with_a_form_elsewhere_is_judged_by_that_form() {
    let (_playwright, page) = page_with_shapes("input-elsewhere").await;
    let reference = ref_of(&page, "a field attached to the far form").await;

    let pressed = input::fill(&page, &reference, "an answer").await.expect("a write is not a navigation");
    assert!(!pressed, "it is in the far form, so nothing is pressed into it");
    let written: String = page
        .locator(format!("aria-ref={reference}"))
        .evaluate::<String, ()>("el => el.value", None)
        .await
        .expect("the page answers");
    assert_eq!(written, "an answer", "the field is filled whatever form the key would have submitted");

    let searching = ref_of(&page, "a search attached to the far form").await;
    let refused = input::fill(&page, &searching, "an answer").await.expect_err("the far form is refused");
    assert_eq!(refused, input::Refused::Destination, "Enter would have gone to the far form's action");
}

/// An image map area is a link whose address lives in `href` on an `<area>`
/// inside a `<map>` — not on an `<a>`, which is what a selector written for
/// anchors would find.
///
/// Chrome gives an area no node in the accessibility tree: the image keeps the
/// ref and the area's own name is never printed. So the model cannot name an
/// area and cannot click one. The rule still reads `area[href]`, and
/// `the_destination_rule_is_read_from_the_one_definition` in `external.rs` is
/// what keeps that clause from being dropped; this is the layer behind that
/// layer.
#[tokio::test]
async fn a_read_never_names_an_image_map_area() {
    let (_playwright, page) = page_with_shapes("input-area").await;
    let read = snapshot::snapshot(&page, 1).await.expect("the page reads");

    assert!(read.contains("a floor plan"), "the image itself is in the page: {read}");
    assert!(
        !read.contains("the office map"),
        "an area got a ref, and a ref is the only way to ask for a click: {read}"
    );
}

/// An SVG anchor is a link whose `href` is an `SVGAnimatedString`, not a plain
/// attribute, so reading it the way an HTML anchor is read finds nothing.
#[tokio::test]
async fn an_svg_link_to_another_program_is_refused() {
    let (_playwright, page) = page_with_shapes("input-svg").await;
    let reference = ref_of(&page, "the drawn sign").await;

    let refused = input::click(&page, &reference).await.expect_err("the SVG link is refused");
    assert_eq!(refused, input::Refused::Destination);
}

/// An image button submits its form when it is **clicked**, and then it is the
/// submitter: its own `formaction` is where the click goes, so it is read on the
/// element's own two attributes.
///
/// **It is a submit button as well, and this half is the one that matters more.**
/// `type=image` puts the control in the submit-button state, so Enter in a form
/// whose first submit control is an image goes with that image's `formaction` —
/// `form.elements` not listing an image is true and irrelevant. That is proved by
/// `pressing_enter_in_a_form_whose_image_button_posts_to_another_program_is_refused`,
/// which is where a mail client used to open.
#[tokio::test]
async fn a_clicked_image_button_is_read_for_its_own_action() {
    let (_playwright, page) = page_with_shapes("input-image").await;
    let reference = ref_of(&page, "the picture button").await;

    let refused = input::click(&page, &reference).await.expect_err("the image is refused");
    assert_eq!(refused, input::Refused::Destination);
}

/// A search field takes Enter through the default image button's formaction.
#[tokio::test]
async fn pressing_enter_in_a_form_whose_image_button_posts_to_another_program_is_refused() {
    let (_playwright, page) = page_with_shapes("input-image-enter").await;
    let field = ref_of(&page, "a field in the image form").await;

    let pressed = input::fill(&page, &field, "an answer").await.expect("a write is not a navigation");
    assert!(!pressed, "an ordinary field in a form is filled and left alone");
    let written: String = page
        .evaluate::<(), String>("() => document.getElementById('with-image').value", None)
        .await
        .expect("the page answers");
    assert_eq!(written, "an answer", "a picture on the form does not stop the field beside it being filled");

    let searching = ref_of(&page, "a search in the image form").await;
    let refused = input::fill(&page, &searching, "an answer").await.expect_err("the image's own action is refused");
    assert_eq!(refused, input::Refused::Destination, "Enter would have gone to the image's formaction");
}

/// The same form with nothing dangerous on the image is not caught by any of
/// this: the field is filled and left alone, because a form is submitted by its
/// own button. A rule refusing every form with a picture on it keeps nobody.
///
/// **Served, not `set_content`.** A document written with `set_content` has
/// `about:blank` as its address, a relative `action` cannot be resolved against
/// it, and an action this code cannot name is one it refuses — which is right,
/// and is why this proof is on a real page.
#[tokio::test]
async fn a_form_whose_image_button_posts_nowhere_in_particular_is_filled_and_left_alone() {
    let (base, _arrived) =
        common::serve(&[common::page(
            r#"<form id="by-image" action="/posted">
                 <input id="with-image" type="text">
                 <input id="picture" type="image" alt="the picture button" src="/x.png">
               </form>"#,
        )])
        .await;
    let (playwright, _context, page) = common::browser_on("input-image-safe", &base).await;
    page.goto(&base, None).await.expect("the page loads");
    let read = kalsa_browser::snapshot::snapshot(&page, 1).await.expect("the page reads");
    let reference = ref_of_text(&read, "textbox");

    let pressed = input::fill(&page, &reference, "an answer").await.expect("an ordinary image is not a destination");
    assert!(!pressed, "and this field is in a form, so nothing is pressed into it");
    let written: String = page
        .locator(format!("aria-ref={reference}"))
        .evaluate::<String, ()>("el => el.value", None)
        .await
        .expect("the page answers");
    assert_eq!(written, "an answer", "it is filled all the same, or this rule would break a page with a picture on it");
    drop(playwright);
}

/// Filling does not submit; a search field must still reject an invalid method.
#[tokio::test]
async fn a_form_with_a_method_the_browser_would_ignore_is_refused() {
    let (_playwright, page) = page_with_shapes("input-method").await;
    let field = ref_of(&page, "a field in a method form").await;

    let pressed = input::fill(&page, &field, "an answer").await.expect("a write is not a navigation");
    assert!(!pressed, "the field is in a form, so nothing is pressed into it");
    let written: String = page
        .evaluate::<(), String>("() => document.getElementById('odd').value", None)
        .await
        .expect("the page answers");
    assert_eq!(written, "an answer", "a method the browser would ignore does not stop the field being filled");

    let searching = ref_of(&page, "a search in a method form").await;
    let refused = input::fill(&page, &searching, "an answer").await.expect_err("the method is refused");
    assert_eq!(refused, input::Refused::Destination, "Enter would have gone with the method the browser ignores");
}

/// **An icon inside a submit button submits with the button.** The icon is not
/// form-associated and has no `form` of its own — reading its attributes checks
/// nothing — so a `<button formaction="kalsaprobe://">` with a picture in it went
/// unchecked until the control wrapping the icon was found and judged instead.
#[tokio::test]
async fn an_icon_inside_a_button_is_read_through_the_button() {
    let (_playwright, page) = page_with_shapes("input-icon").await;
    // The span is a plain child of the button: not form-associated, no `form`
    // of its own, and the ref the read printed for it is the only way in.
    let reference = ref_of(&page, "send the form").await;
    let refused = input::click(&page, &reference).await.expect_err("the button posts to another program");
    assert_eq!(refused, input::Refused::Destination);
}

/// **A label activates the control it labels**, and a label has no `form` of
/// its own — so the control it points at is what a click resolves to, and that
/// control's `formaction` is where the click would go.
///
/// The read prints a label as the plain text it is and hands out no ref for it,
/// so a model cannot click one; what it *does* hand out is the control, and that
/// is what is refused here. The rule that resolves a label to its control is
/// held by `input.rs`'s own source-level test, which is where the rest of the
/// destination clauses are held too.
#[tokio::test]
async fn the_control_a_label_points_at_is_refused_on_its_own_action() {
    let (_playwright, page) = page_with_shapes("input-label").await;
    let reference = ref_of(&page, "go").await;

    let refused = input::click(&page, &reference).await.expect_err("the labelled input posts to another program");
    assert_eq!(refused, input::Refused::Destination);
}


/// **A click on a picture inside a link is a click on the link.** The activation
/// belongs to the anchor, not to the picture — so the tool layer has to read the
/// chain above the element it was given, and it used to be handed `[el]` and so
/// judged the picture alone.
///
/// Measured on this browser, and the measurement is the proof: the accessibility
/// tree gives the anchor an **empty name** and the `<img>` inside it the name and
/// the ref, so a model that reads the page and clicks "the picture inside a link
/// to another program" is clicking `IMG < A(kalsaprobe://shop)`. The `<span>`
/// version of this shape is not reachable — a `<span>` gets no ref at all — which
/// is why the picture is the one this has to be about.
#[tokio::test]
async fn a_picture_inside_a_link_to_another_program_is_refused() {
    let (base, _arrived) = common::serve(&[
        common::page(
            r#"<a href="kalsaprobe://shop"><img alt="the picture inside a link to another program" src="/x.png"></a>
               <a href="/next"><img alt="the picture inside an ordinary link" src="/x.png"></a>"#,
        ),
        common::page_at("/next", "<h1>next</h1>"),
    ])
    .await;
    let (playwright, _context, page) = common::browser_on("input-ancestor", &base).await;
    settle(&page, &base).await;
    let read = snapshot::snapshot(&page, 1).await.expect("the page reads");
    let risky = ref_of_text(&read, "the picture inside a link to another program");
    let ordinary = ref_of_text(&read, "the picture inside an ordinary link");

    // **The ref that name printed is the picture, not the link around it.** If
    // that ever stops being true this proof is measuring nothing, so it is
    // asserted rather than assumed.
    let judged: String = page
        .locator(format!("aria-ref={risky}"))
        .evaluate::<String, ()>("el => el.tagName", None)
        .await
        .expect("the page answers");
    assert_eq!(judged, "IMG", "the model is handed the picture, so the picture is all the rule used to see");

    let refused = input::click(&page, &risky).await.expect_err("the link around it is where the click would have gone");
    assert_eq!(refused, input::Refused::Destination);

    // **And the same picture inside an ordinary link still goes**, or the rule
    // above would be "refuse every click".
    input::click(&page, &ordinary).await.expect("an ordinary address is not a destination");
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert_eq!(page.url(), format!("{base}/next"), "an ordinary address on the person's own site still goes");
    drop(playwright);
}
