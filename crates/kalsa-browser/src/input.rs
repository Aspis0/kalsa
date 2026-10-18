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
}

/// The types a person answers in one line and expects to be done with. A
/// `<textarea>`, a `contenteditable` and a `<select>` are not among them: the
/// first two hold several lines by design, and the third is not a field anyone
/// types into at all.
const ONE_LINE: &[&str] = &["text", "search", "email", "url", "tel", "number"];

/// Enter follows a one-line field, **whether or not it sits in a form**.
///
/// The form was never the point, and holding out for it is what made this rule
/// wrong for the web as it is. TodoMVC, every chat box and most search boxes are
/// single-line inputs with no form at all, whose keydown handler commits what was
/// typed: under a form-only rule a model could type an answer into one of those
/// and the page would never hear the rest of the request, which is the model
/// staring at a field that took the words and did nothing with them.
///
/// What this can cost is a request, and that is not this function's business:
/// every write Enter can set off is a non-GET, and a non-GET goes through the
/// hold like every other write (`src/hold.rs`) — refused in this step, confirmed
/// from step 4. The destination is still re-read immediately before the key goes
/// down (see `fill`).
fn presses_enter(answer: &Answer) -> bool {
    answer.is_input && ONE_LINE.contains(&answer.kind.as_str())
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
const FILL_BODY: &str = r"
  const editable = el instanceof HTMLTextAreaElement || el.isContentEditable === true;
  if (!(el instanceof HTMLInputElement) && !editable) return answer('unfillable');
  el.focus();

  const isInput = el instanceof HTMLInputElement;
  const kind = isInput ? String(el.type).toLowerCase() : '';
  // **The same predicate the catcher asks**, declared above from the same two
  // Rust lists — written in rather than assigned to `window`, so there is nothing
  // on the page for a page to replace before the person types.
  if (isSecretField(el)) return answer('secret');

  const here = { isInput, kind };
  if (badDestinationOf(el, pathOf(el))) return answer('destination', here);

  if (isInput || el instanceof HTMLTextAreaElement) el.value = text;
  else el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return answer('ok', here);
";

const CLICK_BODY: &str = r"
  if (badDestinationOf(el, pathOf(el))) return answer('destination');

  el.click();
  return answer('ok');
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
  return answer(badDestinationOf(el, pathOf(el)) ? 'destination' : 'ok');
";

/// **The secret predicate is written into the expression, not left in the page.**
/// It used to be installed as `window.__kalsaPasswords` and read back out of the
/// page, which is a global a page can replace before the person types anything —
/// and what it decides is whether a value the person types is tracked at all. So
/// it is generated from the same two Rust lists, into the same expression, and
/// there is nothing on the page to replace.
fn fill_expression() -> String {
    let secret = crate::secret::classifier_declaration();
    format!("(el, text) => {{{}{}{}}}", crate::external::READING, secret, FILL_BODY)
}

fn click_expression() -> String {
    format!("(el) => {{{READING}{CLICK_BODY}}}", READING = crate::external::READING)
}

fn recheck_expression() -> String {
    format!("(el) => {{{READING}{RECHECK_BODY}}}", READING = crate::external::READING)
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

/// Fill a field, and press Enter after it when the field is a one-line answer.
/// A password field is never typed into: the model has no business holding one,
/// and a value it typed would sit in the transcript.
///
/// The value is written and judged in one task, and **judged again before the
/// key is pressed**, because the write itself runs page code: `input` and
/// `change` fire, and a handler for either can turn the form we judged into a
/// form that would post somewhere else. A second check that finds it changed
/// refuses and presses nothing. That check is now the whole of what stands
/// between a fill and a page that acts on it, and it stands because Enter can
/// now follow a field with no form around it — see `presses_enter`.
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


    use super::{click_expression, fill_expression, presses_enter, recheck_expression, refused_by, Answer, Refused, ONE_LINE};

    fn answered(verdict: &str, is_input: bool, kind: &str) -> Answer {
        Answer { verdict: verdict.to_string(), is_input, kind: kind.to_string() }
    }

    /// The rule, over every shape it has to answer for. **The form is not part
    /// of it.** A one-line field is followed by Enter whether or not a `<form>`
    /// is around it, because the pages that commit on Enter — TodoMVC, a chat
    /// box, a search box — are mostly not in one, and a model typing into one of
    /// those and pressing nothing is a model waiting for ever.
    #[test]
    fn enter_follows_any_one_line_field() {
        for kind in ONE_LINE {
            assert!(presses_enter(&answered("ok", true, kind)), "{kind} is finished with Enter");
        }
    }

    /// A multi-line answer would submit itself halfway through being written,
    /// which is the one thing the field types exist to prevent. A password field
    /// is refused before any of this, and a `<select>` is not a field at all.
    #[test]
    fn a_multi_line_or_unusual_field_is_filled_and_left_alone() {
        for kind in ["password", "checkbox", "radio", "file", "hidden", "date", "range", "submit", "button"] {
            assert!(!presses_enter(&answered("ok", true, kind)), "{kind} must not submit");
        }
        assert!(!presses_enter(&answered("ok", false, "")), "a textarea does not submit");
        assert!(!presses_enter(&answered("ok", false, "text")), "an editable block does not submit");
    }

    #[test]
    fn what_the_page_found_becomes_what_the_model_is_told() {
        assert_eq!(refused_by(&answered("secret", false, "")), Some(Refused::Password));
        assert_eq!(refused_by(&answered("destination", false, "")), Some(Refused::Destination));
        assert_eq!(refused_by(&answered("unfillable", false, "")), Some(Refused::NotFillable));
        assert_eq!(refused_by(&answered("ok", true, "text")), None);
    }

    /// **A click is judged on the whole chain above the element, not on the
    /// element.** Clicking a picture inside a link activates the link, and the
    /// element the model is given is not always the link — measured on this
    /// browser, the accessibility tree gives the anchor an empty name and the
    /// `<img>` inside it the name and the ref. Handing `[el]` to the rule
    /// therefore judged the picture, and the link around it was never read.
    #[test]
    fn a_click_is_judged_on_the_chain_above_the_element() {
        const ELEMENT_ALONE: &str = "[el]";
        for (what, expression) in [
            ("a click", click_expression()),
            ("a fill", fill_expression()),
            ("the recheck before Enter", recheck_expression()),
        ] {
            assert!(expression.contains("badDestinationOf(el, pathOf(el))"), "{what} is not judged on the chain above it");
            assert!(!expression.contains(&format!("badDestinationOf(el, {ELEMENT_ALONE})")), "{what} is judged on the element alone");
        }
    }

    /// **Nothing here is a binding in the page's world.** These expressions are
    /// evaluated, not injected, so their `const`s are already in a function scope
    /// of our own — but they are built from the same `READING` the window installs
    /// as an init script, and that one *was* top-level. This is the check that the
    /// two stay in step: a page's classic script declaring `answer` or `pathOf`
    /// must not collide with anything we write into it.
    #[test]
    fn no_expression_declares_anything_in_the_page() {
        for (what, expression) in [
            ("a click", click_expression()),
            ("a fill", fill_expression()),
            ("the recheck before Enter", recheck_expression()),
        ] {
            assert!(expression.starts_with("(el"), "{what} is not a function expression: {expression}");
            assert!(expression.ends_with('}'), "{what} has no closing brace");
            assert!(!expression.contains("window."), "{what} leaves something on the page: {expression}");
        }
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
