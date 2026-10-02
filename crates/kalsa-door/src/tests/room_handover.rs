//! The handover a stolen seat owes the disk tier. One engine seat, shared by
//! demand between the host's chat and the room's guest: every crossing is a
//! moment where the map in `paging` names a chat in a slot whose state is
//! about to be replaced, and these tests hold the line — the evicted chat is
//! saved under its own name, the slot stops being named for it, and the
//! evicted device's next activate restores its file instead of finding a
//! stranger's state as its own.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use kalsa_room::{CallTaken, MemberId, Room};

use super::paging_support::{self as tier, CHAT, HASH, QUIET};
use super::room_support::scratch;
use super::*;

const HOST: u32 = 0;

/// The house the review described: one engine seat, the host's credential,
/// the room's guest seated beside it, and the disk tier armed — model hash,
/// save directory, and the idle clock the app derives.
fn house(dir: &Path) -> (crate::RunningDoor, Arc<Room>, tier::Engine, String) {
    let engine = tier::Engine::start(dir);
    let host = credential();
    let devices = super::room_support::seated_labeled(&[(HOST, "This computer", &host)]);
    let room = Arc::new(Room::open(&scratch("room-handover")).unwrap());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let door = crate::Door::new_with_engine(
        listener,
        engine.port,
        devices,
        1,
        EnginePrivateHeaders::Consumed,
    )
    .unwrap()
    .with_model_hash(HASH)
    .unwrap()
    .with_slot_dir(dir.to_path_buf())
    .with_idle_save(QUIET)
    .with_room(Arc::clone(&room), DeviceId::new(HOST))
    .start()
    .unwrap();
    (door, room, engine, host)
}

/// The host calls @Kalsa the way the desktop drives it: the message lands,
/// the call is taken, the app's own door drives the turn.
fn host_calls(door: &crate::RunningDoor, room: &Room, id: &str, text: &str) {
    room.post(MemberId::Host, id, text, true)
        .expect("the host's message lands");
    let turn = match room.submit_call(MemberId::Host, id) {
        Ok(CallTaken::Starts(turn)) => turn,
        other => panic!("an empty queue starts the call at once: {other:?}"),
    };
    assert!(
        door.drive_room_turn(MemberId::Host, turn),
        "the door drives its own room's turns"
    );
}

/// The guest's cache salt, the identity the room's own requests seal.
fn guest_salt(host_credential: &str) -> String {
    let guest = crate::guest_entry(host_credential).expect("the guest seats");
    let devices = Devices::new(vec![guest]).unwrap();
    devices
        .cache_salt(DeviceId::new(crate::ROOM_DEVICE))
        .expect("the guest is held")
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Waits until no turn of the room is running — the driver has ended it,
/// and the seat's lease went with the turn that held it.
fn turn_quiet(room: &Room) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while room.turn_state().running.is_some() {
        assert!(Instant::now() < deadline, "the room's turn never ended");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn a_stolen_seat_never_writes_the_room_into_the_hosts_chat_file() {
    // The reviewer's sequence, exactly: the host chats (the slot goes
    // dirty), the room's turn takes the seat inside the save window, the
    // idle tick runs, and the host activates again. The host's chat file
    // must hold the host's state: the one save under its name is the
    // handover's own, sent BEFORE the room's request, and the tick that
    // runs after writes nothing — not the room's words, not anything.
    let dir = tier::temp_dir("room-handover-leak");
    let (door, room, engine, host) = house(&dir);
    let salt_of_host = tier::salt_of(&host);
    let salt_of_guest = guest_salt(&host);

    // The chat exists on disk, as a chat with a history does.
    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:an-older-state").unwrap();
    assert_eq!(
        tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)),
        204
    );
    tier::wait_for(&engine, 1);
    assert_eq!(door.residents(), 1, "the slot names the host's chat");

    // The host's completion: the slot now holds state its file does not.
    tier::complete(door.address(), &host);
    let quiet_at = tier::quiet_since(Instant::now());

    // The room's turn takes the seat. Its request is the prefill that would
    // fill the slot with the room's words; the fake engine does not speak
    // SSE, so the turn fails after its retry — the handover is done before
    // either dial, which is what this test reads.
    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    turn_quiet(&room);
    // Five asks, in order: the first restore, the host's completion, the
    // handover's save, and the room's two dials (the one free retry).
    tier::wait_for(&engine, 5);

    // The idle tick, past the slot's quiet: nothing is owed any more — the
    // handover saved the host's chat and cleared the mark — so nothing is
    // written and nothing is attempted.
    assert_eq!(door.save_idle(quiet_at), 0, "the tick wrote a slot");
    let sent = engine.sent();
    let saves: Vec<usize> = sent
        .iter()
        .enumerate()
        .filter(|(_, ask)| ask.action == "save")
        .map(|(at, _)| at)
        .collect();
    assert_eq!(
        saves,
        vec![2],
        "one save only — the handover's, before the room's request: {sent:?}"
    );
    assert_eq!(
        sent[2].salt, salt_of_host,
        "the handover's save is the host's own"
    );
    assert_eq!(sent[2].filename, format!("{}{}", tier::file_name(CHAT), ".staging"));
    let dials: Vec<&tier::Sent> = sent.iter().filter(|ask| ask.salt == salt_of_guest).collect();
    assert_eq!(
        dials.len(),
        2,
        "the room asked twice (the one free retry): {sent:?}"
    );
    assert_eq!(
        door.residents(),
        0,
        "the slot names nobody after the handover"
    );

    // The host comes back: the activate must not take the early return a
    // stale map would give it — the slot is not the host's chat any more —
    // and restores the file the handover wrote.
    assert_eq!(
        tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)),
        204
    );
    tier::wait_for(&engine, 6);
    let sent = engine.sent();
    let restores: Vec<usize> = sent
        .iter()
        .enumerate()
        .filter(|(_, ask)| ask.action == "restore")
        .map(|(at, _)| at)
        .collect();
    assert_eq!(
        restores,
        vec![0, 5],
        "the host's chat was opened, then restored after the room: {sent:?}"
    );
    assert_eq!(sent[5].filename, tier::file_name(CHAT));
    let file = std::fs::read_to_string(dir.join(tier::file_name(CHAT))).unwrap();
    // The fake engine writes the file it was asked to write — the staging
    // name — and the door renamed it into place: the host's file holds the
    // handover's save of the host's state, not the older state it started
    // with and never the room's words.
    assert_eq!(
        file,
        format!("state:1:{}.staging", tier::file_name(CHAT)),
        "the host's file holds the handover's save of the host's state"
    );
    door.shutdown();
}

#[test]
fn the_host_comes_back_to_its_own_chat_warm_after_the_room() {
    // chat → room → chat: the host's state reaches its file at the
    // handover and comes back through a restore — the same warm recall a
    // switch between two chats buys — instead of the early return a stale
    // map would give (no engine call at all) or a rebuild from nothing.
    let dir = tier::temp_dir("room-handover-warm");
    let (door, room, engine, host) = house(&dir);
    let salt_of_host = tier::salt_of(&host);
    let salt_of_guest = guest_salt(&host);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:an-older-state").unwrap();
    assert_eq!(
        tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)),
        204
    );
    tier::wait_for(&engine, 1);

    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    turn_quiet(&room);
    tier::wait_for(&engine, 4);

    assert_eq!(
        tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)),
        204
    );
    tier::wait_for(&engine, 5);
    let sent = engine.sent();
    // The warm road, in order: the first restore, the handover's save of
    // the host's chat under the host's salt, the room's two dials under the
    // guest's, and the restore that brings the host's chat back.
    let actions: Vec<&str> = sent.iter().map(|ask| ask.action.as_str()).collect();
    assert_eq!(
        actions,
        vec!["restore", "save", "", "", "restore"],
        "the crossing, in order: {sent:?}"
    );
    assert_eq!(sent[1].salt, salt_of_host);
    assert_eq!(sent[2].salt, salt_of_guest);
    assert_eq!(sent[4].filename, tier::file_name(CHAT));
    assert_eq!(
        door.residents(),
        1,
        "the host's chat is resident again, by its own activate"
    );
    door.shutdown();
}
