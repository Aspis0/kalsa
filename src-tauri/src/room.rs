//! The room on this computer, from the app's side: the host's own ways in
//! — the functions the room commands call — the name resolution both the
//! commands and the event feed share, and the reconcile that keeps the
//! room's roster in step with the pairing store, because a device the
//! owner forgets must leave the room the same moment it leaves the door.

use crate::DeviceKind;
use kalsa_door::{DeviceId, Devices};
use kalsa_room::{Entry, MemberEvent, MemberId, Room};
use std::collections::HashMap;

/// The host posts to their own room. The `client_msg_id` is the caller's to
/// mint and keep stable across retries, exactly as a phone's is.
pub fn host_post(
    room: &Room,
    client_msg_id: &str,
    text: &str,
    call_ai: bool,
) -> Result<Entry, kalsa_room::PostError> {
    room.post(kalsa_room::MemberId::Host, client_msg_id, text, call_ai)
}

/// The host's own display name — the one path that sets it. Phones reach
/// theirs through the door; the host is on this computer.
pub fn set_host_display_name(
    room: &Room,
    name: &str,
) -> Result<String, kalsa_room::NameError> {
    room.set_host_name(name)
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

/// The pairing store's device labels, for the display names the room
/// itself does not hold, plus the host's own label read from the Host
/// record — the fallback for the host's name must be THIS computer's, not
/// whichever phone a hash map happens to hand back first. Read per
/// command: the store is the labels' home and the page refreshes anyway.
pub(crate) struct Labels {
    pub(crate) by_device: HashMap<u32, String>,
    pub(crate) host: String,
}

pub(crate) fn device_labels(desk: &crate::Desk) -> Labels {
    let stored = kalsa_pairing::store::load_devices(&desk.pairing_file).unwrap_or_default();
    let host = stored
        .iter()
        .find(|device| device.kind == DeviceKind::Host)
        .map(|device| device.label.clone())
        .unwrap_or_else(|| "This computer".to_string());
    Labels {
        by_device: stored
            .into_iter()
            .map(|device| (device.id, device.label))
            .collect(),
        host,
    }
}

pub(crate) fn display_name(room: &Room, labels: &Labels, member: kalsa_room::MemberId) -> String {
    match member {
        kalsa_room::MemberId::Ai => "Kalsa".to_string(),
        kalsa_room::MemberId::Host => {
            room.name_of(member).unwrap_or_else(|| labels.host.clone())
        }
        kalsa_room::MemberId::Member(_) => room.name_of(member).unwrap_or_else(|| {
            room.device_of(member)
                .and_then(|device| labels.by_device.get(&device).cloned())
                .unwrap_or_else(|| "Former member".to_string())
        }),
    }
}

/// Why the host's call was not taken, as the protocol's pair.
pub(crate) struct CallOutcome {
    pub(crate) ai_call: Option<&'static str>,
    pub(crate) refusal: Option<&'static str>,
}

/// Takes the host's call and drives it on the running door. A drive that
/// fails releases the turn it took — `end_turn` hands the queue's next
/// call back, and that one is tried too — so a door that cannot drive
/// never leaves a phantom turn every member waits behind. The message the
/// call rode on stays in the transcript either way.
pub(crate) fn take_host_call(
    room: &Room,
    client_msg_id: &str,
    mut drive: impl FnMut(MemberId, u64) -> bool,
) -> CallOutcome {
    match room.submit_call(kalsa_room::MemberId::Host, client_msg_id) {
        Err(_) => CallOutcome {
            ai_call: Some("refused"),
            refusal: Some("already_pending"),
        },
        Ok(kalsa_room::CallTaken::Queued) => CallOutcome {
            ai_call: Some("queued"),
            refusal: None,
        },
        Ok(kalsa_room::CallTaken::Starts(turn)) => {
            let mut current = Some((kalsa_room::MemberId::Host, turn));
            while let Some((member, this_turn)) = current {
                if drive(member, this_turn) {
                    return CallOutcome {
                        ai_call: Some("queued"),
                        refusal: None,
                    };
                }
                current = room.end_turn(member);
            }
            CallOutcome {
                ai_call: Some("refused"),
                refusal: Some("could_not_start"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    use kalsa_door::{DeviceEntry, Devices};
    use kalsa_room::{CallRefused, CallTaken};

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

    fn open(name: &str) -> (std::path::PathBuf, Room) {
        let dir = scratch(name);
        let room = Room::open(&dir).unwrap();
        (dir, room)
    }

    fn phone(room: &Room, device: u32) -> kalsa_room::MemberId {
        room.enroll(device).expect("the device enrolls")
    }

    fn member_number(member: kalsa_room::MemberId) -> u32 {
        match member {
            kalsa_room::MemberId::Member(number) => number,
            other => other.wire(),
        }
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
        let dir = scratch("ai-seat");
        let room = Room::open(&dir).unwrap();
        let before = room.entries_for_ai().len();
        reconcile(&room, DeviceId::new(0), &devices_of(1), &devices_of(3));
        assert_eq!(
            room.member_of(kalsa_door::ROOM_DEVICE),
            None,
            "the guest's engine seat is not a roster member"
        );
        assert_eq!(room.entries_for_ai().len(), before);
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

    #[test]
    fn a_failed_drive_releases_the_whole_line() {
        let (_dir, room) = open("take_call_release");
        let host = kalsa_room::MemberId::Host;
        let a = phone(&room, 1);
        // The drive fails, and while it was being tried a new call queued
        // behind the turn it could not start — exactly what a slow phone
        // looks like to the queue.
        let refused = take_host_call(&room, "h1", |_, _| {
            let _ = room.submit_call(a, "a1");
            false
        });
        assert_eq!(refused.refusal, Some("could_not_start"));
        // The release frees the host's turn AND the queued call: nothing
        // left running, nothing waiting, both free to call again fresh.
        let state = room.turn_state();
        assert!(
            state.running.is_none() && state.pending.is_empty(),
            "the phantom turn and the queued call were released"
        );
        assert!(matches!(
            room.submit_call(a, "a1-fresh"),
            Ok(CallTaken::Starts(_))
        ));
        assert_eq!(
            room.submit_call(host, "h1-fresh"),
            Ok(CallTaken::Queued),
            "the host joins behind it instead of being refused as pending"
        );
    }

    #[test]
    fn a_working_drive_leaves_the_line_alone() {
        let (_dir, room) = open("take_call_driven");
        let host = kalsa_room::MemberId::Host;
        let a = phone(&room, 1);
        let outcome = take_host_call(&room, "h1", |member, turn| {
            // A real drive does not release: the turn stays running, and a
            // call that arrives while it runs queues behind it.
            assert_eq!(member, host);
            assert_eq!(turn, 1);
            assert!(room.turn_alive(turn));
            assert_eq!(room.submit_call(a, "a1"), Ok(CallTaken::Queued));
            true
        });
        assert_eq!(outcome.ai_call, Some("queued"));
        assert!(room.turn_alive(1), "the driven turn is still running");
        // The call the drive closure queued is still waiting; a DIFFERENT
        // one from the same member is refused as pending.
        assert_eq!(
            room.submit_call(a, "a2"),
            Err(CallRefused::AlreadyPending),
            "the running turn is not a phantom to be queued past"
        );
    }
}
