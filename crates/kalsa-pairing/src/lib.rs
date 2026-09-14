//! The pairing ceremony: the moment the phone learns which computer is its
//! brain, and the computer learns which phone it serves. The whole ceremony
//! the user performs is a QR scan — the desktop shows a code, the phone's
//! camera reads it — and two things come out of it: a credential (after
//! pairing, the phone can reach this computer and nothing else can) and the
//! phone's own description.
//!
//! This crate owns the *ceremony*, not the transport: no HTTP, no Tauri, no
//! pixel-pushing — the shell draws the SVG that `qr` emits. What is here:
//!
//! * the one-time code and the per-offer nonce, both from OS entropy, compared
//!   in constant time, printed by no `Debug` (`secret`);
//! * what the QR encodes — a versioned JSON payload: how to reach this
//!   computer, the code the whole completion protocol is keyed on, and the
//!   nonce both MACs cover (`payload`, `secret`, `messages`);
//! * the square itself, that payload as the symbol a phone camera reads —
//!   the one place the secrets are rendered on purpose (`qr`);
//! * the completion handshake — the phone's declaration, bound by a MAC
//!   keyed on the code; the computer's seal in answer; one attempt per
//!   ceremony (`messages`);
//! * the state machine — Offered → Claimed → Paired, plus Expired — with the
//!   window, the single use, the proof gate, and the indistinguishable
//!   rejections enforced by the transitions, never asserted next to them
//!   (`ceremony`);
//! * the result: the long-lived credential plus the `PhoneModel` the phone
//!   declared, persisted owner-only (`handshake`, `store`).
//!
//! The phone's shape is `kalsa_catalog::PhoneModel`, filled here and read
//! everywhere else; nothing in this crate re-describes the phone, and a field
//! the phone declines to state stays empty.

mod ceremony;
mod error;
mod handshake;
mod messages;
mod payload;
mod qr;
mod secret;

pub mod store;

pub use ceremony::{ClaimResult, Pairing};
pub use error::{CompleteError, EntropyError, PayloadTooLong, StoreError};
pub use handshake::Handshake;
pub use messages::{PairingSeal, PhoneDeclaration};
pub use qr::qr_svg;
