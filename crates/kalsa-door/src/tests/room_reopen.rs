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
    room.post(MemberId::Host, id, text, true, &[])
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
    door.invalidate_residency(&door.residency_sample());
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

#[test]
fn a_room_route_under_a_taken_seat_answers_now_rather_than_waiting() {
    // The wait belongs to the tier's two routes alone: the room's own
    // routes are ordinary requests against a full house, and an /kalsa/
    // prefix is not a licence to park a worker on them for the seat's
    // whole life. While the room's turn holds the only seat, a room read
    // answers the honest 503 immediately.
    let dir = tier::temp_dir("room-reopen-roomroute");
    let (door, room, engine, host) = house(&dir);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:older").unwrap();
    assert_eq!(tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)), 204);
    tier::wait_for(&engine, 1);
    tier::complete(door.address(), &host);
    tier::wait_for(&engine, 2);

    // The turn's handover save is held, so the seat is provably taken.
    engine.delay(Duration::from_millis(1500));
    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    let deadline = Instant::now() + Duration::from_secs(3);
    while engine.sent().len() < 3 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(engine.sent().len() >= 3, "the handover's save never arrived");

    // The room's own route, while the seat is the turn's.
    let began = Instant::now();
    let answer = super::room_support::get(
        door.address(),
        Some(&format!("Bearer {host}")),
        "/kalsa/room/info",
    );
    let answered = began.elapsed();
    assert_eq!(
        tier::status_of(&answer),
        503,
        "a full house is the honest answer: {}",
        String::from_utf8_lossy(&answer)
    );
    assert!(
        answered < Duration::from_millis(900),
        "the room route waited for the seat: {answered:?}"
    );
    turn_quiet(&room);
    door.shutdown();
}

#[test]
fn a_third_concurrent_switch_waiter_is_answered_rather_than_parked() {
    // The wait is scarce on purpose: at most one waiter per device and two
    // in all, or four parked workers would starve the phones and the room
    // behind them. The third switch — and a device's own second — get the
    // honest 503 at once; the two admitted waiters still get their chats.
    let dir = tier::temp_dir("room-reopen-cap");
    let engine = tier::Engine::start(&dir);
    let host = credential();
    let one = credential();
    let two = credential();
    let devices = super::room_support::seated_labeled(&[
        (HOST, "This computer", &host),
        (1, "Paired phone", &one),
        (2, "Second phone", &two),
    ]);
    let room = Arc::new(Room::open(&scratch("room-reopen-cap")).unwrap());
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

    // The room's turn holds the seat for a while.
    engine.delay(Duration::from_millis(1500));
    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    let deadline = Instant::now() + Duration::from_secs(3);
    while engine.sent().len() < 1 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }

    // Two switch waiters are admitted (the host's and the first phone's);
    // the second phone's is the third, and the host's own second is the
    // per-device refusal.
    let address = door.address();
    let ask = |token: String, id: &'static str| {
        std::thread::spawn(move || {
            let response = tier::activate(address, Some(&token), id);
            (tier::status_of(&response), Instant::now())
        })
    };
    let first = ask(host.clone(), CHAT);
    let second = ask(one.clone(), "phone-one-chat");
    std::thread::sleep(Duration::from_millis(300));
    let third_began = Instant::now();
    let third = ask(two.clone(), "phone-two-chat");
    let again = ask(host.clone(), CHAT);

    let (third_status, third_at) = third.join().unwrap();
    assert_eq!(third_status, 503, "the third waiter is answered, not parked");
    assert!(
        third_at - third_began < Duration::from_millis(900),
        "the third waiter waited for the seat"
    );
    let (again_status, again_at) = again.join().unwrap();
    assert_eq!(again_status, 503, "a device's own second waiter is refused");
    assert!(
        again_at - third_began < Duration::from_millis(900),
        "the second waiter of a device waited for the seat"
    );

    // The two admitted waiters still opened their chats.
    let (first_status, _) = first.join().unwrap();
    let (second_status, _) = second.join().unwrap();
    assert_eq!(first_status, 204, "the first waiter opened its chat");
    assert_eq!(second_status, 204, "the second waiter opened its chat");
    turn_quiet(&room);
    door.shutdown();
}

#[test]
fn the_chats_completion_after_the_room_recalls_the_saved_chat() {
    // The owner's P2: chat -> room -> chat works, but the completion after
    // the room re-prefilled the whole history from nothing — the UI never
    // re-activated, so nothing told the engine which chat it was continuing
    // even though the handover had just saved that chat to disk. The seat's
    // return now recalls it: the restore is in the engine's log BEFORE the
    // completion, and the map names the chat again for the saves that
    // follow.
    let dir = tier::temp_dir("room-reopen-recall");
    let (door, room, engine, host) = house(&dir);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:older").unwrap();
    assert_eq!(tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)), 204);
    tier::wait_for(&engine, 1);
    // The chat goes to the room dirty: the handover saves it.
    tier::complete(door.address(), &host);
    tier::wait_for(&engine, 2);
    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    turn_quiet(&room);
    tier::wait_for(&engine, 5);
    let before = engine.sent().len();

    // Back to the chat: the next completion, with no activate anywhere.
    tier::complete(door.address(), &host);
    tier::wait_for(&engine, before + 2);

    let sent = engine.sent();
    let actions: Vec<&str> = sent.iter().map(|ask| ask.action.as_str()).collect();
    assert_eq!(
        actions,
        vec!["restore", "", "save", "", "", "restore", ""],
        "the saved chat is restored before the completion is forwarded: {sent:?}"
    );
    assert_eq!(sent[5].filename, tier::file_name(CHAT), "it is the host's chat");
    // And the map names it: the completion's mark has a name to save under.
    assert_eq!(door.residents(), 1, "the recalled chat is the resident");
    door.shutdown();
}

#[test]
fn a_refused_recall_never_fails_the_completion() {
    // The file may be one the engine will not load — another build's, a
    // model's. The recall drops the warmth and the completion goes through
    // cold: the owner asked the chat a question, and the answer must not
    // hinge on a cache file.
    let dir = tier::temp_dir("room-reopen-recallrefused");
    let (door, room, engine, host) = house(&dir);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:older").unwrap();
    assert_eq!(tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)), 204);
    tier::wait_for(&engine, 1);
    tier::complete(door.address(), &host);
    tier::wait_for(&engine, 2);
    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    turn_quiet(&room);
    tier::wait_for(&engine, 5);
    // The recall's restore is refused; the completion after it is served.
    engine.reply([tier::Reply::Refused]);

    tier::complete(door.address(), &host);
    tier::wait_for(&engine, 7);
    let sent = engine.sent();
    let actions: Vec<&str> = sent.iter().map(|ask| ask.action.as_str()).collect();
    assert_eq!(
        actions,
        vec!["restore", "", "save", "", "", "restore", ""],
        "the refused recall left the completion served: {sent:?}"
    );
    // The refusal's meaning is recorded — the slot is empty, not unknown —
    // and the panel says no resident.
    assert_eq!(door.residents(), 0, "a refused recall claims nothing");
    door.shutdown();
}

/// The recall line is the one new line this feature added, and a chat id is
/// the one client value that must never reach it raw: the log promises the
/// id only as the audit hash (audit/line.rs). Read the source the way the
/// cache-salt tripwire reads its own — the wiring, not a captured run.
#[test]
fn the_recall_line_goes_through_the_audit_hash() {
    let proxy = include_str!("../proxy.rs");
    assert!(
        proxy.contains("audit::line::recall_line(lease.slot(), device, &chat)"),
        "the recall must be logged through audit::line::recall_line, which hashes the id"
    );
    // The raw id must never be interpolated beside it: the one format! that
    // names a chat is the audited call above, not a hand-built one.
    let recall_region = proxy
        .split("chats.recall(")
        .nth(1)
        .and_then(|rest| rest.split("let _active").next())
        .unwrap_or("");
    for raw in ["chat {}", "chat {chat}", "{chat}"] {
        assert!(
            !recall_region.contains(&format!("\"chat {raw}")),
            "the recall's log line interpolates the raw chat id: {raw}"
        );
    }
}

#[test]
fn the_handover_save_survives_a_slow_engine_reply() {
    // The engine waking from idle sleep plus a checkpoint save answers past
    // the door's default 10 s patience — the Surface walk's first chat open
    // failed 502 exactly there. The paging tier carries its own patience
    // (60 s): the handover save is slow and still lands.
    let dir = tier::temp_dir("room-reopen-slowsave");
    let (door, room, engine, host) = house(&dir);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:older").unwrap();
    assert_eq!(tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)), 204);
    tier::wait_for(&engine, 1);
    tier::complete(door.address(), &host);
    tier::wait_for(&engine, 2);

    // The handover save is held 11 s — past the old 10 s patience — so the
    // turn's own quiet wait is longer than the helper's.
    engine.delay(Duration::from_millis(11000));
    host_calls(&door, &room, "host-1", "@Kalsa ciao");
    let quiet = Instant::now() + Duration::from_secs(40);
    while room.turn_state().running.is_some() {
        assert!(Instant::now() < quiet, "the room's turn never ended");
        std::thread::sleep(Duration::from_millis(10));
    }

    // The turn finished without the engine-problem note the failed handover
    // publishes, and the seat's chat is on disk (Evicted): the host's next
    // activate RESTORES it instead of claiming it resident.
    assert_eq!(door.residents(), 0, "the chat was evicted to disk");
    // The asks so far: the first restore, the completion, the handover
    // save, then the room's prefill dial — which the fake answers with a
    // plain 200, so the turn retries it once (5 asks in all).
    tier::wait_for(&engine, 5);
    assert_eq!(engine.sent()[2].action, "save", "the handover save ran");

    assert_eq!(tier::status_of(&tier::activate(door.address(), Some(&host), CHAT)), 204);
    tier::wait_for(&engine, 6);
    assert_eq!(engine.sent()[5].action, "restore", "the activate restored the evicted chat");
    door.shutdown();
}

#[test]
fn a_restore_answered_past_the_patience_opens_the_chat_cold_and_others_warm() {
    // The engine asleep, the checkpoint big: the restore answers PAST the
    // paging patience (61 s vs 60 s) — the door saw Unreachable, the engine
    // ran it late. The slot must not lock the owner out: the fallback erases
    // it and opens THIS chat cold, and another chat opens warm afterwards.
    let dir = tier::temp_dir("room-reopen-p12");
    let (door, _room, engine, host) = house(&dir);

    std::fs::write(dir.join(tier::file_name(CHAT)), b"state:9:older").unwrap();
    std::fs::write(dir.join(tier::file_name("bbbbbbbb")), b"state:7:chat-b").unwrap();

    engine.delay(Duration::from_secs(61));
    let answer = tier::post_for(
        door.address(),
        Some(&host),
        "/kalsa/chat/activate",
        &format!("{{\"id\":\"{CHAT}\"}}"),
        Duration::from_secs(70),
    );
    assert_eq!(
        tier::status_of(&answer),
        204,
        "the chat opens cold on the erased slot: {}",
        String::from_utf8_lossy(&answer)
    );
    tier::wait_for(&engine, 2);

    // And another chat opens too, warm: its restore follows the save of A.
    assert_eq!(
        tier::status_of(&tier::activate(door.address(), Some(&host), "bbbbbbbb")),
        204
    );
    tier::wait_for(&engine, 4);
    let sent = engine.sent();
    let actions: Vec<&str> = sent.iter().map(|ask| ask.action.as_str()).collect();
    assert_eq!(
        actions,
        vec!["restore", "erase", "save", "restore"],
        "the sequence: A's timed-out restore, the erase, then B warm: {sent:?}"
    );
    assert_eq!(door.residents(), 1, "B is the resident at the end");
    door.shutdown();
}
