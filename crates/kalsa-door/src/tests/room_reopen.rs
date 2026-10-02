//! Going back to the chat after the Room: the seat the room's turn took has
//! to come back to the host's chat without a refusal the owner can read as
//! a lost conversation — these hold the whole crossing to that promise.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use kalsa_room::{CallTaken, MemberId, Room};

use super::paging_support::{self as tier, CHAT, HASH, QUIET};
use super::room_support::scratch;
use super::*;

const HOST: u32 = 0;

/// The owner's machine: one engine seat, the host's credential, the room's
/// guest beside it, the disk tier armed.
fn house(dir: &Path) -> (crate::RunningDoor, Arc<Room>, tier::Engine, String) {
    let engine = tier::Engine::start(dir);
    let host = credential();
    let devices = super::room_support::seated_labeled(&[(HOST, "This computer", &host)]);
    let room = Arc::new(Room::open(&scratch("room-reopen")).unwrap());
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

fn host_calls(door: &crate::RunningDoor, room: &Room, id: &str, text: &str) {
    room.post(MemberId::Host, id, text, true)
        .expect("the host's message lands");
    let turn = match room.submit_call(MemberId::Host, id) {
        Ok(CallTaken::Starts(turn)) => turn,
        other => panic!("an empty queue starts the call at once: {other:?}"),
    };
    assert!(door.drive_room_turn(MemberId::Host, turn), "the door drives the turn");
}

fn turn_quiet(room: &Room) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while room.turn_state().running.is_some() {
        assert!(Instant::now() < deadline, "the room's turn never ended");
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn the_chats_activate_waits_for_the_seat_the_room_is_using() {
    // The owner's sequence: chat, Room, back to the chat — while the room's
    // turn still holds the only seat (its handover save, its prefill: on a
    // small CPU either is slow). The activate is a switch, not pressure: it
    // waits for the seat and then opens the chat, and the owner never reads
    // a refusal about a conversation that was never lost.
    let dir = tier::temp_dir("room-reopen-seat");
    let (door, room, engine, host) = house(&dir);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:older").unwrap();
    assert_eq!(tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)), 204);
    tier::wait_for(&engine, 1);
    tier::complete(door.address(), &host);
    tier::wait_for(&engine, 2);

    // The room's turn: the handover save is held a moment by the fake, so
    // the seat is provably taken when the activate arrives.
    engine.delay(Duration::from_millis(1200));
    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    let deadline = Instant::now() + Duration::from_secs(3);
    while engine.sent().len() < 3 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(engine.sent().len() >= 3, "the handover's save never arrived");

    // The activate, while the seat is the room's.
    let address = door.address();
    let answered = std::sync::Arc::new(std::sync::Mutex::new(None::<u16>));
    let watched = std::sync::Arc::clone(&answered);
    let asked = std::thread::spawn(move || {
        let response = tier::activate(address, Some(&host), CHAT);
        *watched.lock().unwrap() = Some(tier::status_of(&response));
    });
    turn_quiet(&room);
    asked.join().unwrap();
    let status = answered.lock().unwrap().expect("the activate answered");
    assert_eq!(status, 204, "the chat opened once the seat came back");

    // And it opened THROUGH the door: the restore is the last ask, after
    // the room's dials — the wait happened, it did not fail.
    tier::wait_for(&engine, 6);
    let sent = engine.sent();
    let actions: Vec<&str> = sent.iter().map(|ask| ask.action.as_str()).collect();
    assert_eq!(
        actions,
        vec!["restore", "", "save", "", "", "restore"],
        "the activate waited for the seat, then restored: {sent:?}"
    );
    door.shutdown();
}

#[test]
fn a_slot_file_the_engine_cannot_load_opens_the_chat_without_it() {
    // The slot directory outlives the engine: a file written by another
    // build, another model, another life can be a file this engine refuses
    // to restore. The warmth is lost with the refusal — the conversation is
    // not: it lives in the app's store, and the chat opens on an empty slot
    // exactly as a chat with no file does, instead of answering a refusal
    // the owner can only read as a conversation that will not open.
    let dir = tier::temp_dir("room-reopen-foreign");
    let (door, _room, engine, host) = house(&dir);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:from-an-older-build").unwrap();
    // The restore of that file is refused — the engine cannot load it.
    engine.reply([tier::Reply::Refused]);

    assert_eq!(
        tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)),
        204,
        "the chat opens; the warmth is what was refused, not the conversation"
    );
    // The slot was emptied for it — the engine's refusal cleared it — and
    // the door says the chat is resident: the next save writes THIS chat.
    tier::wait_for(&engine, 2);
    let sent = engine.sent();
    let actions: Vec<&str> = sent.iter().map(|ask| ask.action.as_str()).collect();
    assert_eq!(actions, vec!["restore", "erase"], "the refused warmth was dropped: {sent:?}");
    assert_eq!(door.residents(), 1, "the chat is the resident now");
    door.shutdown();
}

#[test]
fn an_asleep_engine_and_a_room_turn_still_hand_the_seat_back() {
    // The engine released the slot (the door's map relaxed to Unknown), the
    // room's turn took the seat and ran: the host's activate afterwards
    // restores its file — nothing about the sleep or the room may cost the
    // chat its open.
    let dir = tier::temp_dir("room-reopen-asleep");
    let (door, room, engine, host) = house(&dir);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:older").unwrap();
    tier::complete(door.address(), &host);
    tier::wait_for(&engine, 1);
    // The engine went idle and released the slot: the tick learns it, and
    // the map stops claiming to know the slot.
    door.invalidate_residency();
    assert_eq!(door.save_idle(tier::quiet_since(Instant::now())), 0);

    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    turn_quiet(&room);
    tier::wait_for(&engine, 3);
    assert_eq!(door.residents(), 0, "the sleep and the room named nobody");

    assert_eq!(
        tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)),
        204
    );
    tier::wait_for(&engine, 4);
    assert_eq!(engine.sent()[3].action, "restore");
    assert_eq!(engine.sent()[3].filename, tier::file_name(CHAT));
    door.shutdown();
}

#[test]
fn a_room_turn_whose_handover_save_failed_leaves_the_chat_openable() {
    // The handover's save refused: the turn ends with the engine-problem
    // note and the tier's map untouched — the slot still names the host's
    // chat, which is true, nothing was written into it. The host's activate
    // of that same chat is the early return: the chat is already resident,
    // and no engine call is spent on what is already so.
    let dir = tier::temp_dir("room-reopen-savefailed");
    let (door, room, engine, host) = house(&dir);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:older").unwrap();
    assert_eq!(tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)), 204);
    tier::wait_for(&engine, 1);
    tier::complete(door.address(), &host);
    tier::wait_for(&engine, 2);
    engine.reply([tier::Reply::Refused]);

    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    turn_quiet(&room);
    // The turn ends AT the refused handover: nothing was sent to the engine
    // under a seat whose chat could not be saved, so there are no dials.
    tier::wait_for(&engine, 3);
    let sent = engine.sent();
    let actions: Vec<&str> = sent.iter().map(|ask| ask.action.as_str()).collect();
    assert_eq!(
        actions,
        vec!["restore", "", "save"],
        "the handover's save was refused and the turn ended there: {sent:?}"
    );
    assert_eq!(
        tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)),
        204,
        "the chat the map still names opens without a further ask"
    );
    assert_eq!(engine.sent().len(), 3, "no engine call was spent on what is resident");
    door.shutdown();
}
