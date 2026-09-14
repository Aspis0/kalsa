//! Where builds live on this machine, and how they get there.
//!
//! One per-user directory holds everything: archives under `archives/`, the
//! extracted builds under `builds/<backend>/`, the probe's tiny model under
//! `models/`. An archive is fetched once — a `.sha256` stamp written after a
//! verified download makes every later start a size check, not a two-second
//! re-hash of a 645 MB CUDA archive, and a re-hash of an unstamped copy is
//! the honest way to accept one that arrived by other means.
//!
//! Another program's cache is consulted for the probe model only, and only
//! through `kalsa-download`'s read-only `find_local`: we never move, rename
//! or delete a file that belongs to someone else's cache.

use std::io::{self, Read};
use std::path::{Path, PathBuf};

use kalsa_download::{default_roots, download, find_local, DownloadError, Progress};
use sha2::{Digest, Sha256};

use crate::assets::{self, probe_model, Asset, Platform, ServerBackend};
use crate::extract;

#[derive(Debug)]
pub(crate) enum StoreError {
    /// The table's digests are not filled in yet. Fatal, by design.
    Unverified,
    /// An archive extracted cleanly but held no server.
    NoExecutable,
    Io(io::Error),
    Download(DownloadError),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Unverified => write!(
                f,
                "the release assets are not verified yet: nothing downloads until their \
                 sizes and sha256 digests are filled in"
            ),
            StoreError::NoExecutable => write!(f, "the archive contained no llama-server"),
            StoreError::Io(e) => write!(f, "{e}"),
            StoreError::Download(e) => write!(f, "{e}"),
        }
    }
}

/// The per-user home of everything this crate puts on disk.
pub(crate) fn root() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home()
            .map(|home| home.join("Library/Application Support/kalsa-brain/runtime"))
            .unwrap_or_else(std::env::temp_dir)
    }
    #[cfg(windows)]
    {
        // %LOCALAPPDATA%, with a USERPROFILE fallback for stripped installs.
        std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| home().map(|home| home.join("AppData").join("Local")))
            .unwrap_or_else(std::env::temp_dir)
            .join("kalsa-brain")
            .join("runtime")
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| home().map(|home| home.join(".local/share")))
            .unwrap_or_else(std::env::temp_dir)
            .join("kalsa-brain")
            .join("runtime")
    }
}

fn home() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

fn archives_dir(root: &Path) -> PathBuf {
    root.join("archives")
}

fn builds_dir(root: &Path, backend: ServerBackend) -> PathBuf {
    root.join("builds").join(backend.name())
}

fn models_dir(root: &Path) -> PathBuf {
    root.join("models")
}

/// The path of a runnable llama-server for this backend, fetching and
/// extracting whatever is missing. A build already on disk is used as-is:
/// it was digest-verified when it arrived, and the probe proves it again
/// anyway.
pub(crate) fn ensure_backend(
    root: &Path,
    platform: Platform,
    backend: ServerBackend,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StoreError> {
    let dir = builds_dir(root, backend);
    if let Some(exe) = extract::find_server(&dir) {
        return Ok(exe);
    }
    let assets = assets::assets_for(platform, backend);
    if assets.iter().any(|asset| !asset.verified()) {
        return Err(StoreError::Unverified);
    }
    for asset in assets {
        let archive = ensure_archive(root, asset, progress)?;
        // The probe model is the only row without a format, and it is never
        // extracted; every archive row names its format in the table.
        let format = asset.format.expect("archive rows name their format");
        match extract::extract(&archive, format, &dir) {
            Ok(()) => {}
            // The stamp stood for bytes that no longer extract — bit rot, a
            // truncated copy placed by hand. Drop the evidence and fetch the
            // archive again; a second failure surfaces as an error.
            Err(_) => {
                let _ = std::fs::remove_file(&archive);
                let _ = std::fs::remove_file(stamp_path(&archive));
                let archive = ensure_archive(root, asset, progress)?;
                extract::extract(&archive, format, &dir).map_err(StoreError::Io)?;
            }
        }
    }
    extract::find_server(&dir).ok_or(StoreError::NoExecutable)
}

/// The path of a tiny model the probe can serve. A few megabytes, so the
/// on-disk copy is re-hashed every time instead of stamped.
pub(crate) fn ensure_probe_model(
    root: &Path,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StoreError> {
    let asset = probe_model();
    let (size, sha) = match (asset.size_bytes, asset.sha256) {
        (Some(size), Some(sha)) => (size, sha),
        _ => return Err(StoreError::Unverified),
    };
    let path = models_dir(root).join(asset.file);
    if file_digest_is(&path, size, sha) {
        return Ok(path);
    }
    // A digest-verified copy under ollama, LM Studio or the HF cache beats
    // any download, and it is only ever read.
    if let Some(found) = find_local(&default_roots(), size, sha) {
        return Ok(found);
    }
    download(&asset.url(), &path, size, sha, progress).map_err(StoreError::Download)?;
    Ok(path)
}

/// The archive on disk, proven to be the promised bytes.
fn ensure_archive(
    root: &Path,
    asset: &Asset,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StoreError> {
    let (size, sha) = match (asset.size_bytes, asset.sha256) {
        (Some(size), Some(sha)) => (size, sha),
        _ => return Err(StoreError::Unverified),
    };
    let path = archives_dir(root).join(asset.file);
    acquire(&path, &asset.url(), size, sha, progress)
}

/// Brings `path` into existence with the promised bytes: accept a stamped or
/// digest-verified copy already there, download otherwise.
fn acquire(
    path: &Path,
    url: &str,
    size: u64,
    sha: &str,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StoreError> {
    if stamped(path, size, sha) {
        return Ok(path.to_path_buf());
    }
    if file_digest_is(path, size, sha) {
        write_stamp(path, sha);
        return Ok(path.to_path_buf());
    }
    download(url, path, size, sha, progress).map_err(StoreError::Download)?;
    write_stamp(path, sha);
    Ok(path.to_path_buf())
}

/// True when `<path>.sha256` names the same digest and the file still has the
/// promised length: written only after a verified download, so it stands for
/// "the digest was proven against these bytes" without re-reading them.
fn stamped(path: &Path, size: u64, sha: &str) -> bool {
    let Some(stamp) = std::fs::read_to_string(stamp_path(path)).ok() else {
        return false;
    };
    stamp.trim().eq_ignore_ascii_case(sha)
        && matches!(std::fs::metadata(path), Ok(meta) if meta.len() == size)
}

fn write_stamp(path: &Path, sha: &str) {
    let _ = std::fs::write(stamp_path(path), sha);
}

fn stamp_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".sha256");
    path.with_file_name(name)
}

/// Size first, then the digest: the cheap check decides whether the expensive
/// one is worth running.
fn file_digest_is(path: &Path, size: u64, sha: &str) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    if !matches!(file.metadata(), Ok(meta) if meta.len() == size) {
        return false;
    }
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buf[..n]),
            Err(_) => return false,
        }
    }
    let digest = format!("{:x}", hasher.finalize());
    digest.eq_ignore_ascii_case(sha)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-runtime-store-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// The fixture's home is irrelevant to the gate; only its promises are.
    const RELEASE_HOME_STAND_IN: &str = "https://fixture.invalid/";

    fn digest_of(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// Acquires `bytes` as a fake archive under `root`, with its real digest.
    fn acquire_fake(root: &Path, file: &str, bytes: &[u8], stamped: bool) -> PathBuf {
        let dir = archives_dir(root);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join(file);
        std::fs::write(&path, bytes).expect("archive");
        if stamped {
            write_stamp(&path, &digest_of(bytes));
        }
        path
    }

    #[test]
    fn an_unverified_row_is_refused_before_anything_is_created() {
        // A fixture, not the table: the gate's subject is a row without its
        // promises, and the test owns one, so the day every real row is
        // filled in this keeps testing the gate.
        let root = scratch("fixture");
        let fixture = |size_bytes: Option<u64>, sha256: Option<&'static str>| Asset {
            role: assets::Role::Engine,
            backend: Some(ServerBackend::Cpu),
            platform: Some(Platform::WindowsX64),
            home: RELEASE_HOME_STAND_IN,
            file: "fixture.zip",
            format: Some(assets::ArchiveFormat::Zip),
            size_bytes,
            sha256,
        };
        // Whole-but-empty, and both half-filled shapes: a size without a
        // digest verifies nothing, and neither does the reverse.
        for asset in [
            fixture(None, None),
            fixture(Some(10), None),
            fixture(
                None,
                Some("047bf46455a544931cff6fef14d7910154c56afbc23ab1c5e56a72e69912c04b"),
            ),
        ] {
            let err =
                ensure_archive(&root, &asset, &mut |_| {}).expect_err("no promises, no download");
            assert!(matches!(err, StoreError::Unverified), "{err}");
            // The refusal happens before a single directory exists.
            assert_eq!(
                std::fs::read_dir(&root).expect("root").count(),
                0,
                "the refusal must not touch the disk"
            );
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_stamped_archive_is_accepted_without_a_rehash() {
        let root = scratch("stamped");
        let bytes = b"a stand-in for a release archive";
        let path = acquire_fake(&root, "fake-cpu.zip", bytes, true);
        let size = bytes.len() as u64;
        let sha = digest_of(bytes);
        let got = acquire(
            &path,
            "https://unused.invalid/fake.zip",
            size,
            &sha,
            &mut |_| {},
        )
        .expect("accepted");
        assert_eq!(got, path);
        // Same stamp, same length, different bytes: the stamp is trusted
        // here, and the corruption is caught by the extraction that follows,
        // which discards the archive and fetches it again.
        let mut tampered = bytes.to_vec();
        tampered[0] ^= 0xff;
        std::fs::write(&path, tampered).expect("tamper");
        let got = acquire(
            &path,
            "https://unused.invalid/fake.zip",
            size,
            &sha,
            &mut |_| {},
        )
        .expect("still stamped");
        assert_eq!(got, path);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unstamped_copy_is_hashed_once_then_stamped() {
        let root = scratch("unstamped");
        let bytes = b"another stand-in, placed by hand";
        let path = acquire_fake(&root, "fake-cpu-2.zip", bytes, false);
        let size = bytes.len() as u64;
        let sha = digest_of(bytes);
        let got = acquire(
            &path,
            "https://unused.invalid/fake.zip",
            size,
            &sha,
            &mut |_| {},
        )
        .expect("hashed and accepted");
        assert_eq!(got, path);
        assert!(stamp_path(&path).exists(), "one hash buys a stamp");
        // A wrong length is refused before the digest is even computed, and
        // the fallback download cannot even start: the URL is unparsable, so
        // this test never touches a socket.
        std::fs::write(&path, b"short").expect("truncate");
        let err = acquire(&path, "###not a url", size, &sha, &mut |_| {})
            .expect_err("the length promise is checked first");
        assert!(matches!(err, StoreError::Download(_)), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_build_already_on_disk_is_used_without_a_download() {
        let root = scratch("fastpath");
        let dir = builds_dir(&root, ServerBackend::Cpu);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let exe = dir.join("llama-server");
        std::fs::write(&exe, b"a stand-in binary").expect("exe");
        let got = ensure_backend(&root, Platform::WindowsX64, ServerBackend::Cpu, &mut |_| {})
            .expect("an existing build needs nothing fetched");
        assert_eq!(got, exe);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_store_lives_under_the_users_own_profile() {
        let root = root();
        assert!(root.is_absolute(), "{root:?}");
        assert!(root.to_string_lossy().contains("kalsa-brain"), "{root:?}");
        #[cfg(target_os = "macos")]
        assert!(
            root.to_string_lossy()
                .contains("Library/Application Support"),
            "{root:?}"
        );
    }
}
