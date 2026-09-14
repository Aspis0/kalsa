//! Readiness handshake.
//!
//! `llama-server` has no startup line to read: it logs to stderr and starts
//! answering `/health` once the model is loaded (`503` while it is still
//! loading). So readiness is a probe with a deadline, never a `sleep` of a
//! guessed duration — a sleep is either too short (the first request fails) or
//! too long (the user waits on a machine that is already serving).
//!
//! Deliberately no HTTP client dependency: one request, one status line.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

/// True when `addr` answers `path` with `200` within `timeout`.
///
/// Any failure (refused, timeout, 503 "loading", garbage) is false: the caller
/// polls until its own deadline, and reports the last probe as the reason.
pub fn health_ok(addr: SocketAddr, path: &str, timeout: Duration) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!("GET {path} HTTP/1.0\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut head = [0u8; 32];
    let read = stream.read(&mut head).unwrap_or(0);
    status_is_ok(&String::from_utf8_lossy(&head[..read]))
}

/// `HTTP/1.x 200 …` — the reason phrase may be anything, the code may not.
fn status_is_ok(response_head: &str) -> bool {
    let mut parts = response_head.split_whitespace();
    let version = parts.next().unwrap_or_default();
    let code = parts.next().unwrap_or_default();
    version.starts_with("HTTP/1.") && code == "200"
}

#[cfg(test)]
mod tests {
    use super::status_is_ok;

    #[test]
    fn accepts_200_only() {
        assert!(status_is_ok(
            "HTTP/1.0 200 OK\r\nContent-Length: 15\r\n\r\n"
        ));
        assert!(status_is_ok("HTTP/1.1 200"));
        assert!(!status_is_ok("HTTP/1.1 503 Service Unavailable"));
        assert!(!status_is_ok("HTTP/1.1 404 Not Found"));
        assert!(!status_is_ok(""));
        assert!(!status_is_ok("garbage"));
    }
}
