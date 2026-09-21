//! The stable `DeviceId -> slot` map, the engine declaration it needs, and
//! the leases over it.
//!
//! The engine wraps `id_slot % slots.size()` and never refuses; this module
//! owns the mapping and refuses for it. Three facts live under one lock —
//! the current set, the map, and the in-flight leases — so a revocation
//! cannot land between a membership check and an allocation.

use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex, RwLock, RwLockReadGuard};

use crate::{DeviceId, Devices};

/// Whether the engine in front of the door consumes the door's private
/// headers. The declaration is explicit so a build that has not mounted such
/// an engine cannot accidentally serve more than one device: against an
/// engine that ignores `X-Kalsa-Slot`, several devices are auto-scheduled
/// into one another's slots, and the engine's `id_slot % slots.size()` hides
/// it. The door refuses `capacity > 1` unless this says [`Self::Consumed`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnginePrivateHeaders {
    /// The engine ignores the private headers and schedules slots itself.
    /// Only one device may be served.
    NotConsumed,
    /// The engine reads `X-Kalsa-Slot` and `X-Kalsa-Cache-Salt` — the fork
    /// from v1.1.0. More than one device may be served, each on its own slot.
    Consumed,
}

/// Why a device did not get a slot. `NotHeld` and `NoRoom` are different
/// facts with different answers — a device revoked between authentication
/// and the slot decision gets the one 401, a full house gets the no-slot
/// 503 — so they are different errors.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum LeaseError {
    /// The device is not in the set the door currently serves: it was
    /// revoked in the window between authentication and this decision.
    NotHeld,
    /// The device is held, but every slot is taken.
    NoRoom,
}

/// The state every slot decision is made from, under one lock: the current
/// set, the stable device-to-slot map, and the in-flight leases. Keeping
/// them together is what makes `swap` atomic. Pruning a revoked device and
/// installing the new set happen in the same critical section, so no `lease`
/// can validate against one set and allocate from another, and `assign`
/// cannot resurrect a device the new set does not hold.
struct Slots {
    current: Arc<Devices>,
    assigned: HashMap<DeviceId, u32>,
    free: BTreeSet<u32>,
    /// In-flight leases per slot. A revoked device's slot is not handed to
    /// anyone while its request still holds a lease, so two devices can
    /// never share one slot through a swap.
    leases: HashMap<u32, u32>,
    /// Slots whose device left the set while a lease was still held. They
    /// move to `free` when the last lease drops.
    pending_free: BTreeSet<u32>,
    capacity: u32,
}

/// The paired devices behind a door, swappable while it runs. Two locks, and
/// the order between them is always gate first, then `slots`:
///
/// - `gate` is the revocation gate. A request holds it shared across
///   `{holds; seal; write}`; `swap` takes it exclusive. Read is read-read, so
///   requests stay concurrent, and only a revocation waits — for one small
///   write, never for a streamed answer.
/// - `slots` holds the set, the map and the leases. `lease`/`holds`/
///   `cache_salt`/`SlotLease::drop` take only this one, so they never touch
///   the gate.
pub(crate) struct DeviceSet {
    gate: RwLock<()>,
    slots: Mutex<Slots>,
    /// Test seam: runs at the top of the next `lease`, before the lock is
    /// taken, so a test can revoke the device in the exact window between
    /// authentication and the slot decision.
    #[cfg(test)]
    before_lease: Mutex<Option<Box<dyn FnOnce() + Send>>>,
    /// Test seam: runs inside the gated request-write block, so a test can
    /// park a request while it holds the shared revocation guard.
    #[cfg(test)]
    in_write: Mutex<Option<Box<dyn Fn() + Send>>>,
}

impl DeviceSet {
    pub(crate) fn new(devices: Devices, capacity: u32) -> Self {
        Self {
            gate: RwLock::new(()),
            slots: Mutex::new(Slots {
                current: Arc::new(devices),
                assigned: HashMap::new(),
                free: (0..capacity).collect(),
                leases: HashMap::new(),
                pending_free: BTreeSet::new(),
                capacity,
            }),
            #[cfg(test)]
            before_lease: Mutex::new(None),
            #[cfg(test)]
            in_write: Mutex::new(None),
        }
    }

    /// The shared guard a request holds across `{holds; seal; write}`. A
    /// revocation that lands before the guard is seen by `holds()`; a
    /// revocation that lands while the guard is held waits, so at the instant
    /// of the write the device was not yet revoked.
    pub(crate) fn revocation_gate(&self) -> RwLockReadGuard<'_, ()> {
        self.gate
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The same guard, named for the test that holds it while another thread
    /// calls `swap`, so the wait is deterministic rather than a race.
    #[cfg(test)]
    pub(crate) fn revocation_guard_for_test(&self) -> RwLockReadGuard<'_, ()> {
        self.revocation_gate()
    }

    #[cfg(test)]
    pub(crate) fn slot_cardinality(&self) -> (usize, usize, usize) {
        let slots = self.lock();
        (
            slots.assigned.len(),
            slots.free.len(),
            slots.pending_free.len(),
        )
    }

    /// One critical section decides membership and allocation together: a
    /// device the current set does not hold is refused with
    /// [`LeaseError::NotHeld`] rather than given a slot it would keep
    /// forever, and the lease keeps that slot out of `free` until the request
    /// ends.
    pub(crate) fn lease(&self, device: DeviceId) -> Result<SlotLease<'_>, LeaseError> {
        #[cfg(test)]
        if let Some(hook) = self
            .before_lease
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            hook();
        }
        let mut slots = self.lock();
        if !slots.current.contains(device) {
            return Err(LeaseError::NotHeld);
        }
        let slot = match slots.assigned.get(&device) {
            Some(&slot) => slot,
            None => {
                let Some(slot) = slots.free.iter().next().copied() else {
                    // The free set is the authority. The stored capacity is
                    // never re-derived; the partition is only asserted: every
                    // id is assigned, free, or waiting on a revoked lease.
                    debug_assert_eq!(
                        slots.assigned.len() + slots.free.len() + slots.pending_free.len(),
                        slots.capacity as usize
                    );
                    return Err(LeaseError::NoRoom);
                };
                slots.free.remove(&slot);
                slots.assigned.insert(device, slot);
                slot
            }
        };
        *slots.leases.entry(slot).or_insert(0) += 1;
        Ok(SlotLease {
            set: self,
            device,
            slot,
        })
    }

    #[allow(dead_code)] // the read seam: exercised by the slot tests, not on the request path
    pub(crate) fn slot_of(&self, device: DeviceId) -> Option<u32> {
        self.lock().assigned.get(&device).copied()
    }

    /// The device's cache salt, if the current set holds it. Read under the
    /// same lock as membership, so `None` means revoked at this instant.
    pub(crate) fn cache_salt(&self, device: DeviceId) -> Option<[u8; 32]> {
        self.lock().current.cache_salt(device).copied()
    }

    /// Installs a one-shot hook that the next `lease` runs before it locks.
    #[cfg(test)]
    pub(crate) fn set_before_lease_hook(&self, hook: impl FnOnce() + Send + 'static) {
        *self
            .before_lease
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Box::new(hook));
    }

    /// Installs a one-shot hook that runs inside the gated request-write
    /// block, while the shared revocation guard is held.
    #[cfg(test)]
    pub(crate) fn set_in_write_hook(&self, hook: impl Fn() + Send + 'static) {
        *self
            .in_write
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Box::new(hook));
    }

    #[cfg(test)]
    pub(crate) fn run_in_write_hook(&self) {
        let hook = self
            .in_write
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(hook) = hook {
            hook();
        }
    }

    /// The in-flight lease count for one slot: the reference count that
    /// decides when a revoked slot is finally freed.
    #[cfg(test)]
    pub(crate) fn lease_count(&self, slot: u32) -> usize {
        self.lock().leases.get(&slot).copied().unwrap_or(0) as usize
    }

    /// Replaces the set in place. Pruning and installation share one
    /// critical section: a concurrent `lease` sees either the whole old set
    /// with the old slots, or the whole new set with the slots it freed.
    ///
    /// Slots are pruned, never re-densified. A revoked slot moves to `free`
    /// only when no lease holds it; while a revoked device's request is
    /// still in flight the slot waits in `pending_free`, so it cannot be
    /// handed to another device and two devices can never share it. Every
    /// kept device keeps its exact slot, because a device id survives
    /// removals (`max(id) + 1` in the app's pairing store) and a moved slot
    /// would change that device's warm-cache identity for no reason the
    /// owner asked for.
    pub(crate) fn swap(&self, devices: Devices) {
        // Exclusive: this waits for every in-flight `{holds; seal; write}`,
        // and a later one cannot start until it is done. `RwLock` is not
        // fair, so a stream of readers can delay a revocation. Taken before
        // `slots`, the one lock order in this crate.
        let _gate = self.gate.write().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut slots = self.lock();
        let removed: Vec<DeviceId> = slots
            .assigned
            .keys()
            .copied()
            .filter(|id| !devices.contains(*id))
            .collect();
        for id in removed {
            if let Some(slot) = slots.assigned.remove(&id) {
                if slots.leases.get(&slot).copied().unwrap_or(0) > 0 {
                    slots.pending_free.insert(slot);
                } else {
                    slots.free.insert(slot);
                }
            }
        }
        slots.current = Arc::new(devices);
    }

    /// The set the door currently serves, as a short-lived `Arc`. Cloned
    /// under the lock and released before any I/O.
    pub(crate) fn current(&self) -> Arc<Devices> {
        Arc::clone(&self.lock().current)
    }

    /// Whether the set still holds this device — the revocation check an
    /// in-flight exchange makes between relay steps.
    pub(crate) fn holds(&self, device: DeviceId) -> bool {
        self.lock().current.contains(device)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Slots> {
        self.slots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// A device's slot, held for as long as the request that took it. Dropping
/// the lease, at any return or unwind, releases the slot: straight to `free`
/// if the device is still held, or out of `pending_free` if its device was
/// revoked while the request was in flight.
pub(crate) struct SlotLease<'a> {
    set: &'a DeviceSet,
    device: DeviceId,
    slot: u32,
}

impl SlotLease<'_> {
    pub(crate) fn slot(&self) -> u32 {
        self.slot
    }

    /// Whether the device is still in the set. Re-checked before the
    /// upstream write: a swap can revoke a device between authentication and
    /// the write, and a revoked device must not forward its slot. The lease
    /// has kept that slot out of `free` the whole time, so even a write that
    /// races this check cannot land on a slot another device has taken.
    pub(crate) fn holds(&self) -> bool {
        self.set.holds(self.device)
    }
}

impl Drop for SlotLease<'_> {
    fn drop(&mut self) {
        let mut slots = self.set.lock();
        let Some(count) = slots.leases.get_mut(&self.slot) else {
            return;
        };
        *count -= 1;
        if *count > 0 {
            return;
        }
        slots.leases.remove(&self.slot);
        if slots.pending_free.remove(&self.slot) {
            slots.free.insert(self.slot);
        }
    }
}
