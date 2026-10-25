//! Which saved entries the retry trusts: an answer from a server that
//! ran, on a lifetime this plan still contains — everything else leaves
//! the picture and runs again.

use std::cell::RefCell;
use std::time::Duration;

use super::*;

/// A trial as the marker left it: the launch, and the reply it proved.
fn replied(candidate: Candidate, prompt_rate: f64, decode_rate: f64) -> (Candidate, Kept) {
    let reply = Reply::from_rates(prompt_rate, decode_rate).expect("two rates");
    (candidate, Kept::Replied(reply))
}

/// A refusal of the shape the record writes: a closed cause, and the
/// prompt rate the lifetime measured before it (none for a launch that
/// never came up).
fn refused(candidate: Candidate, refusal: Refusal, prompt_rate: Option<f64>) -> (Candidate, Kept) {
    (
        candidate,
        Kept::Refused {
            refusal,
            prompt_rate,
        },
    )
}

/// The three-shape fixture, with the card reading far ahead: its sweep
/// runs alone, so every drafted call the tests see belongs to it.
fn surface() -> Vec<(Candidate, PathBuf)> {
    vec![on(gpu()), on(cpu(16)), on(cpu(22))]
}

/// `DidNotStart` never answered: the engine did not come up (a slow
/// first start, a scan holding the exe), so the retry runs that shape's
/// first lifetime again — the startup refusal leaves the picture and the
/// fresh answer takes its place, one entry per launch.
#[test]
fn a_saved_startup_refusal_is_rerun_not_skipped() {
    let shapes = surface();
    let prior = vec![
        replied(gpu(), 1500.0, 50.0),
        refused(cpu(16), Refusal::DidNotStart, None),
        replied(cpu(22), 25.0, 9.0),
    ];
    let firsts = RefCell::new(Vec::new());
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
            first(30.0, 12.0)
        },
        |_, _| Ok(vec![80.0]),
    );
    assert_eq!(
        *firsts.borrow(),
        vec![cpu(16)],
        "the launch that never started runs again"
    );
    assert!(
        !tuned.trials.iter().any(|(_, kept)| matches!(
            kept,
            Kept::Refused {
                refusal: Refusal::DidNotStart,
                ..
            }
        )),
        "the startup refusal leaves the picture: {:?}",
        tuned.trials
    );
    let rerun = tuned
        .trials
        .iter()
        .filter(|(candidate, _)| *candidate == cpu(16))
        .collect::<Vec<_>>();
    assert_eq!(
        rerun.len(),
        1,
        "one entry per launch, never two: {:?}",
        tuned.trials
    );
    assert!(
        matches!(rerun[0].1, Kept::Replied(_)),
        "and the fresh answer is the one kept: {:?}",
        tuned.trials
    );
    assert_eq!(
        tuned.trials.len(),
        6,
        "two saved replies, the rerun's answer, three drafts: {:?}",
        tuned.trials
    );
    let seen = seen.borrow();
    assert_eq!(
        seen.last(),
        Some(&(4, 4)),
        "one first lifetime and three drafts ran: {seen:?}"
    );
    assert!(tuned.complete && !tuned.cut);
}

/// A drafted refusal that ANSWERED judges the sweep exactly like a run
/// setting: the server ran, passed the gates, and the ask came back
/// with nothing usable inside the tune's own bound — that ends the
/// shape's sweep. The entry stands in the record; the settings behind
/// it are unsaved, so they leave the plan through `lower()` and never
/// run.
#[test]
fn a_saved_draft_refusal_that_answered_ends_the_sweep() {
    let shapes = surface();
    let prior = vec![
        replied(gpu(), 1500.0, 50.0),
        replied(cpu(16), 30.0, 12.0),
        replied(cpu(22), 25.0, 9.0),
        refused(drafted(gpu(), 2), Refusal::NoUsableAnswer, Some(1500.0)),
    ];
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
        |_, _| panic!("every first lifetime is answered"),
        |trial, _| {
            decodes.borrow_mut().push(trial.draft);
            Ok(vec![80.0])
        },
    );
    assert!(
        decodes.borrow().is_empty(),
        "the saved refusal ends the sweep: nothing behind it runs: {:?}",
        decodes.borrow()
    );
    assert!(
        tuned.trials.contains(&refused(
            drafted(gpu(), 2),
            Refusal::NoUsableAnswer,
            Some(1500.0)
        )),
        "its entry stands in the record: {:?}",
        tuned.trials
    );
    assert_eq!(
        tuned.trials.len(),
        4,
        "three saved firsts and the saved refusal: {:?}",
        tuned.trials
    );
    let seen = seen.borrow();
    assert_eq!(
        *seen,
        vec![(0, 5), (0, 2), (0, 0), (0, 0)],
        "the unswept shapes leave first, then the 3 and 4 behind the stop: {seen:?}"
    );
    assert!(tuned.complete && !tuned.cut);
}

/// The other half of the rule: a saved setting that does not write
/// faster than the shape's own off decode ends the sweep just like a
/// run one — 40 tok/s against the card's 50 — its entry stands, and the
/// unsaved settings behind it leave the plan through `lower()`.
#[test]
fn a_saved_setting_slower_than_off_ends_the_sweep() {
    let shapes = surface();
    let prior = vec![
        replied(gpu(), 1500.0, 50.0),
        replied(cpu(16), 30.0, 12.0),
        replied(cpu(22), 25.0, 9.0),
        replied(drafted(gpu(), 2), 1500.0, 40.0),
    ];
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
        |_, _| panic!("every first lifetime is answered"),
        |trial, _| {
            decodes.borrow_mut().push(trial.draft);
            Ok(vec![80.0])
        },
    );
    assert!(
        decodes.borrow().is_empty(),
        "the saved slower-than-off 2 ends the sweep: {:?}",
        decodes.borrow()
    );
    assert!(
        tuned
            .trials
            .contains(&replied(drafted(gpu(), 2), 1500.0, 40.0)),
        "its entry stands in the record: {:?}",
        tuned.trials
    );
    assert_eq!(tuned.trials.len(), 4, "{:?}", tuned.trials);
    let seen = seen.borrow();
    assert_eq!(
        *seen,
        vec![(0, 5), (0, 2), (0, 0), (0, 0)],
        "the settings behind the stop leave the plan: {seen:?}"
    );
    assert!(tuned.complete && !tuned.cut);
}

/// A marker can outlive the candidate list: the plan's thread count is
/// not part of the fingerprint, so a saved launch this start's shapes do
/// not contain — with any setting, drafted or not — is neither seeded
/// nor counted: it cannot win, cannot price the bound, and never reaches
/// the record. It is the fastest reply in the file, on purpose.
#[test]
fn an_entry_outside_the_current_plan_is_ignored() {
    let shapes = vec![on(gpu()), on(cpu(16))];
    let stale = cpu(6);
    let prior = vec![
        replied(gpu(), 1500.0, 50.0),
        replied(cpu(16), 30.0, 12.0),
        replied(stale, 2000.0, 100.0),
        replied(drafted(stale, 3), 2000.0, 100.0),
    ];
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        &prior,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| seen.borrow_mut().push((report.done, report.total)),
        &mut |_| {},
        |_, _| panic!("every first lifetime is answered"),
        |_, _| Ok(vec![80.0]),
    );
    assert!(
        tuned
            .trials
            .iter()
            .all(|(candidate, _)| candidate.threads != Some(6)),
        "the stale launch never reaches the record: {:?}",
        tuned.trials
    );
    assert_eq!(
        tuned.trials.len(),
        5,
        "the two shapes' off replies and the winner's three drafts: {:?}",
        tuned.trials
    );
    assert_eq!(
        tuned.winner.map(|win| win.candidate),
        Some(drafted(gpu(), 2)),
        "a reply from a launch this plan does not run cannot win"
    );
    let seen = seen.borrow();
    assert_eq!(
        seen.last(),
        Some(&(3, 3)),
        "three drafts ran, the plan's own share: {seen:?}"
    );
}
