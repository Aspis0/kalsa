//! When a slot's state reaches the disk.
//!
//! A switch saves a chat because the slot is about to be taken from it. This
//! module exists for the turn no switch ever saved: the engine releases the
//! slot — and the state in it — after `--sleep-idle-seconds` idle, and the
//! switch that follows has nothing left to write out. The slot therefore has
//! to reach its file *before* that clock runs out.
//!
//! What it clocks is **silence, not the tick**. The engine does not release a
//! slot the user is still talking to, so the state worth saving is the one
//! after the last token: a save on a fixed period would write hundreds of
//! megabytes under every busy minute and still hold the wrong state. A slot is
//! written out once it is dirty *and* has been quiet for the interval the
//! caller derived from its own unload clock (`kalsa_launch::idle_save_seconds`)
//! — which is what keeps the save before the release at every clock the panel
//! can set, down to the shortest one, and not only at the shipped default.
//!
//! The call is in-process, not a route: no client asks for it and no head
//! carries it. The app owns the tick and the interval, the door owns the save
//! — the slot, the device and the salt are all its own.

use std::time::Instant;

use super::io::save;
use super::{file_name, Chats, Residency, Slot};
use crate::engine::Engine;
use crate::DeviceSet;

/// Stamps the slot at the moment a completion passed through it: the state it
/// now holds is not on disk, and the quiet it has to earn starts here. The one
/// writer of `dirty_at`, so a dirty slot with no instant does not exist.
pub(super) fn note_activity(state: &mut Slot) {
    state.dirty_at = Some(Instant::now());
}

/// Writes out every slot a completion changed whose quiet has lasted at least
/// the interval, and answers how many were written.
///
/// Nothing is written for a slot that is still active, is clean, is empty, or
/// whose residency is `Unknown`: the first is being used, the second's file
/// already holds its state, and the last two cannot be named — writing one out
/// would be writing a state under a chat's name on the strength of a guess,
/// which is the same guess `activate` refuses.
///
/// `now` is the tick's instant. The quiet is measured against it and not
/// against a clock read here, so a caller that knows when the slot went quiet
/// — every test, and the app's own ticker — decides with the instant it holds.
pub(super) fn save_idle(
    chats: &Chats,
    devices: &DeviceSet,
    upstream_port: u16,
    now: Instant,
) -> usize {
    let (Some(idle_save), Some(model), Some(dir)) = (
        chats.idle_save,
        chats.model.as_deref(),
        chats.dir.as_deref(),
    ) else {
        return 0;
    };
    let mut saved = 0;
    for (index, slot) in chats.slots.iter().enumerate() {
        let mut state = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        // The instant is when the last completion passed. Less than the
        // interval ago means the user is still working here, and the engine
        // will not release the slot under them.
        let Some(at) = state.dirty_at else {
            continue;
        };
        if now.saturating_duration_since(at) < idle_save {
            continue;
        }
        // One failed save is owed, not owed *now*: the slot is offered to the
        // engine again only after another interval, so an engine that refuses or
        // cannot answer is asked once per interval and not once per tick. Reusing
        // the interval is also what keeps this retry inside the unload clock —
        // the first attempt is one interval after the last activity and the first
        // retry is two, pinned in `kalsa_launch` — where a longer backoff would
        // ask the engine to keep a slot it has already released.
        if state.retry_after.is_some_and(|retry| now < retry) {
            continue;
        }
        let Residency::Resident(device, chat) = &state.resident else {
            continue;
        };
        let (device, chat) = (*device, chat.clone());
        // A record whose device has left the set has no salt to write under,
        // and the engine reads the salt on every action. The activate that
        // hands this slot on is what drops the record.
        let Some(salt) = devices.cache_salt(device) else {
            continue;
        };
        let engine = Engine {
            port: upstream_port,
            slot: index as u32,
            salt: &salt,
            deadline: now + crate::PATIENCE,
        };
        match save(dir, &file_name(model, device, &chat), &engine) {
            Ok(()) => {
                state.dirty_at = None;
                state.retry_after = None;
                saved += 1;
            }
            // Still dirty. A failure is not permanent: a save issued while the
            // slot is generating is deferred by the engine and answered at the
            // end of the turn, so one that outlasts the door's patience reads
            // here as unanswered while the engine is really writing the file
            // (`dev/results/save-on-busy-slot`: a save sent 3 s into a 34 s turn
            // was answered 31 s later with the whole turn, `n_saved` 2529). The
            // retry is what persists it, and the backoff is one interval from
            // this attempt's own start.
            Err(_) => state.retry_after = Some(now + idle_save),
        }
    }
    saved
}
