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
    /// Never observed answering and never observed exited by the ready
    /// deadline (a `try_exit` error leaves its state unknown — the
    /// deadline is what is known): it never became usable in time.
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
/// would use. Ok hands back the running server. The Err paths stop the
/// child as best effort: stop's own error is ignored here, and the
/// accepted residual is a child that outlives a failed stop (the next
/// reap finds what remains; `Child::drop` skips its kill when `try_wait`
/// itself errors). Dropping the handle stops and reaps every child nobody
/// has observed exited.
///
/// Two things this function does not promise, stated as the probe states
/// its own: callers must be sequential — this fn REAPS before it claims
/// (the decide walk's own rule), so a second overlapping serve would kill
/// the first one's child rather than merely fail, which the walk avoids by
/// tuning one thing at a time; and a force-quit in the
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
        Ok((running, addr)) => Ok(Disposable {
            running,
            instance: Some(instance),
            addr,
            exited: false,
        }),
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
            // it was OURS: the window opens BEFORE the bind — the engine
            // initialises its backend first (`llama_backend_init()`,
            // kalsallama `server.cpp:109` on `833cde99b`, long before
            // `ctx_http.start()` at :463-468; upstream llama.cpp carries
            // the same order, `0de8878c9`, server.cpp:5598-5608) — so a
            // foreign server can take the port and answer while ours is
            // still initialising. This gate is only the cheap first
            // filter: a child that has already exited never reaches the
            // handle. The identity proof is the tune's nonce — measure.rs
            // asks `/v1/models` for our id before and after the requests.
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
    /// Set when `alive` has SEEN this child exit (and reaped it): Drop
    /// must not signal that pid again — after a reap the pid may already
    /// belong to another program.
    exited: bool,
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
    /// have been somebody else's, and no sample of them counts. An exit
    /// observed here is remembered (the handle knows to stay quiet in
    /// Drop); an error from `try_exit` is not an exit and not proof of
    /// one — the child stays "possibly alive".
    pub fn alive(&mut self) -> bool {
        match self.running.try_exit() {
            Ok(None) => true,
            Ok(Some(_)) => {
                self.exited = true;
                false
            }
            Err(_) => false,
        }
    }
}

impl Drop for Disposable {
    fn drop(&mut self) {
        if !self.exited {
            // Only a child nobody has seen go: `stop` signals the pid, and
            // a pid already reaped may have been recycled onto another
            // program by now.
            let _ = self.running.stop(DEFAULT_STOP_GRACE);
        }
        if let Some(instance) = self.instance.take() {
            instance.release();
        }
    }
}

#[cfg(test)]
mod tests;
