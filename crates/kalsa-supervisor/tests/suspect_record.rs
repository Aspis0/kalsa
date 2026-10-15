//! The suspected-orphan record (§9): a stop that could not prove absence
//! with positive evidence writes `<state file>.orphan` with its measures,
//! and the NEXT start settles it — a port that refuses recovers it (there
//! was nothing), a port that answers keeps it open: our instance on that port
//! is stopped first, and the record stays until a start succeeds. The
//! recovering start, the start a stranger refuses, and the start that stops
//! our orphan are here, and both blind stops are in `supervisor.rs`'s unit
//! tests — plus commit 2's (d) completed here: a reaped child
//! whose port still answers leaves the record the `Stopped` verdict could
//! not carry.
//!
//! The blind-stop tests live in `supervisor.rs`'s unit tests for (b) —
//! dropping the stand-in listener while the WORKER idles opens a race with
//! the watcher's health branch, which reads that silence as the server
//! dying; driving `stop()` directly tests the same code with no race.

mod common;

use std::net::TcpListener;
use std::time::{Duration, Instant};

use common::{
    clear_files, config, recorded_pid, suspect_file, unique_port, wait_for, FakeHealth, When,
};
use kalsa_supervisor::{Failure, InstanceFile, ServerState, Supervisor};

#[test]
fn a_silent_port_recovers_the_record_before_the_next_start() {
    // The recovery sentence: nothing listens, so there was nothing to
    // suspect — the record goes BEFORE the start's own outcome (this start
    // then fails its handshake; the suspicion was never about IT). This
    // port is never bound by this test — no drop window, nothing a churn
    // binder can hand back — and the recovery POLICY itself is proven with
    // a scripted probe in `suspect`'s unit test; what THIS proves is that
    // the start path calls it.
    let port = unique_port();
    clear_files(port);
    std::fs::write(
        suspect_file(port),
        "walk: adopted blind; process Unwatched; port — There\n",
    )
    .expect("plant the record");
    // No FakeHealth: the port refuses.

    let supervisor = Supervisor::new();
    let mut cfg = config("fake_server.sh", port);
    cfg.ready_timeout = Duration::from_secs(1);
    let _ = supervisor.start(cfg);

    let deadline = Instant::now() + Duration::from_secs(5);
    while suspect_file(port).exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(
        !suspect_file(port).exists(),
        "a refusing port did not recover the record: there was nothing there"
    );
    supervisor.shutdown();
}

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
#[test]
fn an_answering_port_stops_our_orphan_and_keeps_the_record() {
    // The port answers, so the suspicion is still open: our orphan is stopped,
    // the fresh start is refused by the port that still answers, and the record
    // stays for the next start to settle.
    let port = unique_port();
    clear_files(port);
    std::fs::write(
        suspect_file(port),
        "walk: adopted blind; process Unwatched; port — There\n",
    )
    .expect("plant the record");
    let orphan_pid = common::reparented_sleeper();
    let _health = FakeHealth::start(port, When::Now);
    let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
    claim.describe(orphan_pid, port).expect("describe");

    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));
    let ended = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    match ended {
        ServerState::Failed {
            reason: Failure::PortTaken,
        } => {}
        other => panic!("the answering port was not refused: {other:?}"),
    }
    assert!(
        common::wait_dead(orphan_pid),
        "our orphan was left running"
    );
    assert!(
        suspect_file(port).exists(),
        "a refused start swallowed the record — the suspicion is still open"
    );

    supervisor.shutdown();
    drop(claim);
    let _ = std::fs::remove_file(suspect_file(port));
}

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
#[test]
fn a_reaped_child_whose_port_still_answers_leaves_the_suspicion_record() {
    // Commit 2's (d) completed: the reap carries the END (`Stopped` — the
    // port is not a veto), and the half the reap could not prove — something
    // still answers — is what the record carries for the next start.
    let port = unique_port();
    clear_files(port);
    let _health = FakeHealth::start(port, When::OnceChildIsUp);
    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    let pid = recorded_pid(port);
    supervisor.stop();
    wait_for(&supervisor, |s| *s == ServerState::Stopped);
    assert!(common::is_dead(pid), "the child outlived its own stop");

    let record = suspect_file(port);
    assert!(record.exists(), "a reaped child with an answering port left no suspicion record");
    let recorded = std::fs::read_to_string(&record).expect("read the record");
    assert!(recorded.contains("Answered"), "the record does not say what the port did: {recorded}");

    supervisor.shutdown();
    let _ = std::fs::remove_file(&record);
}

#[test]
fn a_start_that_fails_with_a_stranger_on_the_port_keeps_the_record() {
    // The record's THIRD outcome, until now owned only by a comment: the
    // recovery (silent port) and the replacement (an adoption) have their
    // tests; this is the one where the start FAILS because a stranger holds
    // the port — the suspicion is still open, so the record must STAY for
    // the start after it. The stranger is a listener this test HOLDS: a
    // bound socket cannot be rebound out from under the probe, and
    // `preflight_port` then names it `PortTaken`.
    let port = unique_port();
    clear_files(port);
    std::fs::write(
        suspect_file(port),
        "walk: adopted blind; process Unwatched; port — There\n",
    )
    .expect("plant the record");
    let stranger = TcpListener::bind(("127.0.0.1", port)).expect("a stranger holds the port");

    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));
    let ended = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    match ended {
        ServerState::Failed {
            reason: Failure::PortTaken,
        } => {}
        other => panic!("the stranger on the port was not reported as PortTaken: {other:?}"),
    }
    assert!(
        suspect_file(port).exists(),
        "a start that failed with a stranger on the port swallowed the record — the suspicion is still open"
    );

    supervisor.shutdown();
    drop(stranger);
    let _ = std::fs::remove_file(suspect_file(port));
}
