//! The macOS hole: a force-quit leaves our server behind (no job object, no
//! `PR_SET_PDEATHSIG`, and `llama-server` does not read stdin). The next start
//! has to recognise it — without ever signalling a process that is not ours.

mod common;

use std::net::TcpListener;
use std::time::Duration;

use common::{
    clear_files, config, is_dead, recorded_pid, unique_port, wait_for, wait_reaped, FakeHealth,
    When,
};
use kalsa_supervisor::{Failure, InstanceFile, ServerState, Supervisor};

#[test]
fn a_stale_state_file_naming_a_live_stranger_kills_nothing() {
    let port = unique_port();
    clear_files(port);
    // A pid that is alive but is not our server, exactly like a recycled pid.
    let mut stranger = common::sleeper();
    let stranger_pid = stranger.id();
    std::fs::write(
        common::state_file(port),
        format!("kalsa-brain v1\npid={stranger_pid}\nport={port}\n"),
    )
    .expect("write a state file nobody holds");
    let _health = FakeHealth::start(port, When::OnceChildIsUp);

    let supervisor = Supervisor::new();
    supervisor.start(config("fake_server.sh", port));
    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));
    match state {
        ServerState::Running { pid, .. } => {
            assert_ne!(pid, stranger_pid, "the stranger was adopted as our server");
            assert_eq!(pid, recorded_pid(port), "a new server should have started");
        }
        other => panic!("unexpected state {other:?}"),
    }
    assert!(
        !is_dead(stranger_pid),
        "a stale state file made us kill a process that is not ours"
    );
    supervisor.shutdown();
    let _ = stranger.kill();
    let _ = stranger.wait();
}

#[test]
fn a_live_instance_of_ours_is_reused_instead_of_reloaded() {
    let port = unique_port();
    clear_files(port);
    // The orphan: a process still holding the state file's lock, and answering.
    let mut orphan = common::sleeper();
    let orphan_pid = orphan.id();
    let _health = FakeHealth::start(port, When::Now);
    let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
    claim.describe(orphan_pid, port).expect("describe");

    // The executable does not exist: if the supervisor tried to spawn, the state
    // could not become Running.
    let supervisor = Supervisor::new();
    let mut cfg = config("fake_server.sh", port);
    cfg.exe = std::path::PathBuf::from("/nonexistent/llama-server");
    supervisor.start(cfg);

    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));
    match state {
        ServerState::Running {
            pid,
            port: reported,
        } => {
            assert_eq!(pid, orphan_pid, "the orphan should have been adopted");
            assert_eq!(reported, port);
        }
        other => panic!("unexpected state {other:?}"),
    }
    assert!(!is_dead(orphan_pid), "the adopted server was killed");

    supervisor.shutdown();
    let _ = orphan.kill();
    let _ = orphan.wait();
}

#[test]
fn an_instance_of_ours_that_stopped_answering_is_closed_and_replaced() {
    let port = unique_port();
    clear_files(port);
    // Ours (it holds the lock) but wedged: nothing answers on the port.
    let mut wedged = common::sleeper();
    let wedged_pid = wedged.id();
    let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
    claim.describe(wedged_pid, port).expect("describe");
    let _health = FakeHealth::start(port, When::OnceChildIsUp);

    let supervisor = Supervisor::new();
    supervisor.start(config("fake_server.sh", port));

    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));
    match state {
        ServerState::Running { pid, .. } => {
            assert_eq!(pid, recorded_pid(port), "a fresh server should be running");
        }
        other => panic!("unexpected state {other:?}"),
    }
    assert!(
        wait_reaped(&mut wedged, Duration::from_secs(5)),
        "the wedged instance was left alive"
    );
    supervisor.shutdown();
}

#[test]
fn a_port_held_by_another_program_is_reported_and_left_alone() {
    let port = unique_port();
    clear_files(port);
    // Somebody's listener that is not ours and not a Kalsa state file.
    let foreign = TcpListener::bind(("127.0.0.1", port)).expect("bind the port");
    let supervisor = Supervisor::new();
    supervisor.start(config("fake_server.sh", port));

    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    match state {
        ServerState::Failed {
            reason: Failure::PortTaken,
        } => {}
        other => panic!("unexpected state {other:?}"),
    }
    // Nothing was started, and nothing was signalled.
    std::thread::sleep(Duration::from_millis(300));
    assert!(
        !common::pid_file(port).exists(),
        "a server was spawned despite the foreign listener"
    );
    assert!(
        foreign.local_addr().is_ok(),
        "the foreign listener was disturbed"
    );
    supervisor.shutdown();
}
