//! Helpers shared by the supervision tests. Not a test binary itself: it lives
//! in a subdirectory so cargo does not try to run it.

#![allow(dead_code)]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener};
use std::path::{Path, PathBuf};
#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
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
                PORT.with(|bound| bound.set(Some(port)));
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
                            // An accepted socket inherits the listener's
                            // non-blocking flag on BSD, and this one serves a
                            // conversation: a `WouldBlock` between the requests
                            // of a keep-alive connection is not the end of it.
                            let _ = socket.set_nonblocking(false);
                            let _ = socket.set_read_timeout(Some(Duration::from_secs(2)));
                            // Every request on this connection, until the
                            // client closes it. The handshake asks one
                            // question per connection (module `health`), and a
                            // server that kept answering past `Connection:
                            // close` must still be heard correctly — that is
                            // what the liveness watch's own probes are.
                            while let Some(request) = read_head(&mut socket) {
                                write_answer(&mut socket, &request);
                            }
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

/// One answer, framed the way the fork frames it.
///
/// The fork's own rule, so a test that passes here has proved the handshake
/// ASKED with the key and not merely that something answered: `/health` is
/// open, every other route is `401` without the bearer (module `health`). A
/// `HEAD` gets the headers a `GET` would have sent and no body — a body left
/// on a connection that asks again is read as the next answer.
fn write_answer(socket: &mut std::net::TcpStream, request: &str) {
    // A request this fake did not read is not one it may answer: the open
    // route would answer a probe that asked a gated one.
    if request.trim().is_empty() {
        return;
    }
    let (status, body) = if !request.contains("/health") && !bearer_is_ours(request) {
        ("HTTP/1.1 401 Unauthorized", "")
    } else {
        ("HTTP/1.1 200 OK", "{\"status\":\"ok\"}")
    };
    let head = format!("{status}\r\nContent-Length: {}\r\n\r\n", body.len());
    let answer = match request.starts_with("HEAD ") {
        true => head,
        false => format!("{head}{body}"),
    };
    let _ = socket.write_all(answer.as_bytes());
}

/// The whole request head, however many reads it takes, or `None` once the
/// client closes the connection.
///
/// One `read` is not enough and must not be treated as enough: TCP splits a
/// request anywhere, and a head cut in half reads as a request with no
/// `Authorization` on it — which would make this fixture answer `401` to a
/// probe that did carry the key, and fail a start that is behaving.
fn read_head(socket: &mut std::net::TcpStream) -> Option<String> {
    let mut head = Vec::new();
    let mut scratch = [0u8; 512];
    loop {
        if let Some(end) = head
            .windows(4)
            .position(|window| window == b"\r\n\r\n")
            .map(|start| start + 4)
        {
            return Some(String::from_utf8_lossy(&head[..end]).into_owned());
        }
        // A head that ends without its blank line was cut in half, and half a
        // request is not one this fixture may answer.
        match socket.read(&mut scratch) {
            Ok(0) | Err(_) => return None,
            Ok(read) => head.extend_from_slice(&scratch[..read]),
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
        forget_stand_ins(self.port);
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
    let config = ServerConfig {
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
    };
    remember_key(&config);
    config
}

/// A config whose engine IS `/bin/sh`, running a fixture script.
///
/// The walk proves a pid by the executable it is running, and a script run by
/// a shell IS that shell: so for the tests about closing an earlier run's
/// engine, the engine on both sides of the comparison has to be the same path.
/// This gives them one.
#[cfg(unix)]
pub fn shell_config(name: &str, port: u16, tag: &str) -> ServerConfig {
    let script = fixture(name);
    let mut config = ServerConfig {
        exe: shell_executable(tag),
        // The script as argv[0], so the flags after it are the script's "$@".
        // (`sh -c <script> …` would not do: a shell running one simple
        // command execs it in place and the arguments go with it.)
        argv: vec![
            script.to_string_lossy().into_owned(),
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
    };
    remember_key(&config);
    config
}

/// The fake serving this port answers a gated route only for THIS key, so the
/// handshake's negative control has something to be refused by.
fn remember_key(config: &ServerConfig) {
    MINTED
        .lock()
        .expect("the minted keys")
        .insert(config.port, config.api_key.as_str().to_string());
}

/// The key each test's engine was started with, by port: the fake is a fork,
/// and a fork refuses every key but the one it was given.
static MINTED: std::sync::LazyLock<Mutex<std::collections::HashMap<u16, String>>> =
    std::sync::LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

/// Whether this request carries the bearer the engine on this port was given.
fn bearer_is_ours(request: &str) -> bool {
    let Some(bearer) = request
        .lines()
        .find_map(|line| line.strip_prefix("Authorization: Bearer "))
    else {
        return false;
    };
    let Some(port) = PORT.with(|port| port.get()) else {
        return false;
    };
    MINTED
        .lock()
        .expect("the minted keys")
        .get(&port)
        .is_some_and(|minted| minted == bearer.trim())
}

thread_local! {
    /// The port the serving thread is answering for.
    static PORT: std::cell::Cell<Option<u16>> = const { std::cell::Cell::new(None) };
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
pub fn reparented_sleeper(port: u16) -> u32 {
    let out = Command::new("/bin/sh")
        .process_group(0)
        // Two lines: the shell (whose pid is the process GROUP this stand-in
        // runs in, and what the cleanup signals) and the sleep (the process
        // the test is about, and what the walk under test is asked to stop).
        .args(["-c", "echo $$; sleep 300 </dev/null >/dev/null 2>&1 & echo $!"])
        .output()
        .expect("start the earlier run's engine");
    let printed: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();
    let pid: u32 = printed
        .get(1)
        .and_then(|line| line.parse().ok())
        .expect("the shell prints the orphan's pid");
    remember_stand_in(port, pid);
    pid
}

/// The stand-ins a test planted on its port, and what they hold.
///
/// A stand-in is reparented on purpose — that is what makes it a stand-in —
/// so nothing reaps it, and a test that leaves one running (on purpose: a
/// stranger must not be signalled) leaves a 300-second process behind holding
/// every descriptor it inherited. The fake that owned the port takes them with
/// it when the test ends.
static STAND_INS: LazyLock<Mutex<std::collections::HashMap<u16, Vec<u32>>>> =
    LazyLock::new(|| Mutex::new(std::collections::HashMap::new()));

fn remember_stand_in(port: u16, pid: u32) {
    STAND_INS
        .lock()
        .expect("the stand-ins")
        .entry(port)
        .or_default()
        .push(pid);
}

fn forget_stand_ins(port: u16) {
    let pids = STAND_INS
        .lock()
        .expect("the stand-ins")
        .remove(&port)
        .unwrap_or_default();
    for pid in pids {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status();
    }
}

/// A reparented process that stays `/bin/sh` for as long as it lives.
///
/// A reparented server is not this test's child to reap, and the walk proves a
/// pid by the executable the OS reports — so this stand-in has to BE the
/// engine by the time it returns. Both levels name `/bin/sh` by absolute path
/// (a bare `sh` resolves by `PATH`, and that is not the same file on every
/// machine), and the stand-in announces itself once it is past its exec, so
/// this waits for the announcement rather than for a guess.
#[cfg(unix)]
pub fn reparented_shell(port: u16, tag: &str) -> u32 {
    let shell = shell_executable(tag);
    let marker = marker_path(tag);
    let _ = std::fs::remove_file(&marker);
    // A shell with NOTHING to wait on: it blocks reading a fifo nobody ever
    // writes to. A loop with a `sleep` in it would leave that sleep running
    // after the shell is killed, and the sleep would hold every descriptor it
    // inherited for the rest of the afternoon.
    let fifo = marker.with_extension("fifo");
    let _ = std::fs::remove_file(&fifo);
    assert!(
        Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .map(|status| status.success())
            .unwrap_or(false),
        "could not make the stand-in's fifo ({})",
        fifo.display()
    );
    // Spawned THROUGH a shell that exits at once, so the stand-in is
    // reparented: a child of this test would be a zombie the moment the walk
    // under test stops it, and a zombie looks alive to `ps`.
    //
    // Every handle of the stand-in is redirected, so this command's stdout
    // closes when the shell exits and `output()` returns.
    let out = Command::new(&shell)
        .args([
            "-c",
            &format!(
                "{shell} -c 'echo started > {marker}; read _ < {fifo}' \
                 </dev/null >/dev/null 2>&1 & echo $!",
                shell = shell.display(),
                marker = marker.display(),
                fifo = fifo.display()
            ),
        ])
        .output()
        .expect("start the earlier run's engine");
    let pid: u32 = String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse()
        .expect("the shell prints the stand-in's pid");
    wait_for_file(&marker, "the stand-in to announce itself");
    let _ = std::fs::remove_file(&marker);
    let _ = std::fs::remove_file(&fifo);
    assert_eq!(
        kalsa_supervisor::pid_executable(pid),
        Some(shell),
        "the stand-in is not running the engine it was started as"
    );
    remember_stand_in(port, pid);
    pid
}

/// What the OS calls the shell this machine runs.
///
/// `/bin/sh` is bash on some systems and a different program on others, and
/// the walk compares what the filesystem says about a running process — so
/// every fixture that plants an engine takes this as its answer instead of
/// guessing a platform's.
#[cfg(unix)]
pub fn shell_executable(tag: &str) -> PathBuf {
    let marker = marker_path(&format!("{tag}-shell"));
    let _ = std::fs::remove_file(&marker);
    let mut child = Command::new("/bin/sh")
        .args(["-c", &format!("echo $$ > {}; sleep 60", marker.display())])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("start a shell to name");
    wait_for_file(&marker, "the shell to announce its pid");
    let pid: u32 = std::fs::read_to_string(&marker)
        .expect("the marker")
        .trim()
        .parse()
        .expect("the shell prints its pid");
    // Asked while it is still running: a reaped pid has no executable left.
    let executable = kalsa_supervisor::pid_executable(pid).expect("the shell's own executable");
    let _ = child.kill();
    let _ = child.wait();
    let _ = std::fs::remove_file(&marker);
    executable
}


/// A file appearing IS the event, so waiting for it is not a guess about
/// timing: the stand-in writes it from inside the process being watched.
fn wait_for_file(path: &Path, what: &str) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !path.exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "timed out waiting for {what} ({})",
            path.display()
        );
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn marker_path(tag: &str) -> PathBuf {
    std::env::temp_dir().join(format!("kalsa-fixture-{tag}.marker"))
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
