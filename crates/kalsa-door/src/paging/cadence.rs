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
/// which is the same guess `activate` refuses. A save the engine refuses
/// leaves the slot dirty, and the next tick is another chance, not a retry
/// loop: the tick is the app's.
pub(super) fn save_idle(chats: &Chats, devices: &DeviceSet, upstream_port: u16) -> usize {
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
        if at.elapsed() < idle_save {
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
            deadline: Instant::now() + crate::PATIENCE,
        };
        if save(dir, &file_name(model, device, &chat), &engine).is_ok() {
            state.dirty_at = None;
            saved += 1;
        }
    }
    saved
}
