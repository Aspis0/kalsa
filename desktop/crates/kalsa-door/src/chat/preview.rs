//! A phone's preview of the page this computer is showing.
//!
//! **The picture is the app's and the door only carries it.** The door
//! authenticates the phone, asks the app for the page that phone owns, and
//! hands back what the app said. The door decides nothing about a picture — it
//! cannot see one.
//!
//! **It has a lane of its own.** A preview is a picture of what is on the
//! screen, and a turn, a mail read and a card's answer are none of those.
//!
//! **The pairing is checked twice.** Before the app is asked, and again before
//! the bytes go out. What has already gone on the wire is not recalled — there
//! is no way to recall it — but nothing leaves here after the second check.

use std::net::TcpStream;
use std::sync::Arc;
use std::thread;
use std::time::Instant;

use serde_json::{json, Value};

use super::{answer, withdrawn, Chat, Lane};
use crate::devices::DeviceId;
use crate::proxy::{self, Shared};

/// The codes a preview can be refused with. **A closed set**, because these are
/// the words the phone reads and the phone cannot be handed a stranger's code.
const CODES: &[&str] = &["no_page", "not_yours", "busy", "too_large", "cancelled", "unavailable"];

/// The largest picture the road carries, as the base64 it is carried in: 256
/// KiB of JPEG is 349,528 characters. **Checked here**, where the bytes are
/// about to go out, because this is the last place that can still say no.
const MAX_IMAGE: usize = 349_528;

pub(super) fn start(
    mut client: TcpStream,
    chat: &Arc<Chat>,
    shared: &Arc<Shared>,
    device: DeviceId,
    origin: Option<&[u8]>,
    deadline: Instant,
) {
    let Some(guard) = chat.take(Lane::Preview, device) else {
        answer(&mut client, "200 OK", origin, deadline, &json!({"error": "busy"}));
        return;
    };
    let chat = Arc::clone(chat);
    let shared = Arc::clone(shared);
    let origin = origin.map(<[u8]>::to_vec);
    let _ = thread::Builder::new()
        .name("kalsa-door-chat-preview".into())
        .spawn(move || {
            let _lane = guard;
            let value = run(&chat, &shared, device, &client);
            answer(&mut client, "200 OK", origin.as_deref(), deadline, &value);
        });
}

fn run(chat: &Chat, shared: &Shared, device: DeviceId, client: &TcpStream) -> Value {
    // Checked before the app is: a phone the owner removed does not get to ask.
    if withdrawn(shared, device) || proxy::client_gone(client) {
        return json!({"error": "cancelled"});
    }
    let answer = match chat.hook.preview(device) {
        Ok(picture) => picture,
        Err(code) => {
            // A code the phone has no words for is turned away here, where it
            // still can be, and not on the phone's screen, where it cannot.
            return json!({"error": if is_code(&code) { code } else { "unavailable".to_string() }});
        }
    };
    // **And again, before the bytes go out.** The app's own check is the one
    // that sees the credential; this one is the last place the door can say no.
    if withdrawn(shared, device) {
        return json!({"error": "cancelled"});
    }
    if !is_picture(&answer) {
        // The app said something this door cannot carry.
        return json!({"error": "unavailable"});
    }
    answer
}

/// Whether the app's answer is a picture this door may carry: the picture, the
/// media type, the host and the moment, each of the right shape. **The app
/// builds the answer field by field**, so this is a check and not a projection.
fn is_picture(answer: &Value) -> bool {
    let Some(object) = answer.as_object() else {
        return false;
    };
    let image = object.get("image").and_then(Value::as_str).unwrap_or_default();
    let host = object.get("host").and_then(Value::as_str).unwrap_or_default();
    object.get("media_type").and_then(Value::as_str) == Some("image/jpeg")
        && !image.is_empty()
        && image.len() <= MAX_IMAGE
        && !host.is_empty()
        && object.get("taken_at").and_then(Value::as_u64).is_some()
}

/// The codes the phone is owed. A code outside the set is turned away here,
/// where it can still be refused, and not on the phone's screen.
fn is_code(code: &str) -> bool {
    CODES.contains(&code)
}
