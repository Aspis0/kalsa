//! The map when the engine stops holding what it claims.
//!
//! **Trap: two types, one name.** `kalsa_supervisor::child::Residency` says
//! whether the SERVER holds the MODEL in memory — it flips on the two stderr
//! lines `--sleep-idle-seconds` prints. [`Residency`], this crate's, says
//! which CHAT lives in one SLOT. Different facts, no conversion between them:
//! the app's tick reads the first and calls the method below, which only ever
//! relaxes the second.
//!
//! The relaxation goes to `Unknown`, never to `Empty`: the door has not seen
//! the slot emptied, it only knows the engine released what was in it. And it
//! only ever takes a claim away — `Chats`' activate route is what puts one
//! back, after the engine itself has been told what the slot holds.

use super::{Chats, Residency};

impl Chats {
    /// The engine no longer holds what this map may claim: its model was
    /// released, or the server died — a crash announces nothing. Every
    /// `Resident` becomes `Unknown`.
    ///
    /// Load-bearing, not cosmetic: while the map says `Resident`, activating
    /// that chat again is a no-op (`569d31e`), and against a released model
    /// that no-op skips the very restore that would bring the cache back from
    /// the file — the warmth the tier exists for, lost silently. On `Unknown`
    /// the no-op does not fire, the next `activate` restores from disk, and no
    /// save writes a state out of a slot whose content is no longer known.
    pub(crate) fn invalidate_residency(&self) {
        for slot in &self.slots {
            let mut state = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if matches!(&state.resident, Residency::Resident(..)) {
                state.resident = Residency::Unknown;
            }
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
        };
        (state.dirty_at, claim)
    }
}
