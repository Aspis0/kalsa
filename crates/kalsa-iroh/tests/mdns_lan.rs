//! LAN discovery over mDNS, the shape the lab owes a measurement: n0's
//! relay and DNS unreachable, and the phone still finds the door — one
//! endpoint serving on the LAN, one dialing its 32 public bytes alone, and
//! mDNS the only address lookup either side holds. No `AddressBook`, no
//! relay, nothing else to resolve through.

use kalsa_iroh::{Bridge, BridgeConfig, Lane, NodeKey, RelayChoice};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// The loopback service behind the door: reads exactly one message, echoes
/// it, done. Bounded lengths, no half-close choreography — the tunnel's
/// pump keeps a request direction open past a silent peer on purpose, so
/// an end-of-stream test would wait out the tunnel's own patience.
async fn echo_once(listener: TcpListener) -> [u8; 4] {
    let (mut socket, _) = listener.accept().await.expect("the door is reached");
    let mut message = [0u8; 4];
    socket.read_exact(&mut message).await.expect("door reads");
    socket.write_all(&message).await.expect("door writes");
    message
}

#[tokio::test(flavor = "multi_thread")]
async fn a_dial_by_node_id_alone_finds_the_door_over_mdns() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("door stub binds");
    let door = listener.local_addr().expect("door address");
    let echoed = tokio::spawn(echo_once(listener));

    // The desktop door: serving, announcing itself on the LAN.
    let serving_key = NodeKey::generate().expect("entropy");
    let serving = Bridge::start_with_key(
        BridgeConfig::new(door)
            .with_relay(RelayChoice::Disabled)
            .with_mdns(true),
        &serving_key,
    )
    .await
    .expect("the serving endpoint comes up");

    // The phone's exact shape: dial-only, and nothing but the node id.
    let dialing_key = NodeKey::generate().expect("entropy");
    let dialing = Bridge::start_with_key(
        BridgeConfig::dial_only()
            .with_relay(RelayChoice::Disabled)
            .with_mdns(true)
            // mDNS discovery takes a beat past iroh's own lookup window;
            // the deadline here bounds the test, not the finding.
            .with_dial_timeout(std::time::Duration::from_secs(30)),
        &dialing_key,
    )
    .await
    .expect("the dialing endpoint comes up");

    let mut tunnel = dialing
        .connect(serving.node_id(), Lane::Door)
        .await
        .expect("the dial by node id alone resolves over mDNS and connects");
    tunnel
        .write_all(b"ping")
        .await
        .expect("request written into the tunnel");
    tunnel.flush().await.expect("request flushed");

    let mut back = [0u8; 4];
    tunnel
        .read_exact(&mut back)
        .await
        .expect("the tunnel carries the door's echo back");
    assert_eq!(back, *b"ping", "the bytes must have crossed the tunnel");

    let message = echoed.await.expect("the door stub finishes");
    assert_eq!(message, *b"ping", "the door must have read what was sent");
}
