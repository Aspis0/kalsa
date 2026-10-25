use serde_json::{Map, Value};

use crate::name::NamespacedName;
use crate::server_id::ServerId;

/// `for_model` is the only part the model reads: the text the server sent, unchanged.
/// `for_ui` is structured content, kept out of the model so its fields cannot act as instructions.
pub struct ToolResult {
    pub server: ServerId,
    pub is_error: bool,
    pub for_model: Vec<String>,
    pub for_ui: Option<Value>,
}

/// Only `Host::call` builds one, so `Host::confirm` can run an Ask tool only
/// after the call that asked for it.
pub struct PendingCall {
    conversation: String,
    name: NamespacedName,
    arguments: Map<String, Value>,
}

impl PendingCall {
    pub(crate) fn new(conversation: &str, name: NamespacedName, arguments: Map<String, Value>) -> Self {
        Self { conversation: conversation.to_owned(), name, arguments }
    }

    pub(crate) fn conversation(&self) -> &str {
        &self.conversation
    }

    pub fn name(&self) -> &NamespacedName {
        &self.name
    }

    pub fn arguments(&self) -> &Map<String, Value> {
        &self.arguments
    }
}

pub enum CallOutcome {
    Ran(ToolResult),
    NeedsConfirmation(PendingCall),
}
