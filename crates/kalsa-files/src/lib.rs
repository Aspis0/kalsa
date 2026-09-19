//! The user's files, listed and found for the picker.
//!
//! Every chat app that runs in a browser shows you a list of files you have
//! already uploaded, because a web page cannot enumerate a disk. This app is
//! not a web page, so it can show the user *his own files* — and that is the
//! whole reason this crate exists.
//!
//! It is deliberately not a file manager. No copying, no renaming, no
//! deleting, no writing of any kind: this crate reads directory entries,
//! finds files by name, and hands back names, sizes, dates and paths.
//!
//! **The whole filesystem is in scope.** Until 2026-09-19 this crate bounded
//! every read to Desktop, Documents and Downloads; the owner removed that
//! boundary on the record — "togli qualsiasi protezione. Stiamo parlando di
//! modelli locali. La protezione è solo ad uscire, e in futuro un sandbox se
//! fa coding." The guarded direction is the one that LEAVES the machine, and
//! that guard lives elsewhere and stays: network egress happens only in Rust
//! (`kalsa-web` refuses loopback, private and inward-resolving addresses
//! twice), and the page's CSP admits this machine and nothing else. A local
//! model reading a local file sends it nowhere. [`scope`] is therefore not
//! permission but hygiene: canonicalize before use, refuse a path that does
//! not exist, and never lie in an error.
//!
//! What turns a chosen file into text lives in the page. A `.pdf` that is
//! not a PDF must fail in the parser with a real message, not be guessed at
//! here.

mod entry;
mod listing;
mod scope;
mod search;
mod spotlight;

pub use entry::{Entry, Kind};
pub use listing::{list_dir, Listing, MAX_ROWS};
pub use scope::{home_dir, resolve, roots, ScopeError};
pub use search::{
    searcher_for, NameSearch, SearchHit, SearchOutcome, Searcher, SpotlightSearch, WalkerSearch,
    MAX_RESULTS,
};

#[cfg(test)]
mod search_tests;
#[cfg(test)]
mod tests;
