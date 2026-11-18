//! Verified tar.gz extraction: no absolute paths, no `..`, no escaping links.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use flate2::read::GzDecoder;
use tar::Archive;

fn safe_relative(path: &Path) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for part in path.components() {
        match part {
            Component::Normal(name) => out.push(name),
            _ => return Err(format!("unsafe archive entry {}", path.display())),
        }
    }
    if out.as_os_str().is_empty() {
        Err("empty archive entry".to_string())
    } else {
        Ok(out)
    }
}

const MAX_ENTRIES: usize = 10_000;
const MAX_EXPANDED: u64 = 4 * 1024 * 1024 * 1024;

/// Unpacks `archive` into `into`. Modes are masked to 0o755/0o644, symlinks
/// must stay in-tree, hardlinks are refused, and expansion is capped.
pub fn extract_tar_gz(archive: &Path, into: &Path, archive_size: u64) -> Result<(), String> {
    let cap = archive_size.saturating_mul(20).min(MAX_EXPANDED);
    let mut expanded = 0u64;
    let file = fs::File::open(archive).map_err(|error| error.to_string())?;
    let mut entries = Archive::new(GzDecoder::new(file));
    let entries = entries
        .entries()
        .map_err(|error| error.to_string())?;
    for (index, entry) in entries.enumerate() {
        if index >= MAX_ENTRIES { return Err("too many archive entries".to_string()); }
        let mut entry = entry.map_err(|error| error.to_string())?;
        expanded = expanded
            .checked_add(entry.header().size().map_err(|error| error.to_string())?)
            .ok_or_else(|| "archive expansion overflowed".to_string())?;
        if expanded > cap { return Err("archive expands beyond the size cap".to_string()); }
        let name = entry.path().map_err(|error| error.to_string())?.into_owned();
        let relative = safe_relative(&name)?;
        let destination = into.join(relative);
        fs::create_dir_all(destination.parent().unwrap_or(into)).map_err(|error| error.to_string())?;
        match entry.header().entry_type() {
            tar::EntryType::Directory => fs::create_dir_all(&destination).map_err(|error| error.to_string())?,
            tar::EntryType::Regular => {
                entry.unpack(&destination).map_err(|error| error.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mode = entry.header().mode().map_err(|error| error.to_string())? & 0o777;
                    let safe = if mode & 0o111 != 0 { 0o755 } else { 0o644 };
                    fs::set_permissions(&destination, fs::Permissions::from_mode(safe))
                        .map_err(|error: io::Error| error.to_string())?;
                }
            }
            tar::EntryType::Symlink => {
                let target = entry.link_name().map_err(|error| error.to_string())?
                    .ok_or_else(|| "archive link has no target".to_string())?;
                safe_relative(&target)?;
                if destination.exists() { fs::remove_file(&destination).map_err(|error| error.to_string())?; }
                #[cfg(unix)]
                std::os::unix::fs::symlink(target.as_ref(), &destination)
                    .map_err(|error| error.to_string())?;
            }
            other => return Err(format!("unsupported archive entry {other:?}")),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;

    fn traversal_archive() -> PathBuf {
        let path = std::env::temp_dir().join(format!("m3a-extract-{}.tar.gz", std::process::id()));
        let mut tar = Vec::new();
        let mut header = [0u8; 512];
        header[..10].copy_from_slice(b"../escape\0");
        header[100..108].copy_from_slice(b"0000644\0");
        header[108..116].copy_from_slice(b"0000000\0");
        header[116..124].copy_from_slice(b"0000000\0");
        header[124..136].copy_from_slice(b"00000000003\0");
        header[136..148].copy_from_slice(b"00000000000\0");
        header[148..156].copy_from_slice(b"        ");
        header[156] = b'0';
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        let sum: u32 = header.iter().map(|byte| *byte as u32).sum();
        header[148..156].copy_from_slice(format!("{sum:06o}\0 ").as_bytes());
        tar.extend_from_slice(&header);
        let mut body = [0u8; 512];
        body[..3].copy_from_slice(b"bad");
        tar.extend_from_slice(&body);
        tar.extend_from_slice(&[0u8; 1024]);
        let file = fs::File::create(&path).unwrap();
        let mut gz = GzEncoder::new(file, flate2::Compression::fast());
        use std::io::Write;
        gz.write_all(&tar).unwrap();
        gz.finish().unwrap();
        path
    }

    #[test]
    fn extraction_rejects_traversal() {
        let archive = traversal_archive();
        let into = std::env::temp_dir().join(format!("m3a-extract-out-{}", std::process::id()));
        assert!(extract_tar_gz(&archive, &into, 64).is_err());
        assert!(!into.join("../escape").exists());
        let _ = fs::remove_file(archive);
    }
}
