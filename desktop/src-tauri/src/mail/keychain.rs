use keyring::Entry;
use zeroize::Zeroizing;

use super::error::MailError;

/// The bundle identifier with a suffix, so the keychain groups Kalsa's items.
const SERVICE: &str = "ai.kalsa.brain.mail";

/// Where a mail password is kept.
pub(crate) trait PasswordStore {
    fn save(&self, account: &str, password: &str) -> Result<(), MailError>;
    fn read(&self, account: &str) -> Result<Zeroizing<String>, MailError>;
    fn delete(&self, account: &str) -> Result<(), MailError>;
}

pub(crate) struct Keychain;

impl PasswordStore for Keychain {
    fn save(&self, account: &str, password: &str) -> Result<(), MailError> {
        entry(account)?.set_password(password).map_err(|_| MailError::Keychain)
    }

    fn read(&self, account: &str) -> Result<Zeroizing<String>, MailError> {
        match entry(account)?.get_password() {
            Ok(password) => Ok(Zeroizing::new(password)),
            Err(keyring::Error::NoEntry) => Err(MailError::NotConfigured),
            Err(_) => Err(MailError::Keychain),
        }
    }

    fn delete(&self, account: &str) -> Result<(), MailError> {
        match entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(MailError::Keychain),
        }
    }
}

fn entry(account: &str) -> Result<Entry, MailError> {
    Entry::new(SERVICE, account).map_err(|_| MailError::Keychain)
}

/// Holds passwords in memory, so no test touches the real keychain.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct Memory(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl PasswordStore for Memory {
    fn save(&self, account: &str, password: &str) -> Result<(), MailError> {
        self.0.lock().unwrap().insert(account.to_owned(), password.to_owned());
        Ok(())
    }

    fn read(&self, account: &str) -> Result<Zeroizing<String>, MailError> {
        self.0.lock().unwrap().get(account).cloned().map(Zeroizing::new).ok_or(MailError::NotConfigured)
    }

    fn delete(&self, account: &str) -> Result<(), MailError> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}
