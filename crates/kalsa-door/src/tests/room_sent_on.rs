//! The day a Room call was sent: it rides after the call's own words, and a
//! later turn replays those bytes. The system prompt names no day.

use super::room_engine::Reply;
use super::room_support::post;
use super::room_turn::{await_answer, room_at};
use crate::room::turn::room_system_prompt;

#[test]
fn a_call_carries_the_day_it_was_sent_after_its_words() {
    let (door, room, fake, [_, one, _]) = room_at(vec![Reply::Sse(vec!["ok".to_string()])]);
    let bearer = format!("Bearer {one}");
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"c1","text":"@Kalsa hello"}"#,
    );
    await_answer(&room);
    let day = room
        .entries_for_ai()
        .into_iter()
        .find_map(|entry| entry.sent_on)
        .expect("the call kept its day");
    let body = fake.seen()[0].body.clone();
    assert!(
        body.contains(&format!("@Kalsa hello\\n\\nSent on {day}.")),
        "the day follows the call's words: {body}"
    );
    door.shutdown();
}

#[test]
fn a_later_turn_replays_the_first_call_byte_for_byte() {
    let (door, room, fake, [_, one, _]) = room_at(vec![
        Reply::Sse(vec!["first".to_string()]),
        Reply::Sse(vec!["second".to_string()]),
    ]);
    let bearer = format!("Bearer {one}");
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"c1","text":"@Kalsa one"}"#,
    );
    await_answer(&room);
    post(
        door.address(),
        Some(&bearer),
        "/kalsa/room/messages",
        r#"{"client_msg_id":"c2","text":"@Kalsa two"}"#,
    );
    assert_eq!(await_answer(&room).text, "second");
    let seen = fake.seen();
    assert_eq!(seen.len(), 2, "one request per turn");
    let first: serde_json::Value = serde_json::from_str(&seen[0].body).expect("a JSON body");
    let second: serde_json::Value = serde_json::from_str(&seen[1].body).expect("a JSON body");
    assert_eq!(
        second["messages"][0], first["messages"][0],
        "the system prompt is the same bytes"
    );
    assert_eq!(
        second["messages"][1], first["messages"][1],
        "the first call goes out as it was first sent"
    );
    door.shutdown();
}

#[test]
fn the_system_prompt_names_no_day_and_no_year() {
    for vision in [true, false] {
        let prompt = room_system_prompt(vision);
        assert!(
            !prompt.chars().any(|c| c.is_ascii_digit()),
            "a date would carry digits: {prompt}"
        );
    }
}
