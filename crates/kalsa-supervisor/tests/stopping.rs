//! The `Stopping` state, pinned from three sides: what the CALLER declares
//! before it queues the stop, what the WORKER may write while the drain
//! stands, and what a poll may read across a whole handshake.
//!
//! The defect these tests exist for: the poll is the reconciler. Before this
//! state, `Supervisor::stop` only queued `Command::Stop`, the field kept
//! reading `Running` for up to two stop graces plus the reap, and every
//! `brain_state` landing in that window entered the Running arm and raised
//! again the door the stop had lowered. The interleaving is real, so it is
//! driven here rather than argued: a start whose handshake never answers
//! holds the worker busy for a whole `ready_timeout`, which is the window the
//! stop is asked into.
//!
//! Its two SOURCE pins live in the sibling `stopping_pins.rs`, because they
//! answer a different question: not what an interleaving does, but what the
//! text guarantees where no interleaving can reach — who writes `Stopped`,
//! and which of the two statements in `stop`/`shutdown` comes first.

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use common::{clear_files, config, unique_port, wait_for};
use kalsa_supervisor::{ServerState, StartOutcome, Supervisor};

/// A handshake that can never end on its own: nothing answers `/health` on
/// this port (the fixtures only record their pid), so the worker stays inside
/// `start_blocking` until the `ready_timeout` this returns.
fn stuck_config(port: u16, ready_timeout: Duration) -> kalsa_supervisor::ServerConfig {
    let mut cfg = config("fake_server.sh", port);
    cfg.ready_timeout = ready_timeout;
    cfg
}

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
#[test]
fn a_stop_during_an_in_flight_start_is_stopping_until_the_worker_drains() {
    let port = unique_port();
    clear_files(port);
    let supervisor = Supervisor::new();
    let _ = supervisor.start(stuck_config(port, Duration::from_secs(2)));
    wait_for(&supervisor, |s| matches!(s, ServerState::Starting));
    // A second start queued WHILE the first handshake runs and before the
    // stop is queued: the worker meets it mid-drain, and `set(Starting)` is
    // exactly a write the drain must swallow. Without the guard it would
    // repaint the state for that whole second handshake — seconds, not the
    // microseconds between a start's outcome write and the Stop queued
    // behind it — which is what lets this test SEE the overwrite.
    let _ = supervisor.start(stuck_config(port, Duration::from_secs(2)));

    let asked = Instant::now();
    supervisor.stop();
    assert!(
        asked.elapsed() < Duration::from_millis(500),
        "stop() waited for the worker instead of returning at once"
    );
    // Synchronous in the caller: the worker cannot have written anything —
    // it is still inside `start_blocking` — so this reading is the
    // declaration itself, not a state somebody else reached.
    assert_eq!(
        supervisor.state(),
        ServerState::Stopping,
        "the drain was not declared before the command was queued"
    );

    // From here to the worker's end nothing else may land: not `Running` or
    // `Failed` from the start finishing late (its NotReady is exactly such a
    // failure), not `Starting` from the start queued behind the stop.
    loop {
        let state = supervisor.state();
        match state {
            ServerState::Stopping | ServerState::Stopped => {}
            other => panic!("a drain was overwritten by {other:?}"),
        }
        if state == ServerState::Stopped {
            break;
        }
        assert!(
            asked.elapsed() < Duration::from_secs(15),
            "the drain never ended: {state:?}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    // The teardown FOLLOWS the handshakes — the worker is serial, so the
    // seconds they owe were spent first. Cancelling a handshake is
    // deliberately not part of this state: a stop asked during a start is
    // reported as `Stopping` for the whole of it.
    assert!(
        asked.elapsed() > Duration::from_secs(2),
        "the drain ended before the handshake it was waiting behind"
    );
    supervisor.shutdown();
}

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
#[test]
fn shutdown_declares_the_drain_before_it_joins_the_worker() {
    let port = unique_port();
    clear_files(port);
    let supervisor = Arc::new(Supervisor::new());
    let _ = supervisor.start(stuck_config(port, Duration::from_secs(2)));
    wait_for(&supervisor, |s| matches!(s, ServerState::Starting));

    let joining = Arc::clone(&supervisor);
    let joined = std::thread::spawn(move || joining.shutdown());
    // While `shutdown` is still blocked in the join, the drain is already
    // declared — the window a poll reads, and the worker cannot have written
    // because it is mid-handshake.
    let declared = wait_for(&supervisor, |s| matches!(s, ServerState::Stopping));
    assert_eq!(declared, ServerState::Stopping);
    joined.join().expect("shutdown joins its worker");
    assert_eq!(
        supervisor.state(),
        ServerState::Stopped,
        "shutdown did not take the worker all the way down"
    );
}

#[test]
fn a_start_asked_after_the_drain_landed_is_a_normal_start() {
    let port = unique_port();
    clear_files(port);
    let supervisor = Supervisor::new();
    let first = supervisor
        .start(stuck_config(port, Duration::from_millis(1500)))
        .outcome();
    assert_eq!(first, StartOutcome::Accepted);
    wait_for(&supervisor, |s| matches!(s, ServerState::Starting));
    supervisor.stop();
    wait_for(&supervisor, |s| *s == ServerState::Stopped);

    // The worker is serial and owns nothing after the drain, so this start
    // is ordinary: accepted, and the state walks `Stopped` -> `Starting`
    // rather than the drain refusing what came after it.
    let second = supervisor
        .start(stuck_config(port, Duration::from_millis(1500)))
        .outcome();
    assert_eq!(
        second,
        StartOutcome::Accepted,
        "a start asked after the drain was refused"
    );
    wait_for(&supervisor, |s| matches!(s, ServerState::Starting));
    supervisor.shutdown();
}

#[test]
fn a_second_shutdown_leaves_no_drain_nobody_performs() {
    // The app's exit handler runs on `ExitRequested` AND on `Exit`, so its
    // second call sends to a worker the first one already joined: `send`
    // fails, and a declaration nothing will ever end must not stand.
    let supervisor = Supervisor::new();
    supervisor.shutdown();
    assert_eq!(supervisor.state(), ServerState::Stopped);
    supervisor.shutdown();
    assert_eq!(
        supervisor.state(),
        ServerState::Stopped,
        "the second shutdown left a drain standing"
    );
    supervisor.stop();
    assert_eq!(
        supervisor.state(),
        ServerState::Stopped,
        "a stop with no worker left a drain standing"
    );
}
