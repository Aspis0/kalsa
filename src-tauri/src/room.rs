//! The room on this computer, from the app's side: the host's own ways in
//! — plain functions the Tauri commands of the room's desktop view will
//! call — and the reconcile that keeps the room's roster in step with the
//! pairing store, because a device the owner forgets must leave the room
//! the same moment it leaves the door.

use kalsa_door::{DeviceId, Devices};
use kalsa_room::{Entry, MemberEvent, Room};

/// The host posts to its own room. The `client_msg_id` is the caller's to
/// mint and keep stable across retries, exactly as a phone's is.
///
/// R4's room view calls these; nothing in this step does, on order.
#[allow(dead_code)]
pub fn host_post(room: &Room, client_msg_id: &str, text: &str) -> Result<Entry, String> {
    room.post(kalsa_room::MemberId::Host, client_msg_id, text, false)
        .map_err(|error| error.to_string())
}

/// The host's own display name — the one path that sets it. Phones reach
/// theirs through the door; the host is on this computer.
#[allow(dead_code)]
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
/// told it stopped; whatever waits keeps its place. R4's room view calls
/// this; nothing in this step does, on order.
#[allow(dead_code)]
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
        let posted = host_post(&room, "host-1", "from this computer").unwrap();
        assert_eq!(posted.member, kalsa_room::MemberId::Host);
        assert_eq!(set_host_display_name(&room, "Studio").unwrap(), "Studio");
        assert!(set_host_display_name(&room, "Kalsa").is_err());
    }
}
