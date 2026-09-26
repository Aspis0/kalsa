//! The FFI-side runtime: one multi-thread tokio runtime shared by the
//! bridge and every tunnel, the rule that parked calls happen on plain
//! threads only, and the drop guard for the runtime's last reference.
//! All three exist for the same reason: tokio panics when misused from
//! an async context, and a panic at the FFI edge is the one thing this
//! crate must not do.

use std::sync::Arc;

use tokio::runtime::{Handle, Runtime};

use crate::error::IrohMobileError;

pub(crate) fn require_plain_thread() -> Result<(), IrohMobileError> {
    if Handle::try_current().is_ok() {
        Err(IrohMobileError::AsyncContext)
    } else {
        Ok(())
    }
}

/// `Arc<Runtime>` whose last reference never dies on an async thread:
/// a runtime dropped there is a panic in tokio (its shutdown blocks).
#[derive(Clone)]
pub(crate) struct SharedRuntime {
    runtime: Option<Arc<Runtime>>,
}

impl SharedRuntime {
    pub(crate) fn new(runtime: Runtime) -> Self {
        Self {
            runtime: Some(Arc::new(runtime)),
        }
    }

    pub(crate) fn block_on<F: std::future::Future>(&self, future: F) -> F::Output {
        self.runtime.as_ref().expect("live SharedRuntime").block_on(future)
    }

    pub(crate) fn spawn(&self, task: impl std::future::Future<Output = ()> + Send + 'static) {
        self.runtime.as_ref().expect("live SharedRuntime").spawn(task);
    }
}

impl Drop for SharedRuntime {
    fn drop(&mut self) {
        let Some(runtime) = self.runtime.take() else {
            return;
        };
        if Arc::strong_count(&runtime) == 1 && Handle::try_current().is_ok() {
            // Async thread holding the last reference: hand the runtime
            // to a plain thread so its blocking shutdown panics nowhere.
            // Any other case drops it right here, which is fine.
            std::thread::spawn(move || drop(runtime));
        }
    }
}
