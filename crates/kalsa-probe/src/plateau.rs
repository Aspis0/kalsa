//! Where the throughput stops improving.
//!
//! A fixed thread count is a guess about somebody else's CPU. The ramp finds the
//! answer instead: measure at 1, 2, 4 … threads and take the first count that is
//! already within a few percent of the best rate seen. Past that, more threads
//! buy nothing.
//!
//! It is also the honest busy-machine detector. A machine with cores taken away
//! by something else reaches its plateau later (or never), and its repetitions
//! disagree more — both of which land in the verdict, not in a table of what
//! each CPU class ought to do.

/// How close to the best rate a step has to be to count as the plateau.
pub const PLATEAU_TOLERANCE: f64 = 0.05;

/// The smallest thread count that reaches the plateau, with the rate there.
///
/// None when the ramp is empty or nothing was measurable.
pub fn plateau(ramp: &[(usize, f64)]) -> Option<(usize, f64)> {
    let best = ramp.iter().map(|(_, rate)| *rate).fold(0.0_f64, f64::max);
    if best <= 0.0 {
        return None;
    }
    ramp.iter()
        .find(|(_, rate)| *rate >= best * (1.0 - PLATEAU_TOLERANCE))
        .map(|(threads, rate)| (*threads, *rate))
}

/// True when the last step was still the best one: the ramp never flattened.
/// The shape alone convicts nothing: a ramp that ran to every thread it was
/// asked for has left no parallelism behind, and a busy machine is what
/// `confidence`'s parallelism check catches. `judge` counts this flag only
/// below the ramp's ceiling.
pub fn still_rising(ramp: &[(usize, f64)]) -> bool {
    match (plateau(ramp), ramp.last()) {
        (Some((plateau_threads, _)), Some((last_threads, _))) => plateau_threads == *last_threads,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape measured on an M1 Max: flat after eight threads.
    #[test]
    fn finds_the_first_thread_count_that_reaches_the_plateau() {
        let ramp = [
            (1, 55.8),
            (2, 64.5),
            (4, 88.0),
            (5, 88.6),
            (6, 94.5),
            (8, 112.2),
            (10, 107.9),
            (16, 109.4),
        ];
        let (threads, rate) = plateau(&ramp).expect("a plateau");
        assert_eq!(threads, 8, "five threads were 21% short of the ceiling");
        assert_eq!(rate, 112.2);
    }

    #[test]
    fn a_ramp_that_never_flattens_is_flagged() {
        let rising = [(1, 10.0), (2, 20.0), (4, 40.0), (8, 80.0)];
        assert!(still_rising(&rising));
        let flat = [(1, 10.0), (2, 20.0), (4, 40.0), (8, 41.0)];
        assert!(!still_rising(&flat));
    }

    #[test]
    fn a_shorter_ramp_still_answers() {
        // Two threads already at the plateau: everything after it is noise.
        let ramp = [(1, 50.0), (2, 100.0), (4, 101.0)];
        assert_eq!(plateau(&ramp), Some((2, 100.0)));
    }

    #[test]
    fn nothing_measured_is_not_a_plateau() {
        assert_eq!(plateau(&[]), None);
        assert_eq!(plateau(&[(1, 0.0), (2, 0.0)]), None);
        assert!(!still_rising(&[]));
    }
}
