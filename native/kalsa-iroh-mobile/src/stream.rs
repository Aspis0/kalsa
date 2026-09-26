//! One open tunnel: blocking byte moves over brain's async stream, under
//! this side's own deadlines. The halves are split (`tokio::io::split`,
//! a `BiLock` per direction) so a parked read never holds back a write
//! and neither half waits on the other's mutex; shutdown latches through
//! a watch channel and cancels parked calls without touching any mutex.

use std::sync::Arc;
use std::time::Duration;

use kalsa_iroh::TunnelStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt, ReadHalf, WriteHalf};
use tokio::sync::{watch, Mutex};

use crate::error::IrohMobileError;
use crate::runtime::{require_plain_thread, SharedRuntime};

/// One read's allocation ceiling at the FFI edge; a bigger ask is a
/// caller bug, not a heap bomb to grant.
const MAX_READ_BYTES: u32 = 16 * 1024 * 1024;

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
            }),
        }
    }
}

fn validate(max: u32, timeout_ms: u32) -> Result<(), IrohMobileError> {
    if max == 0 || max > MAX_READ_BYTES {
        return Err(IrohMobileError::Config {
            detail: format!("read max must be 1..={MAX_READ_BYTES} bytes"),
        });
    }
    if timeout_ms == 0 {
        return Err(IrohMobileError::Config {
            detail: "timeout must be at least 1 ms".to_string(),
        });
    }
    Ok(())
}

#[uniffi::export]
impl Tunnel {
    /// Write every byte, flushed before returning, under this call's own
    /// deadline — nothing on this side waits on the peer's goodwill.
    /// A write that times out closes the tunnel: the stream's state
    /// after a partial write is not knowable.
    pub fn write(&self, bytes: Vec<u8>, timeout_ms: u32) -> Result<(), IrohMobileError> {
        validate(bytes.len() as u32, timeout_ms)?;
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
                        // Latch closed: the half-written stream must not be reused.
                        let _ = inner.shutdown.send(true);
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
        validate(max, timeout_ms)?;
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
        let inner = Arc::clone(&self.inner);
        self.inner.runtime.spawn(async move {
            let mut write = inner.write.lock().await;
            let _ = write.shutdown().await;
        });
    }
}
