//! Process supervision for the Kalsa Brain server.
//!
//! The server (`llama-server`) runs as a child process on loopback: it is
//! embedded in our package, never installed as a service, and never adopted
//! from another runtime — the tuning surface is how the safety net acts, and
//! we cannot tune a process we do not own.
//!
//! This crate is UI-free on purpose: the app shell may change, the supervision
//! rules must stay testable with `cargo test -p kalsa-supervisor`.

mod child;
mod config;
mod drain;
mod health;
mod instance;
mod presence;
mod supervisor;
mod suspect;

pub use child::{pid_alive, terminate_pid, Step, Termination};
#[cfg(windows)]
pub use child::{confine, Job};
pub use config::{ServerConfig, DEFAULT_STOP_GRACE};
pub use instance::{hold_state_lock, Existing, InstanceFile};
pub use supervisor::{
    Failure, ServerState, StartOutcome, StartSettled, StartWaiter, Supervisor, Watch,
};
