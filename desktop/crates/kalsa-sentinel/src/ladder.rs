//! The back-off ladder: what "gentler" means, in the order it is tried.
//!
//! The response to decay is a sequence of progressively gentler settings,
//! modelled here as data with a defined order — one rung per verdict, each
//! reversible when the machine recovers. The rungs name *what changes*, not
//! what it changes to: mapping a rung to concrete `llama-server` arguments is
//! the server owner's job. This crate decides, someone else acts.
//!
//! The order is the order of heat, cheapest in quality first:
//!
//! 1. **threads** — cores are where the watts are. Fewer threads is the
//!    strongest and most reversible lever there is: the working set is
//!    unchanged, the output is unchanged, and each remaining core both
//!    dissipates less and boosts higher.
//! 2. **batch and ubatch** — smaller batches smooth the power bursts of
//!    prefill and decode without changing how much work a token needs.
//! 3. **KV cache quantisation** — trims memory traffic and footprint, and
//!    frees RAM, which old machines are short of; but it saves less heat than
//!    the first two and is the first rung that can touch quality at all, so
//!    it comes after them.
//! 4. **doing less work per unit time** — above all the knobs. When the
//!    machine still cannot sustain even the gentlest settings, the only way
//!    left to do less harm is to do less. This rung is a throughput cap the
//!    server owner implements; the ladder only names it.

/// One setting of the machine, from full performance down to the deliberate
/// trickle. Data the caller branches on and renders; no numbers live here.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    /// The settings the model was chosen for.
    Full,
    /// Thread count reduced.
    FewerThreads,
    /// Batch and ubatch reduced.
    SmallBatches,
    /// KV cache quantised.
    QuantisedKv,
    /// Above all knobs: deliberately less work per unit time.
    Trickle,
}

/// The ladder itself, gentlest last. The order is the contract; the server
/// owner maps each rung to arguments.
pub const LADDER: [Step; 5] = [
    Step::Full,
    Step::FewerThreads,
    Step::SmallBatches,
    Step::QuantisedKv,
    Step::Trickle,
];

/// Where on the ladder the machine currently sits. The cursor starts at full
/// and moves one rung at a time — one verdict, one rung, never a jump — so
/// every move is small, announced, and reversible.
pub(crate) struct Ladder {
    rung: usize,
}

impl Ladder {
    pub(crate) fn new() -> Self {
        Self { rung: 0 }
    }

    pub(crate) fn step(&self) -> Step {
        LADDER[self.rung]
    }

    /// One rung gentler, or nothing at the floor.
    pub(crate) fn gentler(&mut self) -> Option<(Step, Step)> {
        if self.rung + 1 == LADDER.len() {
            return None;
        }
        let from = LADDER[self.rung];
        self.rung += 1;
        Some((from, LADDER[self.rung]))
    }

    /// One rung back toward full, or nothing at the top.
    pub(crate) fn fuller(&mut self) -> Option<(Step, Step)> {
        if self.rung == 0 {
            return None;
        }
        let from = LADDER[self.rung];
        self.rung -= 1;
        Some((from, LADDER[self.rung]))
    }

    /// A released model starts its next session at full: the idle time was
    /// the machine's chance to cool, and the detector re-learns from live
    /// samples within a few turns if that optimism was wrong.
    pub(crate) fn reset(&mut self) {
        self.rung = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_ladder_is_ordered_from_full_to_trickle() {
        assert_eq!(
            LADDER,
            [
                Step::Full,
                Step::FewerThreads,
                Step::SmallBatches,
                Step::QuantisedKv,
                Step::Trickle,
            ]
        );
    }

    #[test]
    fn gentler_descends_one_rung_at_a_time() {
        let mut ladder = Ladder::new();
        assert_eq!(ladder.gentler(), Some((Step::Full, Step::FewerThreads)));
        assert_eq!(
            ladder.gentler(),
            Some((Step::FewerThreads, Step::SmallBatches))
        );
        assert_eq!(ladder.step(), Step::SmallBatches);
    }

    #[test]
    fn the_floor_has_nothing_gentler() {
        let mut ladder = Ladder::new();
        while ladder.gentler().is_some() {}
        assert_eq!(ladder.step(), Step::Trickle);
        assert_eq!(ladder.gentler(), None);
        assert_eq!(ladder.gentler(), None);
    }

    #[test]
    fn fuller_climbs_one_rung_and_stops_at_full() {
        let mut ladder = Ladder::new();
        assert_eq!(ladder.fuller(), None);
        assert_eq!(ladder.gentler(), Some((Step::Full, Step::FewerThreads)));
        assert_eq!(ladder.fuller(), Some((Step::FewerThreads, Step::Full)));
        assert_eq!(ladder.fuller(), None);
    }

    #[test]
    fn reset_returns_to_full() {
        let mut ladder = Ladder::new();
        ladder.gentler();
        ladder.gentler();
        ladder.reset();
        assert_eq!(ladder.step(), Step::Full);
    }
}
