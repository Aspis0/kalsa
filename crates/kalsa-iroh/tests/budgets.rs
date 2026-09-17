//! The road is public: a stranger without the credential may still connect,
//! but the door's queue is not theirs to hold. One peer's streams stop at
//! the per-peer ceiling — a further stream is dropped at the road, never
//! forwarded — while another peer's request goes through untouched.

use std::time::Duration;

use kalsa_door::Door;
use kalsa_iroh::{AddressBook, Bridge, BridgeConfig, NodeKey, RelayChoice};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

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

/// Canned upstream, the same shape a completion answer has.
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
        });
    }
}

/// The request is deliberately incomplete: the door's head patience holds
/// the forwarded stream open, which is exactly the holding power a stranger
/// must not be allowed to aim at the whole queue.
async fn hold_open(stream: &mut kalsa_iroh::TunnelStream) {
    stream
        .write_all(b"POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n")
        .await
        .expect("hold a head on the tunnel");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_stranger_past_its_budget_is_refused_and_the_owner_is_not() {
    let upstream = TcpListener::bind("127.0.0.1:0").await.expect("upstream binds");
    let upstream_port = upstream.local_addr().unwrap().port();
    tokio::spawn(fake_upstream(upstream));

    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("door binds");
    let door_address = listener.local_addr().unwrap();
    let door = Door::new(listener, upstream_port, one_device(CREDENTIAL))
        .expect("door builds")
        .start()
        .expect("door starts");

    let book = AddressBook::new();
    let road_key = NodeKey::generate().expect("entropy");
    let road = Bridge::start_with_key(
        BridgeConfig::new(door_address)
            .with_relay(RelayChoice::Disabled)
            .with_address_book(book.clone()),
        &road_key,
    )
    .await
    .expect("road starts");
    let target = road.node_id();

    let stranger_key = NodeKey::generate().expect("entropy");
    let stranger = Bridge::start_with_key(
        BridgeConfig::new(door_address)
            .with_relay(RelayChoice::Disabled)
            .with_address_book(book.clone()),
        &stranger_key,
    )
    .await
    .expect("stranger bridge starts");

    // The stranger fills its own budget with heads that never finish: each
    // one is forwarded and holds a door slot for the head patience. The
    // quantity below is the DOCUMENTED ceiling (two streams per peer), not
    // a constant read back — if the ceiling ever moves, this test fails and
    // the move has to be re-approved here.
    let mut held = Vec::new();
    for _ in 0..2 {
        let mut stream = stranger.connect(target).await.expect("stranger dials");
        hold_open(&mut stream).await;
        held.push(stream);
    }

    // One stream past the ceiling: refused at the road. From the phone it
    // is a tunnel that closes at once — never a forwarded chance to hold a
    // door slot, and never a response, for the door never saw it.
    let mut extra = stranger.connect(target).await.expect("stranger dials again");
    extra
        .write_all(b"POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .expect("write to the over-budget stream");
    let _ = extra.shutdown().await;
    let mut refused = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), extra.read_to_end(&mut refused))
        .await
        .expect("the refusal arrives, not a hang")
        .expect("the refused stream reads back");
    assert!(
        refused.is_empty(),
        "an over-budget stranger stream was forwarded to the door: {refused:?}"
    );
    drop(extra);
    drop(held);

    // Another peer — the owner's phone — is a peer of its own: its request
    // goes through the same road, authenticates, and comes back answered.
    let owner_key = NodeKey::generate().expect("entropy");
    let owner = Bridge::start_with_key(
        BridgeConfig::new(door_address)
            .with_relay(RelayChoice::Disabled)
            .with_address_book(book),
        &owner_key,
    )
    .await
    .expect("owner bridge starts");
    let mut stream = owner.connect(target).await.expect("owner dials");
    stream
        .write_all(
            format!(
                "POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
                 Authorization: Bearer {CREDENTIAL}\r\nContent-Length: 0\r\n\
                 Connection: close\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .expect("owner request");
    let _ = stream.shutdown().await;
    let mut answer = Vec::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_end(&mut answer))
        .await
        .expect("the owner's answer arrives")
        .expect("the owner's stream reads back");
    assert_eq!(
        answer, UPSTREAM_RESPONSE,
        "the owner's request did not reach the door"
    );

    drop(stream);
    drop(owner);
    drop(stranger);
    drop(road);
    door.shutdown();
}
