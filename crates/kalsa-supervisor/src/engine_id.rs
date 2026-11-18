//! The identity of the engine process an exit may still have to kill.
//!
//! The identity is held ONLY while a signal through it can reach no process
//! but the engine: the pid of our own child that has not been reaped (unix
//! does not recycle a child's pid until its parent reaps it), or — on
//! Windows, where a pid is recyclable the moment the process object's last
//! handle closes — a `PROCESS_TERMINATE` handle opened at the spawn, which
//! names that one process object for as long as we hold it. A pid that
//! could name a stranger is never held: a reaped child's, or an adopted
//! engine's, whose only voucher is a state file a previous run wrote and
//! whose pid may have been recycled by the time an exit fires.

use std::sync::atomic::{AtomicU32, Ordering};
#[cfg(windows)]
use std::sync::Mutex;
use std::time::Duration;

use crate::child::Termination;
#[cfg(unix)]
use crate::child::terminate_pid;

/// 0 is this crate's marker for "nothing ours to signal".
const NONE: u32 = 0;

/// The engine identity, published at the spawn and cleared wherever the
/// engine is proven gone or its pid stops being ours alone.
pub(crate) struct EngineId {
    pid: AtomicU32,
    /// The spawn's own handle to the process object, held so the pid cannot
    /// be recycled under it: `TerminateProcess` through this handle reaches
    /// the engine or fails because the engine is already gone — never a
    /// process that inherited the pid after our engine died.
    #[cfg(windows)]
    handle: Mutex<Option<Handle>>,
}

impl EngineId {
    pub(crate) fn new() -> Self {
        Self {
            pid: AtomicU32::new(NONE),
            #[cfg(windows)]
            handle: Mutex::new(None),
        }
    }

    /// The pid of the engine whose going is still unproven, held from the
    /// spawn until the reap. `None` when no kill through this identity is
    /// safe — which is also when none is owed.
    pub(crate) fn pid(&self) -> Option<u32> {
        match self.pid.load(Ordering::SeqCst) {
            NONE => None,
            pid => Some(pid),
        }
    }

    /// Publishes the spawned child's identity. Called the moment the child
    /// exists, before any readiness wait: an exit that lands while the
    /// engine is still starting must already find it.
    pub(crate) fn publish(&self, pid: u32) {
        self.pid.store(pid, Ordering::SeqCst);
        #[cfg(windows)]
        {
            let mut held = self.handle.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            *held = Handle::open(pid);
        }
    }

    /// Clears the identity: the engine is proven gone, or its pid has
    /// stopped being ours alone (reaped, adopted, never started).
    pub(crate) fn clear(&self) {
        self.pid.store(NONE, Ordering::SeqCst);
        #[cfg(windows)]
        {
            let mut held = self.handle.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            *held = None;
        }
    }

    /// The last-resort kill, through the held identity only: `None` when
    /// nothing is held (the common exit — nothing to kill, nothing said),
    /// otherwise the walk's verdict. On unix the signal goes by pid, safe
    /// exactly because the identity is held only while the child is
    /// unreaped; on Windows it goes through the handle.
    pub(crate) fn kill(&self, grace: Duration) -> Option<Termination> {
        let pid = self.pid()?;
        Some(self.signal(pid, grace))
    }

    #[cfg(unix)]
    fn signal(&self, pid: u32, grace: Duration) -> Termination {
        terminate_pid(pid, grace)
    }

    #[cfg(windows)]
    fn signal(&self, pid: u32, grace: Duration) -> Termination {
        let held = self
            .handle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(handle) = held.as_ref() else {
            return Termination::Unknown {
                detail: format!("pid {pid}: no process handle was held from the spawn"),
            };
        };
        handle.terminate(pid, grace)
    }
}

/// One `PROCESS_TERMINATE` handle to the engine process, closed when it is
/// replaced or cleared.
#[cfg(windows)]
struct Handle(windows_sys::Win32::Foundation::HANDLE);

/// A raw handle is a bare pointer, and a bare pointer makes no promise
/// about threads — but this one is an owned reference to a kernel process
/// object whose only uses (terminate, wait, close) are thread-agnostic
/// calls on the object, never reads of shared memory.
#[cfg(windows)]
unsafe impl Send for Handle {}

#[cfg(windows)]
impl Handle {
    /// Opens the process by the pid the spawn just returned. Between the
    /// spawn and this open the child's own handle (inside the standard
    /// library's child) already keeps the pid from being recycled, so the
    /// handle names our child and nobody else.
    fn open(pid: u32) -> Option<Self> {
        use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_TERMINATE};
        let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
        (!handle.is_null()).then_some(Self(handle))
    }

    /// Terminates through the held handle and waits one `grace` for the
    /// object to signal. A `TerminateProcess` that itself failed is not
    /// read as "already gone": the failure's own words are the verdict.
    fn terminate(&self, pid: u32, grace: Duration) -> Termination {
        use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
        use windows_sys::Win32::System::Threading::{TerminateProcess, WaitForSingleObject};
        if unsafe { TerminateProcess(self.0, 1) } == 0 {
            return Termination::Unknown {
                detail: format!(
                    "TerminateProcess on the held handle: {}",
                    std::io::Error::last_os_error()
                ),
            };
        }
        let waited = unsafe { WaitForSingleObject(self.0, grace.as_millis() as u32) };
        if waited == WAIT_OBJECT_0 {
            Termination::Gone {
                needed: crate::child::Step::Kill,
            }
        } else {
            Termination::Survived {
                pid,
                detail: "no exit signal within the grace after TerminateProcess".to_string(),
            }
        }
    }
}

#[cfg(windows)]
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { windows_sys::Win32::Foundation::CloseHandle(self.0) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh identity holds nothing: the common exit kills nothing and
    /// says nothing.
    #[test]
    fn a_fresh_identity_kills_nothing() {
        let id = EngineId::new();
        assert_eq!(id.pid(), None, "nothing was ever published");
        assert_eq!(id.kill(Duration::from_millis(10)), None, "no kill was owed");
    }

    /// A published identity answers with the pid and is spent when cleared:
    /// clearing is the whole difference between the engine's pid and a pid
    /// that may already belong to somebody else.
    #[test]
    fn a_cleared_identity_answers_with_nothing() {
        let id = EngineId::new();
        id.publish(4242);
        assert_eq!(id.pid(), Some(4242), "the published pid");
        id.clear();
        assert_eq!(id.pid(), None, "a cleared identity names no process");
        assert_eq!(id.kill(Duration::from_millis(10)), None);
    }

    /// The kill reaches the published process. A child of ours killed by
    /// pid leaves a zombie only its holder can reap, so the walk cannot
    /// observe it gone by pid alone — the verdict is that honest pessimism,
    /// and the reap this test holds is the proof the signal landed.
    #[cfg(unix)]
    #[test]
    fn the_kill_reaches_the_published_process() {
        let mut stand_in = std::process::Command::new("/bin/sleep")
            .arg("30")
            .spawn()
            .expect("spawn the stand-in");
        let id = EngineId::new();
        id.publish(stand_in.id());
        let report = id.kill(Duration::from_millis(150)).expect("a kill was owed");
        assert!(
            matches!(report, Termination::Survived { .. }),
            "an unreaped zombie cannot be observed gone by pid: {report:?}"
        );
        let reaped = stand_in
            .try_wait()
            .expect("the stand-in can always be reaped by its holder");
        assert!(reaped.is_some(), "the signal reached the published process");
    }
}
