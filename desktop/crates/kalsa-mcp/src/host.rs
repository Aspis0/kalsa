use std::collections::{HashMap, HashSet};

use serde_json::{Map, Value};

use crate::digest::{file_digest, tool_digest};
use crate::error::Error;
use crate::launch::{Connection, Launch};
use crate::listing::{ListedTool, Listing};
use crate::name::NamespacedName;
use crate::outcome::{CallOutcome, PendingCall, ToolResult};
use crate::permission::{decide, PinState, Permission, Standing};
use crate::pins::Pins;
use crate::record::{ServerRecord, Trust};
use crate::registry::Registry;
use crate::server_id::ServerId;

/// Tools a server answers that no model is ever offered: the person's own answers
/// to what the chat asks, and the list of what is waiting for them. They are not
/// in `tools/list`, so `Host::call` refuses them as unlisted, and only
/// `Host::call_host_only` reaches them.
const HOST_ONLY: &[&str] = &[
    "browser.browser_waiting",
    "browser.browser_pause",
    "browser.browser_resume",
    "browser.browser_confirm",
    "browser.browser_decline",
    "browser.browser_preview",
    "browser.browser_release",
];

/// Routes `<server>.<tool>` calls and applies the host's permissions. Nothing a
/// server sends can raise a permission.
pub struct Host<L: Launch> {
    registry: Registry,
    launcher: L,
    pins: Pins,
    sessions: HashMap<ServerId, Connection>,
    always_allowed: HashSet<(String, NamespacedName)>,
    results_from: HashMap<String, HashSet<ServerId>>,
}

impl<L: Launch> Host<L> {
    pub fn new(registry: Registry, launcher: L, pins: Pins) -> Self {
        Self {
            registry,
            launcher,
            pins,
            sessions: HashMap::new(),
            always_allowed: HashSet::new(),
            results_from: HashMap::new(),
        }
    }

    pub fn pins(&self) -> &Pins {
        &self.pins
    }

    /// Registers the record again, for example with a new bootstrap secret after `ServerGone`.
    pub fn replace_record(&mut self, record: ServerRecord) -> Result<(), Error> {
        let server = record.id().clone();
        self.registry.replace(record)?;
        self.sessions.remove(&server);
        Ok(())
    }

    /// Checks the server's program against its approval, and starts it if it is
    /// approved and not running yet. A third-party server is refused before anything
    /// is read, and a program that is not approved as it is on disk is never started.
    async fn connect(&mut self, server: &ServerId) -> Result<(Trust, PinState), Error> {
        let record = self.registry.get_mut(server).ok_or(Error::UnknownServer)?;
        let trust = record.trust();
        if trust == Trust::ThirdParty {
            return Err(Error::ThirdPartyNeedsSandbox(server.clone()));
        }
        // Every call hashes the whole program, so the read stays off the runtime's threads.
        let program = record.command().to_path_buf();
        let program_sha256 = tokio::task::spawn_blocking(move || file_digest(&program))
            .await
            .map_err(|_| Error::BinaryUnreadable(server.clone()))?
            .map_err(|_| Error::BinaryUnreadable(server.clone()))?;
        let binary = self.pins.binary_state(server, record.command(), &program_sha256);
        if binary != PinState::Pinned {
            log::warn!("mcp server {server}: program pin is {binary:?}, not started");
            self.sessions.remove(server);
            return Ok((trust, binary));
        }
        if !self.sessions.contains_key(server) {
            match self.launcher.launch(record, &program_sha256).await {
                Ok(connection) => {
                    self.sessions.insert(server.clone(), connection);
                }
                Err(error) => {
                    log::warn!("mcp server {server}: start failed: {error:?}");
                    return Err(error);
                }
            }
        }
        Ok((trust, binary))
    }

    /// Asks the server for its tools again and compares each definition with its pin.
    /// A program that is not approved as it is on disk is not started.
    pub async fn list(&mut self, server: &ServerId) -> Result<Listing, Error> {
        let (trust, binary) = self.connect(server).await?;
        if binary != PinState::Pinned {
            return Ok(Listing {
                server: server.clone(),
                binary,
                tools: Vec::new(),
                changed: Vec::new(),
                trust,
            });
        }
        let connection = self.sessions.get(server).ok_or_else(|| Error::ServerGone(server.clone()))?;
        let tools = match connection.list_tools(server).await {
            Ok(tools) => tools,
            Err(error) => {
                log::warn!("mcp server {server}: listing its tools failed: {error:?}");
                self.drop_if_gone(server, &error);
                return Err(error);
            }
        };

        let mut names = HashSet::new();
        let mut listed = Vec::new();
        let mut changed = Vec::new();
        for tool in tools {
            let name = NamespacedName::new(server, &tool.name)?;
            if !names.insert(name.clone()) {
                return Err(Error::DuplicateTool(name));
            }
            let sha256 = tool_digest(&tool).map_err(|_| Error::Protocol(server.clone()))?;
            let definition = self.pins.tool_state(&name, &sha256);
            if definition == PinState::Changed {
                log::warn!("mcp tool {name}: definition pin is changed");
                changed.push(name.clone());
            }
            listed.push((name, tool, definition));
        }
        let tools = listed
            .into_iter()
            .map(|(name, tool, definition)| {
                let standing = Standing {
                    binary,
                    definition,
                    always_allowed: false,
                    untrusted_elsewhere: false,
                };
                let permission = decide(trust, &name, standing);
                ListedTool { name, tool, definition, permission }
            })
            .collect();
        Ok(Listing {
            server: server.clone(),
            binary,
            tools,
            changed,
            trust,
        })
    }

    pub async fn call(
        &mut self,
        conversation: &str,
        name: &str,
        arguments: Map<String, Value>,
    ) -> Result<CallOutcome, Error> {
        let name = NamespacedName::parse(name)?;
        let listing = match self.list(name.server()).await {
            Ok(listing) => listing,
            Err(error) => {
                log::warn!("mcp {name}: listing failed: {error:?}");
                return Err(error);
            }
        };
        match self.permission(&listing, &name, conversation)? {
            Permission::Deny(reason) => {
                log::warn!("mcp {name}: denied: {reason}");
                Err(Error::Denied(name, reason))
            }
            Permission::Ask => Ok(CallOutcome::NeedsConfirmation(PendingCall::new(
                conversation,
                name,
                arguments,
            ))),
            Permission::Allow => match self.run(conversation, &name, arguments).await {
                Ok(result) => Ok(CallOutcome::Ran(result)),
                Err(error) => {
                    log::warn!("mcp {name}: call failed: {error:?}");
                    Err(error)
                }
            },
        }
    }

    /// Calls one of the `HOST_ONLY` tools, for the host and never for a model. The
    /// name must be in that table, and the server's program must be the approved
    /// one; a third-party server is refused by `connect` before anything starts. No
    /// listing is consulted, because these tools are never listed to be pinned.
    pub async fn call_host_only(
        &mut self,
        conversation: &str,
        name: &str,
        arguments: Map<String, Value>,
    ) -> Result<ToolResult, Error> {
        let name = NamespacedName::parse(name)?;
        if !HOST_ONLY.contains(&name.to_string().as_str()) {
            return Err(Error::UnknownTool(name));
        }
        let (_trust, binary) = self.connect(name.server()).await?;
        match binary {
            PinState::Pinned => {}
            PinState::Changed => return Err(Error::BinaryChanged(name.server().clone())),
            PinState::Unpinned => return Err(Error::NotPinned(name.server().clone())),
        }
        self.run(conversation, &name, arguments).await.map_err(|error| {
            log::warn!("mcp {name}: host call failed: {error:?}");
            error
        })
    }

    /// The tool is listed again first, so a definition that changed while the
    /// call waited for confirmation is refused.
    pub async fn confirm(
        &mut self,
        pending: PendingCall,
        arguments: Map<String, Value>,
    ) -> Result<ToolResult, Error> {
        let name = pending.name().clone();
        let listing = self.list(name.server()).await?;
        match self.permission(&listing, &name, pending.conversation())? {
            Permission::Deny(reason) => {
                log::warn!("mcp {name}: confirmation refused: {reason}");
                Err(Error::Denied(name, reason))
            }
            Permission::Ask | Permission::Allow => {
                self.run(pending.conversation(), &name, arguments).await
            }
        }
    }

    /// Approves the tool for this conversation, pinning its current definition.
    /// The server program must already be approved.
    pub async fn always_allow(&mut self, conversation: &str, name: &str) -> Result<(), Error> {
        let name = NamespacedName::parse(name)?;
        let listing = self.list(name.server()).await?;
        match listing.binary {
            PinState::Pinned => {}
            PinState::Changed => return Err(Error::BinaryChanged(name.server().clone())),
            PinState::Unpinned => return Err(Error::NotPinned(name.server().clone())),
        }
        let listed = listing
            .tools
            .iter()
            .find(|listed| listed.name == name)
            .ok_or_else(|| Error::UnknownTool(name.clone()))?;
        if listed.definition != PinState::Pinned {
            let sha256 = tool_digest(&listed.tool).map_err(|_| Error::Protocol(name.server().clone()))?;
            self.pins.pin_tool(&name, sha256);
        }
        self.always_allowed.insert((conversation.to_owned(), name));
        Ok(())
    }

    /// Accepts the server program as it is on disk now. Its tools lose their pins
    /// and standing allows, so each one must be approved again.
    pub fn accept_binary(&mut self, server: &ServerId) -> Result<(), Error> {
        let record = self.registry.get(server).ok_or(Error::UnknownServer)?;
        let sha256 = file_digest(record.command()).map_err(|_| Error::BinaryUnreadable(server.clone()))?;
        self.pins.pin_binary(server, record.command(), sha256);
        self.pins.forget_tools(server);
        self.sessions.remove(server);
        self.always_allowed.retain(|(_, name)| name.server() != server);
        Ok(())
    }

    /// Drops the conversation's always-allow entries and its record of untrusted results.
    pub fn end_conversation(&mut self, conversation: &str) {
        self.always_allowed.retain(|(owner, _)| owner != conversation);
        self.results_from.remove(conversation);
    }

    fn permission(
        &self,
        listing: &Listing,
        name: &NamespacedName,
        conversation: &str,
    ) -> Result<Permission, Error> {
        let definition = match listing.tools.iter().find(|listed| listed.name == *name) {
            Some(listed) => listed.definition,
            None if listing.binary == PinState::Pinned => return Err(Error::UnknownTool(name.clone())),
            None => PinState::Unpinned,
        };
        let key = (conversation.to_owned(), name.clone());
        let untrusted_elsewhere = self
            .results_from
            .get(conversation)
            .is_some_and(|servers| servers.iter().any(|server| server != name.server()));
        let standing = Standing {
            binary: listing.binary,
            definition,
            always_allowed: self.always_allowed.contains(&key),
            untrusted_elsewhere,
        };
        Ok(decide(listing.trust, name, standing))
    }

    async fn run(
        &mut self,
        conversation: &str,
        name: &NamespacedName,
        arguments: Map<String, Value>,
    ) -> Result<ToolResult, Error> {
        let server = name.server();
        let connection = self.sessions.get(server).ok_or_else(|| Error::ServerGone(server.clone()))?;
        match connection.call_tool(server, name.tool(), arguments).await {
            Ok(result) => {
                self.results_from.entry(conversation.to_owned()).or_default().insert(server.clone());
                Ok(result)
            }
            Err(error) => {
                self.drop_if_gone(server, &error);
                Err(error)
            }
        }
    }

    fn drop_if_gone(&mut self, server: &ServerId, error: &Error) {
        if matches!(error, Error::ServerGone(_)) {
            self.sessions.remove(server);
        }
    }
}
