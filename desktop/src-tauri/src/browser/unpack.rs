//! Unpacking the driver archive into a directory nothing else writes.
//!
//! The archive arrives here as bytes, not as a path: the caller verified these
//! bytes and this unpacks these bytes, so nothing can be swapped between the two
//! and the file on disk is not read a second time.
//!
//! The names are not trusted either. An entry that is not a plain file, or whose
//! name is anything but plain names, is refused and the whole unpack fails. A
//! driver's `package/` is a script we then execute, so the bytes on disk have to
//! be the bytes the archive named and the paths have to be the paths it named.

use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

use super::error::BrowserError;

/// Unpacks `bytes` into `dest`, which must not exist yet.
///
/// A destination that is already there is refused rather than merged into: a
/// half-written driver from an interrupted run must not be completed by the next
/// one, and the caller has already decided whether what is there is worth
/// keeping.
pub(crate) fn unpack(bytes: &[u8], dest: &Path) -> Result<(), BrowserError> {
    if dest.exists() {
        return Err(BrowserError::Unpack);
    }
    let mut reader = tar::Archive::new(flate2::read::GzDecoder::new(Cursor::new(bytes)));
    let entries = reader.entries().map_err(|_| BrowserError::Unpack)?;

    for entry in entries {
        let mut entry = entry.map_err(|_| BrowserError::Unpack)?;
        let entry_path = entry.path().map_err(|_| BrowserError::Unpack)?;
        let inside = inside(dest, &entry_path)?;
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&inside).map_err(|_| BrowserError::Unpack)?;
            continue;
        }
        if !entry.header().entry_type().is_file() {
            return Err(BrowserError::Unpack);
        }
        if let Some(parent) = inside.parent() {
            std::fs::create_dir_all(parent).map_err(|_| BrowserError::Unpack)?;
        }
        let mode = entry.header().mode().unwrap_or(0o644) & 0o777;
        let mut body = Vec::new();
        entry.read_to_end(&mut body).map_err(|_| BrowserError::Unpack)?;
        std::fs::write(&inside, body).map_err(|_| BrowserError::Unpack)?;
        keep_executable(mode, &inside)?;
    }
    Ok(())
}

/// `node` cannot start without its executable bit, and a `.tar.gz` is the only
/// reason it has one: zip carries no unix mode at all.
#[cfg(unix)]
fn keep_executable(mode: u32, inside: &Path) -> Result<(), BrowserError> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(inside, std::fs::Permissions::from_mode(mode)).map_err(|_| BrowserError::Unpack)
}

#[cfg(not(unix))]
fn keep_executable(_mode: u32, _inside: &Path) -> Result<(), BrowserError> {
    Ok(())
}

/// Where an entry lands, or the refusal.
///
/// The name is rebuilt component by component and only `Component::Normal` is
/// accepted, so nothing an operating system would read as a drive, a UNC
/// prefix, a parent, a separator or a device reaches a path:
///
/// * `C:foo` is a **drive-relative** path — relative to the drive's current
///   directory, not to ours — so it is not a plain name either;
/// * `\\?\` and `\\server` are UNC and extended-length prefixes;
/// * `a\..\b` is a `..` wearing a different separator;
/// * `file.txt:ads` is an NTFS alternate data stream: the name is a *stream* of
///   another file, so writing it writes into `file.txt` rather than creating
///   anything new;
/// * `.`, `..`, an empty component and a NUL are each their own way out, and
///   `./` as the archive's root entry is the one legitimate empty case — which
///   names `dest` itself.
fn inside(dest: &Path, entry: &Path) -> Result<PathBuf, BrowserError> {
    // `./` and `.` are the same path to `components()` and not the same entry:
    // the first is an archive's own root and names `dest`, the second is a name
    // that is not a plain name. So the root is recognised from the text, before
    // the walk that refuses everything else.
    let name = entry.to_str().ok_or(BrowserError::Unpack)?;
    if name.starts_with("./") && name[2..].chars().all(|c| c == '.' || c == '/') {
        return Ok(dest.to_path_buf());
    }
    if name.is_empty() || name == "." {
        return Err(BrowserError::Unpack);
    }

    let mut cleaned = PathBuf::new();
    for component in entry.components() {
        match component {
            Component::Normal(name) => {
                let part = name.to_str().ok_or(BrowserError::Unpack)?;
                // On Windows `\` is already a separator and `components` splits
                // on it; on unix it is an ordinary character inside one name,
                // which is exactly how `a\..\b` and `\\server\share` would
                // otherwise arrive whole.
                if part.contains('\\') || part.contains(':') || part.contains('\0') {
                    return Err(BrowserError::Unpack);
                }
                cleaned.push(part);
            }
            // The archive's own root entry is `./`, and it names `dest`. A
            // leading `/` is not that: it is a rooted name, and only a plain
            // name is accepted here.
            Component::CurDir => continue,
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(BrowserError::Unpack)
            }
        }
    }
    if cleaned.as_os_str().is_empty() {
        return Ok(dest.to_path_buf());
    }
    Ok(dest.join(cleaned))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A tar.gz holding the shapes this has to tell apart. `kind` is the tar
    /// entry type, written by hand so a link can be built at all.
    fn written(name: &str, entries: &[(tar::EntryType, &str, &str)]) -> Vec<u8> {
        let dir = std::env::temp_dir().join(format!("kalsa-unpack-src-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("scratch dir");
        let path = dir.join("archive.tar.gz");
        let file = std::fs::File::create(&path).expect("scratch archive");
        let mut builder =
            tar::Builder::new(flate2::write::GzEncoder::new(file, flate2::Compression::fast()));
        for (kind, entry_name, body) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(*kind);
            header.set_size(if kind.is_file() { body.len() as u64 } else { 0 });
            header.set_mode(0o755);
            header.set_mtime(0);
            header.set_cksum();
            builder
                .append_data(&mut header, entry_name, std::io::Cursor::new(*body))
                .expect("entry appends");
        }
        builder.into_inner().expect("encoder").finish().expect("gzip finishes");
        std::fs::read(&path).expect("the archive reads")
    }

    /// An archive the `tar` crate will not write: its own builder refuses a
    /// `..` name, so the header is built byte by byte. This is the shape a
    /// hostile archive has, and it is the only way to prove the refusal is ours
    /// rather than the writer's.
    fn hostile(name: &str) -> Vec<u8> {
        let mut header = [0u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        header[100..108].copy_from_slice(b"0000755\0");
        header[124..136].copy_from_slice(b"00000000000\0");
        header[136..148].copy_from_slice(b"00000000000\0");
        header[148..156].copy_from_slice(b"        ");
        header[156] = b'0';
        let sum: u32 = header.iter().map(|byte| u32::from(*byte)).sum();
        header[148..154].copy_from_slice(format!("{sum:06o}").as_bytes());
        header[154] = 0;
        header[155] = b' ';
        let mut tar = header.to_vec();
        tar.extend_from_slice(&[0u8; 1024]);

        let mut encoder =
            flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut encoder, &tar).expect("the archive is written");
        encoder.finish().expect("gzip finishes")
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-unpack-dst-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_plain_file_is_unpacked_where_the_archive_named_it() {
        let bytes = written(
            "plain",
            &[
                (tar::EntryType::file(), "package/cli.js", "console.log(1)"),
                (tar::EntryType::file(), "node", "runtime"),
            ],
        );
        let dest = scratch("plain");
        unpack(&bytes, &dest).expect("unpacked");
        assert_eq!(std::fs::read_to_string(dest.join("package/cli.js")).expect("read"), "console.log(1)");
        assert_eq!(std::fs::read_to_string(dest.join("node")).expect("read"), "runtime");
        let _ = std::fs::remove_dir_all(&dest);
    }

    /// Each of these is a path an operating system would read as something other
    /// than a plain name inside `dest`.
    #[test]
    fn a_name_that_is_not_a_plain_name_is_refused() {
        let dest = scratch("names");
        for name in [
            "../escaped",
            "/absolute",
            "a/../../b",
            // Drive-relative: relative to that drive's current directory, not ours.
            "C:foo",
            "C:\\Windows\\System32",
            // UNC and extended-length prefixes.
            "\\\\?\\C:\\Windows",
            "\\\\server\\share",
            // A parent wearing a different separator.
            "a\\..\\b",
            // An alternate data stream is a stream of another file, not a file.
            "file.txt:ads",
            "..",
            ".",
        ] {
            let bytes = hostile(name);
            assert_eq!(unpack(&bytes, &dest).err(), Some(BrowserError::Unpack), "{name} was unpacked");
            assert!(!dest.exists(), "{name} created the destination");
        }
    }

    #[test]
    fn a_nul_in_a_name_is_refused_rather_than_truncated() {
        assert!(inside(Path::new("/d"), Path::new("node\0.js")).is_err());
    }

    /// The one legitimate empty case: the archive's own root entry.
    #[test]
    fn the_root_of_the_archive_names_the_destination() {
        let dest = scratch("root");
        assert_eq!(inside(&dest, Path::new("./")).expect("the root is the destination"), dest);
    }

    #[test]
    fn a_link_is_refused_rather_than_written() {
        let bytes = written("link", &[(tar::EntryType::symlink(), "node", "")]);
        let dest = scratch("link");
        assert_eq!(unpack(&bytes, &dest).err(), Some(BrowserError::Unpack));
        assert!(!dest.join("node").exists());
    }

    #[test]
    fn a_destination_that_is_already_there_is_refused_not_merged_into() {
        let bytes = written("twice", &[(tar::EntryType::file(), "node", "runtime")]);
        let dest = scratch("twice");
        std::fs::create_dir_all(&dest).expect("scratch dir");
        std::fs::write(dest.join("node"), "an older driver").expect("already there");
        assert_eq!(unpack(&bytes, &dest).err(), Some(BrowserError::Unpack));
        assert_eq!(std::fs::read_to_string(dest.join("node")).expect("read"), "an older driver");
        let _ = std::fs::remove_dir_all(&dest);
    }

    /// The bytes that were checked are the bytes that are written: this takes a
    /// buffer, so there is no path for anything to be swapped through.
    #[test]
    fn what_is_unpacked_is_the_buffer_it_was_given() {
        let bytes = written("buffer", &[(tar::EntryType::file(), "node", "the driver we checked")]);
        let dest = scratch("buffer");
        unpack(&bytes, &dest).expect("unpacked");
        assert_eq!(std::fs::read_to_string(dest.join("node")).expect("read"), "the driver we checked");
        let _ = std::fs::remove_dir_all(&dest);
    }

    #[cfg(unix)]
    #[test]
    fn the_executable_bit_survives_so_the_runtime_can_start() {
        use std::os::unix::fs::PermissionsExt;
        let bytes = written("mode", &[(tar::EntryType::file(), "node", "runtime")]);
        let dest = scratch("mode");
        unpack(&bytes, &dest).expect("unpacked");
        let mode = std::fs::metadata(dest.join("node")).expect("metadata").permissions().mode();
        assert_eq!(mode & 0o111, 0o111, "node is not executable");
        let _ = std::fs::remove_dir_all(&dest);
    }
}