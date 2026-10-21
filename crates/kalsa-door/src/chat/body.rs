//! The JSON bodies of the three chat routes, checked before anything is asked
//! of the page or the app. A body the contract refuses is `None`, and the
//! route answers `bad_request`.

use serde_json::{json, Value};

/// Messages in one turn. A longer conversation is the phone's to shorten.
const MAX_MESSAGES: usize = 200;

/// The page's `turn` object for a turn body: the messages reduced to role and
/// content, the pinned mail id, and the language.
pub(super) fn turn_request(body: &[u8]) -> Option<Value> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let messages = value.get("messages")?.as_array()?;
    if messages.len() > MAX_MESSAGES {
        return None;
    }
    let messages = messages.iter().map(message).collect::<Option<Vec<_>>>()?;
    let reply_for = optional_string(&value, "reply_for")?;
    if reply_for.as_deref().is_some_and(|id| !is_digits(id)) {
        return None;
    }
    let language = match optional_string(&value, "language")?.as_deref() {
        None | Some("en") => "en",
        Some("it") => "it",
        Some(_) => return None,
    };
    Some(json!({"messages": messages, "reply_for": reply_for, "language": language}))
}

/// The mail id a read names: digits, as the phone's card carries it.
pub(super) fn read_id(body: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let id = value.get("id")?.as_str()?;
    is_digits(id).then(|| id.to_string())
}

/// The draft a send names and the body the person edited, if they edited one.
pub(super) fn send_request(body: &[u8]) -> Option<(String, Option<String>)> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let draft_id = value.get("draft_id")?.as_str()?;
    if draft_id.len() != 32 || !draft_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let edited = optional_string(&value, "body")?;
    Some((draft_id.to_string(), edited))
}

/// The card an answer names and which button was pressed. **`send` and `decline`
/// and nothing else**: an answer that named its own verb would be a door inventing
/// an action, and the two the desktop has are the only two a phone gets.
pub(super) fn answer_request(body: &[u8]) -> Option<(String, bool)> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let card_id = value.get("card_id")?.as_str()?;
    if card_id.len() != 32 || !card_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let allow = match value.get("answer")?.as_str()? {
        "send" => true,
        "decline" => false,
        _ => return None,
    };
    Some((card_id.to_string(), allow))
}

/// A preview's body: **an object and nothing else**. **The fields in it are
/// ignored**, because the phone names nobody: the door resolved the device
/// from the credential, so an identity in a body is a field this route does
/// not read.
pub(super) fn preview_request(body: &[u8]) -> Option<()> {
    let value: Value = serde_json::from_slice(body).ok()?;
    value.as_object().map(|_| ())
}

/// One message as the page takes it. Any other key the phone sent is not
/// passed on.
fn message(value: &Value) -> Option<Value> {
    let role = value.get("role")?.as_str()?;
    if role != "user" && role != "assistant" {
        return None;
    }
    let content = value.get("content")?.as_str()?;
    Some(json!({"role": role, "content": content}))
}

/// A field that may be absent or null, and is a string when present.
fn optional_string(value: &Value, key: &str) -> Option<Option<String>> {
    match value.get(key) {
        None | Some(Value::Null) => Some(None),
        Some(Value::String(text)) => Some(Some(text.clone())),
        Some(_) => None,
    }
}

fn is_digits(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_digit())
}
