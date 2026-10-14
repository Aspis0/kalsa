//! A read-only mailbox as an MCP server. It knows nothing about any host: the same
//! binary serves any MCP client over stdio.

pub mod bootstrap;
mod domain;
mod fence;
mod html_text;
mod link;
mod tools;
mod view;

pub mod account;
pub mod draft;
pub mod imap;
pub mod label;
pub mod mail;
pub mod mailbox;
pub mod mcp;
pub mod senders;
