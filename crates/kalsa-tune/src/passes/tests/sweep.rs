//! Which shapes earn a drafted sweep: the off-winner first, then the shapes
//! whose history reads faster than it, largest decode saving first, and
//! nobody else.

use std::cell::RefCell;
use std::time::Duration;

use super::*;

/// The four shapes of an integrated-GPU machine, in the Surface's own
/// pattern: the 8-thread processor wins the off race on decode, the card
/// reads best and decodes worst, the mixed shape reads better than the
/// winner, and the 4-thread processor reads worse than both.
fn surface_rates(shape: &Candidate) -> (f64, f64) {
    match (shape.backend, shape.offload, shape.threads) {
        (ServerBackend::Cpu, _, Some(8)) => (22.0, 8.0),
        (ServerBackend::Cpu, _, _) => (16.0, 7.0),
        (_, Offload::ForcedOff, _) => (20.0, 6.0),
        _ => (25.0, 4.0),
    }
}

/// An integrated-GPU machine: the off-winner is the 8-thread processor —
/// the card's 4 tok/s decode loses the whole reply even though it reads
/// faster — and the card is the only shape whose history reads more than
/// [`PREFILL_EDGE`] faster than the winner's, so the drafted lifetimes run
/// on the winner and on the card, in that order. The two slower-reading
/// shapes are never swept, and sixteen lifetimes become ten.
#[test]
fn the_winner_and_the_faster_reading_shapes_are_swept_first_and_only_those() {
    let mixed = Candidate {
        offload: Offload::ForcedOff,
        ..gpu()
    };
    let shapes = vec![on(gpu()), on(mixed), on(cpu(4)), on(cpu(8))];
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| seen.borrow_mut().push((report.done, report.total)),
        |shape, _| {
            let (prompt, decode) = surface_rates(shape);
            first(prompt, decode)
        },
        |trial, _| {
            decodes
                .borrow_mut()
                .push((trial.backend, trial.threads, trial.draft));
            Ok(vec![surface_rates(trial).1])
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (ServerBackend::Cpu, Some(8), Some(2)),
            (ServerBackend::Cpu, Some(8), Some(3)),
            (ServerBackend::Cpu, Some(8), Some(4)),
            (ServerBackend::Vulkan, Some(16), Some(2)),
            (ServerBackend::Vulkan, Some(16), Some(3)),
            (ServerBackend::Vulkan, Some(16), Some(4)),
        ],
        "the winner first, then the only shape that reads faster than it"
    );
    assert_eq!(
        tuned.trials.len(),
        10,
        "four first lifetimes and two sweeps: {:?}",
        tuned.trials
    );
    assert!(tuned.complete && !tuned.cut, "every planned lifetime ran");
    // The fixture drafts no faster than it decodes, so the off winner
    // stands; the sweep order is the assertion here, not the gain.
    assert_eq!(tuned.winner.map(|win| win.candidate), Some(cpu(8)));
    for shape in [mixed, cpu(4)] {
        assert!(
            tuned
                .trials
                .iter()
                .any(|(candidate, kept)| *candidate == shape && matches!(kept, Kept::Replied(_))),
            "the slower reader keeps its off entry: {:?}",
            tuned.trials
        );
        assert!(
            !tuned
                .trials
                .iter()
                .any(|(candidate, _)| candidate.backend == shape.backend
                    && candidate.offload == shape.offload
                    && candidate.threads == shape.threads
                    && candidate.draft.is_some()),
            "and bought no drafted lifetime"
        );
    }
    // Ten planned lifetimes: the two unswept shapes' sweeps leave the plan
    // one after the other, and the last report is what ran.
    let seen = seen.borrow();
    assert_eq!(seen.last(), Some(&(10, 10)), "{seen:?}");
}

/// The card-only machine: the winner reads the history faster than
/// everything else, so neither processor earns a sweep — the Lenovo's and
/// this Mac's own shape list.
#[test]
fn a_winner_that_reads_best_leaves_the_other_shapes_their_off_entries_only() {
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| seen.borrow_mut().push((report.done, report.total)),
        |shape, _| {
            if shape.backend == ServerBackend::Vulkan {
                first(1500.0, 50.0)
            } else if shape.threads == Some(16) {
                first(30.0, 12.0)
            } else {
                first(25.0, 9.0)
            }
        },
        |trial, _| {
            decodes
                .borrow_mut()
                .push((trial.backend, trial.threads, trial.draft));
            Ok(vec![50.0])
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (ServerBackend::Vulkan, Some(16), Some(2)),
            (ServerBackend::Vulkan, Some(16), Some(3)),
            (ServerBackend::Vulkan, Some(16), Some(4)),
        ],
        "only the winner is swept"
    );
    assert_eq!(tuned.trials.len(), 6, "three first lifetimes, one sweep");
    assert!(tuned.complete && !tuned.cut);
    assert_eq!(tuned.winner.map(|win| win.candidate), Some(gpu()));
    let seen = seen.borrow();
    assert_eq!(seen.last(), Some(&(6, 6)), "{seen:?}");
}

/// The prefill bound still bites after a drafted reply has lowered the bar:
/// the winner reads at 20 and the 22-thread shape at 21.5 — inside the
/// [`PREFILL_EDGE`], so it is swept — but the card's drafted decode drops
/// the best reply far enough that the 22-thread shape's history alone can
/// no longer enter the band, and its sweep leaves the plan without running.
#[test]
fn the_prefill_bound_skips_a_swept_shape_whose_history_no_longer_fits_the_band() {
    let shapes = vec![on(cpu(16)), on(gpu()), on(cpu(22))];
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| seen.borrow_mut().push((report.done, report.total)),
        |shape, _| match (shape.backend, shape.threads) {
            (ServerBackend::Cpu, Some(16)) => first(20.0, 13.0),
            (ServerBackend::Vulkan, _) => first(25.0, 4.0),
            _ => first(21.5, 8.0),
        },
        |trial, _| {
            decodes
                .borrow_mut()
                .push((trial.backend, trial.threads, trial.draft));
            match (trial.backend, trial.threads) {
                (ServerBackend::Cpu, Some(16)) => Ok(vec![20.0]),
                (ServerBackend::Vulkan, _) => Ok(vec![60.0]),
                _ => panic!("the bound must skip the 22-thread shape"),
            }
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (ServerBackend::Cpu, Some(16), Some(2)),
            (ServerBackend::Cpu, Some(16), Some(3)),
            (ServerBackend::Cpu, Some(16), Some(4)),
            (ServerBackend::Vulkan, Some(16), Some(2)),
            (ServerBackend::Vulkan, Some(16), Some(3)),
            (ServerBackend::Vulkan, Some(16), Some(4)),
        ],
        "the winner first, then the card — the 22-thread shape never runs"
    );
    assert_eq!(tuned.trials.len(), 9, "three firsts and two sweeps");
    assert!(tuned.complete && !tuned.cut, "a bound skip is not a cut");
    assert_eq!(
        tuned
            .trials
            .iter()
            .filter(|(candidate, _)| candidate.threads == Some(22))
            .count(),
        1,
        "the bounded shape keeps its off entry only: {:?}",
        tuned.trials
    );
    assert_eq!(
        tuned.winner.map(|win| win.candidate),
        Some(drafted(gpu(), 2)),
        "the card's drafted reply is the shortest wait"
    );
    let seen = seen.borrow();
    // The plan falls only at the end — after the card's sweep, not before
    // any sweep began: the bound did the skipping, not the reading clause.
    let lowered = seen.iter().position(|(_, total)| *total < 12);
    assert_eq!(
        lowered.map(|at| seen[at]),
        Some((9, 9)),
        "the bound lowers the plan after the sweeps: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&(9, 9)), "{seen:?}");
}

/// A shape that answered the room ask but refused its own decode — prompt
/// measured, off samples not — has no off number to sweep from, so it keeps
/// a refusal entry and never enters the order. Its three planned lifetimes
/// must still leave the plan: the total ends at what ran, not one sweep per
/// unswept shape above it.
#[test]
fn a_shape_whose_off_decode_refused_leaves_its_sweep_out_of_the_plan() {
    let shapes = vec![on(gpu()), on(cpu(16)), on(cpu(22))];
    let decodes = RefCell::new(Vec::new());
    let seen = RefCell::new(Vec::new());
    let tuned = tune(
        &shapes,
        true,
        Duration::from_secs(3600),
        || Duration::ZERO,
        &mut |report| seen.borrow_mut().push((report.done, report.total)),
        |shape, _| {
            if shape.backend == ServerBackend::Vulkan {
                Ok(First {
                    prompt_rate: 1000.0,
                    off: Err(Refusal::NoUsableAnswer),
                })
            } else if shape.threads == Some(16) {
                first(30.0, 12.0)
            } else {
                first(25.0, 9.0)
            }
        },
        |trial, _| {
            decodes
                .borrow_mut()
                .push((trial.backend, trial.threads, trial.draft));
            Ok(vec![50.0])
        },
    );
    assert_eq!(
        *decodes.borrow(),
        vec![
            (ServerBackend::Cpu, Some(16), Some(2)),
            (ServerBackend::Cpu, Some(16), Some(3)),
            (ServerBackend::Cpu, Some(16), Some(4)),
        ],
        "the refused off-decode bought no drafted lifetime"
    );
    assert!(
        tuned
            .trials
            .iter()
            .any(|(candidate, kept)| *candidate == gpu()
                && matches!(
                    kept,
                    Kept::Refused {
                        refusal: Refusal::NoUsableAnswer,
                        prompt_rate: Some(_)
                    }
                )),
        "the off refusal keeps the prompt rate it measured: {:?}",
        tuned.trials
    );
    assert!(tuned.complete && !tuned.cut, "a refusal is not a hole");
    assert_eq!(
        tuned.winner.map(|win| win.candidate),
        Some(drafted(cpu(16), 2)),
        "the winner's own sweep still decides"
    );
    // Twelve planned lifetimes: the card's refused off-decode and the
    // 22-thread shape's slow history leave the plan one after the other,
    // then the winner's three run — done and total end together.
    let seen = seen.borrow();
    assert!(
        seen.contains(&(3, 9)) && seen.contains(&(3, 6)),
        "both unswept shapes leave the plan before the sweep: {seen:?}"
    );
    assert_eq!(seen.last(), Some(&(6, 6)), "{seen:?}");
}
