//! Supervision tests, against fake children instead of a real server: they must
//! be fast and independent of what is installed on the machine.
//!
//! The HTTP side is real: the test hosts a loopback listener that plays
//! `/health`, so the handshake under test is the production one.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use kalsa_supervisor::{ServerConfig, ServerState, Supervisor};

/// A loopback listener that answers every request `200 OK` until it is dropped.
struct FakeHealth {
    port: u16,
    stop: Arc<AtomicBool>,
    accepting: Option<JoinHandle<()>>,
}

impl FakeHealth {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let port = listener.local_addr().expect("local addr").port();
        listener.set_nonblocking(true).expect("nonblocking");
        let stop = Arc::new(AtomicBool::new(false));
        let accepting = std::thread::spawn({
            let stop = Arc::clone(&stop);
            move || {
                while !stop.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((mut socket, _)) => {
                            let mut scratch = [0u8; 512];
                            let _ = socket.read(&mut scratch);
                            let _ = socket.write_all(
                                b"HTTP/1.0 200 OK\r\nContent-Length: 15\r\n\r\n{\"status\":\"ok\"}",
                            );
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(5)),
                    }
                }
            }
        });
        Self {
            port,
            stop,
            accepting: Some(accepting),
        }
    }
}

impl Drop for FakeHealth {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(accepting) = self.accepting.take() {
            let _ = accepting.join();
        }
    }
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

fn config(exe: &str, port: u16) -> ServerConfig {
    ServerConfig {
        exe: fixture(exe),
        model: PathBuf::from("/nonexistent/model.gguf"),
        port,
        threads: 2,
        batch: 256,
        ubatch: 64,
        ctx: 4096,
        idle_seconds: 60,
        ready_timeout: Duration::from_secs(2),
        stop_grace: Duration::from_millis(200),
    }
}

/// Waits for a state the caller recognises, or panics with the last one seen.
fn wait_for(supervisor: &Supervisor, wanted: impl Fn(&ServerState) -> bool) -> ServerState {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let state = supervisor.state();
        if wanted(&state) {
            return state;
        }
        assert!(Instant::now() < deadline, "state never arrived: {state:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The pid the fake child recorded for this port.
fn recorded_pid(port: u16) -> u32 {
    let path = std::env::temp_dir().join(format!("kalsa-fake-{port}.pid"));
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(pid) = text.trim().parse() {
                return pid;
            }
        }
        assert!(Instant::now() < deadline, "no pid file at {path:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// `ps -p` prints nothing for a pid that no longer exists.
fn is_dead(pid: u32) -> bool {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "pid="])
        .output()
        .expect("run ps");
    String::from_utf8_lossy(&output.stdout).trim().is_empty()
}

fn wait_dead(pid: u32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if is_dead(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

#[test]
fn start_reports_running_once_the_server_answers() {
    let health = FakeHealth::start();
    let supervisor = Supervisor::new();
    supervisor.start(config("fake_server.sh", health.port));

    let state = wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));
    match state {
        ServerState::Running { pid, port } => {
            assert_eq!(port, health.port);
            assert_eq!(pid, recorded_pid(health.port));
        }
        other => panic!("unexpected state {other:?}"),
    }

    supervisor.shutdown();
    assert_eq!(supervisor.state(), ServerState::Stopped);
}

#[test]
fn start_fails_when_the_server_never_answers() {
    // A port nobody listens on: bind it, then drop the listener.
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.local_addr().expect("addr").port()
    };
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
    let health = FakeHealth::start();
    let supervisor = Supervisor::new();
    supervisor.start(config("fake_dies.sh", health.port));

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
    let health = FakeHealth::start();
    let supervisor = Supervisor::new();
    let mut cfg = config("fake_server.sh", health.port);
    // Generous grace: the child must die from the closed pipe, not from the
    // signal escalation that would follow it.
    cfg.stop_grace = Duration::from_secs(3);
    supervisor.start(cfg);
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    let pid = recorded_pid(health.port);
    supervisor.stop();
    // Stopping is a request: the state follows it on the worker thread, which
    // is what keeps the window responsive while a child is being reaped.
    wait_for(&supervisor, |s| *s == ServerState::Stopped);
    assert!(wait_dead(pid), "child survived the graceful stop");
    supervisor.shutdown();
}

#[test]
fn stop_escalates_to_sigkill_for_a_wedged_child() {
    let health = FakeHealth::start();
    let supervisor = Supervisor::new();
    supervisor.start(config("fake_stubborn.sh", health.port));
    wait_for(&supervisor, |s| matches!(s, ServerState::Running { .. }));

    let pid = recorded_pid(health.port);
    supervisor.stop();
    wait_for(&supervisor, |s| *s == ServerState::Stopped);
    assert!(wait_dead(pid), "SIGTERM-ignoring child was not killed");
    supervisor.shutdown();
}

/// Guard for the helper itself: `ps` must see a process that exists, or every
/// "the child was killed" assertion below would pass for the wrong reason.
#[test]
fn the_pid_check_sees_a_live_process_and_not_a_missing_one() {
    assert!(!is_dead(std::process::id()));
    assert!(is_dead(u32::MAX));
}
