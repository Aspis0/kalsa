//! Which launch settings run fastest on this machine with this model:
//! measured, never assumed.
//!
//! The tune is an optimisation allowed to fail: a refused or unmeasured
//! candidate never wins, and no winner at all leaves the caller on the
//! rule's own guess (`kalsa_launch::thread_count`, the VRAM margin). Four
//! questions, four modules: which launches are worth trying
//! (`candidates`), how the room is asked and scored (`room`, `score`),
//! which trials the two passes measured (`passes`), and what is kept for
//! the next start (`record`).

pub mod record;
pub use record::fingerprint;
pub use sample::{
    checked_rate, Answer, Ask, CHECK_TIMEOUT, DRAFT_MIN_GENERATED, DRAFT_N_PREDICT, DRAFT_PROMPT,
    DRAFT_SEED,
};

mod measure;
mod sample;

mod candidates;
mod passes;
mod refusal;
mod room;
mod score;

pub use candidates::{candidates, needs_tuning, Candidate};
pub use measure::{measure_tune, TOTAL_BUDGET_SECONDS};
pub use passes::{plan_prior, Report, Tuned};
pub use refusal::Refusal;
pub use score::{Reply, Winner};
