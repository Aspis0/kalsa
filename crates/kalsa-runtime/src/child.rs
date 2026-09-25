//! The disposable child: a llama-server spawned to answer one question and
//! killed as soon as it has.
//!
//! The shape deliberately mirrors `kalsa-supervisor`'s `ChildHandle`, and the
//! mirror exists because that type is crate-private there (only `pid_alive`,
//! `terminate_pid`, `InstanceFile` — and on Windows `confine` and `Job` —
//! are re-exported), so this crate cannot hold one. What is genuinely
//! shared is reused: the orphan story runs on the supervisor's
//! `InstanceFile`. On unix the child inherits the exclusive lock, so "the
//! lock is held" keeps meaning "our disposable child is alive" even after a
//! force-quit, and the next start can name and kill it with
//! `terminate_pid`. On Windows the state file's lock handle alone is not
//! handed to the child — the child's stderr pipe end is — so the app's lock
//! dies with the app and the child rides in the supervisor's kill-on-close
//! job instead: a force-quit closes the job, the job reaps the child, and
//! the record reads `Stale` with no pid left to signal. The accepted
//! residual: a force-quit in the window between `spawn` and `confine`, or a
//! failed confine (reported at the spawn), leaves the disposable child
//! outside the job, and a `Stale` record cannot name it — accepted for a
//! child that lives seconds on a tiny model.
//!
//! Two things are deliberate: on unix the child leads its own process
//! group when it inherits the state handle (spawn sets `process_group(0)`)
//! — and this crate's stop signals the pid ALONE (`Child::stop` sends
//! SIGTERM to `self.inner.id()`, never to a group), so that group is the
//! child's own, not a channel this crate signals down — and on Windows the
//! supervisor's kill-on-close job, shared rather than reinvented: a
//! force-quit must not leave a llama-server running on a port with the
//! record already deleted.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kalsa_supervisor::{terminate_pid, Existing, InstanceFile, Termination};
#[cfg(windows)]
use kalsa_supervisor::{confine, Job};

/// How often the probe looks at the child.
pub(crate) const TICK: Duration = Duration::from_millis(100);
/// How many stderr lines we keep to explain a refusal.
const OUTPUT_TAIL: usize = 8;

/// The seam tests use to stand in for a real process: the probe never calls
/// `Command` directly.
pub(crate) trait Launch {
    fn spawn(
        &self,
        exe: &Path,
        args: &[String],
        inherit: Option<&File>,
    ) -> io::Result<Box<dyn Running>>;
}

/// One running candidate. `stop` must always be called — after success to
/// tear the child down, after failure to reap it — so no zombie survives a
/// verdict either way.
pub(crate) trait Running {
    fn pid(&self) -> u32;
    /// None while running, otherwise the exit status.
    fn try_exit(&mut self) -> io::Result<Option<ExitStatus>>;
    /// Stops the child and reaps it.
    fn stop(&mut self, grace: Duration) -> io::Result<ExitStatus>;
    /// Last stderr lines, oldest first: the candidate's own explanation.
    fn tail(&self) -> Vec<String>;
}

/// The real launcher: this process's own children.
pub(crate) struct OsLaunch;

impl Launch for OsLaunch {
    fn spawn(
        &self,
        exe: &Path,
        args: &[String],
        inherit: Option<&File>,
    ) -> io::Result<Box<dyn Running>> {
        Ok(Box::new(Child::start(exe, args, inherit)?))
    }
}

struct Child {
    inner: std::process::Child,
    tail: Arc<Mutex<VecDeque<String>>>,
    /// Windows only: the kill-on-close job the child rides in — dropping it
    /// (the app dying) takes the child with it. Unix keeps the lock story
    /// instead (see the module doc).
    #[cfg(windows)]
    _job: Option<Job>,
}

impl Child {
    fn start(exe: &Path, args: &[String], inherit: Option<&File>) -> io::Result<Self> {
        let mut cmd = Command::new(exe);
        cmd.args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if exe.is_absolute() {
            if let Some(dir) = exe.parent() {
                // Same pin as the supervisor's spawn: ggml's backend scan puts
                // the process' current directory in its module search path,
                // and a probe binary must load the DLLs we extracted, not any
                // a stray directory offers.
                cmd.current_dir(dir);
            }
        }
        #[cfg(unix)]
        if let Some(file) = inherit {
            use std::os::unix::io::AsRawFd;
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
            // Clearing close-on-exec is what lets the child keep the locked
            // open file description, so the state file stays "held" for as
            // long as the child lives — even if this process dies first.
            // std opens every file close-on-exec, so this is the only way.
            let fd = file.as_raw_fd();
            if unsafe { libc::fcntl(fd, libc::F_SETFD, 0) } == -1 {
                return Err(io::Error::last_os_error());
            }
        }
        #[cfg(not(unix))]
        let _ = inherit;
        let mut inner = cmd.spawn()?;
        // Windows: the lock dies with the app (handles are not inherited),
        // so the job is what reaps this child when a force-quit takes us —
        // without it a disposable llama-server would outlive its own record. A
        // failed confine is said out loud, the supervisor's way.
        #[cfg(windows)]
        let job = {
            use std::os::windows::io::AsRawHandle;
            let job = confine(inner.as_raw_handle());
            if job.is_none() {
                eprintln!(
                    "kalsa-brain: the disposable child could not be confined to a kill-on-close \
                     job: a force-quit will not reap it"
                );
            }
            job
        };
        let tail = drain_stderr(inner.stderr.take());
        Ok(Self {
            inner,
            tail,
            #[cfg(windows)]
            _job: job,
        })
    }

    fn wait_within(&mut self, grace: Duration) -> io::Result<Option<ExitStatus>> {
        let deadline = Instant::now() + grace;
        loop {
            if let Some(status) = self.inner.try_wait()? {
                return Ok(Some(status));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(TICK);
        }
    }
}

impl Running for Child {
    fn pid(&self) -> u32 {
        self.inner.id()
    }

    fn try_exit(&mut self) -> io::Result<Option<ExitStatus>> {
        self.inner.try_wait()
    }

    fn stop(&mut self, grace: Duration) -> io::Result<ExitStatus> {
        #[cfg(unix)]
        {
            // SIGTERM first: a graceful exit releases the port cleanly and
            // keeps the state file's story simple. SIGKILL after `grace` for
            // a candidate stuck in a broken backend.
            unsafe {
                libc::kill(self.inner.id() as i32, libc::SIGTERM);
            }
            if let Some(status) = self.wait_within(grace)? {
                return Ok(status);
            }
            // A failed kill must not feed the unbounded wait below: it
            // propagates, as on the windows branch.
            self.inner.kill()?;
        }
        #[cfg(not(unix))]
        {
            // TerminateProcess is the only stop Windows has, and it must be
            // called: without it `wait()` waits for a child that has no reason
            // to exit — the walk's hang, proven on the Surface. Rust documents
            // kill as "Forces the child process to exit. If the child has
            // already exited, `Ok(())` is returned" (std::process::Child::kill,
            // pinned toolchain source), so an Err is a real failure — access
            // denied, an invalid handle — with the child possibly still
            // running: it propagates, because waiting after a failed kill is
            // the hang again.
            let _ = grace;
            self.inner.kill()?;
        }
        self.inner.wait()
    }

    fn tail(&self) -> Vec<String> {
        self.tail
            .lock()
            .map(|lines| lines.iter().cloned().collect())
            .unwrap_or_default()
    }
}

impl Drop for Child {
    // A disposable child must never outlive its question by accident; the
    // state file is the on-purpose path for when we are killed outright.
    fn drop(&mut self) {
        if matches!(self.inner.try_wait(), Ok(None)) {
            #[cfg(unix)]
            unsafe {
                libc::kill(self.inner.id() as i32, libc::SIGKILL);
            }
            // A destructor must not block forever: wait only after a kill
            // that succeeded — a child that could not be killed is left,
            // not waited on.
            if self.inner.kill().is_ok() {
                let _ = self.inner.wait();
            }
        }
    }
}

/// Kills a disposable child left behind by a force-quit, and clears its state
/// file. Ownership is proven the supervisor's way: a lock held on our own
/// state file counts as ours — the child's inherited handle on unix, the
/// live instance's own handle on Windows — so a recycled pid is never
/// signalled. A probe running in another app instance at this exact moment
/// would also read as live; the window is the probe's own seconds and the
/// cost is a re-probe.
pub(crate) fn reap_orphan(state_file: &Path, grace: Duration) {
    match InstanceFile::inspect(state_file) {
        Ok(Existing::Live { pid, .. }) => match terminate_pid(pid, grace) {
            // The record goes only with proof the process is gone: a
            // Survived or Unknown leaves it, so the next start tries
            // again — deleting it would orphan a running pid forever.
            Termination::Gone { .. } => {
                let _ = std::fs::remove_file(state_file);
            }
            other => eprintln!(
                "kalsa-brain: an orphan pid {pid} did not go away ({other:?}); the state \
                 file stays so the next start can try again"
            ),
        },
        Ok(Existing::Stale) => {
            let _ = std::fs::remove_file(state_file);
        }
        _ => {}
    }
}

/// A child that fills its stderr pipe blocks mid-startup — llama.cpp logs its
/// whole backend scan there — so the pipe is drained and the tail kept for
/// the verdict's reason.
fn drain_stderr(stderr: Option<std::process::ChildStderr>) -> Arc<Mutex<VecDeque<String>>> {
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    let Some(stderr) = stderr else {
        return tail;
    };
    let sink = Arc::clone(&tail);
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut lines) = sink.lock() {
                if lines.len() == OUTPUT_TAIL {
                    lines.pop_front();
                }
                lines.push_back(line);
            }
        }
    });
    tail
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `stop` must return promptly on a healthy child that has no reason to
    /// exit — the walk's hang was the Windows branch never killing. The stop
    /// runs on a thread behind a bounded receive, so a regression fails the
    /// suite by timeout instead of hanging it.
    #[test]
    fn stop_returns_promptly_on_a_healthy_long_running_child() {
        #[cfg(unix)]
        let (exe, args) = ("/bin/sleep", vec!["300".to_string()]);
        #[cfg(windows)]
        let (exe, args) = (
            "ping",
            vec!["-n".to_string(), "300".to_string(), "127.0.0.1".to_string()],
        );
        let mut child = Child::start(Path::new(exe), &args, None).expect("spawn the stand-in");
        assert!(
            matches!(child.try_exit(), Ok(None)),
            "the stand-in must be healthy and running"
        );
        // The thread takes the child; the pid stays here so the timeout path
        // can reclaim the stand-in it can no longer reach.
        let pid = child.inner.id();
        let grace = Duration::from_secs(2);
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let started = Instant::now();
            let result = child.stop(grace);
            let _ = tx.send((result, started.elapsed()));
        });
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok((Ok(_status), elapsed)) => {
                // What is proven: a stand-in with 300 s of life left is
                // reaped in seconds — killed, not waited out. The clock is
                // the thread's, so spawn scheduling is not counted against
                // the stop.
                assert!(
                    elapsed < Duration::from_secs(5),
                    "stop returned after {elapsed:?} — it must reap the \
                     300-second stand-in promptly, not wait out its life"
                );
            }
            Ok((Err(error), _)) => panic!("stop failed: {error}"),
            Err(_) => {
                // The thread owns `child` and is blocked in `wait`: reclaim
                // the stand-in by pid so this failure leaves nothing running.
                let cleanup = terminate_pid(pid, Duration::from_secs(1));
                panic!(
                    "stop did not return within 15s — it never killed the child; \
                     stand-in {pid} cleanup: {cleanup:?}"
                );
            }
        }
    }

    /// On Windows the probe child's reap rides on the supervisor's
    /// kill-on-close job: the app's lock dies with the app there (handles
    /// are not inherited), so this job is all a force-quit leaves behind.
    /// Dropping it must take the child with it — the pattern the
    /// supervisor's `dropping_the_job_ends_the_child_it_confined` proves
    /// for its own children.
    #[cfg(windows)]
    #[test]
    fn dropping_the_job_takes_the_probe_child() {
        let mut child = Child::start(
            Path::new("ping"),
            &["-n".to_string(), "300".to_string(), "127.0.0.1".to_string()],
            None,
        )
        .expect("spawn the stand-in");
        assert!(
            matches!(child.inner.try_wait(), Ok(None)),
            "the stand-in must be healthy and running"
        );
        let pid = child.inner.id();
        let job = child
            ._job
            .take()
            .expect("the stand-in must be confined — no job means no reap");
        drop(job);
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut ended = false;
        let mut watch_error = None;
        while Instant::now() < deadline {
            match child.inner.try_wait() {
                Ok(None) => std::thread::sleep(TICK),
                Ok(Some(_)) => {
                    ended = true;
                    break;
                }
                Err(error) => {
                    watch_error = Some(error);
                    break;
                }
            }
        }
        if !ended {
            // Nothing may leak: reclaim the stand-in by pid, the way the
            // stop tests do, before failing.
            let cleanup = terminate_pid(pid, Duration::from_secs(1));
            let why = match watch_error {
                Some(error) => format!("polling the probe child failed: {error}"),
                None => "dropping the job did not take the child within 5s".to_string(),
            };
            panic!("{why} (pid {pid}); cleanup: {cleanup:?}");
        }
    }
}
