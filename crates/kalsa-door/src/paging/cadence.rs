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

use super::io::{save, Saved};
use super::{file_name, Chats, Residency, Slot};
use crate::engine::Engine;
use crate::DeviceSet;

/// Stamps the slot at the moment a completion passed through it: the state it
/// now holds is not on disk, and the quiet it has to earn starts here. The one
/// writer of `dirty_at`, so a dirty slot with no instant does not exist.
///
/// The mark does NOT consult the residency, and that is deliberate. It comes
/// from `SlotTurn::drop`, and its fact is "a turn wrote into this slot" — true
/// whether or not the door can name the chat in it: the map is born `Unknown`
/// (a door can be built against an engine already holding state) and is
/// relaxed to `Unknown` whenever the engine stops holding what it claimed
/// (`Chats::invalidate_residency`). Gating the mark on the map would make
/// "clean" mean "the map said so" instead of "the file holds this slot's
/// state" — and the map is the one part of the tier that is allowed to not
/// know. Consulting the map is the SAVE's job: `save_idle` refuses every slot
/// it cannot name, and a test pins that a marked `Unknown` slot is never
/// written out.
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
        // Everything the call needs is read under the lock, and the lock ends
        // there: `mark_dirty` — the end of a turn, `proxy`'s `SlotTurn` — and
        // `activate`/`erase` take this same mutex, all on the door's four
        // workers. Held across an engine call that may wait out the whole
        // patience, the end of a turn would wait up to ten seconds inside a
        // worker for a write it is not part of.
        let (at, device, chat, salt) = {
            let state = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
            //
            // The backoff restarts from each attempt's own start, and every attempt
            // is the first tick at or after its bound, so attempt k is offered no
            // earlier than mark+k·interval, each bound rounded UP by the ticker,
            // never down. Two consecutive failures are the ceiling, and both sit
            // inside the unload clock measured from the mark: attempt two is out at
            // worst mark+2Q+two tick periods — 2 s at the shipped 1 s tick — and
            // 2Q+2 s < 3Q already at Q = 20 s, the interval the panel's 60 s unload
            // clock derives (`idle_save_seconds`), which the engine counts from the
            // turn this mark ends. The engine grants that clock anew after every
            // task it sees — `server_queue` stamps `time_last_task` on each one,
            // `defer` included — so attempts that arrive push the release further
            // out again: no release falls between two attempts the engine answered.
            //
            // What attempt three does NOT do is "coincide with the release" (the
            // claim the comment this replaces carried): its bound IS mark+3Q,
            // rounded up like every other attempt's — it is held back by a release
            // an earlier attempt re-stamped, and only races one that nothing ever
            // reached. And if the relay of the final token let a release beat every
            // attempt, the save that comes after finds `n_saved` 0 — the unload
            // took what the slot held — and the arm below keeps that turn's mark
            // instead of booking it, because a mark is kept at the price of one
            // attempt and lost at the price of the turn.
            //
            // What spends those two failures without costing the turn: the failure
            // this backoff is built for is a save deferred by a turn in flight, a
            // turn in flight keeps the slot busy, and the engine's unload clock has
            // not started while they are spent.
            if state.retry_after.is_some_and(|retry| now < retry) {
                continue;
            }
            let Residency::Resident(device, chat) = &state.resident else {
                continue;
            };
            // A record whose device has left the set has no salt to write under,
            // and the engine reads the salt on every action. The activate that
            // hands this slot on is what drops the record.
            let Some(salt) = devices.cache_salt(*device) else {
                continue;
            };
            (at, *device, chat.clone(), salt)
        };
        // The budget is this slot's own, taken when the slot is offered and
        // not once per tick: a tick-wide deadline would be spent by the first
        // slot that makes the engine wait, and the next would be declared
        // unreachable with no budget left — without a connection ever being
        // opened for it (`engine.rs` refuses an expired deadline before
        // dialling), so the engine would not even see the request.
        let engine = Engine {
            port: upstream_port,
            slot: index as u32,
            salt: &salt,
            deadline: Instant::now() + crate::PATIENCE,
        };
        // The lock was free while the engine wrote, so the slot may have been
        // handed to another chat before this save comes back. `save` takes the
        // lock again for the commit check, and what the check buys here: no
        // state lands under a chat's name that no longer holds the slot, and
        // below — nothing is counted and nothing is cleared (mark or backoff)
        // for that slot, because both now belong to its new holder. The staging
        // file itself is named for the chat this tick read, and the engine's
        // write into a name is whole or absent — a temp file created
        // exclusively and renamed over that name only once the write finished
        // — never a partial state.
        let outcome = save(
            dir,
            &file_name(model, device, &chat),
            &engine,
            &|| {
                let state = slot
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                matches!(
                    &state.resident,
                    Residency::Resident(owner, held) if *owner == device && *held == chat
                )
            },
        );
        let mut state = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        match outcome {
            // The chat's file on disk IS this save: count it, and clear what
            // was owed. The mark goes only if it is still the instant this
            // save left with — a completion that arrived while the engine was
            // writing stamped a NEWER one, a turn this save cannot contain,
            // and erasing it would be the loss this timer exists to prevent.
            Ok(Saved::InPlace) => {
                saved += 1;
                state.retry_after = None;
                if state.dirty_at == Some(at) {
                    state.dirty_at = None;
                }
            }
            // `n_saved` 0 for a slot this tick holds and had marked: the
            // engine wrote nothing, so the turn is NOT on disk, and neither
            // the count nor the mark may say it is. The door cannot tell an
            // engine that lost the slot (the unload ran, the map is stale)
            // from any other zero, and a slot it truly owed nothing to never
            // reaches this call — the mark stays and the backoff bounds what
            // keeping it costs: one attempt per interval, where clearing it
            // would cost the turn. A slot handed on meanwhile is touched not
            // at all: its mark and its backoff belong to the new holder, as
            // under `Superseded`.
            Ok(Saved::Nothing) => {
                if matches!(
                    &state.resident,
                    Residency::Resident(owner, held) if *owner == device && *held == chat
                ) {
                    state.retry_after = Some(now + idle_save);
                }
            }
            // Nothing reached a chat's name and the slot is another chat's
            // now: not counted, not cleared, not un-backed-off. Every field
            // left here belongs to whoever holds the slot, and this arm
            // touches none of them.
            Ok(Saved::Superseded) => {}
            // Still dirty. A failure is not permanent: a save issued while the
            // slot is generating is deferred by the engine and answered at the
            // end of the turn, so one that outlasts the door's patience reads
            // here as unanswered while the engine is really writing the file
            // (`dev/results/save-on-busy-slot`: a save sent 3 s into a 34 s turn
            // was answered 31 s later with the whole turn, `n_saved` 2529). The
            // retry is what persists it, and the backoff is one interval from
            // this attempt's own start — see the ceiling above.
            Err(_) => state.retry_after = Some(now + idle_save),
        }
    }
    saved
}
