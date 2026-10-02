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

/// A shape's first lifetime, as the seam would answer it: the room ask's
/// prefill rate and the shape's own off-decode in one.
fn first(prompt_rate: f64, off_decode: f64) -> Result<First, Refusal> {
    Ok(First {
        prompt_rate,
        off: Ok(vec![off_decode]),
    })
}

/// The Lenovo: three shapes, and every first lifetime covers all of them
/// before any drafted sweep begins — the likely winner first, so its
/// complete off reply is the bound for the shapes behind it. Each shape
/// then runs 2, 3 and 4, because the owner's rule tries MTP on every
/// backend shape.
#[test]
fn every_shape_takes_one_first_lifetime_and_then_its_drafted_sweep() {
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
    let firsts = RefCell::new(Vec::new());
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |done, planned| seen.borrow_mut().push((done, planned)),
        |shape, _| {
            firsts.borrow_mut().push(*shape);
            first(100.0, 50.0)
        },
        |trial, _| {
            decodes
                .borrow_mut()
                .push((trial.backend, trial.threads, trial.draft));
            Ok(vec![50.0])
        },
    );
    assert_eq!(
        *firsts.borrow(),
        vec![gpu(), cpu(16), cpu(22)],
        "every shape's first lifetime, in the order built"
    );
    let expected = [gpu(), cpu(16), cpu(22)]
        .into_iter()
        .flat_map(|shape| {
            [Some(2), Some(3), Some(4)]
                .into_iter()
                .map(move |draft| (shape.backend, shape.threads, draft))
        })
        .collect::<Vec<_>>();
    assert_eq!(*decodes.borrow(), expected, "2, 3, 4 on every shape");
    assert_eq!(
        tuned.trials.len(),
        12,
        "three first lifetimes and nine drafted settings"
    );
    assert!(tuned.complete, "every shape ran its first lifetime");
    assert!(!tuned.cut, "nothing was cut");
    assert!(tuned.winner.is_some(), "every reply scored");
    // Twelve lifetimes were planned, and the last call equals what began.
    let seen = seen.borrow();
    assert_eq!(seen.first(), Some(&(0, 12)));
    assert_eq!(seen.last(), Some(&(12, 12)));
}

/// The off number is the first lifetime's: no separate off lifetime is
/// started, and the shape's off entry carries exactly the rate that
/// lifetime measured — the drafted settings are the only decode lifetimes.
#[test]
fn the_off_number_comes_from_the_first_lifetime() {
    let shapes = vec![on(gpu()), on(cpu(16))];
    let firsts = RefCell::new(Vec::new());
    let decodes = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_, _| {},
        |shape, _| {
            firsts.borrow_mut().push(*shape);
            first(60.0, 31.0)
        },
        |trial, _| {
            decodes.borrow_mut().push(trial.draft);
            Ok(vec![50.0])
        },
    );
    assert_eq!(
        *firsts.borrow(),
        vec![gpu(), cpu(16)],
        "one first lifetime per shape"
    );
    assert_eq!(
        *decodes.borrow(),
        vec![Some(2), Some(3), Some(4), Some(2), Some(3), Some(4)],
        "the sweep is 2, 3, 4 only: off has no lifetime of its own"
    );
    let off = tuned
        .trials
        .iter()
        .find(|(candidate, _)| *candidate == gpu())
        .expect("the shape's off entry");
    assert_eq!(
        decode_rate(&off.1),
        31.0,
        "the off entry is the first lifetime's own number"
    );
}

/// The bound: a shape whose history alone already costs more than the best
/// complete reply cannot win, so its drafted lifetimes are skipped — its
/// own off entry stands, and the record is whole. The plan lowers with the
/// skipped lifetimes, so the panel's total is what will really run.
#[test]
fn the_bound_skips_a_hopeless_shapes_drafted_sweep_and_the_record_stays_whole() {
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
            if shape.backend == ServerBackend::Vulkan {
                first(1000.0, 100.0)
            } else {
                first(10.0, 100.0)
            }
        },
        |trial, _| {
            decodes.borrow_mut().push((trial.threads, trial.draft));
            Ok(vec![100.0])
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (Some(16), Some(2)),
            (Some(16), Some(3)),
            (Some(16), Some(4))
        ],
        "only the shape that can still win was drafted"
    );
    assert!(
        tuned.complete,
        "a bounded shape ran its first lifetime: the record is not a partial picture"
    );
    assert!(!tuned.cut, "a bound skip is not a budget cut");
    // Six lifetimes run (three firsts, the card's three drafted), and the
    // two skipped shapes take their three planned lifetimes off the total
    // as each is bounded: 12, then 9, then 6.
    let seen = seen.borrow();
    assert!(
        seen.contains(&(6, 9)) && seen.contains(&(6, 6)),
        "the skipped lifetimes leave the plan: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&(6, 6)), "the final total is what ran");
    assert_eq!(
        tuned.winner.map(|win| win.candidate),
        Some(gpu()),
        "the only shape with a reply beyond its off wins"
    );
    for shape in [cpu(16), cpu(22)] {
        assert!(
            tuned
                .trials
                .iter()
                .any(|(candidate, kept)| *candidate == shape && matches!(kept, Kept::Replied(_))),
            "the bounded shape keeps its off number: {:?}",
            tuned.trials
        );
        assert!(
            !tuned
                .trials
                .iter()
                .any(|(candidate, _)| candidate.threads == shape.threads
                    && candidate.backend == shape.backend
                    && candidate.draft.is_some()),
            "and no drafted lifetime was measured on it"
        );
    }
}

/// Inside the tie band prefill alone prunes nothing: a reply costs at
/// least its shape's prefill, so the bound runs to the best reply pushed
/// out to the band's edge — and a shape that stays inside wins on decode.
/// The card reads at 1000 and decodes at 100 (3.15 s); the processor
/// reads at 359.375 — a 3.2 s history, inside 3.15 × 1.05 — and its
/// drafted reply decodes at 2000 (3.3 s), the fastest decode in the band.
#[test]
fn a_shape_whose_prefill_sits_inside_the_band_is_swept_and_wins_on_decode() {
    let shapes = vec![on(gpu()), on(cpu(16))];
    let decodes = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_, _| {},
        |shape, _| {
            if shape.backend == ServerBackend::Vulkan {
                first(1000.0, 100.0)
            } else {
                first(359.375, 50.0)
            }
        },
        |trial, _| {
            decodes.borrow_mut().push((trial.backend, trial.draft));
            Ok(vec![if trial.backend == ServerBackend::Cpu {
                2000.0
            } else {
                100.0
            }])
        },
    );
    assert!(
        decodes.borrow().contains(&(ServerBackend::Cpu, Some(2))),
        "the in-band shape's sweep must run: {:?}",
        decodes.borrow()
    );
    let win = tuned.winner.expect("both shapes replied");
    assert_eq!(win.candidate, drafted(cpu(16), 2), "{win:?}");
    assert_eq!(win.reply.decode_rate, 2000.0, "the band's fastest decoder");
}

/// The card decodes 10 tok/s but reads at 60, a 39.2 s mean wait; the
/// processor decodes 8.0 and reads at 300, a 28.8 s one. The tune keeps the
/// shorter wait, not the faster decoder.
#[test]
fn the_card_that_decodes_faster_but_waits_longer_loses() {
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
    let tuned = tune(
        &shapes,
        false,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_, _| {},
        |shape, _| match (shape.backend, shape.threads) {
            (ServerBackend::Vulkan, _) => first(60.0, 10.0),
            (_, Some(16)) => first(300.0, 8.0),
            _ => first(120.0, 7.5),
        },
        |_, _| panic!("a plan without a drafter has no drafted sweep"),
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
            if shape.backend == ServerBackend::Vulkan {
                first(60.0, 30.0)
            } else {
                first(150.0, 8.0)
            }
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

/// A first lifetime that refuses is the shape's own answer: it costs no
/// drafted lifetime, it cannot win, and the best processor still takes the
/// room. The plan lowers by the sweeps that will never run.
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
                first(150.0, 8.0)
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
        vec![Some(16); 3],
        "the refused shape bought no drafted lifetimes"
    );
    assert!(
        tuned.complete,
        "a refused lifetime is an answer, not a hole"
    );
    assert!(!tuned.cut, "a refusal is not a budget cut");
    // The refused shape's three planned drafted lifetimes leave the total
    // as soon as its first lifetime answers: five lifetimes run (two
    // firsts, one sweep).
    let seen = seen.borrow();
    assert!(
        seen.contains(&(1, 5)),
        "the refused shape's sweep leaves the plan: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&(5, 5)));
    assert_eq!(tuned.winner.map(|win| win.candidate), Some(cpu(16)));
}

/// A launch with no drafter is complete after one lifetime per shape: the
/// first lifetime already carries the shape's own off number, and there is
/// no drafted setting left to run.
#[test]
fn a_launch_without_a_drafter_is_complete_after_the_first_lifetime() {
    let shapes = vec![on(gpu()), on(cpu(16))];
    let tuned = tune(
        &shapes,
        false,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |_, _| {},
        |_, _| first(100.0, 40.0),
        |_, _| panic!("no drafter, no drafted lifetime"),
    );
    assert_eq!(tuned.trials.len(), 2, "one entry per shape");
    assert!(tuned
        .trials
        .iter()
        .all(|(_, kept)| matches!(kept, Kept::Replied(_))));
    assert_eq!(
        tuned.winner.map(|win| win.candidate),
        Some(gpu()),
        "the first shape's reply wins the tie"
    );
}

mod budget;
