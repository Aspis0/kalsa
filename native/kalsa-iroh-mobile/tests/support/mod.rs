//! The shared rig for the integration tests: temp dirs, the loopback
//! upstreams the desktop bridge forwards to, and the desktop bridge
//! itself — always network-free (relays off, in-process address book).
//! Every test binary links this module but uses a slice of it.

#![allow(dead_code)]

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use kalsa_iroh::{AddressBook, Bridge, BridgeConfig, RelayChoice};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

// Tests run in parallel in one binary: every temp dir must be its own.
static DIR_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn temp_dir(tag: &str) -> PathBuf {
    let seq = DIR_SEQ.fetch_add(1, Ordering::Relaxed);
    let dir = std::env::temp_dir()
        .join(format!("kalsa-iroh-mobile-{}-{tag}-{seq}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir creates");
    dir
}

/// What a stand-in upstream does with the one request it serves.
pub enum Upstream {
    /// Answer one request head with these bytes, then close the write side.
    Respond(Vec<u8>),
    /// Read the request head, then hold the connection open in silence.
    Silent,
    /// Read the request head, wait, then echo it back — late enough that a
    /// parked reader is provably parked before any byte returns.
    EchoAfter(Duration),
}

pub async fn spawn_upstream(behavior: Upstream) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("upstream binds");
    let address = listener.local_addr().expect("upstream address");
    tokio::spawn(serve_once(listener, behavior));
    address
}

async fn serve_once(listener: TcpListener, behavior: Upstream) {
    let Ok((mut socket, _)) = listener.accept().await else {
        return;
    };
    let mut buffer = vec![0u8; 4096];
    let mut head = Vec::new();
    loop {
        match socket.read(&mut buffer).await {
            Ok(0) | Err(_) => return,
            Ok(n) => {
                head.extend_from_slice(&buffer[..n]);
                if head.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
        }
    }
    match behavior {
        Upstream::Respond(response) => {
            let _ = socket.write_all(&response).await;
            let _ = socket.shutdown().await;
        }
        Upstream::Silent => {
            // Parked upstream: drain until the tunnel closes, never answer.
            loop {
                match socket.read(&mut buffer).await {
                    Ok(0) | Err(_) => return,
                    Ok(_) => {}
                }
            }
        }
        Upstream::EchoAfter(delay) => {
            tokio::time::sleep(delay).await;
            let _ = socket.write_all(&head).await;
            let _ = socket.shutdown().await;
            let _ = socket.read(&mut buffer).await;
        }
    }
}

/// The desktop side of a test: brain's bridge with both lanes on the
/// given upstreams, key from a real file, relays off, book-wired.
pub async fn desktop_bridge(
    dir: &Path,
    book: &AddressBook,
    door: SocketAddr,
    desk: Option<SocketAddr>,
) -> Bridge {
    let mut config = BridgeConfig::new(door)
        .with_relay(RelayChoice::Disabled)
        .with_address_book(book.clone());
    if let Some(desk) = desk {
        config = config.with_desk(desk);
    }
    Bridge::start(config, &dir.join("desktop.key"))
        .await
        .expect("desktop bridge starts")
}
