//! Kalsa's MCP host. It starts the servers in a [`Registry`], lists their tools
//! for the model as `<server>.<tool>`, and decides every call itself: Allow,
//! Ask (the caller confirms the exact arguments) or Deny. A tool whose
//! definition or whose server binary changed since the approval is Deny until
//! it is approved again.

pub mod error;
pub mod host;
pub mod launch;
pub mod listing;
pub mod name;
pub mod outcome;
pub mod permission;
pub mod pins;
pub mod record;
pub mod registry;
pub mod secret;
pub mod server_id;

mod digest;
mod session;
