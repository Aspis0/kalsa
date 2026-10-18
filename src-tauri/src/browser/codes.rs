//! The closed set of codes a browser call can come back with, and where each
//! one comes from.
//!
//! **A code is what the screen and the ledger read; a sentence is what the model
//! reads.** They are never the same thing, because a sentence is prose in five
//! languages and a code is one word. The person-facing copy is looked up by this
//! code and by nothing else, so a refusal that arrives with words nobody here
//! wrote cannot become a line on the window.
//!
//! **Read from the sidecar's structured fields only, never from its prose.** The
//! sidecar answers in its own words, and its words are not a stable interface:
//! `structuredContent` is. One field is live today — `kalsa.gone`, which says the
//! window the person closed — and `kalsa.code` is where the rest will arrive; an
//! answer with neither is a refusal, which is a fact about it rather than a
//! guess at which one it is.

use serde_json::Value;
use kalsa_mcp::outcome::ToolResult;

/// A code as it travels to the page, and as it is persisted beside a run.
///
/// **These are the sidecar's codes and nothing else.** The app's own —
/// `browser.failed` for a host it could not ask, `browser.busy`, `browser.stopped`
/// — are `BrowserError`'s, and a caller reads one set through
/// `BrowserError::code()` and never has to know which was which.
///
/// **A closed set.** A member of it is one word this build knows a sentence for;
/// an answer that names anything else is a refusal, because a code the five
/// tables cannot say would reach the window as a stranger's internal name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BrowserCode {
    /// The person closed the browser's own window. The sidecar said so itself.
    WindowGone,
    /// The sidecar answered that it will not do it, and named no reason this
    /// build knows. Its own sentence is the model's; the page gets one line.
    Refused,
    /// There is no page there to read, and none was opened first.
    NoPage,
    /// The element it named is not on the page any more.
    ElementGone,
    /// The field it named is not on the page any more.
    FieldGone,
    /// The write is held and is waiting for the person. Nothing was sent.
    Held,
    /// A native rule would not let the form go: a required control is empty or
    /// not what it must be. Nothing was sent.
    Invalid,
}

impl BrowserCode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::WindowGone => "browser.window_gone",
            Self::Refused => "browser.refused",
            Self::NoPage => "browser.no_page",
            Self::ElementGone => "browser.element_gone",
            Self::FieldGone => "browser.field_gone",
            Self::Held => "browser.held",
            Self::Invalid => "browser.invalid",
        }
    }

    /// The code a sidecar named, **read from its own field and matched against
    /// the words this build uses** — not against its prose, which is not a
    /// stable interface and is not ours. A word outside the set is a refusal:
    /// it says the truth this build can stand behind rather than a code the copy
    /// has no words for.
    fn named(code: &str) -> Self {
        match code {
            "browser.no_page" => Self::NoPage,
            "browser.element_gone" => Self::ElementGone,
            "browser.field_gone" => Self::FieldGone,
            "browser.held" => Self::Held,
            "browser.invalid" => Self::Invalid,
            _ => Self::Refused,
        }
    }

    /// What one answer said about itself, in its own structured fields.
    ///
    /// **`kalsa.gone` is the only mark a sidecar sends today**; `kalsa.code` is
    /// where the rest will come from, and a build whose sidecar answers with one
    /// needs no change here. Everything else is a refusal, which is what every
    /// refusal reads as until the sidecar says more.
    pub(crate) fn of(result: &ToolResult) -> Self {
        let Some(said) = result.for_ui.as_ref().and_then(|mark| mark.get("kalsa")) else {
            return Self::Refused;
        };
        if said.get("gone").and_then(Value::as_bool) == Some(true) {
            return Self::WindowGone;
        }
        match said.get("code").and_then(Value::as_str) {
            Some(code) => Self::named(code),
            None => Self::Refused,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::BrowserCode;
    use kalsa_mcp::outcome::ToolResult;
    use kalsa_mcp::server_id::ServerId;
    use serde_json::json;

    fn said(for_ui: Option<serde_json::Value>) -> ToolResult {
        ToolResult {
            server: ServerId::new(super::super::SERVER).expect("the browser's own server name"),
            is_error: true,
            for_model: vec!["the sidecar's sentence".to_owned()],
            for_ui,
        }
    }

    /// **The mark the sidecar does send** is read from its own field, and the
    /// browser this app is drawing goes with it.
    #[test]
    fn a_window_the_person_closed_is_named() {
        assert_eq!(BrowserCode::of(&said(Some(json!({"kalsa": {"gone": true}})))), BrowserCode::WindowGone);
    }

    /// **An answer with nothing marked is a refusal, not a guess.** It is the
    /// truth this build can stand behind, and it is what every refusal reads as
    /// until the sidecar says more.
    #[test]
    fn an_unmarked_refusal_is_a_refusal() {
        for for_ui in [None, Some(json!({})), Some(json!({"kalsa": {}}))] {
            assert_eq!(BrowserCode::of(&said(for_ui.clone())), BrowserCode::Refused, "{for_ui:?}");
        }
    }

    /// **The set is closed, and it is closed in one place.** Every code this
    /// build can hand the window is a member of it, and a word from anywhere
    /// else becomes a refusal rather than reaching a person as a name.
    #[test]
    fn the_set_is_closed_and_a_named_code_is_read_from_its_own_field() {
        for every in [
            BrowserCode::WindowGone,
            BrowserCode::Refused,
            BrowserCode::NoPage,
            BrowserCode::ElementGone,
            BrowserCode::FieldGone,
            BrowserCode::Held,
            BrowserCode::Invalid,
        ] {
            assert!(every.as_str().starts_with("browser."), "{} is one of ours", every.as_str());
            let answer = said(Some(json!({"kalsa": {"code": every.as_str()}})));
            let read = BrowserCode::of(&answer);
            assert!(
                read == every || every == BrowserCode::WindowGone,
                "{:?} reads back as {read:?}",
                every.as_str()
            );
        }

        for stranger in ["browser.who_knows", "page.timeout", ""] {
            let answer = said(Some(json!({"kalsa": {"code": stranger}})));
            assert_eq!(BrowserCode::of(&answer), BrowserCode::Refused, "{stranger} is not a code this build knows");
        }
    }

    /// The words travel to the model and the code travels to the screen: the two
    /// are separate, and neither is built from the other.
    #[test]
    fn the_code_is_one_word_and_the_sentence_is_not() {
        let answered = said(Some(json!({"kalsa": {"gone": true}})));
        assert_eq!(BrowserCode::of(&answered).as_str(), "browser.window_gone");
        assert_eq!(answered.for_model, vec!["the sidecar's sentence"], "the model reads the sidecar's words, not the code");
    }
}
