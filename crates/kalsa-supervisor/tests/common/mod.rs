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
        // `When::Now` is bound before this returns, so the supervisor's next probe
        // finds the port answering. A thread that bound later raced that probe,
        // and a refused probe is read as "nothing there".
        let now = match when {
            When::Now => Some(bind_or_wait(port)),
            When::OnceChildIsUp => None,
        };
        let accepting = std::thread::spawn({
            let stop = Arc::clone(&stop);
            move || {
                let listener = match now {
                    Some(listener) => listener,
                    None => {
                        let gate = pid_file(port);
                        while !gate.exists() && !stop.load(Ordering::Relaxed) {
                            std::thread::sleep(Duration::from_millis(20));
                        }
                        loop {
                            match TcpListener::bind(("127.0.0.1", port)) {
                                Ok(listener) => break listener,
                                Err(_) if stop.load(Ordering::Relaxed) => return,
                                Err(_) => std::thread::sleep(Duration::from_millis(20)),
                            }
                        }
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

/// Binds the port now. A listener the previous test is still tearing down may
/// hold it for a moment, so this retries for a few seconds before giving up.
fn bind_or_wait(port: u16) -> TcpListener {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => return listener,
            Err(_) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => panic!("the fake health port {port} stayed taken: {e}"),
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

/// A port no other test in this binary can have.
///
/// `bind(:0)` is not enough: two tests running in parallel can be handed the
/// same port minutes apart, and then they share a pid file and a state file.
/// A counter keeps them apart, in a range the OS does not hand out on its own.
pub fn unique_port() -> u16 {
    static NEXT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(42000);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
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

/// The suspicion record a stop leaves beside the state file when it could
/// not prove absence (`<state file>.orphan`, `crate::suspect`). Named here
/// as well because every test that plants or checks one must use the same
/// convention the crate writes.
pub fn suspect_file(port: u16) -> PathBuf {
    PathBuf::from(format!("{}.orphan", state_file(port).display()))
}

/// Each test starts from no state file, no pid file and no suspicion record
/// at all — a record left by a previous test on this port would make the
/// next start settle a suspicion nobody raised.
pub fn clear_files(port: u16) {
    let _ = std::fs::remove_file(state_file(port));
    let _ = std::fs::remove_file(pid_file(port));
    let _ = std::fs::remove_file(suspect_file(port));
}

pub fn config(exe: &str, port: u16) -> ServerConfig {
    ServerConfig {
        exe: fixture(exe),
        argv: vec![
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            port.to_string(),
            "--model".into(),
            "/nonexistent/model.gguf".into(),
        ],
        api_key: kalsa_supervisor::EngineKey::mint().unwrap(),
        state_file: state_file(port),
        port,
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

/// A process an earlier run left behind: the shell backgrounds it and exits, so
/// init reaps it and this test is not its parent (a child of ours would stay a
/// zombie after the stop, and look alive).
#[cfg(unix)]
pub fn reparented_sleeper() -> u32 {
    let out = Command::new("/bin/sh")
        .args(["-c", "sleep 300 </dev/null >/dev/null 2>&1 & echo $!"])
        .output()
        .expect("start the earlier run's engine");
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse()
        .expect("the shell prints the orphan's pid")
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
