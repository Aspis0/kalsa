//! Pumping bytes between two full-duplex sides until one closes.
//!
//! This is the tunnel's engine and it is deliberately iroh-free: it moves
//! bytes between anything that reads and writes, so it can be tested
//! without a network. The rule it exists for comes from measurements on a
//! spike: when the far side dies mid-stream, its reads do not fail, they
//! *hang* — iroh blocks silently for 12 seconds and more. So every read
//! here runs under [`crate`]'s idle deadline: a side that stays silent for
//! `idle` kills the pump, and the tunnel closes instead of freezing.
//!
//! Half-close is honored: when one direction reaches end-of-stream, the
//! other direction's writer is shut down (an upstream that finished reading
//! the request sees the response end normally), but the remaining direction
//! keeps pumping — this is what lets a single tunneled HTTP connection do
//! keep-alive.

use std::io;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::time::timeout;

/// The read buffer, matched to the door's relay buffer.
const BUFFER: usize = 16 * 1024;

/// Move bytes between `a` and `b` in both directions until both ends close
/// or one side goes silent past `idle`. The first direction that fails or
/// times out tears the whole pump down.
pub(crate) async fn pump<A, B>(a: A, b: B, idle: Duration) -> io::Result<()>
where
    A: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    B: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let (a_read, a_write) = tokio::io::split(a);
    let (b_read, b_write) = tokio::io::split(b);
    let down = tokio::spawn(relay(a_read, b_write, idle));
    let up = tokio::spawn(relay(b_read, a_write, idle));
    let down = down
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::Interrupted, "pump task lost"))?;
    let up = match &down {
        Err(_) => {
            // The first direction to die kills the second instead of
            // letting it linger out its own idle timeout.
            up.abort();
            Err(io::Error::new(io::ErrorKind::Interrupted, "pump torn down"))
        }
        Ok(()) => up
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::Interrupted, "pump task lost"))?,
    };
    down.and(up)
}

/// One direction: read from `src`, write to `dst`, until end-of-stream (the
/// writer is shut down so the far side sees a clean half-close), an I/O
/// error, or `idle` seconds of silence.
async fn relay<R, W>(mut src: ReadHalf<R>, mut dst: WriteHalf<W>, idle: Duration) -> io::Result<()>
where
    R: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    W: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let mut buffer = vec![0u8; BUFFER];
    loop {
        let read = timeout(idle, src.read(&mut buffer))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "tunnel idle deadline"))?
            .map_err(|e| io::Error::new(e.kind(), "tunnel read"))?;
        if read == 0 {
            return dst.shutdown().await;
        }
        // The write side gets the same total patience as the read it is
        // serving: a peer that stopped ACKing must not wedge the pump.
        timeout(idle, dst.write_all(&buffer[..read]))
            .await
            .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "tunnel idle deadline"))?
            .map_err(|e| io::Error::new(e.kind(), "tunnel write"))?;
    }
}

#[cfg(test)]
mod tests;
