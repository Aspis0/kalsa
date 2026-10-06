//! The names the room answers with: the host's own entries carry its
//! seat's label — or the door's word when that seat has no label — a
//! departed member keeps the former mark, and neither borrows the other's
//! answer.

use std::sync::Arc;

use kalsa_room::{MemberId, Room};

use super::room_support::{body_json, devices_labeled, get, post, scratch, text_of};
use super::*;

const HOST: u32 = 0;
const PHONE_ONE: u32 = 1;
const PHONE_TWO: u32 = 2;

/// A running door whose host device wears `host_label`, two phones beside
/// it, and the three credentials that open it.
fn room_of(host_label: &str) -> (crate::RunningDoor, Arc<Room>, [String; 3]) {
    let host = credential();
    let one = credential();
    let two = credential();
    let devices = devices_labeled(&[
        (HOST, host_label, &host),
        (PHONE_ONE, "Paired phone", &one),
        (PHONE_TWO, "Paired phone 2", &two),
    ]);
    let room = Arc::new(Room::open(&scratch("room-names")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        1, // the room is never forwarded; the port is never dialed
        devices,
        3,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_room(Arc::clone(&room), DeviceId::new(HOST))
    .start()
    .unwrap();
    (door, room, [host, one, two])
}

#[test]
fn the_hosts_own_entries_carry_its_seats_label() {
    let (door, room, [_, one, _]) = room_of("Desk of Marco");
    let bearer = format!("Bearer {one}");
    // The phone's own request enrolls it first, so its floor covers the
    // host's post that follows.
    let opened = get(door.address(), Some(&bearer), "/kalsa/room/info");
    assert!(opened.starts_with(b"HTTP/1.1 200"), "{}", text_of(&opened));
    // The host posts as the app does: through the room, as the host.
    room.post(MemberId::Host, "host-1", "look at this", false, &[])
        .unwrap();

    let page = body_json(&get(door.address(), Some(&bearer), "/kalsa/room/history"));
    let entry = page["messages"]
        .as_array()
        .unwrap()
        .first()
        .expect("the host's entry is in the history");
    assert_eq!(entry["member_id"], MemberId::Host.wire());
    assert_eq!(entry["name"], "Desk of Marco");
    assert!(
        entry.get("former").is_none(),
        "the host is nobody's former member: {entry}"
    );

    // The host's seat gone from the set: its label is the door's word for
    // an unlabeled computer, and room_name says the same.
    door.set_devices(devices_labeled(&[(PHONE_ONE, "Paired phone", &one)]));
    let page = body_json(&get(door.address(), Some(&bearer), "/kalsa/room/history"));
    assert_eq!(page["messages"][0]["name"], "This computer");
    let info = body_json(&get(door.address(), Some(&bearer), "/kalsa/room/info"));
    assert_eq!(info["room_name"], "This computer");
    assert_eq!(info["members"][0]["name"], "This computer");
    door.shutdown();
}

#[test]
fn a_departed_members_entries_still_read_former_member() {
    let (door, room, [_, one, two]) = room_of("This computer");
    let first = format!("Bearer {one}");
    let second = format!("Bearer {two}");
    // Phone one enrolls first, so its floor covers what phone two says.
    let opened = get(door.address(), Some(&first), "/kalsa/room/info");
    assert!(opened.starts_with(b"HTTP/1.1 200"), "{}", text_of(&opened));
    post(
        door.address(),
        Some(&second),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"gone","text":"one last thing"}"#,
    );
    room.forget_device(PHONE_TWO).unwrap();

    let page = body_json(&get(door.address(), Some(&first), "/kalsa/room/history"));
    let entry = page["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["text"] == "one last thing")
        .expect("the departed member's entry stays in the transcript");
    assert_eq!(entry["name"], "Former member");
    assert_eq!(entry["former"], true);
    door.shutdown();
}
