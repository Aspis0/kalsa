//! The room on this computer, from the app's side: the host's own ways in
//! — plain functions the Tauri commands of the room's desktop view will
//! call — and the reconcile that keeps the room's roster in step with the
//! pairing store, because a device the owner forgets must leave the room
//! the same moment it leaves the door.

use crate::DeviceKind;
use kalsa_door::{DeviceId, Devices};
use kalsa_room::{Entry, MemberEvent, Room};

/// The host posts to their own room. The `client_msg_id` is the caller's to
/// mint and keep stable across retries, exactly as a phone's is.
pub fn host_post(
    room: &Room,
    client_msg_id: &str,
    text: &str,
    call_ai: bool,
) -> Result<Entry, String> {
    room.post(kalsa_room::MemberId::Host, client_msg_id, text, call_ai)
        .map_err(|error| error.to_string())
}

/// The host's own display name — the one path that sets it. Phones reach
/// theirs through the door; the host is on this computer.
pub fn set_host_display_name(room: &Room, name: &str) -> Result<String, String> {
    room.set_host_name(name).map_err(|error| error.to_string())
}

/// The owner's forget, applied to the room the moment the button is
/// pressed: the member retires and its posts are refused at once, before
/// the once-a-second poll swaps the credential set — the poll remains the
/// safety net for every other path a store can change. A room-write
/// failure is RETURNED, not swallowed: the pairing store has already
/// forgotten the device, and the owner is told the room will catch up
/// rather than shown a silent success.
pub fn forget_now(brain: &crate::Brain, device: u32) -> Result<(), String> {
    if let Some(room) = brain.room.get() {
        if let Err(error) = room.forget_device(device) {
            eprintln!("kalsa-brain: the room could not forget a device: {error}");
            return Err(
                "This device was forgotten, but the room could not record it; it will catch up on the next check."
                    .to_string(),
            );
        }
    }
    Ok(())
}

/// The owner stops the room's running turn (HOUSEHOLD-RULES §5.5 — "the
/// machine's owner can always stop the machine"). Whoever called it is
/// told it stopped; whatever waits keeps its place. The room view's Stop
/// button calls this while an answer is running.
pub fn stop_turn(brain: &crate::Brain) -> bool {
    brain.room.get().is_some_and(|room| room.host_stop_turn())
}

/// Brings the room's roster to the pairing store's new state: a device
/// that left the set leaves the room (its member retired, its open stream
/// cut by the same `set_devices` the caller made, the `left` event
/// published), and a device the owner allowed joins under its label. The
/// host's own seat is not a roster member and never passes through here.
pub fn reconcile(room: &Room, host: DeviceId, old: &Devices, new: &Devices) {
    let old_ids: std::collections::HashSet<u32> = old.entries().map(|(id, _)| id.value()).collect();
    let new_ids: std::collections::HashSet<u32> = new.entries().map(|(id, _)| id.value()).collect();
    for (id, _) in old.entries() {
        // The guest's seat is the room's own, not a member's.
        if id != host && id.value() != kalsa_door::ROOM_DEVICE && !new_ids.contains(&id.value()) {
            if let Err(error) = room.forget_device(id.value()) {
                eprintln!("kalsa-brain: the room could not forget a device: {error}");
            }
        }
    }
    for (id, label) in new.entries() {
        if id != host && id.value() != kalsa_door::ROOM_DEVICE && !old_ids.contains(&id.value()) {
            if let Ok(member) = room.enroll(id.value()) {
                room.publish_member(MemberEvent::Joined {
                    member,
                    name: label.to_string(),
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    use kalsa_door::{DeviceEntry, Devices};

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-brain-room-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

    fn devices_of(count: u32) -> Devices {
        let entries = (0..count)
            .map(|index| {
                DeviceEntry::new(
                    DeviceId::new(index),
                    format!("Paired phone {index}"),
                    format!("{index:064x}"),
                )
                .unwrap()
            })
            .collect();
        Devices::new(entries).unwrap()
    }

    #[test]
    fn a_forgotten_device_leaves_the_room_and_a_returning_one_is_new() {
        let dir = scratch("reconcile");
        let room = Room::open(&dir).unwrap();
        // The reconcile diffs; the room before it holds the host alone.
        let host_only = devices_of(1);
        let old = devices_of(3);
        let new = devices_of(2);
        reconcile(&room, DeviceId::new(0), &host_only, &old);
        let gone = room.member_of(2).expect("every paired phone enrolled");
        reconcile(&room, DeviceId::new(0), &old, &new);
        assert!(room.member_of(2).is_none(), "the forgotten device is gone");
        assert!(room.is_former(gone), "and its member is marked former");
        assert!(
            !room.is_former(room.member_of(1).expect("the kept device stays")),
            "the kept device is no former member"
        );

        // The forgotten id pairs again: a fresh member, no history, no name.
        let again = devices_of(3);
        reconcile(&room, DeviceId::new(0), &new, &again);
        let returned = room.member_of(2).expect("the returning device enrolls");
        assert_ne!(returned, gone, "a returning device id is a new member");
        assert!(!room.is_former(returned));
    }

    #[test]
    fn the_host_seat_never_enrolls() {
        let dir = scratch("host-seat");
        let room = Room::open(&dir).unwrap();
        let set = devices_of(2);
        reconcile(&room, DeviceId::new(0), &set, &set);
        assert!(
            room.device_of(kalsa_room::MemberId::Host).is_none(),
            "the host is a fixed seat, not a roster member"
        );
    }

    #[test]
    fn the_ai_engine_seat_never_joins_or_leaves_the_roster() {
        let dir = scratch("guest-seat");
        let room = Room::open(&dir).unwrap();
        let host = DeviceId::new(0);
        let phone = DeviceId::new(1);
        let guest = kalsa_door::guest_entry(&"a".repeat(64)).unwrap();
        let with_guest = Devices::new(vec![
            DeviceEntry::new(host, "This computer", "0".repeat(64)).unwrap(),
            DeviceEntry::new(phone, "Paired phone", "1".repeat(64)).unwrap(),
            guest,
        ])
        .unwrap();
        let without_guest = devices_of(2);
        let cursor = room.next_cursor();

        reconcile(&room, host, &with_guest, &without_guest);
        reconcile(&room, host, &without_guest, &with_guest);

        assert!(room.member_of(kalsa_door::ROOM_DEVICE).is_none());
        assert_eq!(
            room.next_cursor(),
            cursor,
            "the guest emits no join or leave"
        );
    }

    #[test]
    fn the_host_posts_and_names_itself_through_the_iron_paths() {
        let dir = scratch("host-api");
        let room = Room::open(&dir).unwrap();
        let posted = host_post(&room, "host-1", "from this computer", false).unwrap();
        assert_eq!(posted.member, kalsa_room::MemberId::Host);
        assert_eq!(set_host_display_name(&room, "Studio").unwrap(), "Studio");
        assert!(set_host_display_name(&room, "Kalsa").is_err());
    }
}

// --- The desktop room view's commands ---

use tauri::{Emitter, Manager};


use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// One row of the room's member list, as the host's view reads it. Names
/// are resolved here, once, from the room and the pairing labels; a
/// former member keeps the name it had.
#[derive(Serialize)]
pub struct RoomMemberDto {
    pub member_id: u32,
    pub name: String,
    pub kind: &'static str,
    pub former: bool,
}

/// The AI guest's visible state, names only.
#[derive(Serialize)]
pub struct RoomAiDto {
    pub state: &'static str,
    pub running: Option<String>,
    pub queue: Vec<String>,
    pub you_pending: bool,
}

#[derive(Serialize)]
pub struct RoomInfoDto {
    /// The room could not be opened on this computer. The page shows its
    /// one quiet sentence and nothing else; there is nothing to fix here.
    pub open: bool,
    pub room_name: String,
    pub you: u32,
    pub members: Vec<RoomMemberDto>,
    pub ai: RoomAiDto,
}

/// One transcript entry, with its author's display name and the former
/// mark the protocol promises.
#[derive(Serialize)]
pub struct RoomEntryDto {
    pub seq: u64,
    pub member_id: u32,
    pub name: String,
    pub former: bool,
    pub text: String,
    pub time: u64,
    pub call_ai: bool,
    /// The AI's own answer carries how many of the room's messages it
    /// read; `None` on everyone else's.
    pub read: Option<u32>,
    /// The id the sender minted, echoed so the page can match its own
    /// optimistic message to the landed one.
    pub client_msg_id: String,
}

/// The pairing store's device labels, for the display names the room
/// itself does not hold. Read per command: the store is the labels' home
/// and the page refreshes anyway.
fn device_labels(desk: &crate::Desk) -> HashMap<u32, String> {
    kalsa_pairing::store::load_devices(&desk.pairing_file)
        .unwrap_or_default()
        .into_iter()
        .map(|device| (device.id, device.label))
        .collect()
}

/// The display name and the former mark for one member — the host, a
/// phone, or the AI. A former member without a stored name is shown as
/// the doc's fallback: the label went with the device.
fn display_name(
    room: &Room,
    labels: &HashMap<u32, String>,
    member: kalsa_room::MemberId,
) -> String {
    match member {
        kalsa_room::MemberId::Ai => "Kalsa".to_string(),
        kalsa_room::MemberId::Host => room.name_of(member).unwrap_or_else(|| {
            labels
                .values()
                .next()
                .cloned()
                .unwrap_or_else(|| "This computer".to_string())
        }),
        kalsa_room::MemberId::Member(_) => room.name_of(member).unwrap_or_else(|| {
            room.device_of(member)
                .and_then(|device| labels.get(&device).cloned())
                .unwrap_or_else(|| "Former member".to_string())
        }),
    }
}

fn member_dto(room: &Room, labels: &HashMap<u32, String>, member: kalsa_room::MemberId, kind: &'static str) -> RoomMemberDto {
    RoomMemberDto {
        member_id: member.wire(),
        name: display_name(room, labels, member),
        kind,
        former: room.is_former(member),
    }
}

fn entry_dto(room: &Room, labels: &HashMap<u32, String>, entry: &Entry) -> RoomEntryDto {
    RoomEntryDto {
        seq: entry.seq,
        member_id: entry.member.wire(),
        name: display_name(room, labels, entry.member),
        former: room.is_former(entry.member),
        text: entry.text.clone(),
        time: entry.time,
        call_ai: entry.call_ai,
        read: (entry.member == kalsa_room::MemberId::Ai).then_some(entry.read),
        client_msg_id: String::new(),
    }
}

/// The room's own state as the host's view opens: the member list, whose
/// turn it is, and who waits. The host sees everything — no join floor.
#[tauri::command]
pub fn brain_room(desk: tauri::State<'_, crate::Desk>, brain: tauri::State<'_, crate::Brain>) -> Result<RoomInfoDto, String> {
    let Some(room) = brain.room.get() else {
        return Ok(RoomInfoDto {
            open: false,
            room_name: String::new(),
            you: kalsa_room::MemberId::Host.wire(),
            members: Vec::new(),
            ai: RoomAiDto { state: "idle", running: None, queue: Vec::new(), you_pending: false },
        });
    };
    let labels = device_labels(&desk);
    let stored = kalsa_pairing::store::load_devices(&desk.pairing_file).unwrap_or_default();
    let mut members = vec![member_dto(room, &labels, kalsa_room::MemberId::Host, "host")];
    for device in &stored {
        // The host's own record is the first row; the guest's seat is the
        // AI's, and never a member.
        if device.kind == DeviceKind::Host || device.id == kalsa_door::ROOM_DEVICE {
            continue;
        }
        if let Ok(member) = room.enroll(device.id) {
            members.push(member_dto(room, &labels, member, "phone"));
        }
    }
    members.push(member_dto(room, &labels, kalsa_room::MemberId::Ai, "ai"));
    let turns = room.turn_state();
    Ok(RoomInfoDto {
        open: true,
        room_name: stored
            .iter()
            .find(|device| device.kind == DeviceKind::Host)
            .map(|device| device.label.clone())
            .unwrap_or_default(),
        you: kalsa_room::MemberId::Host.wire(),
        members,
        ai: RoomAiDto {
            state: turns.state,
            running: turns.running.map(|member| display_name(room, &labels, member)),
            queue: turns
                .pending
                .iter()
                .map(|member| display_name(room, &labels, *member))
                .collect(),
            you_pending: turns.running == Some(kalsa_room::MemberId::Host)
                || turns.pending.contains(&kalsa_room::MemberId::Host),
        },
    })
}

/// A page of the room's transcript for the host, who sees all of it.
#[tauri::command]
pub fn brain_room_history(
    desk: tauri::State<'_, crate::Desk>,
    brain: tauri::State<'_, crate::Brain>,
    after: Option<u64>,
    before: Option<u64>,
    limit: Option<usize>,
) -> Result<Vec<RoomEntryDto>, String> {
    let Some(room) = brain.room.get() else {
        return Ok(Vec::new());
    };
    let labels = device_labels(&desk);
    let limit = limit.unwrap_or(100).clamp(1, 200);
    let page = match (after, before) {
        (Some(after), _) => room.page_after(1, after, limit),
        (None, Some(before)) => room.page_before(1, before, limit),
        (None, None) => room.newest_page(1, limit),
    }
    .map_err(|error| error.to_string())?;
    Ok(page
        .messages
        .iter()
        .map(|entry| entry_dto(room, &labels, entry))
        .collect())
}

/// The host's own message into the room, with the call flag the button
/// carries — the store itself adds a call for "@Kalsa" in the text.
#[tauri::command]
pub fn brain_room_post(
    brain: tauri::State<'_, crate::Brain>,
    desk: tauri::State<'_, crate::Desk>,
    client_msg_id: String,
    text: String,
    call_ai: bool,
) -> Result<RoomEntryDto, String> {
    let Some(room) = brain.room.get() else {
        return Err(CLOSED_ROOM.to_string());
    };
    let entry = host_post(room, &client_msg_id, &text, call_ai)?;
    let labels = device_labels(&desk);
    let mut dto = entry_dto(room, &labels, &entry);
    dto.client_msg_id = client_msg_id;
    Ok(dto)
}

/// The host's own display name in this room.
#[tauri::command]
pub fn brain_room_set_name(
    brain: tauri::State<'_, crate::Brain>,
    name: String,
) -> Result<String, String> {
    let Some(room) = brain.room.get() else {
        return Err(CLOSED_ROOM.to_string());
    };
    set_host_display_name(room, &name)
}

/// The host stops the running answer. `false` when nothing is running:
/// the page shows Stop only while an answer streams, so a click that
/// raced the end simply does nothing.
#[tauri::command]
pub fn brain_room_stop(brain: tauri::State<'_, crate::Brain>) -> Result<bool, String> {
    Ok(stop_turn(brain.inner()))
}

/// The sentence behind every command when the room never opened: one
/// fact, nothing to fix, no technical word.
const CLOSED_ROOM: &str = "The room opens when the assistant runs.";

/// The room's live news, fed to the webview as Tauri events: one follower
/// thread reads the room's own event log and re-emits each event as
/// `room-event`. Started once beside the room, ended by the flag the
/// app's exit path sets.
pub fn spawn_event_pump(app: tauri::AppHandle, brain: &crate::Brain) {
    let Some(room) = brain.room.get() else {
        return;
    };
    let stop = Arc::new(AtomicBool::new(false));
    brain.room_events.get_or_init(|| Arc::clone(&stop));
    let room = Arc::clone(room);
    let reader = std::thread::Builder::new()
        .name("kalsa-room-events".into())
        .spawn(move || {
            let mut cursor = room.next_cursor();
            loop {
                if stop.load(Ordering::SeqCst) {
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
        eprintln!("kalsa-brain: the room's event feed could not start");
    }
}

/// Stops the event pump — the app's exit path calls this, so the follower
/// thread never outlives the window it feeds.
pub fn stop_event_pump(brain: &crate::Brain) {
    if let Some(stop) = brain.room_events.get() {
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
        .unwrap_or_default();
    Ok(match event {
        kalsa_room::Event::Message(entry) => {
            let dto = entry_dto(room, &labels, &entry);
            serde_json::json!({
                "kind": if entry.member == kalsa_room::MemberId::Ai { "ai_message" } else { "message" },
                "seq": dto.seq,
                "member_id": dto.member_id,
                "name": dto.name,
                "former": dto.former,
                "text": dto.text,
                "time": dto.time,
                "call_ai": dto.call_ai,
                "read": dto.read,
            })
        }
        kalsa_room::Event::Member(event) => match event {
            kalsa_room::MemberEvent::Joined { member, name } => serde_json::json!({
                "kind": "member", "action": "joined", "member_id": member.wire(), "name": name,
            }),
            kalsa_room::MemberEvent::Renamed { member, name } => serde_json::json!({
                "kind": "member", "action": "renamed", "member_id": member.wire(), "name": name,
            }),
            kalsa_room::MemberEvent::Left { member } => serde_json::json!({
                "kind": "member", "action": "left", "member_id": member.wire(),
                "name": display_name(room, &labels, member),
            }),
        },
        kalsa_room::Event::Ai(kalsa_room::AiEvent::Status { state, note_code, note }) => {
            let turns = room.turn_state();
            serde_json::json!({
                "kind": "ai_status", "state": state,
                "note_code": note_code, "note": note,
                "running": turns.running.map(|member| display_name(room, &labels, member)),
                "queue": turns.pending.iter().map(|member| display_name(room, &labels, *member)).collect::<Vec<_>>(),
                "you_pending": turns.running == Some(kalsa_room::MemberId::Host)
                    || turns.pending.contains(&kalsa_room::MemberId::Host),
            })
        }
        kalsa_room::Event::Ai(kalsa_room::AiEvent::Delta { turn, text }) => {
            serde_json::json!({ "kind": "ai_delta", "turn": turn, "text": text })
        }
    })
}
