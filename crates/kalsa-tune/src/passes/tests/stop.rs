//! When a shape's sweep ends early — the measured rule: a drafted
//! setting that is refused, or that does not write faster than the same
//! shape with the drafter off, ends the shape's sweep and its remaining
//! settings leave the plan. The Surface's own numbers, 2026-10-05.

use std::cell::RefCell;
use std::time::Duration;

use super::*;

/// The Surface's two shapes as the lab measured them: the graphics shape
/// reads the history at 25 tok/s and decodes at 4.70 with the drafter
/// off, the 8-thread processor reads at 22.7 and decodes at 7.45 — so the
/// processor wins the off race (77.5 s against 88.5 s) and the card
/// reads fast enough (≥ 5 %) to be swept beside it.
fn surface() -> Vec<(Candidate, PathBuf)> {
    vec![on(gpu()), on(cpu(8))]
}

/// The first lifetime each shape's off reply comes from: the lab's own
/// prompt and decode rates with the drafter off.
fn surface_first(shape: &Candidate) -> Result<First, Refusal> {
    if shape.backend == ServerBackend::Vulkan {
        first(25.0, 4.70)
    } else {
        first(22.7, 7.45)
    }
}

/// The processor's drafted settings, all three faster than its 7.45
/// tok/s off decode — its sweep runs whole in every test here.
fn processor_decode(trial: &Candidate) -> f64 {
    match trial.draft {
        Some(2) => 8.5,
        Some(3) => 9.0,
        Some(4) => 8.8,
        other => panic!("the processor has no setting {other:?}"),
    }
}

/// What every report of these two shapes' tune says: done, total,
/// candidate — the plan as it stands, call by call.
fn reports(seen: &RefCell<Vec<(usize, usize, usize)>>) -> Vec<(usize, usize, usize)> {
    seen.borrow().clone()
}

/// The lab's measured row: the card's n = 2 decodes at 3.31 against its
/// 4.70 off — slower than the drafter off — so its sweep stops right
/// there. n = 3 (which refused in the lab) and n = 4 never run, their
/// lifetimes leave the plan, and `done` ends at what really ran.
#[test]
fn a_setting_that_does_not_beat_off_ends_the_shapes_sweep() {
    let shapes = surface();
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        &[],
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| {
            seen.borrow_mut()
                .push((report.done, report.total, report.candidate))
        },
        &mut |_| {},
        |shape, _| surface_first(shape),
        |trial, _| {
            decodes.borrow_mut().push((trial.backend, trial.draft));
            if trial.backend == ServerBackend::Vulkan {
                match trial.draft {
                    Some(2) => Ok(vec![3.31]),
                    Some(3) | Some(4) => panic!("n = 3 and n = 4 lost the sweep at n = 2"),
                    other => panic!("the card has no setting {other:?}"),
                }
            } else {
                Ok(vec![processor_decode(trial)])
            }
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (ServerBackend::Cpu, Some(2)),
            (ServerBackend::Cpu, Some(3)),
            (ServerBackend::Cpu, Some(4)),
            (ServerBackend::Vulkan, Some(2)),
        ],
        "the processor sweeps whole; the card stops after the setting slower than off"
    );
    assert_eq!(
        reports(&seen),
        vec![
            (0, 8, 1),
            (1, 8, 1),
            (1, 8, 2),
            (2, 8, 2),
            (2, 8, 3),
            (3, 8, 3),
            (3, 8, 4),
            (4, 8, 4),
            (4, 8, 5),
            (5, 8, 5),
            (5, 8, 6),
            (6, 8, 6),
            // The card's n = 3 and n = 4 leave the plan, one report.
            (6, 6, 6),
            (6, 6, 6),
        ],
        "the plan lowers behind the stop, and ends at what ran"
    );
    let card: Vec<&(Candidate, Kept)> = tuned
        .trials
        .iter()
        .filter(|(candidate, _)| candidate.backend == ServerBackend::Vulkan)
        .collect();
    assert_eq!(
        card.len(),
        2,
        "the card keeps its off entry and the losing 2 only: {:?}",
        tuned.trials
    );
    match card[1] {
        (Candidate { draft: Some(2), .. }, Kept::Replied(reply)) => assert!(
            (reply.decode_rate - 3.31).abs() < 1e-9,
            "the losing setting keeps its own measurement: {reply:?}"
        ),
        other => panic!("the card's n = 2 entry: {other:?}"),
    }
    assert!(tuned.complete && !tuned.cut, "no budget was touched");
}

/// A refusal ends the sweep the same way — the lab's n = 3 row, moved to
/// the first setting: the card's n = 2 answers with nothing usable, its
/// entry is that refusal, and n = 3 / n = 4 leave without running.
#[test]
fn a_refused_draft_ends_the_shapes_sweep() {
    let shapes = surface();
    let decodes = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        &[],
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_| {},
        &mut |_| {},
        |shape, _| surface_first(shape),
        |trial, _| {
            decodes.borrow_mut().push((trial.backend, trial.draft));
            if trial.backend == ServerBackend::Vulkan {
                match trial.draft {
                    Some(2) => Err(Refusal::NoUsableAnswer),
                    Some(3) | Some(4) => panic!("a refusal at n = 2 ended this sweep"),
                    other => panic!("the card has no setting {other:?}"),
                }
            } else {
                Ok(vec![processor_decode(trial)])
            }
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (ServerBackend::Cpu, Some(2)),
            (ServerBackend::Cpu, Some(3)),
            (ServerBackend::Cpu, Some(4)),
            (ServerBackend::Vulkan, Some(2)),
        ],
        "the refused setting was the card's first and last this sweep"
    );
    assert!(
        tuned.trials.contains(&(
            drafted(gpu(), 2),
            Kept::Refused {
                refusal: Refusal::NoUsableAnswer,
                prompt_rate: Some(25.0),
            },
        )),
        "the refusal is the setting's entry: {:?}",
        tuned.trials
    );
    assert_eq!(
        tuned
            .trials
            .iter()
            .filter(|(candidate, _)| candidate.backend == ServerBackend::Vulkan)
            .count(),
        2,
        "off and the refused 2 only: {:?}",
        tuned.trials
    );
    assert_eq!(
        tuned.trials.len(),
        6,
        "two off replies, three processor drafts, the refusal: {:?}",
        tuned.trials
    );
    assert!(tuned.complete && !tuned.cut);
}

/// Faster keeps the sweep going: the card's n = 2 at 6.0 tok/s beats its
/// 4.70 off, so n = 3 runs — and when n = 3 lands at 3.0, IT is the
/// setting that ends the sweep; n = 4 leaves without running.
#[test]
fn a_faster_setting_keeps_the_sweep_until_a_slower_one_arrives() {
    let shapes = surface();
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        &[],
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| {
            seen.borrow_mut()
                .push((report.done, report.total, report.candidate))
        },
        &mut |_| {},
        |shape, _| surface_first(shape),
        |trial, _| {
            decodes.borrow_mut().push((trial.backend, trial.draft));
            if trial.backend == ServerBackend::Vulkan {
                match trial.draft {
                    Some(2) => Ok(vec![6.0]),
                    Some(3) => Ok(vec![3.0]),
                    Some(4) => panic!("n = 3 lost to off; n = 4 never runs"),
                    other => panic!("the card has no setting {other:?}"),
                }
            } else {
                Ok(vec![processor_decode(trial)])
            }
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (ServerBackend::Cpu, Some(2)),
            (ServerBackend::Cpu, Some(3)),
            (ServerBackend::Cpu, Some(4)),
            (ServerBackend::Vulkan, Some(2)),
            (ServerBackend::Vulkan, Some(3)),
        ],
        "the faster n = 2 runs on to n = 3, which ends it"
    );
    assert_eq!(
        reports(&seen),
        vec![
            (0, 8, 1),
            (1, 8, 1),
            (1, 8, 2),
            (2, 8, 2),
            (2, 8, 3),
            (3, 8, 3),
            (3, 8, 4),
            (4, 8, 4),
            (4, 8, 5),
            (5, 8, 5),
            (5, 8, 6),
            (6, 8, 6),
            (6, 8, 7),
            (7, 8, 7),
            // n = 4 leaves the plan behind the stop at n = 3.
            (7, 7, 7),
            (7, 7, 7),
        ],
        "the plan lowers behind the stop, and ends at what ran"
    );
    assert_eq!(
        tuned.trials.len(),
        7,
        "two off replies, three processor drafts, the card's 2 and 3: {:?}",
        tuned.trials
    );
    assert!(tuned.complete && !tuned.cut);
}

/// A startup refusal answers nothing, so it cannot judge the sweep: the
/// card's n = 2 fails to come up (`NotReady`), and n = 3 / n = 4 run
/// anyway — the entry stands as the refusal it is (a retry re-runs it,
/// never this sweep), and the shape is judged on the settings that did
/// answer: n = 3 at 6.0 beats the 4.70 off and runs on, n = 4 at 3.0
/// ends the sweep with nothing behind it.
#[test]
fn a_startup_refusal_does_not_end_the_shapes_sweep() {
    let shapes = surface();
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        &[],
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| seen.borrow_mut().push((report.done, report.total)),
        &mut |_| {},
        |shape, _| surface_first(shape),
        |trial, _| {
            decodes.borrow_mut().push((trial.backend, trial.draft));
            if trial.backend == ServerBackend::Vulkan {
                match trial.draft {
                    Some(2) => Err(Refusal::NotReady),
                    Some(3) => Ok(vec![6.0]),
                    Some(4) => Ok(vec![3.0]),
                    other => panic!("the card has no setting {other:?}"),
                }
            } else {
                Ok(vec![processor_decode(trial)])
            }
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (ServerBackend::Cpu, Some(2)),
            (ServerBackend::Cpu, Some(3)),
            (ServerBackend::Cpu, Some(4)),
            (ServerBackend::Vulkan, Some(2)),
            (ServerBackend::Vulkan, Some(3)),
            (ServerBackend::Vulkan, Some(4)),
        ],
        "the startup refusal did not end anything: every setting ran"
    );
    assert!(
        tuned.trials.contains(&(
            drafted(gpu(), 2),
            Kept::Refused {
                refusal: Refusal::NotReady,
                prompt_rate: Some(25.0),
            },
        )),
        "the refusal is the entry it is: {:?}",
        tuned.trials
    );
    assert_eq!(
        *seen.borrow(),
        vec![
            (0, 8),
            (1, 8),
            (1, 8),
            (2, 8),
            (2, 8),
            (3, 8),
            (3, 8),
            (4, 8),
            (4, 8),
            (5, 8),
            (5, 8),
            (6, 8),
            (6, 8),
            (7, 8),
            (7, 8),
            (8, 8),
            (8, 8),
        ],
        "no lowering: nothing is behind the last setting to leave"
    );
    assert!(tuned.complete && !tuned.cut);
}
