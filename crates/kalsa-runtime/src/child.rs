//! The disposable child: a llama-server spawned to answer one question and
//! killed as soon as it has.
//!
//! The shape deliberately mirrors `kalsa-supervisor`'s `ChildHandle`, and the
//! mirror exists because that type is crate-private there (only `pid_alive`,
//! `terminate_pid` and `InstanceFile` are re-exported), so this crate cannot
//! hold one. What is genuinely shared is reused: the orphan story runs on the
//! supervisor's `InstanceFile` — the child inherits the exclusive lock, so
//! "the lock is held" keeps meaning "our probe child is alive" even after a
//! force-quit, and the next start can name and kill it with `terminate_pid`.
//!
//! Two divergences are deliberate: no process group (the long-lived server
//! gets one to reach helpers it spawns; a probe child spawns nothing), and no
//! Windows job object (the supervisor needs one to protect gigabytes of VRAM
//! for the server's whole life; a probe holds a few megabytes for seconds).

use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use kalsa_supervisor::{terminate_pid, Existing, InstanceFile};

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
        let tail = drain_stderr(inner.stderr.take());
        Ok(Self { inner, tail })
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
            let _ = self.inner.kill();
        }
        #[cfg(not(unix))]
        {
            // TerminateProcess is the only stop Windows has, and it must be
            // called: without it `wait()` waits for a child that has no reason
            // to exit — the walk's hang, proven on the Surface. A child that
            // already exited makes `kill` error; that error is dropped,
            // because `wait` below is what decides the stop.
            let _ = grace;
            let _ = self.inner.kill();
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
    // A probe child must never outlive the probe by accident; the state file
    // is the on-purpose path for when we are killed outright.
    fn drop(&mut self) {
        if matches!(self.inner.try_wait(), Ok(None)) {
            #[cfg(unix)]
            unsafe {
                libc::kill(self.inner.id() as i32, libc::SIGKILL);
            }
            let _ = self.inner.kill();
            let _ = self.inner.wait();
        }
    }
}

/// Kills a probe child left behind by a force-quit, and clears its state
/// file. Ownership is proven the supervisor's way: only a child holding the
/// inherited lock counts as ours, so a recycled pid is never signalled. A
/// probe running in another app instance at this exact moment would also read
/// as live; the window is the probe's own seconds and the cost is a re-probe.
pub(crate) fn reap_orphan(state_file: &Path, grace: Duration) {
    match InstanceFile::inspect(state_file) {
        Ok(Existing::Live { pid, .. }) => {
            let _ = terminate_pid(pid, grace);
            let _ = std::fs::remove_file(state_file);
        }
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
        let grace = Duration::from_secs(2);
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(child.stop(grace));
        });
        match rx.recv_timeout(Duration::from_secs(15)) {
            Ok(Ok(status)) => assert!(
                !status.success(),
                "the kill stopped it, not a natural exit ({status})"
            ),
            Ok(Err(error)) => panic!("stop failed: {error}"),
            Err(_) => panic!("stop did not return within 15s — it never killed the child"),
        }
    }
}
