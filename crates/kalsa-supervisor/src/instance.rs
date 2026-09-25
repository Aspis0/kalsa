//! The file that says "an instance of ours is here".
//!
//! A pid alone cannot identify our process: the OS recycles pids, and killing a
//! recycled pid means killing somebody else's program — an ollama server, an
//! editor, anything. So the state file is held under an **exclusive lock** for
//! as long as our server runs:
//!
//! * lock held → the writer is alive, so the pid and port inside are ours;
//! * lock free → the writer is gone, whatever the file still says. Stale, and
//!   the pid inside must not be touched.
//!
//! The OS releases the lock when the process dies, including when nothing runs:
//! that is what makes "the lock is free" stronger evidence than "the pid looks
//! alive". No pid arithmetic, no start-time comparison, no process
//! enumeration: the lock is the whole mechanism — std's flock on unix,
//! LockFileEx on Windows.
//!
//! The record is written in the order the facts become known, and the
//! knowable facts come first: port and exact command are recorded by
//! `announce` *before* the child exists, because a writer that dies between
//! the spawn and the pid write leaves a child this record still describes.
//! A file whose writer died mid-sentence can never name a pid — nothing
//! written anywhere else is provably that child's, so a pid found anywhere
//! else is somebody else's — but port and command are known, the lock proves
//! an heir of ours is alive, and the port answers when it is serving. That
//! is enough to reuse, and deliberately not enough to signal.
//!
//! On Windows the lock is one byte past every record (`STATE_LOCK_OFFSET`):
//! std's whole-file lock is mandatory there, so a claim's own lock made
//! `inspect`'s read fail with os error 33 and the app could not read its own
//! live record. A byte at a fixed far offset keeps the content readable and
//! the lock just as real.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const MAGIC: &str = "kalsa-brain v1";

/// The byte Windows locks: half the u64 space, past any record a state file
/// will ever hold — `LockFileEx` locks bytes that do not exist yet. WHY the
/// offset exists: std's whole-file lock is mandatory on Windows, so while a
/// claim held it `inspect`'s `read_to_string` failed with os error 33 and the
/// app could not read its own live record. Content bytes stay readable while
/// this byte is held; std's whole-file lock (offset 0, length u64::MAX) still
/// overlaps it, so a holder the old way still conflicts with the probe.
#[cfg(windows)]
const STATE_LOCK_OFFSET: u64 = 1 << 63;

/// Takes the state lock without waiting: std's flock on unix, the byte at
/// `STATE_LOCK_OFFSET` on Windows. `WouldBlock` means somebody else holds it;
/// anything else is an I/O failure of its own.
fn try_lock_state(file: &File) -> Result<(), std::fs::TryLockError> {
    #[cfg(unix)]
    {
        file.try_lock()
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Foundation::ERROR_LOCK_VIOLATION;
        use windows_sys::Win32::Storage::FileSystem::{
            LockFileEx, LOCKFILE_EXCLUSIVE_LOCK, LOCKFILE_FAIL_IMMEDIATELY,
        };
        use windows_sys::Win32::System::IO::OVERLAPPED;
        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        // windows-sys wraps Offset two anonymous layers deep.
        overlapped.Anonymous.Anonymous.Offset = STATE_LOCK_OFFSET as u32;
        overlapped.Anonymous.Anonymous.OffsetHigh = (STATE_LOCK_OFFSET >> 32) as u32;
        // The offset lives in OVERLAPPED; the length is the two u32s: one
        // byte, exclusive, no waiting.
        let ok = unsafe {
            LockFileEx(
                file.as_raw_handle(),
                LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
                0,
                1,
                0,
                &mut overlapped,
            )
        };
        if ok != 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_LOCK_VIOLATION as i32) {
            Err(std::fs::TryLockError::WouldBlock)
        } else {
            Err(std::fs::TryLockError::Error(error))
        }
    }
}

/// Unlocks the byte [`try_lock_state`] took — the same handle, the same
/// range. Microsoft's guidance is the explicit unlock: relying on the
/// handle's close to release the range can lag past the call that meant
/// to end it; the handle's own close is the backstop.
#[cfg(windows)]
fn unlock_state_byte(file: &File) {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::UnlockFileEx;
    use windows_sys::Win32::System::IO::OVERLAPPED;
    let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
    overlapped.Anonymous.Anonymous.Offset = STATE_LOCK_OFFSET as u32;
    overlapped.Anonymous.Anonymous.OffsetHigh = (STATE_LOCK_OFFSET >> 32) as u32;
    let _ = unsafe { UnlockFileEx(file.as_raw_handle(), 0, 1, 0, &mut overlapped) };
}

/// Takes the state lock on an open handle the way this module does — for the
/// integration tests, which must hold a planted record exactly as an earlier
/// run would: a whole-file std lock on Windows is mandatory and would make
/// that record unreadable (the bug `STATE_LOCK_OFFSET` was introduced for).
pub fn hold_state_lock(file: &File) -> io::Result<()> {
    try_lock_state(file).map_err(|error| match error {
        std::fs::TryLockError::WouldBlock => io::Error::new(
            io::ErrorKind::WouldBlock,
            "another instance already holds the state file",
        ),
        std::fs::TryLockError::Error(e) => e,
    })
}

#[derive(Debug, PartialEq, Eq)]
pub enum Existing {
    /// No state file at all.
    None,
    /// A file is there but nobody holds it: a crashed run, or a pid that has
    /// since been recycled. Nothing in it may be trusted.
    Stale,
    /// Somebody holds the lock: an instance of ours is alive. `binding` is
    /// the exact command it was started with, when the file records one.
    Live {
        pid: u32,
        port: u16,
        binding: Option<String>,
    },
    /// Somebody holds the lock, but the writer died before recording the
    /// pid: a crash between the spawn and the `describe`. The port and the
    /// exact command are known — they were recorded before the child
    /// existed — and the lock proves an heir of ours is alive, but no pid
    /// may be trusted here, so this instance can be reused by port and
    /// health and never signalled.
    Unidentified { port: u16, binding: Option<String> },
}

/// The state file of a running instance. Dropping it without `release` leaves
/// the file behind (a crash), which the next start reads as `Stale`.
pub struct InstanceFile {
    file: File,
    path: PathBuf,
}

impl InstanceFile {
    /// Claims the state file. Fails if another instance holds it.
    ///
    /// The pid is written later, by `describe`: it only exists after the child
    /// has been spawned, and the lock must be held before that — on unix the
    /// child inherits the descriptor, so "the lock is held" outlives this
    /// process while the server lives; on Windows handles are not inherited
    /// and the job reaps the child instead (module doc).
    pub fn claim(path: &Path) -> io::Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(path)?;
        try_lock_state(&file).map_err(|error| match error {
            // Only a conflict gets the rival's sentence: any other failure
            // of the lock itself is reported as itself, not disguised as
            // "another instance".
            std::fs::TryLockError::WouldBlock => io::Error::new(
                io::ErrorKind::WouldBlock,
                "another instance already holds the state file",
            ),
            std::fs::TryLockError::Error(error) => error,
        })?;
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        file.write_all(format!("{MAGIC}\n").as_bytes())?;
        file.flush()?;
        Ok(Self {
            file,
            path: path.to_path_buf(),
        })
    }

    /// Records which process now owns this instance. Anything `announce`
    /// already recorded (port, exact command) survives: the pid completes
    /// the record, it does not rewrite it, so a reader never sees a pid
    /// without the command it belongs to.
    pub fn describe(&mut self, pid: u32, port: u16) -> io::Result<()> {
        let mut body = String::new();
        self.file.seek(SeekFrom::Start(0))?;
        self.file.read_to_string(&mut body)?;
        let mut out = format!("{MAGIC}\npid={pid}\nport={port}\n");
        for line in body.lines() {
            if let Some(binding) = line.strip_prefix("binding=") {
                out.push_str(&format!("binding={binding}\n"));
            }
        }
        self.file.set_len(0)?;
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(out.as_bytes())?;
        self.file.flush()
    }

    /// Records which server is about to be started — port and exact command —
    /// before it exists. The pid cannot be known yet (the spawn creates it),
    /// so `describe` completes the record afterwards; but a writer that dies
    /// anywhere past this call leaves a file that still names the server its
    /// heir runs. A writer that dies before the spawn leaves no child at
    /// all, so this call never strands anything by itself.
    pub fn announce(&mut self, port: u16, binding: &str) -> io::Result<()> {
        let body = format!("{MAGIC}\nport={port}\nbinding={binding}\n");
        self.file.set_len(0)?;
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(body.as_bytes())?;
        self.file.flush()
    }

    /// The locked handle handed to the spawn as `inherit`: unix clears its
    /// close-on-exec so the child keeps the lock; Windows ignores it — the
    /// job reaps the child instead (module doc).
    pub fn handle(&self) -> &File {
        &self.file
    }

    /// Reads the file and reports whether an instance of ours is alive.
    pub fn inspect(path: &Path) -> io::Result<Existing> {
        let mut file = match File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Existing::None),
            Err(e) => return Err(e),
        };
        match try_lock_state(&file) {
            // We got the lock, so the writer is gone: stale, whatever it says.
            Ok(()) => return Ok(Existing::Stale),
            Err(std::fs::TryLockError::WouldBlock) => {}
            Err(std::fs::TryLockError::Error(e)) => return Err(e),
        }
        let mut body = String::new();
        file.read_to_string(&mut body)?;
        let mut pid = None;
        let mut port = None;
        let mut binding = None;
        for line in body.lines() {
            match line.split_once('=') {
                Some(("pid", value)) => pid = value.trim().parse().ok(),
                Some(("port", value)) => port = value.trim().parse().ok(),
                Some(("binding", value)) => binding = Some(value.trim().to_string()),
                _ => {}
            }
        }
        match (pid, port) {
            (Some(pid), Some(port)) if body.starts_with(MAGIC) => {
                Ok(Existing::Live { pid, port, binding })
            }
            // Locked, ours, but the pid never arrived: the writer died
            // between the spawn and the describe. The port and command are
            // known — they were recorded before the child existed — and are
            // enough to reuse by health; no pid here may be trusted, so this
            // is never a target.
            (None, Some(port)) if body.starts_with(MAGIC) => {
                Ok(Existing::Unidentified { port, binding })
            }
            // Locked by someone who is not us, or written by a version we do
            // not understand. Either way: do not touch it.
            _ => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "the state file is locked but does not describe an instance",
            )),
        }
    }

    /// Clean stop: unlock and remove, so the next start sees `None` instead of
    /// having to reason about a stale file.
    pub fn release(self) {
        let _ = std::fs::remove_file(&self.path);
        // Unix unlocks with std before the handle closes; Windows unlocks
        // the same byte explicitly — Microsoft: do not rely on release-on-
        // close, it can lag — and the handle this function then drops is
        // the backstop.
        #[cfg(unix)]
        let _ = self.file.unlock();
        #[cfg(windows)]
        unlock_state_byte(&self.file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("kalsa-instance-test-{name}.state"))
    }

    #[test]
    fn a_missing_file_is_none() {
        let path = temp_path("missing");
        let _ = std::fs::remove_file(&path);
        assert_eq!(
            InstanceFile::inspect(&path).expect("inspect"),
            Existing::None
        );
    }

    #[test]
    fn the_record_exists_before_the_thing_it_describes() {
        // claim, then announce, and no spawn yet: the port and exact command
        // are already on disk. A writer that dies past this point leaves a
        // file that still names its heir's server — never a pid, which
        // cannot be known before the spawn.
        let path = temp_path("announced");
        let _ = std::fs::remove_file(&path);
        let mut file = InstanceFile::claim(&path).expect("claim");
        file.announce(8130, "/server/llama-server\x1f--port\x1f8130")
            .expect("announce");
        assert_eq!(
            InstanceFile::inspect(&path).expect("inspect"),
            Existing::Unidentified {
                port: 8130,
                binding: Some("/server/llama-server\x1f--port\x1f8130".into())
            }
        );
        // The pid completes the record in place: the command it belongs to
        // survives, so a reader never sees a pid without its command.
        file.describe(4242, 8130).expect("describe");
        assert_eq!(
            InstanceFile::inspect(&path).expect("inspect"),
            Existing::Live {
                pid: 4242,
                port: 8130,
                binding: Some("/server/llama-server\x1f--port\x1f8130".into())
            }
        );
        file.release();
        assert_eq!(
            InstanceFile::inspect(&path).expect("inspect"),
            Existing::None
        );
    }

    #[test]
    fn a_record_without_an_announcement_reads_back_as_live() {
        // The probe's flow — claim, spawn, describe, no announce — must keep
        // producing exactly the file it always did: a pid with no command.
        let path = temp_path("noannounce");
        let _ = std::fs::remove_file(&path);
        let mut file = InstanceFile::claim(&path).expect("claim");
        file.describe(4243, 8131).expect("describe");
        assert_eq!(
            InstanceFile::inspect(&path).expect("inspect"),
            Existing::Live {
                pid: 4243,
                port: 8131,
                binding: None
            }
        );
        file.release();
    }

    #[test]
    fn a_file_left_behind_by_a_dead_writer_is_stale() {
        let path = temp_path("leftover");
        let _ = std::fs::remove_file(&path);
        // Written by hand: no lock is held, exactly like a crashed run.
        std::fs::write(&path, "kalsa-brain v1\npid=1\nport=8130\n").expect("write");
        assert_eq!(
            InstanceFile::inspect(&path).expect("inspect"),
            Existing::Stale
        );
    }

    #[test]
    fn a_locked_file_that_is_not_ours_is_an_error_not_a_target() {
        let path = temp_path("foreign");
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, "some other program's state\n").expect("write");
        let holder = File::open(&path).expect("open");
        holder.try_lock().expect("lock");
        assert!(InstanceFile::inspect(&path).is_err());
    }

    /// Only a rival wears the rival's sentence: a second claim on a file the
    /// first still holds is the `WouldBlock` kind with its exact words —
    /// that is what callers turn into "already running". (The other half,
    /// a non-conflict lock failure passing through untouched, has no cheap
    /// portable test: forcing one needs a failing filesystem.)
    #[test]
    fn a_second_claim_says_another_instance_holds_it() {
        let path = temp_path("second");
        let _ = std::fs::remove_file(&path);
        let first = InstanceFile::claim(&path).expect("the first claim");
        let error = match InstanceFile::claim(&path) {
            Err(error) => error,
            Ok(_) => panic!("the second claim must fail"),
        };
        assert_eq!(error.kind(), io::ErrorKind::WouldBlock);
        assert!(
            error.to_string().contains("another instance already holds the state file"),
            "{error}"
        );
        drop(first);
        let _ = std::fs::remove_file(&path);
    }

    /// What a same-process duplicate proves: the byte lock lives with the
    /// file, not with the handle that took it — while the duplicate lives,
    /// closing the original keeps the lock, and the duplicate's close
    /// releases it. This is NOT an inheritance proof: Microsoft's
    /// LockFileEx docs say an inherited handle in a child "is not granted
    /// access to the locked region", and no Windows production path relies
    /// on inheritance anyway — handles are not inherited there and the job
    /// reaps instead (module doc).
    #[cfg(windows)]
    #[test]
    fn the_lock_outlives_the_handle_that_took_it_while_a_duplicate_lives() {
        let path = temp_path("dup-lock");
        let _ = std::fs::remove_file(&path);
        let instance = InstanceFile::claim(&path).expect("claim");
        let duplicate = instance.file.try_clone().expect("duplicate the handle");
        drop(instance);
        let probe = File::open(&path).expect("open");
        assert!(
            matches!(
                try_lock_state(&probe),
                Err(std::fs::TryLockError::WouldBlock)
            ),
            "a duplicate must keep the byte locked after the original closes"
        );
        drop(duplicate);
        assert!(
            try_lock_state(&probe).is_ok(),
            "the duplicate's close must release the byte lock"
        );
        drop(probe);
        let _ = std::fs::remove_file(&path);
    }
}
