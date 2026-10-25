//! Pumping bytes between two full-duplex sides until one closes.
//!
//! This is the tunnel's engine and it is deliberately iroh-free: it moves
//! bytes between anything that reads and writes, so it can be tested
//! without a network.
//!
//! The two directions are not symmetric, because the two sides are not. `a`
//! is the phone, `b` is the door, and after a request is sent the phone is
//! *silent by protocol*: with keep-alive it does not even close its write
//! side — it simply has nothing to say until the answer comes. Silence on
//! the request direction is therefore not death, and the answer may take
//! many idle periods to begin (a prefill is a machine thinking, not a peer
//! gone). What actually ends a tunnel whose peer died is never a deadline
//! on the response: the phone's death breaks its transport (reads and
//! writes start failing), and the door's own patience and connection
//! lifetime close the door side of the tunnel. The deadlines here bound
//! what those two guarantees leave open:
//!
//! * the request direction is judged by one shared clock — the moment a
//!   byte last moved, in either direction — and its firing *ends that
//!   direction only*: a tunnel whose phone went quiet stops being read,
//!   while an answer already in flight is delivered whole. The shared
//!   clock is what makes keep-alive work: a response streaming slower
//!   than `idle` keeps moving it, and the phone's next request on the
//!   same tunnel is still read;
//! * the response direction is bounded until it produces its first byte —
//!   in production that ceiling is four minutes of total silence, and the
//!   door's own five-minute connection lifetime closes the stream moments
//!   later regardless — and never bounded again: from the first byte on,
//!   a slow answer and a long one all arrive;
//! * writes keep a hard deadline in both directions, on purpose: a write
//!   that cannot complete means the receiving transport is gone — nothing
//!   "thinks" on a write, so there is no quiet-but-alive case to protect.
//!
//! Half-close is honored: an end-of-stream shuts the other direction's
//! writer so the far side sees a clean half-close. An error in either
//! direction tears the whole pump: half a tunnel serves nobody.

use std::io;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::time::timeout;

/// The read buffer, matched to the door's relay buffer.
const BUFFER: usize = 16 * 1024;

/// Before the response produces its first byte, the shared-silence bound is
/// multiplied by this. As a product decision, stated in the numbers it
/// produces: with the production idle of 30 s, a thinking door gets **four
/// minutes** to its first token, and a tunnel silent that long is torn down
/// by us rather than by the door's own five-minute connection lifetime
/// closing it moments later. The form is a multiplier, not an imported
/// constant, so this crate stays door-free and the bound scales with the
/// idle every test drives; the invariant to re-check when either number
/// changes is `idle × 8 < the door's connection lifetime`.
const OPENING_PATIENCE_MULTIPLIER: u32 = 8;

/// The tunnel's one clock: the instant a byte last moved, in either
/// direction. A deadline pinned to one direction alone cannot tell a phone
/// that is quiet because it is waiting from a phone that is gone — the
/// tunnel as a whole can: a byte either way is life; total silence is not.
struct Clock {
    idle: Duration,
    last_byte: Mutex<Instant>,
    /// Set once the response direction has produced a byte.
    answered: AtomicBool,
}

impl Clock {
    fn new(idle: Duration) -> Self {
        Self {
            idle,
            last_byte: Mutex::new(Instant::now()),
            answered: AtomicBool::new(false),
        }
    }

    fn touch(&self) {
        if let Ok(mut last_byte) = self.last_byte.lock() {
            *last_byte = Instant::now();
        }
    }

    fn quiet_for(&self) -> Duration {
        self.last_byte
            .lock()
            .map(|last_byte| last_byte.elapsed())
            .unwrap_or(Duration::ZERO)
    }

    fn mark_answered(&self) {
        self.answered.store(true, Ordering::Relaxed);
    }

    fn answered(&self) -> bool {
        self.answered.load(Ordering::Relaxed)
    }
}

/// Which side of the tunnel a relay carries. The request direction (phone
/// to door) is the one whose silence is bounded; the response direction is
/// bounded only until it starts producing.
#[derive(Clone, Copy)]
enum Direction {
    Request,
    Response,
}

/// Move bytes between `a` (the phone) and `b` (the door) in both directions
/// until both ends close. See the module: the request direction's silence
/// ends that direction, the response direction is never cut once it has
/// begun, and an error in either tears the pump.
/// Returns when the response has been delivered in full — the success case
/// even if the request direction is still winding down on its keep-alive
/// bound — or when that delivery failed.
pub(crate) async fn pump<A, B>(a: A, b: B, idle: Duration) -> io::Result<()>
where
    A: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    B: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (a_read, a_write) = tokio::io::split(a);
    let (b_read, b_write) = tokio::io::split(b);
    let clock = Arc::new(Clock::new(idle));
    let mut down_task = tokio::spawn(relay(a_read, b_write, clock.clone(), Direction::Request));
    let mut up_task = tokio::spawn(relay(b_read, a_write, clock.clone(), Direction::Response));
    // The request direction may end two ways and neither touches the
    // response: a clean end (the request fully sent) and its own silence
    // past the shared bound both leave an answer already being produced
    // exactly where it belongs — in flight. The response runs to its own
    // end: bounded until its first byte, unbounded after. Only the
    // response's own failure tears the request direction down.
    // The request direction's own end — clean, timed out, or errored —
    // does not change the verdict once the response is delivered, but the
    // task is still observed: a panic in it must not be silent.
    let _down = (&mut down_task)
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::Interrupted, "pump task lost"))?;
    let up = (&mut up_task)
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::Interrupted, "pump task lost"))?;
    match up {
        // Delivered in full: the phone going quiet afterwards — past the
        // keep-alive bound, by closing, by leaving — is the normal end of
        // an exchange, not a failure, and is reported as the success it
        // was.
        Ok(()) => Ok(()),
        Err(error) => {
            // The answer was not delivered: the request direction has
            // nobody left to serve.
            down_task.abort();
            Err(error)
        }
    }
}

/// One direction: read from `src`, write to `dst`, until end-of-stream (the
/// writer is shut down so the far side sees a clean half-close) or an I/O
/// error.
async fn relay<R, W>(
    mut src: ReadHalf<R>,
    mut dst: WriteHalf<W>,
    clock: Arc<Clock>,
    direction: Direction,
) -> io::Result<()>
where
    R: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    W: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let mut buffer = vec![0u8; BUFFER];
    loop {
        let read = match read_bound(&clock, direction) {
            Some(bound) => read_bounded(&mut src, &mut buffer, &clock, bound).await?,
            None => {
                let read = src
                    .read(&mut buffer)
                    .await
                    .map_err(|e| io::Error::new(e.kind(), "tunnel read"))?;
                if read > 0 {
                    clock.touch();
                }
                read
            }
        };
        if read == 0 {
            return dst.shutdown().await;
        }
        if let Direction::Response = direction {
            clock.mark_answered();
        }
        // The write side gets the same hard patience in both directions: a
        // write that cannot complete means the receiving transport is gone.
        timeout(clock.idle, dst.write_all(&buffer[..read]))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "tunnel idle deadline"))?
            .map_err(|e| io::Error::new(e.kind(), "tunnel write"))?;
        clock.touch();
    }
}

/// The read bound for one direction, from the shared clock. The request
/// direction may go quiet for `idle` — measured against the tunnel's last
/// byte of either kind, so an answer being produced keeps the phone's
/// silence honest. The response direction is patient until its first byte
/// and unbounded after: cutting a producing exchange is never ours.
fn read_bound(clock: &Clock, direction: Direction) -> Option<Duration> {
    match direction {
        Direction::Request => Some(clock.idle),
        // Until the answer starts: four production minutes, per the
        // multiplier above. From the first byte on: nothing of ours.
        Direction::Response if clock.answered() => None,
        Direction::Response => Some(clock.idle * OPENING_PATIENCE_MULTIPLIER),
    }
}

/// A read under a silence bound measured on the shared clock. When the
/// other direction moves a byte, the clock moves and this read simply keeps
/// waiting; when the bound passes with no byte either way, the direction
/// ends with `TimedOut`.
async fn read_bounded<R>(
    src: &mut R,
    buffer: &mut [u8],
    clock: &Clock,
    bound: Duration,
) -> io::Result<usize>
where
    R: AsyncRead + Unpin,
{
    loop {
        let Some(remaining) = bound.checked_sub(clock.quiet_for()) else {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "tunnel idle deadline",
            ));
        };
        let sleep = tokio::time::sleep(remaining);
        tokio::pin!(sleep);
        tokio::select! {
            read = src.read(buffer) => {
                let read = read.map_err(|e| io::Error::new(e.kind(), "tunnel read"))?;
                if read > 0 {
                    clock.touch();
                }
                return Ok(read);
            }
            _ = &mut sleep => {}
        }
    }
}
#[cfg(test)]
mod tests;
