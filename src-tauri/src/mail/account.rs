use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::error::MailError;

/// The account as it is saved on disk. The password is not here: it lives in the keychain.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct MailAccount {
    pub(crate) email: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) user: String,
}

impl MailAccount {
    /// Checks what is typed in. Only the shape is checked here: whether the
    /// server answers is the account test's job.
    pub(crate) fn new(email: &str, host: &str, port: u16, user: Option<&str>) -> Result<Self, MailError> {
        let email = email.trim().to_ascii_lowercase();
        let host = host.trim().to_ascii_lowercase();
        let user = user.map(str::trim).filter(|user| !user.is_empty()).unwrap_or(&email).to_owned();
        if !valid_email(&email) || !valid_host(&host) || port == 0 || !printable(&user) {
            return Err(MailError::InvalidAccount);
        }
        Ok(Self { email, host, port, user })
    }

    /// The keychain account name: one saved password per address.
    pub(crate) fn account_id(&self) -> &str {
        &self.email
    }

    pub(crate) fn tls(&self) -> bool {
        tls_for(&self.host, cfg!(debug_assertions))
    }
}

/// Plaintext reaches only the fixture server on this machine, and only in a debug build.
fn tls_for(host: &str, debug_build: bool) -> bool {
    !(debug_build && matches!(host, "localhost" | "127.0.0.1"))
}

fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && email.len() <= 254
        && email.chars().all(|c| c.is_ascii_graphic())
        && !domain.starts_with('.')
        && !domain.ends_with('.')
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
        && !host.starts_with(['-', '.'])
}

fn printable(text: &str) -> bool {
    text.len() <= 254 && !text.chars().any(char::is_control)
}

const FILE_NAME: &str = "mail-account.json";

/// `None` when no account was ever saved. A file that does not parse, or that
/// fails the same checks as typing does, is a storage failure, not an empty account.
pub(crate) fn load(state_file: &Path) -> Result<Option<MailAccount>, MailError> {
    let bytes = match fs::read(path_for(state_file)) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(MailError::Storage),
    };
    let saved: MailAccount = serde_json::from_slice(&bytes).map_err(|_| MailError::Storage)?;
    MailAccount::new(&saved.email, &saved.host, saved.port, Some(&saved.user))
        .map(Some)
        .map_err(|_| MailError::Storage)
}

pub(crate) fn save(state_file: &Path, account: &MailAccount) -> Result<(), MailError> {
    let bytes = serde_json::to_vec_pretty(account).map_err(|_| MailError::Storage)?;
    crate::options::write_atomic(&path_for(state_file), &bytes, |_| Ok(())).map_err(|_| MailError::Storage)
}

pub(crate) fn delete(state_file: &Path) -> Result<(), MailError> {
    match fs::remove_file(path_for(state_file)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(MailError::Storage),
    }
}

/// Beside the other saved settings, in the app's data directory.
fn path_for(state_file: &Path) -> PathBuf {
    state_file.with_file_name(FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-mail-account-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch dir");
        dir.join("server.state")
    }

    #[test]
    fn a_typed_account_is_normalised_and_its_user_defaults_to_the_address() {
        let account = MailAccount::new("  Anna@Example.IT ", "IMAP.Example.it", 993, None).expect("valid");
        assert_eq!(account.email, "anna@example.it");
        assert_eq!(account.host, "imap.example.it");
        assert_eq!(account.user, "anna@example.it");
        assert!(account.tls());
    }

    #[test]
    fn malformed_addresses_hosts_and_ports_are_refused() {
        for (email, host, port) in [
            ("no-at-sign", "imap.example.it", 993),
            ("anna@nodot", "imap.example.it", 993),
            ("anna@example.it", "bad host", 993),
            ("anna@example.it", "-leading.it", 993),
            ("anna@example.it", "imap.example.it", 0),
        ] {
            assert_eq!(MailAccount::new(email, host, port, None), Err(MailError::InvalidAccount), "{email} {host} {port}");
        }
    }

    #[test]
    fn a_release_build_has_no_plaintext_host_at_all() {
        assert!(tls_for("127.0.0.1", false));
        assert!(tls_for("localhost", false));
        assert!(!tls_for("127.0.0.1", true));
        assert!(tls_for("imap.example.test", true));
    }

    #[test]
    fn loopback_is_plain_and_everything_else_is_tls() {
        let lab = MailAccount::new("lab@example.test", "127.0.0.1", 1244, None).expect("valid");
        assert!(!lab.tls());
        let remote = MailAccount::new("lab@example.test", "imap.example.test", 993, None).expect("valid");
        assert!(remote.tls());
    }

    #[test]
    fn an_account_round_trips_and_a_missing_one_is_none() {
        let state = scratch("round-trip");
        assert_eq!(load(&state), Ok(None));
        let account = MailAccount::new("anna@example.it", "imap.example.it", 993, Some("anna")).expect("valid");
        save(&state, &account).expect("saved");
        assert_eq!(load(&state), Ok(Some(account)));
        delete(&state).expect("deleted");
        delete(&state).expect("deleting twice is fine");
        assert_eq!(load(&state), Ok(None));
    }

    #[test]
    fn a_corrupt_account_file_is_a_storage_failure_not_an_empty_account() {
        let state = scratch("corrupt");
        fs::write(path_for(&state), b"{ not json").expect("written");
        assert_eq!(load(&state), Err(MailError::Storage));
    }
}
