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
/// file. `mailto:` itself is still refused where no browser is involved, in
/// `src/input.rs`'s own tests and in `tests/addresses.rs`.
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
  </form>
  <map name="office"><area id="office-area" shape="rect" coords="0,0,9,9" href="kalsaprobe://shop" alt="the office map"></map>
  <img id="plan" usemap='#office' alt="a floor plan">
  <svg width="60" height="20" xmlns="http://www.w3.org/2000/svg">
    <a id="sign" xlink:href="kalsaprobe://shop"><rect width="60" height="20"></rect><text x="2" y="14">the drawn sign</text></a>
  </svg>
  <form id="by-image" action="/posted">
    <label for="with-image">a field in the image form</label>
    <input id="with-image" type="text">
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
/// **A one-line field with no form around it is pressed**, and that is the whole
/// change: TodoMVC's new-todo input, a chat box and a search box are exactly
/// that, and a model that types into one and presses nothing has asked a page a
/// question it never hears the end of.
#[tokio::test]
async fn enter_follows_any_one_line_field_and_nothing_else() {
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

    for (name, why) in [
        ("one line inside a form", "a form submits on Enter"),
        ("one line with no form", "a page whose keydown commits the text is finished by Enter, form or no form"),
    ] {
        let reference = ref_of(&page, name).await;
        let pressed = input::fill(&page, &reference, "an answer").await.expect("the field is filled");
        assert!(pressed, "{why}");
    }
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
    // The form's own submitter posts to another program, so this fill is refused for
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
/// A field that belongs to a form somewhere else on the page, by the `form`
/// attribute a browser honours and `closest('form')` cannot see. The form it
/// is really in posts to another program, so the fill is refused — but a check
/// that walked ancestry would call this field form-less, check nothing, and
/// write into it.
#[tokio::test]
async fn a_field_associated_with_a_form_elsewhere_is_judged_by_that_form() {
    let (_playwright, page) = page_with_shapes("input-elsewhere").await;
    let reference = ref_of(&page, "a field attached to the far form").await;

    let refused = input::fill(&page, &reference, "an answer").await.expect_err("the far form is refused");
    assert_eq!(refused, input::Refused::Destination);
}

/// An image map area is a link whose address lives in `href` on an `<area>`
/// inside a `<map>` — not on an `<a>`, which is what a selector written for
/// anchors would find.
///
/// Chrome gives an area no node in the accessibility tree: the image keeps the
/// ref and the area's own name is never printed. So the model cannot name an
/// area and cannot click one, which is why the click check below finds nothing
/// to act on. The rule still reads `area[href]`, and
/// `every_shape_of_link_and_method_is_read` in `input.rs` is what keeps that
/// clause from being dropped; this is the layer behind that layer.
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

/// **Enter in a form whose only submit control is an image button goes with
/// that image's `formaction`.** This is the one that opened the person's mail
/// client from a plain text field, so it is worth saying what the browser does
/// rather than what this file used to believe.
///
/// It used to believe an image is not a submit button, on the strength of
/// `form.elements` not listing it — which is true, and is not the question. The
/// browser finds the default button by association, and `type=image` is one of
/// the three values that put a control in the submit-button state: Enter in
/// `#with-image` submitted the form with `formaction="kalsaprobe://..."`, and
/// with `mailto:` in that attribute it opened a compose window on the machine
/// running the tests, every run. **A fill into that field is refused**, so the
/// key is never pressed and there is nothing to hand over.
///
/// The safe half is here too: the same form with no `formaction` on the image is
/// filled and pressed exactly as before, because the rule is about where Enter
/// would go and not about pictures.
#[tokio::test]
async fn pressing_enter_in_a_form_whose_image_button_posts_to_another_program_is_refused() {
    let (_playwright, page) = page_with_shapes("input-image-enter").await;
    let reference = ref_of(&page, "a field in the image form").await;

    let refused = input::fill(&page, &reference, "an answer").await.expect_err("the image's own action is refused");
    assert_eq!(refused, input::Refused::Destination, "Enter would have gone to the image's formaction");

    // **And nothing was typed**, which is the half that actually matters: the
    // value would have gone out with the address.
    let typed: String = page
        .evaluate::<(), String>("() => document.getElementById('with-image').value", None)
        .await
        .expect("the page answers");
    assert!(typed.is_empty(), "an answer was written into a field that would have posted it: {typed:?}");
}

/// The same form with nothing dangerous on the image is not caught by any of
/// this: it is filled, Enter is pressed, and the field is filled. A rule that
/// refused every form with a picture on it would be one nobody keeps.
///
/// **Served, not `set_content`.** A document written with `set_content` has
/// `about:blank` as its address, a relative `action` cannot be resolved against
/// it, and an action this code cannot name is one it refuses — which is right,
/// and is why this proof is on a real page.
#[tokio::test]
async fn a_form_whose_image_button_posts_nowhere_in_particular_is_filled_and_pressed() {
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
    assert!(pressed, "and Enter still goes, or this tool would stop working on a page with a picture on it");
    drop(playwright);
}

/// The form's own `method` is where a submit goes when nothing overrides it.
#[tokio::test]
async fn a_form_with_a_method_the_browser_would_ignore_is_refused() {
    let (_playwright, page) = page_with_shapes("input-method").await;
    let reference = ref_of(&page, "a field in a method form").await;

    let refused = input::fill(&page, &reference, "an answer").await.expect_err("the method is refused");
    assert_eq!(refused, input::Refused::Destination);
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
