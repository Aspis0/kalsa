//! The capability probe: the only honest support test.
//!
//! Detection narrows the candidates; this decides. The candidate build is
//! launched as a disposable child with a tiny model, polled on `/health`
//! until it answers `200` or its budget runs out, and torn down either way.
//! A non-zero exit, a startup crash, a missing DLL and a silent hang are all
//! the same verdict — "this build does not work here" — because a hung probe
//! that were forgiven would hang every start forever after.
//!
//! `/health` is the contract: `llama-server` answers `503` while the model
//! loads and `200` only once the backend has actually initialised, so a
//! `200` is the first moment the candidate has proven the one thing this
//! crate exists to prove.
//!
//! The readiness handshake is a copy of `kalsa-supervisor`'s `health_ok`
//! because that module is private there (one request, one status line, no
//! HTTP client — worth ~30 duplicated lines, see the report).

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::Path;
use std::process::ExitStatus;
use std::time::{Duration, Instant};

use kalsa_supervisor::{InstanceFile, DEFAULT_STOP_GRACE};

use crate::child::{self, Launch, Running};

/// A tiny model loads in seconds even on a slow disk; the budget exists for
/// the cold cache case, not the average one.
const DEFAULT_READY_SECONDS: u64 = 60;
/// Per-probe budget during the handshake, as in the supervisor.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_millis(500);

pub(crate) struct ProbeParams {
    pub port: u16,
    pub ready_timeout: Duration,
    pub stop_grace: Duration,
}

impl ProbeParams {
    pub(crate) fn for_port(port: u16) -> Self {
        Self {
            port,
            ready_timeout: Duration::from_secs(DEFAULT_READY_SECONDS),
            stop_grace: DEFAULT_STOP_GRACE,
        }
    }
}

/// A loopback port for the child to bind. The listener is dropped before the
/// child spawns, so there is a window in which another program could take the
/// port — the same accepted window as the supervisor's start, and cheaper
/// than parsing the child's stderr for the port it ended up on.
pub(crate) fn free_loopback_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    Ok(listener.local_addr()?.port())
}

/// Proves `exe` works on this machine. Ok only if it answered `/health` with
/// 200; the child is stopped and reaped on every path.
pub(crate) fn probe(
    launch: &dyn Launch,
    exe: &Path,
    model: &Path,
    params: &ProbeParams,
    state_file: &Path,
) -> Result<(), String> {
    // Claimed before the spawn: the fd must already be locked when the child
    // inherits it, or an orphan left by a force-quit could not be identified.
    let mut instance = InstanceFile::claim(state_file)
        .map_err(|e| format!("could not claim the probe state file: {e}"))?;
    let outcome = run(launch, exe, model, params, &mut instance);
    instance.release();
    outcome
}

fn run(
    launch: &dyn Launch,
    exe: &Path,
    model: &Path,
    params: &ProbeParams,
    instance: &mut InstanceFile,
) -> Result<(), String> {
    let args = vec![
        "--host".to_string(),
        "127.0.0.1".to_string(),
        "--port".to_string(),
        params.port.to_string(),
        "--model".to_string(),
        model.display().to_string(),
        "--no-webui".to_string(),
    ];
    let mut running = launch
        .spawn(exe, &args, Some(instance.handle()))
        .map_err(|e| format!("the candidate would not start: {e}"))?;
    let _ = instance.describe(running.pid(), params.port);

    let addr = SocketAddr::from(([127, 0, 0, 1], params.port));
    let deadline = Instant::now() + params.ready_timeout;
    let mut outcome = Err(format!(
        "the candidate did not answer within {} s",
        params.ready_timeout.as_secs()
    ));
    while Instant::now() < deadline {
        // A crash and a hang end here identically: one as an early exit with
        // the child's own stderr as the reason, the other as this deadline.
        if let Ok(Some(status)) = running.try_exit() {
            outcome = Err(exit_reason(running.as_ref(), status));
            break;
        }
        if health_ok(addr, "/health", PROBE_TIMEOUT) {
            outcome = Ok(());
            break;
        }
        std::thread::sleep(child::TICK);
    }
    // Both paths: tear down after success, reap after failure.
    let _ = running.stop(params.stop_grace);
    outcome
}

fn exit_reason(running: &dyn Running, status: ExitStatus) -> String {
    match running.tail().last() {
        Some(line) => format!("the candidate stopped before answering: {line}"),
        None => format!("the candidate stopped before answering ({status})"),
    }
}

/// True when `addr` answers `path` with `200` within `timeout`. Copied from
/// the supervisor's private `health_ok` (see module docs).
pub(crate) fn health_ok(addr: SocketAddr, path: &str, timeout: Duration) -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, timeout) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = format!("GET {path} HTTP/1.0\r\nHost: {addr}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut head = [0u8; 32];
    let read = stream.read(&mut head).unwrap_or(0);
    status_is_ok(&String::from_utf8_lossy(&head[..read]))
}

/// `HTTP/1.x 200 …` — the reason phrase may be anything, the code may not.
fn status_is_ok(response_head: &str) -> bool {
    let mut parts = response_head.split_whitespace();
    let version = parts.next().unwrap_or_default();
    let code = parts.next().unwrap_or_default();
    version.starts_with("HTTP/1.") && code == "200"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::child::OsLaunch;
    use std::fs::File;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-runtime-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    #[cfg(unix)]
    fn exited(code: i32) -> ExitStatus {
        std::os::unix::process::ExitStatusExt::from_raw(code << 8)
    }

    #[cfg(windows)]
    fn exited(code: i32) -> ExitStatus {
        std::os::windows::process::ExitStatusExt::from_raw(code as u32)
    }

    /// A loopback listener answering 200 on every request — what a working
    /// llama-server looks like to this probe. Bound to port 0, never fixed.
    fn health_server() -> (u16, Arc<AtomicBool>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let served = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&served);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buf = [0u8; 256];
                let _ = stream.read(&mut buf);
                flag.store(true, Ordering::SeqCst);
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
            }
        });
        (port, served)
    }

    /// What the fake child does instead of running llama-server.
    enum Mode {
        /// Answers /health until stopped: the machine supports this build.
        Answer,
        /// Dies at startup: the backend refused, or a DLL was missing.
        Crash,
        /// Never exits, never answers: the hang that must count as a crash.
        Hang,
    }

    struct FakeRun {
        exit: Option<ExitStatus>,
        tail: Vec<String>,
        stopped: Arc<AtomicBool>,
    }

    struct FakeLaunch {
        mode: Mode,
        stopped: Arc<AtomicBool>,
    }

    impl Launch for FakeLaunch {
        fn spawn(
            &self,
            _exe: &Path,
            _args: &[String],
            _inherit: Option<&File>,
        ) -> std::io::Result<Box<dyn Running>> {
            let run = match self.mode {
                Mode::Answer => FakeRun {
                    exit: None,
                    tail: vec![],
                    stopped: Arc::clone(&self.stopped),
                },
                Mode::Crash => FakeRun {
                    exit: Some(exited(1)),
                    tail: vec!["ggml_vulkan: Unsupported device".to_string()],
                    stopped: Arc::clone(&self.stopped),
                },
                Mode::Hang => FakeRun {
                    exit: None,
                    tail: vec![],
                    stopped: Arc::clone(&self.stopped),
                },
            };
            Ok(Box::new(run))
        }
    }

    impl Running for FakeRun {
        fn pid(&self) -> u32 {
            4242
        }

        fn try_exit(&mut self) -> std::io::Result<Option<ExitStatus>> {
            Ok(self.exit)
        }

        fn stop(&mut self, _grace: Duration) -> std::io::Result<ExitStatus> {
            self.stopped.store(true, Ordering::SeqCst);
            Ok(self.exit.take().unwrap_or_else(|| exited(0)))
        }

        fn tail(&self) -> Vec<String> {
            self.tail.clone()
        }
    }

    fn fake(mode: Mode) -> (FakeLaunch, Arc<AtomicBool>) {
        let stopped = Arc::new(AtomicBool::new(false));
        (
            FakeLaunch {
                mode,
                stopped: Arc::clone(&stopped),
            },
            stopped,
        )
    }

    fn params(port: u16, seconds: u64) -> ProbeParams {
        ProbeParams {
            port,
            ready_timeout: Duration::from_secs(seconds),
            stop_grace: Duration::from_millis(50),
        }
    }

    #[test]
    fn a_candidate_that_answers_passes_and_is_torn_down() {
        let dir = scratch("probe-answer");
        let (port, served) = health_server();
        let (launch, stopped) = fake(Mode::Answer);
        probe(
            &launch,
            Path::new("/server/llama-server"),
            Path::new("/models/tiny.gguf"),
            &params(port, 2),
            &dir.join("probe.state"),
        )
        .expect("a healthy candidate passes");
        assert!(served.load(Ordering::SeqCst), "the probe must ask /health");
        assert!(
            stopped.load(Ordering::SeqCst),
            "success tears the child down"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_crash_fails_with_the_candidates_own_words() {
        let dir = scratch("probe-crash");
        let (launch, stopped) = fake(Mode::Crash);
        let err = probe(
            &launch,
            Path::new("/server/llama-server"),
            Path::new("/models/tiny.gguf"),
            &params(0, 2),
            &dir.join("probe.state"),
        )
        .expect_err("an unsupported device must fail the candidate");
        assert!(err.contains("Unsupported device"), "{err}");
        assert!(
            stopped.load(Ordering::SeqCst),
            "failure reaps the child too"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_hang_is_a_failure_exactly_like_a_crash() {
        let dir = scratch("probe-hang");
        let (launch, stopped) = fake(Mode::Hang);
        let err = probe(
            &launch,
            Path::new("/server/llama-server"),
            Path::new("/models/tiny.gguf"),
            &params(0, 0), // ~immediate deadline
            &dir.join("probe.state"),
        )
        .expect_err("a hang must fail the candidate, not wait forever");
        assert!(err.contains("did not answer"), "{err}");
        assert!(stopped.load(Ordering::SeqCst), "the hung child is stopped");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_clean_exit_without_an_answer_is_still_a_failure() {
        // The real launcher, a binary that exits 0 immediately and serves
        // nothing. "It started fine" proves nothing; only /health does.
        // (/bin/true has vanished on recent macOS; hostname is everywhere.)
        let dir = scratch("probe-true");
        #[cfg(unix)]
        let exe = ["/usr/bin/true", "/bin/true", "/bin/hostname"]
            .iter()
            .map(Path::new)
            .find(|path| path.exists())
            .expect("an immediately-exiting binary exists");
        // Windows has no /bin/true: a batch that ignores the launcher's
        // arguments and exits 0 is the same fact — starts, serves nothing,
        // leaves — and std runs a `.cmd` through cmd.exe itself.
        #[cfg(windows)]
        let stand_in = dir.join("exit-immediately.cmd");
        #[cfg(windows)]
        std::fs::write(&stand_in, "@exit /b 0\r\n").expect("write the stand-in");
        #[cfg(windows)]
        let exe = stand_in.as_path();
        let err = probe(
            &OsLaunch,
            exe,
            Path::new("/models/tiny.gguf"),
            &params(0, 2),
            &dir.join("probe.state"),
        )
        .expect_err("an exit without an answer must fail");
        assert!(err.contains("before answering"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_200_is_an_answer() {
        assert!(status_is_ok("HTTP/1.0 200 OK\r\n\r\n"));
        assert!(!status_is_ok("HTTP/1.1 503 Service Unavailable"));
        assert!(!status_is_ok("garbage"));
        assert!(!status_is_ok(""));
    }
}
