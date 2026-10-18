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
/// 3. everywhere this action could send the browser: the form's action, the
///    submitter's `formaction` and `formmethod`, the element's own `formaction`,
///    the anchor it is inside;
/// 4. **only then** write, or click.
const PRELUDE: &str = r"
  const answer = (verdict, extra) => Object.assign({ verdict, isInput: false, kind: '', inForm: false }, extra || {});
  const protocolOf = value => {
    try { return String(new URL(value, location.href).protocol); } catch (error) { return ''; }
  };
  const opens = value => value === '' || value === 'http:' || value === 'https:';
  // The button that would submit this form if Enter were pressed: the first
  // submit control in tree order, which is what the browser itself uses.
  const badDestination = (el, form) => {
    const submitter = form
      ? form.querySelector('button[type=submit], input[type=submit], button:not([type])')
      : null;
    const method = submitter ? String(submitter.getAttribute('formmethod') || '').toLowerCase() : '';
    // A browser ignores a method it does not know and uses GET. Refusing is
    // stricter than the browser, and costs a page nothing legitimate.
    const knownMethod = method === '' || method === 'get' || method === 'post' || method === 'dialog';
    const submitterAction = submitter && submitter.hasAttribute('formaction')
      ? protocolOf(submitter.getAttribute('formaction'))
      : '';
    const ownAction = el.hasAttribute('formaction') ? protocolOf(el.getAttribute('formaction')) : '';
    const link = el.closest('a[href]');
    return !knownMethod
      || !opens(protocolOf(form && form.getAttribute('action')))
      || !opens(submitterAction)
      || !opens(ownAction)
      || !(link === null || opens(String(link.protocol)));
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

  const form = el.closest('form');
  const here = { isInput, kind, inForm: form !== null };
  if (badDestination(el, form)) return answer('destination', here);

  if (isInput || el instanceof HTMLTextAreaElement) el.value = text;
  else el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return answer('ok', here);
";

const CLICK_BODY: &str = r"
  const form = el.closest('form');
  if (badDestination(el, form)) return answer('destination', { inForm: form !== null });

  el.click();
  return answer('ok', { inForm: form !== null });
";

fn fill_expression() -> String {
    format!("(el, text) => {{{PRELUDE}{FILL_BODY}}}")
}

fn click_expression() -> String {
    format!("(el) => {{{PRELUDE}{CLICK_BODY}}}")
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
pub async fn fill(page: &Page, id: &str, text: &str) -> Result<bool, Refused> {
    let element = refs::at(page, id);
    let filled: Answer = element.evaluate::<Answer, &str>(&fill_expression(), Some(text)).await.map_err(|_| Refused::Gone)?;
    if let Some(refused) = refused_by(&filled) {
        return Err(refused);
    }
    if !presses_enter(&filled) {
        return Ok(false);
    }
    // The value is already written and the form has already been read, so the
    // Enter that follows submits what we judged.
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