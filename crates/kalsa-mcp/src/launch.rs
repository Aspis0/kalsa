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

/// Starts the server as a child process over its stdio.
pub struct StdioLauncher;

impl Launch for StdioLauncher {
    async fn launch(&self, record: &mut ServerRecord, binary_sha256: &str) -> Result<Connection, Error> {
        let id = record.id().clone();
        if matches!(record.bootstrap_mut(), Bootstrap::Spent) {
            return Err(Error::ServerGone(id));
        }
        verify_binary(record.command(), binary_sha256, &id)?;

        let mut child = Command::new(record.command())
            .args(record.args())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| Error::Launch(id.clone()))?;
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
            secret.write_line(&mut stdin).await.map_err(|_| Error::Launch(id.clone()))?;
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
