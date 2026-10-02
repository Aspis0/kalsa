//! How long the door waits for the engine, and for a client waiting for a
//! worker. One place for the numbers, each with its reason.
//!
//! A chat completion on a slow computer is a prefill of minutes (read in
//! batches, the engine reporting between them when asked) and then tokens at
//! a few a second, so the door cannot tell "slow" from "gone" by a short
//! timeout. It tells them apart by silence: an answer ends when the engine
//! has said nothing at all for `completion_idle`, or at `completion_ceiling`
//! whatever it is saying.
//!
//! The clocks belong to a door, not to the process: a test that shrinks them
//! gives its own door a [`Clocks`] and no other door sees it.

use std::time::Duration;

/// The longest a completion's answer may run, counted from the moment a worker
/// takes the request up (queueing is bounded on its own, see `queue_wait`).
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

/// How long a room turn may wait for a seat at the engine before it ends
/// and says so. A house this busy will not free one soon, and a call that
/// waits forever is a lie the Room keeps on screen. The room turn driver
/// reads it (see `room::turn`).
pub(crate) const SEAT_WAIT: Duration = Duration::from_secs(120);

/// The limits one door applies. `Default` is the product's; a test builds its
/// own door with shorter ones.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Clocks {
    /// The wake-up interval of a read of the engine.
    pub(crate) patience: Duration,
    pub(crate) completion_ceiling: Duration,
    pub(crate) completion_idle: Duration,
    pub(crate) queue_wait: Duration,
    pub(crate) detached_grace: Duration,
    pub(crate) seat_wait: Duration,
}

impl Default for Clocks {
    fn default() -> Self {
        Self {
            patience: crate::PATIENCE,
            completion_ceiling: COMPLETION_CEILING,
            completion_idle: COMPLETION_IDLE,
            queue_wait: QUEUE_WAIT,
            detached_grace: DETACHED_GRACE,
            seat_wait: SEAT_WAIT,
        }
    }
}

#[cfg(test)]
impl Clocks {
    pub(crate) fn patience(mut self, value: Duration) -> Self {
        self.patience = value;
        self
    }
    pub(crate) fn idle(mut self, value: Duration) -> Self {
        self.completion_idle = value;
        self
    }
    pub(crate) fn ceiling(mut self, value: Duration) -> Self {
        self.completion_ceiling = value;
        self
    }
    pub(crate) fn queue_wait(mut self, value: Duration) -> Self {
        self.queue_wait = value;
        self
    }
    pub(crate) fn detached(mut self, value: Duration) -> Self {
        self.detached_grace = value;
        self
    }
    pub(crate) fn seat_wait(mut self, value: Duration) -> Self {
        self.seat_wait = value;
        self
    }
}
