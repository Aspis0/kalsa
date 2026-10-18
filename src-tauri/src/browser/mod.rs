//! The browser in the app: the driver it runs on, the profile it keeps, and
//! the sidecar that will drive it.
//!
//! The chat is offered three read tools over one sidecar that lives from the
//! first call to the window closing.

pub(crate) mod codes;
pub(crate) mod commands;
pub(crate) mod confirm;
pub(crate) mod host;
pub(crate) mod pending;
pub(crate) mod session;
pub(crate) mod state;
pub(crate) mod window;

mod driver;
mod error;
mod fetch;
mod profile;
mod tree;
mod unpack;

mod program;
mod server_env;
mod tool_pins;

#[cfg(test)]
mod live;

/// The server id the host registers the browser sidecar under, and the prefix
/// its tools carry.
pub(crate) const SERVER: &str = "browser";