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
mod health;
mod supervisor;

pub use supervisor::{
    conservative_threads, ServerConfig, ServerState, Supervisor, DEFAULT_BATCH, DEFAULT_CTX,
    DEFAULT_IDLE_SECONDS, DEFAULT_STOP_GRACE, DEFAULT_UBATCH,
};
