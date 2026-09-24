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
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How many stderr lines we keep to explain an unexpected exit.
const OUTPUT_TAIL: usize = 12;
/// How often `wait_within` looks at the child.
const WAIT_POLL: Duration = Duration::from_millis(25);

/// The two stderr lines llama-server b10950 prints around a release:
/// `--sleep-idle-seconds` fires and it frees the model ("I srv  handle_sleep:
/// server is entering sleeping state"), then the next request loads the model
/// back ("I srv  handle_sleep: server is exiting sleeping state"). This is how
/// the owner learns either fact: the server offers no endpoint for its
/// residency — `/health` keeps answering 200 while the model is gone, and
/// `/props` carries `is_sleeping` but only a poll would read it — so the
/// announcement on the pipe we already drain is the signal. The wording is a
/// contract with the shipped build, which the runtime pins by digest; a
/// future build that rewords a line stops being watched, and that fact then
/// goes unannounced rather than invented.
const MODEL_RELEASED_LINE: &str = "server is entering sleeping state";
const MODEL_RELOADED_LINE: &str = "server is exiting sleeping state";

// The three values of the residency cell below.
const RESIDENCY_UNKNOWN: u8 = 0;
const RESIDENCY_IN_MEMORY: u8 = 1;
const RESIDENCY_RELEASED: u8 = 2;

/// Whether the server holds the model in memory right now, as its own stderr
/// announces it.
///
/// Three-valued, and the third value is the point: a server adopted from an
/// earlier run of this app is reused without a `ChildHandle` (see
/// `supervisor::take_over`), so there is no pipe to read and no announcement
/// can ever arrive. Its residency stays unknown rather than being assumed
/// loaded.
///
/// Deliberately a different fact from the release *counter*. The counter only
/// ever goes up, so no poll can miss an event; and for the same reason no
/// count can answer "is it asleep now", because nothing brings it back down.
#[derive(Clone)]
pub(crate) struct Residency(Arc<AtomicU8>);

impl Residency {
    pub(crate) fn new() -> Self {
        Self(Arc::new(AtomicU8::new(RESIDENCY_UNKNOWN)))
    }

    /// `None` while nothing has announced this server's residency — a server
    /// we hold no pipe to, and the moment before a drain of ours has looked.
    pub(crate) fn asleep(&self) -> Option<bool> {
        match self.0.load(Ordering::Relaxed) {
            RESIDENCY_IN_MEMORY => Some(false),
            RESIDENCY_RELEASED => Some(true),
            _ => None,
        }
    }

    fn set(&self, value: u8) {
        self.0.store(value, Ordering::Relaxed);
    }

    /// Forgets what the previous server announced. Called on the path that
    /// begins a start, before the new server can be reported running: the cell
    /// describes the server that owns it, and until the new one's drain has
    /// looked there is no answer to give. A poll landing in that window reads
    /// "unknown" — today's words — instead of the released model of the server
    /// before it.
    pub(crate) fn forget(&self) {
        self.set(RESIDENCY_UNKNOWN);
    }
}

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
    /// `releases` is bumped once per model release the server announces on
    /// stderr; see [`MODEL_RELEASED_LINE`]. `residency` carries the two-way
    /// fact the same lines tell — released, then loaded again — and stays
    /// unknown for a server this drain never watches.
    ///
    /// The working directory is pinned to the binary's own directory because
    /// ggml's backend scan puts the process' current directory in its module
    /// search path and loads the first `ggml-*` name it scores — a module
    /// planted in an inherited directory would run. Absolute paths only: a
    /// relative program path is resolved against `current_dir`.
    pub fn spawn(
        exe: &Path,
        args: &[String],
        inherit: Option<&File>,
        releases: Arc<AtomicU64>,
        residency: Residency,
    ) -> io::Result<Self> {
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
            use std::os::windows::io::AsRawHandle;
            job::confine(child.as_raw_handle())
        };
        let stdin = child.stdin.take();
        let tail = drain_stderr(child.stderr.take(), releases, residency);
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

    /// Stops the child: stdin EOF, then SIGTERM to its group, then SIGKILL,
    /// each after `grace`. Always reaps, so no zombie survives this call —
    /// and REPORTS what the walk found instead of handing back an exit
    /// status that reads as "gone" either way. This end never reports
    /// `Survived`: we hold the handle, and the final `wait` IS the reap —
    /// if even that errors, nothing is known and nothing may claim to be.
    pub fn terminate(&mut self, grace: Duration) -> Termination {
        let mut complaints: Vec<String> = Vec::new();
        if let Ok(Some(_)) = self.child.try_wait() {
            return Termination::Gone { needed: Step::Already };
        }
        self.close_stdin();
        match self.wait_within(grace) {
            Ok(Some(_)) => return Termination::Gone { needed: Step::Grace },
            Ok(None) => {}
            Err(error) => {
                return Termination::Unknown {
                    detail: format!("reaping after stdin EOF failed: {error}"),
                }
            }
        }
        #[cfg(unix)]
        if let Err(error) = signal_group(self.pid(), libc::SIGTERM) {
            complaints.push(format!("SIGTERM to the group: {error}"));
        }
        match self.wait_within(grace) {
            Ok(Some(_)) => return Termination::Gone { needed: Step::Grace },
            Ok(None) => {}
            Err(error) => {
                return Termination::Unknown {
                    detail: format!("reaping after SIGTERM failed: {error}"),
                }
            }
        }
        #[cfg(unix)]
        if let Err(error) = signal_group(self.pid(), libc::SIGKILL) {
            complaints.push(format!("SIGKILL to the group: {error}"));
        }
        #[cfg(not(unix))]
        if let Err(error) = self.child.kill() {
            complaints.push(format!("kill: {error}"));
        }
        match self.child.wait() {
            Ok(_) => Termination::Gone { needed: Step::Kill },
            Err(error) => {
                complaints.push(format!("wait: {error}"));
                Termination::Unknown { detail: complaints.join("; ") }
            }
        }
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
            let _ = signal_group(self.pid(), libc::SIGKILL);
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
pub fn terminate_pid(pid: u32, grace: Duration) -> Termination {
    if pid == 0 {
        return Termination::Unknown {
            detail: "refusing to signal pid 0: it names no process".to_string(),
        };
    }
    if !pid_alive(pid) {
        return Termination::Gone { needed: Step::Already };
    }
    // Every signal's own error is kept, and the SECOND wait decides: the old
    // `let _ = wait_pid_gone(...)` turned "still alive after SIGKILL" into
    // `Ok(())` — the swallowed grace expiry §9 asks us to record.
    let mut complaints: Vec<String> = Vec::new();
    if let Err(error) = signal(pid, Signal::Term) {
        complaints.push(format!("SIGTERM: {error}"));
    }
    if wait_pid_gone(pid, grace) {
        return Termination::Gone { needed: Step::Grace };
    }
    if let Err(error) = signal(pid, Signal::Kill) {
        complaints.push(format!("SIGKILL: {error}"));
    }
    if wait_pid_gone(pid, grace) {
        return Termination::Gone { needed: Step::Kill };
    }
    if complaints.is_empty() {
        complaints.push("still alive after SIGTERM and SIGKILL, a grace each".to_string());
    }
    Termination::Survived {
        pid,
        detail: complaints.join("; "),
    }
}

/// What a teardown FOUND when it finished — the report §9 asks for. The walk
/// itself is normal (a child that needs SIGKILL is a report, not a failure);
/// what could not be established is data here, never an `Ok` that implies
/// "gone".
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Termination {
    /// The process is gone, and how far the walk had to go to learn that:
    /// which class of rung finished it (each grace expiry recorded in the
    /// rung that needed it, not swallowed).
    Gone { needed: Step },
    /// Still alive after the whole walk — the stop may NOT declare success.
    /// `detail` carries what the signals themselves said: a `kill` that
    /// failed (EPERM, ESRCH) used to be swallowed by `let _ =`.
    Survived { pid: u32, detail: String },
    /// Nothing could be established (an io error on the walk, or a pid this
    /// crate refuses to signal at all): the caller probes the port and the
    /// state reports what remains unknown.
    Unknown { detail: String },
}

/// Which class of rung of the walk finished it: `Grace` covers both grace
/// rungs (gone on stdin EOF, or gone within the grace after SIGTERM) — the
/// question `Kill` answers separately is whether SIGKILL was needed at all.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// No push was needed: it had already exited when the walk began.
    Already,
    /// Gone within a grace rung — no SIGKILL was required.
    Grace,
    /// SIGKILL finished it: both earlier rungs were spent and are recorded
    /// as the time they cost, not as a failure.
    Kill,
}

enum Signal {
    Term,
    Kill,
}

fn signal(pid: u32, which: Signal) -> io::Result<()> {
    #[cfg(unix)]
    {
        let number = match which {
            Signal::Term => libc::SIGTERM,
            Signal::Kill => libc::SIGKILL,
        };
        // The pid, not the group: this one came out of a file. The result is
        // returned now — a `kill` that failed is reported, never ignored.
        if unsafe { libc::kill(pid as i32, number) } == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
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
            return Err(io::Error::last_os_error());
        }
        let done = unsafe { TerminateProcess(handle, 1) };
        unsafe {
            CloseHandle(handle);
        }
        if done == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
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
fn signal_group(pid: u32, signal: i32) -> io::Result<()> {
    // The child leads its own group (`process_group(0)`), so the group id is its
    // pid and a negative pid addresses the group.
    if unsafe { libc::kill(-(pid as i32), signal) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// A child that fills its stderr pipe blocks forever mid-generation, so the
/// pipe is drained. Keeping the tail is what lets the UI say why it died, and
/// watching for the release line here is how a model unload becomes an event:
/// the drain sees every line the moment the server writes it, so no release
/// can fall between polls.
fn drain_stderr(
    stderr: Option<std::process::ChildStderr>,
    releases: Arc<AtomicU64>,
    residency: Residency,
) -> Arc<Mutex<VecDeque<String>>> {
    let tail = Arc::new(Mutex::new(VecDeque::new()));
    let Some(stderr) = stderr else {
        return tail;
    };
    let sink = Arc::clone(&tail);
    std::thread::spawn(move || {
        // A pipe of ours is what makes the residency knowable: this child is
        // loading (or has already loaded) its model and no line has announced
        // a release, so the model is in memory until one does. A server whose
        // pipe we do not hold never reaches this line, which is exactly how
        // its residency stays unknown instead of defaulting to "loaded".
        residency.set(RESIDENCY_IN_MEMORY);
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.contains(MODEL_RELEASED_LINE) {
                releases.fetch_add(1, Ordering::Relaxed);
                residency.set(RESIDENCY_RELEASED);
            } else if line.contains(MODEL_RELOADED_LINE) {
                residency.set(RESIDENCY_IN_MEMORY);
            }
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
        // is touched, and the refusal is reported as the unknown it is —
        // never as "gone".
        match terminate_pid(0, Duration::from_millis(10)) {
            Termination::Unknown { detail } => assert!(detail.contains("pid 0"), "{detail}"),
            other => panic!("pid 0 was not refused: {other:?}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_release_announcement_on_stderr_bumps_the_counter() {
        // A real child, a real pipe: the drain must turn the server's own
        // announcement into an event. The child prints the exact line b10950
        // prints and stays alive, so the pipe stays open the way a serving
        // server's does.
        let releases = Arc::new(AtomicU64::new(0));
        let residency = Residency::new();
        let mut child = ChildHandle::spawn(
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                "printf '%s\\n' '0.12.154.170 I srv  handle_sleep: server is entering sleeping state' >&2; sleep 30"
                    .into(),
            ],
            None,
            Arc::clone(&releases),
            residency.clone(),
        )
        .expect("spawn the announcing child");
        let deadline = Instant::now() + Duration::from_secs(5);
        while releases.load(Ordering::Relaxed) == 0 {
            assert!(
                Instant::now() < deadline,
                "the drain never turned the server's announcement into an event"
            );
            std::thread::sleep(WAIT_POLL);
        }
        assert_eq!(
            residency.asleep(),
            Some(true),
            "the release line must make the model asleep, not just count"
        );
        assert!(matches!(child.try_wait(), Ok(None)), "the child must still be running");
    }

    #[cfg(unix)]
    #[test]
    fn stderr_that_announces_nothing_moves_no_counter() {
        let releases = Arc::new(AtomicU64::new(0));
        let residency = Residency::new();
        let mut child = ChildHandle::spawn(
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                "printf '%s\\n' 'I srv  handle_sleep: server is exiting sleeping state' >&2; sleep 30"
                    .into(),
            ],
            None,
            Arc::clone(&releases),
            residency.clone(),
        )
        .expect("spawn the quiet child");
        std::thread::sleep(Duration::from_millis(300));
        assert_eq!(
            releases.load(Ordering::Relaxed),
            0,
            "a non-release line (here: the wake-up) counted as a release"
        );
        assert_eq!(
            residency.asleep(),
            Some(false),
            "the reload line says the model is back, which is not a release"
        );
        assert!(matches!(child.try_wait(), Ok(None)));
    }

    #[cfg(unix)]
    #[test]
    fn the_reload_line_brings_the_model_back() {
        // The two lines move one fact in opposite directions. A drain that
        // watched only the release would leave the page saying "asleep" for the
        // rest of the run, while the model was back in memory the whole time.
        let releases = Arc::new(AtomicU64::new(0));
        let residency = Residency::new();
        let mut child = ChildHandle::spawn(
            Path::new("/bin/sh"),
            &[
                "-c".into(),
                "printf '%s\\n' 'I srv  handle_sleep: server is entering sleeping state' >&2; sleep 1; printf '%s\\n' 'I srv  handle_sleep: server is exiting sleeping state' >&2; sleep 30"
                    .into(),
            ],
            None,
            Arc::clone(&releases),
            residency.clone(),
        )
        .expect("spawn the sleeping-then-waking child");
        let deadline = Instant::now() + Duration::from_secs(5);
        while residency.asleep() != Some(true) {
            assert!(
                Instant::now() < deadline,
                "the release line never made the model asleep"
            );
            std::thread::sleep(WAIT_POLL);
        }
        let deadline = Instant::now() + Duration::from_secs(5);
        while residency.asleep() != Some(false) {
            assert!(
                Instant::now() < deadline,
                "the reload line never brought the model back"
            );
            std::thread::sleep(WAIT_POLL);
        }
        assert_eq!(
            releases.load(Ordering::Relaxed),
            1,
            "the reload is not a release, so it must not bump the count"
        );
        assert!(matches!(child.try_wait(), Ok(None)));
    }

    #[test]
    fn a_pipe_we_do_not_hold_gives_no_answer_about_the_model() {
        // The adopted server's shape: `ChildHandle` is never made for a server
        // reused from an earlier run, so the drain is handed nothing and no
        // announcement can ever arrive. The answer must stay unknown — a
        // defaulted bit would claim the model is in memory on no evidence.
        let residency = Residency::new();
        let _tail = drain_stderr(None, Arc::new(AtomicU64::new(0)), residency.clone());
        assert_eq!(
            residency.asleep(),
            None,
            "a server whose stderr we do not hold must be unknown, not assumed loaded"
        );
    }

    #[cfg(windows)]
    #[test]
    fn dropping_the_job_ends_the_child_it_confined() {
        // The backstop itself, on the only OS that has it: a force-quit runs
        // no destructors, so the thing that kills the server then is the OS
        // closing the job's last handle with this process. The stand-in is
        // ping itself — the process watched IS the process confined, so an
        // escaped grandchild cannot fake a pass — pinging for ~29 seconds;
        // the job must end it within five. Spawned directly, not through
        // `ChildHandle`, so the only mechanism in play is the job —
        // `ChildHandle`'s own Drop would confound it.
        use std::os::windows::io::AsRawHandle;
        let mut child = std::process::Command::new("ping")
            .args(["-n", "30", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn the stand-in");
        // A confine that fails must kill the stand-in before failing this
        // test, not leak it behind an unwinding expect.
        let job = match job::confine(child.as_raw_handle()) {
            Some(job) => job,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("the job would not take the stand-in");
            }
        };
        assert!(
            matches!(child.try_wait(), Ok(None)),
            "confining must not kill the child"
        );
        drop(job);
        // Only an exit — `Ok(Some(_))` — is the proof the job did this; a
        // try_wait error is a failure of the watch, never a death.
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut ended = false;
        let mut watch_error = None;
        while Instant::now() < deadline {
            match child.try_wait() {
                Ok(None) => std::thread::sleep(WAIT_POLL),
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
        if let Some(error) = watch_error {
            // The verdict is the watch failure; the cleanup behind it is
            // bounded all the same — this path must fail on `error`, never
            // hang on the stand-in's natural 29 seconds.
            let _ = kill_and_reap(&mut child, Duration::from_secs(5));
            panic!("polling the confined stand-in failed: {error}");
        }
        if !ended {
            match kill_and_reap(&mut child, Duration::from_secs(5)) {
                Ok(Some(_)) => {}
                Ok(None) => panic!("the killed stand-in never exited within five seconds"),
                Err(error) => panic!("cleaning up the confined stand-in failed: {error}"),
            }
        }
        let reaped = child.wait().expect("reaping the confined stand-in failed");
        assert!(
            ended,
            "closing the job's last handle must end the confined child (reaped: {reaped:?})"
        );
    }

    /// Kill the stand-in and reap it, bounded: cleanup may neither swallow
    /// a failed kill nor wait out the stand-in's natural 29 seconds.
    /// `Ok(None)` means the bound passed with the child still running.
    #[cfg(windows)]
    fn kill_and_reap(
        child: &mut std::process::Child,
        bound: Duration,
    ) -> io::Result<Option<ExitStatus>> {
        child.kill()?;
        let deadline = Instant::now() + bound;
        loop {
            match child.try_wait()? {
                Some(status) => return Ok(Some(status)),
                None if Instant::now() >= deadline => return Ok(None),
                None => std::thread::sleep(WAIT_POLL),
            }
        }
    }
}
