//! What the model does to an element (one responsibility: click, fill, and
//! decide whether Enter follows).
//!
//! Enter is decided in code and never offered to the model. A model that is
//! asked whether to submit guesses, and a wrong guess is a message sent.

use playwright_rs::protocol::Page;
use serde::Deserialize;

use crate::refs;

/// The two things that end a call without anything happening, and the one that
/// decides Enter. Read out of the page, never out of the model.
#[derive(Deserialize)]
pub(crate) struct Answer {
    /// `ok`, `secret`, `destination` or `unfillable`.
    verdict: String,
    #[serde(rename = "isInput")]
    is_input: bool,
    kind: String,
    #[serde(rename = "inForm")]
    in_form: bool,
}

/// The types a person answers in one line and expects to be done with. A
/// `<textarea>`, a `contenteditable` and a form-less input are not among them:
/// the first two hold several lines by design, and the third has nothing to
/// submit to.
const SUBMITTABLE: &[&str] = &["text", "search", "email", "url", "tel", "number"];

/// Press Enter after filling this field.
fn presses_enter(answer: &Answer) -> bool {
    answer.is_input && answer.in_form && SUBMITTABLE.contains(&answer.kind.as_str())
}

/// Whether the page's own findings end the call.
fn refused_by(answer: &Answer) -> Option<Refused> {
    match answer.verdict.as_str() {
        "secret" => Some(Refused::Password),
        "destination" => Some(Refused::Destination),
        "unfillable" => Some(Refused::NotFillable),
        _ => None,
    }
}

/// What a call reads out of the page before it decides anything.
///
/// Inside one JavaScript task, because the order and the closeness are the whole
/// of the safety here:
///
/// 1. `focus`, because a page that turns a field into a password field when it is
///    focused does exactly that — read the type before the focus and the field
///    the model was shown is not the field that gets written to;
/// 2. the field's own shape, and refuse a secret before anything is written;
/// 3. everywhere this action could send the browser: the form it is actually
///    associated with, its action and method, the submitter's `formaction` and
///    `formmethod`, the element's own, and the link of every shape it may be
///    inside;
/// 4. **only then** write, or click.
const PRELUDE: &str = r"
  const answer = (verdict, extra) => Object.assign({ verdict, isInput: false, kind: '', inForm: false }, extra || {});
  // An address with no scheme in it is fine: the browser resolves it against the
  // page. An address that cannot be resolved at all is not, and is answered with
  // something `opens` will not take — a destination we cannot name is a
  // destination we cannot rule out.
  const protocolOf = value => {
    if (value === null || value === undefined || value === '') return '';
    try { return String(new URL(value, location.href).protocol); } catch (error) { return 'unresolvable'; }
  };
  const opens = value => value === '' || value === 'http:' || value === 'https:';
  // A browser ignores a method it does not know and uses GET. Refusing is
  // stricter than the browser, and costs a page nothing legitimate.
  const knownMethod = value => value === '' || value === 'get' || value === 'post' || value === 'dialog';
  const methodOf = (node, attribute) => node === null || node === undefined
    ? ''
    : String(node.getAttribute(attribute) || '').toLowerCase();
  // The link this element is inside, by every shape a link takes. An HTML
  // anchor, an image map area, and an SVG anchor — whose href is an
  // SVGAnimatedString rather than a string, and may live in the xlink
  // namespace rather than as a plain attribute.
  const linkHref = el => {
    const anchor = el.closest('a[href], area[href]');
    if (anchor !== null) return anchor.getAttribute('href');
    const svg = el.closest('a');
    if (svg === null || !svg.namespaceURI || svg.namespaceURI.indexOf('svg') === -1) return null;
    const drawn = svg.href && svg.href.baseVal;
    return drawn || svg.getAttribute('xlink:href') || svg.getAttribute('href');
  };
  // The form this element would submit, by the browser's own association and
  // not by ancestry: a field whose form attribute names a form elsewhere on the
  // page belongs to that form, and `closest('form')` would call it form-less
  // and check nothing at all. `el.form` is what Enter and a click act on.
  const formOf = el => el.form || null;
  // The default button: the control Enter submits with, computed the way the
  // browser computes it — the first entry of the form's own listed elements,
  // `form.elements`, that is a submit button and is not disabled. That is where
  // a form-associated control named by a `form` attribute lives, which a DOM
  // query would miss, and it skips a disabled button the browser walks past.
  // `.type` carries the IDL default, so a `<button>` with no attribute reads as
  // `submit` and an `<input>` with none reads as `text`, which is not one.
  //
  // **`input type=image` is not in this list, and cannot be.** The HTML
  // definition of a *listed element* excludes it, so it is absent from
  // `form.elements` — measured on the browser this runs on, where a form holds
  // `text`, `button[type=submit]`, `input[type=submit]` and a bare `<button>` and
  // omits every image input. That is also correct behaviour, not a gap: an image
  // submits when it is *activated*, and Enter is not activation, so it is never
  // the default button. Its own `formaction` is still read on the click path,
  // because a click on it makes it the submitter.
  const isDefaultButton = node => {
    if (node.disabled) return false;
    const type = String(node.type || '').toLowerCase();
    if (node.tagName === 'BUTTON') return type === 'submit' || type === '';
    return node.tagName === 'INPUT' && type === 'submit';
  };
  const defaultButtonOf = form => {
    if (form === null) return null;
    for (const node of form.elements) {
      if (isDefaultButton(node)) return node;
    }
    return null;
  };
  // Every address this action could send the browser to: the form it is
  // actually associated with, its action and method, the default button's
  // `formaction` and `formmethod`, the element's own, and the link of every
  // shape it may be inside. The element's own two are what cover a click: a
  // clicked submit control *is* the submitter, and that is the one place an
  // `input type=image` ever submits.
  const badDestination = el => {
    const form = formOf(el);
    const submitter = defaultButtonOf(form);
    const href = linkHref(el);
    return !knownMethod(methodOf(submitter, 'formmethod'))
      || !knownMethod(methodOf(form, 'method'))
      || !knownMethod(methodOf(el, 'formmethod'))
      || !opens(protocolOf(form && form.getAttribute('action')))
      || !opens(protocolOf(submitter && submitter.getAttribute('formaction')))
      || !opens(protocolOf(el.getAttribute('formaction')))
      || !(href === null || opens(protocolOf(href)));
  };
";

const FILL_BODY: &str = r"
  const editable = el instanceof HTMLTextAreaElement || el.isContentEditable === true;
  if (!(el instanceof HTMLInputElement) && !editable) return answer('unfillable');
  el.focus();

  const isInput = el instanceof HTMLInputElement;
  const kind = isInput ? String(el.type).toLowerCase() : '';
  const auto = String(el.getAttribute('autocomplete') || '').toLowerCase();
  // A one-time code is a password for one use, and it is the one a page is most
  // likely to talk a model into handing over.
  const secret = kind === 'password'
    || auto.includes('current-password')
    || auto.includes('new-password')
    || auto.includes('one-time-code');
  if (secret) return answer('secret');

  const here = { isInput, kind, inForm: formOf(el) !== null };
  if (badDestination(el)) return answer('destination', here);

  if (isInput || el instanceof HTMLTextAreaElement) el.value = text;
  else el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return answer('ok', here);
";

const CLICK_BODY: &str = r"
  const form = formOf(el);
  if (badDestination(el)) return answer('destination', { inForm: form !== null });

  el.click();
  return answer('ok', { inForm: form !== null });
";

/// Re-reads the destination and nothing else, so the check that decides whether
/// Enter is pressed runs again after the write and after every handler the write
/// woke up.
///
/// This exists because the first check and the Enter are not one task. Filling
/// fires `input` and `change`, and a page's handler for either can rewrite the
/// form's action, the submitter's `formaction`, or the field's `formmethod` —
/// so the form that was safe when we read it need not be the form Enter submits.
/// Re-reading closes that; what it cannot close is written down in the crate's
/// README under Known limits.
const RECHECK_BODY: &str = r"
  return answer(badDestination(el) ? 'destination' : 'ok');
";

fn fill_expression() -> String {
    format!("(el, text) => {{{PRELUDE}{FILL_BODY}}}")
}

fn click_expression() -> String {
    format!("(el) => {{{PRELUDE}{CLICK_BODY}}}")
}

fn recheck_expression() -> String {
    format!("(el) => {{{PRELUDE}{RECHECK_BODY}}}")
}

#[derive(PartialEq, Eq, Debug)]
pub enum Refused {
    Password,
    NotFillable,
    /// The element, or the form around it, would hand the address to another
    /// program — `mailto:`, `tel:`, `javascript:`.
    Destination,
    Gone,
}

impl Refused {
    pub fn reason(&self) -> &'static str {
        match self {
            Refused::Password => {
                "that is a password field, and Kalsa will not type into one: ask the person to type \
                 it in the browser window"
            }
            Refused::NotFillable => "that element cannot hold text: read the page and pick a field",
            Refused::Destination => "that would hand the address to another program, and Kalsa does not do that",
            Refused::Gone => "the element is not on the page any more: read the page again",
        }
    }
}

/// Click one element, having read where that click would have gone in the same
/// task that fires it.
///
/// **Why the click is done in the page and not by Playwright.** Playwright's click
/// is mousedown, mouseup and then a click event at coordinates — long enough for
/// a page to answer `mousedown` by rewriting the `href` it had when we read it.
/// `el.click()` puts the address we judged and the click that fires it in the
/// same JavaScript task, with nothing in between to change it. The cost is
/// Playwright's actionability wait, so a click can land on an element a person
/// could not see. The risk in this tool is the destination, not the visibility:
/// the element is the one a read printed and the model named.
pub async fn click(page: &Page, id: &str) -> Result<(), Refused> {
    let element = refs::at(page, id);
    let answered: Answer = element.evaluate::<Answer, ()>(&click_expression(), None).await.map_err(|_| Refused::Gone)?;
    if let Some(refused) = refused_by(&answered) {
        return Err(refused);
    }
    Ok(())
}

/// Fill a field, and press Enter after it only when the field says Enter means
/// something. A password field is never typed into: the model has no business
/// holding one, and a value it typed would sit in the transcript.
///
/// The value is written and judged in one task, and **judged again before the
/// key is pressed**, because the write itself runs page code: `input` and
/// `change` fire, and a handler for either can turn the form we judged into a
/// form that would post somewhere else. A second check that finds it changed
/// refuses and presses nothing.
pub async fn fill(page: &Page, id: &str, text: &str) -> Result<bool, Refused> {
    let element = refs::at(page, id);
    let filled: Answer = element.evaluate::<Answer, &str>(&fill_expression(), Some(text)).await.map_err(|_| Refused::Gone)?;
    if let Some(refused) = refused_by(&filled) {
        return Err(refused);
    }
    if !presses_enter(&filled) {
        return Ok(false);
    }
    let again: Answer = element.evaluate::<Answer, ()>(&recheck_expression(), None).await.map_err(|_| Refused::Gone)?;
    if let Some(refused) = refused_by(&again) {
        return Err(refused);
    }
    element.press("Enter", None).await.map_err(|_| Refused::Gone)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::{presses_enter, refused_by, Answer, Refused, SUBMITTABLE};

    fn answered(verdict: &str, is_input: bool, kind: &str, in_form: bool) -> Answer {
        Answer { verdict: verdict.to_string(), is_input, kind: kind.to_string(), in_form }
    }

    /// The rule, over every shape it has to answer for. Enter follows a
    /// one-line answer inside a form, and nothing else.
    #[test]
    fn enter_follows_a_one_line_field_that_has_a_form_to_submit_to() {
        for kind in SUBMITTABLE {
            assert!(presses_enter(&answered("ok", true, kind, true)), "{kind} in a form submits");
            assert!(!presses_enter(&answered("ok", true, kind, false)), "{kind} with no form does not");
        }
    }

    /// A multi-line answer would submit itself halfway through being written,
    /// which is the one thing the field types exist to prevent.
    #[test]
    fn a_multi_line_or_unusual_field_is_filled_and_left_alone() {
        for kind in ["password", "checkbox", "radio", "file", "hidden", "date", "range", "submit", "button"] {
            assert!(!presses_enter(&answered("ok", true, kind, true)), "{kind} must not submit");
        }
        assert!(!presses_enter(&answered("ok", false, "", true)), "a textarea does not submit");
        assert!(!presses_enter(&answered("ok", false, "text", true)), "an editable block does not submit");
    }

    #[test]
    fn what_the_page_found_becomes_what_the_model_is_told() {
        assert_eq!(refused_by(&answered("secret", false, "", false)), Some(Refused::Password));
        assert_eq!(refused_by(&answered("destination", false, "", true)), Some(Refused::Destination));
        assert_eq!(refused_by(&answered("unfillable", false, "", false)), Some(Refused::NotFillable));
        assert_eq!(refused_by(&answered("ok", true, "text", true)), None);
    }

    #[test]
    fn every_refusal_is_one_line_and_says_nothing_the_page_wrote() {
        for refused in [Refused::Password, Refused::NotFillable, Refused::Destination, Refused::Gone] {
            let reason = refused.reason();
            assert!(reason.chars().count() < 160, "{reason}");
            assert!(!reason.contains('@') && !reason.contains("://"), "{reason}");
        }
    }
}
/// What the destination check reads. Separate from the Enter rule's tests
/// because they answer different questions: those ask what a fill does, these
/// ask where a click could go.
#[cfg(test)]
mod destinations {
    use super::{click_expression, fill_expression, recheck_expression, PRELUDE};

    /// The shapes the destination check has to read, each one a way a click has
    /// gone to another program. Dropping a clause here does not fail a test
    /// anywhere else: an image map area has no node in the accessibility tree,
    /// so no read ever names one, and the shape is unreachable from a ref.
    #[test]
    fn every_shape_of_link_and_method_is_read() {
        for clause in [
            // An HTML anchor, an image map area, and an SVG anchor — whose href
            // is an SVGAnimatedString and may live in the xlink namespace.
            "a[href], area[href]",
            "svg.href && svg.href.baseVal",
            "getAttribute('xlink:href')",
            // Three methods: the form's own, the submitter's override, and the
            // element's. An image button submits like any other submitter.
            "methodOf(form, 'method')",
            "methodOf(submitter, 'formmethod')",
            "methodOf(el, 'formmethod')",
            // The browser's own association, so a field whose form attribute
            // names a form elsewhere on the page is judged by that form.
            "el.form",
        ] {
            assert!(PRELUDE.contains(clause), "the destination check no longer reads {clause}");
        }
    }

    /// The default button is the browser's, found the browser's way:
    /// `form.elements` is where a form-associated control outside the form
    /// itself lives, and `disabled` is what makes a button not the one Enter
    /// would use.
    #[test]
    fn the_default_button_is_the_browsers_and_not_the_first_one_in_the_markup() {
        for clause in ["form.elements", "node.disabled", "isDefaultButton", "defaultButtonOf(form)"] {
            assert!(PRELUDE.contains(clause), "the default button is no longer computed as {clause}");
        }
        assert!(
            !PRELUDE.contains("querySelector('button[type=submit]"),
            "a DOM query misses a form-associated button outside the form and returns a disabled one"
        );
    }

    /// `input type=image` is **not** a listed element, so it is never in
    /// `form.elements` and never the default button — Enter is not activation,
    /// and an image only submits when it is clicked. Asserted as the shape of
    /// the rule rather than left implicit, because the previous version found
    /// images with a DOM query and quietly judged the wrong button for Enter.
    #[test]
    fn an_image_is_never_the_default_button_but_is_still_read_when_it_is_clicked() {
        assert!(PRELUDE.contains("is not in this list"), "the rule no longer says why");
        // Its own formaction and formmethod are read on the element itself,
        // which is the path a click on it takes.
        assert!(PRELUDE.contains("protocolOf(el.getAttribute('formaction'))"), "a clicked image's action is unread");
        assert!(PRELUDE.contains("methodOf(el, 'formmethod')"), "a clicked image's method is unread");
    }

    /// The check runs again between the write and the key press, and the second
    /// run is the same check — not a weaker one.
    #[test]
    fn enter_is_preceded_by_the_same_check_the_write_was() {
        let recheck = recheck_expression();
        assert!(recheck.contains("badDestination(el)"), "the recheck does not re-read the destination");
        assert!(recheck.contains("const protocolOf"), "the recheck carries its own prelude");
        assert!(fill_expression().contains("badDestination(el)"), "the write checks what it writes");
        // And it is a recheck, not a second write.
        assert!(!recheck.contains("el.value ="), "the recheck must not write again");
    }

    /// An address that cannot be resolved is not an address with no scheme, and
    /// `opens` must not take it for one: a destination we cannot name is a
    /// destination we cannot rule out.
    #[test]
    fn an_address_that_cannot_be_resolved_is_not_read_as_scheme_less() {
        assert!(PRELUDE.contains("return 'unresolvable'"), "an unresolvable address reads as empty");
        assert!(PRELUDE.contains("value === ''"), "an empty attribute must still read as empty");
    }

    #[test]
    fn both_actions_carry_the_same_check_and_the_same_prelude() {
        let fill = fill_expression();
        let click = click_expression();
        for body in [&fill, &click] {
            assert!(body.contains("badDestination(el)"), "one action skips the destination check");
        }
        assert_eq!(fill.matches("const protocolOf").count(), 1);
        assert_eq!(click.matches("const protocolOf").count(), 1);
    }
}
