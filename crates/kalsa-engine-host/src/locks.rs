//! One advisory file lock per engine id, held across install/uninstall/start.

use std::fs::{self, File};
use std::os::unix::io::AsRawFd;

use crate::paths;

pub struct EngineLock(File);

/// One id rule for lock files, engine folders, install, uninstall and start.
pub(crate) fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        Err(format!("invalid engine id {id}"))
    } else {
        Ok(())
    }
}

impl EngineLock {
    pub fn acquire(id: &str) -> Result<Self, String> {
        validate_id(id)?;
        let root = paths::safe_root()?;
        let dir = root.join(".locks");
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let file = File::options()
            .create(true)
            .read(true)
            .write(true)
            .open(dir.join(format!("{id}.lock")))
            .map_err(|error| error.to_string())?;
        let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
        if result != 0 {
            return Err("could not lock the engine".to_string());
        }
        Ok(Self(file))
    }
}

impl Drop for EngineLock {
    fn drop(&mut self) {
        unsafe { libc::flock(self.0.as_raw_fd(), libc::LOCK_UN) };
    }
}
