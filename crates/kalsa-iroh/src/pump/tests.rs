use std::io;
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt, duplex};

/// Five seconds: far beyond any deadline under test, close enough that a
/// regression back to "iroh hangs" fails the test instead of the suite.
const HANG_GUARD: Duration = Duration::from_secs(5);

#[tokio::test]
async fn bytes_move_in_both_directions() {
    let (mut a_far, a_near) = duplex(4096);
    let (mut b_far, b_near) = duplex(4096);
    let pump = tokio::spawn(super::pump(a_near, b_near, Duration::from_secs(5)));

    a_far.write_all(b"ping").await.expect("write");
    let mut buffer = [0u8; 4];
    b_far.read_exact(&mut buffer).await.expect("read");
    assert_eq!(&buffer, b"ping");

    b_far.write_all(b"pong").await.expect("write");
    a_far.read_exact(&mut buffer).await.expect("read");
    assert_eq!(&buffer, b"pong");

    pump.abort();
}

#[tokio::test]
async fn a_half_close_shuts_only_its_direction() {
    let (mut a_far, a_near) = duplex(4096);
    let (mut b_far, b_near) = duplex(4096);
    let pump = tokio::spawn(super::pump(a_near, b_near, Duration::from_secs(5)));

    a_far.write_all(b"hi").await.expect("write");
    a_far.shutdown().await.expect("shutdown");

    let mut buffer = [0u8; 2];
    b_far.read_exact(&mut buffer).await.expect("read payload");
    assert_eq!(&buffer, b"hi");
    // The direction that saw end-of-stream shuts the far writer: the reader
    // here must see EOF, not silence.
    assert_eq!(b_far.read(&mut buffer).await.expect("eof"), 0);

    // The other direction still works after the first one closed.
    b_far.write_all(b"bye").await.expect("write");
    let mut back = [0u8; 3];
    a_far.read_exact(&mut back).await.expect("read back");
    assert_eq!(&back, b"bye");

    b_far.shutdown().await.expect("shutdown");
    let result = tokio::time::timeout(HANG_GUARD, pump)
        .await
        .expect("pump must finish")
        .expect("join");
    result.expect("both directions ended cleanly");
}

#[tokio::test]
async fn a_slow_response_longer_than_the_deadline_arrives_whole() {
    // Tokens trickling from the door side, gaps wider than the idle
    // deadline, the whole exchange outlasting it several times over. The
    // phone goes silent after its request — as the protocol dictates — and
    // none of that may cut the answer.
    let (mut a_far, a_near) = duplex(4096);
    let (mut b_far, b_near) = duplex(4096);
    let idle = Duration::from_millis(100);
    let pump = tokio::spawn(super::pump(a_near, b_near, idle));

    a_far.write_all(b"POST / HTTP/1.1\r\n\r\n").await.expect("request");
    a_far.shutdown().await.expect("half-close the request");

    for _ in 0..8 {
        tokio::time::sleep(Duration::from_millis(150)).await;
        b_far.write_all(b"token ").await.expect("token");
    }
    b_far.shutdown().await.expect("response done");

    let mut received = Vec::new();
    tokio::time::timeout(HANG_GUARD, a_far.read_to_end(&mut received))
        .await
        .expect("the slow response ends")
        .expect("read");
    assert_eq!(received.len(), 48, "a slow response was truncated: {received:?}");
    let outcome = tokio::time::timeout(HANG_GUARD, pump)
        .await
        .expect("pump ends")
        .expect("join");
    outcome.expect("both directions end cleanly");
}

#[tokio::test]
async fn a_response_that_starts_after_the_deadline_arrives_whole() {
    // A long prefill: the door holds the request and says nothing for
    // longer than the idle deadline, then answers. The phone's silence is
    // the protocol working, not a peer dying.
    let (mut a_far, a_near) = duplex(4096);
    let (mut b_far, b_near) = duplex(4096);
    let idle = Duration::from_millis(100);
    let pump = tokio::spawn(super::pump(a_near, b_near, idle));

    a_far.write_all(b"POST / HTTP/1.1\r\n\r\n").await.expect("request");
    a_far.shutdown().await.expect("half-close the request");

    tokio::time::sleep(Duration::from_millis(400)).await;
    b_far.write_all(b"the answer").await.expect("late answer");
    b_far.shutdown().await.expect("response done");

    let mut received = Vec::new();
    tokio::time::timeout(HANG_GUARD, a_far.read_to_end(&mut received))
        .await
        .expect("the late response ends")
        .expect("read");
    assert_eq!(&received, b"the answer", "a late response was cut");
    let outcome = tokio::time::timeout(HANG_GUARD, pump)
        .await
        .expect("pump ends")
        .expect("join");
    outcome.expect("both directions end cleanly");
}

#[tokio::test]
async fn a_silent_far_side_is_torn_down_not_wedged() {
    // Both far ends are held by the test and never written to: the pump's
    // reads stay pending with neither data nor EOF, exactly like a peer
    // that died mid-stream. The idle deadline must fire, not hang.
    let (_a_far, a_near) = duplex(4096);
    let (_b_far, b_near) = duplex(4096);

    let idle = Duration::from_millis(150);
    let start = Instant::now();
    let finished =
        tokio::time::timeout(HANG_GUARD, super::pump(a_near, b_near, idle)).await;
    let elapsed = start.elapsed();

    let result = finished.expect("the pump must finish, not hang forever");
    assert!(
        matches!(&result, Err(e) if e.kind() == io::ErrorKind::TimedOut),
        "expected the idle deadline, got {result:?}"
    );
    assert!(elapsed >= idle);
    assert!(elapsed < Duration::from_secs(3), "the pump lingered {elapsed:?}");
}

#[tokio::test]
async fn a_client_that_does_not_half_close_still_gets_its_whole_answer() {
    // The case the two tests above do not cover: the phone sends its
    // request and simply stops writing, without shutting its write side.
    // That is what an HTTP client with keep-alive does, and what a QUIC
    // stream that is never finished does. Its silence must not be read as
    // death while the answer is still being produced.
    let (mut a_far, a_near) = duplex(4096);
    let (mut b_far, b_near) = duplex(4096);
    let idle = Duration::from_millis(100);
    let pump = tokio::spawn(super::pump(a_near, b_near, idle));

    a_far.write_all(b"POST / HTTP/1.1\r\n\r\n").await.expect("request");
    // NO shutdown here. That is the whole point.

    tokio::time::sleep(Duration::from_millis(400)).await;
    b_far.write_all(b"the answer").await.expect("late answer");
    b_far.shutdown().await.expect("response done");

    let mut received = Vec::new();
    tokio::time::timeout(HANG_GUARD, a_far.read_to_end(&mut received))
        .await
        .expect("the late response ends")
        .expect("read");
    assert_eq!(&received, b"the answer", "the answer was cut for a client that stayed open");
    let _ = pump.await;
}

#[tokio::test]
async fn a_trickling_answer_survives_a_client_that_never_half_closes() {
    // The product's actual shape: a phone on keep-alive that does not shut
    // its write side, and an answer arriving token by token for far longer
    // than the idle bound. Nothing here may be read as a dead peer.
    let (mut a_far, a_near) = duplex(4096);
    let (mut b_far, b_near) = duplex(4096);
    let idle = Duration::from_millis(100);
    let pump = tokio::spawn(super::pump(a_near, b_near, idle));

    a_far.write_all(b"POST / HTTP/1.1\r\n\r\n").await.expect("request");
    // No shutdown: the phone keeps the stream open, as a real client does.

    for _ in 0..10 {
        tokio::time::sleep(Duration::from_millis(60)).await;
        b_far.write_all(b"token ").await.expect("token");
    }
    b_far.shutdown().await.expect("response done");

    let mut received = Vec::new();
    tokio::time::timeout(HANG_GUARD, a_far.read_to_end(&mut received))
        .await
        .expect("the trickling response ends")
        .expect("read");
    assert_eq!(received.len(), 60, "a trickling answer was truncated: {received:?}");
    let _ = pump.await;
}

#[tokio::test]
async fn a_keep_alive_tunnel_survives_a_response_slower_than_the_deadline() {
    // The phone's way of using one tunnel: request, answer, request again
    // on the same connection — without ever shutting its write side. The
    // first answer streams slower than the idle deadline; the response's
    // bytes keep the shared clock moving, so the request direction is not
    // given up and the second request is still read and answered here.
    let (mut a_far, a_near) = duplex(4096);
    let (mut b_far, b_near) = duplex(4096);
    let idle = Duration::from_millis(100);
    let pump = tokio::spawn(super::pump(a_near, b_near, idle));

    let door_far = tokio::spawn(async move {
        let mut request = vec![0u8; b"POST / HTTP/1.1\r\n\r\n".len()];

        b_far
            .read_exact(&mut request)
            .await
            .expect("door reads request one");
        for chunk in [b"hell", b"o wo", b"rld!"] {
            tokio::time::sleep(Duration::from_millis(60)).await;
            b_far.write_all(chunk).await.expect("first answer chunk");
        }
        // No half-close here either: a keep-alive door frames its answers
        // and keeps the exchange open. Only after the second answer does
        // the write side close, and the tunnel ends from that side.

        b_far
            .read_exact(&mut request)
            .await
            .expect("door reads request two: the tunnel stayed alive");
        b_far.write_all(b"again").await.expect("second answer");
        b_far.shutdown().await.expect("second answer done");
    });

    a_far
        .write_all(b"POST / HTTP/1.1\r\n\r\n")
        .await
        .expect("request one");
    let mut first = [0u8; b"hello world!".len()];
    a_far.read_exact(&mut first).await.expect("first answer read");
    assert_eq!(&first, b"hello world!", "the first answer was cut");

    a_far
        .write_all(b"POST / HTTP/1.1\r\n\r\n")
        .await
        .expect("request two on the same tunnel");
    let mut second = [0u8; b"again".len()];
    tokio::time::timeout(HANG_GUARD, a_far.read_exact(&mut second))
        .await
        .expect("the second answer ends")
        .expect("read");
    assert_eq!(&second, b"again", "the tunnel died between keep-alive requests");

    let outcome = tokio::time::timeout(HANG_GUARD, pump)
        .await
        .expect("pump ends")
        .expect("join");
    // Both answers were delivered: the phone going quiet afterwards is the
    // normal end of a keep-alive exchange, reported as the success it was.
    outcome.expect("a fully served exchange is a success");
    door_far
        .await
        .expect("the door side served both requests");
}
