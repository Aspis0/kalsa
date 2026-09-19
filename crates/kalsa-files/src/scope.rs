//! Path hygiene. This file was once the crate's boundary — every read was
//! checked against Desktop, Documents and Downloads, because a page that
//! renders what a model wrote must not be handed `~/.ssh`. On 2026-09-19 the
//! owner removed that boundary, on the record: "togli qualsiasi protezione.
//! Stiamo parlando di modelli locali. La protezione è solo ad uscire, e in
//! futuro un sandbox se fa coding." The whole filesystem is in scope.
//!
//! The reasoning, which this file no longer argues with: the guarded
//! direction is the one that LEAVES the machine. Network egress happens only
//! in Rust (`kalsa-web` refuses loopback, private and inward-resolving
//! addresses twice), the page's CSP admits this machine and nothing else,
//! and a local model reading a local file sends it nowhere. There is no
//! half-boundary here and no setting: a rule the disk can opt out of is not
//! a rule.
//!
//! What survives is the part that was never about permission:
//!
//! 1. **Canonicalize before use.** `..` is not stripped, it is resolved by
//!    the operating system, and so is every symlink on the way. Callers open
//!    the returned path, never the string they were given.
//! 2. **Refuse a path that does not exist.** This costs the caller a clear
//!    "not found" instead of a silent empty listing, and it is what makes
//!    canonicalization meaningful at all.
//! 3. **Keep the error honest.** Debug and Display tell the same story, and
//!    the story names the cause where the page can act on it.

use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};

/// The filesystem's roots: the place a browser starts. One root on unix,
/// the drive letters that exist on Windows.
pub fn roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        roots_from(|letter| PathBuf::from(format!("{letter}:\\")).is_dir())
    }
    #[cfg(not(windows))]
    {
        vec![PathBuf::from("/")]
    }
}

/// The pure half of [`roots`] on Windows: the drive letters that exist, in
/// order, as rooted paths (`C:\`). A drive-relative `C:` would read that
/// drive's current directory, so the separator is part of the answer.
/// The existence predicate is injected so the shape is testable on a
/// machine that has none of the drives — this crate's tests run everywhere,
/// which is why the function itself does too.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn roots_from(drive_exists: impl Fn(char) -> bool) -> Vec<PathBuf> {
    (b'A'..=b'Z')
        .map(|byte| byte as char)
        .filter(|letter| drive_exists(*letter))
        .map(|letter| PathBuf::from(format!("{letter}:\\")))
        .collect()
}

/// The user's home directory, from the environment the OS sets.
///
/// The platform's own variable first — `HOME` on unix, `USERPROFILE` on
/// Windows, where a `HOME` set by a unix-y shell (`/c/Users/...`) would
/// never survive `is_dir`. Then the other one, then the `HOMEDRIVE` +
/// `HOMEPATH` pair that older setups still provide. The page cannot guess
/// any of this; the roots command hands it over as the place browsing
/// usually starts.
pub fn home_dir() -> Option<PathBuf> {
    // The order is spelled out as data, not a `cfg!` inside the lookup, so
    // the tests exercise both platforms' ordering on every machine.
    let platform = if cfg!(windows) {
        ("USERPROFILE", "HOME")
    } else {
        ("HOME", "USERPROFILE")
    };
    home_dir_from(|name| std::env::var_os(name), platform)
}

/// The pure half of [`home_dir`]: the lookup over any table of variables.
/// `platform` names the variables in the order the OS means them —
/// `(own, borrowed)` — and the `HOMEDRIVE` + `HOMEPATH` pair that older
/// Windows setups still provide is the last resort.
pub(crate) fn home_dir_from(
    get: impl Fn(&str) -> Option<OsString>,
    platform: (&str, &str),
) -> Option<PathBuf> {
    let (own, borrowed) = platform;
    if let Some(home) = get(own).filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(home));
    }
    if let Some(home) = get(borrowed).filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(home));
    }
    let drive = get("HOMEDRIVE").filter(|v| !v.is_empty())?;
    let path = get("HOMEPATH").filter(|v| !v.is_empty())?;
    // `HOMEPATH` usually arrives rooted (`\Users\x`); `push` of a rooted
    // component discards the drive, so the pair is stitched as text.
    let mut joined: OsString = drive;
    if !starts_with_separator(&path) {
        joined.push(std::path::MAIN_SEPARATOR_STR);
    }
    joined.push(&path);
    Some(PathBuf::from(joined))
}

fn starts_with_separator(path: &OsStr) -> bool {
    matches!(path.as_encoded_bytes(), [b'/' | b'\\', ..])
}

/// Resolve `candidate` against the disk and return the canonical path.
///
/// The returned path is canonical at the moment of the check; callers open
/// THAT, never the string they were given. A path that does not exist — or
/// that the process may not traverse to — is an error, not an empty answer.
pub fn resolve(candidate: &Path) -> Result<PathBuf, ScopeError> {
    candidate.canonicalize().map_err(ScopeError::Unresolvable)
}

pub enum ScopeError {
    /// The path does not exist, or the process may not traverse to it.
    Unresolvable(io::Error),
}

impl std::fmt::Debug for ScopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Delegating to Display, so `{:?}` — what logs and `unwrap()`
        // actually print — tells the same story as `{}`.
        std::fmt::Display::fmt(self, f)
    }
}

impl std::fmt::Display for ScopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // The page can list any directory it likes, so naming the cause is
        // no longer a probing oracle — it is the difference between "typo"
        // and "the OS said no", which read as different bugs.
        let Self::Unresolvable(error) = self;
        match error.kind() {
            io::ErrorKind::NotFound => f.write_str("no such file"),
            io::ErrorKind::PermissionDenied => {
                f.write_str("the operating system refused to follow this path")
            }
            _ => f.write_str("the path could not be followed on this disk"),
        }
    }
}

impl std::error::Error for ScopeError {}
