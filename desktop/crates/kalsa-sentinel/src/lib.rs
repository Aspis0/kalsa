//! The sustainability guard: the best throughput an old machine can hold, not
//! the most it can burst.
//!
//! The product turns old personal computers into servers for a phone, and the
//! owner's instruction is explicit: *senza distruggere i PC*. Those machines
//! may have dried thermal paste, clogged fans and degraded cooling, so the
//! objective is not maximum tokens per second but the best throughput the
//! machine can *sustain*.
//!
//! The thermal budget itself cannot be measured: reading CPU or GPU
//! temperature on Windows needs a kernel driver we cannot sign or license.
//! The signal instead is **throughput decay** — a symptom readable everywhere,
//! with no privileges and no driver, and one that does not care whether the
//! cause is heat, a power limit, a dying fan or the user starting something
//! else on the machine. That last property is the point: we do not need to
//! know why, only that the machine no longer sustains what it did.
//!
//! The pieces, all pure decisions over samples the caller carries in:
//!
//! * `detector` — is the machine sustaining its baseline, has it decayed, has
//!   it recovered. Magnitude and persistence are required before any verdict,
//!   and the two directions are declared at different levels, so a machine on
//!   the boundary cannot oscillate;
//! * `ladder` — the answer to decay: an ordered sequence of progressively
//!   gentler settings, from thread count down to simply doing less work per
//!   unit time, each rung reversible when the machine recovers;
//! * `event` — every ladder move is announced, carrying which step and why as
//!   data the UI branches on. A silent downgrade is the same defect as a
//!   truncated message with no marker: the user finds out later, on their
//!   own, and stops trusting the thing.
//!
//! Release timing is *not* decided here. The server owns it outright:
//! kalsa-launch renders `--sleep-idle-seconds`, and that flag is the only
//! unload clock in the product. This crate ran a second one once — ten
//! minutes against the server's five, announcing a release that had already
//! happened to nobody — and it is gone. Do not add another: when the model
//! is released, the server's owner reports it through
//! [`Sentinel::note_unload`], and the idle time before that report was the
//! machine's chance to cool, which is why the next session starts at full
//! settings.
//!
//! What this crate does not do: no temperature sensors, no WMI, no `/sys`
//! reads, no vendor SDKs, no process control, no HTTP, no config files, no
//! async. It never reads a clock either — time is an input ([`Sample::at`],
//! [`Sentinel::note_unload`]) — which is what makes it testable without hardware and
//! honest under review. This crate decides; whoever owns the server process
//! acts.

mod detector;
mod event;
mod ladder;
mod sample;
mod sentinel;

pub use detector::{
    Level, DEGRADE_AFTER_SAMPLES, DEGRADE_RATIO, MINIMUM_STREAK_SPAN_SECONDS,
    RECOVER_AFTER_SAMPLES, RECOVER_RATIO, STREAK_GAP_SECONDS,
};
pub use event::Event;
pub use ladder::{Step, LADDER};
pub use sample::Sample;
pub use sentinel::Sentinel;
