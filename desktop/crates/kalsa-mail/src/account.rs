//! The account this process was started with.
//!
//! The password lives here and nowhere else: not in argv, not in the environment, not
//! in a log line. The struct has no `Debug` and no `Display`, so a future `{:?}` in a
//! panic or a log cannot reach it, and `Display` would be the same mistake with better
//! manners. Every field is private for the same reason: the one that must never be
//! wrong is `tls`, and only the constructor may decide it.

use serde::{de, Deserialize, Deserializer};
use zeroize::Zeroizing;

pub struct Account {
    host: String,
    port: u16,
    user: String,
    password: Zeroizing<String>,
    /// False only for a loopback host, which the fixture server runs on.
    tls: bool,
    /// The `authserv-id` of the person's own provider. Without it no
    /// `Authentication-Results` header is trusted, including our own.
    trusted_authserv_id: Option<String>,
    /// The address the reply comes from. A login name without an `@` is not one.
    from: Option<String>,
    /// Where replies are sent, when the person's provider has a known submission server.
    smtp: Option<(String, u16)>,
}

impl Account {
    pub fn host(&self) -> &str {
        &self.host
    }
    pub fn port(&self) -> u16 {
        self.port
    }
    pub fn user(&self) -> &str {
        &self.user
    }
    pub fn password(&self) -> &str {
        self.password.as_str()
    }
    pub fn tls(&self) -> bool {
        self.tls
    }
    pub fn from(&self) -> Option<&str> {
        self.from.as_deref()
    }
    pub fn smtp(&self) -> Option<(&str, u16)> {
        self.smtp.as_ref().map(|(host, port)| (host.as_str(), *port))
    }
    pub fn trusted_authserv_id(&self) -> Option<&str> {
        self.trusted_authserv_id.as_deref()
    }
    pub fn is_loopback(&self) -> bool {
        is_loopback(&self.host)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BootstrapLine<'a> {
    #[serde(borrow)]
    host: &'a str,
    port: u16,
    #[serde(borrow)]
    user: &'a str,
    password: GuardedString,
    #[serde(default)]
    tls: bool,
    #[serde(default, rename = "authserv_id", borrow)]
    authserv_id: Option<&'a str>,
    #[serde(default, borrow)]
    from: Option<&'a str>,
    #[serde(default, borrow)]
    smtp_host: Option<&'a str>,
    #[serde(default)]
    smtp_port: Option<u16>,
}

/// The one place a password is copied out of the line, and it is guarded from then on.
/// The line itself is a `Zeroizing` buffer, so nothing unwiped is left behind.
struct GuardedString(Zeroizing<String>);

impl<'de> Deserialize<'de> for GuardedString {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Guard;
        impl de::Visitor<'_> for Guard {
            type Value = GuardedString;

            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("a string")
            }

            fn visit_str<E: de::Error>(self, value: &str) -> Result<GuardedString, E> {
                Ok(GuardedString(Zeroizing::new(value.to_owned())))
            }
        }
        deserializer.deserialize_str(Guard)
    }
}

/// Every failure here is a fixed string. The line holds the password, so nothing
/// derived from it is ever put in the message.
pub fn read(line: &[u8]) -> Result<Account, &'static str> {
    let raw: BootstrapLine<'_> =
        serde_json::from_slice(line).map_err(|_| "the account line is not valid JSON")?;
    if raw.host.trim().is_empty() {
        return Err("the account line has no host");
    }
    if raw.user.trim().is_empty() {
        return Err("the account line has no user");
    }
    if raw.port == 0 {
        return Err("the account line has no port");
    }
    Ok(Account {
        host: raw.host.to_string(),
        port: raw.port,
        user: raw.user.to_string(),
        password: raw.password.0,
        tls: tls_required(raw.host, raw.tls, cfg!(debug_assertions)),
        trusted_authserv_id: raw
            .authserv_id
            .map(|id| id.trim().to_lowercase())
            .filter(|id| !id.is_empty()),
        from: raw.from.map(str::trim).filter(|from| from.contains('@')).map(str::to_owned),
        smtp: raw
            .smtp_host
            .map(str::trim)
            .filter(|host| !host.is_empty())
            .zip(raw.smtp_port)
            .map(|(host, port)| (host.to_owned(), port)),
    })
}

/// Plaintext reaches only the fixture server on this machine, and only in a debug build.
fn tls_required(host: &str, asked: bool, debug_build: bool) -> bool {
    asked || !(debug_build && is_loopback(host))
}

fn is_loopback(host: &str) -> bool {
    matches!(
        host,
        "127.0.0.1" | "localhost" | "::1" | "[::1]" | "0.0.0.0"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(host: &str, tls: bool) -> String {
        format!(
            r#"{{"host":"{host}","port":993,"user":"maria@example.it","password":"hunter2-xyz","tls":{tls}}}"#
        )
    }

    /// The one line that stops a plaintext LOGIN to a real mailbox.
    #[test]
    fn tls_cannot_be_turned_off_for_a_host_that_is_not_this_machine() {
        for host in ["imap.example.it", "imap.gmail.com", "192.168.1.10"] {
            assert!(
                read(line(host, false).as_bytes())
                    .expect("a well formed line")
                    .tls(),
                "{host} must not be reachable without TLS"
            );
        }
    }

    #[test]
    fn a_loopback_host_may_stay_plaintext_for_the_fixture_server() {
        for host in ["127.0.0.1", "localhost"] {
            assert!(
                !read(line(host, false).as_bytes())
                    .expect("a well formed line")
                    .tls(),
                "{host} is the fixture server"
            );
        }
    }

    #[test]
    fn a_release_build_never_speaks_plaintext_even_to_loopback() {
        assert!(tls_required("127.0.0.1", false, false));
        assert!(tls_required("localhost", false, false));
        assert!(!tls_required("127.0.0.1", false, true));
        assert!(tls_required("imap.example.it", false, true));
    }

    #[test]
    fn tls_on_the_line_is_always_honoured() {
        assert!(read(line("127.0.0.1", true).as_bytes()).expect("ok").tls());
    }

    #[test]
    fn the_fields_are_the_ones_the_line_carries() {
        let account = read(line("imap.example.it", true).as_bytes()).expect("ok");
        assert_eq!(account.host(), "imap.example.it");
        assert_eq!(account.port(), 993);
        assert_eq!(account.user(), "maria@example.it");
        assert_eq!(account.password(), "hunter2-xyz");
        assert_eq!(account.trusted_authserv_id(), None);
        assert!(!account.is_loopback());
    }

    #[test]
    fn the_sender_address_and_the_submission_server_are_read_when_the_line_carries_them() {
        let carried = r#"{"host":"imap.example.it","port":993,"user":"maria","password":"x","from":"maria@example.it","smtp_host":"smtp.example.it","smtp_port":465}"#;
        let account = read(carried.as_bytes()).expect("ok");
        assert_eq!(account.from(), Some("maria@example.it"));
        assert_eq!(account.smtp(), Some(("smtp.example.it", 465)));
        let bare = r#"{"host":"imap.example.it","port":993,"user":"maria","password":"x"}"#;
        let account = read(bare.as_bytes()).expect("ok");
        assert_eq!(account.from(), None);
        assert_eq!(account.smtp(), None);
    }

    #[test]
    fn an_authserv_id_is_normalised_and_an_empty_one_is_dropped() {
        let with = r#"{"host":"h.example.it","port":1,"user":"u","password":"p","authserv_id":"  MX.Provider.Example "}"#;
        assert_eq!(
            read(with.as_bytes()).expect("ok").trusted_authserv_id(),
            Some("mx.provider.example")
        );
        let blank =
            r#"{"host":"h.example.it","port":1,"user":"u","password":"p","authserv_id":"  "}"#;
        assert_eq!(
            read(blank.as_bytes()).expect("ok").trusted_authserv_id(),
            None
        );
    }

    #[test]
    fn an_incomplete_line_says_nothing_about_what_it_saw() {
        for line in [
            "{",
            r#"{"password":"hunter2-xyz"}"#,
            r#"{"host":"","port":1,"user":"u","password":"hunter2-xyz"}"#,
            r#"{"host":"h","port":0,"user":"u","password":"hunter2-xyz"}"#,
            r#"{"host":"h","port":1,"user":"","password":"hunter2-xyz"}"#,
            r#"{"host":"h","port":1,"user":"u","password":"hunter2-xyz","extra":1}"#,
        ] {
            // `expect_err` would need `Account: Debug`, which it deliberately is not.
            let message = match read(line.as_bytes()) {
                Ok(_) => panic!("this line is not complete"),
                Err(message) => message,
            };
            assert!(!message.contains("hunter2"), "{message}");
        }
    }
}
