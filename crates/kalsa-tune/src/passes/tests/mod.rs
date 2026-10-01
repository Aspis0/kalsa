//! The two passes' policy with no process in sight: the order, the bound,
//! and what the record keeps of each; the budget's own cuts live beside
//! this file (`budget.rs`).

use std::cell::RefCell;
use std::path::PathBuf;
use std::time::Duration;

use kalsa_launch::Offload;
use kalsa_runtime::ServerBackend;

use super::*;

fn cpu(threads: usize) -> Candidate {
    Candidate {
        backend: ServerBackend::Cpu,
        threads: Some(threads),
        offload: Offload::NoGpuBuild,
        draft: None,
    }
}

fn gpu() -> Candidate {
    Candidate {
        backend: ServerBackend::Vulkan,
        threads: Some(16),
        offload: Offload::All,
        draft: None,
    }
}

fn on(candidate: Candidate) -> (Candidate, PathBuf) {
    (candidate, PathBuf::from("/stub-exe"))
}

fn drafted(shape: Candidate, n_max: u32) -> Candidate {
    Candidate {
        draft: Some(n_max),
        ..shape
    }
}

fn seconds(kept: &Kept) -> f64 {
    match kept {
        Kept::Replied(reply) => reply.seconds,
        other => panic!("no reply to price: {other:?}"),
    }
}

fn decode_rate(kept: &Kept) -> f64 {
    match kept {
        Kept::Replied(reply) => reply.decode_rate,
        other => panic!("no decode rate to read: {other:?}"),
    }
}

/// The Lenovo: three shapes, and the prefill pass covers all of them
/// before any decode sweep begins — the likely winner first, so its
/// complete reply is the bound for the shapes behind it. Every shape is
/// swept off, 2, 3 and 4, because the owner's rule tries MTP on every
/// backend shape.
#[test]
fn the_prefills_go_first_and_every_shape_is_swept_off_two_three_four() {
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
    let prefills = RefCell::new(Vec::new());
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |done, planned| seen.borrow_mut().push((done, planned)),
        |shape, _| {
            prefills.borrow_mut().push(*shape);
            Ok(vec![100.0])
        },
        |trial, _| {
            decodes
                .borrow_mut()
                .push((trial.backend, trial.threads, trial.draft));
            Ok(vec![50.0])
        },
    );
    assert_eq!(
        *prefills.borrow(),
        vec![gpu(), cpu(16), cpu(22)],
        "every prefill first, in the order built"
    );
    let expected = [gpu(), cpu(16), cpu(22)]
        .into_iter()
        .flat_map(|shape| {
            [None, Some(2), Some(3), Some(4)]
                .into_iter()
                .map(move |draft| (shape.backend, shape.threads, draft))
        })
        .collect::<Vec<_>>();
    assert_eq!(*decodes.borrow(), expected, "off, 2, 3, 4 on every shape");
    assert_eq!(tuned.trials.len(), 12, "twelve decode trials in one record");
    assert!(tuned.complete, "every shape ran its prefill");
    assert!(!tuned.cut, "nothing was cut");
    assert!(tuned.winner.is_some(), "every reply scored");
    // Fifteen lifetimes were planned (three prefills, twelve sweeps), and
    // the last call equals what began.
    let seen = seen.borrow();
    assert_eq!(seen.first(), Some(&(0, 15)));
    assert_eq!(seen.last(), Some(&(15, 15)));
}

/// The bound: a shape whose history alone already costs more than the best
/// complete reply cannot win, so its four lifetimes become one skip — not
/// a hole, and the record is still whole. The plan lowers with the skipped
/// lifetimes, so the panel's total is what will really run.
#[test]
fn the_bound_skips_a_hopeless_shapes_decode_and_the_record_stays_whole() {
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |done, planned| seen.borrow_mut().push((done, planned)),
        |shape, _| {
            // The card's history is two seconds; the processors' are
            // hundreds — more than the card's whole reply below.
            Ok(vec![if shape.backend == ServerBackend::Vulkan {
                1000.0
            } else {
                10.0
            }])
        },
        |trial, _| {
            decodes.borrow_mut().push((trial.threads, trial.draft));
            Ok(vec![100.0])
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (Some(16), None),
            (Some(16), Some(2)),
            (Some(16), Some(3)),
            (Some(16), Some(4))
        ],
        "only the shape that can still win was decoded"
    );
    assert!(
        tuned.complete,
        "a bounded shape ran its prefill: the record is not a partial picture"
    );
    assert!(!tuned.cut, "a bound skip is not a budget cut");
    // Seven lifetimes run (three prefills, the card's four), and the two
    // skipped shapes take their four planned lifetimes off the total as
    // each is bounded: 15, then 11, then 7.
    let seen = seen.borrow();
    assert!(
        seen.contains(&(7, 11)) && seen.contains(&(7, 7)),
        "the skipped lifetimes leave the plan: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&(7, 7)), "the final total is what ran");
    assert_eq!(
        tuned.winner.map(|win| win.candidate),
        Some(gpu()),
        "the only scored shape wins"
    );
    for shape in [cpu(16), cpu(22)] {
        assert!(
            tuned
                .trials
                .iter()
                .any(|(candidate, kept)| *candidate == shape
                    && matches!(
                        kept,
                        Kept::PromptOnly {
                            skipped: Skip::Bounded,
                            ..
                        }
                    )),
            "the skip is recorded as bounded, not as a hole: {:?}",
            tuned.trials
        );
    }
}

/// The Lenovo's own numbers: the card decodes 16.8 tok/s but waits 29 s
/// for a 2069-token history, where the processor decodes 8.0 and starts in
/// 11 s. The tune keeps the shorter wait, not the faster decoder.
#[test]
fn the_lenovo_case_keeps_the_shorter_reply_not_the_faster_decode() {
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
    let tuned = tune(
        &shapes,
        false,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_, _| {},
        |shape, _| match (shape.backend, shape.threads) {
            (ServerBackend::Vulkan, _) => Ok(vec![73.0]),
            (_, Some(16)) => Ok(vec![180.0]),
            _ => Ok(vec![120.0]),
        },
        |trial, _| match (trial.backend, trial.threads) {
            (ServerBackend::Vulkan, _) => Ok(vec![16.8]),
            (_, Some(16)) => Ok(vec![8.0]),
            _ => Ok(vec![7.5]),
        },
    );
    let win = tuned.winner.expect("every shape measured");
    assert_eq!(win.candidate, cpu(16), "{win:?}");
    assert!(
        win.reply.seconds < seconds(&tuned.trials[0].1),
        "the card's reply is longer, so it loses"
    );
}

/// MTP on the shape that loses the decode race outright: with its own
/// drafter the processor's reply is the shortest, so the trial that wins
/// is a drafted one — a setting decode-only ranking would never keep.
#[test]
fn a_drafter_on_a_shape_that_loses_the_decode_race_wins_the_room() {
    let shapes = vec![on(gpu()), on(cpu(16))];
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_, _| {},
        |shape, _| {
            Ok(vec![if shape.backend == ServerBackend::Vulkan {
                60.0
            } else {
                150.0
            }])
        },
        |trial, _| match (trial.backend, trial.draft) {
            (ServerBackend::Vulkan, _) => Ok(vec![30.0]),
            (_, Some(3)) => Ok(vec![12.0]),
            (_, _) => Ok(vec![8.0]),
        },
    );
    let win = tuned.winner.expect("both shapes measured");
    assert_eq!(win.candidate, drafted(cpu(16), 3), "the drafted processor");
    assert_eq!(win.reply.decode_rate, 12.0);
    assert!(
        decode_rate(&tuned.trials[0].1) > 12.0,
        "the card stays the faster decoder and still loses"
    );
}

/// A prefill that refuses is the shape's own answer: it costs no decode
/// lifetime, it cannot win, and the best processor still takes the room.
#[test]
fn a_refused_candidate_falls_to_the_best_processor() {
    let shapes = vec![on(gpu()), on(cpu(16))];
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |done, planned| seen.borrow_mut().push((done, planned)),
        |shape, _| {
            if shape.backend == ServerBackend::Vulkan {
                Err(Refusal::NotReady)
            } else {
                Ok(vec![150.0])
            }
        },
        |trial, _| {
            decodes.borrow_mut().push(trial.threads);
            Ok(vec![8.0])
        },
    );
    assert!(
        tuned
            .trials
            .iter()
            .any(|(candidate, kept)| *candidate == gpu()
                && matches!(
                    kept,
                    Kept::Refused {
                        refusal: Refusal::NotReady,
                        prompt_rate: None
                    }
                )),
        "the refusal is the shape's whole answer: {:?}",
        tuned.trials
    );
    assert_eq!(
        decodes.borrow().iter().copied().collect::<Vec<_>>(),
        vec![Some(16); 4],
        "the refused shape bought no decode lifetimes"
    );
    assert!(
        tuned.complete,
        "a refused lifetime is an answer, not a hole"
    );
    assert!(!tuned.cut, "a refusal is not a budget cut");
    // The refused shape's four planned lifetimes leave the total as soon
    // as its prefill answers: six lifetimes run (two prefills, one sweep).
    let seen = seen.borrow();
    assert!(
        seen.contains(&(1, 6)),
        "the refused shape's sweep leaves the plan: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&(6, 6)));
    assert_eq!(tuned.winner.map(|win| win.candidate), Some(cpu(16)));
}

/// A launch with no drafter is one setting per shape: off, and nothing
/// else. The shape's own numbers are the verdict.
#[test]
fn a_launch_without_a_drafter_sweeps_only_off() {
    let shapes = vec![on(gpu()), on(cpu(16))];
    let decodes = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        false,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_, _| {},
        |_, _| Ok(vec![100.0]),
        |trial, _| {
            decodes.borrow_mut().push(trial.draft);
            Ok(vec![40.0])
        },
    );
    assert_eq!(*decodes.borrow(), vec![None, None], "one sweep each");
    assert_eq!(tuned.trials.len(), 2);
    assert!(tuned
        .trials
        .iter()
        .all(|(_, kept)| matches!(kept, Kept::Replied(_))));
}

mod budget;
