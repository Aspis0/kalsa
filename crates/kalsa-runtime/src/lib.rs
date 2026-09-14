//! Which `llama-server` build this machine should run, and proof that it
//! works.
//!
//! The product bundles llama.cpp's server and runs it as a child on loopback;
//! the user installs one thing and answers no questions. This crate decides
//! which build this machine gets, fetches it, and — before anything downloads
//! gigabytes of model weights — proves it actually runs here.
//!
//! The order of the whole story is the safety story:
//!
//! 1. detection (`kalsa_probe::Backend`) narrows the [`candidates_for`];
//! 2. a saved [`Decision`] short-circuits everything while its fingerprint
//!    still describes this machine (hardware, driver, release);
//! 3. otherwise each candidate is fetched through `kalsa-download` — size and
//!    sha256 are promises, and nothing downloads until they are verified
//!    against the release — then launched as a disposable child with a tiny
//!    model and a deadline ([`decide`] walks the list, first candidate whose
//!    server answers `/health` wins, and the verdict is saved).
//!
//! Detection only narrows because GPU backends do not always fail cleanly:
//! llama.cpp's CUDA error path calls `GGML_ABORT`, and a missing DLL kills
//! the process before the server starts. Only a child that answers is proof.
//!
//! Blocking on purpose: this runs on a background thread, and an async
//! runtime would be a dependency on the one thing an old machine cannot
//! spare. Out of scope by design: model selection (`kalsa-catalog`), the UI,
//! the tunnel, the thermal net.

mod assets;
mod candidates;
mod child;
mod decide;
mod extract;
mod marker;
mod probe;
mod store;
mod verdict;

pub use assets::{Platform, ServerBackend};
pub use candidates::candidates_for;
pub use decide::{decide, DecideError, Decision};
