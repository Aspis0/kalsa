//! How the server is started: the exact arguments `llama-server` gets, and
//! what they cost in memory.
//!
//! Everything upstream decides *what* to run — `kalsa-catalog` picks the
//! model, `kalsa-runtime` picks the build, `kalsa-probe` measures the
//! machine. This crate turns those three answers into the start command, and
//! the decisions behind it are all the plan's:
//!
//! * **Context is a multiplication, not a preference.** The catalog's
//!   arithmetic is `weights + mmproj + compute buffers + KV + margin <=
//!   usable RAM`; the context is the largest whose KV cache fits what is
//!   left after the weights. A context that does not fit is not a slow app —
//!   it is a crash or an OOM kill on a machine the owner was using for
//!   something else.
//! * **The thread count is the measured plateau.** The plan again: the first
//!   probe reported 83–86 GB/s "only because it used `cores / 2` = 5
//!   threads", and past the plateau more threads is *worse*. No fraction of
//!   `available_parallelism()` is hardcoded here; the ramp the probe measured
//!   decides (`kalsa_probe::plateau`).
//! * **Offload is all or nothing.** Measured upstream: 18.49 tok/s fully on
//!   the GPU, 12.19 on CPU, 5.68 split across both — the split is 2.15×
//!   slower than not using the GPU at all. So a GPU that cannot hold the
//!   whole model gets none of it, explicitly, because a GPU-capable build
//!   offloads every layer by default.
//! * **The arguments follow from the build that won.** A CPU build has no
//!   GPU code, so it gets no GPU flags; a Metal, Vulkan or CUDA build gets
//!   the offload decision stated explicitly, never left to its default.
//! * **Heat is part of the objective.** The plan's second rule is "the
//!   highest throughput that is sustainable", not the maximum; where a
//!   setting trades a little speed for a lot less thermal load, that is the
//!   setting this crate ships.
//!
//! The output is a value, not a string: a test can assert "the context is
//! N", and the sentinel can later hand back a reduced configuration without
//! string surgery. [`ServerArgs::argv`] renders the command line at the edge.
//! Alongside the arguments comes the [`MemoryAssumption`] — the catalog says
//! "the cache size is still an assumption"; this crate is where that
//! assumption becomes a number the interface can print.

mod args;
mod argv;
mod policy;

pub use args::{
    KvCache, LaunchPlan, MemoryAssumption, Offload, ServerArgs, ServerSettings,
    DEFAULT_IDLE_UNLOAD_SECONDS, MAX_BATCH, MAX_IDLE_UNLOAD_SECONDS, MAX_UBATCH, MIN_BATCH,
    MIN_IDLE_UNLOAD_SECONDS, MIN_UBATCH,
};
pub use policy::{funded_context, plan, LaunchInput};
