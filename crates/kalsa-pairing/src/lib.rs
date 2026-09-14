//! The pairing ceremony: the moment the phone learns which computer is its
//! brain, and the computer learns which phone it serves. The whole ceremony
//! the user performs is a QR scan — the desktop shows a code, the phone's
//! camera reads it — and two things come out of it: a credential (after
//! pairing, the phone can reach this computer and nothing else can) and the
//! phone's own description.
//!
//! This crate owns the *ceremony*, not the transport: no HTTP, no Tauri, no
//! QR image rendering, no transport security — those are other layers' jobs.
//! What is here:
//!
//! * the one-time code and the binding secret, both from OS entropy, compared
//!   in constant time, printed by no `Debug` (`secret`);
//! * what the QR encodes — a versioned JSON payload: how to reach this
//!   computer, the code, and the binding that tells the phone this computer
//!   from a look-alike that answers faster (`payload`, `secret`);
//! * the state machine — Offered → Claimed → Paired, plus Expired — with the
//!   window, the single use, and the indistinguishable rejections enforced by
//!   the transitions, never asserted next to them (`ceremony`);
//! * the result: the long-lived credential plus the `PhoneModel` the phone
//!   declared, persisted owner-only (`handshake`, `store`).
//!
//! The phone's shape is `kalsa_catalog::PhoneModel`, filled here and read
//! everywhere else; nothing in this crate re-describes the phone, and a field
//! the phone declines to state stays empty.

mod ceremony;
mod error;
mod handshake;
mod payload;
mod secret;

pub mod store;

pub use ceremony::{ClaimResult, Pairing};
pub use error::{CompleteError, EntropyError, StoreError};
pub use handshake::Handshake;
