use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{read, write, Record, FILE_VERSION};
use crate::ceremony::{ClaimResult, Pairing};
use crate::invite::{Invites, INVITE_TTL};

const REACHABLE: &str = "http://127.0.0.1:8134";
const NODE: &str = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

fn scratch(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-pairing-file-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("scratch");
    dir.join("invites.json")
}

fn start() -> SystemTime {
    UNIX_EPOCH + Duration::from_secs(1_770_000_000)
}

/// A square's own JSON, the way the set writes one.
fn square(now: SystemTime) -> String {
    Pairing::offer(REACHABLE, Some(NODE), None, now, INVITE_TTL)
        .expect("the ceremony offers")
        .qr_payload()
        .expect("an offer has a QR")
}

/// The same square without a road behind it — the shape this build never
/// mints, and must never honour either.
fn square_off_road(now: SystemTime, node: Option<&str>) -> String {
    Pairing::offer(REACHABLE, node, None, now, INVITE_TTL)
        .expect("the ceremony offers")
        .qr_payload()
        .expect("an offer has a QR")
}

/// The code the file is holding for one invitation: the same string the
/// link hands a phone, read here from the file itself because this file's
/// subject is what the disk keeps.
fn code_in(path: &Path, index: usize) -> String {
    let on_disk: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(path).expect("the file")).expect("the envelope");
    let payload: serde_json::Value =
        serde_json::from_str(on_disk["invites"][index]["payload"].as_str().expect("a payload"))
            .expect("the square");
    payload["code"].as_str().expect("code").to_string()
}

/// One hand-written record, in the shape the file keeps.
fn record(id: u32, expires_at: SystemTime, payload: &str) -> serde_json::Value {
    let since_epoch = expires_at
        .duration_since(UNIX_EPOCH)
        .expect("a deadline after the epoch");
    serde_json::json!({
        "id": id,
        "expires_at": {
            "secs_since_epoch": since_epoch.as_secs(),
            "nanos_since_epoch": since_epoch.subsec_nanos(),
        },
        "payload": payload,
    })
}

/// A hand-written envelope, in this build's version.
fn envelope(next_id: u32, records: Vec<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({ "v": FILE_VERSION, "next_id": next_id, "invites": records })
}

#[test]
fn no_file_is_an_empty_set() {
    // No links are out. The absence of the file is the answer, the way the
    // credential store's absence means "no phone is paired" — not an error
    // the shell has to tell apart from a broken disk.
    let loaded = read(&scratch("absent"), start());
    assert!(loaded.invites.is_empty());
    assert!(!loaded.discarded, "nothing was there to discard");
}

#[test]
fn the_file_keeps_the_square_byte_for_byte() {
    let now = start();
    let path = scratch("bytes");
    let payload = square(now);
    let expires_at = now + INVITE_TTL;
    write(
        &path,
        1,
        vec![Record {
            id: 0,
            expires_at,
            payload: payload.clone(),
        }],
    )
    .unwrap();

    // The document is on disk verbatim — inside a JSON string, so escaping
    // can move the quotes around it but never the bytes within it.
    let raw = fs::read_to_string(&path).unwrap();
    assert!(
        raw.contains(&serde_json::to_string(&payload).unwrap()),
        "{raw}"
    );

    // And the ceremony it rebuilds carries the same square: re-encoding the
    // restored offer gives back the string the link was built from, field
    // for field, character for character.
    let loaded = read(&path, now + Duration::from_secs(1));
    assert_eq!(loaded.invites.len(), 1);
    assert_eq!(loaded.invites[0].0, 0);
    assert_eq!(loaded.invites[0].1.expires_at(), Some(expires_at));
    assert_eq!(loaded.invites[0].1.qr_payload().unwrap(), payload);
    assert!(!loaded.discarded);
}

#[test]
fn a_record_the_ceremony_cannot_read_is_not_honoured() {
    // A payload that is not a square this build understands — no code, no
    // nonce — would rebuild an invitation that could pair with nobody. The
    // whole file hands back nothing, and nothing in it is deleted.
    let now = start();
    let path = scratch("not-a-square");
    fs::write(&path, serde_json::to_string(&envelope(1, vec![record(0, now + INVITE_TTL, r#"{"v":3}"#)])).unwrap())
        .unwrap();
    let loaded = read(&path, now);
    assert!(loaded.invites.is_empty(), "nothing from it is honoured");
    assert!(loaded.discarded);
    assert!(path.exists(), "a failed read never destroys the file");
}

#[test]
fn a_version_this_build_does_not_read_is_parked_not_rewritten() {
    // Another build's file — its own version, its own invitations — is the
    // one file this reader must not replace: the set still starts empty and
    // writes its own file at that same path, so the other build's data has
    // to be somewhere else first. Parking it beside its own name is that
    // somewhere: byte for byte, and out of the way. Nothing in it is
    // honoured either — the version is refused exactly as before.
    let now = start();
    let path = scratch("park");
    let mut value = envelope(1, vec![record(0, now + INVITE_TTL, &square(now))]);
    value["v"] = serde_json::json!(FILE_VERSION + 1);
    let written = serde_json::to_string(&value).unwrap();
    fs::write(&path, &written).unwrap();

    let (invites, discarded) = Invites::open(&path, now);
    assert!(discarded, "the page is told that nothing came back");
    assert!(invites.list().is_empty(), "and nothing from it is honoured");

    let parked = path.with_file_name(format!("invites.json.v{}.parked", FILE_VERSION + 1));
    assert_eq!(
        fs::read_to_string(&parked).expect("the other build's file is parked"),
        written,
        "kept byte for byte — parked, not consumed"
    );
    // The path itself holds this build's file now, so even the write that
    // follows the park could not reach the other build's bytes by accident.
    let on_disk = fs::read_to_string(&path).expect("this build's own file");
    assert_ne!(on_disk, written);
    assert!(on_disk.contains(&format!("\"v\":{FILE_VERSION}")), "{on_disk}");
}

#[test]
fn a_deadline_this_build_could_not_have_written_is_dropped() {
    // The window is a day: a record whose deadline sits further out than an
    // invite could have been minted with is not a deadline this build wrote,
    // and honouring it would be handing the file a longer window than the
    // owner ever granted. It is dropped on its own — the record beside it
    // still comes back — and the file says so.
    let now = start();
    let path = scratch("overlong");
    write(
        &path,
        3,
        vec![
            Record {
                id: 0,
                expires_at: now + Duration::from_secs(48 * 60 * 60),
                payload: square(now),
            },
            Record {
                id: 1,
                expires_at: now + INVITE_TTL,
                payload: square(now),
            },
        ],
    )
    .unwrap();

    let loaded = read(&path, now);
    assert_eq!(loaded.invites.len(), 1, "only the honest deadline came back");
    assert_eq!(loaded.invites[0].0, 1);
    assert!(loaded.discarded, "the other record was not honoured");
    assert!(path.exists());
}

#[test]
fn a_square_without_a_usable_node_is_dropped() {
    // This build mints no invite without an iroh node to dial, so a record
    // carrying neither an id nor an empty one is not one it wrote: the
    // phone would get a code and no road. Both shapes are dropped
    // individually, and the record with a node is untouched.
    let now = start();
    let path = scratch("no-node");
    write(
        &path,
        4,
        vec![
            Record {
                id: 0,
                expires_at: now + INVITE_TTL,
                payload: square_off_road(now, None),
            },
            Record {
                id: 1,
                expires_at: now + INVITE_TTL,
                payload: square_off_road(now, Some("")),
            },
            Record {
                id: 2,
                expires_at: now + INVITE_TTL,
                payload: square(now),
            },
        ],
    )
    .unwrap();

    let loaded = read(&path, now);
    assert_eq!(loaded.invites.len(), 1, "only the square with a road came back");
    assert_eq!(loaded.invites[0].0, 2);
    assert!(loaded.discarded);
    assert!(path.exists());
}

#[test]
fn an_invitation_whose_window_closed_is_dropped_on_read() {
    let now = start();
    let path = scratch("expired");
    write(
        &path,
        1,
        vec![Record {
            id: 3,
            expires_at: now + INVITE_TTL,
            payload: square(now),
        }],
    )
    .unwrap();

    let one_second_left = read(&path, now + INVITE_TTL - Duration::from_secs(1));
    assert_eq!(one_second_left.invites.len(), 1);
    assert!(!one_second_left.discarded, "the day ending is not a discard");

    // The deadline itself: the day is up and the record is not read back.
    // The file is left as it was — a read publishes nothing.
    let over = read(&path, now + INVITE_TTL);
    assert!(over.invites.is_empty());
    assert!(!over.discarded);
    assert!(path.exists());
}

#[test]
fn a_clock_that_stepped_back_keeps_the_invitation_live() {
    // NTP after a resume steps the clock backwards — tens of seconds, once
    // in a while. A record minted at T and read at T - 10 min then carries a
    // deadline further out than the window from here, but it is still a
    // deadline this build wrote: the invitation comes back, and its link
    // still opens. (Beyond the hour the file allows, it is dropped.)
    let minted_at = start();
    let path = scratch("clock-back");
    let (mut invites, _) = Invites::open(&path, minted_at);
    invites.mint(REACHABLE, Some(NODE), None, minted_at).unwrap();
    let code = code_in(&path, 0);

    let stepped_back = minted_at - Duration::from_secs(10 * 60);
    let (mut reopened, discarded) = Invites::open(&path, stepped_back);
    assert!(!discarded, "an ordinary clock step is not a discard");
    assert_eq!(reopened.list().len(), 1, "the invitation is still live");
    assert!(
        matches!(
            reopened.claim(&code, stepped_back + Duration::from_secs(1)),
            Ok(ClaimResult::Claimed)
        ),
        "and its code still opens it"
    );
}

#[test]
fn an_unreadable_file_is_an_empty_set_not_a_dead_end() {
    // The feature survives its own file: nothing in it is honoured, the
    // owner is told something was discarded, and the very next write
    // replaces the file — after which the same file reads clean.
    let now = start();
    let path = scratch("dead-end");
    fs::write(&path, b"this is not an invite file").unwrap();

    let (mut invites, discarded) = Invites::open(&path, now);
    assert!(discarded, "the owner may need to know earlier links are gone");
    assert!(invites.list().is_empty());

    assert!(
        invites.mint(REACHABLE, Some(NODE), None, now).is_ok(),
        "one bad file must not stop the next invitation"
    );
    let (reopened, discarded) = Invites::open(&path, now);
    assert!(!discarded, "the file the write left is a file this build reads");
    assert_eq!(reopened.list().len(), 1);
}

#[test]
fn open_replaces_a_file_it_could_not_honour() {
    // A file with a real code in it that this build will not read: the
    // refusal is only half a refusal while those bytes sit on disk, so
    // `open` replaces the file with the empty set it read — through the
    // same atomic publish path as any other write.
    let now = start();
    let path = scratch("discard-replace");
    let payload = square(now);
    let value: serde_json::Value = serde_json::from_str(&payload).expect("the square");
    let code = value["code"].as_str().expect("code").to_string();
    let mut envelope = envelope(1, vec![record(0, now + INVITE_TTL, &payload)]);
    envelope["v"] = serde_json::json!(FILE_VERSION + 1);
    let written = serde_json::to_string(&envelope).unwrap();
    assert!(written.contains(&code), "the fixture carries the code");
    fs::write(&path, &written).unwrap();

    let (set, discarded) = Invites::open(&path, now);
    assert!(discarded, "the file was not honoured");
    assert!(set.list().is_empty());

    let on_disk = fs::read_to_string(&path).unwrap();
    assert!(
        !on_disk.contains(&code),
        "the un-honoured code must be off disk: {on_disk}"
    );
    let (_, discarded) = Invites::open(&path, now);
    assert!(!discarded, "and what is on disk is a file this build reads");
}

#[test]
fn a_replace_that_cannot_happen_does_not_fail_open() {
    // The target refuses to be replaced — it is a directory here — so the
    // rewrite inside `open` fails. `open` still answers: the empty set it
    // read and the fact that something was discarded, never an error the
    // shell could not get past.
    let now = start();
    let path = scratch("replace-fails");
    fs::create_dir_all(&path).unwrap();

    let (set, discarded) = Invites::open(&path, now);
    assert!(discarded, "the directory is not a file this build reads");
    assert!(set.list().is_empty());
    assert!(path.is_dir(), "and nothing replaced it");
}

#[test]
fn an_id_is_spent_for_as_long_as_the_file_lives() {
    // A stale row must never come to name a different, live invitation, so
    // an id is not recycled when the record holding it goes: the counter
    // rides the file, in this process and across a restart alike.
    let now = start();
    let path = scratch("counter");
    let (mut invites, _) = Invites::open(&path, now);
    let first = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    invites.cancel(first).unwrap();
    let second = invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    assert_ne!(second, first, "a cancelled id is spent, not free");
    assert!(
        invites.link(first).is_none(),
        "the old row's link must find nothing, not a new invitation"
    );

    // With every record gone the file holds nothing but its counter — and
    // the counter is what the next id comes from, never a fresh zero.
    invites.cancel(second).unwrap();
    drop(invites);
    let (mut reopened, _) = Invites::open(&path, now);
    assert!(reopened.list().is_empty());
    assert_eq!(
        reopened.mint(REACHABLE, Some(NODE), None, now).unwrap(),
        second + 1,
        "the file's own counter, not a fresh zero"
    );
}

#[test]
fn an_unclaimed_invitation_survives_a_restart() {
    let now = start();
    let path = scratch("restart");
    {
        let (mut invites, _) = Invites::open(&path, now);
        invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    }
    let code = code_in(&path, 0);

    // The set is gone; only the file is left, which is what a restart means.
    let (mut reopened, _) = Invites::open(&path, now + Duration::from_secs(60));
    assert_eq!(reopened.list().len(), 1);
    assert_eq!(
        reopened.list()[0].1,
        now + INVITE_TTL,
        "the deadline came back too"
    );
    // Still claimable — with the code the file kept, so the ceremony was
    // rebuilt and not re-minted.
    assert!(matches!(
        reopened.claim(&code, now + Duration::from_secs(61)),
        Ok(ClaimResult::Claimed)
    ));
}

#[test]
fn a_claimed_invitation_is_gone_before_anything_restarts() {
    let now = start();
    let path = scratch("claimed-gone");
    let (mut invites, _) = Invites::open(&path, now);
    invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let code = code_in(&path, 0);

    assert!(matches!(
        invites.claim(&code, now + Duration::from_secs(1)),
        Ok(ClaimResult::Claimed)
    ));
    // The claim wrote the file BEFORE it answered, so the next start has
    // never heard of this code: a restart cannot hand a used link to a
    // second phone.
    let (mut reopened, _) = Invites::open(&path, now + Duration::from_secs(2));
    assert!(reopened.list().is_empty());
    // The code the phone already used is refused, not resurrected: nothing
    // in the file remembers it, and nothing re-mints it.
    assert!(matches!(
        reopened.claim(&code, now + Duration::from_secs(3)),
        Ok(ClaimResult::Rejected)
    ));
}

#[test]
fn an_expired_invitation_is_not_read_back() {
    let now = start();
    let path = scratch("expired-gone");
    let (mut invites, _) = Invites::open(&path, now);
    invites.mint(REACHABLE, Some(NODE), None, now).unwrap();

    let (reopened, _) = Invites::open(&path, now + INVITE_TTL);
    assert!(reopened.list().is_empty(), "the day was up");
}

#[cfg(unix)]
#[test]
fn the_invite_file_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;

    let now = start();
    let path = scratch("mode");
    write(
        &path,
        1,
        vec![Record {
            id: 0,
            expires_at: now + INVITE_TTL,
            payload: square(now),
        }],
    )
    .unwrap();

    // The same road as `pairing.json`: the codes behind links the owner has
    // already handed out are nobody else's to read.
    let mode = fs::metadata(&path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn a_park_that_fails_is_tried_again_and_never_overwrites() {
    // Every name the park could move the file to is taken, so the file
    // cannot be moved: a file this build cannot honour then stays exactly
    // where it is — two writes in a row, both refused, both leaving the
    // original bytes standing.
    let now = start();
    let path = scratch("park-blocked");
    let dir = path.parent().expect("a scratch file has a directory").to_path_buf();
    let mut value = envelope(1, vec![record(0, now + INVITE_TTL, &square(now))]);
    value["v"] = serde_json::json!(FILE_VERSION + 1);
    let original = serde_json::to_string(&value).unwrap();
    fs::write(&path, &original).unwrap();

    let parked = format!("invites.json.v{}.parked", FILE_VERSION + 1);
    fs::create_dir(dir.join(&parked)).unwrap();
    for counter in 1..super::PARK_ATTEMPTS {
        fs::create_dir(dir.join(format!("{parked}.{counter}"))).unwrap();
    }

    let (mut invites, discarded) = Invites::open(&path, now);
    assert!(discarded, "the page is told");
    assert!(
        invites.list().is_empty(),
        "nothing from a file that could not be honoured"
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        original,
        "the failed park leaves the file where it was"
    );

    // And that failure did not disarm the guard: the next write tries to
    // park again, fails again, and leaves the original standing too.
    assert!(
        invites.mint(REACHABLE, Some(NODE), None, now).is_err(),
        "nothing may be written through a file that could not be moved"
    );
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        original,
        "the second write fails the same way"
    );
}
