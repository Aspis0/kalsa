use std::fmt;

use crate::error::Error;
use crate::server_id::ServerId;

/// A tool as the model sees it: `<server>.<tool>`. A server id cannot contain a
/// dot and a tool name cannot either, so the split is unambiguous.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct NamespacedName {
    server: ServerId,
    tool: String,
}

impl NamespacedName {
    pub fn parse(name: &str) -> Result<Self, Error> {
        let (server, tool) = name.split_once('.').ok_or(Error::NoNamespace)?;
        Ok(Self { server: ServerId::new(server)?, tool: tool.to_owned() })
    }

    pub(crate) fn new(server: &ServerId, tool: &str) -> Result<Self, Error> {
        if tool.is_empty() || tool.contains('.') {
            return Err(Error::InvalidToolName(server.clone()));
        }
        Ok(Self { server: server.clone(), tool: tool.to_owned() })
    }

    pub(crate) fn server(&self) -> &ServerId {
        &self.server
    }

    pub(crate) fn tool(&self) -> &str {
        &self.tool
    }
}

impl fmt::Display for NamespacedName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.server, self.tool)
    }
}
