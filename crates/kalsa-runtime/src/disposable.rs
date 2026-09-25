//! One disposable loopback server's whole lifetime: claim the state file,
//! wait until `/health` answers or the deadline, hand the caller its
//! address, and stop it on every path.
//!
//! This is the probe's shape with the caller's own argv: the capability
//! probe builds its arguments inside (it has one fixed question), while a
//! tune candidate runs the exact launch the app would use, so the seam
//! takes `exe`/`args` and adds nothing. The state file is the probe's own
//! (`<root>/probe.state`), so a force-quit child is reaped by the next
//! start's decide exactly like a probe's — no second file, no second
//! reap path.

use std::net::SocketAddr;
use std::path::Path;
use std::time::{Duration, Instant};

use kalsa_supervisor::{InstanceFile, DEFAULT_STOP_GRACE};

use crate::child::{self, Launch, OsLaunch};
use crate::probe::health_ok;

/// Why a disposable server never became usable. The two ways, named so
/// they map 1:1 onto the tune's `Refusal::{DidNotStart, NotReady}` — the
/// third refusal, "no usable answer", belongs to the measurer and not to
/// the server. The engine's own words are deliberately not carried: the
/// only reader maps this to a closed cause, and a field nobody reads is
/// a field that only invites leaking a path into a record.
#[derive(Debug)]
pub enum ServeError {
    /// The state file could not be claimed, the exe did not spawn, the
    /// child stopped before `/health` answered, or it was not alive (or
    /// not nameable) when it did.
    DidNotStart,
    /// Alive at the ready deadline without answering: it never became
    /// usable in time.
    NotReady { seconds: u64 },
}

/// A loopback port for a disposable server to bind. The listener drops
/// before the spawn, so another program could take the port in between —
/// the same accepted window as the supervisor's start, and cheaper than
/// parsing the child's stderr for the port it ended up on.
pub fn free_loopback_port() -> std::io::Result<u16> {
    crate::probe::free_loopback_port()
}

/// Runs `exe` with `args` as a disposable loopback server on `port`.
/// `args` must already carry `--host 127.0.0.1` and `--port {port}` — the
/// caller built them, because the caller knows the launch production
/// would use. Ok hands back the running server; every Err path has
/// already stopped and reaped it, and dropping the handle stops and
/// reaps it on every other one.
///
/// Two things this function does not promise, stated as the probe states
/// its own: callers are sequential by construction (the walk tunes one
/// thing at a time), so overlapping serves are unsupported — the second
/// one fails its claim and reports `DidNotStart`; and a force-quit in the
/// window between the spawn and the record's describe leaves a locked,
/// pid-less file the reaper cannot name — the next serve fails to claim
/// it and the caller falls back to the rule. A describe that fails while
/// the child lives is refused outright (below): a child we cannot name
/// after a force-quit must not run.
pub fn serve(
    root: &Path,
    port: u16,
    exe: &Path,
    args: &[String],
    ready_timeout: Duration,
) -> Result<Disposable, ServeError> {
    let state = crate::decide::state_file(root);
    // A force-quit child from a previous run holds this file's lock and
    // the port: reap it first, the decide walk's own rule — this child
    // rides the same file, so the next start's reap covers it too.
    child::reap_orphan(&state, DEFAULT_STOP_GRACE);
    let mut instance = InstanceFile::claim(&state).map_err(|_| ServeError::DidNotStart)?;
    match run(port, exe, args, ready_timeout, &mut instance) {
        Ok((running, addr)) => Ok(Disposable { running, instance: Some(instance), addr }),
        Err(error) => {
            instance.release();
            Err(error)
        }
    }
}

fn run(
    port: u16,
    exe: &Path,
    args: &[String],
    ready_timeout: Duration,
    instance: &mut InstanceFile,
) -> Result<(Box<dyn child::Running>, SocketAddr), ServeError> {
    let mut running = OsLaunch
        .spawn(exe, args, Some(instance.handle()))
        .map_err(|_| ServeError::DidNotStart)?;
    if instance.describe(running.pid(), port).is_err() {
        // A child we cannot name after a force-quit cannot be reaped: the
        // record would be locked and pid-less. Do not let it run.
        let _ = running.stop(DEFAULT_STOP_GRACE);
        return Err(ServeError::DidNotStart);
    }
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + ready_timeout;
    loop {
        // A crash ends here on its own: `try_exit` has already reaped the
        // child, so nothing is signalled — a pid that is gone is not ours
        // to signal again. A hang ends at the deadline, and that child is
        // still alive: it stops.
        if let Ok(Some(_status)) = running.try_exit() {
            return Err(ServeError::DidNotStart);
        }
        if Instant::now() >= deadline {
            let _ = running.stop(DEFAULT_STOP_GRACE);
            return Err(ServeError::NotReady {
                seconds: ready_timeout.as_secs(),
            });
        }
        if health_ok(addr, "/health", crate::probe::PROBE_TIMEOUT) {
            // A 200 on a port that was free before the spawn is not proof
            // it was OURS — somebody else may have taken the port. The
            // child must be alive too: if llama-server lost the bind it
            // exits, and its own exit is the honest answer.
            match running.try_exit() {
                Ok(None) => return Ok((running, addr)),
                Ok(Some(_)) => return Err(ServeError::DidNotStart),
                Err(_) => {
                    // Unknown state: stop the child rather than leave it.
                    let _ = running.stop(DEFAULT_STOP_GRACE);
                    return Err(ServeError::DidNotStart);
                }
            }
        }
        std::thread::sleep(child::TICK);
    }
}

/// A disposable server's whole lifetime. Dropping it stops and reaps the
/// child (GPU memory free before the next candidate spawns) and releases
/// the state file.
pub struct Disposable {
    running: Box<dyn child::Running>,
    instance: Option<InstanceFile>,
    addr: SocketAddr,
}

impl Disposable {
    /// Where it answers while it lives: loopback only, the port the
    /// caller put in its own argv.
    pub fn address(&self) -> SocketAddr {
        self.addr
    }

    /// True while our child is still the one on the port: `try_exit`
    /// answers None. The port was free before the spawn — the documented
    /// race — so a child that died after answering means the answers may
    /// have been somebody else's, and no sample of them counts.
    pub fn alive(&mut self) -> bool {
        matches!(self.running.try_exit(), Ok(None))
    }
}

impl Drop for Disposable {
    fn drop(&mut self) {
        let _ = self.running.stop(DEFAULT_STOP_GRACE);
        if let Some(instance) = self.instance.take() {
            instance.release();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_supervisor::pid_alive;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-runtime-disposable-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// A missing exe is the first of the two ways: the claim happens, the
    /// spawn fails, and the state file is released again.
    #[test]
    fn an_exe_that_cannot_spawn_is_a_did_not_start() {
        let root = scratch("missing-exe");
        let port = free_loopback_port().expect("a port");
        let error = match serve(
            &root,
            port,
            Path::new("/nonexistent/kalsa-server"),
            &[],
            Duration::from_secs(1),
        ) {
            Err(error) => error,
            Ok(_) => panic!("nothing to run"),
        };
        assert!(
            matches!(error, ServeError::DidNotStart),
            "{error:?}"
        );
        assert!(
            !crate::decide::state_file(&root).exists(),
            "a failed serve releases its claim"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A child that lives but never answers is the other way: the ready
    /// deadline ends it, and it is stopped, not leaked.
    #[cfg(unix)]
    #[test]
    fn a_child_that_never_answers_is_a_not_ready() {
        let root = scratch("not-ready");
        let port = free_loopback_port().expect("a port");
        let args = ["-c".to_string(), "exec sleep 30".to_string()];
        let error = match serve(
            &root,
            port,
            Path::new("/bin/sh"),
            &args,
            Duration::from_secs(1),
        ) {
            Err(error) => error,
            Ok(_) => panic!("nothing will answer /health"),
        };
        assert!(
            matches!(error, ServeError::NotReady { seconds: 1 }),
            "{error:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `ping -n` is the Windows sleeper: alive, never an HTTP answer.
    #[cfg(windows)]
    #[test]
    fn a_child_that_never_answers_is_a_not_ready() {
        let root = scratch("not-ready");
        let port = free_loopback_port().expect("a port");
        let args = ["-n".to_string(), "30".to_string(), "127.0.0.1".to_string()];
        let error = match serve(
            &root,
            port,
            Path::new("ping"),
            &args,
            Duration::from_secs(1),
        ) {
            Err(error) => error,
            Ok(_) => panic!("nothing will answer /health"),
        };
        assert!(
            matches!(error, ServeError::NotReady { seconds: 1 }),
            "{error:?}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// An exe that starts and dies before answering is the middle of the
    /// three exits: the child's own status carries the reason.
    #[cfg(unix)]
    #[test]
    fn a_child_that_dies_before_answering_is_a_did_not_start() {
        let root = scratch("early-exit");
        let port = free_loopback_port().expect("a port");
        let args = ["-c".to_string(), "exit 7".to_string()];
        let error = match serve(&root, port, Path::new("/bin/sh"), &args, Duration::from_secs(5)) {
            Err(error) => error,
            Ok(_) => panic!("nothing to answer"),
        };
        assert!(
            matches!(error, ServeError::DidNotStart),
            "an early exit is a DidNotStart, not {error:?}"
        );
        assert!(!crate::decide::state_file(&root).exists(), "released");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Dropping the handle is every other path: the child is stopped and
    /// reaped, the state file released — the GPU is free before the next
    /// candidate would spawn. The handle is built directly here (the test
    /// lives in this module): `serve`'s Ok path needs a server that
    /// answers `/health`, which only the real-server test has.
    #[cfg(unix)]
    #[test]
    fn dropping_the_handle_stops_the_child() {
        let root = scratch("drop");
        let port = free_loopback_port().expect("port");
        let state = crate::decide::state_file(&root);
        let instance = InstanceFile::claim(&state).expect("claim");
        let args = ["-c".to_string(), "exec sleep 30".to_string()];
        let running = OsLaunch
            .spawn(Path::new("/bin/sh"), &args, Some(instance.handle()))
            .expect("spawn");
        let pid = running.pid();
        let handle = Disposable {
            running,
            instance: Some(instance),
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
        };
        drop(handle);
        let deadline = Instant::now() + Duration::from_secs(5);
        while pid_alive(pid) && Instant::now() < deadline {
            std::thread::sleep(child::TICK);
        }
        assert!(!pid_alive(pid), "the drop must reap pid {pid}");
        assert!(!state.exists(), "the drop must release the claim");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// `ping -n` is the Windows sleeper: alive, never an HTTP answer, and
    /// dropped the same way.
    #[cfg(windows)]
    #[test]
    fn dropping_the_handle_stops_the_child() {
        let root = scratch("drop");
        let port = free_loopback_port().expect("port");
        let state = crate::decide::state_file(&root);
        let instance = InstanceFile::claim(&state).expect("claim");
        let args = ["-n".to_string(), "30".to_string(), "127.0.0.1".to_string()];
        let running = OsLaunch
            .spawn(Path::new("ping"), &args, Some(instance.handle()))
            .expect("spawn");
        let pid = running.pid();
        let handle = Disposable {
            running,
            instance: Some(instance),
            addr: SocketAddr::from(([127, 0, 0, 1], port)),
        };
        drop(handle);
        let deadline = Instant::now() + Duration::from_secs(5);
        while pid_alive(pid) && Instant::now() < deadline {
            std::thread::sleep(child::TICK);
        }
        assert!(!pid_alive(pid), "the drop must reap pid {pid}");
        assert!(!state.exists(), "the drop must release the claim");
        let _ = std::fs::remove_dir_all(&root);
    }
}
