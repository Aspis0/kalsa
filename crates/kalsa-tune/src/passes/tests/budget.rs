//! The budget's cuts: what a started lifetime keeps, what a shape that
//! never began leaves behind, and when the record may still be written.

use std::cell::RefCell;
use std::time::Duration;

use super::*;

/// The budget cut in pass one: the shape that never began is a hole, so
/// the caller must withhold the record — and the shapes that did begin
/// are kept as cut, with their prefill numbers, not lost.
#[test]
fn a_shape_cut_before_its_prefill_leaves_the_picture_incomplete() {
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
    let clock = RefCell::new(0u32);
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(60),
        || {
            let mut tick = clock.borrow_mut();
            *tick += 1;
            if *tick <= 2 {
                Duration::ZERO
            } else {
                Duration::from_secs(60)
            }
        },
        &mut |done, planned| seen.borrow_mut().push((done, planned)),
        |_, _| Ok(vec![100.0]),
        |trial, _| {
            decodes.borrow_mut().push(trial.draft);
            Ok(vec![50.0])
        },
    );
    assert!(!tuned.complete, "the third shape never ran");
    assert!(
        tuned.cut,
        "the shapes that began had their sweeps cut too: {:?}",
        tuned.trials
    );
    assert!(
        decodes.borrow().is_empty(),
        "the budget was spent before any sweep: {:?}",
        decodes.borrow()
    );
    for shape in [gpu(), cpu(16)] {
        assert!(
            tuned
                .trials
                .iter()
                .any(|(candidate, kept)| *candidate == shape
                    && matches!(
                        kept,
                        Kept::PromptOnly {
                            skipped: Skip::Cut,
                            ..
                        }
                    )),
            "a cut shape keeps its prefill number: {:?}",
            tuned.trials
        );
    }
    assert!(
        !tuned
            .trials
            .iter()
            .any(|(candidate, _)| *candidate == cpu(22)),
        "the shape that never began is absent, not invented"
    );
    assert_eq!(
        seen.borrow().last(),
        Some(&(2, 2)),
        "the plan is finished at the cut: {:?}",
        seen.borrow()
    );
}

/// The budget cut between the passes: every shape ran its prefill, so
/// every shape has an entry — but the sweeps never began, and the cut is
/// the fact the caller needs to let the next start try again.
#[test]
fn a_cut_between_the_passes_leaves_every_shape_with_an_entry() {
    let shapes = vec![on(gpu()), on(cpu(16))];
    let clock = RefCell::new(0u32);
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(60),
        || {
            let mut tick = clock.borrow_mut();
            *tick += 1;
            if *tick <= 2 {
                Duration::ZERO
            } else {
                Duration::from_secs(60)
            }
        },
        &mut |done, planned| seen.borrow_mut().push((done, planned)),
        |_, _| Ok(vec![100.0]),
        |trial, _| {
            decodes.borrow_mut().push(trial.draft);
            Ok(vec![50.0])
        },
    );
    assert!(tuned.complete, "both shapes measured their history");
    assert!(tuned.cut, "no sweep began, so the tune is cut");
    assert!(decodes.borrow().is_empty(), "no decoded ask fit the budget");
    assert_eq!(tuned.trials.len(), 2, "one entry per shape, none a hole");
    assert!(tuned.trials.iter().all(|(_, kept)| matches!(
        kept,
        Kept::PromptOnly {
            skipped: Skip::Cut,
            ..
        }
    )));
    assert_eq!(tuned.winner, None, "nothing scored, nothing wins");
    assert_eq!(
        seen.borrow().last(),
        Some(&(2, 2)),
        "the plan is finished at the cut: {:?}",
        seen.borrow()
    );
}

/// The cut mid-sweep: the settings that ran stand, the ones behind them
/// are losers rather than holes, and the scored trials still decide.
#[test]
fn a_cut_inside_a_sweep_keeps_what_ran_and_drops_the_rest() {
    let shapes = vec![on(gpu())];
    let clock = RefCell::new(0u32);
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(60),
        || {
            let mut tick = clock.borrow_mut();
            *tick += 1;
            if *tick <= 3 {
                Duration::ZERO
            } else {
                Duration::from_secs(60)
            }
        },
        &mut |done, planned| seen.borrow_mut().push((done, planned)),
        |_, _| Ok(vec![100.0]),
        |_, _| Ok(vec![50.0]),
    );
    assert!(tuned.complete);
    assert!(tuned.cut, "3 and 4 never began, so the sweep is unfinished");
    assert_eq!(
        tuned.trials.len(),
        2,
        "off and 2 ran; 3 and 4 never began: {:?}",
        tuned.trials
    );
    assert!(tuned.winner.is_some(), "what ran still decides");
    assert_eq!(
        seen.borrow().last(),
        Some(&(3, 3)),
        "the plan is finished at the cut: {:?}",
        seen.borrow()
    );
}
