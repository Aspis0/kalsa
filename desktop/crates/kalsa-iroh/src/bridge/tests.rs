use std::net::UdpSocket;
use std::time::{Duration, Instant};

use super::Bridge;
use crate::bridge::{BridgeConfig, Lane, RelayChoice};
use crate::key::NodeKey;
use crate::transport::AddressBook;

/// A bridge whose door is unreachable — nothing dials it here; it exists
/// for its endpoint. Under an in-process book, so no network is touched.
async fn bridge_with(book: &AddressBook, dial: Duration) -> Bridge {
    let key = NodeKey::generate().expect("entropy");
    let config = BridgeConfig::new("127.0.0.1:1".parse().expect("static address"))
        .with_relay(RelayChoice::Disabled)
        .with_dial_timeout(dial)
        .with_address_book(book.clone());
    Bridge::start_with_key(config, &key)
        .await
        .expect("bridge starts")
}

/// The spike's first measurement, reproduced offline: dialing a published
/// but dead peer makes iroh block for at least 25 seconds without error.
/// The bound that ends the wait must be ours.
#[tokio::test(flavor = "multi_thread")]
async fn a_dead_peer_meets_our_deadline_not_iroh_s_silence() {
    // A socket that exists and never answers: the published-but-off node.
    let deaf = UdpSocket::bind("127.0.0.1:0").expect("deaf socket binds");
    let deaf_address = deaf.local_addr().expect("deaf address");

    let book = AddressBook::new();
    // A valid id — most 32-byte strings are not ed25519 points — that no
    // live endpoint answers for, registered against the deaf socket.
    let stranger = crate::transport::id_of(&NodeKey::generate().expect("entropy"));
    book.register(&stranger, deaf_address);

    let caller = bridge_with(&book, Duration::from_secs(2)).await;

    let start = Instant::now();
    let outcome = caller.connect(stranger, Lane::Door).await;
    let elapsed = start.elapsed();

    let Err(error) = &outcome else {
        panic!("the dial to a dead peer succeeded");
    };
    assert!(
        matches!(error, crate::BridgeError::Deadline),
        "expected our deadline, got: {error}"
    );
    assert!(elapsed >= Duration::from_secs(2));
    // iroh alone stalls 25 seconds here; if this fires, our deadline stopped
    // being the thing that ends the wait.
    assert!(elapsed < Duration::from_secs(8), "the dial stalled {elapsed:?}");
}

/// Dialing an id no lookup can resolve must fail promptly, not hang: the
/// road without a destination is an error, not a silence.
#[tokio::test(flavor = "multi_thread")]
async fn an_unknown_id_fails_closed() {
    let book = AddressBook::new();
    let caller = bridge_with(&book, Duration::from_secs(2)).await;

    let unknown = crate::NodeId::from_bytes([0x01; 32]);
    let returned =
        tokio::time::timeout(Duration::from_secs(10), caller.connect(unknown, Lane::Door)).await;
    let outcome = returned.expect("connect must return, not hang");
    let Err(error) = &outcome else {
        panic!("dialing an unresolvable id must fail");
    };
    assert!(!error.to_string().is_empty(), "an error must name its cause: {error}");
}
