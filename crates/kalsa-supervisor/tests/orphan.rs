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
    let _ = supervisor.start(cfg);

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

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
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
    let _ = supervisor.start(config("fake_server.sh", port));

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

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
#[test]
fn an_adopted_server_that_dies_is_reported_not_kept_running() {
    let port = unique_port();
    clear_files(port);
    let mut orphan = common::sleeper();
    let _health = FakeHealth::start(port, When::Now);
    let mut claim = InstanceFile::claim(&common::state_file(port)).expect("claim");
    claim.describe(orphan.id(), port).expect("describe");

    // The executable does not exist: Running can only mean the orphan was
    // adopted.
    let supervisor = Supervisor::new();
    let mut cfg = config("fake_server.sh", port);
    cfg.exe = std::path::PathBuf::from("/nonexistent/llama-server");
    let _ = supervisor.start(cfg);
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    // The adopted server dies with no supervisor handle on it: the state must
    // follow, not stay Running forever.
    orphan.kill().expect("kill the orphan");
    let _ = orphan.wait();
    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    assert!(
        matches!(
            state,
            ServerState::Failed {
                reason: Failure::ServerExited { .. }
            }
        ),
        "an adopted server's death went unreported: {state:?}"
    );
    supervisor.shutdown();
}

// The fake child here is a shell-script fixture (tests/fixtures/*.sh);
// porting it to Windows is out of scope.
#[cfg(unix)]
#[test]
fn an_orphan_of_a_different_command_is_replaced_not_adopted() {
    let port = unique_port();
    clear_files(port);
    // Ours, alive, answering now — pid, port and health all check out. The
    // only thing that refuses this adoption must be the command: it is a
    // different server than the one being asked for.
    let mut orphan = common::sleeper();
    let orphan_pid = orphan.id();
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

    // Refused as the wrong server: the orphan is closed, and the start then
    // reports the port the fake health still holds — never adopted.
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
        wait_reaped(&mut orphan, Duration::from_secs(5)),
        "the different-command orphan was left alive"
    );
    supervisor.shutdown();
}

#[test]
fn a_mid_sentence_orphan_is_adopted_blind_not_left_invisible() {
    // Finding A: the writer died between the spawn and the describe, so the
    // file names the server but no pid. The lock (held here, as the heir
    // would hold it), the matching port and command, and an answering port
    // are enough to reuse — and reuse is the only option, because without a
    // pid nothing may be signalled.
    let port = unique_port();
    clear_files(port);
    let health = FakeHealth::start(port, When::Now);
    // The executable does not exist: Running can only mean the orphan was
    // adopted, and pid 0 can only mean adopted blind.
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
    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));
    match state {
        ServerState::Running { pid: 0, port: reported } => assert_eq!(reported, port),
        other => panic!("a mid-sentence orphan was not adopted blind: {other:?}"),
    }

    // A blind adoptee is watched by health, not by pid: when the port goes
    // quiet the state follows, instead of claiming Running forever.
    drop(health);
    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Failed { .. }));
    assert!(
        matches!(
            state,
            ServerState::Failed {
                reason: Failure::ServerExited { .. }
            }
        ),
        "a blind adoptee's death went unreported: {state:?}"
    );
    supervisor.shutdown();
    drop(claim);
    let _ = std::fs::remove_file(common::state_file(port));
}

#[test]
fn a_mid_sentence_orphan_of_a_different_command_is_reported_not_adopted() {
    // Ours, alive, answering — but a different server than asked for. With
    // no pid it can be neither adopted nor closed, so the start reports and
    // touches nothing. Fast by construction: the mismatch short-circuits
    // before any wait for health.
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
fn a_silent_mid_sentence_orphan_is_reported_after_its_deadline() {
    // Locked and matching, but nothing answers: the heir is wedged or gone
    // past reaching. Silence through the deadline is the answer — the wait
    // is bounded, and nothing about the outcome depends on timing, because
    // nothing on this port can ever answer.
    let port = unique_port();
    clear_files(port);
    let mut cfg = config("fake_server.sh", port);
    cfg.ready_timeout = Duration::from_millis(300);
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
