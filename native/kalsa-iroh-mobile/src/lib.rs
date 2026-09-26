//! The Android face of brain's `kalsa-iroh`: one object holds the node
//! identity (the app passes the key file path), one object carries bytes.
//! The typed error enum is the only other thing that crosses the FFI; no
//! call here panics.
//!
//! Blocking on purpose. uniffi's Kotlin async story would have the app
//! drive a foreign executor across JNI for every wait, while the real
//! waits — dial and idle — are already bounded inside `kalsa-iroh`
//! (10 s dial deadline, 30 s idle deadline). A bounded blocking call on
//! one Kotlin dispatcher thread is the simpler contract.

mod bridge;
mod error;
mod stream;

pub use bridge::{Lane, MobileBridge};
pub use error::IrohMobileError;
pub use stream::Tunnel;

uniffi::setup_scaffolding!("kalsa_iroh_mobile");
