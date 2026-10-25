use std::fmt;
use std::path::{Path, PathBuf};

use crate::error::Error;
use crate::secret::BootstrapSecret;
use crate::server_id::ServerId;

/// Decided by the host when it registers a server, never by the server. Only
/// first-party servers get the built-in permission table.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trust {
    FirstParty,
    ThirdParty,
}

/// The secret is wiped once it has been written, so a restart needs a new record.
pub(crate) enum Bootstrap {
    None,
    Secret(BootstrapSecret),
    Spent,
}

pub struct ServerRecord {
    id: ServerId,
    command: PathBuf,
    args: Vec<String>,
    trust: Trust,
    bootstrap: Bootstrap,
}

impl ServerRecord {
    pub fn new(id: ServerId, command: PathBuf, trust: Trust) -> Result<Self, Error> {
        if !command.is_absolute() {
            return Err(Error::RelativeCommand(id));
        }
        Ok(Self { id, command, args: Vec::new(), trust, bootstrap: Bootstrap::None })
    }

    pub fn with_args(mut self, args: Vec<String>) -> Self {
        self.args = args;
        self
    }

    pub fn with_bootstrap(mut self, secret: BootstrapSecret) -> Result<Self, Error> {
        if self.trust == Trust::ThirdParty {
            return Err(Error::BootstrapNeedsFirstParty(self.id));
        }
        self.bootstrap = Bootstrap::Secret(secret);
        Ok(self)
    }

    pub fn id(&self) -> &ServerId {
        &self.id
    }

    pub(crate) fn command(&self) -> &Path {
        &self.command
    }

    pub(crate) fn args(&self) -> &[String] {
        &self.args
    }

    pub(crate) fn trust(&self) -> Trust {
        self.trust
    }

    pub(crate) fn bootstrap_mut(&mut self) -> &mut Bootstrap {
        &mut self.bootstrap
    }
}

impl fmt::Debug for ServerRecord {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let bootstrap = match self.bootstrap {
            Bootstrap::None => "none",
            Bootstrap::Secret(_) => "set",
            Bootstrap::Spent => "spent",
        };
        f.debug_struct("ServerRecord")
            .field("id", &self.id)
            .field("command", &self.command)
            .field("args", &self.args)
            .field("trust", &self.trust)
            .field("bootstrap", &bootstrap)
            .finish()
    }
}
