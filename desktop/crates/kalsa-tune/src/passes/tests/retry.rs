//! What a withheld marker's trials give the retry: the lifetimes they
//! proved measured are skipped and left out of the plan, the lifetime the
//! budget cut has no entry so it runs again, and the numbers the page
//! counts are only what is left.

use std::cell::RefCell;
use std::time::Duration;

use super::*;

/// A trial as the marker left it: the launch, and the reply it proved.
fn replied(candidate: Candidate, prompt_rate: f64, decode_rate: f64) -> (Candidate, Kept) {
    let reply = Reply::from_rates(prompt_rate, decode_rate).expect("two rates");
    (candidate, Kept::Replied(reply))
}

/// The three-shape fixture the retry resumes over: the card reads the
/// history fastest and wins the off race, so it alone earns a sweep —
/// sixteen planned lifetimes become four (three firsts, three drafted on
/// the winner), and a marker that saved all of three firsts plus the
/// winner's 2 and 3 leaves exactly one.
fn surface() -> Vec<(Candidate, PathBuf)> {
    vec![on(gpu()), on(cpu(16)), on(cpu(22))]
}

/// The marker of the measured Surface first tune: every first lifetime
/// answered, the winner's drafted 2 and 3 answered, 4 never began.
fn sweep_marker() -> Vec<(Candidate, Kept)> {
    let winner = gpu();
    vec![
        replied(winner, 1500.0, 50.0),
        replied(cpu(16), 30.0, 12.0),
        replied(cpu(22), 25.0, 9.0),
        replied(drafted(winner, 2), 1500.0, 60.0),
        replied(drafted(winner, 3), 1500.0, 70.0),
    ]
}

/// The sweep's marker with the one cut lifetime left: the retry plans
/// exactly that — no first lifetime runs again, the sweep runs only 4,
/// and the report under which the lifetime starts says 1 of 1, never the
/// whole tune's share.
#[test]
fn a_sweep_marker_resumes_at_the_one_drafted_lifetime_left() {
    let shapes = surface();
    let prior = sweep_marker();
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        &prior,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| seen.borrow_mut().push(report),
        &mut |_| {},
        |_, _| panic!("the marker proved every first lifetime measured"),
        |trial, _| {
            decodes.borrow_mut().push(trial.draft);
            Ok(vec![80.0])
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![Some(4)],
        "only the lifetime the budget cut runs: {:?}",
        decodes.borrow()
    );
    assert!(
        tuned.complete && !tuned.cut,
        "the one lifetime fit the budget"
    );
    assert_eq!(
        tuned.trials.len(),
        prior.len() + 1,
        "the marker's five entries and this run's one: {:?}",
        tuned.trials
    );
    let seen = seen.borrow();
    let running = seen
        .iter()
        .find(|report| report.candidate == 1 && report.done == 0)
        .expect("the one lifetime reports its start");
    assert_eq!(
        (running.done, running.total),
        (0, 1),
        "the plan the page counts is what is left: {seen:?}"
    );
    assert_eq!(
        seen.last().map(|report| (report.done, report.total)),
        Some((1, 1)),
        "and the retry ends there: {seen:?}"
    );
}

/// The pass-one marker: one shape's first lifetime never began, so the
/// retry runs that shape first and then pass two as normal — the sweep
/// order computed from the pooled pass-one numbers, the saved drafted
/// settings skipped.
#[test]
fn a_pass_one_marker_runs_the_missing_shape_then_pass_two() {
    let shapes = surface();
    let prior = vec![replied(gpu(), 1500.0, 50.0), replied(cpu(16), 30.0, 12.0)];
    let firsts = RefCell::new(Vec::new());
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        &prior,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| seen.borrow_mut().push((report.done, report.total)),
        &mut |_| {},
        |shape, _| {
            firsts.borrow_mut().push(*shape);
            first(25.0, 9.0)
        },
        |trial, _| {
            decodes.borrow_mut().push((trial.threads, trial.draft));
            Ok(vec![50.0])
        },
    );
    assert_eq!(
        *firsts.borrow(),
        vec![cpu(22)],
        "only the shape the budget never reached: {firsts:?}"
    );
    assert_eq!(
        *decodes.borrow(),
        vec![(Some(16), Some(2))],
        "pass two from the pooled numbers: the winner is swept alone — and
         its draft decodes at the off rate, so the sweep ends at 2"
    );
    assert!(
        tuned.complete && !tuned.cut,
        "everything left fit the budget"
    );
    let seen = seen.borrow();
    assert!(
        seen.contains(&(0, 10)) && seen.contains(&(1, 4)),
        "the plan opens at the one first lifetime plus nine sweeps, \
         then the unswept shapes leave it: {seen:?}"
    );
    assert_eq!(
        seen.last(),
        Some(&(2, 2)),
        "one first lifetime and one drafted setting ran: {seen:?}"
    );
}

/// The budget cut a drafted lifetime mid-sweep: it has no entry, so it is
/// not counted as measured and runs again — with the settings behind it —
/// while the saved 2 keeps its own reply untouched.
#[test]
fn a_cut_drafted_lifetime_is_rerun_not_counted_as_measured() {
    let shapes = surface();
    let mut prior = sweep_marker();
    prior.pop(); // 3 never began: the cut left no entry for it
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        &prior,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| {
            seen.borrow_mut()
                .push((report.done, report.total, report.candidate))
        },
        &mut |_| {},
        |_, _| panic!("the marker proved every first lifetime measured"),
        |trial, _| {
            decodes.borrow_mut().push(trial.draft);
            Ok(vec![75.0])
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![Some(3), Some(4)],
        "the cut lifetime re-runs, the saved 2 does not: {:?}",
        decodes.borrow()
    );
    let saved = replied(drafted(gpu(), 2), 1500.0, 60.0);
    assert!(
        tuned.trials.contains(&saved),
        "the saved 2 keeps its own reply: {:?}",
        tuned.trials
    );
    assert_eq!(
        tuned.trials.len(),
        prior.len() + 2,
        "the marker's four entries and this run's two: {:?}",
        tuned.trials
    );
    let seen = seen.borrow();
    let running = seen
        .iter()
        .find(|(done, _, candidate)| *candidate == 1 && *done == 0)
        .expect("the cut lifetime reports its start");
    assert_eq!(running.1, 2, "two lifetimes left, never three: {seen:?}");
    assert_eq!(
        seen.last().map(|(done, total, _)| (done, total)),
        Some((&2, &2)),
        "both ran: {seen:?}"
    );
}

/// What the page counts is the remaining plan, not the whole tune's: a
/// drafter-less marker with two of three first lifetimes saved leaves one
/// lifetime, and every report under it says one.
#[test]
fn the_retry_plan_counts_only_the_lifetimes_left() {
    let shapes = surface();
    let prior = vec![replied(gpu(), 1500.0, 50.0), replied(cpu(16), 30.0, 12.0)];
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        false,
        &prior,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| seen.borrow_mut().push((report.done, report.total)),
        &mut |_| {},
        |shape, _| {
            assert_eq!(*shape, cpu(22), "only the shape the marker never answered");
            first(25.0, 9.0)
        },
        |_, _| panic!("no drafter, no drafted lifetime"),
    );
    let seen = seen.borrow();
    assert!(
        seen.iter().all(|(_, total)| *total == 1),
        "every report counts the one lifetime left: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&(1, 1)), "and the run ends there");
    assert!(tuned.complete && !tuned.cut);
    assert_eq!(tuned.trials.len(), prior.len() + 1, "{:?}", tuned.trials);
}
