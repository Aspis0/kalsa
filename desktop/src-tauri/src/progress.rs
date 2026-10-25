//! Which walk readings become `brain_progress` events.
//!
//! `kalsa-download` reports after every 64 KiB chunk — some five hundred
//! readings a second on a fast line for a multi-gigabyte model. Forwarding
//! each one as a Tauri event is a cost the machine pays twice: the event
//! itself, and the page's own `brain_state` read per event. The gate below
//! is the one decider for every byte source that reaches the page, and the
//! two emitters — the walk in `main.rs` (the runtime build, the weights,
//! the drafter and the tune all arrive on its one closure) and vision's
//! on-demand projector in `vision.rs` — both route through it.

use std::mem::{discriminant, Discriminant};
use std::time::{Duration, Instant};

use crate::startup::Progress;

/// Between two byte readings, unless one of them carries something the page
/// must not miss. Six or seven events a second read as continuous motion;
/// what the walk was paying for was five hundred.
const INTERVAL: Duration = Duration::from_millis(150);

/// Says which readings are worth an event. The answer comes from a reading
/// and an [`Instant`] alone, so a test drives it without a clock or a sleep.
pub(crate) struct Gate {
    /// The last reading that passed, and when: what the next one is
    /// measured against.
    last: Option<(Discriminant<Progress>, Instant)>,
}

impl Gate {
    pub(crate) fn new() -> Self {
        Self { last: None }
    }

    /// Whether this reading reaches the page from `now`. True for the first
    /// reading of a kind, for any reading that carries no bytes (a phase's
    /// name, the tune's own reports — never the flood), for a byte bar
    /// closing, and for a byte reading at least one interval after the last
    /// reading that passed.
    pub(crate) fn allows(&mut self, step: &Progress, now: Instant) -> bool {
        let shape = discriminant(step);
        let bytes = matches!(
            step,
            Progress::RuntimeBytes { .. } | Progress::ModelBytes { .. }
        );
        // The bar's own end: `placement` closes a shortened total this way
        // when the drafter is lost, and the download's last chunk arrives
        // with `done == total` beside it.
        let closing = matches!(
            step,
            Progress::RuntimeBytes { done, total } | Progress::ModelBytes { done, total }
                if done == total
        );
        let due = match &self.last {
            Some((last, at)) => *last != shape || now.saturating_duration_since(*at) >= INTERVAL,
            None => true,
        };
        if !bytes || closing || due {
            self.last = Some((shape, now));
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(done: u64, total: u64) -> Progress {
        Progress::ModelBytes { done, total }
    }

    /// A real line's shape: hundreds of readings inside one interval, none
    /// of which is the page's own news. Under "emit every reading" this is
    /// the 400 events a 10 MiB stretch of a download used to send.
    #[test]
    fn readings_inside_one_interval_collapse_to_one_event() {
        let mut gate = Gate::new();
        let t0 = Instant::now();
        assert!(
            gate.allows(&model(0, 100_000_000), t0),
            "the first reading must pass"
        );
        let mut passed = 0;
        for step in 1..=400u64 {
            let at = t0 + Duration::from_micros(step * 200);
            if gate.allows(&model(step * 10_000, 100_000_000), at) {
                passed += 1;
            }
        }
        assert_eq!(
            passed, 0,
            "400 readings inside one interval; {passed} passed"
        );
        assert!(
            gate.allows(
                &model(5_000_000, 100_000_000),
                t0 + INTERVAL + Duration::from_millis(1)
            ),
            "the first reading past the interval must pass"
        );
    }

    /// The page's words ride the kind, not the numbers: a new phase must not
    /// wait behind a download's interval.
    #[test]
    fn a_new_kind_passes_at_once() {
        let mut gate = Gate::new();
        let t0 = Instant::now();
        assert!(gate.allows(&model(0, 1000), t0));
        assert!(!gate.allows(&model(1, 1000), t0 + Duration::from_millis(1)));
        assert!(
            gate.allows(
                &Progress::RuntimeBytes {
                    done: 0,
                    total: 1000
                },
                t0 + Duration::from_millis(2)
            ),
            "a new kind carries new words, whatever the interval says"
        );
        assert!(!gate.allows(
            &Progress::RuntimeBytes {
                done: 1,
                total: 1000
            },
            t0 + Duration::from_millis(3)
        ));
        assert!(
            gate.allows(&Progress::Choosing, t0 + Duration::from_millis(4)),
            "a step that carries no bytes is never the flood and always passes"
        );
    }

    /// The closing reading is the page's "done": it must land even if the
    /// reading before it was an instant ago — the drafter lost mid-transfer
    /// closes a shortened bar exactly this way.
    #[test]
    fn a_bar_that_closes_always_passes() {
        let mut gate = Gate::new();
        let t0 = Instant::now();
        assert!(gate.allows(&model(0, 1000), t0));
        assert!(!gate.allows(&model(500, 1000), t0 + Duration::from_millis(1)));
        assert!(
            gate.allows(&model(1000, 1000), t0 + Duration::from_millis(2)),
            "the last reading of a transfer must reach the page"
        );
        assert!(
            gate.allows(&model(700, 700), t0 + Duration::from_millis(3)),
            "a bar closed at what placed must reach the page too"
        );
    }
}
