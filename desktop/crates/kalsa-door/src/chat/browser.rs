//! A phone's answer to one of its own browser cards.
//!
//! **The card is the sidecar's and the answer is the desktop's.** This route only
//! carries the id and which button the person pressed to the app, and hands back
//! what became of it — the same code and host the desktop's own card reports. A
//! phone is the person's own paired device on the encrypted road, so it decides
//! with the same card and the same Show button; nothing about the decision is made
//! here.
//!
//! **It has a lane of its own** because it is the one call a running turn is
//! waiting on: the turn raised the card, got the id back, and finished. Refusing
//! the answer as busy would leave every write unanswerable.
//!
//! **The five minutes are the card's, and are enforced where the card is.** This
//! route holds no clock of its own: an answer that arrives late finds no card, and
//! is told `card_expired` rather than dispatched — the same rule the desktop's own
//! button is under, because both go through the same store.

use std::net::TcpStream;
use std::sync::Arc;
use std::thread;
use std::time::Instant;

use serde_json::{json, Value};

use super::{answer, withdrawn, Chat, Lane};
use crate::devices::DeviceId;
use crate::proxy::{self, Shared};

/// The card an answer names and which button was pressed. **Two fields, one
/// argument**: they are one thing the person did, and a route that took them
/// apart could be called with a card and the wrong button.
#[derive(Clone)]
pub(super) struct Press {
    pub(super) card_id: String,
    pub(super) allow: bool,
}

pub(super) fn start(
    mut client: TcpStream,
    chat: &Arc<Chat>,
    shared: &Arc<Shared>,
    device: DeviceId,
    press: Press,
    origin: Option<&[u8]>,
    deadline: Instant,
) {
    let Some(guard) = chat.take(Lane::Browser, device) else {
        answer(&mut client, "200 OK", origin, deadline, &json!({"error": "busy"}));
        return;
    };
    let chat = Arc::clone(chat);
    let shared = Arc::clone(shared);
    let origin = origin.map(<[u8]>::to_vec);
    let _ = thread::Builder::new()
        .name("kalsa-door-chat-browser".into())
        .spawn(move || {
            let _lane = guard;
            let value = run(&chat, &shared, device, &press, &client);
            answer(&mut client, "200 OK", origin.as_deref(), deadline, &value);
        });
}

fn run(chat: &Chat, shared: &Shared, device: DeviceId, press: &Press, client: &TcpStream) -> Value {
    // Asked before the app is, and again by the app itself: a phone that was
    // forgotten between the door's check and the dispatch must not spend a card,
    // and the app's own pairing check is the one that sees the credential.
    if withdrawn(shared, device) || proxy::client_gone(client) {
        return json!({"error": "cancelled"});
    }
    match chat.hook.answer_browser(device, &press.card_id, press.allow) {
        // The app answers with the desktop's own words: a code from a closed set
        // and, only where something went, a bare host. They are passed on as they
        // are, so a phone cannot learn a code or a host the desktop would not
        // show.
        Ok(outcome) => outcome,
        Err(code) => json!({"error": code}),
    }
}