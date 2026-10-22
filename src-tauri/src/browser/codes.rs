//! UI codes and diagnostic stages come from structured fields, never prose.
//! Unknown stages are dropped so page text cannot become a log entry.

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
    /// The read asked for a window of the page the model has already been given.
    ReadAgain,
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
            Self::ReadAgain => "browser.read_again",
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
            "browser.read_again" => Self::ReadAgain,
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

/// Whitelist both stage and log literal so unknown content cannot reach the log.
pub(crate) fn failure_category(result: &ToolResult) -> Option<&'static str> {
    failure_of(result).map(|(_, category)| category)
}

/// **The stage the sidecar named, whitelisted.** It says where the call stopped,
/// and it travels beside the code — to the ledger, which has to tell a failure
/// a retry can answer from one that is dead — and to nobody else. **It is not
/// a sentence and not a name of ours to invent**: a word this build does not
/// know is dropped, exactly as it is dropped for the log.
pub(crate) fn failure_stage(result: &ToolResult) -> Option<&'static str> {
    failure_of(result).map(|(stage, _)| stage)
}

/// The stage and the line the log writes for it, **read in one place**: the two
/// are the same word, and a whitelist that could disagree with itself is a
/// whitelist with two lists in it.
fn failure_of(result: &ToolResult) -> Option<(&'static str, &'static str)> {
    let word = result.for_ui.as_ref()?.pointer("/kalsa/failure")?.as_str()?;
    Some(match word {
        "ref_missing" => ("ref_missing", "browser_failure.ref_missing"),
        "ref_malformed" => ("ref_malformed", "browser_failure.ref_malformed"),
        "ref_unprinted" => ("ref_unprinted", "browser_failure.ref_unprinted"),
        "action_input_failed" => ("action_input_failed", "browser_failure.action_input_failed"),
        "action_unfillable" => ("action_unfillable", "browser_failure.action_unfillable"),
        "action_password" => ("action_password", "browser_failure.action_password"),
        "action_destination" => ("action_destination", "browser_failure.action_destination"),
        "action_not_accepted" => ("action_not_accepted", "browser_failure.action_not_accepted"),
        "action_date_format" => ("action_date_format", "browser_failure.action_date_format"),
        "read_unseen" => ("read_unseen", "browser_failure.read_unseen"),
        "read_address_refused" => ("read_address_refused", "browser_failure.read_address_refused"),
        "read_moved" => ("read_moved", "browser_failure.read_moved"),
        "read_driver" => ("read_driver", "browser_failure.read_driver"),
        "read_again" => ("read_again", "browser_failure.read_again"),
        "open_driver" => ("open_driver", "browser_failure.open_driver"),
        "open_address_refused" => ("open_address_refused", "browser_failure.open_address_refused"),
        "paused" => ("paused", "browser_failure.paused"),
        "unavailable" => ("unavailable", "browser_failure.unavailable"),
        "busy" => ("busy", "browser_failure.busy"),
        "panicked" => ("panicked", "browser_failure.panicked"),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::{failure_category, failure_stage, BrowserCode};
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
            BrowserCode::ReadAgain,
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

    /// **A stage this build knows is a fixed log line of our own**: the word
    /// the sidecar sent is matched, and what the log writes is our category.
    #[test]
    fn a_stage_this_build_knows_is_a_fixed_line_of_our_own() {
        for (word, category) in [
            ("ref_missing", "browser_failure.ref_missing"),
            ("ref_malformed", "browser_failure.ref_malformed"),
            ("ref_unprinted", "browser_failure.ref_unprinted"),
            ("action_input_failed", "browser_failure.action_input_failed"),
            ("action_unfillable", "browser_failure.action_unfillable"),
            ("action_password", "browser_failure.action_password"),
            ("action_destination", "browser_failure.action_destination"),
            ("action_not_accepted", "browser_failure.action_not_accepted"),
            ("action_date_format", "browser_failure.action_date_format"),
            ("read_unseen", "browser_failure.read_unseen"),
            ("read_address_refused", "browser_failure.read_address_refused"),
            ("read_moved", "browser_failure.read_moved"),
            ("read_driver", "browser_failure.read_driver"),
            ("read_again", "browser_failure.read_again"),
            ("open_driver", "browser_failure.open_driver"),
            ("open_address_refused", "browser_failure.open_address_refused"),
            ("paused", "browser_failure.paused"),
            ("unavailable", "browser_failure.unavailable"),
            ("busy", "browser_failure.busy"),
            ("panicked", "browser_failure.panicked"),
        ] {
            let answer = said(Some(json!({ "kalsa": { "failure": word } })));
            assert_eq!(failure_category(&answer), Some(category), "{word}");
        }
    }

    /// **A stage this build does not know is dropped.** The word on the wire is
    /// not ours to trust, and none of them may put *their* word in the log.
    #[test]
    fn a_stage_this_build_does_not_know_is_dropped() {
        let canary = "https://a-very-private-place.example/steal?token=SECRET";
        for word in [
            "browser.who_knows",
            "ref_unprinted ",
            "REF_UNPRINTED",
            "read_driver\nui: chat.tool.opened",
            canary,
        ] {
            let answer = said(Some(json!({ "kalsa": { "failure": word } })));
            assert_eq!(failure_category(&answer), None, "{word} is not a stage this build knows");
        }

        // And the shapes that carry no stage at all are dropped the same way.
        for for_ui in [
            None,
            Some(json!({})),
            Some(json!({ "kalsa": {} })),
            Some(json!({ "kalsa": { "failure": 7 } })),
            Some(json!({ "kalsa": { "failure": null } })),
            Some(json!({ "kalsa": { "failure": { "stage": "read_driver" } } })),
        ] {
            assert_eq!(failure_category(&said(for_ui.clone())), None, "{for_ui:?}");
        }
    }

    /// **The line the log writes is the whole of it.** A category is one fixed
    /// string, so a report line is a code and never a sentence from elsewhere.
    #[test]
    fn the_line_the_log_writes_is_a_code_and_nothing_else() {
        let answer = said(Some(json!({ "kalsa": { "failure": "read_driver" } })));
        let category = failure_category(&answer).expect("a stage this build knows");
        assert_eq!(category, "browser_failure.read_driver");
        assert!(category.starts_with("browser_failure."), "{category}");
        assert!(!category.contains(' '), "{category}");
        assert!(!category.contains("://"), "{category}");
    }

    /// **The stage travels beside the code, and it is whitelisted like the log
    /// line.** The ledger has to tell a failure a retry can answer from one that
    /// is dead, and the stage is what says where the call stopped — so a word
    /// this build does not know is no stage at all.
    #[test]
    fn a_stage_this_build_knows_travels_and_one_it_does_not_is_dropped() {
        let known = said(Some(json!({ "kalsa": { "failure": "read_driver" } })));
        assert_eq!(failure_stage(&known), Some("read_driver"));
        assert_eq!(
            failure_category(&known),
            Some("browser_failure.read_driver"),
            "the same word, read both ways"
        );

        for word in ["browser.who_knows", "ref_unprinted ", "read_driver\nui: chat.tool.opened", ""] {
            let stranger = said(Some(json!({ "kalsa": { "failure": word } })));
            assert_eq!(failure_stage(&stranger), None, "{word} is not a stage this build knows");
        }
        for shape in [
            None,
            Some(json!({})),
            Some(json!({ "kalsa": {} })),
            Some(json!({ "kalsa": { "failure": 7 } })),
        ] {
            assert_eq!(failure_stage(&said(shape.clone())), None, "{shape:?}");
        }
    }
}
