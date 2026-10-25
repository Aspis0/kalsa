//! What the model does to an element (one responsibility: click, fill, and
//! decide whether Enter follows).
//!
//! Enter is decided in code and never offered to the model. A model that is
//! asked whether to submit guesses, and a wrong guess is a message sent.

use playwright_rs::protocol::Page;
use serde::Deserialize;

use crate::refs;

/// The page's verdict ends a refused fill before Enter; its other findings
/// determine whether an accepted fill presses the key.
#[derive(Deserialize)]
pub(crate) struct Answer {
    /// `ok`, `secret`, `destination`, `unfillable` or `notAccepted`.
    verdict: String,
    #[serde(rename = "isInput")]
    is_input: bool,
    kind: String,
    /// Whether the browser associates this element with a `<form>`. Absent from
    /// a click and from a refusal, both of which never ask.
    #[serde(rename = "inForm", default)]
    in_form: bool,
}

/// The types a person answers in one line and expects to be done with. A
/// `<textarea>`, a `contenteditable` and a `<select>` are not among them: the
/// first two hold several lines by design, and the third is not a field anyone
/// types into at all.
const ONE_LINE: &[&str] = &["text", "search", "email", "url", "tel", "number"];

/// Enter follows a one-line field that is **not** in a form, and a search field
/// wherever it is. Inside a form Enter submits it, so it goes on its own button.
fn presses_enter(answer: &Answer) -> bool {
    if !answer.is_input || !ONE_LINE.contains(&answer.kind.as_str()) {
        return false;
    }
    answer.kind == "search" || !answer.in_form
}

/// Whether the page's own findings end the call.
fn refused_by(answer: &Answer) -> Option<Refused> {
    match answer.verdict.as_str() {
        "secret" => Some(Refused::Password),
        "destination" => Some(Refused::Destination),
        "unfillable" => Some(Refused::NotFillable),
        "notAccepted" => Some(match answer.kind.as_str() {
            "date" => Refused::DateFormat,
            _ => Refused::NotAccepted,
        }),
        _ => None,
    }
}

/// Filling does not activate a destination. Only a click or Enter needs that
/// check; secrets are still refused before writing.
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

  // A function, not a value: `input` and `change` fire below and a handler can
  // move the element into or out of a form, so ask the page again at each use.
  const here = () => ({ isInput, kind, inForm: formOf(el) !== null });

  if (isInput || el instanceof HTMLTextAreaElement) el.value = text;
  else el.textContent = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  // The browser can clear an unsupported native value without throwing.
  const kept = isInput || el instanceof HTMLTextAreaElement ? el.value : el.textContent;
  if (text !== '' && kept === '') return answer('notAccepted', here());
  return answer('ok', here());
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
    /// The requested text left no value after the input/change handlers.
    NotAccepted,
    /// A date field, whose text is YYYY-MM-DD.
    DateFormat,
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
            Refused::NotAccepted => "that field did not take the text: read the page and write what it takes",
            Refused::DateFormat => "that date field did not take the text: a date field takes it as YYYY-MM-DD",
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

/// Input handlers can change the form, so read its destination immediately
/// before Enter. Ordinary form fields are filled without pressing a key.
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

    fn answered(verdict: &str, is_input: bool, kind: &str, in_form: bool) -> Answer {
        Answer { verdict: verdict.to_string(), is_input, kind: kind.to_string(), in_form }
    }

    /// The rule over every shape it answers for: a one-line field with **no form
    /// around it** — the shape of the pages that commit on Enter — takes it.
    #[test]
    fn enter_follows_a_one_line_field_that_is_in_no_form() {
        for kind in ONE_LINE {
            assert!(presses_enter(&answered("ok", true, kind, false)), "{kind} outside a form is finished with Enter");
        }
    }

    /// A form goes on its own submit button, so filling one the ordinary way — a
    /// field at a time — must not post it.
    #[test]
    fn an_ordinary_field_inside_a_form_is_filled_and_left_alone() {
        for kind in ["text", "email", "url", "tel", "number"] {
            assert!(!presses_enter(&answered("ok", true, kind, true)), "{kind} inside a form would submit the form");
        }
    }

    /// The one exception, and it is the field that says so: `type=search` is a
    /// page asking for Enter to mean something, and it keeps it in a form.
    #[test]
    fn a_search_field_keeps_enter_inside_a_form() {
        assert!(presses_enter(&answered("ok", true, "search", true)));
        assert!(presses_enter(&answered("ok", true, "search", false)));
    }

    /// A multi-line answer would submit itself halfway through being written,
    /// which is the one thing the field types exist to prevent. A password field
    /// is refused before any of this, and a `<select>` is not a field at all.
    #[test]
    fn a_multi_line_or_unusual_field_is_filled_and_left_alone() {
        for kind in ["password", "checkbox", "radio", "file", "hidden", "date", "range", "submit", "button"] {
            assert!(!presses_enter(&answered("ok", true, kind, false)), "{kind} must not submit");
        }
        assert!(!presses_enter(&answered("ok", false, "", false)), "a textarea does not submit");
        assert!(!presses_enter(&answered("ok", false, "text", false)), "an editable block does not submit");
    }

    #[test]
    fn what_the_page_found_becomes_what_the_model_is_told() {
        assert_eq!(refused_by(&answered("secret", false, "", false)), Some(Refused::Password));
        assert_eq!(refused_by(&answered("destination", false, "", false)), Some(Refused::Destination));
        assert_eq!(refused_by(&answered("unfillable", false, "", false)), Some(Refused::NotFillable));
        assert_eq!(refused_by(&answered("ok", true, "text", true)), None);
    }

    /// **A field that took nothing is a refusal, and a date field is one that
    /// says how it takes its text.**
    #[test]
    fn a_field_that_took_nothing_is_refused_and_a_date_field_says_its_format() {
        assert_eq!(refused_by(&answered("notAccepted", true, "date", true)), Some(Refused::DateFormat));
        assert_eq!(refused_by(&answered("notAccepted", true, "text", true)), Some(Refused::NotAccepted));
        assert_eq!(refused_by(&answered("notAccepted", false, "", true)), Some(Refused::NotAccepted));
    }

    /// A click and a refusal carry no form, so the default must land on the
    /// form-less field that takes Enter, not on a refusal.
    #[test]
    fn an_answer_with_no_form_in_it_is_a_field_in_no_form() {
        let answer: Answer = serde_json::from_str(r#"{"verdict": "ok", "isInput": true, "kind": "text"}"#).expect("parses");
        assert!(!answer.in_form);
        assert!(presses_enter(&answer));
    }

    /// A picture can be inside a link, so activation must judge its ancestors.
    #[test]
    fn an_activation_is_judged_on_the_chain_above_the_element() {
        const ELEMENT_ALONE: &str = "[el]";
        for (what, expression) in [
            ("a click", click_expression()),
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
        for refused in [
            Refused::Password,
            Refused::NotFillable,
            Refused::Destination,
            Refused::Gone,
            Refused::NotAccepted,
            Refused::DateFormat,
        ] {
            let reason = refused.reason();
            assert!(reason.chars().count() < 160, "{reason}");
            assert!(!reason.contains('@') && !reason.contains("://"), "{reason}");
        }
    }
}
