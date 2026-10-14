//! A read-only mailbox as an MCP server. It knows nothing about any host: the same
//! binary serves any MCP client over stdio.

pub mod bootstrap;
mod css_value;
mod domain;
mod encoded_word;
mod fence;
mod html_element;
mod html_hide;
mod html_text;

mod invisible;
mod link;
pub mod tools;
mod view;

pub mod account;
pub mod draft;
pub mod imap;
pub mod label;
pub mod mail;
pub mod mailbox;
pub mod mcp;
pub mod senders;
