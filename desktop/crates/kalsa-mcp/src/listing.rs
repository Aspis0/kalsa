use rmcp::model::Tool;

use crate::name::NamespacedName;
use crate::permission::{PinState, Permission};
use crate::record::Trust;
use crate::server_id::ServerId;

/// `permission` is the one a conversation without an "always allow" gets.
pub struct ListedTool {
    pub name: NamespacedName,
    pub tool: Tool,
    pub definition: PinState,
    pub permission: Permission,
}

/// Empty `tools` means the program is not approved, so it was not started.
pub struct Listing {
    pub server: ServerId,
    pub binary: PinState,
    pub tools: Vec<ListedTool>,
    /// Their definition no longer matches the pin, so they are Deny until approved again.
    pub changed: Vec<NamespacedName>,
    pub(crate) trust: Trust,
}
