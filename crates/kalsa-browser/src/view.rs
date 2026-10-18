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