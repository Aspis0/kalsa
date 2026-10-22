//! The browser already installed on this computer, driven through its
//! accessibility tree and exposed as an MCP server over stdio. It knows nothing
//! about any host: the same binary serves any MCP client.
//!
//! The modules a second binary legitimately needs are public — the lab in
//! `dev/lab-browser-rs` drives the same page through the same rules, the
//! proofs in `tests/` take the same picture of a real page, and the desktop
//! app pins `tools::tool_definitions()` against its checked-in `tool_pins.json`,
//! so all three depend on this crate rather than carrying a second copy. The
//! rest is inside the server.

mod body;
mod label;
pub mod env;
pub mod find_browser;
pub mod guard;
pub mod hold;
pub mod input;
pub mod launch;
pub mod landing;
pub mod mcp;
pub mod preview;
pub mod session;
pub mod snapshot;
pub mod submit;
pub mod tools;

mod context;
mod driver_env;
mod external;
pub(crate) mod failure;
mod refs;
pub mod robot;
pub mod secret;
#[cfg(test)]
mod tests;
mod tree;
mod view;