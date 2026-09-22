//! Supervision tests, against fake children instead of a real server: they must
//! be fast and independent of what is installed on the machine.
//!
//! The HTTP side is real: the tests host a loopback listener that plays
//! `/health` (after the child is up, like the child's own server), so the
//! handshake and the port check under test are the production ones.

mod common;

use std::time::{Duration, Instant};

use common::{
    clear_files, config, is_dead, recorded_pid, unique_port, wait_dead, wait_for, FakeHealth, When,
};
use kalsa_supervisor::{Failure, ServerState, StartOutcome, Supervisor};

#[test]
fn start_reports_running_once_the_server_answers() {
    let port = unique_port();
    clear_files(port);
    let health = FakeHealth::start(port, When::OnceChildIsUp);
    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));

    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));
    match state {
        ServerState::Running {
            pid,
            port: reported,
        } => {
            assert_eq!(reported, port);
            assert_eq!(pid, recorded_pid(health.port));
        }
        other => panic!("unexpected state {other:?}"),
    }

    supervisor.shutdown();
    assert_eq!(supervisor.state(), ServerState::Stopped);
}

#[test]
fn start_fails_when_the_server_never_answers() {
    let port = unique_port();
    clear_files(port);
    let supervisor = Supervisor::new();
    let mut cfg = config("fake_server.sh", port);
    cfg.ready_timeout = Duration::from_millis(600);
    let _ = supervisor.start(cfg);

    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    match state {
        ServerState::Failed {
            reason: Failure::NotReady { .. },
        } => {}
        other => panic!("unexpected state {other:?}"),
    }
    // The handshake timeout must not leak the child.
    assert!(wait_dead(recorded_pid(port)), "child survived the timeout");
    supervisor.shutdown();
}

#[test]
fn a_server_dying_after_it_served_is_reported_without_taking_us_down() {
    let port = unique_port();
    clear_files(port);
    let _health = FakeHealth::start(port, When::OnceChildIsUp);
    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_dies.sh", port));

    // It answered (the listener is up), so the handshake succeeded...
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    // ...and then it died on its own, which the watcher has to notice and say.
    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    match state {
        ServerState::Failed {
            reason: Failure::ServerExited { detail },
        } => assert!(
            detail.contains("failed to load the model"),
            "detail: {detail}"
        ),
        other => panic!("unexpected state {other:?}"),
    }
    // The supervisor is still usable: this process is alive and answering.
    assert!(matches!(supervisor.state(), ServerState::Failed { .. }));
    supervisor.shutdown();
}

#[test]
fn stop_takes_the_stdin_route_when_the_child_listens_for_it() {
    let port = unique_port();
    clear_files(port);
    let _health = FakeHealth::start(port, When::OnceChildIsUp);
    let supervisor = Supervisor::new();
    let mut cfg = config("fake_server.sh", port);
    // Generous grace: the child must die from the closed pipe, not from the
    // signal escalation that would follow it.
    cfg.stop_grace = Duration::from_secs(3);
    let _ = supervisor.start(cfg);
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    let pid = recorded_pid(port);
    supervisor.stop();
    // Stopping is a request: the state follows it on the worker thread, which
    // is what keeps the window responsive while a child is being reaped.
    wait_for(&supervisor, |s| *s == ServerState::Stopped);
    assert!(wait_dead(pid), "child survived the graceful stop");
    supervisor.shutdown();
}

#[test]
fn stop_escalates_to_sigkill_for_a_wedged_child() {
    let port = unique_port();
    clear_files(port);
    let _health = FakeHealth::start(port, When::OnceChildIsUp);
    let supervisor = Supervisor::new();
    let cfg = config("fake_stubborn.sh", port);
    // Named so the walk's cost can be asserted against it: this child never
    // reads stdin and ignores SIGTERM, so it can only be gone after BOTH
    // graces expired and SIGKILL landed. The escalation is a SUCCESS — the
    // state ends `Stopped` (§9: a killed engine is a proved-gone engine) —
    // and the grace expiries below are the registration of what the walk
    // spent, instead of the old silence.
    let grace = cfg.stop_grace;
    let _ = supervisor.start(cfg);
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    let pid = recorded_pid(port);
    let began = Instant::now();
    supervisor.stop();
    wait_for(&supervisor, |s| *s == ServerState::Stopped);
    assert!(wait_dead(pid), "SIGTERM-ignoring child was not killed");
    assert!(
        began.elapsed() >= grace * 2,
        "the walk finished in {:?}: both graces ({:?} each) must have expired before SIGKILL",
        began.elapsed(),
        grace
    );
    supervisor.shutdown();
}

#[test]
fn a_reaped_child_stops_even_while_the_port_still_answers() {
    // §9's two halves are about OUR engine: the reap is the kernel's own
    // proof for the process half, so the port is NOT a veto on `Stopped`.
    // Here the stand-in listener outlives the fake child (in production the
    // engine's listener dies with it), so the port answers 200 at the moment
    // of the probe — the stop must still say `Stopped`. What the port says
    // instead is the suspicion the orphan record beside the state file
    // carries; this test pins the END (mutation: make the port veto a
    // reaped child → this, and every stop test above, go red).
    let port = unique_port();
    clear_files(port);
    let _health = FakeHealth::start(port, When::OnceChildIsUp);
    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    let pid = recorded_pid(port);
    supervisor.stop();
    wait_for(&supervisor, |s| *s == ServerState::Stopped);
    assert!(wait_dead(pid), "the child outlived its own stop");
    supervisor.shutdown();
}

#[test]
fn a_start_while_owning_a_server_is_refused_not_silently_dropped() {
    // The "already on" answer is the supervisor's to give, and it must be
    // given: a caller that cannot tell a refusal from a success ends up
    // describing a server nobody started.
    let port = unique_port();
    clear_files(port);
    let _health = FakeHealth::start(port, When::OnceChildIsUp);
    let supervisor = Supervisor::new();
    let first = supervisor.start(config("fake_server.sh", port)).outcome();
    assert_eq!(first, StartOutcome::Accepted);
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    let second = supervisor.start(config("fake_server.sh", port)).outcome();
    assert_eq!(second, StartOutcome::Refused);
    assert!(
        matches!(supervisor.state(), ServerState::Running { .. }),
        "a refused start stopped the server already running"
    );
    supervisor.shutdown();
}

/// Guard for the helper itself: `ps` must see a process that exists, or every
/// "the child was killed" assertion above would pass for the wrong reason.
#[test]
fn the_pid_check_sees_a_live_process_and_not_a_missing_one() {
    assert!(!is_dead(std::process::id()));
    assert!(is_dead(u32::MAX));
}
