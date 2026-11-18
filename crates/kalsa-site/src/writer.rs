//! Writes the generated files, and refuses any path that would leave the output directory.

use std::fs;
use std::path::{Component, Path, PathBuf};

pub fn write_site(files: &[(PathBuf, String)], out: &Path) -> Result<usize, String> {
    fs::create_dir_all(out).map_err(|error| format!("{}: {error}", out.display()))?;
    let root = out.canonicalize().map_err(|error| error.to_string())?;
    for (relative, body) in files {
        if relative.components().any(|part| !matches!(part, Component::Normal(_))) {
            return Err(format!("refusing to write {relative:?}: not a plain relative path"));
        }
        let target = root.join(relative);
        let parent = target.parent().ok_or("a file needs a directory")?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let parent = parent.canonicalize().map_err(|error| error.to_string())?;
        if !parent.starts_with(&root) {
            return Err(format!("refusing to write {relative:?}: it resolves outside {}", root.display()));
        }
        fs::write(parent.join(target.file_name().ok_or("a file needs a name")?), body).map_err(|error| error.to_string())?;
    }
    Ok(files.len())
}
