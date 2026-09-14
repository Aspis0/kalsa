//! What the supervisor is asked to run: an executable, its already-rendered
//! command line, and the terms of supervision.
//!
//! The command line is carried as data the supervisor does not interpret:
//! the one renderer for llama-server's arguments is `kalsa-launch`'s
//! `ServerArgs::argv`, and a second renderer here is exactly how a flag the
//! real server rejects ships to every user while every test stays green.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

/// How long the server gets to exit after stdin EOF, and again after SIGTERM.
pub const DEFAULT_STOP_GRACE: Duration = Duration::from_secs(5);

#[derive(Clone, Debug)]
pub struct ServerConfig {
    pub exe: PathBuf,
    /// The exact arguments the server is started with, rendered once by the
    /// launch crate (`kalsa-launch`) and passed through untouched: the
    /// supervisor runs the launch decision, it does not have one.
    pub argv: Vec<String>,
    /// Where this instance announces itself, so a later start can recognise
    /// its own orphan instead of killing a stranger. See `instance`.
    pub state_file: PathBuf,
    pub port: u16,
    pub ready_timeout: Duration,
    pub stop_grace: Duration,
}

impl ServerConfig {
    pub(crate) fn address(&self) -> SocketAddr {
        SocketAddr::from(([127, 0, 0, 1], self.port))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_address_is_loopback_and_the_port() {
        let config = ServerConfig {
            exe: PathBuf::from("/nonexistent/llama-server"),
            argv: vec!["--port".into(), "8123".into()],
            state_file: PathBuf::from("/tmp/kalsa-brain.state"),
            port: 8123,
            ready_timeout: Duration::from_secs(1),
            stop_grace: Duration::from_millis(50),
        };
        assert_eq!(config.address().to_string(), "127.0.0.1:8123");
    }
}
