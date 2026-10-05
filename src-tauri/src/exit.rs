//! The app's exit, on one deadline.
//!
//! The engine is stopped first, so a slow exit is never an exit that orphans
//! the model server; then the rest of the cleanup, every wait of it bounded
//! on its own (`kalsa-door` gives its threads two seconds, the supervisor's
//! stop walk its graces, the pairing wake a few tries). A watchdog armed
//! before the first step is the backstop the whole thing answers to: at the
//! deadline it makes sure the engine is gone — killed through the identity
//! the supervisor still holds, never by name — says one line, and ends the
//! process.
//!
//! The kill runs FIRST: the note and the exit behind it must never be able
//! to wait on anything, because the alternative at the deadline is a
//! process that never ends, still holding the instance lock the next launch
//! needs. `std::process::exit` runs no destructors, which is the point.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// The whole exit's deadline. Chosen against the pieces it covers, all of
/// them at once: the supervisor's stop walk is two stop graces (5 s), the
/// reap behind its kill is bounded at 3 s, its port probe is bounded at 3 s
/// on Windows (0.5 s elsewhere), the door's wake tries and bounded join cost
/// under 4 s, the pairing wake under 2 s. The worst honest sequence is under
/// fourteen seconds, so fifteen lets every step of a slow exit finish and
/// still cuts one that overruns — far from the minutes a stuck handler used
/// to cost, and not an exit a person would reach for the force-quit over. A
/// thread that has not stopped by then is one the process will not be held
/// for.
pub(crate) const DEADLINE: Duration = Duration::from_secs(15);

/// How long each rung of the last-resort kill waits. It is spent after the
/// deadline has already passed, so it is short: two rungs of this is the
/// worst case, and SIGKILL or TerminateProcess cannot be refused.
pub(crate) const KILL_GRACE: Duration = Duration::from_millis(250);

/// The armed deadline.
pub(crate) struct Deadline {
    done: Arc<AtomicBool>,
    /// The step the cleanup is inside, for the deadline's one warning.
    pending: Arc<Mutex<&'static str>>,
    watchdog: Option<JoinHandle<()>>,
}

impl Deadline {
    /// Names the step the cleanup is inside now. Read only if the deadline
    /// arrives, so the name says what was still running, not where the
    /// cleanup got to in the normal case.
    pub(crate) fn stage(&self, what: &'static str) {
        *self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = what;
    }

    /// The cleanup came back inside the deadline: the watchdog stands down
    /// and is joined — it has either returned already or will unpark and
    /// return now.
    pub(crate) fn finished(self) {
        self.done.store(true, Ordering::SeqCst);
        if let Some(watchdog) = self.watchdog {
            watchdog.thread().unpark();
            let _ = watchdog.join();
        }
    }

    /// The step the cleanup would be named for at the deadline. Tests only.
    #[cfg(test)]
    pub(crate) fn pending(&self) -> &'static str {
        *self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Arms the deadline, which `first` names until [`Deadline::stage`] says
/// otherwise. `engine` kills the engine at the deadline and reports what it
/// did; `note` says the deadline's one line and must never block (the
/// production note takes the sink's mutex with `try_lock`); `exit` is the
/// process exit itself — handed the step that was still pending, and a
/// seam, so a test can watch the deadline fire without ending the test
/// process. A deadline that cannot be armed is declared, not silent: the
/// exit then runs without its backstop.
pub(crate) fn arm(
    deadline: Duration,
    first: &'static str,
    engine: impl Fn() -> String + Send + 'static,
    note: impl Fn(&str) + Send + 'static,
    exit: impl Fn(i32, &'static str) + Send + 'static,
) -> Deadline {
    let done = Arc::new(AtomicBool::new(false));
    let pending = Arc::new(Mutex::new(first));
    let flag = Arc::clone(&done);
    let stage = Arc::clone(&pending);
    let spawned = std::thread::Builder::new()
        .name("kalsa-exit-watchdog".into())
        .spawn(move || {
            std::thread::park_timeout(deadline);
            if flag.load(Ordering::SeqCst) {
                return;
            }
            let stage = *stage
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            // The kill is first: everything behind it — the note, the exit —
            // must never be able to become the thing that waits.
            let did = engine();
            note(&format!(
                "the exit did not finish within {deadline:?}: still stopping {stage}; \
                 {did}; the process leaves now"
            ));
            exit(0, stage);
        });
    let watchdog = match spawned {
        Ok(watchdog) => Some(watchdog),
        Err(error) => {
            log::warn!(
                "the exit watchdog could not start: {error}; a cleanup past its \
                 deadline will not be cut"
            );
            None
        }
    };
    Deadline {
        done,
        pending,
        watchdog,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    /// What the watchdog did, in order: the kill first, then the note, then
    /// the exit — the order is the guarantee, not the events.
    #[derive(Debug, PartialEq)]
    enum Step {
        Killed,
        Noted(String),
        Exited(i32, &'static str),
    }

    /// The deadline fires: the engine is killed before anything is said or
    /// done, and the process exits last, through the seam the test holds.
    #[test]
    fn the_deadline_kills_before_it_says_or_leaves() {
        let (steps, seen) = mpsc::channel();
        let killed = steps.clone();
        let noted = steps.clone();
        let deadline = arm(
            Duration::from_millis(50),
            "the door",
            move || {
                let _ = killed.send(Step::Killed);
                "the kill's own report".to_string()
            },
            move |line| {
                let _ = noted.send(Step::Noted(line.to_string()));
            },
            move |code, stage| {
                let _ = steps.send(Step::Exited(code, stage));
            },
        );
        // Dropped, not finished: the deadline is the thing under test.
        drop(deadline);
        assert_eq!(
            seen.recv_timeout(Duration::from_secs(2)).ok(),
            Some(Step::Killed),
            "the kill is first: nothing behind it may wait"
        );
        assert_eq!(
            seen.recv_timeout(Duration::from_secs(2)).ok(),
            Some(Step::Noted(
                "the exit did not finish within 50ms: still stopping the door; the kill's own \
                 report; the process leaves now"
                    .to_string()
            )),
            "the note is second, carrying the deadline's facts"
        );
        assert_eq!(
            seen.recv_timeout(Duration::from_secs(2)).ok(),
            Some(Step::Exited(0, "the door")),
            "the exit is last, and a forced exit is still a clean one"
        );
    }

    /// A cleanup that finished inside the deadline stands the watchdog down:
    /// nothing is killed and nothing exits after it.
    #[test]
    fn a_cleanup_inside_the_deadline_stands_the_watchdog_down() {
        let (exited, watched) = mpsc::channel();
        let (noted, notes) = mpsc::channel();
        let deadline = arm(
            Duration::from_millis(80),
            "the engine",
            || "killed".to_string(),
            move |line| {
                let _ = noted.send(line.to_string());
            },
            move |code, _stage| {
                let _ = exited.send(code);
            },
        );
        deadline.stage("the door");
        assert_eq!(deadline.pending(), "the door", "the stage names the step");
        deadline.finished();
        assert!(
            watched.recv_timeout(Duration::from_millis(400)).is_err(),
            "the watchdog fired after the cleanup finished"
        );
        assert!(
            notes.recv_timeout(Duration::from_millis(400)).is_err(),
            "the watchdog spoke after the cleanup finished"
        );
    }
}
