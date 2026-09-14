//! Unpacking a verified archive, and finding the server inside it.
//!
//! The archive format is a fact the asset table states (macOS ships tar.gz,
//! every Windows row is a zip), so extraction dispatches on what it is
//! handed and never sniffs file names at the far end. Both paths keep the
//! same two guarantees: no entry escapes the destination — the zip crate
//! resolves entry paths against it, the tar path refuses anything that would
//! not land inside — and the Unix exec bit survives, because a
//! `llama-server` that cannot be executed is the same failure as a missing
//! one.

use std::io;
use std::path::{Component, Path, PathBuf};

use flate2::read::GzDecoder;
use zip::ZipArchive;

use crate::assets::ArchiveFormat;

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

/// Extracts the archive into `into`, which is created if missing.
pub(crate) fn extract(archive: &Path, format: ArchiveFormat, into: &Path) -> io::Result<()> {
    std::fs::create_dir_all(into)?;
    match format {
        ArchiveFormat::Zip => extract_zip(archive, into),
        ArchiveFormat::TarGz => extract_tar_gz(archive, into),
    }
}

/// The zip crate's own extraction, used because it resolves entry paths
/// against the destination (no zip-slip) and restores the Unix mode bits.
fn extract_zip(archive: &Path, into: &Path) -> io::Result<()> {
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

fn extract_tar_gz(archive: &Path, into: &Path) -> io::Result<()> {
    let file = std::fs::File::open(archive)?;
    let mut tar = tar::Archive::new(GzDecoder::new(file));
    // Without this the tar crate applies its own defaults rather than the
    // archive's modes, and llama-server lands non-executable.
    tar.set_preserve_permissions(true);
    for entry in tar.entries()? {
        let mut entry = entry?;
        let entry_path = entry.path()?.to_path_buf();
        let dest = inside(into, &entry_path)?;
        match entry.header().entry_type() {
            tar::EntryType::Directory | tar::EntryType::Regular => {
                entry.unpack(&dest)?;
            }
            // These archives are directories and regular files, nothing
            // else: a link (or fifo, or device) in a release archive is
            // either an attack or a layout we have never seen. Refuse it,
            // never follow it out of the tree.
            other => {
                return Err(io::Error::other(format!(
                    "archive entry {} is not a plain file ({other:?})",
                    entry_path.display()
                )));
            }
        }
    }
    Ok(())
}

/// `into` joined with an entry's path, refusing anything that would land
/// outside it. An absolute entry path replaces the destination when joined,
/// and a `..` climbs out of it; a release archive has no reason to carry
/// either, and `llama-server` unpacked into /tmp is the least of what that
/// buys an attacker.
fn inside(into: &Path, entry: &Path) -> io::Result<PathBuf> {
    let mut dest = into.to_path_buf();
    for component in entry.components() {
        match component {
            Component::Normal(part) => dest.push(part),
            Component::CurDir => {}
            _ => {
                return Err(io::Error::other(format!(
                    "archive entry {} escapes the destination",
                    entry.display()
                )));
            }
        }
    }
    Ok(dest)
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
    /// server inside it, written with the Unix exec bit so each extraction
    /// path's permission handling is exercised too.
    fn fake_release_zip(path: &Path) {
        let file = std::fs::File::create(path).expect("create archive");
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions =
            zip::write::FileOptions::default().unix_permissions(0o755);
        zip.add_directory("bin", options).expect("dir entry");
        zip.start_file("bin/llama-server", options).expect("entry");
        zip.write_all(b"#!not really a server").expect("bytes");
        zip.finish().expect("finish");
    }

    fn tar_header(kind: tar::EntryType, mode: u32, len: u64) -> tar::Header {
        let mut header = tar::Header::new_gnu();
        header.set_entry_type(kind);
        header.set_mode(mode);
        header.set_size(len);
        header.set_cksum();
        header
    }

    fn fake_release_tar_gz(path: &Path) {
        let file = std::fs::File::create(path).expect("create archive");
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(
            file,
            flate2::Compression::default(),
        ));
        let mut header = tar_header(tar::EntryType::Directory, 0o755, 0);
        tar.append_data(&mut header, "bin", io::empty())
            .expect("dir entry");
        let body = b"#!not really a server";
        let mut header = tar_header(tar::EntryType::Regular, 0o755, body.len() as u64);
        tar.append_data(&mut header, "bin/llama-server", io::Cursor::new(body))
            .expect("file entry");
        tar.into_inner().expect("inner").finish().expect("finish");
    }

    /// A "release" that means harm: a `..` entry that climbs out of the
    /// destination, then a symlink pointing back up the tree with a payload
    /// written through it. The `..` entry comes first, so the guard has to
    /// refuse before anything else in the archive is even looked at. The
    /// headers are hand-built because the tar crate's builder refuses to
    /// write the very names this test needs.
    fn hostile_release_tar_gz(path: &Path) {
        let mut tar_bytes = Vec::new();
        raw_entry(&mut tar_bytes, "../escape.txt", b'0', b"escaped", b"");
        raw_entry(&mut tar_bytes, "out", b'2', b"", b"..");
        raw_entry(&mut tar_bytes, "out/payload.txt", b'0', b"payload", b"");
        tar_bytes.extend_from_slice(&[0u8; 1024]); // end-of-archive marker
        let file = std::fs::File::create(path).expect("create archive");
        let mut gz = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        gz.write_all(&tar_bytes).expect("tar bytes");
        gz.finish().expect("finish");
    }

    /// One 512-byte ustar header plus its data, checksum included.
    fn raw_entry(tar: &mut Vec<u8>, name: &str, typeflag: u8, data: &[u8], link: &[u8]) {
        let mut header = [0u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        header[100..107].copy_from_slice(b"0000644"); // mode
        header[108..115].copy_from_slice(b"0000000"); // uid
        header[116..123].copy_from_slice(b"0000000"); // gid
        let size = format!("{:011o}\0", data.len());
        header[124..136].copy_from_slice(size.as_bytes());
        header[136..147].copy_from_slice(b"00000000000"); // mtime
        header[156] = typeflag;
        header[157..157 + link.len()].copy_from_slice(link);
        header[257..262].copy_from_slice(b"ustar");
        header[263..265].copy_from_slice(b"00");
        for byte in &mut header[148..156] {
            *byte = b' '; // the checksum counts itself as spaces
        }
        let sum: usize = header.iter().map(|b| *b as usize).sum();
        header[148..156].copy_from_slice(format!("{:06o}\0 ", sum).as_bytes());
        tar.extend_from_slice(&header);
        tar.extend_from_slice(data);
        let padding = (512 - data.len() % 512) % 512;
        tar.extend(std::iter::repeat_n(0u8, padding));
    }

    #[test]
    fn an_extracted_archive_yields_a_runnable_server_path() {
        for (format, build) in [
            (ArchiveFormat::Zip, fake_release_zip as fn(&Path)),
            (ArchiveFormat::TarGz, fake_release_tar_gz),
        ] {
            let dir =
                std::env::temp_dir().join(format!("kalsa-runtime-extract-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("mkdir");
            let archive = dir.join("release");
            build(&archive);
            let into = dir.join("builds").join("test");
            extract(&archive, format, &into).expect("extract");
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
    }

    #[test]
    fn a_tar_entry_cannot_escape_the_destination() {
        let dir =
            std::env::temp_dir().join(format!("kalsa-runtime-hostile-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let archive = dir.join("hostile.tar.gz");
        hostile_release_tar_gz(&archive);
        let into = dir.join("into");
        let err = extract(&archive, ArchiveFormat::TarGz, &into)
            .expect_err("an entry that climbs out must be refused");
        assert!(err.to_string().contains("escapes the destination"), "{err}");
        // The `..` entry would have landed here, one level above the
        // destination; the symlink's payload two levels above.
        assert!(
            !dir.join("escape.txt").exists(),
            "an entry escaped the destination"
        );
        assert!(
            !dir.join("payload.txt").exists(),
            "a symlinked entry escaped"
        );
        assert!(
            !into.join("out").exists(),
            "a symlink out of the tree must never be created"
        );
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
