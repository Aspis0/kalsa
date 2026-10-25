//! How much room is left where we are about to write.
//!
//! Asked before any byte moves: filling a user's disk can break their machine,
//! which is exactly what this product promises not to do.

use std::io;
use std::path::Path;

/// Bytes free to a non-root user on the filesystem holding `path`.
#[cfg(unix)]
pub fn free_bytes(path: &Path) -> io::Result<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path has an interior NUL"))?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut stat) } != 0 {
        return Err(io::Error::last_os_error());
    }
    // bavail, not bfree: the root reserve is not space we may use.
    Ok(stat.f_bavail as u64 * stat.f_frsize as u64)
}

/// Bytes free to this user on the drive holding `path`.
#[cfg(windows)]
pub fn free_bytes(path: &Path) -> io::Result<u64> {
    use std::os::windows::ffi::OsStrExt;

    let mut wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free: u64 = 0;
    let ok = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(free)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn somewhere_writable_reports_a_positive_free_space() {
        let free = free_bytes(&std::env::temp_dir()).expect("free space");
        assert!(free > 0);
    }
}
