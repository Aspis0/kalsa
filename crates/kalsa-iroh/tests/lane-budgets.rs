//! The lanes do not spend each other's slots: one identity holds
//! `STREAMS_PER_PEER` streams on the door lane AND `STREAMS_PER_PEER` on the
//! desk lane at the same time, and one more stream on either lane is refused
//! at the road — dropped, never forwarded, so neither lane's counter moves.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use kalsa_iroh::{AddressBook, Bridge, BridgeConfig, Lane, NodeKey, RelayChoice, STREAMS_PER_PEER};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// A stand-in service behind one lane: it counts every connection that
/// reaches it, then holds each socket open on a request that never ends —
/// exactly the holding power a stream must not be able to aim at the other
/// lane.
async fn holding_service(listener: TcpListener, hits: Arc<AtomicUsize>) {
    loop {
        let Ok((mut socket, _)) = listener.accept().await else {
            return;
        };
        hits.fetch_add(1, Ordering::SeqCst);
        tokio::spawn(async move {
            let mut buffer = vec![0u8; 1024];
            loop {
                match socket.read(&mut buffer).await {
                    Ok(0) | Err(_) => return,
                    Ok(_) => {}
                }
            }
        });
    }
}

/// Wait until `want` connections have reached a service, or fail saying what
/// arrived. A stream the road never forwarded never shows up here, and that
/// silence is the assertion.
async fn wait_for(hits: &Arc<AtomicUsize>, want: usize) {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let seen = hits.load(Ordering::SeqCst);
        if seen >= want {
            return;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "expected {want} streams forwarded to this lane, saw {seen}"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn one_identity_holds_both_lanes_budgets_and_one_more_stream_is_refused() {
    let door_listener = TcpListener::bind("127.0.0.1:0").await.expect("door binds");
    let desk_listener = TcpListener::bind("127.0.0.1:0").await.expect("desk binds");
    let door_addr = door_listener.local_addr().expect("door address");
    let desk_addr = desk_listener.local_addr().expect("desk address");
    let door_hits = Arc::new(AtomicUsize::new(0));
    let desk_hits = Arc::new(AtomicUsize::new(0));
    tokio::spawn(holding_service(door_listener, Arc::clone(&door_hits)));
    tokio::spawn(holding_service(desk_listener, Arc::clone(&desk_hits)));

    let book = AddressBook::new();
    let server = Bridge::start_with_key(
        BridgeConfig::new(door_addr)
            .with_desk(desk_addr)
            .with_relay(RelayChoice::Disabled)
            .with_address_book(book.clone()),
        &NodeKey::generate().expect("entropy"),
    )
    .await
    .expect("server bridge starts");
    let client = Bridge::start_with_key(
        BridgeConfig::new(door_addr)
            .with_relay(RelayChoice::Disabled)
            .with_address_book(book.clone()),
        &NodeKey::generate().expect("entropy"),
    )
    .await
    .expect("client bridge starts");
    let target = server.node_id();

    // The door lane takes its whole per-peer budget: every stream is
    // forwarded, and each holds an unfinished head at the service.
    let mut door_streams = Vec::new();
    for held in 0..STREAMS_PER_PEER {
        let mut stream = client.connect(target, Lane::Door).await.expect("door dial");
        stream
            .write_all(b"POST /v1/chat/completions HTTP/1.1\r\nHost: kalsa\r\n")
            .await
            .expect("door head written");
        door_streams.push(stream);
        wait_for(&door_hits, held + 1).await;
    }

    // The desk lane takes its own budget on the same identity: sharing the
    // door's counter would leave these streams with nowhere to go.
    let mut desk_streams = Vec::new();
    for held in 0..STREAMS_PER_PEER {
        let mut stream = client.connect(target, Lane::Desk).await.expect("desk dial");
        stream
            .write_all(b"POST /pair/claim HTTP/1.1\r\nHost: kalsa\r\n")
            .await
            .expect("desk head written");
        desk_streams.push(stream);
        wait_for(&desk_hits, held + 1).await;
    }

    // One more stream on either lane: refused at the road, forwarded
    // nowhere — the count at the service is what says so, since a stream
    // that reached the service would raise it before its own EOF came back.
    for (lane, hits) in [(Lane::Door, &door_hits), (Lane::Desk, &desk_hits)] {
        let mut extra = client.connect(target, lane).await.expect("extra dial");
        extra
            .write_all(b"POST /v1/chat/completions HTTP/1.1\r\nHost: kalsa\r\n\r\n")
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
            "an over-budget stream was forwarded to {lane:?}: {refused:?}"
        );
        assert_eq!(
            hits.load(Ordering::SeqCst),
            STREAMS_PER_PEER,
            "an over-budget {lane:?} stream reached the service"
        );
    }

    drop(door_streams);
    drop(desk_streams);
    drop(client);
    drop(server);
}
