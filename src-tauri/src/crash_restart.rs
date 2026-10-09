//! Whether an unexpected engine exit earns an automatic restart. Kalsa was on,
//! the engine died on its own, and the owner gets one automatic restart for
//! it. The allowance comes back only once the restarted engine has run for
//! `STABLE_RUN` without a break, so a crash loop stops at its second crash
//! however slow it is. An out-of-memory death, a Turn off and quit never
//! restart.

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use kalsa_supervisor::{Failure, ServerState};

use crate::oom;

/// How long the restarted engine must run, without a break, before its
/// allowance comes back. Counted from its first Running, not from the crash.
pub(crate) const STABLE_RUN: Duration = Duration::from_secs(600);

#[derive(Default)]
pub(crate) struct CrashRestart {
    book: Mutex<Book>,
}

#[derive(Default)]
struct Book {
    /// The engine has been seen running since the last Turn off or quit.
    on: bool,
    /// A Turn off or quit has not been followed by a walk yet. Running seen
    /// meanwhile (the chat save before a stop) must not arm.
    held: bool,
    /// The automatic restart has been taken and its allowance not yet earned
    /// back by `STABLE_RUN` of running.
    spent: bool,
    /// Since when the engine has run without a break.
    running_since: Option<Instant>,
}

impl CrashRestart {
    /// A Turn off or quit. A new session after it starts with its allowance.
    pub(crate) fn disarm(&self) {
        *self.lock() = Book {
            held: true,
            ..Book::default()
        };
    }

    /// A walk is starting an engine: Running from now on means it is on.
    pub(crate) fn walk_started(&self) {
        self.lock().held = false;
    }

    /// Called on every observation of the supervisor's state, under the gate
    /// a Turn off holds. `stops` is the stop generation at that moment. Returns
    /// it when this observation earns the restart, so the walk can be vetoed
    /// by a Turn off that lands after the decision.
    pub(crate) fn observe(
        &self,
        state: &ServerState,
        leaving: bool,
        now: Instant,
        stops: u64,
    ) -> Option<u64> {
        let mut book = self.lock();
        match state {
            ServerState::Running { .. } => {
                if !book.held {
                    book.on = true;
                }
                let since = *book.running_since.get_or_insert(now);
                if now.saturating_duration_since(since) >= STABLE_RUN {
                    book.spent = false;
                }
                None
            }
            ServerState::Failed {
                reason: Failure::ServerExited { detail, .. },
            } if !leaving => {
                book.running_since = None;
                let on = std::mem::take(&mut book.on);
                if !on || book.spent || oom::is_out_of_memory(detail) {
                    return None;
                }
                book.spent = true;
                Some(stops)
            }
            _ => {
                book.running_since = None;
                None
            }
        }
    }

    fn lock(&self) -> MutexGuard<'_, Book> {
        self.book.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: Duration = Duration::from_secs(60);

    fn crash(detail: &str) -> ServerState {
        ServerState::Failed {
            reason: Failure::ServerExited {
                detail: detail.to_string(),
                exit_code: None,
                exit_signal: Some(9),
            },
        }
    }

    fn running() -> ServerState {
        ServerState::Running { pid: 1, port: 1 }
    }

    #[test]
    fn an_unexpected_exit_while_on_restarts_once() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        assert_eq!(restart.observe(&crash(""), false, base, 0), Some(0));
        restart.observe(&running(), false, base + MINUTE, 0);
        assert_eq!(restart.observe(&crash(""), false, base + MINUTE, 0), None);
    }

    #[test]
    fn a_slow_crash_loop_stops_at_its_second_crash() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        assert!(restart.observe(&crash(""), false, base, 0).is_some());
        for minute in 1..=9u32 {
            restart.observe(&running(), false, base + minute * MINUTE, 0);
        }
        assert_eq!(
            restart.observe(&crash(""), false, base + 9 * MINUTE, 0),
            None
        );
    }

    #[test]
    fn the_allowance_returns_after_stable_run_from_the_first_running() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        assert!(restart.observe(&crash(""), false, base, 0).is_some());
        restart.observe(&running(), false, base + 5 * MINUTE, 0);
        restart.observe(&running(), false, base + 15 * MINUTE, 0);
        let crash_at = base + 15 * MINUTE;
        assert!(restart.observe(&crash(""), false, crash_at, 0).is_some());
    }

    #[test]
    fn the_stable_run_counts_from_running_not_from_the_crash() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        assert!(restart.observe(&crash(""), false, base, 0).is_some());
        restart.observe(&running(), false, base + 5 * MINUTE, 0);
        restart.observe(&running(), false, base + 14 * MINUTE, 0);
        assert_eq!(
            restart.observe(&crash(""), false, base + 14 * MINUTE, 0),
            None
        );
    }

    #[test]
    fn a_user_stop_earns_no_restart() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        restart.disarm();
        assert_eq!(restart.observe(&crash(""), false, base, 1), None);
    }

    #[test]
    fn running_seen_during_the_save_before_a_stop_does_not_arm() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        restart.disarm();
        restart.observe(&running(), false, base + Duration::from_secs(1), 1);
        let crash_at = base + Duration::from_secs(2);
        assert_eq!(restart.observe(&crash(""), false, crash_at, 1), None);
    }

    #[test]
    fn a_walk_after_a_stop_arms_again() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        restart.disarm();
        restart.walk_started();
        restart.observe(&running(), false, base, 1);
        assert_eq!(restart.observe(&crash(""), false, base, 1), Some(1));
    }

    #[test]
    fn a_sleeping_engine_is_still_on() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        restart.observe(&running(), false, base, 0);
        assert_eq!(restart.observe(&crash(""), false, base, 0), Some(0));
    }

    #[test]
    fn a_start_that_never_came_up_earns_no_restart() {
        let restart = CrashRestart::default();
        assert_eq!(restart.observe(&crash(""), false, Instant::now(), 0), None);
    }

    #[test]
    fn leaving_earns_no_restart() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        assert_eq!(restart.observe(&crash(""), true, base, 0), None);
    }

    #[test]
    fn other_failures_earn_no_restart() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        let not_started = ServerState::Failed {
            reason: Failure::ServerNotStarted {
                detail: String::new(),
            },
        };
        assert_eq!(restart.observe(&not_started, false, base, 0), None);
    }

    #[test]
    fn an_out_of_memory_exit_stops_as_today() {
        let restart = CrashRestart::default();
        let base = Instant::now();
        restart.observe(&running(), false, base, 0);
        assert_eq!(
            restart.observe(&crash("VK_ERROR_OUT_OF_DEVICE_MEMORY"), false, base, 0),
            None
        );
    }
}
