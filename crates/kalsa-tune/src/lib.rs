//! Which launch settings run fastest on this machine with this model:
//! measured, never assumed.
//!
//! The tune is an optimisation allowed to fail: a refused or unmeasured
//! candidate never wins, and no winner at all leaves the caller on the
//! rule's own guess (`kalsa_launch::thread_count`, the VRAM margin). Three
//! questions, three modules: which launches are worth trying
//! (`candidates`), which trial won (`winner`), and what is kept for the
//! next start (`record`).

pub mod record;
pub use record::fingerprint;
pub use sample::checked_rate;

mod measure;
mod sample;

mod candidates;
mod winner;

pub use candidates::{candidates, needs_tuning, Candidate};
pub use measure::measure_candidates;
pub use winner::{winner, Outcome, Refusal, Winner, TIE_BAND};
