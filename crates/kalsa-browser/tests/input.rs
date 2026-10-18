//! Filling a field, on a page with every shape a field can have.
//!
//! The rule itself is decided by a pure function and proved as one in
//! `input.rs`. What can only be proved here is the half that touches the page:
//! that the three facts read out of the real DOM are the ones the rule reads,
//! and that a password field is refused before anything is typed into it.

mod common;

use kalsa_browser::{input, snapshot};
use playwright_rs::protocol::{Page, Playwright};

const SHAPES: &str = r#"
  <form action="/posted">
    <label for="inside">one line inside a form</label>
    <input id="inside" type="text">
    <label for="secret">the secret word</label>
    <input id="secret" type="password" autocomplete="off">
    <label for="long">a long answer</label>
    <textarea id="long"></textarea>
  </form>
  <label for="outside">one line with no form</label>
  <input id="outside" type="text">
  <div id="editable" contenteditable="true">an editable answer</div>
  <label for="flipper">a field that turns on focus</label>
  <input id="flipper" type="text" onfocus="this.type='password'">
  <label for="otp">a one time code field</label>
  <input id="otp" type="text" autocomplete="one-time-code">
  <label for="email me">write to giulia</label>
  <a id="mailto-link" href="mailto:giulia@example.com">write to giulia</a>
  <label for="call me">call the shop</label>
  <a id="tel-link" href="tel:+390000000000">call the shop</a>
  <label for="do it">do it now</label>
  <a id="script-link" href="javascript:void(0)">do it now</a>
  <form id="trap" action="https://example.com/collect">
    <label for="sent-away">a form that posts somewhere else</label>
    <input id="sent-away" type="text">
    <button type="submit" formaction="mailto:shop@example.com">send it</button>
  </form>
  <label for="the swapper">a link that changes on mousedown</label>
  <a id="swapper" href="/open" onmousedown="this.href='mailto:shop@example.com'">open it</a>
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

/// The four shapes the plan names, asked in the order that costs least: a field
/// that is not pressed leaves the page exactly where it was, so the ones after
/// it can still be filled.
#[tokio::test]
async fn enter_follows_only_the_one_line_field_that_has_a_form() {
    let (_playwright, page) = page_with_shapes("input-shapes").await;

    for (name, why) in [
        ("one line with no form", "a field with no form has nothing to submit to"),
        ("a long answer", "a textarea holds several lines by design"),
        ("an editable answer", "an editable block is not an input"),
    ] {
        let reference = ref_of(&page, name).await;
        let pressed = input::fill(&page, &reference, "an answer").await.expect("the field is filled");
        assert!(!pressed, "{name} must not press Enter: {why}");
    }

    let reference = ref_of(&page, "one line inside a form").await;
    let pressed = input::fill(&page, &reference, "an answer").await.expect("the field is filled");
    assert!(pressed, "a one-line field inside a form submits");
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

/// A page that records every value it is given. If a fill is refused, this must
/// never see one — the write happens after every check, not before.
#[tokio::test]
async fn a_refused_fill_never_writes_a_value_the_page_can_see() {
    let (_playwright, page) = page_with_shapes("input-nothing-written").await;
    // The form's own submitter posts to a mailto:, so this fill is refused for
    // where it would go — after the field is resolved and after the secret check,
    // and before anything is written.
    let reference = ref_of(&page, "a form that posts somewhere else").await;

    let refused = input::fill(&page, &reference, "hunter2").await.expect_err("that form is refused");
    assert_eq!(refused, input::Refused::Destination);

    let seen: Vec<String> = page
        .evaluate::<(), Vec<String>>(
            r#"() => { const log = []; document.addEventListener('input', e => log.push(e.target.id + '=' + e.target.value), true); window.log = log; return log; }"#,
            None,
        )
        .await
        .expect("the page answers");
    assert!(seen.is_empty(), "the page saw {seen:?}");

    let typed: String = page
        .evaluate::<(), String>("() => document.getElementById('sent-away').value", None)
        .await
        .expect("the page answers");
    assert!(typed.is_empty(), "the value landed anyway: {typed:?}");
}

/// A page that swaps the link's `href` the moment a button goes down on it.
/// Playwright's own click is mousedown-then-click, so a check followed by a
/// Playwright click would read `/open` and then follow the mailto. Ours reads
/// and clicks in one task.
#[tokio::test]
async fn a_link_that_swaps_its_destination_on_mousedown_is_still_refused() {
    let (base, _arrived) = common::serve(&[common::page("")]).await;
    let (playwright, _context, page) = common::browser_on("input-swap", &base).await;
    page.set_content(
        r#"<a id="swapper" href="/open" onmousedown="this.href='mailto:shop@example.com'">open it</a>"#,
        None,
    )
    .await
    .expect("the content is set");
    let read = kalsa_browser::snapshot::snapshot(&page, 1).await.expect("the page reads");
    let reference = ref_of_text(&read, "open it");

    let refused = input::click(&page, &reference).await.expect_err("the swap is caught");
    assert_eq!(refused, input::Refused::Destination, "the mailto was not caught");
    drop(playwright);
}

/// The submitter's own `formaction` is where Enter goes, so it is read with
/// everything else and refused the same way.
#[tokio::test]
async fn a_form_whose_default_submitter_posts_to_another_program_is_refused() {
    let (_playwright, page) = page_with_shapes("input-formaction").await;
    let reference = ref_of(&page, "a form that posts somewhere else").await;

    let refused = input::fill(&page, &reference, "an answer").await.expect_err("the formaction is refused");
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