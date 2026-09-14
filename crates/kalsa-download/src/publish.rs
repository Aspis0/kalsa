//! The last step: make `dest` name the bytes that were verified, and nothing
//! else.
//!
//! Verifying a handle and then renaming a path move two different objects: a
//! local attacker with write access to the download directory can relabel the
//! path between the two and have us publish a file we never hashed. So
//! publication is tied to the descriptor wherever the platform allows it,
//! and where it does not, that is said plainly:
//!
//! * Windows: `SetFileInformationByHandle(FileRenameInfo)` renames the
//!   handle's file onto `dest` — by descriptor, atomic, replacing.
//! * Linux: `linkat` through `/proc/self/fd/N` makes `dest` another name for
//!   the verified inode — by descriptor; the now-redundant part name goes.
//! * macOS: there is no rename by descriptor (`linkat` has no
//!   `AT_EMPTY_PATH`, there is no procfs), so the rename is by path with the
//!   identity compared on both sides of it. The swap window is one rename
//!   wide: an attacker who wins it causes a loud failure and has their file
//!   destroyed — never a silent publish of unverified bytes.

use std::io;
use std::path::Path;

use crate::part::PartFile;

/// Publishes the verified bytes held by `part` under `dest`.
pub fn verified(part: &mut PartFile, dest: &Path) -> io::Result<()> {
    #[cfg(unix)]
    let result = unix(part, dest);
    #[cfg(windows)]
    let result = windows(part, dest);
    result
}

#[cfg(unix)]
fn unix(part: &mut PartFile, dest: &Path) -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        if linkat_verified(part, dest)? {
            return Ok(());
        }
    }
    checked_rename(part, dest)
}

/// Attempts the by-descriptor publish. `Ok(true)`: done, `dest` names the
/// verified inode. `Ok(false)`: this kernel cannot (no procfs) — the caller
/// falls back to the checked rename. `Err`: a failure not worth hiding.
#[cfg(target_os = "linux")]
fn linkat_verified(part: &mut PartFile, dest: &Path) -> io::Result<bool> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::io::AsRawFd;

    let target = cstring(dest)?;
    let procfd = CString::new(format!("/proc/self/fd/{}", part.handle().as_raw_fd()))
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path has an interior NUL"))?;
    for attempt in 0..2 {
        // The kernel is asked to link the descriptor's file, not a path:
        // nothing relabelled in the directory changes which inode lands.
        let ok = unsafe {
            libc::linkat(
                libc::AT_FDCWD,
                procfd.as_ptr(),
                libc::AT_FDCWD,
                target.as_ptr(),
                libc::AT_SYMLINK_FOLLOW,
            )
        };
        if ok == 0 {
            // `dest` names the verified inode; the part name is redundant
            // (and, if a swap happened meanwhile, not ours to keep).
            let _ = std::fs::remove_file(part.path());
            return Ok(true);
        }
        let e = io::Error::last_os_error();
        if attempt == 0 && e.raw_os_error() == Some(libc::EEXIST) {
            // An earlier install, or a planted file: either way the verified
            // inode replaces it. A name that keeps reappearing falls through
            // as an error on the second attempt.
            let _ = std::fs::remove_file(dest);
        } else if matches!(
            e.raw_os_error(),
            Some(libc::ENOSYS) | Some(libc::EINVAL) | Some(libc::ENOENT)
        ) {
            return Ok(false);
        } else {
            return Err(e);
        }
    }
    Err(io::Error::new(
        io::ErrorKind::Other,
        "the destination kept being replaced while publishing",
    ))
}

/// The fallback for platforms that cannot name a descriptor: rename by path,
/// but compare the identity on both sides of it. The swap window is one
/// rename wide, and a swap in that window is a loud failure with the planted
/// file destroyed — never a silent publish.
#[cfg(unix)]
fn checked_rename(part: &mut PartFile, dest: &Path) -> io::Result<()> {
    let id = identity(part.handle())?;
    if same_at(part.path(), id) != Some(true) {
        return Err(swapped());
    }
    std::fs::rename(part.path(), dest)?;
    if same_at(dest, id) != Some(true) {
        // The bytes that landed are not the bytes that were hashed: take
        // them back out and say so.
        let _ = std::fs::remove_file(dest);
        return Err(swapped());
    }
    Ok(())
}

/// Renames the handle's file onto `dest`, replacing it, without asking the
/// kernel about a source path we could be raced on: the request names the
/// descriptor and the destination only. The buffer is the documented
/// FILE_RENAME_INFO layout: DWORD ReplaceIfExists, DWORD FileNameLength (in
/// bytes, including the terminator), WCHAR FileName[].
#[cfg(windows)]
fn windows(part: &mut PartFile, dest: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::SetFileInformationByHandle;

    const FILE_RENAME_INFO: i32 = 3; // FileRenameInfo, from FILE_INFO_BY_HANDLE_CLASS
    let mut name: Vec<u16> = dest.as_os_str().encode_wide().collect();
    name.push(0);
    let mut info = vec![0u8; 8 + name.len() * 2];
    info[0] = 1; // ReplaceIfExists
    info[4..8].copy_from_slice(&((name.len() * 2) as u32).to_le_bytes());
    for (i, unit) in name.iter().enumerate() {
        info[8 + i * 2..8 + i * 2 + 2].copy_from_slice(&unit.to_le_bytes());
    }
    let ok = unsafe {
        SetFileInformationByHandle(
            part.handle().as_raw_handle() as HANDLE,
            FILE_RENAME_INFO,
            info.as_ptr() as *const core::ffi::c_void,
            info.len() as u32,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn cstring(path: &Path) -> io::Result<CString> {
    use std::os::unix::ffi::OsStrExt;
    CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path has an interior NUL"))
}

#[cfg(unix)]
fn identity(file: &std::fs::File) -> io::Result<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let meta = file.metadata()?;
    Ok((meta.dev(), meta.ino()))
}

#[cfg(unix)]
fn same_at(path: &Path, id: (u64, u64)) -> Option<bool> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(path)
        .ok()
        .map(|meta| (meta.dev(), meta.ino()) == id)
}

#[cfg(unix)]
fn swapped() -> io::Error {
    io::Error::new(
        io::ErrorKind::Other,
        "the verified file was swapped while it was published",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// Claims the part file with the verified bytes in it, then does what the
    /// attacker does: relabels the path so it names different bytes, while
    /// our handle keeps pointing at the verified inode.
    fn claimed_then_swapped(dir: &Path) -> (PartFile, Vec<u8>) {
        let good = b"the verified model bytes".to_vec();
        fs::write(dir.join("model.gguf.part"), &good).expect("verified bytes");
        let part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        fs::rename(dir.join("model.gguf.part"), dir.join("stashed.gguf")).expect("attacker rename");
        fs::write(dir.join("model.gguf.part"), b"attacker bytes").expect("attacker bytes");
        (part, good)
    }

    #[cfg(target_os = "macos")]
    fn assert_outcome(result: io::Result<()>, dest: &Path, good: &[u8]) {
        // macOS cannot publish by descriptor: the honest outcome is a loud
        // refusal, and nothing may land under the final name.
        let _ = good;
        assert!(result.is_err(), "a relabelled path must not publish");
        assert!(!dest.exists(), "nothing may land under the final name");
    }

    #[cfg(not(target_os = "macos"))]
    fn assert_outcome(result: io::Result<()>, dest: &Path, good: &[u8]) {
        result.expect("publish by descriptor");
        assert_eq!(fs::read(dest).expect("read"), good);
    }

    #[test]
    fn a_swapped_path_is_never_what_gets_published() {
        let dir = scratch("publish-swap");
        let (mut part, good) = claimed_then_swapped(&dir);
        let dest = dir.join("model.gguf");
        let result = verified(&mut part, &dest);
        assert_outcome(result, &dest, &good);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_existing_destination_is_replaced_by_the_verified_bytes() {
        let dir = scratch("publish-replace");
        let good = b"the verified model bytes".to_vec();
        fs::write(dir.join("model.gguf.part"), &good).expect("verified bytes");
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        // Planted by an earlier install or by an attacker; either way the
        // verified bytes replace it.
        fs::write(dir.join("model.gguf"), b"a previous, unverified copy").expect("plant dest");
        let dest = dir.join("model.gguf");
        verified(&mut part, &dest).expect("publish replaces");
        assert_eq!(fs::read(&dest).expect("read"), good);
        let _ = fs::remove_dir_all(&dir);
    }
}
