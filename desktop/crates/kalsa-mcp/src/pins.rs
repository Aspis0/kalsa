use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rmcp::model::Tool;
use serde::{Deserialize, Serialize};

use crate::digest::{file_digest, tool_digest};
use crate::error::Error;
use crate::name::NamespacedName;
use crate::permission::PinState;
use crate::server_id::ServerId;

/// What was approved: one digest per tool and one per server program. Holds no
/// secrets, so a later step can keep it on disk as it is.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pins {
    binaries: BTreeMap<String, BinaryPin>,
    tools: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct BinaryPin {
    path: PathBuf,
    sha256: String,
}

impl Pins {
    /// Approves a first-party server program as it is on disk now. The caller
    /// seeds these at build time; nothing approves a program on first start.
    pub fn seed_binary(&mut self, server: &ServerId, path: &Path) -> Result<(), Error> {
        let digest = file_digest(path).map_err(|_| Error::BinaryUnreadable(server.clone()))?;
        self.pin_binary(server, path, digest);
        Ok(())
    }

    /// Approves a program by a digest the caller has already checked against the
    /// file, so the file is not read a second time here.
    pub fn seed_binary_with_digest(&mut self, server: &ServerId, path: &Path, sha256: &str) {
        self.pin_binary(server, path, sha256.to_ascii_lowercase());
    }

    /// Approves one tool definition as the server declares it now.
    pub fn seed_tool(&mut self, server: &ServerId, tool: &Tool) -> Result<(), Error> {
        let name = NamespacedName::new(server, &tool.name)?;
        let digest = tool_digest(tool).map_err(|_| Error::Protocol(server.clone()))?;
        self.pin_tool(&name, digest);
        Ok(())
    }

    pub(crate) fn binary_state(&self, server: &ServerId, path: &Path, sha256: &str) -> PinState {
        match self.binaries.get(&server.to_string()) {
            None => PinState::Unpinned,
            Some(pin) if pin.path == path && pin.sha256 == sha256 => PinState::Pinned,
            Some(_) => PinState::Changed,
        }
    }

    pub(crate) fn tool_state(&self, name: &NamespacedName, sha256: &str) -> PinState {
        match self.tools.get(&name.to_string()) {
            None => PinState::Unpinned,
            Some(pinned) if pinned == sha256 => PinState::Pinned,
            Some(_) => PinState::Changed,
        }
    }

    pub(crate) fn pin_binary(&mut self, server: &ServerId, path: &Path, sha256: String) {
        let pin = BinaryPin { path: path.to_path_buf(), sha256 };
        self.binaries.insert(server.to_string(), pin);
    }

    pub(crate) fn pin_tool(&mut self, name: &NamespacedName, sha256: String) {
        self.tools.insert(name.to_string(), sha256);
    }

    /// Server ids hold no dots, so the prefix matches only that server's tools.
    pub(crate) fn forget_tools(&mut self, server: &ServerId) {
        let prefix = format!("{server}.");
        self.tools.retain(|name, _| !name.starts_with(&prefix));
    }
}
