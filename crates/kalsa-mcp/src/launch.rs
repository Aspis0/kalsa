use std::future::Future;
use std::path::Path;
use std::process::Stdio;

use rmcp::model::ProtocolVersion;
use rmcp::service::{ClientInitializeError, ClientLifecycleMode, ClientServiceExt, RoleClient, RunningService};
use tokio::process::{Child, Command};
use tokio::time::timeout;

use crate::digest::file_digest;
use crate::error::Error;
use crate::record::{Bootstrap, ServerRecord};
use crate::server_id::ServerId;
use crate::session::DISCOVER_DEADLINE;

/// One live MCP connection. Dropping it kills the child, so a timed-out or
/// broken server is stopped by dropping its connection.
pub struct Connection {
    pub(crate) service: RunningService<RoleClient, ()>,
    _child: Option<Child>,
}

impl Connection {
    pub fn new(service: RunningService<RoleClient, ()>, child: Option<Child>) -> Self {
        Self { service, _child: child }
    }
}

/// How a server is started. `binary_sha256` is the approved digest of the program;
/// an implementation must not start a program that does not match it.
pub trait Launch: Send + Sync {
    fn launch(
        &self,
        record: &mut ServerRecord,
        binary_sha256: &str,
    ) -> impl Future<Output = Result<Connection, Error>> + Send;
}

/// Starts the server as a child process over its stdio, with the whole
/// environment of this process.
pub struct StdioLauncher;

impl Launch for StdioLauncher {
    async fn launch(&self, record: &mut ServerRecord, binary_sha256: &str) -> Result<Connection, Error> {
        start(record, binary_sha256, |_| {}).await
    }
}

/// Starts the server as a child process over its stdio with **only** the
/// variables it is given: the environment is cleared first and the named pairs
/// are set after, so nothing in this process's environment reaches the child.
///
/// The overrides a sidecar honours are exactly the ones an ambient value can
/// subvert — `PLAYWRIGHT_NODE_EXE` names the runtime, `PLAYWRIGHT_CLI_JS` the
/// script, and both together mean "no driver directory is needed at all"
/// (`playwright-rs` `src/server/driver.rs:25-31`). A sealed child sees the
/// driver this host verified and nothing else.
pub struct SealedStdioLauncher {
    vars: Vec<(String, String)>,
}

impl SealedStdioLauncher {
    pub fn new(vars: impl IntoIterator<Item = (String, String)>) -> Self {
        Self { vars: vars.into_iter().collect() }
    }
}

impl Launch for SealedStdioLauncher {
    async fn launch(&self, record: &mut ServerRecord, binary_sha256: &str) -> Result<Connection, Error> {
        let vars = &self.vars;
        start(record, binary_sha256, |command: &mut Command| {
            command.env_clear();
            for (name, value) in vars {
                command.env(name, value);
            }
        })
        .await
    }
}

/// The launch both launchers share: check the digest, spawn, check it again,
/// write the bootstrap line, and hand back the connection.
async fn start(
    record: &mut ServerRecord,
    binary_sha256: &str,
    environment: impl FnOnce(&mut Command),
) -> Result<Connection, Error> {
    let id = record.id().clone();
    if matches!(record.bootstrap_mut(), Bootstrap::Spent) {
        log::warn!("mcp server {id}: its bootstrap was used by an earlier start");
        return Err(Error::ServerGone(id));
    }
    verify_binary(record.command(), binary_sha256, &id)?;

    let mut command = Command::new(record.command());
    command
        .args(record.args())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    environment(&mut command);
    let mut child = command.spawn().map_err(|error| {
        log::warn!("mcp server {id}: spawn failed: {:?}", error.kind());
        Error::Launch(id.clone())
    })?;
    verify_binary(record.command(), binary_sha256, &id)?;

    let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        return Err(Error::Launch(id));
    };
    let secret = match std::mem::replace(record.bootstrap_mut(), Bootstrap::None) {
        Bootstrap::Secret(secret) => {
            *record.bootstrap_mut() = Bootstrap::Spent;
            Some(secret)
        }
        _ => None,
    };
    if let Some(secret) = secret {
        secret.write_line(&mut stdin).await.map_err(|_| {
            log::warn!("mcp server {id}: bootstrap line was not written");
            Error::Launch(id.clone())
        })?;
    }

    let lifecycle = ClientLifecycleMode::Discover {
        preferred_versions: vec![ProtocolVersion::V_2026_07_28],
    };
    let handshake = ().serve_with_lifecycle((stdout, stdin), lifecycle);
    let service = match timeout(DISCOVER_DEADLINE, handshake).await {
        Ok(Ok(service)) => service,
        Ok(Err(error)) => return Err(handshake_error(error, &id)),
        Err(_) => return Err(Error::ServerGone(id)),
    };
    Ok(Connection::new(service, Some(child)))
}

/// Checked before spawn and again after it. The secret is written only once both
/// checks pass, so a swapped program never receives it.
fn verify_binary(path: &Path, expected: &str, id: &ServerId) -> Result<(), Error> {
    match file_digest(path) {
        Ok(digest) if digest == expected => Ok(()),
        Ok(_) => Err(Error::BinaryChanged(id.clone())),
        Err(_) => Err(Error::BinaryUnreadable(id.clone())),
    }
}

fn handshake_error(error: ClientInitializeError, id: &ServerId) -> Error {
    match error {
        ClientInitializeError::ConnectionClosed(_) | ClientInitializeError::TransportError { .. } => {
            Error::ServerGone(id.clone())
        }
        _ => Error::Protocol(id.clone()),
    }
}
