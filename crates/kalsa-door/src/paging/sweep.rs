//! The sweep: the one place the door reads the whole save directory, and
//! the only rules it ever deletes by.
//!
//! Three things leave a file behind that nobody will name again: a device is
//! revoked, the process dies between the engine's write and the door's
//! rename (a `.staging` nothing will ever rename), and a chat's `erase` is
//! refused. The sweep takes the first two, never the third, and only ever
//! through its two moments — construction ([`server`](crate::server)) and a
//! set change ([`set_devices`](crate::RunningDoor::set_devices)) — never the
//! tick: ownership of a file changes when the *set* changes or across a
//! restart, so those are the only moments the answer can differ, and reading
//! the directory more often only multiplies the reads against saves in
//! flight.
//!
//! Three rules, in the order they apply:
//!
//! 1. **A name whose device is in the set is never touched** — not its
//!    `.bin`, not its `.staging`. This is the invariant, and it is also
//!    what makes the two moments safe rather than merely lucky: an in-flight
//!    save writes only its own device's names, so timing can never cost a
//!    present device its file. A present device's stale `.staging` (a crash)
//!    is left too: the next save of that chat reuses the same staging name
//!    and cleans it (`io::save` removes it on every path out).
//! 2. **A name that parses to an absent device is deleted**, `.staging`
//!    included: nothing will ever rename it.
//! 3. **A name that does not parse is left alone.** Unknown is not orphan.
//!
//! Two blind spots, both decided rather than missed:
//!
//! - **A refused erase is not collected.** The door cannot know a chat was
//!   deleted — conversations live only in the client's store and the door
//!   cannot enumerate them — so the orphan stays under its (present) device
//!   until that device itself leaves the set, and rule 2 takes it then. Any
//!   heuristic the door could invent here would delete files it cannot
//!   attribute, which is exactly what rule 3 forbids.
//! - **A re-pair may leave the old files under a live name.** The name
//!   carries no salt by design, and the store mints an id as `max + 1` over
//!   the records present *now* (`kalsa-pairing/src/store.rs`), so forgetting
//!   the top id and pairing again re-uses it — pinned by
//!   `forgetting_the_highest_id_then_pairing_reuses_it`. The old files then
//!   belong to an id the set holds, and this sweep is what it is: complete
//!   for revocation, blind to re-pair. A re-paired device keeps its own
//!   chats; whether the owner would rather orphan them is a decision this
//!   code does not make for them.

use std::fs;

use super::names::owner;
use super::Chats;
use crate::DeviceSet;

impl Chats {
    /// Deletes every file in the save directory whose name names a device
    /// the given set no longer holds, and nothing else.
    ///
    /// Membership is read once, as one snapshot: every file is judged
    /// against the same set, so the directory comes out of one coherent
    /// decision rather than a set that changed mid-read. A read or delete
    /// that fails is skipped, not reported: a file that cannot be removed
    /// now is retried at the next moment, and neither the store poll nor a
    /// door build may fail over deleting something.
    pub(crate) fn sweep(&self, devices: &DeviceSet) {
        let Some(dir) = self.dir.as_deref() else {
            return;
        };
        let Ok(entries) = fs::read_dir(dir) else {
            // No directory, nothing to sweep. The app creates it before the
            // launch; the door never does.
            return;
        };
        let current = devices.current();
        for entry in entries.flatten() {
            // A name that is not valid UTF-8 is not one this door wrote:
            // unknown, left alone, like every other unparsable name.
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                continue;
            };
            let Some(device) = owner(name) else {
                continue;
            };
            if current.contains(device) {
                continue;
            }
            let _ = fs::remove_file(entry.path());
        }
    }
}
