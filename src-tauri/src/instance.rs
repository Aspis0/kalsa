//! The single-instance guard: an exclusive lock on the app's own data
//! directory — the authority — plus the loopback knock that lets a second
//! launch bring the first window forward — the convenience.
//!
//! The credential store assumes a single writing process — every write is
//! read-modify-write, so two apps over one file do not merely tear a
//! publication, they can lose a device. This guard makes the assumption
//! true, and the store it protects is one user's file in one user's data
//! directory, so the lock that guards it lives there too: an exclusive
//! non-blocking `flock` on the data directory's own descriptor, taken
//! inside the app setup, held for the app's whole life — measured on this
//! Mac: a second process is refused with `EAGAIN` while the holder lives,
//! and the instant the holder dies, `kill -9` included, the lock is
//! acquirable again. The lock hangs on the directory itself, not on a
//! file inside it — an earlier file-based lock was defeated by deleting
//! that file while the app ran, which left the next launch to lock a
//! fresh inode unopposed — so there is nothing inside the directory that
//! deleting can turn into a second lock. The remaining hole, said
//! plainly: deleting or replacing the whole data directory while the app
//! runs defeats this lock too — but that act destroys the store as well,
//! so there is nothing left to protect. And because the lock covers one
//! account's data directory, a second macOS account runs its own copy
//! against its own store without contention. The lock must also never be
//! inherited by a spawned child: this app is not a leaf process — it
//! spawns a llama-server that can outlive a crash — and a surviving child
//! holding the lock's descriptor would keep the flock alive after the
//! app's own death, locking the owner out of their own app with nothing
//! stale to delete. The descriptor is opened close-on-exec, pinned by
//! test. The flock claims above were measured on macOS, and that paragraph
//! is macOS's mechanism. Windows has none of it — `CreateFileW` refuses a
//! plain directory open, and `LockFileEx` refuses a directory handle
//! outright with `ERROR_INVALID_PARAMETER`, measured on the first Windows
//! build — so the authority there is a lock file inside this same
//! directory, opened with `share_mode(0)`: while the handle is held no
//! other process can open it for read, write, or delete access, nor delete
//! or rename it. A second open fails with `ERROR_SHARING_VIOLATION` and —
//! once a bounded retry (~1 s in 50 ms steps) has ridden over a scanner
//! that was holding the file for a moment — reads as `AlreadyRunning`; the
//! kernel closes the handle when the process dies, whatever killed it, so
//! the next launch opens the same file again — the empty file itself stays
//! behind, and it is not the lock. The old objection to file locks does
//! not carry: the file that was once deleted out from under the lock
//! cannot be deleted or renamed while this handle is open — measured by
//! test — and what cannot be deleted cannot be defeated. The code leans on
//! one assumption: the directory is the per-user app data directory,
//! writable by its owner and not by other accounts. Within it, one
//! residual stays, said plainly: any process with write access to the
//! directory can open the file first in the same exclusive mode and hold
//! it, making this app refuse to start — the same power that access
//! already has over the store itself, which it can delete; a scanner
//! passing through holds it only for a moment, and the retry above rides
//! that moment over. The
//! handle is not inheritable (std opens non-inheritable on Windows),
//! pinned by test, so the llama-server this app spawns cannot carry the
//! lock past this app's death. The same `instance::tests` run against
//! both mechanisms.
//!
//! The fixed loopback port is no longer the authority. The first launch
//! to bind it watches it; a later launch fails to bind, knocks — a bare
//! connect with a short timeout, loopback, carrying nothing — and the
//! watcher brings the window forward. A knock is a courtesy: if it cannot
//! be delivered promptly it is abandoned, never waited on. The knock
//! cannot say who answered, and the binder cannot tell the running app
//! from a stranger on the port, which is exactly why the port decides
//! nothing: losing the bind must cost this launch nothing but the ability
//! to be knocked, and the directory lock alone decides whether it may run
//! at all.

use std::fs::File;
use std::io;
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// Fixed, beside the door's preferred port, and derived from nothing that
/// is bound later in startup. `pub(crate)` for the shell's port-census
/// test, which keeps this app's fixed loopback ports apart.
pub(crate) const GUARD_PORT: u16 = 8132;
/// How long a knock may take to connect before it is abandoned. The only
/// case this fires in is a holder whose accept queue is full — a squatter,
/// or a watcher dead at its post — and no launch should hang on that
/// before any window exists.
const KNOCK_TIMEOUT: Duration = Duration::from_millis(300);

/// Why the directory lock could not be taken.
#[derive(Debug)]
pub(crate) enum LockFailure {
    /// A live instance of this app holds the lock — or, on Windows, any
    /// other process holding the lock file, which the module doc declares
    /// as the residual it is. The one refusal, and not a malfunction.
    AlreadyRunning,
    /// The lock could not be taken — the directory (unix) or the lock file
    /// inside it (Windows) could not be opened — or it failed for any
    /// other reason: the machine failing under the app. Carries the
    /// directory, because the owner is told this text and deserves to
    /// know where the app was reaching.
    Io {
        path: PathBuf,
        source: io::Error,
    },
}

impl std::fmt::Display for LockFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRunning => write!(
                f,
                "another Kalsa instance already owns this account's credential store"
            ),
            Self::Io { path, source } => write!(
                f,
                "the instance lock on {} could not be taken: {source}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for LockFailure {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
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
            // The connect is timed: a holder that never accepts — a
            // squatter, or a watcher dead at its post — fills its queue
            // and then silently drops new connections, and without a
            // deadline the launch would hang here in the dark. A knock is
            // a courtesy; it is abandoned, never waited on.
            let _ = TcpStream::connect_timeout(&knock_addr(port), KNOCK_TIMEOUT);
            Guard::deaf()
        }
    }
}

/// The address a knock is sent to.
fn knock_addr(port: u16) -> SocketAddr {
    SocketAddr::from((Ipv4Addr::LOCALHOST, port))
}

/// Takes the authority: an exclusive, non-blocking lock on `dir` itself,
/// never a file inside it, so there is nothing in the directory that
/// deleting can turn into a second lock. The caller must keep the returned
/// lock for the app's whole life; managed app state does that. Dropping
/// it, or the death of the process in any way at all, gives it back. The
/// two mechanisms are the module doc's two paragraphs.
#[cfg(unix)]
pub(crate) fn acquire_dir_lock(dir: &Path) -> Result<DirLock, LockFailure> {
    let opened = File::open(dir).map_err(|source| LockFailure::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    match try_lock_exclusive(&opened) {
        Ok(()) => Ok(DirLock { _dir: opened }),
        Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
            Err(LockFailure::AlreadyRunning)
        }
        Err(error) => Err(LockFailure::Io {
            path: dir.to_path_buf(),
            source: error,
        }),
    }
}

/// The exclusive lock, without waiting. Non-blocking is the whole point:
/// a second launch must be told no at once, not queued behind the first.
#[cfg(unix)]
fn try_lock_exclusive(opened: &File) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let status = unsafe { libc::flock(opened.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) };
    if status == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// The Windows authority: a lock file inside `dir`, opened with
/// `share_mode(0)` — while the handle is held, no other process can open
/// the file for read, write, or delete access, nor delete or rename it,
/// which is the answer to the unix side's reason for locking the
/// directory (a file lock once defeated by deleting the file). A second
/// open fails with `ERROR_SHARING_VIOLATION` — the same refusal as the
/// flock's `EAGAIN` once the bounded retry below has ridden over a
/// transient holder. `CreateFileW` refuses a plain directory open and
/// `LockFileEx` refuses a directory handle outright
/// (`ERROR_INVALID_PARAMETER`, both measured); the sharing mode needs
/// neither.
#[cfg(windows)]
pub(crate) fn acquire_dir_lock(dir: &Path) -> Result<DirLock, LockFailure> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Foundation::ERROR_SHARING_VIOLATION;
    let path = dir.join(LOCK_FILE_NAME);
    // Create if missing, never truncate: the body is not the lock, and a
    // leftover empty file from a crash opens as cleanly as no file.
    //
    // WHY the retry, and why these numbers: the lock file persists between
    // launches, so a scanner/indexer/backup can be holding it for a moment
    // exactly when Kalsa launches — one sharing violation then would have
    // main tell the owner "already running" about a process that is not
    // Kalsa at all. Fifty milliseconds is the chosen retry step, amply
    // longer than a transient open/close pair; twenty steps budget one
    // second of sleeps, to which the opens and the scheduling around them
    // add, so a real second launch still hears "already running" without a
    // noticeable pause. A live Kalsa holds the file for its whole life and
    // rejects all twenty-one attempts — the guarantee is unchanged, only
    // the momentary holder is ridden over.
    const RETRY_STEP: Duration = Duration::from_millis(50);
    const RETRY_STEPS: u32 = 20;
    let mut retries = 0u32;
    loop {
        match std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .share_mode(0)
            .open(&path)
        {
            Ok(file) => return Ok(DirLock { _lock: file }),
            Err(error) if error.raw_os_error() == Some(ERROR_SHARING_VIOLATION as i32) => {
                if retries >= RETRY_STEPS {
                    return Err(LockFailure::AlreadyRunning);
                }
                retries += 1;
                std::thread::sleep(RETRY_STEP);
            }
            Err(source) => {
                return Err(LockFailure::Io {
                    path: dir.to_path_buf(),
                    source,
                })
            }
        }
    }
}

/// The lock file the Windows authority holds. Its name is ours and lives
/// in a directory that is ours; nothing else can open it for read, write,
/// or delete while it is held, which is the whole mechanism.
#[cfg(windows)]
const LOCK_FILE_NAME: &str = "kalsa-instance.lock";

/// The held authority. On unix no `Drop` is needed: the lock lives on the
/// open file description — the open directory — so closing it, by drop or
/// by the death of the process in any way at all, releases it, and nothing
/// was created on disk to carry it. On Windows the authority IS the lock
/// file's handle: closing it, by drop or by process death, lifts the
/// sharing mode that was the lock; the empty file left behind is not the
/// lock and opens cleanly next time.
#[derive(Debug)]
pub(crate) struct DirLock {
    #[cfg(unix)]
    _dir: File,
    /// The lock file, held open with `share_mode(0)`.
    #[cfg(windows)]
    _lock: File,
}

/// The held knock port, if this process won it. A `listener` of `None`
/// means somebody else holds the port — the running instance or a
/// stranger; this process cannot tell which — and so this process can
/// knock but not listen.
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
                while !stop.load(Ordering::SeqCst) {
                    match listener.accept() {
                        // A connect from loopback is the whole message.
                        Ok((stream, _)) => {
                            drop(stream);
                            if stop.load(Ordering::SeqCst) {
                                return;
                            }
                            on_knock();
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
        if let Some(listener) = self.listener.as_ref() {
            if let Ok(address) = listener.local_addr() {
                let _ = TcpStream::connect_timeout(&address, KNOCK_TIMEOUT);
            }
        }
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
    /// suite contend for each other's directory.
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

        // Wait until the child actually holds the port. The connect is
        // timed: the child accepts nothing, so once its backlog fills, a
        // timeout-less connect would hang here well past this loop's own
        // deadline.
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            match TcpStream::connect_timeout(&knock_addr(TEST_PORT), KNOCK_TIMEOUT) {
                Ok(_) => break,
                // Refused (not bound yet) or timed out (backlog full):
                // either way the child may still be starting. Poll on.
                Err(_) => {}
            }
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
    /// drop — in one process, where the two locks are two opens of one
    /// target and so two contenders.
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

        // On unix the guard left nothing behind inside the directory: the
        // lock hangs on the directory's own descriptor, so there is no file
        // whose deletion can turn into a second lock. Windows' authority IS
        // a file in the directory, so this claim is scoped to unix; Windows
        // gets the stronger one instead — its lock file cannot be deleted
        // or renamed while held (the test beside this one).
        #[cfg(unix)]
        {
            let left_behind = std::fs::read_dir(&dir)
                .expect("the locked directory reads")
                .count();
            assert_eq!(left_behind, 0, "the guard created nothing in the directory");
        }
        let second = acquire_dir_lock(&dir).expect("the dropped lock leaves the way open");
        drop(second);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The Windows answer to the unix side's reason for locking the
    /// directory instead of a file: a file lock was once defeated by
    /// deleting the file while the app ran. A file opened with
    /// `share_mode(0)` cannot be deleted or renamed while the handle is
    /// open — both fail here — so deleting it buys nothing, and once the
    /// holder is gone the same path opens again.
    #[cfg(windows)]
    #[test]
    fn the_lock_file_cannot_be_deleted_or_renamed_while_held() {
        let _lock = test_lock();
        let dir = lock_dir("heldfile");
        let held = acquire_dir_lock(&dir).expect("the lock is taken");
        let path = dir.join(LOCK_FILE_NAME);
        assert!(path.exists(), "the lock file is where the authority lives");
        let deleted = std::fs::remove_file(&path);
        assert!(
            deleted.is_err(),
            "the lock file was deleted out from under the holder: {deleted:?}"
        );
        let renamed = std::fs::rename(&path, dir.join("stolen"));
        assert!(
            renamed.is_err(),
            "the lock file was renamed out from under the holder: {renamed:?}"
        );
        drop(held);
        let again = acquire_dir_lock(&dir).expect("once the holder is gone the lock opens again");
        drop(again);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The empty lock file persists between launches, so a scanner can be
    /// holding it for a moment exactly when Kalsa launches. That moment must
    /// not read as a second Kalsa: a holder that lets go within the retry's
    /// bound is passed, and the launch is taken.
    #[cfg(windows)]
    #[test]
    fn a_transient_holder_is_ridden_over_by_the_retry() {
        let _lock = test_lock();
        let dir = lock_dir("transient");
        drop(acquire_dir_lock(&dir).expect("the first launch takes it"));
        let path = dir.join(LOCK_FILE_NAME);
        let (open_tx, open_rx) = std::sync::mpsc::channel();
        let holder = std::thread::spawn(move || {
            let held = std::fs::File::open(&path).expect("the transient open");
            open_tx.send(()).expect("the signal reaches the launch");
            std::thread::sleep(Duration::from_millis(200));
            drop(held);
        });
        open_rx.recv().expect("the transient holder has the file");
        let acquired = acquire_dir_lock(&dir)
            .expect("a holder that lets go within the bound is not a second Kalsa");
        drop(acquired);
        holder.join().expect("the transient holder finishes");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The bound, the other side: a holder that never lets go — a live
    /// Kalsa, or a squatter — is still `AlreadyRunning`, and only after the
    /// one second the retry is allowed. The refusal is unchanged; only its
    /// timing moved.
    #[cfg(windows)]
    #[test]
    fn a_holder_that_never_lets_go_is_still_already_running() {
        let _lock = test_lock();
        let dir = lock_dir("squat");
        drop(acquire_dir_lock(&dir).expect("the first launch takes it"));
        let path = dir.join(LOCK_FILE_NAME);
        let held = std::fs::File::open(&path).expect("the permanent open");
        let started = std::time::Instant::now();
        let result = acquire_dir_lock(&dir);
        let waited = started.elapsed();
        assert!(
            matches!(&result, Err(LockFailure::AlreadyRunning)),
            "a permanent holder is not passed: {result:?}"
        );
        assert!(
            waited >= Duration::from_millis(900),
            "the refusal must spend the retry bound first: {waited:?}"
        );
        drop(held);
        let again = acquire_dir_lock(&dir).expect("the holder is gone");
        drop(again);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A spawned child this test must not outlive: kill and reap on every
    /// exit path, so a panicking assertion cannot leave a 120-second sleeper
    /// behind on the machine.
    #[cfg(windows)]
    struct SpawnedChild(std::process::Child);

    #[cfg(windows)]
    impl Drop for SpawnedChild {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// The Windows twin of the close-on-exec pin: the lock file's handle
    /// must not ride along into a spawned child. The app is not a leaf —
    /// the llama-server it spawns can outlive a crash, and an inherited
    /// handle would keep the file exclusively open, locking the owner out
    /// of their own app with nothing stale to delete. std opens
    /// non-inheritable; this pins it: hold the lock, spawn a child that
    /// lives, drop the app-side handle, and the same path must open again.
    #[cfg(windows)]
    #[test]
    fn the_lock_handle_is_not_inherited_by_spawned_children() {
        let _lock = test_lock();
        let dir = lock_dir("inherit");
        let held = acquire_dir_lock(&dir).expect("the lock is taken");
        let exe = std::env::current_exe().expect("this test binary");
        let child = SpawnedChild(
            std::process::Command::new(exe)
                .args(["instance::tests::the_child_holds_the_guard_until_it_is_killed", "--exact"])
                .env(CHILD_ENV, "1")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .expect("a child spawns while the lock is held"),
        );

        // The child must be up and holding its port before the app-side
        // handle goes: an inherited handle only outlives us in a living
        // child, and a child that never started would prove nothing.
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        loop {
            if TcpStream::connect_timeout(&knock_addr(TEST_PORT), KNOCK_TIMEOUT).is_ok() {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "the child never came up to prove inheritance"
            );
            std::thread::sleep(Duration::from_millis(20));
        }

        drop(held);
        // If the handle had ridden along, the child's copy would still
        // hold the file exclusively open and this could not be taken.
        let reacquired = acquire_dir_lock(&dir)
            .expect("the spawned child must not be holding the lock handle");
        drop(reacquired);
        drop(child);
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
    /// hard kill gives the lock back at once, with no lock state left to
    /// clean up — on unix nothing was ever created, and on Windows the
    /// empty lock file stays behind and is not the lock (this test removes
    /// its own directory, marker and all, at the end). The child is this
    /// same test binary, re-invoked on the one test that holds the lock and
    /// waits.
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

        // The kernel gave the lock back: the lock is claimable again at
        // once, though a child's readiness marker is still in the
        // directory where the lock pays it no attention.
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
        let flags = unsafe { libc::fcntl(lock._dir.as_raw_fd(), libc::F_GETFD) };
        assert!(flags >= 0, "F_GETFD failed on the lock descriptor");
        assert!(
            flags & libc::FD_CLOEXEC != 0,
            "the lock descriptor would be inherited by a spawned child"
        );
        drop(lock);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
