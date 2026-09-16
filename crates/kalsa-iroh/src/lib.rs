//! The second road to the door: iroh — QUIC direct between the phone and
//! the computer, hole-punched, with a relay of last resort that forwards
//! ciphertext only.
//!
//! The door on loopback never learns which road a request took. Tailscale
//! Serve is the first road; this crate is the second. One endpoint here
//! accepts iroh connections and, per accepted stream, opens one TCP
//! connection to `127.0.0.1:<door>` and pumps bytes both ways until a side
//! closes. There is no HTTP in this crate: the door already speaks it, and
//! the tunnel is the confidentiality boundary, not this hop.
//!
//! Two rules shape everything:
//!
//! * **One file names the transport.** Only `transport.rs` imports the
//!   iroh crate; its upgrade procedure is written at its top. Every public
//!   signature of this crate — types, errors, the `Result` arms — speaks
//!   this crate's language, so an upstream API change is a compile error in
//!   one file, not a migration.
//! * **Every wait is bounded from here.** iroh dials and reads that block
//!   silently are a measured fact (25 seconds against a dead published
//!   peer, 12-plus seconds of stream silence after a kill), not a fear; the
//!   dial deadline and the idle deadline exist for that and are ours
//!   because iroh's are not.
//!
//! The node's secret key persists beside the pairing file, owner-only
//! (`key`), so the computer keeps its identity across restarts. The phone
//! dials it by its 32 public bytes alone, and those bytes travel in the
//! pairing square — payload version 3 — whenever the internet road is open
//! and the owner's switch has it on. A square made with the road off
//! carries no node id (it must not promise what the machine is not
//! announcing); the next square on screen carries the id once the road
//! opens.

mod bridge;
mod error;
mod key;
mod pump;
mod transport;

pub use bridge::{Bridge, BridgeConfig, RelayChoice};
pub use error::BridgeError;
pub use key::{NodeId, NodeKey};
pub use transport::{AddressBook, TunnelStream, STREAMS_PER_PEER};
