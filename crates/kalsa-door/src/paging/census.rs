//! The panel's read of the residency map, in-process like `save_idle` and
//! `invalidate_residency` — never a route: the door refuses `GET /slots`, and
//! the map is the door's own answer, which no client may supply.
//!
//! Three states, one count: `Empty` holds nothing, `Unknown` is "I do not
//! know", and only `Resident` names a chat. Neither of the other two is
//! counted *or* quietly folded into another number — the panel prints this
//! count over [`RunningDoor::capacity`] and nothing else.

use super::{Chats, Residency};
use crate::RunningDoor;

impl Chats {
    /// How many slots say a named chat lives there. `Unknown` is not counted
    /// as a resident (the door does not know one is there) and not as an
    /// empty slot either (the door does not know one is free): it simply
    /// leaves this count, which is why a release makes the number drop.
    pub(crate) fn residents(&self) -> usize {
        self.slots
            .iter()
            .filter(|slot| {
                let state = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                matches!(state.resident, Residency::Resident(..))
            })
            .count()
    }

    /// The slots this door was built with — the honest denominator of
    /// "residents on N". Three slot numbers can diverge in this app:
    /// `/props`' `total_slots` is the engine's, `args.parallel` is the
    /// launch's, and `door_capacity` (`src-tauri/src/main.rs`) forces the
    /// engine's to 1 when the engine does not consume the private headers.
    /// This reads the map's own length, which `server::start` built from the
    /// capacity the door itself was constructed with.
    pub(crate) fn capacity(&self) -> usize {
        self.slots.len()
    }
}

impl RunningDoor {
    /// The panel's resident count. The call is in-process, not a route: no
    /// client asks for it and no HTTP head carries it — the same rule as
    /// `save_idle` and `invalidate_residency`, whose map this reads.
    pub fn residents(&self) -> usize {
        self.chats.residents()
    }

    /// How many slots this door holds: [`Self::residents`]' denominator,
    /// from the door's own construction and never from the engine's reply.
    pub fn capacity(&self) -> usize {
        self.chats.capacity()
    }
}
