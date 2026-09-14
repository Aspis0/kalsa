//! Supervision tests, against fake children instead of a real server: they must
//! be fast and independent of what is installed on the machine.
//!
//! The HTTP side is real: the tests host a loopback listener that plays
//! `/health` (after the child is up, like the child's own server), so the
//! handshake and the port check under test are the production ones.

mod common;

use std::time::Duration;

use common::{
    clear_files, config, is_dead, recorded_pid, unique_port, wait_dead, wait_for, FakeHealth, When,
};
use kalsa_supervisor::{ServerState, Supervisor};

#[test]
fn start_reports_running_once_the_server_answers() {
    let port = unique_port();
    clear_files(port);
    let health = FakeHealth::start(port, When::OnceChildIsUp);
    let supervisor = Supervisor::new();
    supervisor.start(config("fake_server.sh", port));

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
    supervisor.start(cfg);

    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    match state {
        ServerState::Failed { reason } => assert!(
            reason.contains("did not answer"),
            "unexpected reason: {reason}"
        ),
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
    supervisor.start(config("fake_dies.sh", port));

    // It answered (the listener is up), so the handshake succeeded...
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    // ...and then it died on its own, which the watcher has to notice and say.
    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    match state {
        ServerState::Failed { reason } => {
            assert!(
                reason.contains("failed to load the model"),
                "reason: {reason}"
            );
        }
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
    supervisor.start(cfg);
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
    supervisor.start(config("fake_stubborn.sh", port));
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    let pid = recorded_pid(port);
    supervisor.stop();
    wait_for(&supervisor, |s| *s == ServerState::Stopped);
    assert!(wait_dead(pid), "SIGTERM-ignoring child was not killed");
    supervisor.shutdown();
}

/// Guard for the helper itself: `ps` must see a process that exists, or every
/// "the child was killed" assertion above would pass for the wrong reason.
#[test]
fn the_pid_check_sees_a_live_process_and_not_a_missing_one() {
    assert!(!is_dead(std::process::id()));
    assert!(is_dead(u32::MAX));
}
