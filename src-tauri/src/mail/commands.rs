use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, State};

use super::accounts::{self, AccountForm};
use super::account::{self, MailAccount};
use super::error::{refusal_of, CommandFailure, MailError};
use super::keychain::Keychain;
use super::program;
use super::host;
use super::state::{MailState, ToolResponse};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ListArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    days: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    query: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ReadArgs {
    id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    folder: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct DraftArgs {
    reply_to_id: u32,
    body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    folder: Option<String>,
}

#[tauri::command]
pub(crate) async fn brain_mail_account_save(
    app: AppHandle,
    state: State<'_, MailState>,
    input: AccountForm,
) -> Result<MailAccount, CommandFailure> {
    let path = state_file(&app)?;
    Ok(accounts::save(&state, &Keychain, &path, input).await?)
}

#[tauri::command]
pub(crate) async fn brain_mail_account_delete(app: AppHandle, state: State<'_, MailState>) -> Result<(), CommandFailure> {
    let path = state_file(&app)?;
    Ok(accounts::delete(&state, &Keychain, &path).await?)
}

/// The address and server of the saved account, or `null`. Nothing else leaves: the
/// password stays in the keychain and the login name is not shown.
#[derive(Serialize)]
pub(crate) struct SavedAccount {
    email: String,
    host: String,
}

fn shown(account: Option<MailAccount>) -> Option<SavedAccount> {
    account.map(|account| SavedAccount {
        email: account.email,
        host: account.host,
    })
}

#[tauri::command]
pub(crate) async fn brain_mail_account_get(app: AppHandle) -> Result<Option<SavedAccount>, CommandFailure> {
    let path = state_file(&app)?;
    Ok(shown(account::load(&path)?))
}

/// Tests the saved account only. It takes no server and no password, so a caller
/// cannot point the saved password at a host of its choosing.
#[tauri::command]
pub(crate) async fn brain_mail_account_test(app: AppHandle, state: State<'_, MailState>) -> Result<Vec<String>, CommandFailure> {
    let path = state_file(&app)?;
    Ok(accounts::test_saved(&state, &Keychain, &path).await?)
}

#[tauri::command]
pub(crate) async fn brain_mail_list(
    app: AppHandle,
    state: State<'_, MailState>,
    args: ListArgs,
) -> Result<ToolResponse, CommandFailure> {
    call(&app, &state, "mail.list", &args).await
}

#[tauri::command]
pub(crate) async fn brain_mail_read(
    app: AppHandle,
    state: State<'_, MailState>,
    args: ReadArgs,
) -> Result<ToolResponse, CommandFailure> {
    call(&app, &state, "mail.read", &args).await
}

#[tauri::command]
pub(crate) async fn brain_mail_draft(
    app: AppHandle,
    state: State<'_, MailState>,
    args: DraftArgs,
) -> Result<ToolResponse, CommandFailure> {
    call(&app, &state, "mail.draft", &args).await
}

/// Logs a failed call by its code and an error result by its fixed sentence: the
/// sidecar's error texts are constants, never mail content, and no arguments are logged.
/// A refused login is thrown, not answered, so the chat reads its code like any other failure.
async fn call<T: Serialize>(
    app: &AppHandle,
    state: &MailState,
    name: &str,
    args: &T,
) -> Result<ToolResponse, CommandFailure> {
    match dispatch(app, state, name, args).await {
        Ok(response) => {
            if response.is_error {
                if let Some(refused) = refusal_of(response.for_ui.as_ref()) {
                    log::warn!("mail call {name} was refused: {}", refused.code());
                    return Err(refused.into());
                }
                let reason: String = response.for_model.first().map(|text| text.chars().take(80).collect()).unwrap_or_default();
                log::warn!("mail call {name} returned is_error: {reason}");
            }
            Ok(response)
        }
        Err(error) => {
            log::warn!("mail call {name} failed: {}", error.code());
            Err(error.into())
        }
    }
}

async fn dispatch<T: Serialize>(app: &AppHandle, state: &MailState, name: &str, args: &T) -> Result<ToolResponse, MailError> {
    let arguments = arguments(args)?;
    let path = state_file(app)?;
    let open = || {
        let program = program::current()?;
        host::open_saved(&path, &Keychain, &program)
    };
    let mut slot = state.lock().await;
    slot.call(name, arguments, open).await
}

fn arguments<T: Serialize>(args: &T) -> Result<Map<String, Value>, MailError> {
    match serde_json::to_value(args) {
        Ok(Value::Object(map)) => Ok(map),
        _ => Err(MailError::Failed),
    }
}

fn state_file(app: &AppHandle) -> Result<PathBuf, MailError> {
    crate::state_file(app).map_err(|_| MailError::Storage)
}

/// The reply the person confirmed. Camel case on the wire, as the panel writes it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SendArgs {
    reply_to_id: u32,
    subject: String,
    body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendResponse {
    sent_to: String,
}

/// Called only by the panel's send button, after the person confirms. It is not a
/// tool the model can call.
#[tauri::command]
pub(crate) async fn brain_mail_send(
    app: AppHandle,
    state: State<'_, MailState>,
    args: SendArgs,
) -> Result<SendResponse, CommandFailure> {
    let arguments = json!({"reply_to_id": args.reply_to_id, "subject": args.subject, "body": args.body})
        .as_object()
        .cloned()
        .unwrap_or_default();
    let path = state_file(&app)?;
    let open = || {
        let program = program::current()?;
        host::open_saved(&path, &Keychain, &program)
    };
    let mut slot = state.lock().await;
    let response = slot.confirmed_send(arguments, open).await?;
    Ok(sent_of(response)?)
}

fn sent_of(response: ToolResponse) -> Result<SendResponse, MailError> {
    if response.is_error {
        return Err(send_failure(response.for_ui.as_ref()));
    }
    let to = response
        .for_ui
        .as_ref()
        .and_then(|data| data.get("sent_to"))
        .and_then(Value::as_str)
        .ok_or(MailError::SendFailed)?;
    Ok(SendResponse { sent_to: to.to_owned() })
}

fn send_failure(data: Option<&Value>) -> MailError {
    match data.and_then(|data| data.get("code")).and_then(Value::as_str) {
        Some("not_configured") => MailError::SendNotConfigured,
        Some("no_recipient") => MailError::SendNoRecipient,
        Some("unreachable") => MailError::SendUnreachable,
        Some("refused") => MailError::SendRefused,
        Some("not_listed" | "not_found") => MailError::SendNotListed,
        _ => MailError::SendFailed,
    }
}

/// The wiring itself: a command missing from `generate_handler!` is dead to the
/// panel and nothing else would notice. The registration is macro input, so the
/// source is what tells the truth, the same as the files check.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_mail_commands_are_registered_and_their_state_is_managed() {
        let source = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/main.rs")).expect("main.rs is readable");
        assert!(source.contains(".manage(mail::state::MailState::default())"), "the mail state is not managed");
        let handler = source.find("generate_handler!").expect("the handler list");
        let open = handler + source[handler..].find('[').expect("the list opens");
        let close = open + source[open..].find(']').expect("the list closes");
        let registered = &source[open..close];
        for command in [
            "mail::commands::brain_mail_account_get",
            "mail::commands::brain_mail_account_save",
            "mail::commands::brain_mail_account_delete",
            "mail::commands::brain_mail_account_test",
            "mail::commands::brain_mail_list",
            "mail::commands::brain_mail_read",
            "mail::commands::brain_mail_draft",
            "mail::commands::brain_mail_send",
        ] {
            assert!(registered.contains(command), "{command} is not in generate_handler!");
        }
    }

    #[test]
    fn the_saved_account_is_its_address_and_server_and_nothing_more() {
        let account = MailAccount::new("lab@example.test", "imap.example.test", 993, Some("login-name")).expect("valid");
        let saved = serde_json::to_value(shown(Some(account))).expect("serializes");
        assert_eq!(saved, json!({"email": "lab@example.test", "host": "imap.example.test"}));
    }

    #[test]
    fn the_answer_comes_from_the_state_file_on_disk() {
        let dir = std::env::temp_dir().join(format!("kalsa-mail-account-get-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let state = dir.join("server.state");
        let none = shown(account::load(&state).expect("loads"));
        assert_eq!(serde_json::to_value(none).expect("serializes"), Value::Null);

        let account = MailAccount::new("lab@example.test", "imap.example.test", 993, Some("login-name")).expect("valid");
        account::save(&state, &account).expect("saved");
        let saved = serde_json::to_value(shown(account::load(&state).expect("loads"))).expect("serializes");
        assert_eq!(saved, json!({"email": "lab@example.test", "host": "imap.example.test"}));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn with_no_saved_account_the_answer_is_null() {
        assert_eq!(serde_json::to_value(shown(None)).expect("serializes"), Value::Null);
    }

    #[test]
    fn the_argument_structs_refuse_keys_they_do_not_name() {
        assert!(serde_json::from_str::<ListArgs>(r#"{"days":1,"send":true}"#).is_err());
        let accepted = arguments(&ListArgs { days: Some(1), folder: None, from: None, query: None }).expect("object");
        assert_eq!(accepted.len(), 1);
    }

    #[test]
    fn the_send_arguments_are_camel_case_and_refuse_any_other_key() {
        let sent: SendArgs = serde_json::from_str(r#"{"replyToId":7,"subject":"Re","body":"Va bene."}"#).expect("camelCase");
        assert_eq!(sent.reply_to_id, 7);
        assert!(serde_json::from_str::<SendArgs>(r#"{"replyToId":7,"subject":"Re","body":"b","to":"x@evil.example"}"#).is_err());
        assert!(serde_json::from_str::<SendArgs>(r#"{"reply_to_id":7,"subject":"Re","body":"b"}"#).is_err());
    }

    /// The bodies the panel and the tool layer send, as they go on the wire. Each one
    /// lands in the struct its command takes, so a renamed key, a dropped field or a
    /// string id fails here rather than at the first live save.
    #[test]
    fn the_bodies_the_ui_sends_deserialize_into_the_real_structs() {
        assert!(serde_json::from_str::<AccountForm>(r#"{"email":"luca@libero.it","password":"pw","host":"imapmail.libero.it"}"#).is_ok());
        assert!(serde_json::from_str::<AccountForm>(r#"{"email":"luca@libero.it","password":"pw"}"#).is_ok());
        assert!(serde_json::from_str::<AccountForm>(r#"{"email":"luca@libero.it","password":"pw","server":"imap.libero.it"}"#).is_err());
        let list: ListArgs = serde_json::from_str(r#"{"folder":"INBOX","days":1}"#).expect("list");
        assert_eq!(list.days, Some(1));
        let read: ReadArgs = serde_json::from_str(r#"{"id":412,"folder":"INBOX"}"#).expect("read");
        assert_eq!(read.id, 412);
        assert!(serde_json::from_str::<ReadArgs>(r#"{"id":"412","folder":"INBOX"}"#).is_err());
        let draft: DraftArgs = serde_json::from_str(r#"{"reply_to_id":412,"body":"Va bene.","folder":"INBOX"}"#).expect("draft");
        assert_eq!(draft.reply_to_id, 412);
        let sent: SendArgs = serde_json::from_str(r#"{"replyToId":412,"subject":"Re: Fattura","body":"Va bene."}"#).expect("send");
        assert_eq!(sent.reply_to_id, 412);
    }

    #[test]
    fn a_sent_reply_answers_with_its_recipient_and_a_refusal_with_its_fixed_code() {
        let done = ToolResponse {
            for_model: Vec::new(),
            for_ui: Some(json!({"sent_to": "segreteria@studio.example.it"})),
            is_error: false,
        };
        assert_eq!(sent_of(done).map(|sent| sent.sent_to).ok().as_deref(), Some("segreteria@studio.example.it"));
        let refused = ToolResponse { for_model: Vec::new(), for_ui: Some(json!({"code": "refused"})), is_error: true };
        assert_eq!(sent_of(refused).err(), Some(MailError::SendRefused));
        let unknown = ToolResponse { for_model: Vec::new(), for_ui: Some(json!({"code": "something new"})), is_error: true };
        assert_eq!(sent_of(unknown).err(), Some(MailError::SendFailed));
    }
}
