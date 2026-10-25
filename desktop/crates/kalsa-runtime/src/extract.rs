//! Unpacking a verified archive, and finding the server inside it.
//!
//! The archive format is a fact the asset table states (macOS ships tar.gz,
//! every Windows row is a zip), so extraction dispatches on what it is
//! handed and never sniffs file names at the far end. Both paths keep the
//! same threat model, deliberately: no entry escapes the destination
//! ([`inside`]), no link resolves outside the tree — and the zip path
//! refuses links outright, because none is legitimate in the Windows
//! archives and creating one there is a privilege anyway; the tar path
//! permits only *in-tree* relative links, because the release itself ships
//! dylib versioning links and refusing them would break every real macOS
//! archive. Nothing that is not a regular file is ever returned as the
//! executable, and the exec bit survives, because a `llama-server` that
//! cannot be executed is the same failure as a missing one. The zip path
//! gets its own loop for all of this: the zip crate's own `extract` creates
//! symlinks on Unix (its `read.rs` calls `std::os::unix::fs::symlink`), so
//! an archive carrying `bin/llama-server -> /anywhere` would extract, be
//! found, and be executed.

use std::io;
use std::path::{Component, Path, PathBuf};

use flate2::read::GzDecoder;
use zip::ZipArchive;

use crate::assets::ArchiveFormat;

/// Deepest nesting the exe search will descend.
const MAX_DEPTH: usize = 4;

/// Every name the server binary may be shipped under, in the order the
/// search prefers them.
///
/// Two provenances have to coexist while the migration runs: the ggml-org
/// rows carry the upstream `llama-server`, and the engine fork renames only
/// the packaged artifact (its CMake target stays upstream `llama-server`),
/// so its rows carry `kalsa-server`. One search has to find a build
/// directory extracted from either. Windows archives carry the `.exe`
/// suffix, so that is the whole difference between the two lists.
///
/// The upstream name comes first because it is the only name a build of
/// this code older than the fork rename could have produced: on a tree that
/// somehow holds both, the new search then agrees with the old one about
/// which binary the marker digest was computed against.
///
/// `pub(crate)` so the fixtures in this crate's other test modules can build
/// the name this platform's extractor actually looks for, instead of
/// hard-coding the Unix spelling and passing vacuously — or failing — on
/// Windows.
#[cfg(windows)]
pub(crate) const SERVER_NAMES: [&str; 2] = ["llama-server.exe", "kalsa-server.exe"];
#[cfg(not(windows))]
pub(crate) const SERVER_NAMES: [&str; 2] = ["llama-server", "kalsa-server"];

/// Extracts the archive into `into`, which is created if missing.
pub(crate) fn extract(archive: &Path, format: ArchiveFormat, into: &Path) -> io::Result<()> {
    std::fs::create_dir_all(into)?;
    match format {
        ArchiveFormat::Zip => extract_zip(archive, into),
        ArchiveFormat::TarGz => extract_tar_gz(archive, into),
    }
}

/// The zip path, by hand, under the same guard as the tar path: every entry
/// name goes through [`inside`], and anything that is not a directory or a
/// regular file is refused. The crate's own `extract` would create symlinks
/// (on Unix) and resolve names its own way — two extractors, two threat
/// models, is not a defensible position.
fn extract_zip(archive: &Path, into: &Path) -> io::Result<()> {
    let file = std::fs::File::open(archive)?;
    let mut zip = ZipArchive::new(file).map_err(|e| {
        io::Error::other(format!(
            "{} is not a readable archive: {e}",
            archive.display()
        ))
    })?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index)?;
        let entry_path = PathBuf::from(entry.name());
        let dest = inside(into, &entry_path)?;
        if entry.is_dir() {
            std::fs::create_dir_all(&dest)?;
            continue;
        }
        // A symlink (or any exotic entry) in a release archive is either an
        // attack or a layout we have never seen: refuse it, never create it,
        // never follow it out of the tree.
        if entry.is_symlink() {
            return Err(io::Error::other(format!(
                "archive entry {} is a symlink",
                entry_path.display()
            )));
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = std::fs::File::create(&dest)?;
        std::io::copy(&mut entry, &mut out)?;
        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            if mode != 0 {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(mode & 0o7777))?;
            }
        }
    }
    Ok(())
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
            // The release itself ships links — dylib versioning
            // (`libggml.dylib -> libggml.0.dylib`) — so links are allowed,
            // but only where they stay inside the destination: the target
            // of a symlink resolves against the link's own directory, the
            // target of a hard link against the archive root, and either an
            // absolute target or one that climbs out is refused like any
            // other escaping entry. (And find_server never hands back a
            // link as the executable.)
            kind @ (tar::EntryType::Symlink | tar::EntryType::Link) => {
                let Some(target) = entry.link_name()? else {
                    return Err(io::Error::other(format!(
                        "archive entry {} is a link with no target",
                        entry_path.display()
                    )));
                };
                let resolved = match kind {
                    tar::EntryType::Symlink => {
                        entry_path.parent().unwrap_or(Path::new("")).join(&target)
                    }
                    _ => target.into_owned(),
                };
                inside(into, &resolved)?;
                entry.unpack(&dest)?;
            }
            // A fifo, a device, anything else: a layout we have never seen.
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

/// A candidate the walk found: `(name rank, directory depth, path)`.
type Candidate = (usize, usize, PathBuf);

/// Finds the server under `dir`, under either accepted name, if a previous
/// extraction left one. Only a regular file qualifies: `file_type` is an
/// lstat, so a symlink (or a fifo, or anything planted to look like the
/// server) is not the binary we extracted and is never returned, whatever
/// its name.
///
/// The winner is chosen by a total order over the whole tree, not by the
/// directory the walk reaches first and not by `read_dir` order: accepted
/// name rank first (upstream `llama-server` before the fork's
/// `kalsa-server`), then the shallowest directory, then the
/// lexicographically smallest path. Rank leads, so a `kalsa-server` beside
/// the root cannot shadow an upstream binary one level down. Rank leads
/// because the upstream name is the only one a build of this code older
/// than the fork rename could have produced: an already-assembled build
/// directory then resolves to the same binary the marker digest was
/// computed against, rather than switching executables under a marker that
/// describes the other one.
pub(crate) fn find_server(dir: &Path) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    collect(dir, 0, &mut candidates);
    candidates.into_iter().min().map(|(_, _, path)| path)
}

/// Records every regular-file candidate under `dir`, with the rank of the
/// accepted name that matched and the depth of the directory holding it.
/// Depth is that directory's recursion depth with `dir` at 0, and the walk
/// is bounded by [`MAX_DEPTH`]. A symlink, a fifo, a device — anything
/// `file_type` (an lstat) does not call a regular file — is never recorded,
/// whatever its name says.
fn collect(dir: &Path, depth: usize, out: &mut Vec<Candidate>) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            collect(&entry.path(), depth + 1, out);
            continue;
        }
        // Not is_dir() and not is_file() — a symlink, a fifo, a device — is
        // not the binary we extracted, whatever its name says.
        if !kind.is_file() {
            continue;
        }
        if let Some(rank) = SERVER_NAMES
            .iter()
            .position(|name| entry.file_name() == *name)
        {
            out.push((rank, depth, entry.path()));
        }
    }
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
        zip.start_file(format!("bin/{}", SERVER_NAMES[0]), options)
            .expect("entry");
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
        tar.append_data(
            &mut header,
            format!("bin/{}", SERVER_NAMES[0]),
            io::Cursor::new(body),
        )
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
        const MODE_644: &[u8; 7] = b"0000644";
        raw_entry(
            &mut tar_bytes,
            "../escape.txt",
            MODE_644,
            b'0',
            b"escaped",
            b"",
        );
        raw_entry(&mut tar_bytes, "out", MODE_644, b'2', b"", b"..");
        raw_entry(
            &mut tar_bytes,
            "out/payload.txt",
            MODE_644,
            b'0',
            b"payload",
            b"",
        );
        tar_bytes.extend_from_slice(&[0u8; 1024]); // end-of-archive marker
        let file = std::fs::File::create(path).expect("create archive");
        let mut gz = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        gz.write_all(&tar_bytes).expect("tar bytes");
        gz.finish().expect("finish");
    }

    /// One 512-byte ustar header plus its data, checksum included.
    fn raw_entry(
        tar: &mut Vec<u8>,
        name: &str,
        mode: &[u8; 7],
        typeflag: u8,
        data: &[u8],
        link: &[u8],
    ) {
        let mut header = [0u8; 512];
        header[..name.len()].copy_from_slice(name.as_bytes());
        header[100..107].copy_from_slice(mode);
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
            assert!(
                SERVER_NAMES.iter().any(|name| exe.ends_with(name)),
                "found {}",
                exe.display()
            );
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
    fn tar_links_stay_inside_the_tree_or_are_refused() {
        // The release ships dylib versioning links, so in-tree relative
        // links must survive extraction; a link whose target climbs out or
        // is absolute must be refused. Both in one archive, escaping entry
        // last: extraction aborts there, with the in-tree link already laid.
        let dir = std::env::temp_dir().join(format!("kalsa-runtime-links-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let archive = dir.join("links.tar.gz");
        let mut tar_bytes = Vec::new();
        const MODE_755: &[u8; 7] = b"0000755";
        raw_entry(&mut tar_bytes, "bin/", MODE_755, b'5', b"", b"");
        raw_entry(
            &mut tar_bytes,
            "bin/real",
            MODE_755,
            b'0',
            b"the real bytes",
            b"",
        );
        raw_entry(&mut tar_bytes, "bin/alias", MODE_755, b'2', b"", b"real");
        raw_entry(&mut tar_bytes, "escape", MODE_755, b'2', b"", b"../..");
        tar_bytes.extend_from_slice(&[0u8; 1024]);
        let file = std::fs::File::create(&archive).expect("create archive");
        let mut gz = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        gz.write_all(&tar_bytes).expect("tar bytes");
        gz.finish().expect("finish");

        let into = dir.join("into");
        let err = match extract(&archive, ArchiveFormat::TarGz, &into) {
            Ok(()) => panic!("should have failed"),
            Err(e) => {
                let mut source: Option<&(dyn std::error::Error + 'static)> = Some(&e);
                while let Some(inner) = source {
                    eprintln!("ERR: {inner}");
                    source = inner.source();
                }
                e
            }
        };
        assert!(err.to_string().contains("escapes the destination"), "{err}");
        #[cfg(unix)]
        {
            let alias = into.join("bin").join("alias");
            let kind = std::fs::symlink_metadata(&alias).expect("the in-tree link is laid");
            assert!(kind.is_symlink(), "the in-tree link is a link");
        }
        let _ = std::fs::remove_dir_all(&dir);
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
    fn a_zip_entry_cannot_be_a_symlink_either() {
        // The same attack the tar path refuses, on the zip path: an archive
        // whose `llama-server` is a link to anywhere else. The zip crate's
        // own extract would create the link on Unix and hand us the attack.
        let dir = std::env::temp_dir().join(format!("kalsa-runtime-zlink-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let archive = dir.join("hostile.zip");
        let file = std::fs::File::create(&archive).expect("create archive");
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions =
            zip::write::FileOptions::default().unix_permissions(0o777);
        zip.add_symlink(format!("bin/{}", SERVER_NAMES[0]), "/bin/bash", options)
            .expect("symlink entry");
        zip.finish().expect("finish");
        let into = dir.join("into");
        let err = extract(&archive, ArchiveFormat::Zip, &into)
            .expect_err("a symlink entry must be refused, never created");
        assert!(err.to_string().contains("symlink"), "{err}");
        assert!(
            !SERVER_NAMES
                .iter()
                .any(|name| into.join("bin").join(name).exists()),
            "the link must not exist under any name we would execute"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_symlink_is_never_mistaken_for_the_server() {
        // Whatever planted it, a link named like the server is not a file we
        // extracted, and find_server must not hand it to Command::new.
        let dir =
            std::env::temp_dir().join(format!("kalsa-runtime-findsymlink-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin")).expect("mkdir");
        #[cfg(unix)]
        std::os::unix::fs::symlink("/bin/bash", dir.join("bin").join(SERVER_NAMES[0]))
            .expect("symlink");
        assert_eq!(find_server(&dir), None, "a symlink is not the server");
        #[cfg(unix)]
        std::os::unix::fs::symlink("/bin/bash", dir.join("bin").join(SERVER_NAMES[1]))
            .expect("symlink");
        assert_eq!(find_server(&dir), None, "nor is one under the fork's name");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn inside_refuses_climbing_and_absolute_entries() {
        let dest = Path::new("/somewhere/safe");
        for hostile in ["../climbs", "a/../../climbs", "/absolute"] {
            assert!(
                inside(dest, Path::new(hostile)).is_err(),
                "{hostile} must be refused"
            );
        }
        assert!(inside(dest, Path::new("nested/ok")).is_ok());
    }

    /// A tar.gz that stands in for a fork release: the server under the
    /// fork's packaged name, and a dylib beside it that the search has to
    /// leave alone because it is not the executable.
    fn fake_fork_tar_gz(path: &Path) {
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
        tar.append_data(
            &mut header,
            format!("bin/{}", SERVER_NAMES[1]),
            io::Cursor::new(body),
        )
        .expect("file entry");
        let dylib = b"not really a dylib";
        let mut header = tar_header(tar::EntryType::Regular, 0o755, dylib.len() as u64);
        tar.append_data(&mut header, "bin/libggml.dylib", io::Cursor::new(dylib))
            .expect("dylib entry");
        tar.into_inner().expect("inner").finish().expect("finish");
    }

    #[test]
    fn a_fork_named_server_is_found_after_extraction() {
        // The fork's packaging renames the shipped binary to `kalsa-server`
        // (the CMake target stays upstream `llama-server`), so the same
        // extractor has to accept both names or every fork row assembles and
        // then reports NoExecutable.
        let dir = std::env::temp_dir().join(format!("kalsa-runtime-fork-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let archive = dir.join("fork.tar.gz");
        fake_fork_tar_gz(&archive);
        let into = dir.join("into");
        extract(&archive, ArchiveFormat::TarGz, &into).expect("extract");
        let exe = find_server(&into).expect("the fork-named server must be found");
        assert!(exe.ends_with(SERVER_NAMES[1]), "found {}", exe.display());
        assert!(exe.is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&exe).expect("meta").permissions().mode();
            assert_ne!(mode & 0o111, 0, "the exec bit must survive extraction");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn when_both_names_are_present_the_upstream_one_wins() {
        // A tree can hold both only if two extractions were overlaid. The
        // search still has to be reproducible, and it resolves to the name
        // an older build of this code would have produced, so a directory
        // assembled before the fork rows existed keeps resolving to the
        // same binary.
        let dir =
            std::env::temp_dir().join(format!("kalsa-runtime-bothnames-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin")).expect("mkdir");
        std::fs::write(dir.join("bin").join(SERVER_NAMES[1]), b"the fork binary").expect("write");
        std::fs::write(
            dir.join("bin").join(SERVER_NAMES[0]),
            b"the upstream binary",
        )
        .expect("write");
        let found = find_server(&dir).expect("one of them");
        assert!(
            found.ends_with(SERVER_NAMES[0]),
            "the first accepted name wins, found {}",
            found.display()
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_upstream_name_wins_across_directories_too() {
        // The choice has to be global, not directory-local: a shallow
        // `kalsa-server` must not shadow the upstream binary one level down,
        // because an already-assembled build directory holds the upstream
        // name and the marker digest on disk was computed against it.
        let dir =
            std::env::temp_dir().join(format!("kalsa-runtime-crossdir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bin")).expect("mkdir");
        std::fs::write(dir.join(SERVER_NAMES[1]), b"the fork binary").expect("write");
        std::fs::write(
            dir.join("bin").join(SERVER_NAMES[0]),
            b"the upstream binary",
        )
        .expect("write");
        let found = find_server(&dir).expect("the upstream binary one level down");
        assert_eq!(found, dir.join("bin").join(SERVER_NAMES[0]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_server_nested_below_the_root_is_found() {
        // Releases put the server in `bin/` (depth 1); some layouts nest one
        // further. Depth here is the recursion depth of the directory that
        // holds the binary, with the root at 0.
        let dir = std::env::temp_dir().join(format!("kalsa-runtime-nested-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let nested = dir.join("a").join("b");
        std::fs::create_dir_all(&nested).expect("mkdirs");
        std::fs::write(nested.join(SERVER_NAMES[1]), b"the fork binary").expect("write");
        let found = find_server(&dir).expect("depth 2 must be searched");
        assert_eq!(found, nested.join(SERVER_NAMES[1]));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_walk_stops_after_max_depth() {
        // Depth is the recursion depth of the directory that holds the
        // binary, with the root at 0: `a/b/c/d/<server>` is depth 4 and is
        // found, `a/b/c/d/e/<server>` is depth 5 and is out of bounds.
        let dir = std::env::temp_dir().join(format!("kalsa-runtime-depth-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let at_max = dir.join("a").join("b").join("c").join("d");
        std::fs::create_dir_all(&at_max).expect("mkdirs");
        std::fs::write(at_max.join(SERVER_NAMES[1]), b"depth four").expect("write");
        assert_eq!(
            find_server(&dir),
            Some(at_max.join(SERVER_NAMES[1])),
            "depth {MAX_DEPTH} must still be searched"
        );

        // One directory deeper: neither name may extend the walk, so the
        // depth-4 binary is removed first to prove the depth-5 one is the
        // only candidate left.
        let too_deep = at_max.join("e");
        std::fs::create_dir_all(&too_deep).expect("mkdir");
        std::fs::remove_file(at_max.join(SERVER_NAMES[1])).expect("remove");
        std::fs::write(too_deep.join(SERVER_NAMES[1]), b"depth five").expect("write");
        assert_eq!(
            find_server(&dir),
            None,
            "depth {} must not be searched",
            MAX_DEPTH + 1
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Creates a fifo at `path` with `mkfifo(3)`. `libc` is already a
    /// `cfg(unix)` dependency of this crate, so this adds no dependency and
    /// starts no subprocess.
    #[cfg(unix)]
    fn make_fifo(path: &Path) -> bool {
        use std::os::unix::ffi::OsStrExt;
        let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
            return false;
        };
        // SAFETY: mkfifo reads only the NUL-terminated path it is handed.
        unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) == 0 }
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_never_mistaken_for_the_server() {
        // A fifo has a name but is not a program: reading it blocks on a
        // writer, and `file_type` does not call it a regular file, so
        // find_server must refuse it under either accepted name.
        let dir = std::env::temp_dir().join(format!("kalsa-runtime-fifo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        for name in SERVER_NAMES {
            assert!(make_fifo(&dir.join(name)), "mkfifo must succeed for {name}");
        }
        assert_eq!(find_server(&dir), None, "a fifo is not the server");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_without_a_server_yields_none() {
        let dir =
            std::env::temp_dir().join(format!("kalsa-runtime-noserver-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("a").join("b").join("c").join("d").join("e"))
            .expect("mkdirs");
        // Near-miss names: neither may be taken for the server, so the
        // neither-name case is exercised with files present, not just an
        // empty tree.
        std::fs::write(dir.join("a").join("llama_server"), b"no").expect("decoy");
        std::fs::write(
            dir.join("a")
                .join("b")
                .join(format!("{}-old", SERVER_NAMES[1])),
            b"no",
        )
        .expect("decoy");
        assert_eq!(find_server(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
