//! Helpers shared by the supervision tests. Not a test binary itself: it lives
//! in a subdirectory so cargo does not try to run it.

#![allow(dead_code)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use kalsa_supervisor::{ServerConfig, ServerState, Supervisor};

/// A loopback listener that answers every request `200 OK`.
///
/// `When::OnceChildIsUp` waits for the fake child's pid file before binding, so
/// the supervisor's pre-spawn port check sees a free port and the listener takes
/// it afterwards — which is what the child's own server does in production.
/// `When::Now` is for an instance that is already serving, like an orphan.
pub struct FakeHealth {
    pub port: u16,
    stop: Arc<AtomicBool>,
    accepting: Option<JoinHandle<()>>,
}

#[derive(Clone, Copy)]
pub enum When {
    Now,
    OnceChildIsUp,
}

impl FakeHealth {
    pub fn start(port: u16, when: When) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let accepting = std::thread::spawn({
            let stop = Arc::clone(&stop);
            move || {
                if let When::OnceChildIsUp = when {
                    let gate = pid_file(port);
                    while !gate.exists() && !stop.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(20));
                    }
                }
                let listener = loop {
                    match TcpListener::bind(("127.0.0.1", port)) {
                        Ok(listener) => break listener,
                        Err(_) if stop.load(Ordering::Relaxed) => return,
                        Err(_) => std::thread::sleep(Duration::from_millis(20)),
                    }
                };
                listener.set_nonblocking(true).expect("nonblocking");
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

/// A port nothing is listening on. Racy by nature, and enough for a test.
pub fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    listener.local_addr().expect("addr").port()
}

pub fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(name)
}

pub fn state_file(port: u16) -> PathBuf {
    std::env::temp_dir().join(format!("kalsa-supervisor-test-{port}.state"))
}

pub fn pid_file(port: u16) -> PathBuf {
    std::env::temp_dir().join(format!("kalsa-fake-{port}.pid"))
}

/// Each test starts from no state file and no pid file at all.
pub fn clear_files(port: u16) {
    let _ = std::fs::remove_file(state_file(port));
    let _ = std::fs::remove_file(pid_file(port));
}

pub fn config(exe: &str, port: u16) -> ServerConfig {
    ServerConfig {
        exe: fixture(exe),
        model: PathBuf::from("/nonexistent/model.gguf"),
        state_file: state_file(port),
        port,
        threads: 2,
        batch: 256,
        ubatch: 64,
        ctx: 4096,
        idle_seconds: 60,
        ready_timeout: Duration::from_secs(3),
        stop_grace: Duration::from_millis(200),
    }
}

/// Waits for a state the caller recognises, or panics with the last one seen.
pub fn wait_for(supervisor: &Supervisor, wanted: impl Fn(&ServerState) -> bool) -> ServerState {
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

/// The pid a fake child recorded for this port.
pub fn recorded_pid(port: u16) -> u32 {
    let path = pid_file(port);
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

/// A long-running process that is not ours: stands in for a stranger whose pid
/// happens to be the one a stale state file names.
pub fn sleeper() -> std::process::Child {
    Command::new("sleep")
        .arg("300")
        .spawn()
        .expect("spawn sleep")
}

/// `ps -p` prints nothing for a pid that no longer exists.
pub fn is_dead(pid: u32) -> bool {
    let output = Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "pid="])
        .output()
        .expect("run ps");
    String::from_utf8_lossy(&output.stdout).trim().is_empty()
}

/// A killed child of OURS stays a zombie until its parent reaps it, and `ps`
/// still lists a zombie. This waits for the real exit and reaps it.
pub fn wait_reaped(child: &mut std::process::Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => return false,
        }
    }
}

pub fn wait_dead(pid: u32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if is_dead(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

pub fn address(port: u16) -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], port))
}
