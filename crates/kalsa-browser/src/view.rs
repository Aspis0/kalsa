//! What a tool call answers with: the two shapes a result takes, and the rule
//! about what may be in one.

use rmcp::model::{CallToolResult, ContentBlock};

use crate::failure::Stage;

/// The text the model reads.
pub(crate) fn answered(text: String) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(text)])
}

/// A sentence the model can act on. Page text never comes back this way, so a
/// refusal cannot carry a stranger's words into the transcript.
pub(crate) fn refused(reason: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(reason.into())])
}

/// Keep diagnostic stages separate from the model-facing sentence.
pub(crate) fn failed(stage: Stage, reason: impl Into<String>) -> CallToolResult {
    let mut result = refused(reason);
    result.structured_content = Some(serde_json::json!({ "kalsa": { "failure": stage.as_str() } }));
    result
}

/// Only an ended session carries the gone mark; the host uses it to drop the sidecar.
pub(crate) fn gone(stage: Stage, reason: impl Into<String>) -> CallToolResult {
    let mut result = refused(reason);
    result.structured_content =
        Some(serde_json::json!({ "kalsa": { "gone": true, "failure": stage.as_str() } }));
    result
}

/// Pending outcomes precede the next answer without losing its lifecycle metadata.
pub(crate) fn prefixed(result: CallToolResult, lines: &[String]) -> CallToolResult {
    if lines.is_empty() {
        return result;
    }
    let mut said = lines.join("\n\n");
    if let Some(ContentBlock::Text(text)) = result.content.first() {
        if !text.text.is_empty() {
            said.push_str("\n\n");
            said.push_str(&text.text);
        }
    }
    // The answer's own shape is carried across: a refused call stays refused.
    let mut next = if result.is_error == Some(true) {
        CallToolResult::error(vec![ContentBlock::text(said)])
    } else {
        CallToolResult::success(vec![ContentBlock::text(said)])
    };
    next.result_type = result.result_type;
    next.meta = result.meta;
    next.structured_content = result.structured_content;
    next
}

#[cfg(test)]
mod tests {
    use super::{answered, failed, gone, prefixed, refused, Stage};

    /// **The mark is on exactly one answer.** A mark anywhere else would close a
    /// window that is still there — worse than the one the mark was added for.
    #[test]
    fn only_the_gone_answer_carries_the_mark() {
        let marked = gone(Stage::ReadDriver, "the browser was closed");
        assert_eq!(
            marked.structured_content.as_ref().and_then(|mark| mark.pointer("/kalsa/gone")).and_then(|v| v.as_bool()),
            Some(true),
            "the host reads this: {marked:?}"
        );
        assert_eq!(marked.is_error, Some(true), "and it is still a refusal the model can read");
        assert!(
            marked.content.iter().any(|part| matches!(part, rmcp::model::ContentBlock::Text(written) if written.text == "the browser was closed")),
            "the sentence is beside the mark, never replaced by it"
        );

        assert_eq!(refused("no").structured_content, None, "an ordinary refusal says nothing");
        assert_eq!(refused("no").is_error, Some(true));
        assert_eq!(answered("yes".to_string()).structured_content, None, "and an answer never says it either");
    }

    /// **A refusal that stopped at a stage says which one, and only that.** One
    /// word out of a closed set, so nothing a stranger wrote can ride in it.
    #[test]
    fn a_refusal_carries_the_stage_it_stopped_at_and_nothing_else() {
        let answer = failed(Stage::RefUnprinted, "that element is not one this page printed");
        assert_eq!(
            answer.structured_content.as_ref().and_then(|mark| mark.pointer("/kalsa/failure")).and_then(|v| v.as_str()),
            Some("ref_unprinted"),
            "the stage is where the host reads it: {answer:?}"
        );
        assert_eq!(
            answer.structured_content.as_ref().and_then(|mark| mark.pointer("/kalsa/gone")),
            None,
            "a refusal that did not end the window does not say it did"
        );
        assert_eq!(answer.is_error, Some(true));
        assert!(
            answer.content.iter().any(|part| matches!(part, rmcp::model::ContentBlock::Text(written) if written.text == "that element is not one this page printed")),
            "the sentence the model reads is unchanged"
        );
    }

    /// **A window that ended says so and says where the call stopped.** The host
    /// needs both: one to close the window, one to log.
    #[test]
    fn a_gone_answer_carries_the_mark_and_the_stage() {
        let answer = gone(Stage::ReadDriver, "the browser window is closed");
        assert_eq!(answer.structured_content.as_ref().and_then(|mark| mark.pointer("/kalsa/gone")).and_then(|v| v.as_bool()), Some(true));
        assert_eq!(
            answer.structured_content.as_ref().and_then(|mark| mark.pointer("/kalsa/failure")).and_then(|v| v.as_str()),
            Some("read_driver")
        );
    }

    /// **The wire spelling is pinned here**, rather than left to whatever the
    /// serializer does with the field.
    #[test]
    fn the_mark_is_spelled_the_way_the_host_reads_it() {
        let wire = serde_json::to_value(gone(Stage::ReadDriver, "x")).expect("a result serializes");
        assert!(wire.get("structuredContent").is_some(), "the field is named structuredContent on the wire: {wire}");
        assert_eq!(wire.pointer("/structuredContent/kalsa/gone"), Some(&serde_json::json!(true)));
        assert_eq!(wire.pointer("/structuredContent/kalsa/failure"), Some(&serde_json::json!("read_driver")));
    }

    #[test]
    fn the_marks_survive_an_outcome_said_in_front_of_the_answer() {
        let answered = prefixed(gone(Stage::ReadDriver, "the browser window is closed"), &["A request was declined.".to_owned()]);
        assert_eq!(
            answered.structured_content.as_ref().and_then(|mark| mark.pointer("/kalsa/gone")).and_then(|v| v.as_bool()),
            Some(true),
            "the window is still gone after the outcome was said: {answered:?}"
        );
        assert_eq!(
            answered.structured_content.as_ref().and_then(|mark| mark.pointer("/kalsa/failure")).and_then(|v| v.as_str()),
            Some("read_driver")
        );
        assert_eq!(answered.is_error, Some(true), "and it is still a refusal");
        assert!(
            answered.content.iter().any(|part| matches!(part, rmcp::model::ContentBlock::Text(written) if written.text.starts_with("A request was declined.") && written.text.ends_with("the browser window is closed"))),
            "the model reads the outcome and then the sentence, as it did before: {answered:?}"
        );
    }

    /// The same for a refusal that did not end the window: its stage survives
    /// the outcome too.
    #[test]
    fn the_stage_of_a_refusal_survives_an_outcome_said_in_front_of_it() {
        let answered = prefixed(failed(Stage::RefMissing, "no element was named"), &["A request was declined.".to_owned()]);
        assert_eq!(
            answered.structured_content.as_ref().and_then(|mark| mark.pointer("/kalsa/failure")).and_then(|v| v.as_str()),
            Some("ref_missing")
        );
        assert_eq!(answered.structured_content.as_ref().and_then(|mark| mark.pointer("/kalsa/gone")), None);
    }
}
