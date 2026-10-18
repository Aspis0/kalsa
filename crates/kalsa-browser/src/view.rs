//! What a tool call answers with (one responsibility: the two shapes a result
//! takes, and the rule about what may be in one).

use rmcp::model::{CallToolResult, ContentBlock};

/// The text the model reads.
pub(crate) fn answered(text: String) -> CallToolResult {
    CallToolResult::success(vec![ContentBlock::text(text)])
}

/// A sentence the model can act on. Page text never comes back this way, so a
/// refusal cannot carry a stranger's words into the transcript.
pub(crate) fn refused(reason: impl Into<String>) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(reason.into())])
}

/// **The same sentence, and a machine-readable fact beside it.**
///
/// Used for exactly one answer: the window is gone, because the person closed the
/// browser rather than because this refused them. That is not a distinction the
/// model can act on and **the host cannot read a sentence for it** — the refusal
/// and a closed window arrive as the same kind of result with the same shape, so
/// the app carries on showing a window that is no longer there, and a paused one
/// stays paused with nobody watching. So the fact is carried where a caller can
/// read it without parsing prose: `structuredContent.kalsa.gone` is `true` here
/// and absent everywhere else.
///
/// The text is unchanged, because the model still needs a sentence; this is added
/// beside it, never in place of it. Written in the crate README for the host.
pub(crate) fn gone(reason: impl Into<String>) -> CallToolResult {
    let mut result = refused(reason);
    result.structured_content = Some(serde_json::json!({ "kalsa": { "gone": true } }));
    result
}

/// The same answer with something said in front of it.
///
/// This is how an outcome reaches the model. The tool call that made a request
/// returned while it was still held, so the answer to it arrives later, when the
/// model next acts — and the only place it can be said is in front of that next
/// answer. The error flag is the answer's own: a call that was refused stays
/// refused, with a line about the request in front of it.
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
    // `CallToolResult` is not ours to build by hand, so the answer's own shape
    // is carried across: a refused call stays refused.
    let mut next = if result.is_error == Some(true) {
        CallToolResult::error(vec![ContentBlock::text(said)])
    } else {
        CallToolResult::success(vec![ContentBlock::text(said)])
    };
    next.result_type = result.result_type;
    next.meta = result.meta;
    next
}

#[cfg(test)]
mod tests {
    use super::{answered, gone, refused};

    /// **The mark is on exactly one answer.** A host reads `structuredContent` to
    /// decide whether to keep showing a window, so a mark anywhere else would
    /// close a window that is still there — the failure is worse than the one the
    /// mark was added for.
    #[test]
    fn only_the_gone_answer_carries_the_mark() {
        let marked = gone("the browser was closed");
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

    /// The wire spelling is what the host is told to look for, so it is pinned
    /// here rather than left to whatever the serializer does with the field.
    #[test]
    fn the_mark_is_spelled_the_way_the_host_reads_it() {
        let wire = serde_json::to_value(gone("x")).expect("a result serializes");
        assert!(wire.get("structuredContent").is_some(), "the field is named structuredContent on the wire: {wire}");
        assert_eq!(wire.pointer("/structuredContent/kalsa/gone"), Some(&serde_json::json!(true)));
    }
}
