//! The transcript file: `room-log.jsonl`, one JSON line per entry, in the
//! order they were accepted.
//!
//! An append-log and a published document fail differently, which is why
//! this file does not ride the pairing store's temp-and-rename publication:
//! publishing would rewrite the whole transcript on every message. Here the
//! atomic unit is the line — written in one `write_all`, `sync_all`ed
//! before the caller counts it — so a crash leaves either the complete line
//! or a torn fragment, and nothing before it.
//!
//! A torn fragment is recovered at load: a tail that parses but lost its
//! newline has the newline rewritten; a tail that does not parse is
//! truncated back to the last complete line. Both recoveries happen before
//! the room opens, so an append can never land against a damaged tail.
//! Damage anywhere else — a middle line that will not parse, numbering with
//! a gap or a repeat, a line from a newer format — refuses the room. The
//! numbering check is possible because seqs are minted as `index + 1` and
//! never otherwise; a file that disagrees was not written by this store.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};

use serde::{Deserialize, Serialize};

use crate::MemberId;
use crate::RoomError;

/// The line format this build writes and the only one it reads.
const LINE_VERSION: u8 = 1;

/// One transcript entry as it is stored: the disk's shell for a [`Message`].
#[derive(Clone, Serialize, Deserialize)]
struct Record {
    v: u8,
    seq: u64,
    client_msg_id: String,
    member_id: u32,
    text: String,
    time: u64,
    call_ai: bool,
}

impl Record {
    fn of(message: &Message) -> Self {
        Self {
            v: LINE_VERSION,
            seq: message.seq,
            client_msg_id: message.client_msg_id.clone(),
            member_id: message.member.value(),
            text: message.text.clone(),
            time: message.time,
            call_ai: message.call_ai,
        }
    }

    fn message(&self) -> Message {
        Message {
            seq: self.seq,
            member: MemberId::device(self.member_id),
            client_msg_id: self.client_msg_id.clone(),
            text: self.text.clone(),
            time: self.time,
            call_ai: self.call_ai,
        }
    }
}

/// One transcript entry as the room hands it out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Message {
    pub seq: u64,
    pub member: MemberId,
    pub client_msg_id: String,
    pub text: String,
    pub time: u64,
    pub call_ai: bool,
}

/// Appends one entry as a single complete line and makes it stick. The
/// caller holds the room's lock: this file has one writer per process, the
/// same single-writer assumption every store in this app states.
pub(super) fn append(mut file: &File, message: &Message) -> std::io::Result<()> {
    let mut line = serde_json::to_vec(&Record::of(message))
        .expect("a transcript record always serializes");
    line.push(b'\n');
    file.write_all(&line)?;
    file.sync_all()
}

/// Reads the whole transcript back, recovering a torn last line first. The
/// file handle is the open room's own: append mode writes at the end
/// regardless of the read cursor this function leaves behind.
pub(super) fn load(mut file: &File) -> Result<Vec<Message>, RoomError> {
    let mut bytes = Vec::new();
    let mut reader = file;
    reader.seek(SeekFrom::Start(0))?;
    reader.read_to_end(&mut bytes)?;

    // No newline anywhere means the whole file is the tail: the very first
    // append was torn. There are no complete lines, and the tail gets the
    // recovery, not the refusal.
    let (complete, tail) = match bytes.iter().rposition(|byte| *byte == b'\n') {
        Some(last) => (&bytes[..=last], Some(&bytes[last + 1..])),
        None => (&bytes[..0], (!bytes.is_empty()).then_some(&bytes[..])),
    };
    let mut messages = parse_lines(complete)?;
    let torn_newline = match tail {
        None | Some([]) => false,
        Some(tail) => match serde_json::from_slice::<Record>(tail) {
            Ok(record) => {
                messages.push(record.message());
                true
            }
            Err(_) => {
                truncate(file, complete.len())?;
                false
            }
        },
    };
    for (index, message) in messages.iter().enumerate() {
        if message.seq != index as u64 + 1 {
            return Err(RoomError::Corrupt(
                "transcript numbering has a gap or a repeat",
            ));
        }
    }
    if torn_newline {
        file.write_all(b"\n")?;
        file.sync_all()?;
    }
    Ok(messages)
}

/// Parses complete newline-terminated lines. One bad line in the middle is
/// not a torn tail — it is corruption this store cannot date, and refusing
/// is the only honest answer.
fn parse_lines(complete: &[u8]) -> Result<Vec<Message>, RoomError> {
    complete
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(|line| match serde_json::from_slice::<Record>(line) {
            Ok(record) if record.v == LINE_VERSION => Ok(record.message()),
            Ok(_) => Err(RoomError::Corrupt("transcript line is from a newer format")),
            Err(_) => Err(RoomError::Corrupt("a transcript line does not parse")),
        })
        .collect()
}

/// Cuts a torn tail off so the next append lands on a clean end.
fn truncate(file: &File, keep: usize) -> std::io::Result<()> {
    file.set_len(keep as u64)?;
    file.sync_all()
}
