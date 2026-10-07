//! The checkpoint and the resume: a run that dies mid-tune keeps every
//! lifetime it finished — the marker on disk holds them — and the next
//! start measures only what is missing, interruption after interruption,
//! until the verdict replaces the marker.

use std::cell::{Cell, RefCell};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::*;
use crate::record::{cut_marker, load, save, save_marker, Marker, Record};

/// A scratch directory that cleans itself up even when the test panics —
/// which, here, is the whole point: the panics stand in for a process
/// dying mid-tune.
struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-tune-checkpoint-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        Self(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl std::ops::Deref for Scratch {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.0
    }
}

const DIGEST: &str = "abc123";
const FP: &str = "kalsa-tune fp v4|checkpoint";

/// The marker a checkpoint writes: the trials as they stand, undecided —
/// no winner has been chosen yet, and the file says so by holding none.
fn checkpoint(dir: &Path, trials: &[(Candidate, Kept)]) -> Record {
    let record = Record {
        fingerprint: FP.to_string(),
        winner: None,
        trials: trials.to_vec(),
    };
    save_marker(dir, DIGEST, &record, Marker::Interrupted).expect("the checkpoint lands");
    record
}

/// A window that closes after the second lifetime loses nothing: the
/// checkpoint on disk holds the two, the next start measures only the
/// third, and a SECOND interruption at the very next lifetime keeps
/// going the same way — three attempts, three lifetimes, no re-tuning
/// from zero and no early verdict. The final save replaces the marker.
#[test]
fn a_tune_that_dies_keeps_every_lifetime_it_finished() {
    let dir = Scratch::new("die");
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];

    // Attempt one: two lifetimes land on disk, then the process dies.
    let writes = Cell::new(0usize);
    let died = catch_unwind(AssertUnwindSafe(|| {
        tune(
            &shapes,
            false,
            &[],
            Duration::from_secs(3600),
            || Duration::ZERO,
            &mut |_| {},
            &mut |trials| {
                checkpoint(&dir, trials);
                writes.set(writes.get() + 1);
                if writes.get() == 2 {
                    panic!("the window closed mid-tune");
                }
            },
            |_, _| first(100.0, 50.0),
            |_, _| panic!("no drafter, no drafted lifetime"),
        )
    }));
    assert!(died.is_err(), "the process died after the second lifetime");
    assert_eq!(writes.get(), 2, "one write per finished lifetime");
    assert!(
        load(&dir, DIGEST, FP).is_none(),
        "a checkpoint is not a verdict"
    );
    let (cause, held) = cut_marker(&dir, DIGEST, FP).expect("the checkpoint is on disk");
    assert_eq!(cause, Marker::Interrupted, "the file reads what happened");
    assert_eq!(
        held.trials.len(),
        2,
        "two lifetimes held, the third never ran"
    );
    assert!(held.winner.is_none(), "a checkpoint decides nothing");

    // Attempt two: only the missing lifetime runs — and dies right after
    // its own checkpoint, the second interruption keeping the progress.
    let prior = plan_prior(&held.trials, &shapes, false);
    let ran = RefCell::new(Vec::new());
    let died_again = catch_unwind(AssertUnwindSafe(|| {
        tune(
            &shapes,
            false,
            &prior,
            Duration::from_secs(3600),
            || Duration::ZERO,
            &mut |_| {},
            &mut |trials| {
                checkpoint(&dir, trials);
                panic!("closed again, one lifetime later");
            },
            |shape, _| {
                ran.borrow_mut().push(*shape);
                first(100.0, 50.0)
            },
            |_, _| panic!("no drafter, no drafted lifetime"),
        )
    }));
    assert!(died_again.is_err(), "the second interruption");
    assert_eq!(
        *ran.borrow(),
        vec![cpu(22)],
        "the resume measures only the lifetime the checkpoint never held"
    );
    let (cause, held) = cut_marker(&dir, DIGEST, FP).expect("still a checkpoint");
    assert_eq!(cause, Marker::Interrupted);
    assert_eq!(held.trials.len(), 3, "every lifetime so far is kept");

    // Attempt three: nothing is left to measure, the run completes, and
    // its verdict replaces the checkpoint marker.
    let prior = plan_prior(&held.trials, &shapes, false);
    let tuned = tune(
        &shapes,
        false,
        &prior,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_| {},
        &mut |_| panic!("nothing is new: no write"),
        |_, _| panic!("every first lifetime is answered"),
        |_, _| panic!("no drafter, no drafted lifetime"),
    );
    assert!(
        tuned.complete && !tuned.cut,
        "everything ran, over three attempts"
    );
    assert_eq!(tuned.trials.len(), 3, "{:?}", tuned.trials);
    assert!(tuned.winner.is_some(), "the three replies decide");
    save(
        &dir,
        DIGEST,
        &Record {
            fingerprint: FP.to_string(),
            winner: tuned.winner,
            trials: tuned.trials,
        },
    )
    .expect("the verdict saves");
    assert!(
        load(&dir, DIGEST, FP).is_some(),
        "the verdict replaces the marker"
    );
    assert!(cut_marker(&dir, DIGEST, FP).is_none());
}

/// The write cadence: one per finished lifetime, whatever the reports do.
/// Seven reports for three lifetimes (three starts, three closes, the
/// final word), three writes — never a write per progress tick.
#[test]
fn a_checkpoint_writes_once_per_lifetime_and_never_per_report() {
    let dir = Scratch::new("cadence");
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
    let reports = Cell::new(0usize);
    let writes = Cell::new(0usize);
    let tuned = tune(
        &shapes,
        false,
        &[],
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_| reports.set(reports.get() + 1),
        &mut |trials| {
            checkpoint(&dir, trials);
            writes.set(writes.get() + 1);
        },
        |_, _| first(100.0, 50.0),
        |_, _| panic!("no drafter, no drafted lifetime"),
    );
    assert!(tuned.complete && !tuned.cut);
    assert_eq!(writes.get(), 3, "one write per finished lifetime");
    assert_eq!(
        reports.get(),
        7,
        "three starts, three closes, the final word"
    );
    assert!(
        writes.get() < reports.get(),
        "the disk never hears the reports, only the lifetimes"
    );
}
