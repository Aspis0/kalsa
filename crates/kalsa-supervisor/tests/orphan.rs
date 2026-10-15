//! The macOS hole: a force-quit leaves our server behind (no job object, no
//! `PR_SET_PDEATHSIG`, and `llama-server` does not read stdin). The next start
//! has to recognise it — without ever signalling a process that is not ours.

mod common;

use std::net::TcpListener;
use std::time::Duration;

use common::{
    clear_files, config, is_dead, recorded_pid, reparented_sleeper, unique_port, wait_dead,
    wait_for, FakeHealth, When,
};
use kalsa_supervisor::{Failure, InstanceFile, ServerState, Supervisor};

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
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
    let _ = supervisor.start(config("fake_server.sh", port));
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

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
#[test]
fn a_live_instance_of_ours_is_stopped_and_never_reused() {
    let port = unique_port();
    clear_files(port);
    // The orphan: a process still holding the state file's lock, and answering.
    let orphan_pid = reparented_sleeper();
    let _health = FakeHealth::start(port, When::Now);
    let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
    claim.describe(orphan_pid, port).expect("describe");

    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));

    // The orphan is closed, not reused. The fake health still holds the port,
    // so the fresh start is refused there, and nothing reports Running.
    let state = wait_for(&supervisor, |s| {
        matches!(s, ServerState::Running { .. } | ServerState::Failed { .. })
    });
    match state {
        ServerState::Failed {
            reason: Failure::PortTaken,
        } => {}
        other => panic!("the earlier run's engine was not refused: {other:?}"),
    }
    assert!(
        wait_dead(orphan_pid),
        "the earlier run's engine was left running"
    );
    supervisor.shutdown();
}

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
#[test]
fn an_instance_of_ours_that_stopped_answering_is_closed_and_replaced() {
    let port = unique_port();
    clear_files(port);
    // Ours (it holds the lock) but wedged: nothing answers on the port.
    let wedged_pid = reparented_sleeper();
    let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
    claim.describe(wedged_pid, port).expect("describe");
    let _health = FakeHealth::start(port, When::OnceChildIsUp);

    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));

    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));
    match state {
        ServerState::Running { pid, .. } => {
            assert_eq!(pid, recorded_pid(port), "a fresh server should be running");
        }
        other => panic!("unexpected state {other:?}"),
    }
    assert!(wait_dead(wedged_pid), "the wedged instance was left alive");
    supervisor.shutdown();
}

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
#[test]
fn an_orphan_of_a_different_command_is_replaced_not_adopted() {
    let port = unique_port();
    clear_files(port);
    // Ours, alive, answering now, and a different server than the one asked
    // for. It is closed whatever its command, never adopted.
    let orphan_pid = reparented_sleeper();
    let _health = FakeHealth::start(port, When::Now);
    let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
    // The record in start order: port and command before the pid, so a
    // writer that dies mid-sentence still names the server.
    claim
        .announce(port, "/other/llama-server\x1f--ctx-size\x1f512")
        .expect("announce");
    claim.describe(orphan_pid, port).expect("describe");

    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));

    // The orphan is closed, and the start then reports the port the fake
    // health still holds — never adopted.
    let state = wait_for(&supervisor, |s| {
        matches!(s, ServerState::Running { .. } | ServerState::Failed { .. })
    });
    match &state {
        ServerState::Running { pid, .. } => {
            panic!("a server of a different command was adopted (pid {pid})")
        }
        ServerState::Failed {
            reason: Failure::PortTaken,
        } => {}
        other => panic!("unexpected state {other:?}"),
    }
    assert!(
        wait_dead(orphan_pid),
        "the different-command orphan was left alive"
    );
    supervisor.shutdown();
}

#[test]
fn a_mid_sentence_orphan_is_refused_not_adopted_blind() {
    // The writer died between the spawn and the describe: the file names the
    // server but no pid. Nothing may be signalled and nothing adopted, so the
    // start is refused by name, and no server is spawned over it.
    let port = unique_port();
    clear_files(port);
    let _health = FakeHealth::start(port, When::Now);
    let mut cfg = config("fake_server.sh", port);
    cfg.exe = std::path::PathBuf::from("/nonexistent/llama-server");
    let claim = {
        let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
        // No describe: the writer died before the pid arrived.
        claim
            .announce(port, &binding_of(&cfg.exe, &cfg.argv))
            .expect("announce");
        claim
    };

    let supervisor = Supervisor::new();
    let _ = supervisor.start(cfg);
    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    match state {
        ServerState::Failed {
            reason: Failure::InstanceUnreadable { detail },
        } => assert!(detail.contains("must be stopped"), "{detail}"),
        other => panic!("a mid-sentence orphan was not refused: {other:?}"),
    }
    assert!(
        !common::pid_file(port).exists(),
        "a server was spawned over an unidentified instance"
    );
    supervisor.shutdown();
    drop(claim);
    let _ = std::fs::remove_file(common::state_file(port));
}

#[test]
fn a_mid_sentence_orphan_of_a_different_command_is_reported_not_adopted() {
    // Ours, alive, answering — but a different server than asked for. With
    // no pid it can be neither adopted nor closed, so the start reports and
    // touches nothing.
    let port = unique_port();
    clear_files(port);
    let _health = FakeHealth::start(port, When::Now);
    let claim = {
        let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
        claim
            .announce(port, "/other/llama-server\x1f--port\x1f9999")
            .expect("announce");
        claim
    };

    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));
    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    assert!(
        matches!(
            state,
            ServerState::Failed {
                reason: Failure::InstanceUnreadable { .. }
            }
        ),
        "a pid-less orphan of another command was adopted or spawned over: {state:?}"
    );
    assert!(
        !common::pid_file(port).exists(),
        "a server was spawned over an unidentified instance"
    );
    supervisor.shutdown();
    drop(claim);
    let _ = std::fs::remove_file(common::state_file(port));
}

#[test]
fn a_silent_mid_sentence_orphan_is_refused_at_once() {
    // Locked and matching, but nothing answers. It is refused without a wait:
    // an unidentified instance is never signalled, so there is nothing to
    // wait out.
    let port = unique_port();
    clear_files(port);
    let cfg = config("fake_server.sh", port);
    let claim = {
        let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
        claim
            .announce(port, &binding_of(&cfg.exe, &cfg.argv))
            .expect("announce");
        claim
    };

    let supervisor = Supervisor::new();
    let _ = supervisor.start(cfg);
    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    assert!(
        matches!(
            state,
            ServerState::Failed {
                reason: Failure::InstanceUnreadable { .. }
            }
        ),
        "a silent pid-less instance was adopted or spawned over: {state:?}"
    );
    assert!(
        !common::pid_file(port).exists(),
        "a server was spawned over an unidentified instance"
    );
    supervisor.shutdown();
    drop(claim);
    let _ = std::fs::remove_file(common::state_file(port));
}

/// The exact command a config would record, in the state's own format: the
/// mid-sentence tests must announce the same binding the supervisor will
/// compare against, byte for byte.
fn binding_of(exe: &std::path::Path, argv: &[String]) -> String {
    format!("{}\x1f{}", exe.display(), argv.join("\x1f"))
}
#[test]
fn a_port_held_by_another_program_is_reported_and_left_alone() {
    let port = unique_port();
    clear_files(port);
    // Somebody's listener that is not ours and not a Kalsa state file.
    let foreign = TcpListener::bind(("127.0.0.1", port)).expect("bind the port");
    let supervisor = Supervisor::new();
    let _ = supervisor.start(config("fake_server.sh", port));

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
