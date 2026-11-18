//! One folder per engine, always under a real, non-symlinked Kalsa root.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub fn root() -> PathBuf {
    if let Ok(dir) = std::env::var("KALSA_ENGINES_ROOT") {
        return PathBuf::from(dir);
    }
    let home = std::env::var("HOME").unwrap_or_default();
    Path::new(&home).join("Library/Application Support/Kalsa/engines")
}

/// Checks every existing component: a symlink anywhere in the root's path can
/// redirect a later `remove_dir_all` outside the intended tree.
pub fn safe_root() -> Result<PathBuf, String> {
    let candidate = root();
    if !candidate.is_absolute() {
        return Err("the engines root must be an absolute path".to_string());
    }
    let parts: Vec<_> = candidate.components().collect();
    if parts.len() < 3 {
        return Err("the engines root is too shallow".to_string());
    }
    if std::env::var_os("HOME").is_some_and(|home| candidate == Path::new(&home)) {
        return Err("the engines root cannot be the home directory".to_string());
    }
    let start = parts
        .iter()
        .position(|part| part.as_os_str() == "Application Support")
        .unwrap_or(parts.len().saturating_sub(1));
    let mut walked = PathBuf::new();
    for part in &parts[..start] { walked.push(part); }
    for part in &parts[start..] {
        walked.push(part);
        if let Ok(metadata) = fs::symlink_metadata(&walked) {
            if metadata.file_type().is_symlink() {
                return Err(format!("{} is a symlink", walked.display()));
            }
        }
    }
    fs::create_dir_all(&candidate).map_err(|error| error.to_string())?;
    let real = fs::canonicalize(&candidate).map_err(|error| error.to_string())?;
    let tail: PathBuf = parts[start..].iter().collect();
    if !real.ends_with(tail) {
        return Err("the engines root resolves elsewhere".to_string());
    }
    Ok(real)
}

pub fn engine_dir(id: &str) -> Result<PathBuf, String> {
    crate::locks::validate_id(id)?;
    Ok(safe_root()?.join(id))
}

pub fn assert_inside(path: &Path) -> Result<(), String> {
    let base = safe_root()?;
    let real = fs::canonicalize(path).or_else(|_| {
        let parent = path.parent().ok_or_else(|| io::Error::other("no parent"))?;
        fs::canonicalize(parent).map(|dir| dir.join(path.file_name().unwrap_or_default()))
    }).map_err(|error| error.to_string())?;
    if real == base || !real.starts_with(&base) {
        return Err("path is outside Kalsa's engines root".to_string());
    }
    Ok(())
}

pub fn uninstall(id: &str) -> Result<(), String> {
    let dir = engine_dir(id)?;
    let meta = fs::symlink_metadata(&dir).map_err(|error: io::Error| error.to_string())?;
    if meta.file_type().is_symlink() {
        return Err("refusing to uninstall through a symlink".to_string());
    }
    assert_inside(&dir)?;
    fs::remove_dir_all(&dir).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninstall_refuses_paths_outside_the_root() {
        assert!(assert_inside(Path::new("/tmp/not-kalsa/engine")).is_err());
        assert!(engine_dir("../escape").is_err());
    }
}
