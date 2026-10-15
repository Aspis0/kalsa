use std::path::Path;

use kalsa_mcp::host::Host;
use kalsa_mcp::launch::StdioLauncher;
use kalsa_mcp::outcome::{CallOutcome, ToolResult};
use kalsa_mcp::record::{ServerRecord, Trust};
use kalsa_mcp::registry::Registry;
use kalsa_mcp::server_id::ServerId;
use serde_json::{json, Value};

use super::account::{self, MailAccount};
use super::bootstrap;
use super::error::MailError;
use super::keychain::PasswordStore;
use super::program::{self, Program};
use super::state::PANEL_CONVERSATION;
use super::tool_pins;

pub(crate) const MAIL_SERVER: &str = "mail";

/// The newest mails the account test shows.
const TEST_SUBJECTS: usize = 3;

/// The host for the account saved on disk, with its password read from the store.
pub(crate) fn open_saved(
    state_file: &Path,
    store: &impl PasswordStore,
    program: &Program,
) -> Result<Host<StdioLauncher>, MailError> {
    let account = account::load(state_file)?.ok_or(MailError::NotConfigured)?;
    let password = store.read(account.account_id())?;
    build(program, &account, &password)
}

/// Starts the sidecar for an account, lists the newest mails, and shuts the sidecar
/// down. The caller passes the password it already read, and nothing is saved here.
pub(crate) async fn probe(account: &MailAccount, password: &str) -> Result<Vec<String>, MailError> {
    let program = program::current()?;
    let mut host = build(&program, account, password)?;
    let arguments = json!({"days": 1}).as_object().cloned().unwrap_or_default();
    let outcome = host.call(PANEL_CONVERSATION, "mail.list", arguments).await;
    drop(host);
    match outcome? {
        CallOutcome::Ran(result) => listing_result(result),
        CallOutcome::NeedsConfirmation(_) => Err(MailError::Confirmation),
    }
}

/// An error result is a failure, never an empty inbox. The sidecar's sentence is logged
/// the way `commands.rs` logs it, and not shown.
fn listing_result(result: ToolResult) -> Result<Vec<String>, MailError> {
    if result.is_error {
        let reason: String = result.for_model.first().map(|text| text.chars().take(80).collect()).unwrap_or_default();
        log::warn!("mail account test returned is_error: {reason}");
        return Err(MailError::Failed);
    }
    Ok(subjects(result.for_ui.as_ref()))
}

/// The sidecar as the only server: its digest approved, its tool definitions
/// pinned, and the bootstrap line it reads first. The digest is the one `program`
/// was checked against, so the file is not read again here.
fn build(program: &Program, account: &MailAccount, password: &str) -> Result<Host<StdioLauncher>, MailError> {
    let id = ServerId::new(MAIL_SERVER)?;
    let secret = bootstrap::secret(account, password)?;
    let record = ServerRecord::new(id.clone(), program.path.clone(), Trust::FirstParty)?.with_bootstrap(secret)?;
    let registry = Registry::new(vec![record])?;
    let mut pins = tool_pins::checked_in();
    pins.seed_binary_with_digest(&id, &program.path, &program.sha256);
    Ok(Host::new(registry, StdioLauncher, pins))
}

/// The subjects in a list result (`items[].subject`), at most [`TEST_SUBJECTS`].
fn subjects(for_ui: Option<&Value>) -> Vec<String> {
    for_ui
        .and_then(|data| data.get("items"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("subject").and_then(Value::as_str))
                .take(TEST_SUBJECTS)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;
    use crate::mail::keychain::Memory;

    fn scratch(name: &str) -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("kalsa-mail-host-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let program = dir.join("kalsa-mail");
        std::fs::write(&program, b"sidecar bytes").expect("program");
        (dir.join("server.state"), program)
    }

    fn approved(path: &Path) -> Program {
        use sha2::{Digest, Sha256};
        let digest: String = Sha256::digest(std::fs::read(path).expect("scratch program"))
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        program::resolve(Some(path.to_path_buf()), Some(digest), None).expect("the scratch program matches its digest")
    }

    fn saved_account(state: &Path) -> MailAccount {
        let account = MailAccount::new("lab@example.test", "127.0.0.1", 1260, None).expect("valid");
        account::save(state, &account).expect("saved");
        account
    }

    #[test]
    fn with_no_saved_account_the_host_is_not_configured() {
        let (state, program) = scratch("no-account");
        let refused = open_saved(&state, &Memory::default(), &approved(&program));
        assert_eq!(refused.err(), Some(MailError::NotConfigured));
    }

    #[test]
    fn with_an_account_but_no_password_the_host_is_not_configured() {
        let (state, program) = scratch("no-password");
        saved_account(&state);
        let refused = open_saved(&state, &Memory::default(), &approved(&program));
        assert_eq!(refused.err(), Some(MailError::NotConfigured));
    }

    #[test]
    fn with_an_account_and_a_password_the_host_opens_without_starting_the_sidecar() {
        let (state, program) = scratch("opens");
        let account = saved_account(&state);
        let store = Memory::default();
        store.save(account.account_id(), "fake-password").expect("stored");
        assert!(open_saved(&state, &store, &approved(&program)).is_ok());
    }

    /// The digest is checked when the host lists, before anything is started.
    #[test]
    fn a_sidecar_that_changed_after_approval_is_seen_as_changed_before_it_starts() {
        let (state, program) = scratch("changed");
        let account = saved_account(&state);
        let store = Memory::default();
        store.save(account.account_id(), "fake-password").expect("stored");
        let approved = approved(&program);
        std::fs::write(&program, b"a different sidecar").expect("overwritten");
        let mut host = open_saved(&state, &store, &approved).expect("opens");
        let listing = tauri::async_runtime::block_on(host.list(&ServerId::new(MAIL_SERVER).expect("id")))
            .expect("the listing answers");
        assert_eq!(listing.binary, kalsa_mcp::permission::PinState::Changed);
        assert!(listing.tools.is_empty());
    }

    #[test]
    fn the_subjects_come_from_the_items_of_a_list_result_at_most_three() {
        let data = json!({"folder": "INBOX", "count": 4, "items": [
            {"subject": "one"}, {"subject": "two"}, {"subject": "three"}, {"subject": "four"}
        ]});
        assert_eq!(subjects(Some(&data)), vec!["one", "two", "three"]);
        assert!(subjects(Some(&json!({"mails": []}))).is_empty());
    }

    fn result(is_error: bool, for_ui: Option<Value>) -> ToolResult {
        ToolResult {
            server: ServerId::new(MAIL_SERVER).expect("id"),
            is_error,
            for_model: vec!["that folder could not be opened".to_string()],
            for_ui,
        }
    }

    #[test]
    fn an_error_result_is_a_failure_not_an_empty_inbox() {
        let refused = result(true, Some(json!({"items": []})));
        assert_eq!(listing_result(refused), Err(MailError::Failed));
    }

    #[test]
    fn a_good_result_lists_its_subjects() {
        let listed = result(false, Some(json!({"items": [{"subject": "one"}]})));
        assert_eq!(listing_result(listed), Ok(vec!["one".to_string()]));
    }
}
