//! The single-instance guard: an exclusive lock on the app's own data
//! directory — the authority — plus the loopback knock that lets a second
//! launch bring the first window forward — the convenience.
//!
//! The credential store assumes a single writing process — every write is
//! read-modify-write, so two apps over one file do not merely tear a
//! publication, they can lose a device. This guard makes the assumption
//! true, and the store it protects is one user's file in one user's data
//! directory, so the lock that guards it lives there too: an exclusive
//! non-blocking `flock` on a file beside the store, taken inside the app
//! setup, held for the app's whole life. The lock is kernel state on the
//! open file description, so the kernel gives it back on every process
//! death, `kill -9` included — measured on this Mac: a second process is
//! refused with `EAGAIN` while the holder lives, and the instant the
//! holder is killed the lock is acquirable again, though the file it went
//! through is still on disk. A leftover file means nothing, so nothing
//! stale can lock the owner out of their own app; and because the lock
//! covers one account's data directory, a second macOS account runs its
//! own copy against its own store without contention. And the lock must
//! never be inherited by a spawned child — this app is not a leaf process,
//! it spawns a llama-server that can outlive a crash, and a surviving
//! child holding the lock's descriptor would keep the flock alive after
//! the app's own death, locking the owner out of their own app with
//! nothing stale to delete — so the lock file is opened close-on-exec,
//! pinned by test. On Windows the same
//! shape is `LockFileEx` with `LOCKFILE_FAIL_IMMEDIATELY`; the measured
//! claims above were measured on macOS.
//!
//! The fixed loopback port is no longer the authority. The first launch to
//! bind it watches it; a later launch fails to bind, knocks — a bare
//! connect, loopback, carrying nothing — and the watcher brings the
//! window forward. The knock cannot say who answered, and the binder
//! cannot tell the running app from a stranger on the port, which is
//! exactly why the port decides nothing: losing the bind must cost this
//! launch nothing but the ability to be knocked, and the directory lock
//! alone decides whether it may run at all.

use std::fs::{File, OpenOptions};
use std::io;
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// Fixed, beside the door's preferred port, and derived from nothing that
/// is bound later in startup.
const GUARD_PORT: u16 = 8132;
/// How often the knock watcher re-checks its stop flag between knocks.
const WATCH_POLL: Duration = Duration::from_millis(100);
/// The lock file, beside the credential store in the app data directory.
/// Its presence on disk means nothing; the lock is kernel state on the
/// open file, and the file is only the handle the lock hangs on.
const LOCK_FILE: &str = "instance.lock";

/// Why the directory lock could not be taken.
#[derive(Debug)]
pub(crate) enum LockFailure {
    /// A live instance of this app holds the lock. The one refusal, and
    /// not a malfunction.
    AlreadyRunning,
    /// The lock file could not be opened, or the lock could not be taken
    /// for any other reason: the machine failing under the app.
    Io(io::Error),
}

impl std::fmt::Display for LockFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRunning => write!(
                f,
                "another Kalsa Brain instance already owns this account's credential store"
            ),
            Self::Io(error) => write!(f, "the instance lock could not be taken: {error}"),
        }
    }
}

impl std::error::Error for LockFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::AlreadyRunning => None,
        }
    }
}

/// Claims what can be claimed before the app exists: the knock port. The
/// caller keeps the [`Guard`] for as long as the app runs; the watcher
/// inside it lives no longer. Losing the port is not losing the launch —
/// the loser knocks and goes on, and the directory lock, taken later
/// where the data directory is knowable, alone decides who runs.
pub(crate) fn claim() -> Guard {
    claim_on(GUARD_PORT)
}

fn claim_on(port: u16) -> Guard {
    match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
        Ok(listener) => Guard {
            listener: Some(listener),
            stop: Arc::new(AtomicBool::new(false)),
            watcher: Mutex::new(None),
        },
        Err(_) => {
            // The port is held. If something answers on it, that is the
            // running instance — a knock is how this process asks it to
            // come forward. If nothing answers, the port is held by
            // something that is not this app; a connect on loopback
            // cannot tell the two apart, and neither can this process.
            // Either way the knock is the whole of what this launch does
            // about the port: it binds nothing and refuses itself
            // nothing — that verdict belongs to the directory lock.
            if let Ok(stream) = TcpStream::connect((Ipv4Addr::LOCALHOST, port)) {
                let _ = stream.shutdown(Shutdown::Both);
            }
            Guard::deaf()
        }
    }
}

/// Takes the authority: an exclusive, non-blocking lock on a file in
/// `dir` — the app data directory, beside the credential store. The
/// caller must keep the returned lock for the app's whole life; managed
/// app state does that. Dropping it, or the death of the process in any
/// way at all, gives it back.
pub(crate) fn acquire_dir_lock(dir: &Path) -> Result<DirLock, LockFailure> {
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .open(dir.join(LOCK_FILE))
        .map_err(LockFailure::Io)?;
    match try_lock_exclusive(&file) {
        Ok(()) => Ok(DirLock { _file: file }),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            Err(LockFailure::AlreadyRunning)
        }
        Err(error) => Err(LockFailure::Io(error)),
    }
}

/// The exclusive lock, without waiting. Non-blocking is the whole point:
/// a second launch must be told no at once, not queued behind the first.
#[cfg(unix)]
fn try_lock_exclusive(file: &File) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let status = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if status == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// The Windows analogue of the `flock` above. The behaviour of this call
/// has not been measured on this Mac, which has no Windows to measure it
/// with; the module doc's measured claims are the macOS ones.
#[cfg(windows)]
fn try_lock_exclusive(file: &File) -> io::Result<()> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::OVERLAPPED;
    use windows_sys::Win32::Storage::FileSystem::{
        LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
    };
    let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
    let locked = unsafe {
        LockFileEx(
            file.as_raw_handle(),
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            1,
            0,
            &mut overlapped,
        )
    };
    if locked != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// The held authority. No `Drop` is needed: the lock lives on the open
/// file description, so closing the file — by drop, or by the death of
/// the process, any death — releases it. The file is left behind on disk
/// and is inert.
#[derive(Debug)]
pub(crate) struct DirLock {
    _file: File,
}

/// The held knock port, if this process won it. A `listener` of `None`
/// means somebody else holds the port — the running instance or a
/// stranger; this process cannot tell which — and so this process can
/// knock but not listen.
#[derive(Debug)]
pub(crate) struct Guard {
    listener: Option<TcpListener>,
    stop: Arc<AtomicBool>,
    watcher: Mutex<Option<JoinHandle<()>>>,
}

impl Guard {
    /// A guard with no port: this process lost the bind and starts
    /// nothing to watch it.
    fn deaf() -> Guard {
        Guard {
            listener: None,
            stop: Arc::new(AtomicBool::new(false)),
            watcher: Mutex::new(None),
        }
    }

    /// Starts watching for knocks. A guard with no port has nothing to
    /// watch — knocks are not addressed to this process — so it starts
    /// no thread.
    pub(crate) fn watch(&self, on_knock: impl Fn() + Send + 'static) {
        let listener = match self.listener.as_ref() {
            Some(listener) => listener,
            None => return,
        };
        let listener = match listener.try_clone() {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("kalsa brain: the instance guard cannot watch for knocks: {error}");
                return;
            }
        };
        let stop = Arc::clone(&self.stop);
        let handle = std::thread::Builder::new()
            .name("kalsa-instance-guard".into())
            .spawn(move || {
                let _ = listener.set_nonblocking(true);
                while !stop.load(Ordering::SeqCst) {
                    match listener.accept() {
                        // A connect from loopback is the whole message.
                        Ok((stream, _)) => {
                            drop(stream);
                            on_knock();
                        }
                        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                            std::thread::sleep(WATCH_POLL);
                        }
                        Err(_) => return,
                    }
                }
            })
            .ok();
        *self
            .watcher
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = handle;
    }
}

impl Drop for Guard {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(handle) = self
            .watcher
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            let _ = handle.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A fixed test port, beside the production one. The guard tests share
    /// it and must not race each other for it.
    const TEST_PORT: u16 = GUARD_PORT + 1;
    /// Marks the spawned child process of the port kill-9 test.
    const CHILD_ENV: &str = "KALSA_INSTANCE_GUARD_CHILD";
    /// Names the lock directory to the spawned child of the lock kill-9
    /// test.
    const LOCK_DIR_ENV: &str = "KALSA_INSTANCE_LOCK_DIR";

    /// One harness for the whole module: the tests share the test port,
    /// and — the subtler reason — a test that spawns its kill-9 child
    /// forks this whole process, and between fork and exec the child
    /// holds every open file description, including another test's
    /// directory lock. The tests must not race each other for either.
    fn test_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A fresh directory to lock, one per test, so no two runs of the
    /// suite contend for each other's file.
    fn lock_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-instance-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("the test lock directory is created");
        dir
    }

    #[test]
    fn a_second_claim_binds_nothing_and_the_first_receives_the_knock() {
        let _lock = test_lock();
        let (announce, knock) = std::sync::mpsc::channel();
        let guard = claim_on(TEST_PORT);
        assert!(guard.listener.is_some(), "the first claim wins the port");
        guard.watch(move || {
            let _ = announce.send(());
        });

        // The second attempt binds nothing — and refuses itself nothing:
        // the port is not the authority. It knocks and goes on.
        let second = claim_on(TEST_PORT);
        assert!(second.listener.is_none(), "the second claim binds nothing");
        knock
            .recv_timeout(Duration::from_secs(2))
            .expect("the knock reached the running instance");
    }

    /// The child of the port kill-9 test: it claims the port and waits to
    /// be killed. In an ordinary run the environment is absent and this
    /// test is a no-op.
    #[test]
    fn the_child_holds_the_guard_until_it_is_killed() {
        if std::env::var(CHILD_ENV).is_err() {
            return;
        }
        let _guard = claim_on(TEST_PORT);
        std::thread::sleep(Duration::from_secs(120));
    }

    /// The property a lockfile cannot give: the hard kill — SIGKILL on
    /// unix, TerminateProcess on Windows — takes the guard with it, so a
    /// crashed app can never lock the owner out of their own app. The
    /// child is this same test binary, re-invoked on the one test that
    /// holds the guard and waits; the parent kills it mid-hold and claims.
    #[test]
    fn a_killed_process_releases_the_guard() {
        let _lock = test_lock();
        let exe = std::env::current_exe().expect("this test binary");
        let mut child = std::process::Command::new(exe)
            .args(["instance::tests::the_child_holds_the_guard_until_it_is_killed", "--exact"])
            .env(CHILD_ENV, "1")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("the child test process spawns");

        // Wait until the child actually holds the port.
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while TcpStream::connect((Ipv4Addr::LOCALHOST, TEST_PORT)).is_err() {
            assert!(
                std::time::Instant::now() < deadline,
                "the child never claimed the guard"
            );
            std::thread::sleep(Duration::from_millis(20));
        }

        // The hard kill, mid-hold.
        child.kill().expect("the child is killed");
        let _ = child.wait();

        // The kernel gave the socket back: the port is claimable again.
        let guard = claim_on(TEST_PORT);
        assert!(guard.listener.is_some(), "a killed process must not keep holding the guard");
        drop(guard);
    }

    /// The measured failure of the old guard, kept as a refusal: a
    /// stranger holding the port once ended the launch before it began.
    /// The port is convenience now — losing it must cost this claim
    /// nothing but the knock service, and the stranger must still receive
    /// the knock, unable to tell who knocked.
    #[test]
    fn a_stranger_on_the_port_cannot_stop_the_claim() {
        let _lock = test_lock();
        let stranger = TcpListener::bind((Ipv4Addr::LOCALHOST, TEST_PORT))
            .expect("the stranger takes the port");
        stranger
            .set_nonblocking(true)
            .expect("the stranger listens without blocking");

        let guard = claim_on(TEST_PORT);
        assert!(
            guard.listener.is_none(),
            "the claim lost the port to the stranger"
        );
        // And the claim — so the launch — goes on regardless.

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        loop {
            match stranger.accept() {
                Ok((_, _)) => break,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    assert!(
                        std::time::Instant::now() < deadline,
                        "the knock reached nobody"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("the stranger's listener failed: {error}"),
            }
        }
    }

    /// The authority refuses a second taker and gives the first back on
    /// drop — in one process, where the two locks are two open file
    /// descriptions and so two contenders.
    #[test]
    fn a_second_lock_on_the_same_directory_is_refused_until_the_first_is_dropped() {
        let _lock = test_lock();
        let dir = lock_dir("refused");
        let first = acquire_dir_lock(&dir).expect("the first lock is taken");
        assert!(
            matches!(acquire_dir_lock(&dir), Err(LockFailure::AlreadyRunning)),
            "a second exclusive lock on the same directory is refused"
        );
        drop(first);

        // The file is still on disk. It means nothing: the lock lived on
        // the open file, and that is closed now.
        assert!(dir.join(LOCK_FILE).exists(), "the lock file is left behind");
        let second = acquire_dir_lock(&dir).expect("the dropped lock leaves the way open");
        drop(second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The child of the lock kill-9 test: it takes the lock on the
    /// directory named in the environment and waits to be killed. In an
    /// ordinary run the environment is absent and this test is a no-op.
    #[test]
    fn the_child_holds_the_directory_lock_until_it_is_killed() {
        let Ok(dir) = std::env::var(LOCK_DIR_ENV) else {
            return;
        };
        let dir = PathBuf::from(dir);
        let _lock = acquire_dir_lock(&dir).expect("the child takes the lock");
        std::fs::write(dir.join("held"), b"").expect("the child marks its hold");
        std::thread::sleep(Duration::from_secs(120));
    }

    /// The property the module doc claims, in the case that matters — two
    /// processes, not two claims in one: a live rival is refused, and the
    /// hard kill gives the lock back at once though the file it went
    /// through is still on disk. The child is this same test binary,
    /// re-invoked on the one test that holds the lock and waits.
    #[test]
    fn a_killed_process_releases_the_directory_lock() {
        let _lock = test_lock();
        let dir = lock_dir("killed");
        let exe = std::env::current_exe().expect("this test binary");
        let mut child = std::process::Command::new(exe)
            .args([
                "instance::tests::the_child_holds_the_directory_lock_until_it_is_killed",
                "--exact",
            ])
            .env(LOCK_DIR_ENV, &dir)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("the child test process spawns");

        // Wait until the child actually holds the lock.
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while !dir.join("held").exists() {
            assert!(
                std::time::Instant::now() < deadline,
                "the child never claimed the lock"
            );
            std::thread::sleep(Duration::from_millis(20));
        }

        // A live rival, in another process, is refused.
        assert!(
            matches!(acquire_dir_lock(&dir), Err(LockFailure::AlreadyRunning)),
            "a second process is refused the lock"
        );

        // The hard kill, mid-hold.
        child.kill().expect("the child is killed");
        let _ = child.wait();

        // The kernel gave the lock back: the file is still there and
        // means nothing, and the lock is claimable again at once.
        assert!(dir.join(LOCK_FILE).exists(), "the lock file is left behind");
        let lock =
            acquire_dir_lock(&dir).expect("a killed process must not keep holding the lock");
        drop(lock);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The lock descriptor must not survive into a spawned child: this app
    /// spawns a llama-server that can outlive a crash, and a child left
    /// holding the lock's descriptor keeps the flock — and so the owner's
    /// lockout — alive after the app is gone. Rust opens files
    /// close-on-exec; this test pins that, so a regression turns red.
    #[cfg(unix)]
    #[test]
    fn the_lock_descriptor_is_not_inherited_by_spawned_children() {
        use std::os::unix::io::AsRawFd;
        let dir = lock_dir("cloexec");
        let lock = acquire_dir_lock(&dir).expect("the lock is taken");
        let flags = unsafe { libc::fcntl(lock._file.as_raw_fd(), libc::F_GETFD) };
        assert!(flags >= 0, "F_GETFD failed on the lock descriptor");
        assert!(
            flags & libc::FD_CLOEXEC != 0,
            "the lock descriptor would be inherited by a spawned child"
        );
        drop(lock);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
