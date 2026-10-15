//! The phone's mail read and send. The read is the page's: it runs the mail
//! read and answers with the record. The send never goes through the page: the
//! app sends the draft it stored, to the recipient the stored draft names. Each
//! runs on a thread of its own, so a read that waits on the page holds no door
//! worker.

use std::net::TcpStream;
use std::sync::Arc;
use std::thread;
use std::time::Instant;

use serde_json::{json, Value};

use super::{answer, await_answer, withdrawn, Chat, Lane};
use crate::devices::DeviceId;
use crate::proxy::{self, Shared};

pub(super) enum Call {
    Read(String),
    Send {
        draft_id: String,
        edited: Option<String>,
    },
}

pub(super) fn start(
    mut client: TcpStream,
    chat: &Arc<Chat>,
    shared: &Arc<Shared>,
    device: DeviceId,
    call: Call,
    origin: Option<&[u8]>,
    deadline: Instant,
) {
    let Some(guard) = chat.take(Lane::Mail, device) else {
        answer(&mut client, "200 OK", origin, deadline, &json!({"error": "busy"}));
        return;
    };
    let chat = Arc::clone(chat);
    let shared = Arc::clone(shared);
    let origin = origin.map(<[u8]>::to_vec);
    let _ = thread::Builder::new()
        .name("kalsa-door-chat-mail".into())
        .spawn(move || {
            let _lane = guard;
            let value = run(&chat, &shared, device, call, &client);
            answer(&mut client, "200 OK", origin.as_deref(), deadline, &value);
        });
}

fn run(chat: &Chat, shared: &Shared, device: DeviceId, call: Call, client: &TcpStream) -> Value {
    // Asked again here, not only at the route: the thread may have started late,
    // and a forget or a stop in between must not reach the page or the mail.
    let cut = || withdrawn(shared, device) || proxy::client_gone(client);
    if cut() {
        return json!({"error": "cancelled"});
    }
    match call {
        Call::Read(id) => read(chat, device, id, shared, &cut),
        Call::Send { draft_id, edited } => match chat.hook.send(device, &draft_id, edited) {
            Ok(sent_to) => json!({"sent_to": sent_to}),
            Err(code) => json!({"error": code}),
        },
    }
}

fn read(
    chat: &Chat,
    device: DeviceId,
    id: String,
    shared: &Shared,
    cut: &dyn Fn() -> bool,
) -> Value {
    let Some(opened) = chat.hook.open(device, "read", json!({"id": id})) else {
        return json!({"error": "no_runner"});
    };
    match await_answer(&opened.events, &shared.clocks, &["read"], cut) {
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

fn code_of(data: &Value) -> &str {
    data.get("code").and_then(Value::as_str).unwrap_or("engine")
}
