//! Why a lifetime produced no number: a closed set of our own causes,
//! never free text — this is written to disk (`tuning-<digest>.txt`), and
//! an arbitrary stderr line would carry paths or anything else the engine
//! happened to print.

/// Stable names, one per cause, in the record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The engine never came up: the spawn failed, or the process died
    /// before it ever answered.
    DidNotStart,
    /// It was alive but never answered readiness inside the deadline.
    NotReady,
    /// It ran and answered, but no usable rate came out of it — nothing
    /// finished, or the timings were unusable.
    NoUsableAnswer,
    /// It answered the room ask, but from its own cache: the prompt it
    /// proved it processed is far below the history the ask ordered, so
    /// the rate measures the cache, not the shape's prefill.
    PromptTooShort,
}
