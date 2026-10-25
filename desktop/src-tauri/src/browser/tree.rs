//! Whether a directory is the driver this build pinned — answered by comparing
//! one digest over the whole tree against one digest built by the release
//! pipeline.
//!
//! The archive's own sha256 proves the bytes arrived intact and says nothing
//! about the directory afterwards. An earlier version wrote a manifest of every
//! file next to the driver and re-read it at launch; that was the same idea with
//! a weakness: a manifest beside the thing it describes can be rewritten by
//! whoever replaced the thing. So there is no file on disk at all now. The pin
//! lives in `driver_pins.json`, compiled in, and the only question at launch is
//! whether this directory hashes to it.
//!
//! **The recipe, which two implementations must agree on byte for byte**
//! (`scripts/build-driver-archive.mjs`, `treeDigest`):
//!
//! 1. every regular file under the root, named with `/` between parts, walked
//!    and **sorted by that name** so the order is the same on every machine;
//! 2. the sha256 of its bytes, lower-case hex;
//! 3. each of those two into one hasher as `path\0digest\n`;
//! 4. the tree digest is that hasher's hex.
//!
//! **Why the mode is not in it.** It was, and it made the digest unmatchable on
//! Windows: the build script reads `node.exe` as 0755 out of a tar header it
//! wrote itself, and a tree unpacked on Windows has no executable bit to
//! compare against, so a pin produced on one platform could never be met on the
//! other. A mode is not content — the same file with the same bytes is the same
//! file whatever the filesystem calls it.
//!
//! **What is given up, and what stands in for it.** On unix the executable bit
//! is what lets `node` start, so losing it is a real failure — and it is now
//! checked where it is actually needed: `driver::status` refuses to call a tree
//! installed unless its `node` can be executed, so a driver whose runtime cannot
//! run is one the browser is never offered. Nothing here pretends to notice a
//! lost bit; nothing needs to.
//!
//! A symlink, or anything that is not a regular file or a directory, refuses the
//! whole tree: a driver has no links, and one is a way out of the root.

use std::collections::BTreeMap;
use std::path::Path;

use sha2::{Digest, Sha256};

use super::error::BrowserError;

/// The digest of what is actually in `dir`, as the recipe above spells it.
pub(crate) fn digest_of(dir: &Path) -> Result<String, BrowserError> {
    let mut names: BTreeMap<String, ()> = BTreeMap::new();
    collect(dir, dir, &mut names)?;

    let mut hasher = Sha256::new();
    for name in names.keys() {
        let body = std::fs::read(dir.join(name)).map_err(|_| BrowserError::Changed)?;
        hasher.update(name.as_bytes());
        hasher.update([0]);
        hasher.update(digest_of_bytes(&body).as_bytes());
        hasher.update([b'\n']);
    }
    Ok(hex(&hasher.finalize()))
}

/// Whether `dir` holds the driver this build pins.
pub(crate) fn matches(dir: &Path, expected: &str) -> Result<(), BrowserError> {
    if digest_of(dir)? == expected.to_ascii_lowercase() {
        Ok(())
    } else {
        Err(BrowserError::Changed)
    }
}

/// Every regular file under `root`, named relative to it with `/` parts.
fn collect(root: &Path, at: &Path, files: &mut BTreeMap<String, ()>) -> Result<(), BrowserError> {
    for entry in std::fs::read_dir(at).map_err(|_| BrowserError::Changed)? {
        let entry = entry.map_err(|_| BrowserError::Changed)?;
        let kind = entry.file_type().map_err(|_| BrowserError::Changed)?;
        if kind.is_dir() {
            collect(root, &entry.path(), files)?;
            continue;
        }
        // A link, a socket, a device: none of them belongs in a driver, and
        // reading one is how a tree digest would follow a path out of the root.
        if !kind.is_file() {
            return Err(BrowserError::Changed);
        }
        let name = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| BrowserError::Changed)?
            .components()
            .map(|component| component.as_os_str().to_str().ok_or(BrowserError::Changed))
            .collect::<Result<Vec<&str>, BrowserError>>()?
            .join("/");
        files.insert(name, ());
    }
    Ok(())
}

/// The sha256 of some bytes, as the recipe spells it.
pub(crate) fn digest_of_bytes(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-tree-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("package")).expect("scratch dir");
        dir
    }

    fn driver(dir: &Path) {
        std::fs::write(dir.join("node"), "runtime").expect("node");
        std::fs::write(dir.join("package/cli.js"), "console.log(1)").expect("cli");
    }

    #[test]
    fn the_same_tree_hashes_the_same_way_every_time() {
        let dir = scratch("stable");
        driver(&dir);
        assert_eq!(digest_of(&dir).expect("hashed"), digest_of(&dir).expect("hashed again"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn one_byte_changed_is_a_different_tree() {
        let dir = scratch("bytes");
        driver(&dir);
        let before = digest_of(&dir).expect("hashed");
        std::fs::write(dir.join("package/cli.js"), "console.log('elsewhere')").expect("changed");
        assert_ne!(digest_of(&dir).expect("hashed"), before);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_that_appeared_or_went_is_a_different_tree() {
        let dir = scratch("extra");
        driver(&dir);
        let before = digest_of(&dir).expect("hashed");
        std::fs::write(dir.join("package/extra.js"), "// here for nothing").expect("added");
        assert_ne!(digest_of(&dir).expect("hashed"), before);
        std::fs::remove_file(dir.join("package/extra.js")).expect("removed");
        assert_eq!(digest_of(&dir).expect("hashed"), before);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The pin is the only copy of what this directory should be, so a tree that
    /// is not it is refused and never launched.
    #[test]
    fn a_tree_that_is_not_the_pinned_one_is_refused() {
        let dir = scratch("pinned");
        driver(&dir);
        let pinned = digest_of(&dir).expect("hashed");
        assert!(matches(&dir, &pinned).is_ok());
        assert!(matches(&dir, &pinned.to_uppercase()).is_ok(), "the pin is hex in any case");
        assert_eq!(matches(&dir, &"0".repeat(64)).err(), Some(BrowserError::Changed));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The mode is deliberately not in the digest, and this is the shape that
    /// made it necessary: a driver whose `node` lost its executable bit is the
    /// same *content* on every platform, and a pin that changes with the
    /// filesystem's opinion of it can never be met on Windows. What is lost with
    /// it is checked by the launcher, which refuses to run a `node` it cannot
    /// execute — see `program.rs`.
    #[cfg(unix)]
    #[test]
    fn losing_the_executable_bit_is_not_a_different_tree() {
        use std::os::unix::fs::PermissionsExt;
        let dir = scratch("mode");
        driver(&dir);
        let before = digest_of(&dir).expect("hashed");
        std::fs::set_permissions(dir.join("node"), std::fs::Permissions::from_mode(0o644)).expect("stripped");
        assert_eq!(digest_of(&dir).expect("hashed"), before, "the digest must not read the filesystem's mode");
        std::fs::set_permissions(dir.join("node"), std::fs::Permissions::from_mode(0o755)).expect("restored");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_the_driver_is_refused_rather_than_followed() {
        let dir = scratch("link");
        driver(&dir);
        std::os::unix::fs::symlink("/etc/hosts", dir.join("passwd")).expect("symlink");
        assert_eq!(digest_of(&dir).err(), Some(BrowserError::Changed));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_directory_that_is_not_there_is_not_a_tree_that_matches() {
        let dir = scratch("gone");
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(matches(&dir, &"0".repeat(64)).err(), Some(BrowserError::Changed));
    }
}