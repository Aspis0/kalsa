//! Mail in the chat: the account the owner saved, the keychain that holds its
//! password, and the MCP host that starts the mail sidecar and calls it.

pub(crate) mod commands;
pub(crate) mod state;

mod account;
mod accounts;
mod bootstrap;
mod error;
mod host;
mod keychain;
mod program;
mod providers;
mod tool_pins;

#[cfg(test)]
mod live_tests;
