//! The phone's half of this crate, in both directions of the claim: a
//! dial-only bridge reaches a serving bridge's door and desk exactly as any
//! other dialer does, and nothing that is dialled AT it is ever served —
//! there is no accept loop behind it. Relays disabled, both endpoints in
//! one process over an in-process book, so no network is touched.

use std::time::{Duration, Instant};

use kalsa_iroh::{AddressBook, Bridge, BridgeConfig, BridgeError, Lane, NodeKey, RelayChoice};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// A stand-in for a loopback service: it reads one request head, answers
/// with one marker nothing else in these tests produces, and closes. The
/// marker says which service the bytes actually reached.
async fn marker_service(listener: TcpListener, marker: &'static str) {
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
            let answer =
                format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{marker}", marker.len());
            let _ = socket.write_all(answer.as_bytes()).await;
            let _ = socket.shutdown().await;
        });
    }
}

/// The phone only dials, and the road still carries it: both lanes of the
/// serving bridge answer, each with the marker of the service that lane is
/// bound to.
#[tokio::test(flavor = "multi_thread")]
async fn a_dial_only_bridge_reaches_a_serving_bridge_door_and_desk() {
    let door_listener = TcpListener::bind("127.0.0.1:0").await.expect("door binds");
    let desk_listener = TcpListener::bind("127.0.0.1:0").await.expect("desk binds");
    let door_addr = door_listener.local_addr().expect("door address");
    let desk_addr = desk_listener.local_addr().expect("desk address");
    tokio::spawn(marker_service(door_listener, "door-stub"));
    tokio::spawn(marker_service(desk_listener, "desk-stub"));

    let book = AddressBook::new();
    let serving = Bridge::start_with_key(
        BridgeConfig::new(door_addr)
            .with_desk(desk_addr)
            .with_relay(RelayChoice::Disabled)
            .with_address_book(book.clone()),
        &NodeKey::generate().expect("entropy"),
    )
    .await
    .expect("serving bridge starts");
    let dialer = Bridge::start_with_key(
        BridgeConfig::dial_only()
            .with_relay(RelayChoice::Disabled)
            .with_address_book(book.clone()),
        &NodeKey::generate().expect("entropy"),
    )
    .await
    .expect("dial-only bridge starts");

    for (lane, marker) in [(Lane::Door, "door-stub"), (Lane::Desk, "desk-stub")] {
        let mut tunnel = dialer
            .connect(serving.node_id(), lane)
            .await
            .expect("the phone's tunnel opens");
        tunnel
            .write_all(b"GET /v1/models HTTP/1.1\r\nHost: kalsa\r\nConnection: close\r\n\r\n")
            .await
            .expect("request written");
        tunnel.flush().await.expect("request flushed");
        let mut answer = Vec::new();
        tunnel.read_to_end(&mut answer).await.expect("answer read");
        let answer = String::from_utf8(answer).expect("utf-8");
        assert!(
            answer.contains(marker),
            "the {lane:?} lane must reach the serving bridge's {marker}: {answer}"
        );
    }
}

/// The other half: nobody serves a dial-only bridge. With no accept loop
/// behind it the peer's handshake never begins, so the dialer's own deadline
/// is what ends the wait — an error, bounded, never a stream.
#[tokio::test(flavor = "multi_thread")]
async fn a_stream_dialled_at_a_dial_only_bridge_is_refused() {
    let book = AddressBook::new();
    let phone = Bridge::start_with_key(
        BridgeConfig::dial_only()
            .with_relay(RelayChoice::Disabled)
            .with_address_book(book.clone()),
        &NodeKey::generate().expect("entropy"),
    )
    .await
    .expect("the phone's bridge starts");
    let caller = Bridge::start_with_key(
        BridgeConfig::dial_only()
            .with_relay(RelayChoice::Disabled)
            .with_dial_timeout(Duration::from_secs(2))
            .with_address_book(book.clone()),
        &NodeKey::generate().expect("entropy"),
    )
    .await
    .expect("the caller's bridge starts");

    let started = Instant::now();
    let outcome = caller.connect(phone.node_id(), Lane::Door).await;
    let elapsed = started.elapsed();

    let Err(error) = &outcome else {
        panic!("a dial-only bridge accepted a stream it has nothing to serve");
    };
    assert!(
        matches!(error, BridgeError::Deadline),
        "expected the caller's own deadline, got: {error}"
    );
    assert!(
        elapsed < Duration::from_secs(8),
        "the refusal stalled {elapsed:?}"
    );
}

/// The config names its own mistake: a desk lane has no door to ride
/// beside, so a dial-only config that carries one is an error, never a
/// builder call quietly ignored.
#[tokio::test(flavor = "multi_thread")]
async fn a_dial_only_config_cannot_carry_a_desk() {
    let desk = "127.0.0.1:1".parse().expect("static address");
    let outcome = Bridge::start_with_key(
        BridgeConfig::dial_only()
            .with_relay(RelayChoice::Disabled)
            .with_desk(desk),
        &NodeKey::generate().expect("entropy"),
    )
    .await;
    assert!(
        matches!(outcome, Err(BridgeError::Config(_))),
        "a desk without a door must be refused at start"
    );
}
