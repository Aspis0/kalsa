//! Choosing the model: which one this machine should run, and how fast, before
//! the user waits for a download.
//!
//! The rules come from the product plan and are all here, pure:
//!
//! * **two axes, never confused** — total weights decide whether a model fits,
//!   active weights decide how fast it decodes (`parameters`);
//! * **licence is a door, not a column** — a row that cannot be used
//!   commercially cannot be handed to the chooser at all (`licence`, `manifest`);
//! * **the PC must beat the phone** — a candidate that is not clearly more model
//!   than the one in the user's hand is not proposed, and "this computer is not
//!   worth it" is a valid answer (`choice`);
//! * **say why, with the numbers** — every decision carries a sentence a human
//!   can check, with the speed as a range, never as a made-up point estimate.
//!
//! Nothing here measures anything: the probe measured the machine once, and this
//! layer uses those numbers to look at the whole catalog.

pub mod choice;
pub mod footprint;
pub mod licence;
pub mod manifest;
pub mod parameters;

pub use choice::{
    choose, ChoiceInput, Decision, PhoneModel, Refusal, RefusalReason, Selection,
    IMPROVEMENT_RATIO, SAME_CLASS_BAND,
};
pub use footprint::{fits, footprint_bytes, usable_bytes, Footprint, GIB};
pub use licence::{Licence, Standing};
pub use manifest::{excluded, usable, ModelEntry, UsableEntry, CATALOG};
pub use parameters::{ActiveParameters, Parameters, TotalParameters};
