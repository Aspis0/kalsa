//! Unpacking a verified archive, and finding the server inside it.
//!
//! Release zips differ in where they put things (the macOS archives are
//! flat, the Windows ones may nest a directory), so nothing here assumes a
//! layout: extract everything, then walk for `llama-server`. The walk is
//! depth-capped for the same reason the model-cache scan is — a loop must
//! not become a hang.

use std::io;
use std::path::{Path, PathBuf};

use zip::ZipArchive;

/// Deepest nesting the exe search will descend.
const MAX_DEPTH: usize = 4;

/// The binary this crate exists to run, under either platform's name.
fn server_name() -> &'static str {
    #[cfg(windows)]
    {
        "llama-server.exe"
    }
    #[cfg(not(windows))]
    {
        "llama-server"
    }
}

/// Extracts the archive into `into`, which is created if missing. The zip
/// crate's own extraction is used because it resolves entry paths against
/// the destination (no zip-slip) and restores the Unix mode bits — without
/// which the extracted `llama-server` would not be executable.
pub(crate) fn extract(archive: &Path, into: &Path) -> io::Result<()> {
    std::fs::create_dir_all(into)?;
    let file = std::fs::File::open(archive)?;
    let mut zip = ZipArchive::new(file).map_err(|e| {
        io::Error::other(format!(
            "{} is not a readable archive: {e}",
            archive.display()
        ))
    })?;
    zip.extract(into)
        .map_err(|e| io::Error::other(format!("{} did not extract: {e}", archive.display())))
}

/// Finds `llama-server` under `dir`, if a previous extraction left one.
pub(crate) fn find_server(dir: &Path) -> Option<PathBuf> {
    find(dir, 0)
}

fn find(dir: &Path, depth: usize) -> Option<PathBuf> {
    if depth > MAX_DEPTH {
        return None;
    }
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if entry.file_type().ok().is_some_and(|kind| kind.is_dir()) {
            if let Some(found) = find(&path, depth + 1) {
                return Some(found);
            }
            continue;
        }
        if entry.file_name() == server_name() {
            return Some(path);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A miniature stand-in for a release archive: one nested directory, the
    /// server inside it, written with the Unix exec bit so the extraction's
    /// permission handling is exercised too.
    fn fake_release(path: &Path) {
        let file = std::fs::File::create(path).expect("create archive");
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions =
            zip::write::FileOptions::default().unix_permissions(0o755);
        zip.add_directory("bin", options).expect("dir entry");
        zip.start_file("bin/llama-server", options).expect("entry");
        zip.write_all(b"#!not really a server").expect("bytes");
        zip.finish().expect("finish");
    }

    #[test]
    fn an_extracted_archive_yields_a_runnable_server_path() {
        let dir =
            std::env::temp_dir().join(format!("kalsa-runtime-extract-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let archive = dir.join("release.zip");
        fake_release(&archive);
        let into = dir.join("builds").join("test");
        extract(&archive, &into).expect("extract");
        let exe = find_server(&into).expect("server found");
        assert!(exe.is_file());
        assert!(exe.ends_with(server_name()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&exe).expect("meta").permissions().mode();
            assert_ne!(mode & 0o111, 0, "the exec bit must survive extraction");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_without_a_server_yields_none() {
        let dir =
            std::env::temp_dir().join(format!("kalsa-runtime-noserver-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("a").join("b").join("c").join("d").join("e"))
            .expect("mkdirs");
        assert_eq!(find_server(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
