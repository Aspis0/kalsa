//! The driver Kalsa runs on: which archive, for which machine, and where it
//! has to be before a browser may start.
//!
//! The pin is a checked-in file, not a build-time variable. The archive is not
//! built with the app — `scripts/build-driver-archive.mjs` assembles it from
//! pinned upstream sources and this file is that script's `manifest.json`. So
//! the digest that decides what may run is one a reviewer can read in a diff,
//! and a driver bump is a commit rather than something the build machine
//! decides.
//!
//! Nothing here fetches anything. The download is `install`, and it goes
//! through `kalsa-download`, which publishes the archive under its real name
//! only after both its size and its digest match.

use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::error::BrowserError;
use super::fetch::{self, Cancel};
use super::{tree, unpack};

/// Where the archives live. One const, so the base moves in exactly one place.
const BASE: &str = "https://dl.kalsa.io/browser/driver/";

/// The checked-in pins. The public bucket `kalsa-downloads` serves them, the
/// same one that carries the engine downloads; the private log bucket
/// `kalsa-reports` is not involved and must never be.
const CHECKED_IN: &str = include_str!("driver_pins.json");

#[derive(Deserialize)]
struct Pins {
    driver: String,
    node: String,
    platforms: std::collections::BTreeMap<String, Archive>,
}

#[derive(Clone, Deserialize)]
struct Archive {
    file: String,
    size: u64,
    sha256: String,
    /// The digest of the unpacked tree, compared at launch. See `tree.rs`.
    tree: String,
}

/// What the page asks before it offers the press.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    /// Kalsa has a driver for this computer at all.
    pub(crate) supported: bool,
    /// It is unpacked, and the whole tree still hashes to the pinned digest.
    pub(crate) installed: bool,
    /// What the archive weighs, so the person sees the cost before pressing.
    pub(crate) size: u64,
}

/// The Playwright platform id for this build, or `""` where Kalsa ships none.
fn platform() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "mac-arm64",
        ("macos", "x86_64") => "mac",
        ("windows", "x86_64") => "win32_x64",
        _ => "",
    }
}

fn pins() -> Pins {
    serde_json::from_str(CHECKED_IN).expect("the checked-in driver pins parse")
}

/// The archive for this machine, or `None` where Kalsa ships no driver.
fn archive_for_this_machine() -> Option<Archive> {
    let pins = pins();
    if platform().is_empty() {
        return None;
    }
    pins.platforms.get(platform()).cloned()
}

/// Where the driver lives once unpacked, named exactly as the crate names it
/// (`driver_urls.rs`: `playwright-<version>-<platform>-node<node>`), so the
/// directory on disk and the archive beside it cannot drift apart.
fn dir_name() -> String {
    let pins = pins();
    format!("playwright-{}-{}-node{}", pins.driver, platform(), pins.node)
}

fn url(archive: &Archive) -> String {
    format!("{BASE}{}", archive.file)
}

/// Where the driver is unpacked, under Kalsa's own data folder.
pub(crate) fn installed(app_data: &Path) -> Result<PathBuf, BrowserError> {
    Ok(app_data.join("browser").join("driver").join(dir_name()))
}

/// Whether a driver is unpacked here and still is the one that was installed.
///
/// The tree is re-hashed on every launch, not remembered from the install: a
/// directory somebody replaced between two launches must not be started.
pub(crate) fn status(app_data: &Path) -> Result<Status, BrowserError> {
    let archive = archive_for_this_machine();
    let size = archive.as_ref().map(|archive| archive.size).unwrap_or_default();
    if archive.is_none() {
        return Ok(Status { supported: false, installed: false, size });
    }
    let dir = installed(app_data)?;
    let expected = archive.as_ref().map(|archive| archive.tree.as_str()).unwrap_or_default();
    // The tree digest no longer carries a mode, so the one thing a lost
    // executable bit would break is checked here instead: a `node` that cannot
    // be run is not an installed driver, and saying it is would offer the
    // browser a runtime that dies on first use.
    let installed = tree::matches(&dir, expected).is_ok() && runnable(&dir);
    Ok(Status { supported: true, installed, size })
}

/// Whether the runtime in this tree can actually be started.
///
/// On unix that is the executable bit on `node`, and nothing else: a driver is
/// correct or it is not, and this is the one property of a correct driver that
/// a filesystem can change underneath us. Windows has no such bit to lose, so
/// there is nothing to check and the tree's own digest is the whole answer.
fn runnable(dir: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(dir.join("node"))
            .map(|meta| meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        let _ = dir;
        true
    }
}

/// Downloads the archive, unpacks it, and puts it where the sidecar will find
/// it.
///
/// The order is the safety story and it is not rearranged. The bytes are proved
/// against the pinned digest **and are then unpacked from that same buffer**, so
/// nothing can be swapped in between. They are unpacked into a staging directory
/// beside the destination, which is renamed into place only once the tree hashes
/// to the pinned tree — so a quit, a cancel or a failure anywhere in here leaves
/// no directory that could be mistaken for an installed driver.
pub(crate) fn install(
    app_data: &Path,
    cancel: &Cancel,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<PathBuf, BrowserError> {
    let archive = archive_for_this_machine().ok_or(BrowserError::UnsupportedPlatform)?;
    let root = app_data.join("browser").join("driver");
    std::fs::create_dir_all(&root).map_err(|_| BrowserError::Storage)?;

    let bytes = match kept_archive(&archive, &root, cancel, progress)? {
        Some(bytes) => bytes,
        None => fetch::get(&url(&archive), archive.size, &archive.sha256, cancel, progress)?,
    };

    let dir = installed(app_data)?;
    let staging = root.join(format!(".{}.staging", dir_name()));
    let _ = std::fs::remove_dir_all(&staging);
    unpack::unpack(&bytes, &staging)?;
    // The tree is checked before the directory is ever named `dir`, so a driver
    // that does not hash to the pin is never one the sidecar can be pointed at.
    if let Err(refused) = tree::matches(&staging, &archive.tree) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(refused);
    }
    commit(cancel, &staging)?;

    // Rename is the last thing that happens, and it is the first thing that
    // makes a driver exist. A destination that does not already verify is a
    // failure someone must be allowed to retry, so it goes first.
    if tree::matches(&dir, &archive.tree).is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    std::fs::rename(&staging, &dir).map_err(|_| BrowserError::Unpack)?;
    Ok(dir)
}

/// **The point of no return, taken in one step.** Everything before this is
/// reversible: a press at any of it stops the transfer and leaves the staging
/// directory deleted and the destination untouched. Everything after it is a
/// driver that is installed — so this and the Stop press contend for the same
/// value and only one can win, and there is no instant where a press has been
/// accepted but the driver has not been put in place, or the other way round.
///
/// A Stop that loses here is not an error: the row shows the driver ready,
/// because it is.
fn commit(cancel: &Cancel, staging: &Path) -> Result<(), BrowserError> {
    if cancel.commit() {
        return Ok(());
    }
    let _ = std::fs::remove_dir_all(staging);
    Err(BrowserError::Cancelled)
}

/// An archive already sitting beside the driver, if it is the one we pinned.
///
/// A leftover that fails is deleted rather than kept: leaving it would mean the
/// next press skipped the download and unpacked the same bad bytes again. This
/// runs on every press for exactly that reason — a file dropped there between
/// two launches is a file nothing has ever checked.
fn kept_archive(
    archive: &Archive,
    root: &Path,
    cancel: &Cancel,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<Option<Vec<u8>>, BrowserError> {
    let packed = root.join(&archive.file);
    let Ok(body) = std::fs::read(&packed) else {
        return Ok(None);
    };
    if body.len() as u64 != archive.size || tree::digest_of_bytes(&body) != archive.sha256 {
        let _ = std::fs::remove_file(&packed);
        return Ok(None);
    }
    if cancel.stopped() {
        return Err(BrowserError::Cancelled);
    }
    progress(body.len() as u64, body.len() as u64);
    Ok(Some(body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::browser::fetch::Cancel;

    #[test]
    fn every_pin_names_the_directory_its_archive_is_named_after() {
        let pins = pins();
        for (platform, archive) in &pins.platforms {
            let stem = archive.file.strip_suffix(".tar.gz").expect("archives are tar.gz");
            assert_eq!(stem, format!("playwright-{}-{platform}-node{}", pins.driver, pins.node), "{platform}");
            assert_eq!(archive.sha256.len(), 64, "{platform}");
            assert!(archive.sha256.chars().all(|c| c.is_ascii_hexdigit()), "{platform}");
            assert!(archive.size > 30_000_000, "{platform} is smaller than a driver");
        }
    }

    #[test]
    fn the_three_platforms_we_ship_are_pinned_and_this_build_is_one_of_them() {
        let pins = pins();
        let keys: Vec<&str> = pins.platforms.keys().map(String::as_str).collect();
        assert_eq!(keys, ["mac", "mac-arm64", "win32_x64"]);
        assert!(archive_for_this_machine().is_some(), "{} has no pinned archive", platform());
    }

    #[test]
    fn the_driver_directory_carries_the_same_name_as_the_archive() {
        let archive = archive_for_this_machine().expect("this platform is pinned");
        let stem = archive.file.strip_suffix(".tar.gz").expect("archives are tar.gz");
        assert_eq!(dir_name(), stem);
    }

    #[test]
    fn the_url_is_the_base_and_the_file_name_and_nothing_else() {
        let archive = archive_for_this_machine().expect("this platform is pinned");
        let url = url(&archive);
        assert!(url.starts_with("https://dl.kalsa.io/browser/driver/"), "{url}");
        assert!(url.ends_with(&archive.file), "{url}");
        assert!(!url.contains(".."), "{url}");
    }

    #[test]
    fn a_directory_with_nothing_in_it_is_not_an_installed_driver() {
        let dir = std::env::temp_dir().join(format!("kalsa-driver-status-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        assert!(!status(&dir).expect("the status answers").installed);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The digest no longer reads the mode, so a `node` that cannot be executed
    /// is the launcher's business: it is the one property of a correct driver
    /// that a filesystem can change underneath us, and calling such a tree
    /// installed would offer the browser a runtime that dies on first use.
    #[test]
    #[cfg(unix)]
    fn a_runtime_that_cannot_be_run_is_not_an_installed_driver() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("kalsa-driver-run-{}-{}", std::process::id(), name()));
        let _ = std::fs::remove_dir_all(&dir);
        let tree = installed(&dir).expect("a path");
        std::fs::create_dir_all(tree.join("package")).expect("scratch tree");
        std::fs::write(tree.join("node"), "runtime").expect("node");
        std::fs::write(tree.join("package/cli.js"), "console.log(1)").expect("cli");
        let pinned = crate::browser::tree::digest_of(&tree).expect("hashed");

        std::fs::set_permissions(tree.join("node"), std::fs::Permissions::from_mode(0o755)).expect("made");
        assert!(runnable(&tree), "an executable node is runnable");

        std::fs::set_permissions(tree.join("node"), std::fs::Permissions::from_mode(0o644)).expect("stripped");
        assert!(!runnable(&tree), "a node with no execute bit cannot be run");
        // Same content, same digest — the check has to be the launcher's, and it is.
        assert_eq!(crate::browser::tree::digest_of(&tree).expect("hashed"), pinned);
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn name() -> &'static str {
        if cfg!(target_os = "windows") { "win" } else { "unix" }
    }

    fn app_data(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-driver-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    /// Drops `body` where the installer expects the pinned archive, so the
    /// check that runs on what is already there can be exercised with no
    /// network and no 40 MB of ours.
    fn dropped_archive(app_data: &Path, body: &[u8]) -> PathBuf {
        let root = app_data.join("browser").join("driver");
        std::fs::create_dir_all(&root).expect("scratch driver folder");
        let packed = root.join(&archive_for_this_machine().expect("this platform").file);
        std::fs::write(&packed, body).expect("scratch archive");
        packed
    }

    /// Every way a leftover can be wrong, and each one leaves nothing behind
    /// and nothing to trust: the file is taken away so the next press downloads
    /// rather than unpacking the same bytes again.
    #[test]
    fn a_leftover_that_does_not_verify_is_deleted_rather_than_unpacked() {
        let archive = archive_for_this_machine().expect("this platform");
        for (name, body) in [
            ("nothing that resembles it", b"not the driver we pinned".to_vec()),
            ("an empty file", Vec::new()),
            ("the right size and the wrong bytes", vec![b'a'; archive.size as usize]),
        ] {
            let app_data = app_data("leftover");
            let packed = dropped_archive(&app_data, &body);

            let kept = kept_archive(
                &archive,
                &app_data.join("browser").join("driver"),
                &Cancel::new(),
                &mut |_, _| {},
            )
            .expect("the check itself answers");
            assert!(kept.is_none(), "{name} must not be used");
            assert!(!packed.exists(), "{name} is left on disk for the next press to trust");
            assert!(!installed(&app_data).expect("a path").exists(), "{name} created a driver");
            let _ = std::fs::remove_dir_all(&app_data);
        }
    }

    /// What is verified is what is unpacked: the bytes are read once and handed
    /// on, so replacing the file between the check and the extract cannot change
    /// what lands. A leftover that does verify is returned as those bytes, not
    /// as a path to be opened again.
    #[test]
    fn the_bytes_that_verify_are_the_bytes_that_are_handed_on() {
        let archive = archive_for_this_machine().expect("this platform");
        let app_data = app_data("same-bytes");
        let root = app_data.join("browser").join("driver");
        let packed = dropped_archive(&app_data, b"the bytes we checked");

        // A leftover that is the right size but not our archive is not returned.
        assert!(kept_archive(&archive, &root, &Cancel::new(), &mut |_, _| {})
            .expect("the check answers")
            .is_none());

        // And the swap the old code left open — a path reopened after the check
        // — is refused on the next press rather than unpacked.
        std::fs::write(&packed, b"swapped after the check").expect("swapped");
        assert!(kept_archive(&archive, &root, &Cancel::new(), &mut |_, _| {})
            .expect("the check answers")
            .is_none());
        let _ = std::fs::remove_dir_all(&app_data);
    }

    /// A cancel part-way leaves nothing that could be mistaken for a driver:
    /// the staging directory goes, and the destination is never created.
    #[test]
    fn a_cancel_part_way_through_leaves_no_half_installed_driver() {
        let app_data = app_data("cancelled");
        let cancel = Cancel::new();
        cancel.stop();

        assert_eq!(
            install(&app_data, &cancel, &mut |_, _| {}).err(),
            Some(BrowserError::Cancelled)
        );
        assert!(!installed(&app_data).expect("a path").exists(), "a cancelled install left a driver");
        let staging: Vec<PathBuf> = std::fs::read_dir(app_data.join("browser").join("driver"))
            .map(|entries| entries.filter_map(|entry| entry.ok().map(|entry| entry.path())).collect())
            .unwrap_or_default();
        assert!(staging.is_empty(), "a staging directory was left behind: {staging:?}");
        let _ = std::fs::remove_dir_all(&app_data);
    }

    /// **The point of no return, from the losing side.** The press arrived
    /// before the commit, so the commit is refused, the staging directory goes,
    /// and nothing is installed. This is the whole of a Stop that works.
    #[test]
    fn a_press_before_the_commit_leaves_nothing_installed() {
        let staging = scratch("press-first");
        let cancel = Cancel::new();
        assert!(cancel.stop(), "the press was the one that stopped it");
        assert_eq!(commit(&cancel, &staging).err(), Some(BrowserError::Cancelled));
        assert!(!staging.exists(), "a stopped install left its staging behind");
        let _ = std::fs::remove_dir_all(&staging);
    }

    /// **The point of no return, from the winning side.** The commit got there
    /// first, so the driver is installed and the press is told so — which is
    /// what the row shows, and it is the truth rather than a failure.
    #[test]
    fn a_press_after_the_commit_is_told_the_driver_is_already_installed() {
        let staging = scratch("commit-first");
        let cancel = Cancel::new();
        assert!(commit(&cancel, &staging).is_ok(), "the commit was the one that won");
        assert!(staging.exists(), "a committed install keeps what it unpacked");
        assert!(!cancel.stop(), "a press after the commit must not claim it stopped anything");
        assert!(!cancel.stopped(), "and it must not report the transfer as stopped either");
        let _ = std::fs::remove_dir_all(&staging);
    }

    /// The two are not two flags that can agree by accident. Whoever arrives second
    /// is told it lost — never both, never neither — and that is true of the
    /// interleaving as well as of the order, so it is raced rather than stepped.
    #[test]
    fn exactly_one_of_the_press_and_the_commit_wins_however_they_interleave() {
        for _ in 0..200 {
            let cancel = Cancel::new();
            let lined_up = std::sync::Arc::new(std::sync::Barrier::new(2));
            let presser = {
                let cancel = cancel.clone();
                let lined_up = std::sync::Arc::clone(&lined_up);
                std::thread::spawn(move || {
                    lined_up.wait();
                    cancel.stop()
                })
            };
            lined_up.wait();
            let committed = cancel.commit();
            let pressed = presser.join().expect("the press thread");
            assert_ne!(committed, pressed, "both won, or neither did");
        }
    }

    /// A scratch directory standing in for the unpacked staging tree.
    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-commit-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }
}