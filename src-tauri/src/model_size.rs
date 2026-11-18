//! The size of a model the user typed as a local path, so the page can compare it with this Mac's memory.
//! A path that cannot be statted has no size: nothing is guessed.

use std::fs;
use std::path::Path;

const MAX_ENTRIES: usize = 50_000;

/// Bytes in a file, or in every regular file under a folder. Symlinks are not followed.
pub fn size_of(path: &Path) -> Option<u64> {
    if !path.is_absolute() {
        return None;
    }
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.is_file() {
        return Some(metadata.len());
    }
    if !metadata.is_dir() {
        return None;
    }
    let mut total = 0u64;
    let mut pending = vec![path.to_path_buf()];
    let mut seen = 0usize;
    while let Some(folder) = pending.pop() {
        for entry in fs::read_dir(&folder).ok()?.flatten() {
            seen += 1;
            if seen > MAX_ENTRIES {
                return None;
            }
            let Ok(metadata) = entry.metadata() else { continue };
            if metadata.is_file() {
                total += metadata.len();
            } else if metadata.is_dir() {
                pending.push(entry.path());
            }
        }
    }
    Some(total)
}

#[tauri::command(async)]
pub fn model_size(path: String) -> Option<u64> {
    size_of(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_and_a_folder_have_a_size_and_anything_else_has_none() {
        let dir = std::env::temp_dir().join(format!("kalsa-model-size-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("nested")).unwrap();
        fs::write(dir.join("a.gguf"), vec![0u8; 1000]).unwrap();
        fs::write(dir.join("nested/b.bin"), vec![0u8; 234]).unwrap();
        assert_eq!(size_of(&dir.join("a.gguf")), Some(1000));
        assert_eq!(size_of(&dir), Some(1234));
        assert_eq!(size_of(&dir.join("missing")), None);
        assert_eq!(size_of(Path::new("relative/path")), None);
        assert_eq!(size_of(Path::new("owner/name")), None);
        let _ = fs::remove_dir_all(&dir);
    }
}
