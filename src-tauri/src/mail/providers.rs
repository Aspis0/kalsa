/// How a domain's mail is reached. Only a server the provider's own help page
/// states goes in here; anything else is left to the person to type.
pub(crate) enum Setup {
    Guessed { host: &'static str, port: u16 },
    Unsupported,
}

/// A provider guessed from the address's domain. `source` is the provider's help
/// page the entry was taken from. `authserv_id` is the `Authentication-Results`
/// id the provider stamps, set only where it is known.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) struct Guess {
    pub(crate) name: &'static str,
    pub(crate) domains: &'static [&'static str],
    pub(crate) setup: Setup,
    pub(crate) authserv_id: Option<&'static str>,
    pub(crate) local_part_username: bool,
    pub(crate) source: &'static str,
}

pub(crate) const GUESSES: &[Guess] = &[
    Guess {
        name: "iCloud",
        domains: &["icloud.com", "me.com", "mac.com"],
        setup: Setup::Guessed { host: "imap.mail.me.com", port: 993 },
        authserv_id: None,
        local_part_username: true,
        source: "https://support.apple.com/en-me/102525",
    },
    // Microsoft asks for OAuth2 on this server, which the host does not do yet.
    Guess {
        name: "Outlook / Hotmail",
        domains: &["outlook.com", "hotmail.com", "hotmail.it", "live.com", "outlook.it"],
        setup: Setup::Unsupported,
        authserv_id: None,
        local_part_username: false,
        source: "https://support.microsoft.com/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353",
    },
    Guess {
        name: "Libero",
        domains: &["libero.it", "iol.it", "blu.it", "inwind.it"],
        setup: Setup::Guessed { host: "imapmail.libero.it", port: 993 },
        authserv_id: None,
        local_part_username: false,
        source: "https://aiuto.libero.it/articolo/mail/configurare-libero-mail-con-client-di-posta-imap-e-smtp/",
    },
    Guess {
        name: "Virgilio",
        domains: &["virgilio.it"],
        setup: Setup::Guessed { host: "in.virgilio.it", port: 993 },
        authserv_id: None,
        local_part_username: false,
        source: "https://aiuto.virgilio.it/articolo/mail/configurare-virgilio-mail-con-client-di-posta-imap-e-smtp/",
    },
    Guess {
        name: "Aruba",
        domains: &["aruba.it"],
        setup: Setup::Guessed { host: "imap.aruba.it", port: 993 },
        authserv_id: None,
        local_part_username: false,
        source: "https://guide.aruba.it/hosting-e-domini/email/configurazione-posta/parametri-configurazione-posta",
    },
    // App passwords need 2-Step Verification: support.google.com/accounts/answer/185833.
    Guess {
        name: "Gmail",
        domains: &["gmail.com", "googlemail.com"],
        setup: Setup::Guessed { host: "imap.gmail.com", port: 993 },
        authserv_id: Some("mx.google.com"),
        local_part_username: false,
        source: "https://support.google.com/mail/answer/7126229",
    },
];

/// The entry a domain belongs to. Unknown domains get no entry: the person types the server.
pub(crate) fn guess(email: &str) -> Option<&'static Guess> {
    let domain = email.rsplit_once('@')?.1.to_ascii_lowercase();
    GUESSES.iter().find(|guess| guess.domains.contains(&domain.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_entry_has_a_https_source_and_every_guessed_server_is_secure() {
        for entry in GUESSES {
            assert!(entry.source.starts_with("https://"), "{} has no source", entry.name);
            assert!(!entry.domains.is_empty(), "{}", entry.name);
            if let Setup::Guessed { port, .. } = entry.setup {
                assert_eq!(port, 993, "{}", entry.name);
            }
        }
    }

    #[test]
    fn a_known_domain_is_guessed_in_any_letter_case() {
        let libero = guess("Anna@Libero.it").expect("libero is known");
        assert_eq!(libero.name, "Libero");
        assert!(matches!(guess("anna@me.com").map(|g| &g.setup), Some(Setup::Guessed { host: "imap.mail.me.com", .. })));
    }

    #[test]
    fn gmail_is_guessed_with_its_authserv_id() {
        let gmail = guess("anna@Gmail.com").expect("gmail is known");
        assert!(matches!(gmail.setup, Setup::Guessed { host: "imap.gmail.com", port: 993 }));
        assert_eq!(gmail.authserv_id, Some("mx.google.com"));
        assert_eq!(GUESSES.iter().filter(|g| g.authserv_id.is_some()).count(), 1);
    }

    #[test]
    fn outlook_is_known_but_not_supported_in_step_one() {
        assert!(matches!(guess("anna@hotmail.com").map(|g| &g.setup), Some(Setup::Unsupported)));
    }

    #[test]
    fn an_unknown_domain_is_not_guessed() {
        assert!(guess("anna@example.it").is_none());
        assert!(guess("no-at-sign").is_none());
    }
}
