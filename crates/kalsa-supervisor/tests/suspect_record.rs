//! The suspected-orphan record (§9): a stop that could not prove absence
//! with positive evidence writes `<state file>.orphan` with its measures,
//! and the NEXT start settles it — a port that refuses recovers it (there
//! was nothing), a port that answers has it replaced by the adoption that
//! instance already performs. Four halves, one each: the blind stop that
//! answers, the blind stop that is silent, the recovering start, the
//! replacing start — plus commit 2's (d) completed here: a reaped child
//! whose port still answers leaves the record the `Stopped` verdict could
//! not carry.
//!
//! The blind-stop tests live in `supervisor.rs`'s unit tests for (b) —
//! dropping the stand-in listener while the WORKER idles opens a race with
//! the watcher's health branch, which reads that silence as the server
//! dying; driving `stop()` directly tests the same code with no race.

mod common;

use std::net::TcpListener;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use common::{
    clear_files, config, recorded_pid, suspect_file, unique_port, wait_for, FakeHealth, When,
};
use kalsa_supervisor::{Failure, InstanceFile, ServerState, Supervisor};

/// The mid-sentence writer's shape, hand-written so the adoption is BLIND:
/// MAGIC, port, no pid (→ `Existing::Unidentified`), locked by this test as
/// the heir would hold it. No `binding` line: `take_over` treats its absence
/// as "any command matches".
fn plant_blind_instance(port: u16) -> std::fs::File {
    let path = common::state_file(port);
    std::fs::write(&path, format!("kalsa-brain v1\nport={port}\n")).expect("write the state file");
    let lock = std::fs::File::open(&path).expect("open the state file");
    lock.try_lock().expect("hold the lock as the heir would");
    lock
}

#[test]
fn a_blind_stop_whose_port_answers_is_a_failed_stop_and_leaves_the_record() {
    // §9: `Stopped` only after the probe FAILS — here it answers, so the
    // state must say the stop is unconfirmed, WITH the measures, and the
    // suspicion travels to the next start in the record.
    let port = unique_port();
    clear_files(port);
    let lock = plant_blind_instance(port);
    let _health = FakeHealth::start(port, When::Now);

    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));
    let running = wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));
    assert_eq!(
        running,
        ServerState::Running { pid: 0, port },
        "the instance was not adopted blind (pid 0 is the marker)"
    );

    supervisor.stop();
    let ended = wait_for(&supervisor, |s| {
        matches!(s, ServerState::Failed { reason: Failure::StopUnconfirmed { .. } })
    });
    match ended {
        ServerState::Failed { reason: Failure::StopUnconfirmed { measures } } => {
            assert!(measures.contains("adopted blind"), "the measures miss the walk: {measures}");
            assert!(measures.contains("Answered"), "the measures miss the port's answer: {measures}");
            assert!(measures.contains(&port.to_string()), "the measures miss the port: {measures}");
        }
        other => panic!("a blind engine with an answering port reported as {other:?}"),
    }
    let record = suspect_file(port);
    assert!(record.exists(), "a blind stop that proved nothing left no record");
    let recorded = std::fs::read_to_string(&record).expect("read the record");
    assert!(recorded.contains("adopted blind"), "the record carries no measures: {recorded}");

    supervisor.shutdown();
    drop(lock);
    let _ = std::fs::remove_file(&record);
}

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

#[test]
fn an_answering_port_replaces_the_record_with_the_adoption() {
    // The replacement sentence: the port answers, `take_over` adopts by port
    // and health as it already does, and the record disappears the moment
    // that instance of ours is alive.
    let port = unique_port();
    clear_files(port);
    std::fs::write(
        suspect_file(port),
        "walk: adopted blind; process Unwatched; port — There\n",
    )
    .expect("plant the record");
    let mut orphan = common::sleeper();
    let _health = FakeHealth::start(port, When::Now);
    let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
    claim.describe(orphan.id(), port).expect("describe");

    let supervisor = Supervisor::new();
    let mut cfg = config("fake_server.sh", port);
    // The executable does not exist: a Running state can only come from an
    // adoption, never from a spawn.
    cfg.exe = PathBuf::from("/nonexistent/llama-server");
    let _ = supervisor.start(cfg);
    let running = wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));
    match running {
        ServerState::Running { pid, .. } => {
            assert_eq!(pid, orphan.id(), "the record was not replaced by an adoption")
        }
        other => panic!("unexpected state {other:?}"),
    }
    assert!(
        !suspect_file(port).exists(),
        "the record survived the instance that replaced it"
    );

    supervisor.shutdown();
    drop(claim);
    let _ = orphan.kill();
    let _ = orphan.wait();
    let _ = std::fs::remove_file(suspect_file(port));
}

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
