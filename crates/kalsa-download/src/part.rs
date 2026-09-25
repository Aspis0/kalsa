//! The `.part` file: created so that nothing planted at that path can redirect
//! the write, and locked so that two downloads of one destination cannot
//! interleave in it.
//!
//! Creation goes through `create_new`, which fails when anything is there —
//! a symlink counts, so a planted link is never followed. Reopening an
//! earlier run's part file goes through `O_NOFOLLOW` (on Windows: reparse
//! point) with the file type checked on the handle, and everything later —
//! length, digest, sync — happens through that one handle, so there is no
//! window in which the path can name a different file than the one we are
//! writing.
//!
//! The lock is the supervisor's state-file rule applied to a download:
//! holding it is proof this download owns the part file, and the OS drops it
//! if we die.

use std::fs::{File, OpenOptions};
use std::io::{self, Seek, SeekFrom};
use std::path::{Path, PathBuf};

pub struct PartFile {
    file: File,
    path: PathBuf,
    /// True when we created the file, empty: on an early refusal we take it
    /// back out, so a refused download leaves nothing behind. A resumed one
    /// is the user's progress and stays.
    created: bool,
}

impl PartFile {
    /// Creates or reopens and locks the part file for `dest`.
    pub fn claim(path: PathBuf) -> io::Result<Self> {
        let created;
        let mut open = OpenOptions::new();
        open.read(true).write(true);
        #[cfg(windows)]
        with_delete_access(&mut open);
        let file = match open.create_new(true).open(&path) {
            Ok(file) => {
                created = true;
                file
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                created = false;
                open_existing(&path)?
            }
            Err(e) => return Err(e),
        };
        let part = Self {
            file,
            path,
            created,
        };
        match part.file.try_lock() {
            Ok(()) => Ok(part),
            Err(std::fs::TryLockError::WouldBlock) => Err(io::Error::new(
                io::ErrorKind::WouldBlock,
                "another download already holds this part file",
            )),
            Err(std::fs::TryLockError::Error(e)) => Err(e),
        }
    }

    /// Length as of now, read from the handle: the one answer that cannot be
    /// a race with somebody editing the path.
    pub fn len(&self) -> io::Result<u64> {
        Ok(self.file.metadata()?.len())
    }

    /// True when this call created the part file empty.
    pub fn is_fresh(&self) -> bool {
        self.created
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The handle all reading and writing goes through.
    pub fn handle(&mut self) -> &mut File {
        &mut self.file
    }

    /// Back to zero: used when the server's body is a whole file rather than
    /// the requested suffix, and for a part longer than the promise, which
    /// cannot be a prefix of it.
    pub fn restart(&mut self) -> io::Result<()> {
        self.file.set_len(0)?;
        self.file.seek(SeekFrom::Start(0))?;
        Ok(())
    }

    /// Positions at the end, where a validated suffix is appended.
    pub fn append(&mut self) -> io::Result<()> {
        self.file.seek(SeekFrom::End(0))?;
        Ok(())
    }

    /// Best-effort removal: after a mismatch or an early refusal the part
    /// file is a kept failure, and a kept failure only fails again.
    pub fn discard(self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Reopens a part file an earlier run left behind, without following
/// whatever a symlink at that path points at.
#[cfg(unix)]
fn open_existing(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    let file = OpenOptions::new()
        .read(true)
        .write(true)
        // A link at the part path is somebody else's file, not ours to
        // write through.
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?;
    // The flag stops links, not every non-regular thing a path can name; the
    // type is checked on the handle, not the path.
    if !file.metadata()?.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "the part path is not a regular file",
        ));
    }
    Ok(file)
}

/// Puts DELETE on a part-file handle: publication renames BY this handle
/// (`SetFileInformationByHandle(FileRenameInfo)`), which needs DELETE access
/// on it — plain read+write fails with GetLastError=5, measured on the
/// Surface as the walk's `ServerFetchFailed`. `access_mode` replaces the
/// read/write-derived rights, so all three are named together. Every other
/// opener of the part file goes through std's default share
/// (READ|WRITE|DELETE), which grants this access and a delete-sharing
/// rename, so nothing can hold the file in the rename's way.
#[cfg(windows)]
fn with_delete_access(options: &mut OpenOptions) {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
    use windows_sys::Win32::Storage::FileSystem::DELETE;
    options.access_mode(GENERIC_READ | GENERIC_WRITE | DELETE);
}

/// Reopens a part file an earlier run left behind, without following a link
/// planted at that path.
#[cfg(windows)]
fn open_existing(path: &Path) -> io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;

    // Opens the entry itself, not its target; the type check refuses it.
    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0200_0000;
    let mut open = OpenOptions::new();
    open.read(true)
        .write(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    with_delete_access(&mut open);
    let file = open.open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() || meta.is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            "the part path is not a regular file",
        ));
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_at_the_part_path_is_refused_not_written_through() {
        let dir = scratch("part-symlink");
        let target = dir.join("innocent.gguf");
        fs::write(&target, b"not ours").expect("write");
        std::os::unix::fs::symlink(&target, dir.join("model.gguf.part")).expect("link");
        assert!(
            PartFile::claim(dir.join("model.gguf.part")).is_err(),
            "a planted link must not be written through"
        );
        assert_eq!(fs::read(&target).expect("read"), b"not ours");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_claim_while_one_holds_is_refused() {
        let dir = scratch("part-lock");
        let path = dir.join("model.gguf.part");
        let first = PartFile::claim(path.clone()).expect("first claim");
        assert!(
            PartFile::claim(path.clone()).is_err(),
            "two writers must not share the part file"
        );
        drop(first);
        // The reopen also exercises the existing-file path of `claim`.
        PartFile::claim(path).expect("claim after the holder is gone");
        let _ = fs::remove_dir_all(&dir);
    }
}
