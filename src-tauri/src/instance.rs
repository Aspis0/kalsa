//! The single-instance guard: one fixed loopback port, held for the app's
//! lifetime.
//!
//! The credential store assumes a single writing process — every write is
//! read-modify-write, so two apps over one file do not merely tear a
//! publication, they can lose a device. This guard makes the assumption
//! true, and its mechanism survives the way a lockfile does not: a socket
//! is owned by the kernel, so it is given back on every process death,
//! `kill -9` included. There is no file to go stale and lock the owner out
//! of their own app.
//!
//! A second instance binds nothing and starts nothing: it knocks on the
//! port, and the running app — which watches the port — brings its window
//! forward. The knock carries no data; the port is loopback, so a connect
//! is a local process saying "I meant you", and that is all it can say.

use std::io;
use std::net::{Ipv4Addr, Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// Fixed, beside the door's preferred port, and derived from nothing that
/// is bound later in startup.
const GUARD_PORT: u16 = 8132;
/// How often the knock watcher re-checks its stop flag between knocks.
const WATCH_POLL: Duration = Duration::from_millis(100);

/// Why a claim failed. There is exactly one way: another instance holds
/// the guard, and has been knocked.
#[derive(Debug)]
pub(crate) struct AlreadyRunning;

/// Claims the single-instance guard. The caller keeps the [`Guard`] for as
/// long as the app runs; dropping it releases the port.
pub(crate) fn claim() -> Result<Guard, AlreadyRunning> {
    claim_on(GUARD_PORT)
}

fn claim_on(port: u16) -> Result<Guard, AlreadyRunning> {
    match TcpListener::bind((Ipv4Addr::LOCALHOST, port)) {
        Ok(listener) => Ok(Guard {
            listener,
            stop: Arc::new(AtomicBool::new(false)),
            watcher: Mutex::new(None),
        }),
        Err(_) => {
            // The port is held. If something answers on it, that is the
            // running instance — a knock is how this process asks it to
            // come forward. If nothing answers, the port is held by
            // something that is not this app; either way, becoming a
            // second writer is the one outcome this module exists to
            // prevent, so the answer is no.
            if let Ok(stream) = TcpStream::connect((Ipv4Addr::LOCALHOST, port)) {
                let _ = stream.shutdown(Shutdown::Both);
            }
            Err(AlreadyRunning)
        }
    }
}

/// The held guard. Dropping it stops the knock watcher and releases the
/// port — which the kernel would also do after any process death.
pub(crate) struct Guard {
    listener: TcpListener,
    stop: Arc<AtomicBool>,
    watcher: Mutex<Option<JoinHandle<()>>>,
}

impl Guard {
    /// Starts watching for knocks. `on_knock` runs on the watcher thread
    /// once per knock; the shell uses it to bring its window forward.
    pub(crate) fn watch(&self, on_knock: impl Fn() + Send + 'static) {
        let listener = match self.listener.try_clone() {
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

    /// A fixed test port, beside the production one. The guard tests share
    /// it and must not race each other for it.
    const TEST_PORT: u16 = GUARD_PORT + 1;
    /// Marks the spawned child process of the kill-9 test.
    const CHILD_ENV: &str = "KALSA_INSTANCE_GUARD_CHILD";

    fn port_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: Mutex<()> = Mutex::new(());
        LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn a_second_claim_is_refused_and_the_first_receives_the_knock() {
        let _lock = port_lock();
        let (announce, knock) = std::sync::mpsc::channel();
        let guard = claim_on(TEST_PORT).expect("the first instance claims the guard");
        guard.watch(move || {
            let _ = announce.send(());
        });

        // The second attempt binds nothing: it is refused, after knocking.
        assert!(matches!(claim_on(TEST_PORT), Err(AlreadyRunning)));
        knock
            .recv_timeout(Duration::from_secs(2))
            .expect("the knock reached the running instance");
    }

    /// The child of the kill-9 test: it claims the guard and waits to be
    /// killed. In an ordinary run the environment is absent and this test
    /// is a no-op.
    #[test]
    fn the_child_holds_the_guard_until_it_is_killed() {
        if std::env::var(CHILD_ENV).is_err() {
            return;
        }
        let _guard = claim_on(TEST_PORT).expect("the child claims the guard");
        std::thread::sleep(Duration::from_secs(120));
    }

    /// The property a lockfile cannot give: the hard kill — SIGKILL on
    /// unix, TerminateProcess on Windows — takes the guard with it, so a
    /// crashed app can never lock the owner out of their own app. The
    /// child is this same test binary, re-invoked on the one test that
    /// holds the guard and waits; the parent kills it mid-hold and claims.
    #[test]
    fn a_killed_process_releases_the_guard() {
        let _lock = port_lock();
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
        let guard = claim_on(TEST_PORT).expect("a killed process must not keep holding the guard");
        drop(guard);
    }
}
