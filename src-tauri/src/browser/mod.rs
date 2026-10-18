//! The browser in the app: the driver it runs on, the profile it keeps, and
//! the sidecar that will drive it.
//!
//! No tool is offered to the chat yet. What exists here is everything the
//! first press needs — the download, the verification, the profile, and the
//! pin for the sidecar that step 3 starts.

pub(crate) mod commands;
pub(crate) mod state;

mod driver;
mod error;
mod fetch;
mod profile;
mod tree;
mod unpack;

// These three are the rules for starting the sidecar — which bytes, in which
// environment, against which tool definitions. The host that starts it is step
// 3, so today only their tests construct them; the allowance says exactly
// that, rather than a caller being invented to make the warning go away.
#[allow(dead_code)]
mod program;
#[allow(dead_code)]
mod server_env;
#[allow(dead_code)]
mod tool_pins;

/// The server id the host registers the browser sidecar under, and the prefix
/// its tools carry.
#[allow(dead_code)]
pub(crate) const SERVER: &str = "browser";