//! What the ladder did, and why — as data the UI branches on.
//!
//! A silent downgrade is the same defect as a truncated message with no
//! marker: the user finds out later, on their own, and stops trusting the
//! thing. So every move the ladder makes — and the moment it runs out of
//! moves — is an event carrying the rungs involved. No prose is built here;
//! the words are the UI's job, the facts are these variants.

use crate::ladder::Step;

/// One announced change in how the machine is being worked.
// PartialEq, not Eq: Unload carries seconds, and floats have no equality
// worth promising beyond comparison.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Event {
    /// Sustained decay: the ladder answered by easing one rung.
    BackedOff { from: Step, to: Step },
    /// Sustained recovery: one rung given back.
    Restored { from: Step, to: Step },
    /// Sustained decay with the ladder already at its floor: there is no
    /// gentler setting left, and doing even less work per unit time is now
    /// the caller's decision. Announced once per fall to the floor, not on
    /// every confirming turn — the floor does not move.
    Exhausted { at: Step },
    /// The server's owner saw the model released after this much idle: the
    /// sentinel runs no clock of its own, so this event only ever follows a
    /// `note_unload` report, never time passing. `from` is the rung it ran
    /// at when released; the next session starts at [`Step::Full`],
    /// because the idle time was the machine's chance to cool.
    Unload { idle_seconds: f64, from: Step },
}
