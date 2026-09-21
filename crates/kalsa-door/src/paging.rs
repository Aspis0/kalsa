//! The door's disk tier: `POST /kalsa/chat/activate` and `/kalsa/chat/erase`.
//!
//! A device holds one slot, so its chats are recalled one at a time:
//! activating a chat saves the one that is in the slot and restores the target
//! into it. The door does it itself, on the port it was constructed with,
//! because the engine's own `/slots` routes are refused to every client
//! ([`crate::slot_routes`]) — a client sends an id and nothing else, and the
//! device is the one its bearer authenticated.
//!
//! Three things are the door's alone. The **name**, in which every component
//! is the door's or validated by shape, so no client byte reaches the
//! filesystem. The **exclusivity**: the engine orders the actions of one slot
//! but not a sequence, so two overlapping switches of one device's chats
//! invert (save A, save B, restore B, restore A ends with A in the slot), and
//! one lock per slot is held across the whole sequence, `erase` included. And
//! the **closure of a failure**: a refused *restore* means the engine emptied
//! the slot on its own error path (`server-context.cpp:2885-2889`), so the
//! chat that was open is put back before the door answers. Only the restore
//! empties: the save's catch (`:2812-2819`) sends the error and leaves the
//! slot alone, which is why a refused save keeps `Resident(previous)` and the
//! switch is refused with it. An engine that never answered may not have run
//! anything, and the slot is then `Unknown`, never called empty.
//!
//! The map is what the door last did, and the staging file [`io`] writes
//! keeps a stale map from destroying a file that is still good.
//!
//! This module owns *which chat* a slot holds. The *when* of writing one out on
//! a timer — where the switch never runs — is [`cadence`].

mod cadence;
mod invalidate;
mod io;

use std::fs;
use std::io::Read;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use self::io::{erase_slot, restore, save, ChatError, STAGING};
use crate::cors;
use crate::devices::DeviceId;
use crate::engine::Engine;
use crate::payload;
use crate::proxy;
use crate::request::UnsealedHead;
use crate::DeviceSet;

/// The namespace the door owns. Nothing under it is ever forwarded, so a
/// spelling the door does not route cannot become an upstream request.
const PREFIX: &[u8] = b"/kalsa/";
const ACTIVATE: &[u8] = b"/kalsa/chat/activate";
const ERASE: &[u8] = b"/kalsa/chat/erase";

/// The largest body the door reads for its own route: one id.
const MAX_PAYLOAD: usize = 4 * 1024;

/// One sentence per failure, and no more: this is all a client sees.
const MALFORMED: &str = "The door reads a chat id from a json body of the shape {\"id\":\"...\"}.";
const BAD_ID: &str = "A chat id is 8 to 64 lowercase letters, digits and dashes.";
const UNKNOWN: &str = "The door serves /kalsa/chat/activate and /kalsa/chat/erase.";
const NO_MODEL: &str = "This door has no model identity pinned, so it cannot name a saved chat.";
const NO_DIR: &str = "This door has no save directory, so it cannot keep a chat on disk.";

/// The door's disk tier, one per running door. `capacity` is the engine's slot
/// count, exactly as the device map uses it.
pub(crate) struct Chats {
    slots: Vec<Mutex<Slot>>,
    /// The first eight hex characters of the model's pinned sha256, from the
    /// app: `kalsa-catalog` is a dev-dependency, so at runtime the door has no
    /// catalog to read it from. `None` until the app pins one.
    model: Option<String>,
    /// The engine's `--slot-save-path`. `None` until the app names one.
    dir: Option<PathBuf>,
    /// How quiet a dirty slot has to be before it is written out, derived by
    /// the app from the unload clock it launched this engine with
    /// (`kalsa_launch::idle_save_seconds`). `None` until the app names one:
    /// the tier without its clock, which saves on a switch and never on a
    /// timer.
    idle_save: Option<Duration>,
}

struct Slot {
    /// The chat the door last put in this slot, and the device it belongs to,
    /// because the name carries the device and a slot is handed on when its
    /// owner is revoked (`slots.rs`): saving a record that is not the caller's
    /// would move one device's state into another device's chat.
    resident: Residency,
    /// The moment the last completion passed through this slot, `None` when its
    /// state is on disk: one field for both, because "dirty with no instant"
    /// has no meaning. Every path that renames or empties the slot clears it.
    dirty_at: Option<Instant>,
    /// When a save that failed may be tried again, `None` when nothing is owed.
    /// The flag above stays set across a failure — the state is still not on
    /// disk — and this is what keeps the next tick from asking again at once.
    retry_after: Option<Instant>,
}

/// A slot is empty, resident with one chat, or unknown: an action that never
/// reached the engine may not have run, so the slot holds what it held, and
/// nothing is written out of it. [`io::restore`] records the two branches of a
/// save and what each can leave behind, which is as far as the unknown's safety
/// reaches. A slot is born unknown as well: a door built against an engine
/// already holding state cannot call a slot it never saw `Empty`.
enum Residency {
    Empty,
    Unknown,
    Resident(DeviceId, String),
}

pub(crate) enum Route {
    Activate,
    Erase,
}

/// Whether the target is inside the namespace the door serves itself. The
/// whole prefix, not only the two routes: a spelling the door does not route
/// must be answered by the door, never forwarded to an engine that might route
/// it some other way.
pub(crate) fn owns(target: &[u8]) -> bool {
    target.starts_with(PREFIX)
}

pub(crate) fn route(target: &[u8]) -> Option<Route> {
    if target == ACTIVATE {
        Some(Route::Activate)
    } else if target == ERASE {
        Some(Route::Erase)
    } else {
        None
    }
}

impl Chats {
    pub(crate) fn new(
        capacity: u32,
        model: Option<String>,
        dir: Option<PathBuf>,
        idle_save: Option<Duration>,
    ) -> Self {
        let slots = (0..capacity)
            .map(|_| Mutex::new(Slot { resident: Residency::Unknown, dirty_at: None, retry_after: None }))
            .collect();
        Self { slots, model, dir, idle_save }
    }

    /// Serves one of the door's two routes and returns the bytes to write
    /// back. The body is read or drained on every path: an unread body in the
    /// receive buffer makes the kernel reset the socket on close, and a reset
    /// erases the answer the client had not read yet.
    pub(crate) fn serve(
        &self,
        client: &mut TcpStream,
        head: &UnsealedHead,
        device: DeviceId,
        salt: [u8; 32],
        slot: u32,
        upstream_port: u16,
        deadline: Instant,
    ) -> Vec<u8> {
        let origin = head.origin.as_deref();
        let route = match route(&head.target) {
            Some(route) if head.method == b"POST" => route,
            _ => {
                let _ = proxy::discard_request_body(client, head.body_length, deadline);
                return answer(404, origin, UNKNOWN);
            }
        };
        let Ok(body) = read_payload(client, head.body_length, deadline) else {
            return answer(400, origin, MALFORMED);
        };
        let Some(id) = payload::id(&body) else {
            return answer(400, origin, MALFORMED);
        };
        if !valid_id(&id) {
            return answer(400, origin, BAD_ID);
        }
        let (model, dir) = match (self.model.as_deref(), self.dir.as_deref()) {
            (Some(model), Some(dir)) => (model, dir),
            (None, _) => return answer(501, origin, NO_MODEL),
            (Some(_), None) => return answer(501, origin, NO_DIR),
        };
        let engine = Engine {
            port: upstream_port,
            slot,
            salt: &salt,
            deadline,
        };
        let result = match route {
            Route::Activate => self.activate(model, dir, device, &engine, &id),
            Route::Erase => self.erase(model, dir, device, &engine, &id),
        };
        match result {
            Ok(()) => no_content(origin),
            Err(error) => error.answer(origin),
        }
    }

    /// Saves the chat in the slot, then restores the one asked for. The lock
    /// is held across both: the pair is the unit, and the engine's own
    /// ordering is per action.
    ///
    /// The branch with no file for the target is the exception, and it is not
    /// a restore: the slot is *erased* and the residency records the new chat.
    /// A chat with no file is one the engine has not held on this device, so
    /// there is nothing to bring back; the conversation itself lives in the
    /// app's store, which is why answering 204 is true and not a lost chat.
    /// The erase is required, not incidental: what is in the slot is another
    /// chat's state, and leaving it there would let the next save write it
    /// into this chat's file.
    fn activate(
        &self,
        model: &str,
        dir: &Path,
        device: DeviceId,
        engine: &Engine<'_>,
        id: &str,
    ) -> Result<(), ChatError> {
        let mut state = self.lock(engine.slot)?;
        if matches!(&state.resident, Residency::Resident(owner, _) if *owner != device) {
            state.resident = Residency::Empty;
            state.dirty_at = None;
        }
        // The chat asked for is the one this device already has in the slot, so
        // the sequence would be its own state written out and read back into
        // the slot it never left. The client asks on every mount, and a mount
        // is not a reason to move hundreds of MB: nothing is sent, and the
        // residency already says what the slot holds.
        if matches!(&state.resident, Residency::Resident(owner, chat) if *owner == device && chat == id) {
            return Ok(());
        }
        let target = file_name(model, device, id);
        // `Unknown` is the one residency with no previous chat to save: what is
        // in the slot cannot be named, so nothing is written out of it.
        let previous = match &state.resident {
            Residency::Resident(_, chat) => Some(chat.clone()),
            _ => None,
        };
        if let Some(previous) = previous.as_deref() {
            // A save the engine refused leaves the slot as it was, so the
            // switch is refused with it: restoring over that slot would lose
            // the only copy of the chat that is open.
            save(dir, &file_name(model, device, previous), engine, &|| true)?;
        }
        if !dir.join(&target).exists() {
            // The one branch that is not a restore; the doc above says why it
            // is safe. The erase is what keeps the next save, which writes
            // whatever the slot holds, out of this chat's file.
            erase_slot(engine)?;
            state.resident = Residency::Resident(device, id.to_string());
            state.dirty_at = None;
            return Ok(());
        }
        if let Err(error) = restore(&mut state, engine, &target) {
            // An unanswered restore is not repaired: the engine may never have
            // run it, so nothing is known to be missing, and the chat that was
            // open is already saved and renamed on disk by the save above. The
            // residency `restore` recorded is `Unknown`, and the sentence says
            // so rather than calling the slot empty.
            if matches!(error, ChatError::Unknown) {
                return Err(error);
            }
            // A refusal did run, and the engine's catch cleared the slot: the
            // chat that was open lives nowhere until this puts it back, and the
            // caller must not be told the switch failed while the slot holds
            // nothing, nor told that it succeeded.
            let Some(previous) = previous.as_deref() else {
                return Err(error);
            };
            if let Err(repair) = restore(&mut state, engine, &file_name(model, device, previous)) {
                return Err(repair);
            }
            state.resident = Residency::Resident(device, previous.to_string());
            state.dirty_at = None;
            return Err(ChatError::Restore);
        }
        state.resident = Residency::Resident(device, id.to_string());
        state.dirty_at = None;
        Ok(())
    }

    /// Removes one chat. A chat the slot holds is erased from the engine as
    /// well: a later switch would save that state under another chat's name.
    fn erase(
        &self,
        model: &str,
        dir: &Path,
        device: DeviceId,
        engine: &Engine<'_>,
        id: &str,
    ) -> Result<(), ChatError> {
        let mut state = self.lock(engine.slot)?;
        let resident = matches!(&state.resident, Residency::Resident(owner, chat) if *owner == device && chat == id);
        if matches!(&state.resident, Residency::Resident(owner, _) if *owner != device) {
            state.resident = Residency::Empty;
            state.dirty_at = None;
        }
        if resident {
            erase_slot(engine)?;
            state.resident = Residency::Empty;
            state.dirty_at = None;
        }
        // The staging sibling is the erased chat's too: left behind it is a
        // file nothing will ever name again.
        let _ = fs::remove_file(dir.join(format!("{}{STAGING}", file_name(model, device, id))));
        match fs::remove_file(dir.join(file_name(model, device, id))) {
            Ok(()) => Ok(()),
            // A chat that never reached the disk has no file, and that is not
            // a failure: the caller asked for it to be gone.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(ChatError::Files),
        }
    }

    /// Marks the slot as holding state its file does not: a completion passed
    /// through it. The moment is the timer's, and the decision to write is
    /// [`cadence`]'s — this is the door's handle on both, and the only way in.
    pub(crate) fn mark_dirty(&self, slot: u32) {
        if let Ok(mut state) = self.lock(slot) {
            cadence::note_activity(&mut state);
        }
    }

    /// Writes out every slot that changed and has been quiet long enough, and
    /// answers how many were written. The whole decision is [`cadence`]'s; `now`
    /// is the tick's own instant, so the caller's clock is the only one read.
    pub(crate) fn save_idle(&self, devices: &DeviceSet, upstream_port: u16, now: Instant) -> usize {
        cadence::save_idle(self, devices, upstream_port, now)
    }

    fn lock(&self, slot: u32) -> Result<std::sync::MutexGuard<'_, Slot>, ChatError> {
        Ok(self
            .slots
            .get(slot as usize)
            .ok_or(ChatError::NoSlot)?
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()))
    }
}

/// The name, and the door builds it: flat, because `fs_validate_filename`
/// rejects separators, and carrying the device and the model so a file can
/// never be read back into another device's slot by accident.
fn file_name(model: &str, device: DeviceId, id: &str) -> String {
    format!("d{}-m{model}-c{id}.bin", device.value())
}

/// The shape both branches of the app's `uid()` produce: lowercase letters,
/// digits and dashes, 8 to 64 of them. No dot, no separator, no leading dash —
/// and each of those is a refusal, never something the door repairs.
fn valid_id(id: &str) -> bool {
    (8..=64).contains(&id.len())
        && !id.starts_with('-')
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

/// The client's body, bounded: this route carries one id, so a body beyond
/// [`MAX_PAYLOAD`] is a client talking to something else.
fn read_payload(client: &mut TcpStream, length: usize, deadline: Instant) -> Result<Vec<u8>, ()> {
    if length > MAX_PAYLOAD {
        let _ = proxy::discard_request_body(client, length, deadline);
        return Err(());
    }
    let mut body = vec![0u8; length];
    proxy::set_read_deadline(client, deadline).map_err(|_| ())?;
    client.read_exact(&mut body).map_err(|_| ())?;
    Ok(body)
}

/// The door's own error answer, with the origin headers every answer written
/// with a head in hand carries.
fn answer(status: u16, origin: Option<&[u8]>, words: &str) -> Vec<u8> {
    let reason = match status {
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        501 => "Not Implemented",
        _ => "Bad Gateway",
    };
    format!(
        "HTTP/1.1 {status} {reason}\r\n{}Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{words}",
        cors::origin_headers(origin),
        words.len()
    )
    .into_bytes()
}

/// Success, and nothing to say. A 204 must not carry a `Content-Length`.
fn no_content(origin: Option<&[u8]>) -> Vec<u8> {
    format!(
        "HTTP/1.1 204 No Content\r\n{}Connection: close\r\n\r\n",
        cors::origin_headers(origin)
    )
    .into_bytes()
}
