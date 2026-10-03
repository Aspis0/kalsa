//! The room's live news, fed to the webview as Tauri events: one follower
//! thread reads the room's own event log and re-emits each event as
//! `room-event`, started once beside the room and ended by the flag the
//! app's exit path sets.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager};

use crate::room::{device_labels, wire_name, Labels};
use kalsa_room::{MemberEvent, Room};

/// Starts the feed. The flag is created under the lock and the second
/// caller walks away with nothing: a pump that nobody holds the stop flag
/// for would run past the app's exit, and two pumps would double every
/// event.
pub fn spawn_event_pump(app: tauri::AppHandle, brain: &crate::Brain) {
    let Some(room) = brain.room.get() else {
        return;
    };
    let stop = {
        let mut guard = brain
            .room_events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.as_ref().is_some() {
            return;
        }
        let stop = Arc::new(AtomicBool::new(false));
        *guard = Some(Arc::clone(&stop));
        stop
    };
    let room = Arc::clone(room);
    let thread_stop = Arc::clone(&stop);
    let reader = std::thread::Builder::new()
        .name("kalsa-room-events".into())
        .spawn(move || {
            let mut cursor = room.next_cursor();
            loop {
                if thread_stop.load(Ordering::SeqCst) {
                    return;
                }
                let mut out = Vec::new();
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
                if room.read_since(&mut cursor, deadline, &mut out) == kalsa_room::Take::BadCursor {
                    cursor = room.next_cursor();
                    continue;
                }
                for event in out {
                    if let Ok(payload) = event_payload(&room, &app, event) {
                        let _ = app.emit("room-event", payload);
                    }
                }
            }
        });
    if reader.is_err() {
        // No thread, no feed — and the flag must not stay taken, or no
        // later attempt could ever start one.
        stop.store(true, Ordering::SeqCst);
        brain
            .room_events
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }
}

/// Stops the feed and clears its slot — the app's exit path calls this,
/// so the follower thread never outlives the window it feeds and a later
/// start can begin again from nothing.
pub fn stop_event_pump(brain: &crate::Brain) {
    if let Some(stop) = brain
        .room_events
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
    {
        stop.store(true, Ordering::SeqCst);
    }
}

/// One live event as the webview reads it: `kind` says which, and every
/// member reference carries its resolved display name at send time.
fn event_payload(
    room: &Room,
    app: &tauri::AppHandle,
    event: kalsa_room::Event,
) -> Result<serde_json::Value, String> {
    let labels = app
        .try_state::<crate::Desk>()
        .map(|desk| device_labels(&desk))
        .unwrap_or_else(|| Labels {
            by_device: std::collections::HashMap::new(),
            host: "This computer".to_string(),
        });
    event_json(room, &labels, event)
}

/// The payload's bytes, from the room and the labels alone — no app state —
/// so a test can pin exactly what crosses to the page.
fn event_json(
    room: &Room,
    labels: &Labels,
    event: kalsa_room::Event,
) -> Result<serde_json::Value, String> {
    Ok(match event {
        kalsa_room::Event::Message(entry) => {
            let name = wire_name(room, labels, entry.member);
            let mut payload = serde_json::json!({
                "kind": if entry.member == kalsa_room::MemberId::Ai { "ai_message" } else { "message" },
                "epoch": room.epoch(),
                "seq": entry.seq,
                "member_id": entry.member.wire(),
                "name": name,
                "former": room.is_former(entry.member),
                "text": entry.text,
                "time": entry.time,
                "call_ai": entry.call_ai,
                "read": (entry.member == kalsa_room::MemberId::Ai).then_some(entry.read),
            });
            if !entry.media.is_empty() {
                payload["media"] = serde_json::to_value(&entry.media)
                    .expect("a media descriptor always serializes");
            }
            payload
        }
        kalsa_room::Event::Member(event) => match event {
            MemberEvent::Joined { member, name } => serde_json::json!({
                "kind": "member", "action": "joined", "member_id": member.wire(), "name": name,
            }),
            MemberEvent::Renamed { member, name } => serde_json::json!({
                "kind": "member", "action": "renamed", "member_id": member.wire(), "name": name,
            }),
            MemberEvent::Left { member } => serde_json::json!({
                "kind": "member", "action": "left", "member_id": member.wire(),
                "name": wire_name(room, labels, member),
            }),
        },
        kalsa_room::Event::Ai(kalsa_room::AiEvent::Status {
            state,
            note_code,
            note,
        }) => {
            let turns = room.turn_state();
            serde_json::json!({
                "kind": "ai_status", "state": state,
                "note_code": note_code, "note": note,
                "running": turns.running.map(|member| wire_name(room, labels, member)),
                "queue": turns.pending.iter().map(|member| wire_name(room, labels, *member)).collect::<Vec<_>>(),
                "you_pending": turns.running == Some(kalsa_room::MemberId::Host)
                    || turns.pending.contains(&kalsa_room::MemberId::Host),
            })
        }
        kalsa_room::Event::Ai(kalsa_room::AiEvent::Delta { turn, text }) => {
            serde_json::json!({ "kind": "ai_delta", "turn": turn, "text": text })
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-brain-room-events-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A member's departure is announced with the SAME name rule the views
    /// use: an unnamed host leaves nameless ("" — the page localizes), the
    /// envelope for it built by the pure half of `event_payload`.
    #[test]
    fn a_left_event_carries_the_wire_name() {
        let dir = scratch("left-wire-name");
        let room = Room::open(&dir).unwrap();
        let labels = Labels {
            by_device: std::collections::HashMap::new(),
            host: "This computer".to_string(),
        };

        let payload = event_json(
            &room,
            &labels,
            kalsa_room::Event::Member(MemberEvent::Left {
                member: kalsa_room::MemberId::Host,
            }),
        )
        .unwrap();
        assert_eq!(
            payload["name"], "",
            "the departure names the host by the wire rule"
        );
        assert_eq!(payload["action"], "left");
    }
}
