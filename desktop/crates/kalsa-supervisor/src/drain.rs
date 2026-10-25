//! The write policy for a stop in flight — `ServerState::Stopping`.
//!
//! A stop used to be invisible: the caller queued `Command::Stop`, the state
//! kept reading `Running` for up to two stop graces plus the reap, and every
//! `brain_state` poll landing in that window entered the Running arm and
//! raised again the door the stop had lowered. The poll is the reconciler, so
//! narrowing the window did not close it — the window is now an explicit
//! state, and this module is the rule that keeps it true:
//!
//! - while the state reads `Stopping`, the only writes that land are the
//!   drain's OWN ENDS: `Stopped`, or the failed-to-stop state
//!   (`Failure::StopUnconfirmed`) that reports a drain whose end could not
//!   be proved — without the second end a survivor would have no honest way
//!   to reach the state at all, and this guard would render it invisible.
//!   A start finishing late writes nothing; any other failure observed while
//!   the teardown runs writes nothing. No other actor overwrites a drain it
//!   did not start.
//! - a drain is declared by its CALLER, before the command that performs it
//!   is queued — that ordering is the window above, closed from its first
//!   instant — and the declaration is taken back when the command never left:
//!   `send` can only fail with no worker to receive it, and the app's exit
//!   handler runs `shutdown` on `ExitRequested` AND on `Exit`, so the second
//!   call sends to a worker the first one already joined. A declaration
//!   nobody performs is not a state.
//!
//! `Stopped` is named nowhere here: the rollback writes back the state it
//! read, and only while the state still reads `Stopping` — a drain that ended
//! in the meantime keeps its end.
//!
//! CLOSED, AS A READ — `Stopping` IN PERPETUITY. If the worker thread DIES
//! (a panic) after the drain was declared and before it wrote its end, the
//! WRITING path really is stuck: the guard takes only the drain's own ends,
//! the command channel died with the thread, and each later
//! `stop()`/`shutdown()` re-declares, fails to send, and `restore`s the
//! `Stopping` it read — so nothing on that path can ever finish the drain,
//! and until it was reported the app said "it is turning off" forever under
//! a disabled button. What closes it is not a write: `Supervisor::state()`
//! checks the worker (`JoinHandle::is_finished`) and, while the state reads
//! `Stopping` with no worker left to perform it, ANSWERS the failed-to-stop
//! state with the measures that side actually has — the dead worker, and no
//! port, because nothing is left that could ask. No guard change, no
//! invented measurement, no state written behind this module's back. Scope
//! kept: it needs a worker gone MID-DRAIN (a worker that dies at any other
//! moment leaves the state it already wrote — the same wedge `Running` used
//! to be before this module, not a regression); and `Watch::state()`, the
//! ticker's view, carries no worker handle by design, so it goes on reading
//! `Stopping` there — nothing in the tick acts on `Stopping`, declared as a
//! stale read, not a state.

use std::sync::Mutex;

use crate::supervisor::{Failure, ServerState};

/// Whether `next` may END a drain: `Stopped` (absence proved) or the
/// failed-to-stop state carrying its measures (`presence::settle` answered
/// `stopped: false`). Nothing else — a start finishing late, a crash the
/// watcher saw — may be written over a drain, and every further widening is
/// a guard that stops defending the state it exists for.
fn is_drain_end(next: &ServerState) -> bool {
    matches!(
        next,
        ServerState::Stopped | ServerState::Failed {
            reason: Failure::StopUnconfirmed { .. }
        }
    )
}

/// The one write to the state. While it reads `Stopping` it refuses every
/// outcome that is not one of the drain's own ends (`is_drain_end`);
/// otherwise it writes `next` as asked. A lock poisoned by a panic writes
/// nothing — the reader answers `Stopped` from `unwrap_or` and the app
/// decides what a poisoned supervisor means.
pub(crate) fn set(state: &Mutex<ServerState>, next: ServerState) {
    let Ok(mut current) = state.lock() else {
        return;
    };
    if matches!(*current, ServerState::Stopping) && !is_drain_end(&next) {
        return;
    }
    *current = next;
}

/// Declares a drain over whatever the state reads, and hands back what it
/// replaced so the caller can take the declaration back if its command never
/// left. `None` is a poisoned lock: nothing was declared, so there is nothing
/// to take back.
pub(crate) fn declare(state: &Mutex<ServerState>) -> Option<ServerState> {
    let mut current = state.lock().ok()?;
    let prior = current.clone();
    *current = ServerState::Stopping;
    Some(prior)
}

/// Takes a declaration back after a command that could not be queued, and
/// only if the state still reads `Stopping`: a worker that ended the drain in
/// the meantime keeps its `Stopped`, and a state somebody else moved on is
/// theirs, not ours to overwrite.
pub(crate) fn restore(state: &Mutex<ServerState>, prior: Option<ServerState>) {
    let Some(prior) = prior else {
        return;
    };
    let Ok(mut current) = state.lock() else {
        return;
    };
    if *current == ServerState::Stopping {
        *current = prior;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::supervisor::Failure;

    fn holding(state: ServerState) -> Mutex<ServerState> {
        Mutex::new(state)
    }

    fn read(state: &Mutex<ServerState>) -> ServerState {
        state.lock().expect("the test's own lock").clone()
    }

    #[test]
    fn while_a_drain_stands_only_its_ends_land() {
        // The interleaving the state exists for, one write at a time: a start
        // finishing late, a teardown that reports its failure, a restart that
        // accepted itself — none of them may be written over a drain.
        let state = holding(ServerState::Stopping);
        set(&state, ServerState::Starting);
        set(&state, ServerState::Running { pid: 1, port: 8123 });
        set(
            &state,
            ServerState::Failed {
                reason: Failure::PortTaken,
            },
        );
        assert_eq!(
            read(&state),
            ServerState::Stopping,
            "an outcome overwrote a drain in flight"
        );
        set(&state, ServerState::Stopped);
        assert_eq!(
            read(&state),
            ServerState::Stopped,
            "the drain's own end must land"
        );
    }

    #[test]
    fn the_failed_stop_is_the_drains_other_end_and_nothing_else_is() {
        // §9: a survivor must be reportable FROM a drain. The guard refuses
        // every failure but this one — take the allowance away and the
        // survivor's report is dropped, the state stays `Stopping`, and the
        // app says "turning off" forever over an engine that is alive.
        let state = holding(ServerState::Stopping);
        set(
            &state,
            ServerState::Failed {
                reason: Failure::StopUnconfirmed {
                    measures: "walk: survived; port — There".into(),
                },
            },
        );
        assert!(
            matches!(
                read(&state),
                ServerState::Failed {
                    reason: Failure::StopUnconfirmed { .. }
                }
            ),
            "the failed-to-stop could not end the drain: the guard hid a survivor"
        );
        // …and the allowance does not open for a failure that is not this one.
        let state = holding(ServerState::Stopping);
        set(
            &state,
            ServerState::Failed {
                reason: Failure::PortTaken,
            },
        );
        assert_eq!(
            read(&state),
            ServerState::Stopping,
            "some other failure ended a drain"
        );
    }

    #[test]
    fn without_a_drain_every_write_lands() {
        // The guard bites only during `Stopping`: the ordinary states keep
        // their ordinary writes, or the supervisor could not report anything.
        let state = holding(ServerState::Starting);
        set(&state, ServerState::Running { pid: 7, port: 8123 });
        assert_eq!(
            read(&state),
            ServerState::Running { pid: 7, port: 8123 },
            "the guard blocked a write outside a drain"
        );
        set(
            &state,
            ServerState::Failed {
                reason: Failure::PortTaken,
            },
        );
        assert!(matches!(read(&state), ServerState::Failed { .. }));
    }

    #[test]
    fn a_drain_is_declared_over_any_state_and_restored_to_what_it_read() {
        let state = holding(ServerState::Running { pid: 1, port: 8123 });
        let prior = declare(&state);
        assert_eq!(read(&state), ServerState::Stopping, "the drain was not declared");
        restore(&state, prior);
        assert_eq!(
            read(&state),
            ServerState::Running { pid: 1, port: 8123 },
            "the declaration did not come back"
        );
    }

    #[test]
    fn a_rollback_does_not_resurrect_a_drain_that_already_ended() {
        // The command failed to queue, but a worker had time to finish a
        // drain of its own: the rollback must not write over its `Stopped`.
        let state = holding(ServerState::Stopped);
        let prior = declare(&state);
        set(&state, ServerState::Stopped);
        restore(&state, prior);
        assert_eq!(read(&state), ServerState::Stopped, "the rollback undid a finished drain");
    }

    #[test]
    fn nothing_declared_means_nothing_to_take_back() {
        let state = holding(ServerState::Starting);
        restore(&state, None);
        assert_eq!(read(&state), ServerState::Starting, "a poisoned declaration unmade a state");
    }
}
