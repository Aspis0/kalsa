use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::{read, write, Record};
use crate::ceremony::{ClaimResult, Pairing};
use crate::error::InviteError;
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

#[test]
fn no_file_is_an_empty_set() {
    // No links are out. The absence of the file is the answer, the way the
    // credential store's absence means "no phone is paired" — not an error
    // the shell has to tell apart from a broken disk.
    assert!(read(&scratch("absent"), start()).unwrap().is_empty());
}

#[test]
fn the_file_keeps_the_square_byte_for_byte() {
    let now = start();
    let path = scratch("bytes");
    let payload = square(now);
    let expires_at = now + INVITE_TTL;
    write(
        &path,
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
    let restored = read(&path, now + Duration::from_secs(1)).unwrap();
    assert_eq!(restored.len(), 1);
    assert_eq!(restored[0].0, 0);
    assert_eq!(restored[0].1.expires_at(), Some(expires_at));
    assert_eq!(restored[0].1.qr_payload().unwrap(), payload);
}

#[test]
fn a_record_the_ceremony_cannot_read_refuses_the_file() {
    // A payload that is not a square this build understands — no code, no
    // nonce — would rebuild an invitation that could pair with nobody. The
    // whole file is refused, and nothing in it is deleted.
    let now = start();
    let path = scratch("not-a-square");
    fs::write(&path, serde_json::to_string(&envelope(now, r#"{"v":3}"#)).unwrap()).unwrap();
    assert!(matches!(read(&path, now), Err(InviteError::Corrupt(_))));
    assert!(path.exists(), "a failed read never destroys the file");
}

#[test]
fn an_envelope_of_another_version_is_refused() {
    // A version this build does not read is not a file it may half
    // understand: the records of a future format must not be taken for
    // today's.
    let now = start();
    let path = scratch("version");
    let mut value = envelope(now, &square(now));
    value["v"] = serde_json::json!(2);
    fs::write(&path, serde_json::to_string(&value).unwrap()).unwrap();
    assert!(matches!(read(&path, now), Err(InviteError::Corrupt(_))));
}

#[test]
fn an_invitation_whose_window_closed_is_dropped_on_read() {
    let now = start();
    let path = scratch("expired");
    write(
        &path,
        vec![Record {
            id: 3,
            expires_at: now + INVITE_TTL,
            payload: square(now),
        }],
    )
    .unwrap();

    assert_eq!(
        read(&path, now + INVITE_TTL - Duration::from_secs(1))
            .unwrap()
            .len(),
        1
    );
    // The deadline itself: the day is up and the record is not read back.
    // The file is left as it was — a read publishes nothing.
    assert!(read(&path, now + INVITE_TTL).unwrap().is_empty());
    assert!(path.exists());
}

#[test]
fn an_unclaimed_invitation_survives_a_restart() {
    let now = start();
    let path = scratch("restart");
    {
        let mut invites = Invites::open(&path, now).unwrap();
        invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    }
    let code = code_in(&path, 0);

    // The set is gone; only the file is left, which is what a restart means.
    let mut reopened = Invites::open(&path, now + Duration::from_secs(60)).unwrap();
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
    let mut invites = Invites::open(&path, now).unwrap();
    invites.mint(REACHABLE, Some(NODE), None, now).unwrap();
    let code = code_in(&path, 0);

    assert!(matches!(
        invites.claim(&code, now + Duration::from_secs(1)),
        Ok(ClaimResult::Claimed)
    ));
    // The claim wrote the file BEFORE it answered, so the next start has
    // never heard of this code: a restart cannot hand a used link to a
    // second phone.
    let mut reopened = Invites::open(&path, now + Duration::from_secs(2)).unwrap();
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
    let mut invites = Invites::open(&path, now).unwrap();
    invites.mint(REACHABLE, Some(NODE), None, now).unwrap();

    let reopened = Invites::open(&path, now + INVITE_TTL).unwrap();
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

/// The envelope a hand-written test file wears, with one record in it.
fn envelope(now: SystemTime, payload: &str) -> serde_json::Value {
    let expires_at = (now + INVITE_TTL)
        .duration_since(UNIX_EPOCH)
        .expect("a deadline after the epoch");
    serde_json::json!({
        "v": 1,
        "invites": [{
            "id": 0,
            "expires_at": {
                "secs_since_epoch": expires_at.as_secs(),
                "nanos_since_epoch": expires_at.subsec_nanos(),
            },
            "payload": payload,
        }],
    })
}
