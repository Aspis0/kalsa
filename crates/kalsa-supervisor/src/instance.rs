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
//! alive". No pid arithmetic, no start-time comparison, no platform API.

use std::fs::{File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const MAGIC: &str = "kalsa-brain v1";

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
    /// has been spawned, and the lock must be held before that, because the fd
    /// is what the child inherits.
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
        file.try_lock().map_err(|_| {
            io::Error::new(
                io::ErrorKind::WouldBlock,
                "another instance already holds the state file",
            )
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

    /// Records which process now owns this instance.
    pub fn describe(&mut self, pid: u32, port: u16) -> io::Result<()> {
        let body = format!("{MAGIC}\npid={pid}\nport={port}\n");
        self.file.set_len(0)?;
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(body.as_bytes())?;
        self.file.flush()
    }

    /// Records the process and the exact command it runs, so a later start
    /// can tell an orphan of this server from an orphan of a different
    /// configuration.
    pub fn describe_binding(&mut self, binding: &str) -> io::Result<()> {
        let mut body = String::new();
        self.file.seek(SeekFrom::Start(0))?;
        self.file.read_to_string(&mut body)?;
        body.push_str(&format!("binding={binding}\n"));
        self.file.set_len(0)?;
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(body.as_bytes())?;
        self.file.flush()
    }

    /// The locked handle the child must inherit (see `child::spawn`).
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
        match file.try_lock() {
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
        let _ = self.file.unlock();
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
    fn a_claimed_file_reads_back_as_live_and_stale_once_released() {
        let path = temp_path("roundtrip");
        let _ = std::fs::remove_file(&path);
        let mut file = InstanceFile::claim(&path).expect("claim");
        file.describe(4242, 8130).expect("describe");
        assert_eq!(
            InstanceFile::inspect(&path).expect("inspect"),
            Existing::Live {
                pid: 4242,
                port: 8130,
                binding: None
            }
        );
        // The exact command travels with the instance: a later start must be
        // able to tell this server from one started differently.
        file.describe_binding("/server/llama-server\x1f--port\x1f8130")
            .expect("describe binding");
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
}
