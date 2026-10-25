//! The JSON bodies of the three chat routes, checked before anything is asked
//! of the page or the app. A body the contract refuses is `None`, and the
//! route answers `bad_request`.

use serde_json::{json, Value};

/// Messages in one turn. A longer conversation is the phone's to shorten.
const MAX_MESSAGES: usize = 200;

/// **What a phone says it can draw.** The names this protocol has, and the only
/// ones a turn is carried with: a phone that announces one has the thing that
/// name is about done on it, and a phone that announces none does not.
///
/// A name this build does not know is dropped, and a field that is not an
/// array of names is dropped whole: **a turn is never refused over this.** A
/// phone that speaks a newer dialect still gets its turn; it simply does not
/// get the card that capability is about.
const CAPABILITIES: &[&str] = &["browser_card"];

/// How many capabilities one turn may announce, and how long a name may be. Both
/// are small: a turn is a few messages, and a name is a name.
const MAX_CAPABILITIES: usize = 8;
const MAX_CAPABILITY_LEN: usize = 32;

/// The page's `turn` object for a turn body: the messages reduced to role and
/// content, the pinned mail id, the language, and what the phone said it can
/// draw.
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
    let mut turn = json!({"messages": messages, "reply_for": reply_for, "language": language});
    // **What the phone can draw rides on the turn, and only when it announced
    // something.** A turn that announced no capability carries no field at all,
    // so a body that never spoke of it is the body it always was.
    let capabilities = capabilities(&value);
    if !capabilities.is_empty() {
        turn["capabilities"] = json!(capabilities);
    }
    Some(turn)
}

/// **What a turn's phone said it can draw, and nothing else.**
///
/// **An array of short known names.** A name this build does not know is
/// ignored, and a name that is not a string, or is longer than a name, is
/// ignored too. A field that is not an array of names at all is no
/// capabilities: the turn is still the phone's, and the phone still gets it.
fn capabilities(value: &Value) -> Vec<String> {
    let Some(names) = value.get("capabilities").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut known: Vec<String> = Vec::new();
    for name in names.iter() {
        let Some(name) = name.as_str() else { continue };
        if !is_a_capability(name) {
            continue;
        }
        if !known.iter().any(|held| held == name) {
            known.push(name.to_string());
        }
    }
    capped(known)
}

/// A name this build knows, and short enough to be one.
fn is_a_capability(name: &str) -> bool {
    name.len() <= MAX_CAPABILITY_LEN && CAPABILITIES.contains(&name)
}

/// **The names that survived, and no more than the cap allows.** The cap is on
/// what is left and not on what was announced: a phone that announced eight
/// names this build does not know has not spent its budget, and the name it
/// did announce is still carried.
fn capped(names: Vec<String>) -> Vec<String> {
    names.into_iter().take(MAX_CAPABILITIES).collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The turn a body asks for, with the capabilities field written as it came.
    fn turn_with(capabilities: &str) -> Option<Value> {
        let body = format!(
            r#"{{"messages":[{{"role":"user","content":"hi"}}],"capabilities":{capabilities}}}"#
        );
        turn_request(body.as_bytes())
    }

    /// What the turn carries about capabilities: the names, or nothing at all.
    fn carried(capabilities: &str) -> Option<Vec<String>> {
        let turn = turn_with(capabilities)?;
        turn.get("capabilities")
            .and_then(Value::as_array)
            .map(|names| names.iter().filter_map(|n| n.as_str().map(str::to_string)).collect())
    }

    #[test]
    fn a_phone_that_says_it_can_draw_a_card_carries_the_name() {
        assert_eq!(carried(r#"["browser_card"]"#), Some(vec!["browser_card".to_string()]));
    }

    #[test]
    fn a_name_this_build_does_not_know_is_ignored() {
        assert_eq!(carried(r#"["future_thing"]"#), None);
        assert_eq!(carried(r#"["future_thing","browser_card"]"#), Some(vec!["browser_card".to_string()]));
    }

    #[test]
    fn a_capability_that_is_not_a_name_is_ignored() {
        assert_eq!(carried(r#"[7,"browser_card"]"#), Some(vec!["browser_card".to_string()]));
        assert_eq!(carried(r#"[["browser_card"]]"#), None);
    }

    #[test]
    fn a_capabilities_field_that_is_not_an_array_is_no_capabilities() {
        assert_eq!(carried(r#""browser_card""#), None);
        assert_eq!(carried("7"), None);
        assert_eq!(carried("{}"), None);
    }

    #[test]
    fn a_turn_is_never_refused_over_its_capabilities() {
        for capabilities in [r#"[]"#, r#""browser_card""#, "7", r#"[{}]"#, r#"[""]"#] {
            assert!(turn_with(capabilities).is_some(), "{capabilities}");
        }
    }

    #[test]
    fn a_turn_that_announced_nothing_carries_no_field() {
        let body = br#"{"messages":[{"role":"user","content":"hi"}]}"#;
        let turn = turn_request(body).expect("a turn");
        assert!(turn.get("capabilities").is_none(), "{turn}");
    }

    #[test]
    fn the_same_name_twice_is_one_name() {
        assert_eq!(carried(r#"["browser_card","browser_card"]"#), Some(vec!["browser_card".to_string()]));
    }

    #[test]
    fn eight_names_this_build_does_not_know_do_not_crowd_out_the_one_it_does() {
        let unknown: Vec<String> = (0..8).map(|_| "\"future_thing\"".to_string()).collect();
        let announced = format!("[{},\"browser_card\"]", unknown.join(","));
        assert_eq!(carried(&announced), Some(vec!["browser_card".to_string()]));
    }

    #[test]
    fn the_count_cap_is_on_what_survived_the_filter() {
        let names: Vec<String> = (0..MAX_CAPABILITIES + 1).map(|_| "browser_card".to_string()).collect();
        assert_eq!(capped(names).len(), MAX_CAPABILITIES);
    }

    #[test]
    fn the_length_cap_is_on_the_name() {
        assert!(is_a_capability("browser_card"));
        assert!(!is_a_capability(&"x".repeat(MAX_CAPABILITY_LEN + 1)));
    }
}
