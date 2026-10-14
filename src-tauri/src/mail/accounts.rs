use std::path::Path;

use serde::Deserialize;
use zeroize::Zeroizing;

use super::account::{self, MailAccount};
use super::error::MailError;
use super::host;
use super::keychain::PasswordStore;
use super::providers::{self, Setup};
use super::state::MailState;

/// What the account form sends. `host` and `port` may be left out for a known provider.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AccountForm {
    email: String,
    host: Option<String>,
    port: Option<u16>,
    user: Option<String>,
    password: Zeroizing<String>,
}

/// Saves an account. The new password is stored before the account names it, and the
/// previous account's password goes only after the new account is written, so a
/// failure in between leaves the saved account whole.
pub(crate) async fn save(
    state: &MailState,
    store: &impl PasswordStore,
    state_file: &Path,
    form: AccountForm,
) -> Result<MailAccount, MailError> {
    let account = typed_account(&form)?;
    let mut slot = state.lock().await;
    slot.forget();
    let previous = account::load(state_file)?;
    store.save(account.account_id(), &form.password)?;
    if let Err(error) = account::save(state_file, &account) {
        if previous.as_ref().is_none_or(|old| old.account_id() != account.account_id()) {
            let _ = store.delete(account.account_id());
        }
        return Err(error);
    }
    if let Some(old) = previous.filter(|old| old.account_id() != account.account_id()) {
        store.delete(old.account_id())?;
    }
    Ok(account)
}

/// Removes the saved account and its password. A saved account that cannot be read is
/// refused rather than dropped, because its password may still be in the keychain.
pub(crate) async fn delete(state: &MailState, store: &impl PasswordStore, state_file: &Path) -> Result<(), MailError> {
    let mut slot = state.lock().await;
    slot.forget();
    if let Some(saved) = account::load(state_file)? {
        store.delete(saved.account_id())?;
    }
    account::delete(state_file)
}

/// Starts a sidecar for the saved account and lists the newest mails. Only the saved
/// password is used: the caller cannot choose the server or supply a password.
pub(crate) async fn test_saved(
    state: &MailState,
    store: &impl PasswordStore,
    state_file: &Path,
) -> Result<Vec<String>, MailError> {
    let (account, password) = {
        let _slot = state.lock().await;
        let account = account::load(state_file)?.ok_or(MailError::NotConfigured)?;
        let password = store.read(account.account_id())?;
        (account, password)
    };
    host::probe(&account, &password).await
}

/// The account the form typed. A known provider fills in the server its own help page
/// states; a provider that cannot be set up in step one is refused.
fn typed_account(form: &AccountForm) -> Result<MailAccount, MailError> {
    if form.password.is_empty() {
        return Err(MailError::InvalidAccount);
    }
    let known = providers::guess(&form.email);
    let (guessed_host, guessed_port) = match known.map(|guess| &guess.setup) {
        Some(Setup::Unsupported) => return Err(MailError::UnsupportedProvider),
        Some(Setup::Guessed { host, port }) => (Some(*host), Some(*port)),
        None => (None, None),
    };
    let host = form
        .host
        .clone()
        .or_else(|| guessed_host.map(str::to_owned))
        .ok_or(MailError::InvalidAccount)?;
    let port = form.port.or(guessed_port).unwrap_or(993);
    let local_part = known
        .filter(|guess| guess.local_part_username)
        .and_then(|_| form.email.split_once('@').map(|(local, _)| local.to_owned()));
    let user = form.user.clone().or(local_part);
    MailAccount::new(&form.email, &host, port, user.as_deref())
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::sync::{mpsc, Arc, LazyLock};
    use std::time::Duration;

    use super::*;
    use crate::mail::keychain::Memory;

    static STORE: LazyLock<Memory> = LazyLock::new(Memory::default);

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-mail-accounts-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir.join("server.state")
    }

    /// An account with its server given, for tests of the saved account rather than of provider guesses.
    fn hosted(email: &str, password: &str) -> AccountForm {
        AccountForm {
            email: email.into(),
            host: Some("imap.example.test".into()),
            port: None,
            user: None,
            password: Zeroizing::new(password.into()),
        }
    }

    fn form(email: &str, password: &str) -> AccountForm {
        AccountForm {
            email: email.into(),
            host: None,
            port: None,
            user: None,
            password: Zeroizing::new(password.into()),
        }
    }

    #[test]
    fn the_form_fills_the_server_of_a_known_provider_and_nothing_else() {
        let account = typed_account(&form("anna@aruba.it", "fake-password")).expect("guessed");
        assert_eq!((account.host.as_str(), account.port), ("imap.aruba.it", 993));
        assert_eq!(typed_account(&form("anna@example.it", "fake-password")), Err(MailError::InvalidAccount));
        let gmail = typed_account(&form("anna@gmail.com", "fake-password")).expect("gmail is guessed");
        assert_eq!((gmail.host.as_str(), gmail.port, gmail.user.as_str()), ("imap.gmail.com", 993, "anna@gmail.com"));
    }

    #[test]
    fn icloud_defaults_to_the_part_before_the_at_sign() {
        let icloud = typed_account(&form("anna@icloud.com", "fake-password")).expect("icloud is guessed");
        assert_eq!(icloud.user, "anna");
        let mut typed = form("anna@icloud.com", "fake-password");
        typed.user = Some("anna@icloud.com".into());
        assert_eq!(typed_account(&typed).expect("typed").user, "anna@icloud.com");
    }

    #[test]
    fn outlook_is_refused_in_step_one_whatever_server_is_typed() {
        let mut typed = form("anna@hotmail.com", "fake-password");
        typed.host = Some("outlook.office365.com".into());
        assert_eq!(typed_account(&typed), Err(MailError::UnsupportedProvider));
    }

    #[test]
    fn a_form_without_a_password_is_refused() {
        assert_eq!(typed_account(&form("anna@gmail.com", "")), Err(MailError::InvalidAccount));
    }

    #[test]
    fn replacing_the_account_removes_the_previous_password() {
        let state = MailState::default();
        let file = scratch("replace");
        let first = format!("first-{}@example.test", std::process::id());
        let second = format!("second-{}@example.test", std::process::id());
        tauri::async_runtime::block_on(save(&state, &*STORE, &file, hosted(&first, "pw-one"))).expect("first saved");
        tauri::async_runtime::block_on(save(&state, &*STORE, &file, hosted(&second, "pw-two"))).expect("second saved");
        assert_eq!(STORE.read(&first).err(), Some(MailError::NotConfigured));
        assert_eq!(STORE.read(&second).expect("kept").as_str(), "pw-two");
    }

    #[test]
    fn a_saved_account_that_cannot_be_read_stops_a_save_before_anything_is_written() {
        let state = MailState::default();
        let file = scratch("corrupt-save");
        std::fs::write(file.with_file_name("mail-account.json"), b"{ not json").expect("written");
        let email = format!("blocked-{}@example.test", std::process::id());
        let refused = tauri::async_runtime::block_on(save(&state, &*STORE, &file, hosted(&email, "pw")));
        assert_eq!(refused.err(), Some(MailError::Storage));
        assert_eq!(STORE.read(&email).err(), Some(MailError::NotConfigured));
    }

    #[test]
    fn a_saved_account_that_cannot_be_read_is_not_deleted_silently() {
        let state = MailState::default();
        let file = scratch("corrupt-delete");
        std::fs::write(file.with_file_name("mail-account.json"), b"{ not json").expect("written");
        let refused = tauri::async_runtime::block_on(delete(&state, &*STORE, &file));
        assert_eq!(refused.err(), Some(MailError::Storage));
        assert!(file.with_file_name("mail-account.json").exists());
    }

    #[test]
    fn a_delete_waits_for_the_lock_that_another_operation_holds() {
        let state = Arc::new(MailState::default());
        let file = scratch("race-delete");
        let email = format!("race-delete-{}@example.test", std::process::id());
        tauri::async_runtime::block_on(save(&state, &*STORE, &file, hosted(&email, "pw"))).expect("saved");

        let holder = tauri::async_runtime::block_on(state.lock());
        let (done_tx, done_rx) = mpsc::channel();
        let worker = {
            let (state, file) = (state.clone(), file.clone());
            std::thread::spawn(move || {
                let result = tauri::async_runtime::block_on(delete(&state, &*STORE, &file));
                let _ = done_tx.send(result);
            })
        };
        assert!(done_rx.recv_timeout(Duration::from_millis(200)).is_err(), "the delete ran under a held lock");
        drop(holder);
        let finished = done_rx.recv_timeout(Duration::from_secs(10)).expect("the delete finishes once the lock is free");
        assert!(finished.is_ok());
        worker.join().expect("worker joins");
        assert_eq!(STORE.read(&email).err(), Some(MailError::NotConfigured));
    }

    #[test]
    fn a_save_waits_for_the_lock_that_another_operation_holds() {
        let state = Arc::new(MailState::default());
        let file = scratch("race-save");
        let email = format!("race-save-{}@example.test", std::process::id());

        let holder = tauri::async_runtime::block_on(state.lock());
        let (done_tx, done_rx) = mpsc::channel();
        let worker = {
            let (state, file, email) = (state.clone(), file.clone(), email.clone());
            std::thread::spawn(move || {
                let result = tauri::async_runtime::block_on(save(&state, &*STORE, &file, hosted(&email, "pw")));
                let _ = done_tx.send(result.map(|_| ()));
            })
        };
        assert!(done_rx.recv_timeout(Duration::from_millis(200)).is_err(), "the save ran under a held lock");
        drop(holder);
        assert!(done_rx.recv_timeout(Duration::from_secs(10)).expect("the save finishes").is_ok());
        worker.join().expect("worker joins");
    }
}
