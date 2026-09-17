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

use std::ffi::{OsStr, OsString};
use std::io;
use std::path::{Path, PathBuf};

/// Where the picker may look. Missing folders are simply absent — a machine
/// without a Downloads folder is not an error, it is a machine.
pub fn roots() -> Vec<PathBuf> {
    roots_under(home_dir().as_deref())
}

/// The pure half of [`roots`]: the three document names resolved from
/// `home` — wherever each name POINTS, which may be another disk — minus
/// any that resolve to a folder containing the home itself. The canonical
/// forms are what get returned, so every [`resolve_within`] call re-derives
/// containment from exactly the paths that were vetted here.
///
/// The accepted limit, on the record: a root that resolves to a sibling or
/// unrelated directory (`Documents -> /etc`, `-> /Users/someone-else`) IS
/// kept. Its canonical form does not contain the home, and a path-based
/// check cannot tell an attacker-chosen target from a user-chosen one —
/// that is the same mechanism that keeps the external-disk setup working.
/// No device-id rule or string heuristic closes it either; both break on a
/// machine with `/home` on its own partition. Whoever wires this up decides
/// whether that door is acceptable.
///
/// No home, no roots.
pub(crate) fn roots_under(home: Option<&Path>) -> Vec<PathBuf> {
    let Some(home) = home else {
        return Vec::new();
    };
    // Without a canonical home the containment test below cannot run, and a
    // check that cannot run approves everything. No roots is the safe answer.
    let Ok(real_home) = home.canonicalize() else {
        return Vec::new();
    };
    ["Desktop", "Documents", "Downloads"]
        .iter()
        .map(|name| home.join(name))
        .filter(|path| path.is_dir())
        .filter_map(|path| {
            // `is_dir` follows symlinks, so a candidate root may resolve
            // anywhere — `Documents -> /` would make `resolve_within`
            // approve every path on the disk, because every path starts
            // with `/`. A root whose canonical form CONTAINS the home is
            // therefore refused. The canonical form is also what is
            // RETURNED: the raw name was never vetted whenever it differs
            // from it, and resolve_within would re-canonicalize the raw
            // name on every call, following whatever the name points at
            // by then. This narrows the swap window to what later happens
            // at the canonical path itself — the open-handle problem,
            // deliberately not solved here.
            let real_root = path.canonicalize().ok()?;
            (!real_home.starts_with(&real_root)).then_some(real_root)
        })
        .collect()
}

/// The home directory, from the environment the OS sets.
///
/// The platform's own variable first — `HOME` on unix, `USERPROFILE` on
/// Windows, where a `HOME` set by a unix-y shell (`/c/Users/...`) would
/// never survive `is_dir`. Then the other one, then the `HOMEDRIVE` +
/// `HOMEPATH` pair that older setups still provide.
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

/// Resolve `candidate` and return it only if it lies inside one of `roots`.
///
/// The returned path is canonical at the moment of the check; callers open
/// THAT, never the string they were given. The disk can still move under
/// the path before the open — what holds then is decided where the file is
/// opened, not by this function.
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

pub enum ScopeError {
    /// The path does not exist, or the process may not traverse to it.
    Unresolvable(io::Error),
    /// It exists, and it is somewhere the picker does not go.
    OutsideRoots,
}

impl std::fmt::Debug for ScopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Delegating to Display, because a derived Debug would distinguish
        // NotFound from PermissionDenied and map the disk by existence —
        // the same oracle Display refuses to be, and `{:?}` is what logs
        // and `unwrap()` actually print.
        std::fmt::Display::fmt(self, f)
    }
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
