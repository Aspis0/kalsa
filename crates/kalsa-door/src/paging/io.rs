//! The pipe to the engine: the three slot actions the tier's policy calls, the
//! staging name a save is written under, and the sentence a failure gives the
//! client. Nothing here decides which chat is resident — that is the policy's,
//! in the parent module — but a restore does record on the slot what its
//! failure means, because only this side knows whether the engine answered.

use std::fs;
use std::path::Path;

use super::{answer, Residency, Slot};
use crate::engine::{Call, Engine};

/// The suffix a save is written under until it is known to hold anything. The
/// engine's own write is already atomic against a crash; this one is about not
/// needing to be, because a rename over the real file is what would destroy a
/// chat the slot no longer holds.
pub(super) const STAGING: &str = ".staging";

const ENGINE: &str = "The engine could not be reached for this chat.";
const SLOT_REFUSED: &str = "The engine refused to clear this device's slot, so the chat was not opened.";
const SAVE_REFUSED: &str = "The engine could not save the chat that is open, so it stays as it is.";
const RESTORE_FAILED: &str =
    "The chat could not be opened; the chat that was open is back in the slot.";
const SLOT_EMPTY: &str = "The chat could not be opened; the slot is now empty.";
const SLOT_UNKNOWN: &str = "The engine could not be reached, so the state of this device's slot is unknown.";
const FILES: &str = "The door could not put the saved chat in place, so nothing changed.";
const NO_SLOT: &str = "The door lost track of this device's slot.";

/// What a failed action tells the client. The statuses are the door's own
/// vocabulary — 400 for the client's request, 501 for a door the app never
/// built the tier into, 502 for the engine — and the sentence is what a UI can
/// show.
pub(super) enum ChatError {
    Unreachable,
    Save,
    Restore,
    Empty,
    Unknown,
    SlotRefused,
    Files,
    NoSlot,
}

impl ChatError {
    pub(super) fn answer(self, origin: Option<&[u8]>) -> Vec<u8> {
        match self {
            Self::Unreachable => answer(502, origin, ENGINE),
            Self::Save => answer(502, origin, SAVE_REFUSED),
            Self::Restore => answer(502, origin, RESTORE_FAILED),
            Self::Empty => answer(502, origin, SLOT_EMPTY),
            Self::Unknown => answer(502, origin, SLOT_UNKNOWN),
            Self::SlotRefused => answer(502, origin, SLOT_REFUSED),
            Self::Files => answer(502, origin, FILES),
            Self::NoSlot => answer(500, origin, NO_SLOT),
        }
    }
}

/// Saves the slot under `real`, and renames it into place only when the engine
/// wrote something. An empty slot writes an empty state, and renaming that
/// over a real file is how a sleeping engine destroys a chat it still has on
/// disk.
pub(super) fn save(dir: &Path, real: &str, engine: &Engine<'_>) -> Result<(), ChatError> {
    let staging = format!("{real}{STAGING}");
    let staged = dir.join(&staging);
    let written = engine
        .call("save", Some(&staging), Some("n_saved"))
        .map_err(|call| {
            // The engine may have written the state and lost the answer; the
            // real file is untouched either way, so the leftover goes.
            let _ = fs::remove_file(&staged);
            match call {
                Call::Unreachable => ChatError::Unreachable,
                Call::Refused => ChatError::Save,
            }
        })?;
    let renamed = if written > 0 {
        fs::rename(&staged, dir.join(real))
    } else {
        Ok(())
    };
    // Every path out, including a rename that just consumed it: no staging
    // file is kept, because nothing but this call ever names one. The single
    // cleanup runs after the rename instead of in its error arm, because the
    // `?` that used to sit here skipped it on the one path that fails — a
    // rename the filesystem refuses left the staging file behind.
    let _ = fs::remove_file(&staged);
    renamed.map_err(|_| ChatError::Files)
}

/// Restores `name`, and records on the slot what a failure means for it. An
/// engine that never answered may not have processed the action at all, so the
/// slot holds what it held and the door says so instead of calling it empty. A
/// refusal did process the action, and the engine's own catch cleared the slot.
///
/// `Unknown` never writes out of the slot, and for two branches rather than
/// one, because the caller's save can end either way — this is the premise the
/// next reader must be able to check:
///
/// - the save reported `n_saved > 0`: the chat that was in the slot was
///   renamed into place, so its file is fresh;
/// - the save reported `n_saved == 0`: nothing was renamed, and no
///   conversational state that is not already on disk is lost — the slot held
///   nothing the door could have written out. That is narrower than "nothing
///   to lose", and the countercase is real: the slot holds a chat whose file
///   on disk is an *earlier* session, the engine reports 0, no rename happens,
///   and the fact that the chat is now empty is lost — the next restore reads
///   the old file and revives messages the user deleted. That behaviour
///   predates this record; what the record must not do is call the branch
///   safe.
///
/// The count is the engine's (`n_saved`), and the door cannot tell an empty
/// slot from a chat with a zero-length transcript; that distinction, if it is
/// ever needed, is the engine's to make. Neither branch lets the door write
/// over a file with state it cannot name, which is what makes the unknown
/// safer than guessing between empty and the old record.
pub(super) fn restore(state: &mut Slot, engine: &Engine<'_>, name: &str) -> Result<(), ChatError> {
    match engine.call("restore", Some(name), None) {
        Ok(_) => Ok(()),
        Err(Call::Unreachable) => {
            state.resident = Residency::Unknown;
            state.dirty_at = None;
            Err(ChatError::Unknown)
        }
        Err(Call::Refused) => {
            state.resident = Residency::Empty;
            state.dirty_at = None;
            Err(ChatError::Empty)
        }
    }
}

pub(super) fn erase_slot(engine: &Engine<'_>) -> Result<(), ChatError> {
    engine
        .call("erase", None, None)
        .map(|_| ())
        .map_err(|call| match call {
            Call::Unreachable => ChatError::Unreachable,
            Call::Refused => ChatError::SlotRefused,
        })
}
