use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use super::error::MailError;

/// Set by the release build from `KALSA_MAIL_SHA256`. A dev build leaves it unset,
/// so the bundled sidecar does not start (docs/PLAN-MAIL-MCP-2026-10-14.md, Release wiring).
const APPROVED_SHA256: Option<&str> = option_env!("KALSA_MAIL_SHA256");

const PROGRAM: &str = if cfg!(windows) { "kalsa-mail.exe" } else { "kalsa-mail" };
const DEV_PATH_ENV: &str = "KALSA_MAIL_SERVER_BIN";
const DEV_SHA256_ENV: &str = "KALSA_MAIL_SERVER_SHA256";

/// A sidecar whose bytes were checked against the digest it is approved with.
pub(crate) struct Program {
    pub(crate) path: PathBuf,
    pub(crate) sha256: String,
}

/// Either a developer's own build with the digest they state (the engine's
/// `KALSA_BRAIN_SERVER_BIN` rule: the developer owns the bytes), or the bundled
/// copy with the approved digest.
pub(crate) fn current() -> Result<Program, MailError> {
    let (dev_path, dev_sha256) = dev_override();
    resolve(dev_path, dev_sha256, bundled_dir().as_deref())
}

#[cfg(debug_assertions)]
fn dev_override() -> (Option<PathBuf>, Option<String>) {
    (std::env::var_os(DEV_PATH_ENV).map(PathBuf::from), std::env::var(DEV_SHA256_ENV).ok())
}

/// A release build takes its sidecar from the bundle only, so the override is not compiled in.
#[cfg(not(debug_assertions))]
fn dev_override() -> (Option<PathBuf>, Option<String>) {
    (None, None)
}

pub(crate) fn resolve(
    dev_path: Option<PathBuf>,
    dev_sha256: Option<String>,
    bundled_dir: Option<&Path>,
) -> Result<Program, MailError> {
    let (path, expected) = match dev_path {
        Some(path) => (path, dev_sha256.ok_or(MailError::NotApproved)?),
        None => {
            let dir = bundled_dir.ok_or(MailError::NotApproved)?;
            (dir.join(PROGRAM), APPROVED_SHA256.ok_or(MailError::NotApproved)?.to_owned())
        }
    };
    let actual = digest_of(&path)?;
    if actual != expected.to_ascii_lowercase() {
        return Err(MailError::ProgramChanged);
    }
    Ok(Program { path, sha256: actual })
}

/// The directory the app runs from, where the bundled sidecar is expected to sit.
fn bundled_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(Path::to_path_buf)
}

fn digest_of(path: &Path) -> Result<String, MailError> {
    let bytes = fs::read(path).map_err(|_| MailError::NotApproved)?;
    Ok(Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn written(name: &str, bytes: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!("kalsa-mail-program-{}-{name}", std::process::id()));
        fs::write(&path, bytes).expect("scratch file");
        path
    }

    fn sha(bytes: &[u8]) -> String {
        Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn a_program_matching_its_stated_digest_is_accepted_in_any_case() {
        let path = written("match", b"sidecar build A");
        let accepted = resolve(Some(path.clone()), Some(sha(b"sidecar build A").to_uppercase()), None)
            .expect("the digest matches");
        assert_eq!(accepted.path, path);
        assert_eq!(accepted.sha256, sha(b"sidecar build A"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn a_program_that_differs_from_its_digest_is_refused() {
        let path = written("differs", b"sidecar build B");
        let refused = resolve(Some(path.clone()), Some(sha(b"sidecar build A")), None).err();
        assert_eq!(refused, Some(MailError::ProgramChanged));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn a_program_without_a_stated_digest_or_on_disk_is_not_approved() {
        let path = written("no-digest", b"sidecar build C");
        assert_eq!(resolve(Some(path.clone()), None, None).err(), Some(MailError::NotApproved));
        let _ = fs::remove_file(&path);
        let missing = std::env::temp_dir().join("kalsa-mail-program-missing");
        assert_eq!(resolve(Some(missing), Some(sha(b"")), None).err(), Some(MailError::NotApproved));
    }
}
