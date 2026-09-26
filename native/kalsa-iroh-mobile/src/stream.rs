//! One open tunnel: blocking byte moves over brain's async stream. The
//! tokio mutex (not std's) keeps a poisoned lock from ever becoming a
//! panic at the FFI edge.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use kalsa_iroh::TunnelStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::runtime::Handle;
use tokio::sync::Mutex;

use crate::error::IrohMobileError;

/// One read's allocation ceiling at the FFI edge; a bigger ask is a
/// caller bug, not a heap bomb to grant.
const MAX_READ_BYTES: u32 = 16 * 1024 * 1024;

#[derive(uniffi::Object)]
pub struct Tunnel {
    inner: Arc<Inner>,
}

struct Inner {
    stream: Mutex<TunnelStream>,
    runtime: Handle,
    closed: AtomicBool,
}

impl Tunnel {
    pub(crate) fn new(stream: TunnelStream, runtime: Handle) -> Self {
        Self {
            inner: Arc::new(Inner {
                stream: Mutex::new(stream),
                runtime,
                closed: AtomicBool::new(false),
            }),
        }
    }
}

#[uniffi::export]
impl Tunnel {
    /// Write every byte, flushed before returning. Bounded by brain's
    /// idle deadline, not by the peer's goodwill.
    pub fn write(&self, bytes: Vec<u8>) -> Result<(), IrohMobileError> {
        let runtime = self.inner.runtime.clone();
        let inner = Arc::clone(&self.inner);
        runtime.block_on(async move {
            if inner.closed.load(Ordering::Acquire) {
                return Err(IrohMobileError::Closed);
            }
            let mut stream = inner.stream.lock().await;
            stream.write_all(&bytes).await?;
            stream.flush().await?;
            Ok(())
        })
    }

    /// One read of at most `max` bytes; an empty return is EOF. A single
    /// call returns whatever arrived, so callers loop until empty — that
    /// is what keeps a streamed SSE body incremental.
    pub fn read(&self, max: u32) -> Result<Vec<u8>, IrohMobileError> {
        if max == 0 || max > MAX_READ_BYTES {
            return Err(IrohMobileError::Config {
                message: format!("read max must be 1..={MAX_READ_BYTES} bytes"),
            });
        }
        let runtime = self.inner.runtime.clone();
        let inner = Arc::clone(&self.inner);
        runtime.block_on(async move {
            if inner.closed.load(Ordering::Acquire) {
                return Err(IrohMobileError::Closed);
            }
            let mut stream = inner.stream.lock().await;
            let mut buffer = vec![0u8; max as usize];
            let n = stream.read(&mut buffer).await?;
            buffer.truncate(n);
            Ok(buffer)
        })
    }

    /// Half-close the write side: the peer sees an ending, not a reset.
    /// Waits out any in-flight read (bounded by the idle deadline), then
    /// marks the tunnel closed — later reads and writes answer `Closed`.
    /// Idempotent; a failing shutdown means the transport is already gone.
    pub fn close(&self) {
        self.inner.closed.store(true, Ordering::Release);
        let runtime = self.inner.runtime.clone();
        let inner = Arc::clone(&self.inner);
        runtime.block_on(async move {
            let mut stream = inner.stream.lock().await;
            let _ = stream.shutdown().await;
        });
    }
}
