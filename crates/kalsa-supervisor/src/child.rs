//! The child process: how it is spawned, how it is stopped, and what stops it
//! when we are not around to ask.
//!
//! Shutdown order is the point of this file:
//!
//! 1. close our end of the child's stdin — the stop signal a cooperating child
//!    waits for, identical on every platform, because it is our pipe;
//! 2. SIGTERM to the child's process group, SIGKILL after a grace period, for a
//!    server that does not read stdin (`llama-server` does not);
//! 3. the platform backstop for a force-quit: a kill-on-close Job Object on
//!    Windows (from Jan, see NOTICE), `PR_SET_PDEATHSIG` on Linux. macOS has
//!    neither; see the README for what that costs.
//!
//! The child is put in its own process group on Unix, so the group shot in step
//! 2 also takes any helper it spawned.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, BufRead, BufReader};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How many stderr lines we keep to explain an unexpected exit.
const OUTPUT_TAIL: usize = 12;
/// How often `wait_within` looks at the child.
const WAIT_POLL: Duration = Duration::from_millis(25);

pub struct ChildHandle {
    child: Child,
    stdin: Option<ChildStdin>,
    tail: Arc<Mutex<VecDeque<String>>>,
    #[cfg(windows)]
    _job: Option<job::Job>,
}

impl ChildHandle {
    /// Spawns `exe` in its own process group (Unix) or inside a kill-on-close
    /// job (Windows), with stdin piped: dropping our end is the child's stop
    /// signal, so `Stdio::null()` would be an immediate EOF.
    ///
    /// The working directory is pinned to the binary's own directory because
    /// ggml's backend scan puts the process' current directory in its module
    /// search path and loads the first `ggml-*` name it scores — a module
    /// planted in an inherited directory would run. Absolute paths only: a
    /// relative program path is resolved against `current_dir`.
    pub fn spawn(exe: &Path, args: &[String], inherit: Option<&File>) -> io::Result<Self> {
        let mut cmd = Command::new(exe);
        cmd.args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        if exe.is_absolute() {
            if let Some(dir) = exe.parent() {
                cmd.current_dir(dir);
            }
        }
        #[cfg(unix)]
        {
            use std::os::unix::io::AsRawFd;
            use std::os::unix::process::CommandExt;
            // Own group: one signal reaches the server and anything it spawned.
            cmd.process_group(0);
            if let Some(file) = inherit {
                // The state file's lock has to outlive US, not just the spawn:
                // clearing close-on-exec lets the child keep the locked open
                // file description, so "the lock is held" keeps meaning "our
                // server is alive" even when this process was killed outright.
                // std opens every file close-on-exec, so this is the only way.
                let fd = file.as_raw_fd();
                if unsafe { libc::fcntl(fd, libc::F_SETFD, 0) } == -1 {
                    return Err(io::Error::last_os_error());
                }
            }
        }
        #[cfg(target_os = "linux")]
        unsafe {
            use std::os::unix::process::CommandExt;
            // Linux can ask the kernel to signal us when the parent dies. macOS
            // has no equivalent, which is why the macOS section of the README
            // says a force-quit can leave an idle server behind.
            cmd.pre_exec(|| {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM);
                Ok(())
            });
        }
        let mut child = cmd.spawn()?;
        #[cfg(windows)]
        let job = {
            // No inherited lock on Windows: the job object already kills the
            // child with us, so there is no orphan for it to identify.
            let _ = inherit;
            child.raw_handle().and_then(job::confine)
        };
        let stdin = child.stdin.take();
        let tail = drain_stderr(child.stderr.take());
        Ok(Self {
            child,
            stdin,
            tail,
            #[cfg(windows)]
            _job: job,
        })
    }

    pub fn pid(&self) -> u32 {
        self.child.id()
    }

    /// None while running, otherwise the exit status.
    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> {
        self.child.try_wait()
    }

    /// Last lines the child wrote to stderr, oldest first.
    pub fn output_tail(&self) -> Vec<String> {
        self.tail
            .lock()
            .map(|lines| lines.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Closes the child's stdin. False when there was no pipe left to close.
    pub fn close_stdin(&mut self) -> bool {
        self.stdin.take().is_some()
    }

    /// Stops the child: stdin EOF, then SIGTERM, then SIGKILL, each after
    /// `grace`. Always reaps, so no zombie survives this call.
    pub fn terminate(&mut self, grace: Duration) -> io::Result<ExitStatus> {
        self.close_stdin();
        if let Some(status) = self.wait_within(grace)? {
            return Ok(status);
        }
        #[cfg(unix)]
        signal_group(self.pid(), libc::SIGTERM);
        if let Some(status) = self.wait_within(grace)? {
            return Ok(status);
        }
        #[cfg(unix)]
        signal_group(self.pid(), libc::SIGKILL);
        #[cfg(not(unix))]
        let _ = self.child.kill();
        self.child.wait()
    }

    /// Some(status) when the child exited within `grace`, None on timeout.
    fn wait_within(&mut self, grace: Duration) -> io::Result<Option<ExitStatus>> {
        let deadline = Instant::now() + grace;
        loop {
            if let Some(status) = self.child.try_wait()? {
                return Ok(Some(status));
            }
            if Instant::now() >= deadline {
                return Ok(None);
            }
            std::thread::sleep(WAIT_POLL);
        }
    }
}

/// Best effort only: a process killed outright runs no destructors, which is
/// exactly why the Job Object / `PR_SET_PDEATHSIG` above exist.
impl Drop for ChildHandle {
    fn drop(&mut self) {
        if matches!(self.child.try_wait(), Ok(None)) {
            #[cfg(unix)]
            signal_group(self.pid(), libc::SIGKILL);
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// True when a process with this pid exists. `kill(pid, 0)` asks the OS
/// without sending anything.
pub fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return false;
        }
        unsafe { CloseHandle(handle) };
        true
    }
}

/// Stops a process we identified as ours through the state file, by pid: there
/// is no handle to it, it belongs to a previous run of this app. Callers must
/// have proven ownership first — this function cannot tell whose process it is.
/// Pid 0 is refused outright: it is this crate's marker for "ours, pid
/// unknown" (an orphan adopted blind), and signalling 0 would signal our own
/// process group instead of any server.
pub fn terminate_pid(pid: u32, grace: Duration) -> io::Result<()> {
    if pid == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "refusing to signal pid 0: it names no process",
        ));
    }
    if !pid_alive(pid) {
        return Ok(());
    }
    signal(pid, Signal::Term);
    if wait_pid_gone(pid, grace) {
        return Ok(());
    }
    signal(pid, Signal::Kill);
    let _ = wait_pid_gone(pid, grace);
    Ok(())
}

enum Signal {
    Term,
    Kill,
}

fn signal(pid: u32, which: Signal) {
    #[cfg(unix)]
    {
        let number = match which {
            Signal::Term => libc::SIGTERM,
            Signal::Kill => libc::SIGKILL,
        };
        // The pid, not the group: this one came out of a file.
        unsafe {
            libc::kill(pid as i32, number);
        }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, TerminateProcess, PROCESS_TERMINATE,
        };
        let _ = which;
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
        if handle.is_null() {
            return;
        }
        unsafe {
            TerminateProcess(handle, 1);
            CloseHandle(handle);
        }
    }
}

fn wait_pid_gone(pid: u32, grace: Duration) -> bool {
    let deadline = Instant::now() + grace;
    loop {
        if !pid_alive(pid) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(WAIT_POLL);
    }
}

#[cfg(unix)]
fn signal_group(pid: u32, signal: i32) {
    // The child leads its own group (`process_group(0)`), so the group id is its
    // pid and a negative pid addresses the group.
    unsafe {
        libc::kill(-(pid as i32), signal);
    }
}

/// A child that fills its stderr pipe blocks forever mid-generation, so the
/// pipe is drained. Keeping the tail is what lets the UI say why it died.
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

/// Ties the child's lifetime to ours on Windows, which has no process group.
///
/// Copied from Jan's `tauri-plugin-llamacpp` (`src/engine/worker.rs`, module
/// `reap`, MIT — see NOTICE): `TerminateProcess` runs no destructors, so a
/// force-quit would otherwise leave the server holding its model and its
/// `ggml*.dll` mappings. A job object whose last handle closes with this process
/// is the reaping the OS does for us.
#[cfg(windows)]
mod job {
    use std::os::windows::io::RawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// Closing this kills every process still in the job.
    pub struct Job(HANDLE);

    // Opaque outside Drop, which owns it exclusively.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Drop for Job {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.0) };
        }
    }

    /// Best effort: an app already confined to a job that forbids nesting
    /// should lose the reaping guarantee, not the server.
    pub fn confine(child: RawHandle) -> Option<Job> {
        let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if handle.is_null() {
            return None;
        }
        let job = Job(handle);
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let set = unsafe {
            SetInformationJobObject(
                job.0,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if set == 0 {
            return None;
        }
        if unsafe { AssignProcessToJobObject(job.0, child as HANDLE) } == 0 {
            return None;
        }
        Some(job)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pid_zero_is_refused_not_signalled() {
        // 0 is the marker for "ours, pid unknown", and signalling it would
        // signal our own process group. Instant by construction: no process
        // is touched, so there is nothing to wait for.
        assert!(terminate_pid(0, Duration::from_millis(10)).is_err());
    }
}
