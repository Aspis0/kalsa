//! The sidecar program, and the digest it is approved with.
//!
//! Shaped on `mail/program.rs`, and for the same reason: the bytes that drive a
//! person's browser are checked against a digest before they start, and a
//! developer running their own build says out loud which bytes those are
//! (`KALSA_BROWSER_SERVER_BIN` plus `KALSA_BROWSER_SERVER_SHA256`, the rule
//! `KALSA_BRAIN_SERVER_BIN` already follows).
//!
//! A release build takes the bundled copy and the approved digest alone: the
//! override is not compiled in, so a shipped Kalsa cannot be pointed at another
//! program by an environment variable.

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::error::BrowserError;

/// Set by the release build from `KALSA_BROWSER_SHA256`. A dev build leaves it
/// unset, so the bundled sidecar does not start.
const APPROVED_SHA256: Option<&str> = option_env!("KALSA_BROWSER_SHA256");

const PROGRAM: &str = if cfg!(windows) { "kalsa-browser.exe" } else { "kalsa-browser" };
const DEV_PATH_ENV: &str = "KALSA_BROWSER_SERVER_BIN";
const DEV_SHA256_ENV: &str = "KALSA_BROWSER_SERVER_SHA256";

/// A sidecar whose bytes were checked against the digest it is approved with.
pub(crate) struct Program {
    pub(crate) path: PathBuf,
    pub(crate) sha256: String,
}

/// Either a developer's own build with the digest they state, or the bundled
/// copy with the approved digest.
pub(crate) fn current() -> Result<Program, BrowserError> {
    let (dev_path, dev_sha256) = dev_override();
    resolve(dev_path, dev_sha256, bundled_dir().as_deref())
}

#[cfg(debug_assertions)]
fn dev_override() -> (Option<PathBuf>, Option<String>) {
    (std::env::var_os(DEV_PATH_ENV).map(PathBuf::from), std::env::var(DEV_SHA256_ENV).ok())
}

/// A release build takes its sidecar from the bundle only, so the override is
/// not compiled in — the names are not even in the binary.
#[cfg(not(debug_assertions))]
fn dev_override() -> (Option<PathBuf>, Option<String>) {
    (None, None)
}

pub(crate) fn resolve(
    dev_path: Option<PathBuf>,
    dev_sha256: Option<String>,
    bundled_dir: Option<&Path>,
) -> Result<Program, BrowserError> {
    let (path, expected) = match dev_path {
        Some(path) => (path, dev_sha256.ok_or(BrowserError::Storage)?),
        None => {
            let dir = bundled_dir.ok_or(BrowserError::Storage)?;
            (dir.join(PROGRAM), APPROVED_SHA256.ok_or(BrowserError::Storage)?.to_owned())
        }
    };
    let actual = digest_of(&path)?;
    if actual != expected.to_ascii_lowercase() {
        return Err(BrowserError::Changed);
    }
    Ok(Program { path, sha256: actual })
}

/// The directory the app runs from, where the bundled sidecar is expected to sit.
fn bundled_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

fn digest_of(path: &Path) -> Result<String, BrowserError> {
    let bytes = fs::read(path).map_err(|_| BrowserError::Storage)?;
    Ok(Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn written(name: &str, bytes: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!("kalsa-browser-program-{}-{name}", std::process::id()));
        fs::write(&path, bytes).expect("scratch file");
        path
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn a_program_matching_its_stated_digest_is_accepted_in_any_case() {
        let path = written("match", b"sidecar build A");
        let approved =
            resolve(Some(path.clone()), Some(sha(b"sidecar build A").to_uppercase()), None)
                .expect("the digest matches");
        assert_eq!(approved.path, path);
        assert_eq!(approved.sha256, sha(b"sidecar build A"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn a_program_that_differs_from_its_digest_is_refused() {
        let path = written("differs", b"sidecar build B");
        let refused = resolve(Some(path.clone()), Some(sha(b"sidecar build A")), None).err();
        assert_eq!(refused, Some(BrowserError::Changed));
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn a_program_without_a_stated_digest_or_on_disk_is_not_approved() {
        let path = written("no-digest", b"sidecar build C");
        assert_eq!(resolve(Some(path.clone()), None, None).err(), Some(BrowserError::Storage));
        let _ = fs::remove_file(&path);
        let missing = std::env::temp_dir().join("kalsa-browser-program-missing");
        assert_eq!(resolve(Some(missing), Some(sha(b"")), None).err(), Some(BrowserError::Storage));
        assert_eq!(resolve(None, None, None).err(), Some(BrowserError::Storage));
    }

    /// The override is a developer's door, and a release has no door: the names
    /// are not compiled in at all, so setting them changes nothing.
    #[test]
    #[cfg(not(debug_assertions))]
    fn a_release_build_has_no_override_to_set() {
        assert_eq!(dev_override(), (None, None));
        std::env::set_var(DEV_PATH_ENV, "/tmp/anything");
        std::env::set_var(DEV_SHA256_ENV, sha(b""));
        assert_eq!(dev_override(), (None, None));
    }

    #[test]
    fn a_bundled_program_is_taken_from_next_to_the_app_and_needs_the_approved_digest() {
        let dir = std::env::temp_dir().join(format!("kalsa-browser-bundle-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let program = dir.join(PROGRAM);
        std::fs::write(&program, b"bundled sidecar").expect("program");
        // Nothing but a missing approval, because a dev build has no pin.
        assert_eq!(
            resolve(None, None, Some(&dir)).err(),
            Some(BrowserError::Storage),
            "a build without KALSA_BROWSER_SHA256 must not start the bundled sidecar"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}