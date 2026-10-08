//! The map when the engine stops holding what it claims.
//!
//! **Trap: two types, one name.** `kalsa_supervisor::child::Residency` says
//! whether the SERVER holds the MODEL in memory — it flips on the two stderr
//! lines `--sleep-idle-seconds` prints. [`Residency`], this crate's, says
//! which CHAT lives in one SLOT. Different facts, no conversion between them:
//! the app's tick reads the first and calls the method below, which only ever
//! relaxes the second.
//!
//! The relaxation goes to `Evicted`, never to `Empty`: the door has not seen
//! the slot emptied, it only knows the engine released what was in it. The
//! chat's name is kept, because its file holds the last state that reached
//! disk, and the owner's next completion restores that file (`Chats::recall`)
//! with no UI re-activation. It never invents a claim: the name it keeps is
//! the one the map already held.

use super::{Chats, Residency};

impl Chats {
    /// The engine no longer holds what this map may claim: its model was
    /// released, or the server died — a crash announces nothing. Every
    /// `Resident` becomes `Evicted`, with its chat named.
    ///
    /// Load-bearing, not cosmetic: while the map says `Resident`, activating
    /// that chat again is a no-op (`569d31e`), and against a released model
    /// that no-op skips the very restore that would bring the cache back from
    /// the file. `Evicted` does not fire the no-op, and nothing saves out of
    /// it: only a `Resident` slot is ever written, so the file keeps its last
    /// state and is never overwritten by a slot the engine has released.
    pub(crate) fn invalidate_residency(&self) {
        let mut relaxed = 0;
        for slot in &self.slots {
            let mut state = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let Residency::Resident(owner, chat) = &state.resident else {
                continue;
            };
            state.resident = Residency::Evicted(*owner, chat.clone());
            relaxed += 1;
        }
        // The door's own view of the engine releasing its model: the number
        // is what the next `activate` can no longer skip, and a report reads
        // a wake as the restore that follows this line. Only a relaxation
        // says anything — the tick asks every second while the model sleeps,
        // and `0 slot(s)` every second is noise, not a record.
        if relaxed > 0 {
            log::info!("{}", crate::audit::line::residency_line(relaxed));
        }
    }

    /// What one slot's map says: the instant of the last turn through it, and
    /// one of three words — `empty`, `unknown`, `resident`. Test-only, and it
    /// has to be one: at birth `empty` and `unknown` behave identically (both
    /// refuse a previous chat to save), so the birth state is read here
    /// rather than inferred through the engine.
    #[cfg(test)]
    pub(crate) fn observed(&self, slot: u32) -> (Option<std::time::Instant>, &'static str) {
        let state = self.slots[slot as usize]
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let claim = match &state.resident {
            Residency::Empty => "empty",
            Residency::Unknown => "unknown",
            Residency::Resident(..) => "resident",
            // The chat is on disk and named, out of the slot until its owner's
            // next request brings it back: its own word, because neither
            // "empty" nor "unknown" is true.
            Residency::Evicted(..) => "evicted",
        };
        (state.dirty_at, claim)
    }
}
