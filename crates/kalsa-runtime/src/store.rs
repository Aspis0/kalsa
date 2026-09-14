//! Where builds live on this machine, and what makes them ours.
//!
//! One per-user directory holds everything: archives under `archives/`, the
//! extracted builds under `builds/<backend>/`, the probe's tiny model under
//! `models/`. Nothing in that directory is trusted because we put it there
//! — anything running as the user can write there — so trust is re-earned,
//! never remembered: an archive is accepted only after its bytes hash to the
//! promised digest again, and a build directory only after `marker::validate`
//! finds it is exactly the build these digests describe. Anything else is
//! re-acquired, never run.
//!
//! Another program's cache is consulted for the probe model only, and only
//! through `kalsa-download`'s read-only `find_local`: we never move, rename
//! or delete a file that belongs to someone else's cache.

use std::io::{self, Read};
use std::path::{Path, PathBuf};

use kalsa_download::{default_roots, download, find_local, DownloadError, Progress};
use sha2::{Digest, Sha256};

use crate::assets::{self, probe_model, ArchiveFormat, Asset, Platform, ServerBackend};
use crate::{extract, marker};

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

/// The path of a runnable llama-server for this backend — runnable meaning
/// proven ours, not merely present. What is already on disk is used only
/// when its marker says it is the build these digests describe and its
/// executable still hashes to what was proven; anything else is re-acquired.
pub(crate) fn ensure_backend(
    root: &Path,
    platform: Platform,
    backend: ServerBackend,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StoreError> {
    let dir = builds_dir(root, backend);
    let assets = assets::assets_for(platform, backend);
    if assets.iter().any(|asset| !asset.verified()) {
        return Err(StoreError::Unverified);
    }
    let runtime: Vec<(&str, &str)> = assets
        .iter()
        .map(|asset| (asset.file, asset.sha256.unwrap_or_default()))
        .collect();
    let table_exe = assets
        .iter()
        .find(|asset| asset.role == assets::Role::Engine)
        .and_then(|asset| asset.exe_sha256);
    if let Some(exe) = marker::validate(&dir, &runtime, table_exe) {
        return Ok(exe);
    }
    // Repair: prove the archives again, extract them into staging, and let
    // the build appear under its own name only once it is whole.
    let staging = staging_path(&dir);
    let archives = acquire_all(root, &assets, progress)?;
    if extract_into(&staging, &archives).is_err() {
        // The bytes proved wrong after all — rot between the hash and the
        // extraction, say. Discard them, fetch once more, then give up.
        for (path, _) in &archives {
            let _ = std::fs::remove_file(path);
        }
        let archives = acquire_all(root, &assets, progress)?;
        extract_into(&staging, &archives).map_err(StoreError::Io)?;
    }
    publish(&staging, &dir, &runtime, table_exe)
}

/// The staging directory a build is assembled in, beside its final name.
fn staging_path(dir: &Path) -> PathBuf {
    dir.with_file_name(format!(
        "{}.new",
        dir.file_name().unwrap_or_default().to_string_lossy()
    ))
}

/// Every archive of a backend, digest-proven and ready to extract.
fn acquire_all(
    root: &Path,
    assets: &[&'static Asset],
    progress: &mut dyn FnMut(Progress),
) -> Result<Vec<(PathBuf, ArchiveFormat)>, StoreError> {
    let mut archives = Vec::with_capacity(assets.len());
    for asset in assets {
        let archive = ensure_archive(root, asset, progress)?;
        // The probe model is the only row without a format, and it is never
        // extracted; every archive row names its format in the table.
        archives.push((
            archive,
            asset.format.expect("archive rows name their format"),
        ));
    }
    Ok(archives)
}

/// Extracts the archives into `staging`, wiping it first, and wiping it
/// again on any failure: a half extraction never survives to be mistaken
/// for a build. Extraction touches only `staging` — never the canonical
/// directory.
fn extract_into(staging: &Path, archives: &[(PathBuf, ArchiveFormat)]) -> io::Result<()> {
    let _ = std::fs::remove_dir_all(staging);
    let result = (|| {
        std::fs::create_dir_all(staging)?;
        for (archive, format) in archives {
            extract::extract(archive, *format, staging)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(staging);
    }
    result
}

/// Makes `dir` the build assembled in `staging`: hash the executable, record
/// the provenance, and swap the directory in with one rename. A crash or a
/// full disk leaves the old state or no state — never a half-published one.
fn publish(
    staging: &Path,
    dir: &Path,
    runtime: &[(&str, &str)],
    table_exe: Option<&str>,
) -> Result<PathBuf, StoreError> {
    let give_up = |error: io::Error| -> StoreError {
        let _ = std::fs::remove_dir_all(staging);
        StoreError::Io(error)
    };
    let Some(staged) = extract::find_server(staging) else {
        let _ = std::fs::remove_dir_all(staging);
        return Err(StoreError::NoExecutable);
    };
    let exe_sha = marker::sha256_file(&staged).map_err(give_up)?;
    // The table's own exe digest, when filled in, is checked at birth: an
    // archive that produces a different executable is not the release.
    if let Some(table) = table_exe {
        if !exe_sha.eq_ignore_ascii_case(table) {
            let error = io::Error::other("the extracted executable does not match the release");
            return Err(give_up(error));
        }
    }
    marker::write(staging, runtime, &exe_sha).map_err(give_up)?;
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(give_up)?;
    }
    std::fs::rename(staging, dir).map_err(give_up)?;
    let relative = staged
        .strip_prefix(staging)
        .expect("the exe is inside staging");
    Ok(dir.join(relative))
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

/// Brings `path` into existence with the promised bytes. A copy already
/// there is accepted only after its bytes hash to the digest again — trust
/// is re-earned from content, never remembered from a previous check —
/// and otherwise it is downloaded.
fn acquire(
    path: &Path,
    url: &str,
    size: u64,
    sha: &str,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StoreError> {
    if file_digest_is(path, size, sha) {
        return Ok(path.to_path_buf());
    }
    download(url, path, size, sha, progress).map_err(StoreError::Download)?;
    Ok(path.to_path_buf())
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

    /// Places `bytes` as a fake archive under `root`, with its real digest.
    fn place_archive(root: &Path, file: &str, bytes: &[u8]) -> PathBuf {
        let dir = archives_dir(root);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join(file);
        std::fs::write(&path, bytes).expect("archive");
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
            exe_sha256: None,
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
    fn same_length_tampering_is_refused() {
        // The one the old stamp certified as fine: change the bytes, keep
        // the length, leave any record that the file was once good. Content
        // is re-measured, so this is refused — the file does not come back
        // as an accepted archive.
        let root = scratch("tampered");
        let bytes = b"a stand-in for a release archive";
        let path = place_archive(&root, "fake-cpu.zip", bytes);
        let size = bytes.len() as u64;
        let sha = digest_of(bytes);
        // Untouched, it is accepted after one honest hash.
        let got = acquire(
            &path,
            "https://unused.invalid/fake.zip",
            size,
            &sha,
            &mut |_| {},
        )
        .expect("the real bytes are the real archive");
        assert_eq!(got, path);
        // Same length, flipped byte: refused, and the fallback download
        // cannot even start (the URL is unparsable, so no socket is touched).
        let mut tampered = bytes.to_vec();
        tampered[0] ^= 0xff;
        std::fs::write(&path, tampered).expect("tamper");
        let err = acquire(&path, "###not a url", size, &sha, &mut |_| {})
            .expect_err("same-length tampering is not the archive");
        assert!(matches!(err, StoreError::Download(_)), "{err}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_digest_verified_copy_is_accepted_without_a_download() {
        // Never re-download something already verified: a correct copy that
        // arrived by other means is accepted after one hash.
        let root = scratch("copy");
        let bytes = b"another stand-in, placed by hand";
        let path = place_archive(&root, "fake-cpu-2.zip", bytes);
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
        let _ = std::fs::remove_dir_all(&root);
    }

    /// Bytes that are not a zip: extraction of them must fail.
    const GARBAGE_ZIP_BYTES: &[u8] = b"PK\x03\x04 not really";

    #[test]
    fn a_failed_extraction_leaves_no_half_built_directory() {
        let root = scratch("half-built");
        let dir = builds_dir(&root, ServerBackend::Cpu);
        let staging = staging_path(&dir);
        let archives = vec![(
            place_archive(&root, "garbage.zip", GARBAGE_ZIP_BYTES),
            assets::ArchiveFormat::Zip,
        )];
        let outcome = extract_into(&staging, &archives);
        assert!(outcome.is_err(), "garbage does not extract");
        assert!(!dir.exists(), "extraction never touches the build dir");
        assert!(
            !staging.exists(),
            "a failed build must not leave staging behind"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_built_directory_appears_complete_with_its_provenance() {
        let root = scratch("complete");
        let dir = builds_dir(&root, ServerBackend::Cpu);
        // An old build from another release sits in the way.
        std::fs::create_dir_all(&dir).expect("old build");
        std::fs::write(dir.join("llama-server"), b"an old, stale binary").expect("old exe");
        let bytes = make_fake_zip(b"a stand-in binary");
        let archive = place_archive(&root, "real.zip", &bytes);
        let sha = digest_of(&bytes);
        let runtime = [("real.zip", sha.as_str())];
        let staging = staging_path(&dir);
        extract_into(&staging, &[(archive, assets::ArchiveFormat::Zip)])
            .expect("the fake release extracts");
        let exe = publish(&staging, &dir, &runtime, None).expect("the build is published whole");
        assert!(exe.is_file());
        assert!(
            marker::validate(&dir, &runtime, None).is_some(),
            "the published build validates"
        );
        assert!(
            !staging.exists(),
            "staging is gone once the build is complete"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A miniature release archive: nested dir, the server inside it, exec
    /// bit set — the real extraction paths run over it.
    fn make_fake_zip(body: &[u8]) -> Vec<u8> {
        use std::io::Write;
        use std::sync::atomic::{AtomicU64, Ordering};
        static CALLS: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "kalsa-runtime-fakezip-{}-{}",
            std::process::id(),
            CALLS.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_file(&path);
        let file = std::fs::File::create(&path).expect("create");
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions =
            zip::write::FileOptions::default().unix_permissions(0o755);
        zip.add_directory("bin", options).expect("dir");
        zip.start_file("bin/llama-server", options).expect("entry");
        zip.write_all(body).expect("bytes");
        zip.finish().expect("finish");
        let bytes = std::fs::read(&path).expect("read");
        let _ = std::fs::remove_file(&path);
        bytes
    }

    #[test]
    fn a_retry_after_a_broken_second_archive_starts_clean_and_publishes_the_pair() {
        // CUDA's shape: two archives, the second one failing on the first
        // attempt. The failed attempt must leave no staging (so the retry
        // cannot mix an old engine with a new runtime), and the retried pair
        // must publish and validate together.
        let root = scratch("pair");
        let dir = builds_dir(&root, ServerBackend::Cpu);
        let staging = staging_path(&dir);
        let engine = make_fake_zip(b"engine body");
        let runtime_bytes = make_fake_zip(b"runtime body");
        let engine_archive = place_archive(&root, "engine.zip", &engine);
        let broken_runtime = place_archive(&root, "runtime.zip", GARBAGE_ZIP_BYTES);

        let first = extract_into(
            &staging,
            &[
                (engine_archive.clone(), assets::ArchiveFormat::Zip),
                (broken_runtime, assets::ArchiveFormat::Zip),
            ],
        );
        assert!(first.is_err(), "the broken archive refuses to extract");
        assert!(!staging.exists(), "the failed attempt leaves no staging");
        assert!(
            !dir.exists(),
            "a failed attempt never touches the build dir"
        );

        // Retry with the refetched runtime: both good, published together.
        let fixed_runtime = place_archive(&root, "runtime.zip", &runtime_bytes);
        extract_into(
            &staging,
            &[
                (engine_archive, assets::ArchiveFormat::Zip),
                (fixed_runtime, assets::ArchiveFormat::Zip),
            ],
        )
        .expect("the retry extracts both archives");
        let engine_sha = digest_of(&engine);
        let runtime_sha = digest_of(&runtime_bytes);
        let runtime_pairs = [
            ("engine.zip", engine_sha.as_str()),
            ("runtime.zip", runtime_sha.as_str()),
        ];
        let exe = publish(&staging, &dir, &runtime_pairs, None).expect("published whole");
        assert!(exe.is_file());
        assert!(
            marker::validate(&dir, &runtime_pairs, None).is_some(),
            "the pair validates as one build"
        );
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
