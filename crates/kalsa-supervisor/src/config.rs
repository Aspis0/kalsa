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

/// Loopback only: the phone reaches the server through a tunnel, so the
/// server is never exposed on the LAN (plan, section 7).
pub(crate) const HOST: &str = "127.0.0.1";

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

    /// The identity of this exact command, as a state file records it: the
    /// same binary with different arguments is a different server, and an
    /// orphan of one must not be adopted as the other.
    pub(crate) fn binding(&self) -> String {
        format!("{}\x1f{}", self.exe.display(), self.argv.join("\x1f"))
    }

    /// The renderer's structural guarantees, checked where the process is
    /// made: loopback only, on exactly the port the supervisor supervises.
    /// Both the health handshake and the port guard read `port`; an argv that
    /// bound elsewhere would start a server this one could never find — or
    /// expose it off loopback.
    pub(crate) fn verified_binding(&self) -> Result<(), String> {
        let mut host: Option<&String> = None;
        let mut port: Option<&String> = None;
        let mut previous: Option<&String> = None;
        for arg in &self.argv {
            match previous {
                Some(flag) if flag == "--host" => host = Some(arg),
                Some(flag) if flag == "--port" => port = Some(arg),
                _ => {}
            }
            previous = Some(arg);
        }
        let want_port = self.port.to_string();
        if host.map(String::as_str) != Some(HOST)
            || port.map(String::as_str) != Some(want_port.as_str())
        {
            return Err(format!(
                "host is {host:?}, port is {port:?}, want --host {HOST} --port {}",
                self.port
            ));
        }
        Ok(())
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
