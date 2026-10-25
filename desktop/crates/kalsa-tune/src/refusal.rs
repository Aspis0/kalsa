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

impl Refusal {
    /// Whether this refusal ANSWERS for its lifetime — the one list the
    /// retry's skip and the sweep's stop both read: the server was up, it
    /// passed the identity gates, and the ask came back with what it
    /// gave. `NoUsableAnswer` is the ask inside the tune's own bound
    /// returning nothing usable (a plain HTTP or timeout error lands here
    /// too — the setting had its chance); `PromptTooShort` is the server
    /// answering the room ask from cache. `DidNotStart` (the spawn
    /// failed, the process died, the identity was never ours) and
    /// `NotReady` (alive, but past the readiness deadline) never
    /// answered: they are not measurements — a slow first start under an
    /// antivirus scan earns a retry, not a verdict — and neither the skip
    /// nor the sweep may judge on them.
    pub(crate) fn answers(self) -> bool {
        matches!(self, Refusal::NoUsableAnswer | Refusal::PromptTooShort)
    }
}
