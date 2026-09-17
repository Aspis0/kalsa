//! The few folders a person keeps documents in, listed for the picker.
//!
//! Every chat app that runs in a browser shows you a list of files you have
//! already uploaded, because a web page cannot enumerate a disk. This app is
//! not a web page, so it can show the user *his own files* — and that is the
//! whole reason this crate exists.
//!
//! It is deliberately not a file manager. No copying, no renaming, no
//! deleting, no writing of any kind: this crate only reads directory entries
//! and hands back names, sizes and dates. The one capability it grants the
//! page is "read a path", and [`scope`] is where that capability is bounded
//! — canonicalize first, then compare whole path components against a short
//! list of document folders. Not the home directory: that holds `.ssh`,
//! `.aws`, browser profiles and every token this machine has been given.
//!
//! What opens a chosen file and turns it into text lives elsewhere. This
//! crate's answers are labels on rows, and a `.pdf` that is not a PDF must
//! fail in the parser with a real message, not be guessed at here.

mod entry;
mod listing;
mod scope;

pub use entry::{Entry, Kind};
pub use listing::{list_dir, recent, Listing, MAX_RECENT, MAX_ROWS};
pub use scope::{home_dir, resolve_within, roots, ScopeError};

#[cfg(test)]
mod tests;
