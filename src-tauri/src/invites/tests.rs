use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use kalsa_pairing::InviteError;

use super::{words, InviteSet};
use kalsa_pairing::OfferError;

const REACHABLE: &str = "http://127.0.0.1:8134";
const NODE: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-brain-invites-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch");
    dir
}

/// A start off the real clock, so a deadline lands where the test says.
fn start() -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_770_000_000)
}

/// The code inside a link, read the way a phone reads it. This is the test's
/// own road: the page never sees a code, which is the point of every
/// assertion that uses it.
fn code_from(link: &str) -> String {
    let encoded = link
        .strip_prefix("https://kalsa.io/pair#")
        .expect("the link wears its origin");
    let json =
        String::from_utf8(URL_SAFE_NO_PAD.decode(encoded).expect("base64url")).expect("json");
    let value: serde_json::Value = serde_json::from_str(&json).expect("the square");
    value["code"].as_str().expect("code").to_string()
}

#[test]
fn a_file_the_app_could_not_honour_is_reported_and_replaced_once() {
    // A file from before this build — or one nobody can read — holds codes
    // no ceremony will answer. Startup says so (the page's own words later)
    // and puts its own empty file in the place, here, before the transport
    // serves; the codes are not left on disk waiting for an owner to mint.
    let dir = scratch("discarded");
    let pairing_file = dir.join("pairing.json");
    let invites_file = dir.join("invites.json");
    fs::write(
        &invites_file,
        r#"{"v":1,"invites":[{"id":0,"expires_at":1,"payload":"{\"v\":3,\"code\":\"deadbeefdeadbeefdeadbeefdeadbeef\"}"}]}"#,
    )
    .unwrap();

    let set = InviteSet::open(&pairing_file);
    assert!(set.list(start()).discarded, "the page must be able to say so");
    assert!(set.list(start()).invites.is_empty(), "nothing from it is honoured");
    let on_disk = fs::read_to_string(&invites_file).unwrap();
    assert!(!on_disk.contains("deadbeef"), "the codes are off disk: {on_disk}");

    // The rewrite is this one call's and it happened: a SECOND open finds a
    // file this app reads and has nothing to discard — which is why the
    // first one is the only writer.
    assert!(
        !InviteSet::open(&pairing_file).list(start()).discarded,
        "the file startup left behind is a file this app reads"
    );
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_page_is_handed_ids_and_deadlines_and_nothing_that_is_secret() {
    let dir = scratch("list");
    let set = InviteSet::open(&dir.join("pairing.json"));
    let link = set
        .create(REACHABLE, Some(NODE), None, start())
        .unwrap()
        .expect("a minted invitation has a link");
    set.create(REACHABLE, Some(NODE), None, start())
        .unwrap()
        .expect("a second invitation has a link");
    let code = code_from(&link);

    let listed = set.list(start());
    assert!(!listed.discarded);
    assert_eq!(listed.invites.len(), 2);
    assert!(
        listed.invites.iter().all(|row| row.expires_at > 1_770_000_000),
        "whole seconds after the epoch, one day out"
    );

    // What the page receives, as JSON: ids and deadlines, and nothing that
    // could become a link or open a door.
    let wire = serde_json::to_string(&listed).unwrap();
    assert!(!wire.contains("kalsa.io"), "{wire}");
    assert!(!wire.contains(&code), "{wire}");

    // And the one Debug the holder has — which is what `pairing::Desk`
    // would carry if it were ever rendered — holds no link and no code
    // either. (`pairing::Desk` and `Brain` have no Debug at all: a derived
    // one would not compile, `State` having none.)
    let debug = format!("{:?}", set);
    assert!(!debug.contains("kalsa.io"), "{debug}");
    assert!(!debug.contains(&code), "{debug}");
    assert!(debug.contains("discarded"), "and it still says what it can");
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn cancelling_takes_the_link_the_page_held_and_the_code_behind_it() {
    let dir = scratch("cancel");
    let set = InviteSet::open(&dir.join("pairing.json"));
    let link = set
        .create(REACHABLE, Some(NODE), None, start())
        .unwrap()
        .expect("a minted invitation has a link");
    let code = code_from(&link);
    let id = set.list(start()).invites[0].id;

    set.cancel(id).unwrap();
    assert!(set.list(start()).invites.is_empty());
    assert!(
        set.link(id, start()).is_none(),
        "the page cannot copy a link that is gone"
    );
    assert!(
        !set.claim(&code, start() + Duration::from_secs(1)),
        "and the code behind it is dead"
    );
    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn every_refusal_the_page_can_be_told_carries_no_secret() {
    // A sentence shown to a person is a place a code could leak, so every
    // variant the match can produce is rendered here — against a real code
    // from a real invitation, and against the shape of a code whether or
    // not it is this one's.
    let dir = scratch("words");
    let set = InviteSet::open(&dir.join("pairing.json"));
    let link = set
        .create(REACHABLE, Some(NODE), None, start())
        .unwrap()
        .expect("a minted invitation has a link");
    let code = code_from(&link);

    let refusals = [
        InviteError::Offer(OfferError::Entropy),
        InviteError::Offer(OfferError::Deadline),
        InviteError::NoNode,
        InviteError::Full,
        InviteError::Io(std::io::Error::other("permission denied (os error 13)")),
    ];
    for error in refusals {
        let text = words(error);
        assert!(!text.contains(&code), "a live code in the page's words: {text}");
        assert!(!text.contains("kalsa.io"), "{text}");
        // The shape, not just the instance: a one-time code is 32 hex
        // characters, and no refusal of this app's has a reason to carry
        // anything shaped like one.
        let longest_hex = text
            .split(|character: char| !character.is_ascii_hexdigit())
            .map(str::len)
            .max()
            .unwrap_or(0);
        assert!(longest_hex < 32, "a code-shaped run in the page's words: {text}");
    }
    fs::remove_dir_all(&dir).unwrap();
}


#[test]
fn the_page_is_never_handed_an_invitation_whose_day_ended() {
    // The desk's poll sweeps too, but these two calls answer the page NOW:
    // neither may hand back an invitation whose window has closed, whatever
    // clock the last poll saw.
    let dir = scratch("sweep");
    let set = InviteSet::open(&dir.join("pairing.json"));
    set.create(REACHABLE, Some(NODE), None, start())
        .unwrap()
        .expect("a minted invitation has a link");
    let id = set.list(start()).invites[0].id;
    assert_eq!(set.list(start()).invites.len(), 1, "alive inside the window");
    assert!(set.link(id, start()).is_some());

    let later = start() + Duration::from_secs(24 * 60 * 60 + 1);
    assert!(
        set.list(later).invites.is_empty(),
        "an invitation whose day ended is never listed"
    );
    assert!(
        set.link(id, later).is_none(),
        "and its link is never handed out"
    );
    fs::remove_dir_all(&dir).unwrap();
}
