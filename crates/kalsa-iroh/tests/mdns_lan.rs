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

/// One door raise and lower, the desktop's cycle: bind the serving
/// endpoint under `key`, then close it and drop the bridge.
async fn raise_and_drop(key: &NodeKey, door: std::net::SocketAddr) {
    let config = BridgeConfig::new(door)
        .with_relay(RelayChoice::Disabled)
        .with_mdns(true);
    let bridge = Bridge::start_with_key(config, key).await.expect("binds");
    bridge.shutdown();
    drop(bridge);
}

/// The door is rebuilt under the same node key on every raise, and the
/// desktop's road runtime outlives every endpoint. Each dropped endpoint
/// must therefore leave nothing behind on the runtime: swarm-discovery
/// 0.6.3's updater spawns a 10 ms respawn loop once its actor is gone
/// (src/updater.rs:15-21), so a per-bind discovery leaks one ~100 Hz
/// wakeup per raise — a battery cost this test pins by counting live
/// tokio tasks across bind/drop cycles on one runtime.
#[tokio::test(flavor = "multi_thread")]
async fn dropping_mdns_endpoints_leaves_no_tasks_behind() {
    use std::time::Duration;

    // Loopback and nothing listening: the door is dialed only when a
    // stream arrives, and none does here.
    let door: std::net::SocketAddr = "127.0.0.1:1".parse().expect("loopback address");
    let metrics = tokio::runtime::Handle::current().metrics();
    let key = NodeKey::generate().expect("entropy");

    // The first bind builds the process's discovery actors — the constant
    // this test measures against. Later cycles must add nothing.
    raise_and_drop(&key, door).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    let before = metrics.num_alive_tasks();

    const CYCLES: usize = 8;
    for _ in 0..CYCLES {
        raise_and_drop(&key, door).await;
    }
    tokio::time::sleep(Duration::from_secs(2)).await;
    let after = metrics.num_alive_tasks();
    assert!(
        after <= before + 1,
        "alive tasks grew with endpoint churn: {before} -> {after} across {CYCLES} raises"
    );
}

/// The fix for the leak shares one discovery per node id per process, so a
/// rebuilt door (new port, same key, same node id) must still be found
/// through the discovery the first bind created — its actors never
/// restart, and the new endpoint's addresses must flow out of the reused
/// lookup. A fresh dialer dials the node id with only mDNS to resolve it
/// and the first door's listener already gone: the echo can only have
/// come through the rebuilt door.
#[tokio::test(flavor = "multi_thread")]
async fn a_rebuilt_door_is_found_again_through_the_same_discovery() {
    use std::time::Duration;

    let first_listener = TcpListener::bind("127.0.0.1:0").await.expect("door one binds");
    let first = BridgeConfig::new(first_listener.local_addr().expect("door one address"))
        .with_relay(RelayChoice::Disabled)
        .with_mdns(true);
    let key = NodeKey::generate().expect("entropy");
    let first = Bridge::start_with_key(first, &key).await.expect("door one raises");
    let node_id = first.node_id();
    first.shutdown();
    drop(first);
    drop(first_listener);
    // Let the old endpoint's port actually close before the same id
    // re-announces a new one.
    tokio::time::sleep(Duration::from_secs(1)).await;

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("door two binds");
    let door_two = listener.local_addr().expect("door two address");
    let echoed = tokio::spawn(echo_once(listener));
    let config = BridgeConfig::new(door_two)
        .with_relay(RelayChoice::Disabled)
        .with_mdns(true);
    let second = Bridge::start_with_key(config, &key).await.expect("door two raises");
    assert_eq!(second.node_id(), node_id, "the same key must keep the same node id");

    let dialing_key = NodeKey::generate().expect("entropy");
    let dialing = Bridge::start_with_key(
        BridgeConfig::dial_only()
            .with_relay(RelayChoice::Disabled)
            .with_mdns(true)
            .with_dial_timeout(Duration::from_secs(30)),
        &dialing_key,
    )
    .await
    .expect("the dialing endpoint comes up");

    let mut tunnel = dialing
        .connect(node_id, Lane::Door)
        .await
        .expect("the rebuilt door is found through the shared discovery");
    tunnel
        .write_all(b"ping")
        .await
        .expect("request written into the tunnel");
    tunnel.flush().await.expect("request flushed");
    let mut back = [0u8; 4];
    tunnel
        .read_exact(&mut back)
        .await
        .expect("the tunnel carries the rebuilt door's echo back");
    assert_eq!(back, *b"ping", "the echo must come from the rebuilt door");

    let message = echoed.await.expect("the second door stub finishes");
    assert_eq!(message, *b"ping");
}
