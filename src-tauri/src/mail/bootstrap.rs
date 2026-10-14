use kalsa_mcp::secret::BootstrapSecret;
use serde::Serialize;
use zeroize::Zeroizing;

use super::account::MailAccount;
use super::error::MailError;
use super::providers;

/// The keys the sidecar's account line accepts. It refuses any other key, so this
/// struct must not grow fields the sidecar does not name.
#[derive(Serialize)]
struct Line<'a> {
    host: &'a str,
    port: u16,
    user: &'a str,
    password: &'a str,
    tls: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    authserv_id: Option<&'a str>,
}

pub(crate) fn line(account: &MailAccount, password: &str) -> Result<Zeroizing<String>, MailError> {
    let line = Line {
        host: &account.host,
        port: account.port,
        user: &account.user,
        password,
        tls: account.tls(),
        authserv_id: providers::guess(&account.email).and_then(|guess| guess.authserv_id),
    };
    serde_json::to_string(&line).map(Zeroizing::new).map_err(|_| MailError::Failed)
}

/// The line as a secret the host writes once. The bytes move into the secret,
/// which wipes them when it is dropped.
pub(crate) fn secret(account: &MailAccount, password: &str) -> Result<BootstrapSecret, MailError> {
    let mut line = line(account, password)?;
    BootstrapSecret::new(std::mem::take(&mut *line)).map_err(|_| MailError::InvalidAccount)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAKE_PASSWORD: &str = "fake-password-for-a-test";

    fn keys(line: &str) -> Vec<String> {
        let parsed: serde_json::Value = serde_json::from_str(line).expect("json");
        let mut keys: Vec<String> = parsed.as_object().expect("object").keys().cloned().collect();
        keys.sort_unstable();
        keys
    }

    #[test]
    fn the_line_has_exactly_the_keys_the_sidecar_accepts() {
        let account = MailAccount::new("lab@example.test", "127.0.0.1", 1260, None).expect("valid");
        let line = line(&account, FAKE_PASSWORD).expect("built");
        assert!(!line.contains('\n') && !line.contains('\r'));
        assert_eq!(line.matches(FAKE_PASSWORD).count(), 1);
        assert_eq!(keys(&line), ["host", "password", "port", "tls", "user"]);
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("json");
        assert_eq!(parsed["host"], "127.0.0.1");
        assert_eq!(parsed["port"], 1260);
        assert_eq!(parsed["tls"], false);
        assert_eq!(parsed["password"], FAKE_PASSWORD);
    }

    #[test]
    fn gmail_names_its_authserv_id_and_other_providers_do_not() {
        let gmail = MailAccount::new("anna@gmail.com", "imap.gmail.com", 993, None).expect("valid");
        let line = line(&gmail, FAKE_PASSWORD).expect("built");
        assert!(keys(&line).contains(&"authserv_id".to_owned()));
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("json");
        assert_eq!(parsed["authserv_id"], "mx.google.com");

        let other = MailAccount::new("anna@example.it", "imap.example.it", 993, None).expect("valid");
        assert!(!keys(&line_of(&other)).contains(&"authserv_id".to_owned()));
    }

    fn line_of(account: &MailAccount) -> String {
        line(account, FAKE_PASSWORD).expect("built").to_string()
    }

    #[test]
    fn a_password_with_a_newline_cannot_split_the_line() {
        let account = MailAccount::new("lab@example.test", "imap.example.test", 993, None).expect("valid");
        let line = line(&account, "first\nsecond").expect("built");
        assert!(!line.contains('\n'));
        assert!(secret(&account, "first\nsecond").is_ok());
    }
}
