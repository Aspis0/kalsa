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
