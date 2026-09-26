//! The tunnel's own rules, apart from whatever flows through it:
//! shutdown and drop semantics, argument bounds, the independence of the
//! read and write halves, and the guard against async-context calls.
//!
//! The phone's blocking calls run on plain std threads, the way the app's
//! JNI threads will: the wrapper answers AsyncContext on any tokio
//! thread — including tokio's own blocking pool, where the runtime handle
//! is entered.

mod support;

use std::sync::Arc;
use std::time::{Duration, Instant};

use kalsa_iroh::{AddressBook, Bridge};
use kalsa_iroh_mobile::{IrohMobileError, Lane, MobileBridge, Tunnel};
use support::{spawn_upstream, temp_dir, Upstream};

/// A live tunnel against `behavior`, plus the desktop bridge (kept alive:
/// dropping it closes the endpoint and every tunnel with it), the phone
/// bridge, and the temp dir to clean up.
async fn tunnel_on(
    behavior: Upstream,
) -> (Bridge, Arc<MobileBridge>, Arc<Tunnel>, std::path::PathBuf) {
    let dir = temp_dir("lifecycle");
    let door = spawn_upstream(behavior).await;
    let book = AddressBook::new();
    let desktop = support::desktop_bridge(&dir, &book, door, None).await;
    let desktop_hex = desktop.node_id().to_string();
    let phone_key = dir.join("phone.key");
    let pair = std::thread::spawn(move || {
        let phone = MobileBridge::for_tests(phone_key, &book).expect("phone bridge starts");
        let tunnel = phone
            .connect(desktop_hex, Lane::Door)
            .expect("tunnel opens");
        (phone, tunnel)
    })
    .join()
    .expect("plain thread runs");
    (desktop, pair.0, pair.1, dir)
}

/// Await a plain thread's result without parking a runtime worker on it.
async fn join_plain<T: Send + 'static>(
    handle: std::thread::JoinHandle<T>,
) -> Result<T, IrohMobileError> {
    tokio::task::spawn_blocking(move || handle.join())
        .await
        .expect("join task runs")
        .map_err(|_| IrohMobileError::Io { detail: "test thread panicked".to_string() })
}

const REQUEST: &[u8] = b"GET /v1/models HTTP/1.1\r\nHost: kalsa\r\nConnection: close\r\n\r\n";

#[tokio::test(flavor = "multi_thread")]
async fn shutdown_closes_the_tunnel_and_is_idempotent() {
    let (_desktop, _phone, tunnel, dir) = tunnel_on(Upstream::Silent).await;

    tunnel.shutdown();
    tunnel.shutdown();

    let calls = std::thread::spawn(move || {
        (tunnel.read(8192, 1_000), tunnel.write(b"x".to_vec(), 1_000))
    });
    let (read, write) = join_plain(calls)
        .await
        .expect("calls thread runs");
    assert!(
        matches!(read, Err(IrohMobileError::Closed)),
        "read after shutdown must answer Closed"
    );
    assert!(
        matches!(write, Err(IrohMobileError::Closed)),
        "write after shutdown must answer Closed"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn bad_read_and_write_bounds_are_rejected_before_anything_runs() {
    let (_desktop, _phone, tunnel, dir) = tunnel_on(Upstream::Silent).await;
    let cap = 16 * 1024 * 1024;

    let cases = std::thread::spawn(move || {
        vec![
            tunnel.read(0, 1_000).map(|_| ()),
            tunnel.read(cap + 1, 1_000).map(|_| ()),
            tunnel.read(64, 0).map(|_| ()),
            tunnel.write(b"x".to_vec(), 0).map(|_| ()),
        ]
    });
    for case in join_plain(cases).await.expect("calls thread runs") {
        assert!(
            matches!(case, Err(IrohMobileError::Config { .. })),
            "bounds violations must answer Config"
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
}

/// The halves are independent: the write finishes while the read is
/// provably parked (the upstream echoes only after 1.5 s).
#[tokio::test(flavor = "multi_thread")]
async fn a_parked_read_and_a_write_do_not_wait_on_each_other() {
    let (_desktop, _phone, tunnel, dir) =
        tunnel_on(Upstream::EchoAfter(Duration::from_millis(1_500))).await;

    let reader = Arc::clone(&tunnel);
    let read_thread = std::thread::spawn(move || reader.read(8192, 5_000));
    tokio::time::sleep(Duration::from_millis(200)).await;

    let writer = Arc::clone(&tunnel);
    let write_thread = std::thread::spawn(move || {
        let started = Instant::now();
        (started.elapsed(), writer.write(REQUEST.to_vec(), 5_000))
    });
    let (write_took, write_outcome) = join_plain(write_thread)
        .await
        .expect("write thread runs");
    write_outcome.expect("write completes while the read parks");
    // With one shared lock the write would wait out the 1.5 s echo delay.
    assert!(
        write_took < Duration::from_secs(1),
        "the write waited {write_took:?} — the halves are not independent"
    );

    let echoed = tokio::time::timeout(Duration::from_secs(5), join_plain(read_thread))
        .await
        .expect("the echo must arrive")
        .expect("read thread runs")
        .expect("read returns the echo");
    assert!(
        echoed.starts_with(REQUEST),
        "the echo must carry the request back"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn shutdown_cancels_a_parked_read() {
    let (_desktop, _phone, tunnel, dir) = tunnel_on(Upstream::Silent).await;

    let reader = Arc::clone(&tunnel);
    let read_thread = std::thread::spawn(move || reader.read(8192, 30_000));
    tokio::time::sleep(Duration::from_millis(200)).await;
    tunnel.shutdown();

    let outcome = tokio::time::timeout(Duration::from_secs(5), join_plain(read_thread))
        .await
        .expect("shutdown must unblock the read promptly")
        .expect("read thread runs");
    assert!(
        matches!(outcome, Err(IrohMobileError::Closed)),
        "a cancelled read must answer Closed"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn dropping_the_bridge_fails_a_parked_read_cleanly() {
    let (_desktop, phone, tunnel, dir) = tunnel_on(Upstream::Silent).await;

    let reader = Arc::clone(&tunnel);
    let read_thread = std::thread::spawn(move || reader.read(8192, 30_000));
    tokio::time::sleep(Duration::from_millis(200)).await;
    // The tunnel holds its own Arc to the runtime; the bridge's drop
    // closes the endpoint and the parked read must return a typed error,
    // never a panic or a hang.
    drop(phone);

    let outcome = tokio::time::timeout(Duration::from_secs(10), join_plain(read_thread))
        .await
        .expect("bridge drop must unblock the read")
        .expect("read thread runs");
    assert!(
        matches!(
            outcome,
            Err(IrohMobileError::Io { .. }
                | IrohMobileError::Closed
                | IrohMobileError::Transport { .. })
        ),
        "the read after a bridge drop must be a typed error"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

/// The wrapper's threading rule, stated as behavior: a call parked from
/// inside a runtime context answers AsyncContext, not a panic.
#[tokio::test(flavor = "multi_thread")]
async fn a_call_from_inside_a_runtime_context_is_a_typed_error() {
    let (_desktop, _phone, tunnel, dir) = tunnel_on(Upstream::Silent).await;
    let error = tunnel
        .read(8192, 1_000)
        .err()
        .expect("a runtime-context call must fail");
    assert!(
        matches!(error, IrohMobileError::AsyncContext),
        "expected AsyncContext, got: {error}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
