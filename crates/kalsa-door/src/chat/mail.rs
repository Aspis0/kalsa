//! The phone's mail read and send. The read is the page's: it runs the mail
//! read and answers with the record. The send never goes through the page: the
//! app sends the draft it stored, to the recipient the stored draft names.

use serde_json::{json, Value};

use super::{await_answer, Chat};
use crate::clocks::Clocks;
use crate::devices::DeviceId;

pub(super) fn read(chat: &Chat, device: DeviceId, id: String, clocks: &Clocks) -> Value {
    let Some(opened) = chat.hook.open(device, "read", json!({"id": id})) else {
        return json!({"error": "no_runner"});
    };
    match await_answer(&opened.events, clocks, &["read"]) {
        Ok(event) if event.name == "read" => {
            match (event.data.get("record"), event.data.get("body")) {
                (Some(record), Some(body)) => json!({"record": record, "body": body}),
                _ => json!({"error": "engine"}),
            }
        }
        Ok(event) => json!({"error": code_of(&event.data)}),
        Err(code) => {
            chat.hook.stop(&opened.request);
            json!({"error": code})
        }
    }
}

pub(super) fn send(chat: &Chat, device: DeviceId, draft_id: &str, edited: Option<String>) -> Value {
    match chat.hook.send(device, draft_id, edited) {
        Ok(sent_to) => json!({"sent_to": sent_to}),
        Err(code) => json!({"error": code}),
    }
}

fn code_of(data: &Value) -> &str {
    data.get("code").and_then(Value::as_str).unwrap_or("engine")
}
