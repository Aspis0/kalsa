//! The FFI-side runtime: one multi-thread tokio runtime shared by the
//! bridge and every tunnel, the rule that parked calls happen on plain
//! threads only, and the shutdown of the runtime's single owner. All
//! three exist for the same reason: tokio panics when misused from an
//! async context, and a panic at the FFI edge is the one thing this
//! crate must not do.

use std::sync::Arc;
use std::time::Duration;

use tokio::runtime::{Handle, Runtime};

use crate::error::IrohMobileError;

/// The runtime's shutdown bound: a parked task that never wakes must not
/// turn disposal into a hang, on any thread.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) fn require_plain_thread() -> Result<(), IrohMobileError> {
    if Handle::try_current().is_ok() {
        Err(IrohMobileError::AsyncContext)
    } else {
        Ok(())
    }
}

/// The runtime's one owner. `Arc` guarantees `Drop` runs exactly once, on
/// whichever thread releases the last reference — so this is the only
/// place the runtime dies, and there is no count-check race to lose: on
/// an async thread the runtime moves to a dedicated thread first, because
/// dropping it there is a panic in tokio (its shutdown blocks).
struct RuntimeOwner {
    runtime: Option<Runtime>,
}

impl Drop for RuntimeOwner {
    fn drop(&mut self) {
        let Some(runtime) = self.runtime.take() else {
            return;
        };
        if Handle::try_current().is_ok() {
            std::thread::spawn(move || runtime.shutdown_timeout(SHUTDOWN_TIMEOUT));
        } else {
            runtime.shutdown_timeout(SHUTDOWN_TIMEOUT);
        }
    }
}

#[derive(Clone)]
pub(crate) struct SharedRuntime {
    owner: Arc<RuntimeOwner>,
}

impl SharedRuntime {
    pub(crate) fn new(runtime: Runtime) -> Self {
        Self {
            owner: Arc::new(RuntimeOwner {
                runtime: Some(runtime),
            }),
        }
    }

    // Only RuntimeOwner::drop takes the runtime; while any SharedRuntime
    // clone lives, the owner lives and the runtime is present.
    fn runtime(&self) -> &Runtime {
        self.owner.runtime.as_ref().expect("runtime present while shared")
    }

    pub(crate) fn block_on<F: std::future::Future>(&self, future: F) -> F::Output {
        self.runtime().block_on(future)
    }

    pub(crate) fn spawn(&self, task: impl std::future::Future<Output = ()> + Send + 'static) {
        self.runtime().spawn(task);
    }
}
