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