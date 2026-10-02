//! How long the door waits for the engine, and for a client waiting for a
//! worker. One place for the numbers, each with its reason, and one test seam
//! for all of them.
//!
//! A chat completion on a slow computer is a prefill of minutes (read in
//! batches, the engine reporting between them when asked) and then tokens at
//! a few a second, so the door cannot tell "slow" from "gone" by a short
//! timeout. It tells them apart by silence: an answer ends when the engine
//! has said nothing at all for [`completion_idle`], or at [`completion_ceiling`]
//! whatever it is saying.

#[cfg(test)]
use std::sync::atomic::AtomicU64;
use std::time::Duration;

/// The longest a completion's answer may run, counted from the moment a worker
/// takes the request up (queueing is bounded on its own, see [`queue_wait`]).
/// Thirty minutes holds 5,000 tokens at the catalog's ~3 tok/s floor and still
/// frees a worker and a seat from a generation that runs away. Every request
/// that reaches the answer is already authenticated and leased; the ceiling
/// goes to those whose path is a completion, for any paired device.
const COMPLETION_CEILING: Duration = Duration::from_secs(30 * 60);

/// How long a completion may go with no byte at all from the engine. One
/// 2,048-token prefill batch at ~7 tok/s (the slowest worth waiting for) is
/// ~290 s, and the engine reports between batches when the client asks, so
/// ten minutes is two such batches with room to spare, and a hung engine is
/// let go long before the ceiling.
const COMPLETION_IDLE: Duration = Duration::from_secs(10 * 60);

/// How long a connection may wait in the queue for a worker before it is
/// answered busy. With answers that can last half an hour, a queue without a
/// bound would leave a client hanging for that long.
const QUEUE_WAIT: Duration = Duration::from_secs(20);

/// How long a running answer may go with no client attached and nobody
/// resuming it before it is cancelled. A phone that drops off for a moment
/// comes back inside this and finds its answer; a desktop that pressed Stop
/// (it just closes the connection) does not hold a worker, the device's seat
/// and the engine's slot until the ceiling.
const DETACHED_GRACE: Duration = Duration::from_secs(2 * 60);

#[cfg(test)]
static PATIENCE_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static IDLE_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static CEILING_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static QUEUE_WAIT_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static DETACHED_MS: AtomicU64 = AtomicU64::new(0);

/// The wake-up interval of a read of the engine.
pub(crate) fn patience() -> Duration {
    #[cfg(test)]
    if let Some(over) = overridden(&PATIENCE_MS) {
        return over;
    }
    crate::PATIENCE
}

pub(crate) fn completion_ceiling() -> Duration {
    #[cfg(test)]
    if let Some(over) = overridden(&CEILING_MS) {
        return over;
    }
    COMPLETION_CEILING
}

pub(crate) fn completion_idle() -> Duration {
    #[cfg(test)]
    if let Some(over) = overridden(&IDLE_MS) {
        return over;
    }
    COMPLETION_IDLE
}

pub(crate) fn queue_wait() -> Duration {
    #[cfg(test)]
    if let Some(over) = overridden(&QUEUE_WAIT_MS) {
        return over;
    }
    QUEUE_WAIT
}

pub(crate) fn detached_grace() -> Duration {
    #[cfg(test)]
    if let Some(over) = overridden(&DETACHED_MS) {
        return over;
    }
    DETACHED_GRACE
}

#[cfg(test)]
fn overridden(cell: &AtomicU64) -> Option<Duration> {
    let millis = cell.load(std::sync::atomic::Ordering::SeqCst);
    (millis > 0).then(|| Duration::from_millis(millis))
}

#[cfg(test)]
static SEAM: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Holds the clock overrides for one test. They are process-wide, so the tests
/// that set any take turns, and every override is cleared however the test
/// ends.
#[cfg(test)]
pub(crate) struct Clocks(std::sync::MutexGuard<'static, ()>);

#[cfg(test)]
pub(crate) fn clocks() -> Clocks {
    Clocks(SEAM.lock().unwrap_or_else(|e| e.into_inner()))
}

#[cfg(test)]
impl Clocks {
    fn set(self, cell: &AtomicU64, value: Duration) -> Self {
        cell.store(value.as_millis() as u64, std::sync::atomic::Ordering::SeqCst);
        self
    }
    pub(crate) fn patience(self, value: Duration) -> Self {
        self.set(&PATIENCE_MS, value)
    }
    pub(crate) fn idle(self, value: Duration) -> Self {
        self.set(&IDLE_MS, value)
    }
    pub(crate) fn ceiling(self, value: Duration) -> Self {
        self.set(&CEILING_MS, value)
    }
    pub(crate) fn queue_wait(self, value: Duration) -> Self {
        self.set(&QUEUE_WAIT_MS, value)
    }
    pub(crate) fn detached(self, value: Duration) -> Self {
        self.set(&DETACHED_MS, value)
    }
}

#[cfg(test)]
impl Drop for Clocks {
    fn drop(&mut self) {
        for cell in [&PATIENCE_MS, &IDLE_MS, &CEILING_MS, &QUEUE_WAIT_MS, &DETACHED_MS] {
            cell.store(0, std::sync::atomic::Ordering::SeqCst);
        }
    }
}
