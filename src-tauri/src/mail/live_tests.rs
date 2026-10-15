//! Tests that start the real sidecar, so each one is ignored by default. They need
//! the built sidecar, its digest, and the lab fake server on 127.0.0.1:1260:
//! `KALSA_MAIL_SERVER_BIN=<built kalsa-mail> KALSA_MAIL_SERVER_SHA256=<its sha256>
//!  cargo test -p kalsa-brain live -- --ignored`

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use super::account::{self, MailAccount};
use super::host;
use super::keychain::{Keychain, Memory, PasswordStore};
use super::program;
use super::state::MailState;

/// The lab fake server's port for these runs. Other ports belong to other runs.
const LAB_PORT: u16 = 1260;
/// A fake password for the lab's fake server, which accepts any login.
const LAB_PASSWORD: &str = "lab-password-accepted-by-the-fake-server";

fn lab_account(email: &str) -> MailAccount {
    MailAccount::new(email, "127.0.0.1", LAB_PORT, None).expect("the lab account is valid")
}

fn one_day() -> Map<String, Value> {
    json!({"days": 1}).as_object().cloned().unwrap_or_default()
}

/// Removes the throwaway keychain entry and the scratch folder, even when the test panics.
struct Cleanup {
    email: String,
    folder: PathBuf,
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        let _ = Keychain.delete(&self.email);
        let _ = fs::remove_dir_all(&self.folder);
    }
}

#[tokio::test]
#[ignore = "starts the real sidecar against the lab fake server on 127.0.0.1:1260"]
async fn the_account_test_lists_the_newest_mails_from_the_lab() {
    let subjects = host::probe(&lab_account("lab@example.test"), LAB_PASSWORD)
        .await
        .expect("the account test answers");
    assert!(!subjects.is_empty() && subjects.len() <= 3, "{} subjects", subjects.len());
}

/// Writes a throwaway keychain entry, so the first access may prompt on macOS.
#[tokio::test]
#[ignore = "starts the real sidecar and writes a throwaway keychain entry, deleted afterwards"]
async fn a_saved_account_is_read_from_the_keychain_and_listed() {
    let email = format!("lab-{}@example.test", std::process::id());
    let folder = std::env::temp_dir().join(format!("kalsa-mail-lab-{}", std::process::id()));
    fs::create_dir_all(&folder).expect("scratch folder");
    let _cleanup = Cleanup { email: email.clone(), folder: folder.clone() };

    let state_file = folder.join("server.state");
    let account = lab_account(&email);
    Keychain.save(account.account_id(), LAB_PASSWORD).expect("throwaway keychain entry");
    account::save(&state_file, &account).expect("account saved beside the state file");

    let mail = MailState::default();
    let open = || {
        let program = program::current()?;
        host::open_saved(&state_file, &Keychain, &program)
    };
    let mut slot = mail.lock().await;
    let response = slot.call("mail.list", one_day(), open).await.expect("the list answers");
    assert!(!response.is_error);
    assert!(response.for_ui.is_some(), "the panel gets structured data");
    slot.forget();
}

/// The chat's own route, with the in-memory store: the saved account, then the
/// calls the mail tools make. Prints each outcome, so a refusal the panel shows as
/// "not set up" can be read here.
#[tokio::test]
#[ignore = "starts the real sidecar against the lab fake server on 127.0.0.1:1260"]
async fn the_chat_route_lists_the_lab_mail_with_the_panel_arguments() {
    let folder = std::env::temp_dir().join(format!("kalsa-mail-chat-route-{}", std::process::id()));
    fs::create_dir_all(&folder).expect("scratch folder");
    let state_file = folder.join("server.state");
    let account = lab_account("lab@example.test");
    account::save(&state_file, &account).expect("account saved beside the state file");
    let store = Memory::default();
    store.save(account.account_id(), LAB_PASSWORD).expect("stored");

    let mail = MailState::default();
    let mut slot = mail.lock().await;
    for args in [
        json!({"folder": "INBOX"}),
        json!({"days": 7, "folder": "INBOX"}),
        json!({"folder": "INBOX", "query": "fattura"}),
        json!({"folder": "INBOX", "query": "scadenza più vicina"}),
        json!({"folder": "INBOX", "from": "Andrea"}),
        json!({"folder": "INBOX", "days": 14}),
        json!({"folder": "INBOX", "query": ""}),
        json!({"folder": "INBOX", "from": ""}),
        json!({"folder": "INBOX", "query": "fattura \"scadenza\" \\ x"}),
        json!({"folder": "INBOX", "query": "zzqqxxnomatchzz"}),
    ] {
        let open = || {
            let program = program::current()?;
            host::open_saved(&state_file, &store, &program)
        };
        let arguments = args.as_object().cloned().unwrap_or_default();
        match slot.call("mail.list", arguments, open).await {
            Ok(response) => eprintln!(
                "REPRO {args} -> is_error={} for_ui={} for_model={:?}",
                response.is_error,
                response.for_ui.is_some(),
                response.for_model
            ),
            Err(error) => eprintln!("REPRO {args} -> Err({error:?})"),
        }
    }
    slot.forget();
    let _ = fs::remove_dir_all(&folder);
}
