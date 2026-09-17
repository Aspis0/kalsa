//! The boundary. Everything else in this crate is a convenience; this file
//! is the part that must be right.
//!
//! The page asks for a path and gets back bytes. That is a capability, and
//! the page is the least trustworthy thing in the program: it renders text
//! the model wrote, and the model reads documents that came from strangers.
//! So the answer to "which paths may be read" is decided HERE, in Rust, on
//! the canonical path — never in the page, and never on the string it sent.
//!
//! Two rules, both cheap and both necessary:
//!
//! 1. **Canonicalize first, compare second.** `..` is not stripped, it is
//!    resolved by the operating system, and so is every symlink on the way.
//!    A link inside Documents that points at `/etc` therefore fails the
//!    prefix test, because by the time we test it the path IS `/etc`.
//! 2. **Compare whole components, not string prefixes.** `/Users/mar` is a
//!    prefix of `/Users/marco` as text, and of nothing at all as a path.
//!    `Path::starts_with` compares components, which is why it is used here
//!    and `str::starts_with` is not.
//!
//! The roots are the folders a person actually keeps documents in. Not the
//! home directory itself: that holds `.ssh`, `.aws`, browser profiles and
//! every token this machine has ever been given. A picker has no business
//! in there, and the smaller the door the less there is to argue about.

use std::io;
use std::path::{Path, PathBuf};

/// Where the picker may look. Missing folders are simply absent — a machine
/// without a Downloads folder is not an error, it is a machine.
pub fn roots() -> Vec<PathBuf> {
    let Some(home) = home_dir() else {
        return Vec::new();
    };
    ["Desktop", "Documents", "Downloads"]
        .iter()
        .map(|name| home.join(name))
        .filter(|path| path.is_dir())
        .collect()
}

/// The home directory, from the environment the OS sets.
///
/// `HOME` on unix; on Windows `USERPROFILE`, falling back to the
/// `HOMEDRIVE` + `HOMEPATH` pair that older setups still provide.
pub fn home_dir() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(home));
    }
    if let Some(profile) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(profile));
    }
    let drive = std::env::var_os("HOMEDRIVE")?;
    let path = std::env::var_os("HOMEPATH")?;
    if drive.is_empty() || path.is_empty() {
        return None;
    }
    let mut joined = PathBuf::from(drive);
    joined.push(PathBuf::from(path));
    Some(joined)
}

/// Resolve `candidate` and return it only if it lies inside one of `roots`.
///
/// The returned path is the canonical one: callers open THAT, never the
/// string they were given, so the check and the open cannot disagree about
/// which file they mean.
///
/// A path that does not exist is rejected. This costs the caller a clear
/// "not found" instead of a silent empty listing, and it is what makes the
/// canonical comparison possible at all.
pub fn resolve_within(candidate: &Path, roots: &[PathBuf]) -> Result<PathBuf, ScopeError> {
    let real = candidate.canonicalize().map_err(ScopeError::Unresolvable)?;
    for root in roots {
        let Ok(real_root) = root.canonicalize() else {
            continue;
        };
        if real.starts_with(&real_root) {
            return Ok(real);
        }
    }
    Err(ScopeError::OutsideRoots)
}

#[derive(Debug)]
pub enum ScopeError {
    /// The path does not exist, or the process may not traverse to it.
    Unresolvable(io::Error),
    /// It exists, and it is somewhere the picker does not go.
    OutsideRoots,
}

impl std::fmt::Display for ScopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // The cause is deliberately not repeated: an error string that
            // says which paths do and do not exist is a probing oracle for
            // whatever wrote the path.
            Self::Unresolvable(_) => f.write_str("no such file"),
            Self::OutsideRoots => f.write_str("outside the folders this app reads"),
        }
    }
}

impl std::error::Error for ScopeError {}
