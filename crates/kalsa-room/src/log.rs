//! The transcript file: `room-log.jsonl`, one JSON line per entry, in the
//! order they were accepted — and the recovery that keeps damage from
//! costing the room.
//!
//! An append-log and a published document fail differently, which is why
//! this file does not ride the pairing store's temp-and-rename publication:
//! publishing would rewrite the whole transcript on every message. Here the
//! atomic unit is the line — one `write_all`, `sync_all` before the caller
//! counts it — so a crash leaves either the complete line or a torn
//! fragment, and nothing before it.
//!
//! Damage has two shapes and neither is fatal. A TORN TAIL (an incomplete
//! last line) is cut back to the last complete line; a tail that parses but
//! lost only its newline has the newline rewritten. MIDDLE DAMAGE — a line
//! that does not parse, numbering with a gap or a repeat, a record from a
//! newer format, one idempotency key on two entries — recovers the LONGEST
//! VALID PREFIX: every byte the recovery drops is first copied, byte for
//! byte, to `room-log.damaged-<time>.jsonl` beside the transcript
//! (owner-only, the pairing publication), and the live file is rewritten to
//! the prefix. Nothing is dropped without its copy existing. When even that
//! write fails, the file is left exactly as it was and the room opens
//! READ-ONLY: reads serve the intact prefix, posts are refused, and the
//! next open tries the recovery again.
//!
//! The file and the directory the first creation lands in are owner-only.
//! An existing file wider than `0600` is narrowed at open — the transcript
//! sits beside credentials and is nobody else's to read.

use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::recovery;
use crate::{MemberId, RoomError};

pub(crate) const LOG_NAME: &str = "room-log.jsonl";
/// Version 1 names THIS shape, `kind` included. No transcript written
/// before the field existed is anywhere in the world: the crate has never
/// been wired into the app, so no file predates it — a v1 line without
/// `kind` cannot occur, and the version is not bumped for a reader that
/// will never meet one.
const LINE_VERSION: u8 = 1;
/// The most text one entry may carry, in UTF-8 bytes.
pub(crate) const MAX_TEXT_BYTES: usize = 8000;
/// The most a client message id may be, ASCII graphic characters only, so
/// it survives logs, JSON, and a phone's storage unchanged.
pub(crate) const MAX_CLIENT_MSG_ID: usize = 64;

/// How a line says who wrote it. `member` is a phone or the host; `ai` is
/// the assistant's own finished answer, which takes a seq like any entry
/// but carries no idempotency key — nobody retries an AI turn by id.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum LineKind {
    #[serde(rename = "member")]
    Member,
    #[serde(rename = "ai")]
    Ai,
}

#[derive(Serialize, Deserialize)]
struct Record {
    v: u8,
    kind: LineKind,
    seq: u64,
    client_msg_id: String,
    member: u32,
    text: String,
    time: u64,
    call_ai: bool,
    /// Absent in every line written before the AI guest existed, which no
    /// released build ever wrote; the default is the honest "nothing was
    /// read" for an entry nobody made.
    #[serde(default)]
    read: u32,
}

/// One transcript entry, in memory. Not the public shape: the door never
/// hands a `client_msg_id` to anyone (the protocol's answers and pages do
/// not carry it), so the public [`crate::Entry`] drops it and this keeps it
/// for the store's idempotency work. `Debug` is written by hand because a
/// derived one would print what people wrote.
#[derive(Clone)]
pub(crate) struct Message {
    pub(crate) seq: u64,
    pub(crate) member: MemberId,
    pub(crate) client_msg_id: String,
    pub(crate) text: String,
    pub(crate) time: u64,
    pub(crate) call_ai: bool,
    /// How many messages the AI read for this entry; 0 on members' lines.
    pub(crate) read: u32,
}

impl std::fmt::Debug for Message {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "entry {} by {:?} at {} ({} bytes)",
            self.seq,
            self.member,
            self.time,
            self.text.len()
        )
    }
}

impl Message {
    fn record(&self) -> Record {
        Record {
            v: LINE_VERSION,
            kind: if self.member == MemberId::Ai {
                LineKind::Ai
            } else {
                LineKind::Member
            },
            seq: self.seq,
            client_msg_id: self.client_msg_id.clone(),
            member: self.member.wire(),
            text: self.text.clone(),
            time: self.time,
            call_ai: self.call_ai,
            read: self.read,
        }
    }
}

/// The one client_msg_id rule, shared by the posting path and the loader:
/// whatever the store refuses to write, it also refuses to read back.
pub(crate) fn is_client_msg_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_CLIENT_MSG_ID
        && id.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
}

/// What `open` found on disk: the entries the room may serve, the handle to
/// append with, and whether appending is allowed at all.
/// What this open's recovery dropped, when it dropped anything. A pure
/// TORN TAIL never was a complete line: no client was ever served it, so
/// dropping it costs nothing acknowledged and the epoch stands. MIDDLE
/// damage removed complete lines somebody may have read — the numbering
/// starts a new epoch and the caller re-mints it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Recovery {
    None,
    Tail,
    Middle,
}

pub(super) struct Opened {
    pub(super) messages: Vec<Message>,
    pub(super) file: File,
    pub(super) writable: bool,
    pub(crate) recovery: Recovery,
}

pub(super) fn open(path: &Path) -> Result<Opened, RoomError> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let file = recovery::create(path)?;
            return Ok(Opened {
                messages: Vec::new(),
                file,
                writable: true,
                recovery: Recovery::None,
            });
        }
        Err(error) => return Err(error.into()),
    };
    recovery::tighten(path)?;
    let complete = match bytes.iter().rposition(|byte| *byte == b'\n') {
        Some(last) => last + 1,
        // No newline anywhere: the whole file is a tail, and the tail gets
        // the recovery rules, not the refusal a middle line would earn.
        None => 0,
    };
    let (mut messages, valid) = parse_prefix(&bytes, complete);
    let mut writable = true;
    let mut recovery = Recovery::None;
    if valid < complete {
        writable = recovery::recover(path, &bytes, valid);
        if writable {
            recovery = Recovery::Middle;
        }
    } else if complete < bytes.len() {
        let mut checker = Checker::of(&messages);
        match serde_json::from_slice::<Record>(&bytes[complete..]) {
            // A line that does not PARSE is a torn write: it never was a
            // complete entry, nobody was ever served it, and dropping it
            // costs nothing acknowledged — the one recovery that keeps the
            // epoch.
            Err(_) => {
                writable = recovery::recover(path, &bytes, valid);
                if writable {
                    recovery = Recovery::Tail;
                }
            }
            Ok(record) => match checker.check(record, messages.len() as u64 + 1) {
                Some(message) => {
                    if recovery::repair_newline(path) {
                        messages.push(message);
                    } else {
                        // The fragment stays on disk; the room must not
                        // append after it. Nothing is dropped, so no copy
                        // is owed.
                        writable = false;
                    }
                }
                // A line that parses but breaks a rule — a seq out of
                // order, a key reused — is a complete line this store
                // refuses to have written: it is dropped as middle damage
                // and the epoch moves, because a complete line is
                // something a client may have read.
                None => {
                    writable = recovery::recover(path, &bytes, valid);
                    if writable {
                        recovery = Recovery::Middle;
                    }
                }
            },
        }
    }
    let file = OpenOptions::new().read(true).append(true).open(path)?;
    Ok(Opened {
        messages,
        file,
        writable,
        recovery,
    })
}

/// Appends one entry as a single complete line and makes it stick. The
/// caller holds the room's write lock: one writer per process, the same
/// single-writer assumption every store in this app states.
pub(super) fn append(file: &mut File, message: &Message) -> std::io::Result<()> {
    let mut line =
        serde_json::to_vec(&message.record()).expect("a transcript record always serializes");
    line.push(b'\n');
    file.write_all(&line)?;
    file.sync_all()
}

/// Walks the complete-line region, accepting entries until the first line
/// that fails any rule, and answers the accepted prefix with the byte
/// offset it ends at.
fn parse_prefix(bytes: &[u8], complete: usize) -> (Vec<Message>, usize) {
    let mut messages = Vec::new();
    let mut checker = Checker::of(&[]);
    let mut start = 0;
    while start < complete {
        let end = start + bytes[start..complete]
            .iter()
            .position(|byte| *byte == b'\n')
            .expect("the complete region ends at a newline");
        match serde_json::from_slice::<Record>(&bytes[start..end])
            .ok()
            .and_then(|record| checker.check(record, messages.len() as u64 + 1))
        {
            Some(message) => messages.push(message),
            None => return (messages, start),
        }
        start = end + 1;
    }
    (messages, complete)
}

/// The per-line and cross-line rules a transcript must satisfy to be
/// served: the version, the kind's agreement with its member, the
/// numbering, the shape limits, and one idempotency key per member entry.
struct Checker {
    seen: HashSet<(u32, String)>,
}

impl Checker {
    fn of(messages: &[Message]) -> Self {
        Self {
            seen: messages
                .iter()
                .filter(|message| message.member != MemberId::Ai)
                .map(|message| (message.member.wire(), message.client_msg_id.clone()))
                .collect(),
        }
    }

    fn check(&mut self, record: Record, expected_seq: u64) -> Option<Message> {
        let member = MemberId::from_wire(record.member);
        let kind = if member == MemberId::Ai {
            LineKind::Ai
        } else {
            LineKind::Member
        };
        if record.v != LINE_VERSION
            || kind != record.kind
            || record.seq != expected_seq
            || record.text.is_empty()
            || record.text.len() > MAX_TEXT_BYTES
        {
            return None;
        }
        match record.kind {
            LineKind::Ai => {
                if !record.client_msg_id.is_empty() {
                    return None;
                }
            }
            LineKind::Member => {
                if !is_client_msg_id(&record.client_msg_id)
                    || !self
                        .seen
                        .insert((record.member, record.client_msg_id.clone()))
                {
                    return None;
                }
            }
        }
        Some(Message {
            seq: record.seq,
            member,
            client_msg_id: record.client_msg_id,
            text: record.text,
            time: record.time,
            call_ai: record.call_ai,
            read: record.read,
        })
    }
}
