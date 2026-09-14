//! Choosing the model: which one this machine should run, and how fast, before
//! the user waits for a download.
//!
//! The rules come from the product plan and are all here, pure:
//!
//! * **two axes, never confused** — total weights decide whether a model fits,
//!   active weights decide how fast it decodes (`parameters`);
//! * **licence is a door, not a column** — a row that cannot be used
//!   commercially cannot be handed to the chooser at all, and a *conditional*
//!   licence travels with the row into the result (`licence`, `manifest`);
//! * **the budget follows the path** — a discrete GPU is budgeted by its own
//!   memory, because system RAM is irrelevant to a model that will decode
//!   there; where the card's size cannot be read honestly, the budget falls
//!   back to system RAM and says the GPU was not accounted for (`footprint`);
//! * **a model fits entirely or not at all** — split across GPU and CPU a
//!   model decodes slower than on the CPU alone, so the fallback is the
//!   largest model that fits, never a spill;
//! * **the PC must beat the phone** — a candidate that is not clearly more
//!   model than the one in the user's hand is not proposed as an upgrade, and
//!   "this computer is not worth it" is a valid answer (`choice`);
//! * **capability, expectation, or relief — and it says which** — capability
//!   is claimed on *parameters* within the same shape, or on a publisher's
//!   own same-recipe dense comparison carried per row; a large unsourced MoE
//!   is expected-but-unmeasured, never dressed up as either; relief moves the
//!   work off a phone that is on battery. The reason travels as data the UI
//!   branches on, never as a string it parses (`choice`);
//! * **a download is an address, not a guess** — a row with an identified
//!   GGUF carries the exact file at a pinned commit, with its size and the
//!   sha256 every byte is verified against, complete or absent; the
//!   selection hands the shell a plan it can fetch, and a row with no source
//!   visibly cannot produce one (`manifest`, `choice`);
//! * **measuring replaces all of it** — the bake-off in `scripts/quality/`,
//!   run on the user's own machine on the actual pair. Below ~10B total a MoE
//!   can be worse than a same-total dense model (Jelassi et al., ICLR 2025),
//!   so no cross-shape inference is drawn there; no citable rule converts a
//!   MoE to a dense size, and none is invented here.
//! * **say why, with the numbers** — every decision carries a sentence a human
//!   can check, with the speed as a range, never as a made-up point estimate.
//!
//! Nothing here measures anything: the probe measured the machine once, and this
//! layer uses those numbers to look at the whole catalog.

mod candidate;
mod rationale;

pub mod choice;
pub mod footprint;
pub mod licence;
pub mod manifest;
pub mod parameters;

pub use candidate::Prediction;
pub use choice::DownloadPlan;
pub use choice::{
    capability_basis, choose, CapabilityBasis, ChoiceInput, Decision, Justification, PhoneModel,
    Refusal, RefusalReason, Selection, IMPROVEMENT_RATIO, LARGE_MOE_TOTAL_PARAMETERS,
    SAME_CLASS_BAND,
};
pub use footprint::{
    fits, footprint_bytes, memory_budget, usable_bytes, Footprint, MemoryBudget, GIB,
};
// `ChoiceInput` cannot be built without a `Backend`, so the type is re-exported
// rather than making callers depend on the probe's path module by name.
pub use kalsa_probe::Backend;
pub use licence::{Licence, Standing};
pub use manifest::{
    excluded, usable, DenseEquivalent, GgufSource, ModelEntry, UsableEntry, CATALOG,
};
pub use parameters::{ActiveParameters, Parameters, TotalParameters};
