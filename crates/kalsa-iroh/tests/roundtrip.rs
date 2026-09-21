//! The full loop, on the real transports and nothing mocked: an iroh
//! endpoint dials another one in this process by its 32 public bytes alone,
//! the bytes cross real QUIC over loopback UDP, reach a real
//! `kalsa-door` running on loopback, reach a fake upstream behind the door,
//! and the response comes back through all of it.
//!
//! No internet is touched: both endpoints run with relays disabled and
//! resolve each other through an in-process `AddressBook`, which is the
//! crate's own seam for exactly this. The door must see a wrong credential
//! as a 401 through the tunnel — proof that the tunnel carries bytes and
//! the door still owns authentication.

use std::net::SocketAddr;
use std::time::Duration;

use kalsa_iroh::{AddressBook, Bridge, BridgeConfig, NodeId, NodeKey, RelayChoice};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

/// Any task started by the test dies with the test: an aborted assert must
/// not leak listeners or endpoints behind it.
struct TaskGuard(JoinHandle<()>);

impl Drop for TaskGuard {
    fn drop(&mut self) {
        self.0.abort();
    }
}

const CREDENTIAL: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const UPSTREAM_RESPONSE: &[u8] =
    b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello";

/// The one-device set the door is handed in these tests.
fn one_device(credential: &str) -> kalsa_door::Devices {
    let entry = kalsa_door::DeviceEntry::new(
        kalsa_door::DeviceId::new(0),
        "test device",
        credential.to_string(),
    )
    .expect("a valid test credential");
    kalsa_door::Devices::new(vec![entry]).expect("a valid device set")
}

/// A stand-in for llama-server: it reads one request head, answers with one
/// canned response, closes its write side, and drains until EOF — the shape
/// a non-streaming completion has.
async fn fake_upstream(listener: TcpListener) {
    loop {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        tokio::spawn(async move {
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
            if socket.write_all(UPSTREAM_RESPONSE).await.is_err() {
                return;
            }
            let _ = socket.shutdown().await;
            while let Ok(n) = socket.read(&mut buffer).await {
                if n == 0 {
                    return;
                }
            }
        });
    }
}

async fn upstream_guard() -> (TaskGuard, SocketAddr) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("upstream listener binds");
    let address = listener.local_addr().expect("upstream address");
    (TaskGuard(tokio::spawn(fake_upstream(listener))), address)
}

async fn bridge_to(door: SocketAddr, book: &AddressBook) -> Bridge {
    let key = NodeKey::generate().expect("entropy");
    let config = BridgeConfig::new(door)
        .with_relay(RelayChoice::Disabled)
        .with_address_book(book.clone());
    Bridge::start_with_key(config, &key)
        .await
        .expect("bridge starts")
}

async fn exchange(bridge: &Bridge, target: &NodeId, credential: &str) -> String {
    let mut tunnel = bridge.connect(*target).await.expect("tunnel opens");
    let request = format!(
        "GET /v1/models HTTP/1.1\r\nHost: kalsa\r\n\
         Authorization: Bearer {credential}\r\nConnection: close\r\n\r\n"
    );
    tunnel
        .write_all(request.as_bytes())
        .await
        .expect("request written");
    tunnel.flush().await.expect("request flushed");
    let mut response = Vec::new();
    tunnel.read_to_end(&mut response).await.expect("response read");
    String::from_utf8(response).expect("utf-8")
}

#[tokio::test(flavor = "multi_thread")]
async fn the_full_loop_carries_http_through_the_tunnel_and_the_door() {
    let _upstream = upstream_guard().await;

    // The real door, on its own loopback port, in front of the fake upstream.
    let door_listener = std::net::TcpListener::bind("127.0.0.1:0").expect("door listener binds");
    let door_port = door_listener.local_addr().expect("door address").port();
    let running_door = kalsa_door::Door::new(
        door_listener,
        _upstream.1.port(),
        one_device(CREDENTIAL),
        1,
    )
    .expect("door builds")
    .start()
    .expect("door starts");
    assert_eq!(running_door.address().port(), door_port);

    let book = AddressBook::new();
    let server = bridge_to(running_door.address(), &book).await;
    let client = bridge_to(running_door.address(), &book).await;

    // The whole point: the caller has 32 public bytes, nothing else.
    let response = exchange(&client, &server.node_id(), CREDENTIAL).await;
    assert!(
        response.starts_with("HTTP/1.1 200 OK"),
        "expected the upstream's answer, got: {response}"
    );
    assert!(response.ends_with("hello"), "expected the body, got: {response}");

    // The door is in the path, not bypassed: its refusal comes back through
    // the same tunnel.
    let wrong = format!("{}{}", "b".repeat(63), "c");
    let refused = exchange(&client, &server.node_id(), &wrong).await;
    assert!(
        refused.starts_with("HTTP/1.1 401"),
        "the door must refuse a wrong credential through the tunnel: {refused}"
    );
}

/// The production shape: both endpoints on the n0 road — DNS address lookup
/// via iroh.link, n0 relays as the fallback — dialing by node id alone,
/// with no in-process book to help them. Pretends the real internet, so it
/// is `#[ignore]`d; run it with `cargo test -p kalsa-iroh -- --ignored`
/// after an iroh bump. Without a network it prints why and passes through.
#[tokio::test(flavor = "multi_thread")]
#[ignore = "dials the real n0 lookup and relay infrastructure"]
async fn the_n0_road_carries_http_by_node_id_alone() {
    // The network check is the test's own gate: a lookup server that
    // cannot be reached in three seconds means no road to test.
    use std::net::ToSocketAddrs;
    let relay = ("use1-1.relay.n0.iroh.link", 443)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next());
    let reachable = relay.is_some_and(|addr| {
        std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(3)).is_ok()
    });
    if !reachable {
        println!("skipped: n0 relay unreachable in 3s — no network, nothing to test");
        return;
    }

    let _upstream = upstream_guard().await;
    let door_listener = std::net::TcpListener::bind("127.0.0.1:0").expect("door listener binds");
    let running_door = kalsa_door::Door::new(
        door_listener,
        _upstream.1.port(),
        one_device(CREDENTIAL),
        1,
    )
    .expect("door builds")
    .start()
    .expect("door starts");

    // Defaults everywhere: N0Public relay, no book, the plain 10s dial
    // deadline. Publishing to the lookup is public by design; these are
    // throwaway keys.
    let server_key = NodeKey::generate().expect("entropy");
    let server = Bridge::start_with_key(
        BridgeConfig::new(running_door.address()),
        &server_key,
    )
    .await
    .expect("server bridge starts");
    let client_key = NodeKey::generate().expect("entropy");
    let client = Bridge::start_with_key(BridgeConfig::new(running_door.address()), &client_key)
        .await
        .expect("client bridge starts");

    // The phone's side of the story: 32 bytes in, the door's answer out.
    // Publishing and resolving through the n0 DNS road takes its own time;
    // the default 10s dial deadline bounds the whole attempt.
    let response = exchange(&client, &server.node_id(), CREDENTIAL).await;
    assert!(
        response.starts_with("HTTP/1.1 200 OK"),
        "expected the upstream's answer over the n0 road, got: {response}"
    );
}
