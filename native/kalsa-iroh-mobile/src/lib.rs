//! The Android face of brain's `kalsa-iroh`: one object holds the node
//! identity (the app passes the key file path), one object carries bytes
//! under the deadlines the caller sets per call. The typed error enum is
//! the only other thing that crosses the FFI.
//!
//! Blocking on purpose. uniffi's Kotlin async story would have the app
//! drive a foreign executor across JNI for every wait, while every wait
//! here is one the caller bounds: reads and writes carry their own
//! timeouts and answer `Deadline`, shutdown cancels parked calls with
//! `Closed`, and a call that would panic — `block_on` from inside an
//! async context — answers `AsyncContext` instead.

mod bridge;
mod error;
mod runtime;
mod stream;

pub use bridge::{Lane, MobileBridge};
pub use error::IrohMobileError;
pub use stream::Tunnel;

uniffi::setup_scaffolding!("kalsa_iroh_mobile");
