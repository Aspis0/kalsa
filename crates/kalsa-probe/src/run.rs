//! Asking an external program, bounded and remembered: the runner both
//! crates' WMI questions share. kalsa-runtime already depends on
//! kalsa-probe, so this adds no edge; it is one real module with two real
//! callers, not a convenience API.
//!
//! Declared: wmic's piped output encoding is unverified — no real capture
//! exists in the repo. If it were UTF-16LE, the header check downstream
//! fails and PowerShell answers, so the fallback would run even where a
//! working wmic exists: slower, never wronger.

use std::ffi::OsStr;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

/// How often a waiting child is checked; nothing rides on the exact figure.
const POLL: Duration = Duration::from_millis(50);

/// Runs `program`, answering its stdout as text only when it ran,
/// succeeded, and finished inside `deadline` — anything else (it could not
/// be spawned, exited non-zero, or outlived the deadline and was killed
/// and reaped) is "no answer", which every caller treats as absent, never
/// as data. The deadline arrives as a parameter so a test can bound a
/// child in milliseconds; the production figures are consts at the call
/// sites. The answers here are a few hundred bytes, far under any pipe
/// buffer, so a stuck producer is what the deadline is for, not
/// backpressure.
pub fn command_text<I, S>(program: &str, args: I, deadline: Duration) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut child = match Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(child) => child,
        Err(_) => return None,
    };
    // A piped stdout is owed a reader; a child we cannot read from is
    // killed and reaped, never abandoned.
    let mut stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };
    let expires = Instant::now() + deadline;
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            let mut bytes = Vec::new();
            stdout.read_to_end(&mut bytes).ok()?;
            // Lossy on purpose: the numbers are ASCII, and one non-ASCII
            // byte in a marketing name (the OEM code page) must not void
            // the whole answer.
            return status
                .success()
                .then(|| String::from_utf8_lossy(&bytes).into_owned());
        }
        if Instant::now() >= expires {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(POLL);
    }
}

/// An answer computed once per process — modulo a benign race: two threads
/// may both ask before either caches, and the cache keeps one answer — but
/// only a PRESENT one is kept: caching a failure would freeze one timeout,
/// or a WMI service not yet up at boot, into every later ask (and the app's
/// measurement record would carry it for thirty days). An absent answer is
/// returned uncached, so the next ask tries again — at full deadline cost
/// each time, both producers, up to ~2×10 s per call site: the deliberate
/// price of never caching a failure.
pub fn once_present<T>(cache: &OnceLock<T>, ask: impl Fn() -> Option<T>) -> Option<T>
where
    T: Clone,
{
    if let Some(answer) = cache.get() {
        return Some(answer.clone());
    }
    match ask() {
        Some(answer) => {
            let _ = cache.set(answer.clone());
            Some(answer)
        }
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    #[cfg(unix)]
    fn a_quick_success_answers_its_stdout() {
        assert_eq!(
            command_text("/bin/echo", &["hello"], Duration::from_secs(5)),
            Some("hello\n".to_string())
        );
    }

    #[test]
    #[cfg(unix)]
    fn a_non_success_exit_and_a_missing_program_answer_absent() {
        assert_eq!(command_text("/usr/bin/false", &[] as &[&str], Duration::from_secs(5)), None);
        assert_eq!(
            command_text("kalsa-no-such-program", &[] as &[&str], Duration::from_secs(5)),
            None
        );
    }

    #[test]
    #[cfg(unix)]
    fn a_child_that_outlives_the_deadline_is_killed_and_answered_absent() {
        // The child publishes its own pid, then becomes the sleeper the
        // runner must kill: `exec` hands the pid to sleep, so the pid file
        // names the very process the deadline is enforced on.
        let pid_file = std::env::temp_dir().join(format!("kalsa-run-pid-{}", std::process::id()));
        let script = format!("echo $$ > {}; exec sleep 5", pid_file.display());
        let started = Instant::now();
        let answer = command_text("/bin/sh", &["-c", &script], Duration::from_millis(200));
        assert!(answer.is_none(), "a stuck producer answered something");
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "the deadline was not enforced: returned after {:?}",
            started.elapsed()
        );
        let pid: i32 = std::fs::read_to_string(&pid_file)
            .expect("the child published its pid")
            .trim()
            .parse()
            .expect("a pid");
        let _ = std::fs::remove_file(&pid_file);
        // kill with signal 0 asks only "does it exist": the runner both
        // killed and REAPED the child, so the pid names nothing.
        let gone = unsafe { libc::kill(pid, 0) } == -1;
        assert!(gone, "the child (pid {pid}) survived its deadline");
    }

    #[test]
    #[cfg(unix)]
    fn a_non_ascii_byte_does_not_void_the_answer() {
        // The OEM code page, through a real child: one non-UTF-8 byte in a
        // name must not lose the line that carries it.
        use std::os::unix::ffi::OsStringExt;
        let line = std::ffi::OsString::from_vec(b"3221225472  NVIDIA \xF0".to_vec());
        assert_eq!(
            command_text("/bin/echo", &[line], Duration::from_secs(5)),
            Some("3221225472  NVIDIA \u{FFFD}\n".to_string())
        );
    }

    #[test]
    fn only_a_present_answer_is_cached() {
        // Fresh caches per half: the caller owns the cache, so no two asks
        // share one by accident.
        let absent_cache: OnceLock<u8> = OnceLock::new();
        let absent_asks = Cell::new(0);
        let absent = || {
            absent_asks.set(absent_asks.get() + 1);
            None::<u8>
        };
        assert_eq!(once_present(&absent_cache, absent), None);
        assert_eq!(once_present(&absent_cache, absent), None);
        assert_eq!(
            absent_asks.get(),
            2,
            "an absent answer must not be cached: the next ask tries again"
        );

        let present_cache = OnceLock::new();
        let present_asks = Cell::new(0);
        let present = || {
            present_asks.set(present_asks.get() + 1);
            Some(7u8)
        };
        assert_eq!(once_present(&present_cache, present), Some(7));
        assert_eq!(once_present(&present_cache, present), Some(7));
        assert_eq!(present_asks.get(), 1, "a present answer is asked for once");
    }
}
