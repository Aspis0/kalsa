//! One open tunnel: blocking byte moves over brain's async stream, under
//! this side's own deadlines. The halves are split (`tokio::io::split`,
//! a `BiLock` per direction) so a parked read never holds back a write
//! and neither half waits on the other's mutex; shutdown latches through
//! a watch channel and cancels parked calls without touching any mutex.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use kalsa_iroh::TunnelStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::sync::{watch, Mutex};

use crate::error::IrohMobileError;
use crate::runtime::{require_plain_thread, SharedRuntime};

/// One call's byte ceiling at the FFI edge; a bigger ask is a caller
/// bug, not a heap bomb to grant.
const MAX_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;

#[derive(uniffi::Object)]
pub struct Tunnel {
    inner: Arc<Inner>,
}

struct Inner {
    read: Mutex<ReadHalf<TunnelStream>>,
    write: Mutex<WriteHalf<TunnelStream>>,
    // Shared with MobileBridge so the tunnel can outlive it: a runtime
    // dropped under a parked block_on is a panic or a hang, never an error.
    runtime: SharedRuntime,
    shutdown: watch::Sender<bool>,
    // Keeps the watch channel open between calls: a watch channel with no
    // receiver is closed forever, and a closed channel drops every latch.
    _shutdown_guard: watch::Receiver<bool>,
    // True while a read holds the read half awaiting bytes; a test probe.
    read_held: AtomicBool,
}

impl Tunnel {
    pub(crate) fn new(stream: TunnelStream, runtime: SharedRuntime) -> Self {
        let (read, write) = tokio::io::split(stream);
        let (shutdown, _shutdown_guard) = watch::channel(false);
        Self {
            inner: Arc::new(Inner {
                read: Mutex::new(read),
                write: Mutex::new(write),
                runtime,
                shutdown,
                _shutdown_guard,
                read_held: AtomicBool::new(false),
            }),
        }
    }
}

/// Clears the read-held mark on any exit, cancellation included: a read
/// that times out or is shut down mid-await must not leave the probe
/// stuck at true.
struct ReadHeld<'a>(&'a AtomicBool);

impl Drop for ReadHeld<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

fn validate(payload: usize, timeout_ms: u32) -> Result<(), IrohMobileError> {
    if payload == 0 || payload > MAX_PAYLOAD_BYTES {
        return Err(IrohMobileError::Config {
            detail: format!("payload must be 1..={MAX_PAYLOAD_BYTES} bytes"),
        });
    }
    if timeout_ms == 0 {
        return Err(IrohMobileError::Config {
            detail: "timeout must be at least 1 ms".to_string(),
        });
    }
    Ok(())
}

/// Half-close the transport off the caller's thread: the peer gets its
/// FIN and the stream's resources are released. Waits for no mutex; the
/// in-flight call it races keeps its own deadline.
fn close_write_half(inner: &Arc<Inner>) {
    let runtime = inner.runtime.clone();
    let inner = Arc::clone(inner);
    runtime.spawn(async move {
        let mut write = inner.write.lock().await;
        let _ = write.shutdown().await;
    });
}

#[uniffi::export]
impl Tunnel {
    /// Write every byte, flushed before returning, under this call's own
    /// deadline — nothing on this side waits on the peer's goodwill.
    /// A write that times out closes the tunnel for real — the peer gets
    /// a FIN, not silence — because a half-written stream is not reusable.
    pub fn write(&self, bytes: Vec<u8>, timeout_ms: u32) -> Result<(), IrohMobileError> {
        validate(bytes.len(), timeout_ms)?;
        require_plain_thread()?;
        let runtime = self.inner.runtime.clone();
        let inner = Arc::clone(&self.inner);
        runtime.block_on(async move {
            let mut shutdown = inner.shutdown.subscribe();
            if *shutdown.borrow() {
                return Err(IrohMobileError::Closed);
            }
            tokio::select! {
                biased;
                _ = shutdown.changed() => Err(IrohMobileError::Closed),
                outcome = tokio::time::timeout(Duration::from_millis(timeout_ms as u64), async {
                    let mut stream = inner.write.lock().await;
                    stream.write_all(&bytes).await?;
                    stream.flush().await
                }) => match outcome {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(e)) => Err(IrohMobileError::from(e)),
                    Err(_) => {
                        // Latch closed, then really close: the write half
                        // sends its FIN from the runtime, not this thread.
                        let _ = inner.shutdown.send(true);
                        close_write_half(&inner);
                        Err(IrohMobileError::Deadline)
                    }
                },
            }
        })
    }

    /// One read of at most `max` bytes under this call's own deadline; an
    /// empty return is EOF. A single call returns whatever arrived, so
    /// callers loop until empty — that is what keeps a streamed SSE body
    /// incremental. Shutdown, or the bridge's drop closing the endpoint,
    /// cancels a parked read and answers `Closed`.
    pub fn read(&self, max: u32, timeout_ms: u32) -> Result<Vec<u8>, IrohMobileError> {
        validate(max as usize, timeout_ms)?;
        require_plain_thread()?;
        let runtime = self.inner.runtime.clone();
        let inner = Arc::clone(&self.inner);
        runtime.block_on(async move {
            let mut shutdown = inner.shutdown.subscribe();
            if *shutdown.borrow() {
                return Err(IrohMobileError::Closed);
            }
            tokio::select! {
                biased;
                _ = shutdown.changed() => Err(IrohMobileError::Closed),
                outcome = tokio::time::timeout(
                    Duration::from_millis(timeout_ms as u64),
                    async {
                        let mut stream = inner.read.lock().await;
                        let _held = {
                            inner.read_held.store(true, Ordering::Release);
                            ReadHeld(&inner.read_held)
                        };
                        let mut buffer = vec![0u8; max as usize];
                        let n = stream.read(&mut buffer).await?;
                        buffer.truncate(n);
                        Ok::<Vec<u8>, std::io::Error>(buffer)
                    },
                ) => match outcome {
                    Ok(Ok(bytes)) => Ok(bytes),
                    Ok(Err(e)) => Err(IrohMobileError::from(e)),
                    Err(_) => Err(IrohMobileError::Deadline),
                },
            }
        })
    }

    /// Half-close the write side: the peer sees an ending, not a reset.
    /// Cancels parked reads and writes (they answer `Closed`) without
    /// waiting for them, and is idempotent.
    pub fn shutdown(&self) {
        let _ = self.inner.shutdown.send(true);
        close_write_half(&self.inner);
    }
}

/// The test rig's window into the tunnel: a read holds the read half and
/// is awaiting bytes. Production builds never see it.
#[cfg(feature = "test-support")]
impl Tunnel {
    #[doc(hidden)]
    pub fn read_held(&self) -> bool {
        self.inner.read_held.load(Ordering::Acquire)
    }
}
