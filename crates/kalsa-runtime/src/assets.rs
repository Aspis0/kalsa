//! The `llama.cpp` builds this product can run, and the proof that a download
//! is the build we meant.
//!
//! Two facts shape this table. Nothing here ships in the installer: the
//! machine that runs an engine fetches the row its hardware justifies when
//! it first starts. And a download without a digest is a bet, not a build:
//! `kalsa-download` renames bytes onto their final name only when size and
//! sha256 both hold, so every row must carry both before it is allowed to
//! move.
//!
//! Sizes and digests below are exact and came from the publisher that serves
//! the bytes: an archive rebuilt from the same tag is not byte-identical, so
//! the record of an object is the manifest its publisher serves, never a
//! reconstruction of it.
//!
//! Note the macOS builds ship as `.tar.gz`, not `.zip`, unlike every
//! Windows row.

/// Where Kalsa's own fork of the engine is published: the app's CDN, not
/// GitHub. The fork is the only engine that reads the door's private
/// headers, so it is the only one this app may mount.
const FORK_BASE: &str = "https://dl.kalsa.io/kalsa-server/v1.1.2";

/// Where the probe model lives: ggml-org/tiny-llamas on HuggingFace, pinned
/// to a commit so the bytes cannot move under us.
const PROBE_MODEL_HOME: &str =
    "https://huggingface.co/ggml-org/tiny-llamas/resolve/99dd1a73db5a37100bd4ae633f4cfce6560e1567";

/// Which machine a published build runs on. There is no Linux row: no build
/// is published for it, and that is a fact this crate reports rather than
/// works around.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Platform {
    MacArm64,
    MacX64,
    WindowsX64,
}

impl Platform {
    /// The platform this binary was built for, when we publish a build for it.
    pub fn current() -> Option<Platform> {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            Some(Platform::MacArm64)
        }
        #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
        {
            Some(Platform::MacX64)
        }
        #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
        {
            Some(Platform::WindowsX64)
        }
        #[cfg(not(any(
            all(target_os = "macos", target_arch = "aarch64"),
            all(target_os = "macos", target_arch = "x86_64"),
            all(target_os = "windows", target_arch = "x86_64"),
        )))]
        {
            None
        }
    }
}

/// A server build, by the backend it was compiled against. Distinct from
/// `kalsa_probe::Backend`, which describes the *hardware*: this describes an
/// artifact, and one machine may try several.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ServerBackend {
    /// The macOS archive: Metal and CPU in one file (~11 MB compressed), so
    /// on a Mac there is nothing to choose.
    Metal,
    /// The Windows CPU build (~14 MB): the only build that always works.
    Cpu,
    /// The Windows Vulkan build (~26 MB): the cheap way to reach any recent
    /// NVIDIA or AMD GPU. Needs Vulkan 1.2 + `storageBuffer16BitAccess` —
    /// llama.cpp refuses devices below that with "Unsupported device" at
    /// device init, which is why the probe, not detection, decides.
    Vulkan,
}

impl ServerBackend {
    /// Stable name for file names and the verdict file.
    pub fn name(&self) -> &'static str {
        match self {
            ServerBackend::Metal => "metal",
            ServerBackend::Cpu => "cpu",
            ServerBackend::Vulkan => "vulkan",
        }
    }

    /// The name a file may carry for this build, or `None` when it names
    /// no build of ours — a record written by something else.
    pub fn from_name(name: &str) -> Option<ServerBackend> {
        match name {
            "metal" => Some(ServerBackend::Metal),
            "cpu" => Some(ServerBackend::Cpu),
            "vulkan" => Some(ServerBackend::Vulkan),
            _ => None,
        }
    }
}

/// What one archive is, inside its backend.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    /// The llama-server archive itself.
    Engine,
    /// A tiny GGUF the capability probe serves to prove a build works.
    ProbeModel,
}

/// How an archive is packed. A fact about the asset, declared where the
/// asset is declared: the macOS builds are tar.gz, every Windows row is a
/// zip, and the extractor must not sniff file names at the far end.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ArchiveFormat {
    Zip,
    TarGz,
}

/// One release artifact and the promise a download of it is held to.
pub(crate) struct Asset {
    pub(crate) role: Role,
    pub(crate) backend: Option<ServerBackend>,
    pub(crate) platform: Option<Platform>,
    /// Where this asset is published. A fact about the asset: the engines
    /// live at the fork's own CDN home, the probe model shares neither, and
    /// `url` special-cases none of them.
    pub(crate) home: &'static str,
    /// The file name at its home; the URL is home plus this.
    pub(crate) file: &'static str,
    /// How the archive is packed. None only for the probe model, which is a
    /// raw file and is never extracted.
    pub(crate) format: Option<ArchiveFormat>,
    /// Exact compressed byte size. None until verified against the release.
    pub(crate) size_bytes: Option<u64>,
    /// sha256 over the archive, exactly as published. None until verified.
    pub(crate) sha256: Option<&'static str>,
    /// sha256 of the extracted server inside the engine archive, re-checked
    /// on every start, because nothing under the user's directory is
    /// trusted by provenance alone. Engine rows only: a row that ships no
    /// server (the probe model) keeps None, no further comment needed.
    ///
    /// On the fork's rows this is the thin launcher `kalsa-server`, NOT the
    /// version identity: the launcher's bytes do not change between the
    /// fork's releases (see the comment at that row). The ARCHIVE `sha256`
    /// is what tells versions apart.
    pub(crate) exe_sha256: Option<&'static str>,
}

impl Asset {
    /// The download URL: the asset's home plus its file name.
    pub(crate) fn url(&self) -> String {
        format!("{}/{}", self.home, self.file)
    }

    /// A row without both promises is not downloadable, whatever its URL
    /// says: `store` refuses it before a single byte moves.
    pub(crate) fn verified(&self) -> bool {
        self.size_bytes.is_some() && self.sha256.is_some()
    }
}

// The fork rows' numbers are transcribed from Kalsa's own published
// manifest (`FORK_BASE` + `/manifest.json`) because the manifest the
// publisher serves is the record of that object. `size_bytes` and `sha256`
// are what `store.rs` verifies the download against, so they are data and
// not prose: `dev/test-engine-pin.py` re-reads the manifest and compares
// the macOS row field by field (home, file, size_bytes, sha256,
// exe_sha256).
const ASSETS: &[Asset] = &[
    // The macOS arm64 engine is Kalsa's own fork of llama.cpp, not upstream.
    // Upstream ignores `X-Kalsa-Cache-Salt` and `X-Kalsa-Slot`, so mounting
    // it would make the door's per-device cache isolation decorative; the
    // fork reads both. One archive per architecture the fork publishes, and
    // today that is Apple Silicon only.
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Metal),
        platform: Some(Platform::MacArm64),
        home: FORK_BASE,
        file: "kalsa-server-v1.1.2-bin-macos-arm64.tar.gz",
        format: Some(ArchiveFormat::TarGz),
        // `exe_sha256` is the thin launcher `kalsa-server`, the binary the
        // archive's `libllama-server-impl.dylib` is loaded by: the manifests
        // of successive fork releases state this same digest, so it is an
        // integrity check on the launcher and never the version identity —
        // the ARCHIVE `sha256` is. `marker.rs` uses it the same way.
        exe_sha256: Some("327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde"),
        size_bytes: Some(11_207_047),
        sha256: Some("691943209c6461ade1faa5fd67fd6725c9e0007aa9792f0a7bd7d7c408cb6961"),
    },
    // No Intel macOS engine row, on purpose. `Platform::MacX64` stays so an
    // Intel Mac is identified honestly, but the fork publishes no x64
    // archive, and mounting upstream's x64 engine would serve several
    // devices with no per-device cache isolation — worse than refusing.
    // `candidates_for` therefore offers an Intel Mac no build at all and
    // `decide` refuses it in the user's words. Intel support is a deliberate
    // future decision (publish the fork for x64, add a row here), not an
    // oversight.
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Cpu),
        platform: Some(Platform::WindowsX64),
        home: FORK_BASE,
        file: "kalsa-server-v1.1.2-bin-win-cpu-x64.zip",
        format: Some(ArchiveFormat::Zip),
        // The fork's Windows archives carry the per-variant `ggml-cpu-*`
        // libraries and no plain `ggml-cpu.dll`, and need the VC++
        // redistributable, as upstream's did.
        exe_sha256: Some("a859190549212fae578e5c7298d0d9c9779c2f9f982a14291e9a5fd2a0e9d673"),
        size_bytes: Some(13_762_007),
        sha256: Some("60b6cb686c58a8006c8889264b83163a9023e041611631d201aaed43f5ff57cc"),
    },
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Vulkan),
        platform: Some(Platform::WindowsX64),
        home: FORK_BASE,
        file: "kalsa-server-v1.1.2-bin-win-vulkan-x64.zip",
        format: Some(ArchiveFormat::Zip),
        // Same layout as the CPU archive (`ggml-cpu-*`, no plain
        // `ggml-cpu.dll`) plus `ggml-vulkan.dll`; needs the VC++
        // redistributable, as upstream's did.
        exe_sha256: Some("6e3c87144c9763f7d604483f63f9920b310121237a4c69e11ed6b16aac3b3e12"),
        size_bytes: Some(26_491_005),
        sha256: Some("24f0a98293e2ed6c5003f1b64837eadc12ff034f876706db3bfdbc8cb85c245e"),
    },
    // The probe's tiny model: stories260K from ggml-org/tiny-llamas, the
    // models llama.cpp's own CI leans on. Size and digest verified against
    // the downloaded file; the header reads as GGUFv3 with 48 tensors.
    // UNPROVEN: nobody has run llama-server against it yet, so a failed
    // probe should suspect this file before blaming the backend.
    Asset {
        role: Role::ProbeModel,
        backend: None,
        platform: None,
        home: PROBE_MODEL_HOME,
        file: "stories260K.gguf",
        format: None,
        exe_sha256: None,
        size_bytes: Some(1_185_376),
        sha256: Some("047bf46455a544931cff6fef14d7910154c56afbc23ab1c5e56a72e69912c04b"),
    },
];

/// Every archive a backend needs on this platform, engine first.
pub(crate) fn assets_for(platform: Platform, backend: ServerBackend) -> Vec<&'static Asset> {
    ASSETS
        .iter()
        .filter(|asset| {
            asset.role != Role::ProbeModel
                && asset.platform == Some(platform)
                && asset.backend == Some(backend)
        })
        .collect()
}

/// The tiny model the capability probe serves.
pub(crate) fn probe_model() -> &'static Asset {
    ASSETS
        .iter()
        .find(|asset| asset.role == Role::ProbeModel)
        .expect("the probe model row exists")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_matches_the_published_release_shape() {
        // The one macOS archive we publish carries Metal+CPU together.
        assert_eq!(
            assets_for(Platform::MacArm64, ServerBackend::Metal).len(),
            1
        );
        // No Intel macOS engine row: see the table's comment. A machine we
        // identify but publish nothing for must have no assets, never a
        // fallback that runs and isolates nothing.
        assert!(assets_for(Platform::MacX64, ServerBackend::Metal).is_empty());
        // CPU and Vulkan are single archives.
        assert_eq!(
            assets_for(Platform::WindowsX64, ServerBackend::Cpu).len(),
            1
        );
        assert_eq!(
            assets_for(Platform::WindowsX64, ServerBackend::Vulkan).len(),
            1
        );
        // Nothing is published for any other platform.
        assert!(assets_for(Platform::MacArm64, ServerBackend::Vulkan).is_empty());
    }

    #[test]
    fn every_engine_row_downloads_from_the_fork() {
        for asset in ASSETS.iter().filter(|asset| asset.role == Role::Engine) {
            let url = asset.url();
            assert!(url.starts_with(FORK_BASE), "{url}");
            assert!(url.ends_with(asset.file), "{url}");
        }
    }

    #[test]
    fn a_filled_row_is_whole_and_well_formed() {
        // A plausible-looking invented digest would pass verification and
        // then poison the one check that makes a download trustworthy, and
        // half a promise (a size without a digest, or the reverse) verifies
        // nothing while looking filled in. Filled rows must be whole and
        // shaped like a sha256 exactly as GitHub and HuggingFace publish it:
        // 64 lowercase hex characters.
        for asset in ASSETS {
            match (asset.size_bytes, asset.sha256) {
                (Some(size), Some(sha)) => {
                    assert!(size > 0, "{} promises an empty download", asset.file);
                    assert!(
                        sha.len() == 64 && sha.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')),
                        "{} is not 64 lowercase hex characters: {sha}",
                        asset.file
                    );
                }
                (None, None) => {}
                _ => panic!("{} carries half a promise", asset.file),
            }
        }
    }

    #[test]
    fn recorded_executables_are_shaped_like_sha256_and_live_on_engine_rows() {
        // The exe digest is held to the same shape as the archive digest —
        // 64 lowercase hex characters — and only engine rows may carry one:
        // the probe model holds no server, so a digest there would bless
        // bytes that are never executed.
        for asset in ASSETS {
            match asset.exe_sha256 {
                Some(sha) => {
                    assert_eq!(
                        asset.role,
                        Role::Engine,
                        "{} carries an exe digest",
                        asset.file
                    );
                    assert!(
                        sha.len() == 64 && sha.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')),
                        "{} is not 64 lowercase hex characters: {sha}",
                        asset.file
                    );
                }
                None => {}
            }
        }
    }

    #[test]
    fn the_macos_arm64_engine_is_the_fork_archive_pinned_by_its_own_numbers() {
        // This row is the one thing between the door's cache salt and an
        // engine that ignores it, so its identity is pinned exactly: the
        // fork's CDN home, the versioned file name, and the three numbers
        // read from that release's own published manifest. One wrong digit
        // is a download that either fails verification or mounts the wrong
        // engine.
        let rows = assets_for(Platform::MacArm64, ServerBackend::Metal);
        assert_eq!(rows.len(), 1);
        let row = rows[0];
        assert_eq!(row.role, Role::Engine);
        assert_eq!(row.home, FORK_BASE);
        assert_eq!(row.file, "kalsa-server-v1.1.2-bin-macos-arm64.tar.gz");
        assert_eq!(row.format, Some(ArchiveFormat::TarGz));
        assert_eq!(row.size_bytes, Some(11_207_047));
        assert_eq!(
            row.sha256,
            Some("691943209c6461ade1faa5fd67fd6725c9e0007aa9792f0a7bd7d7c408cb6961"),
            "the archive digest is the version identity"
        );
        assert_eq!(
            row.exe_sha256,
            Some("327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde"),
            "the launcher digest: an integrity check, not a version"
        );
        assert!(
            row.verified(),
            "an unfilled row would refuse the whole macOS backend"
        );
    }

    /// The Windows fork rows are the fork's own objects now, so they are
    /// pinned exactly: home, file, and the three numbers each came from the
    /// fork's published manifest. One wrong digit is a download that fails
    /// verification or mounts the wrong engine.
    #[test]
    fn the_windows_fork_rows_are_pinned_by_their_own_numbers() {
        let expected = [
            (
                ServerBackend::Cpu,
                "kalsa-server-v1.1.2-bin-win-cpu-x64.zip",
                13_762_007u64,
                "60b6cb686c58a8006c8889264b83163a9023e041611631d201aaed43f5ff57cc",
                "a859190549212fae578e5c7298d0d9c9779c2f9f982a14291e9a5fd2a0e9d673",
            ),
            (
                ServerBackend::Vulkan,
                "kalsa-server-v1.1.2-bin-win-vulkan-x64.zip",
                26_491_005,
                "24f0a98293e2ed6c5003f1b64837eadc12ff034f876706db3bfdbc8cb85c245e",
                "6e3c87144c9763f7d604483f63f9920b310121237a4c69e11ed6b16aac3b3e12",
            ),
        ];
        for (backend, file, size, sha, exe_sha) in expected {
            let rows = assets_for(Platform::WindowsX64, backend);
            assert_eq!(rows.len(), 1, "exactly one {} row", backend.name());
            let row = rows[0];
            assert_eq!(row.role, Role::Engine);
            assert_eq!(row.home, FORK_BASE, "{} must be the fork's", file);
            assert_eq!(row.file, file);
            assert_eq!(row.format, Some(ArchiveFormat::Zip));
            assert_eq!(row.size_bytes, Some(size), "{file}");
            assert_eq!(row.sha256, Some(sha), "the archive digest is the version identity");
            assert_eq!(row.exe_sha256, Some(exe_sha), "{file}");
            assert!(row.verified(), "{file} promises nothing");
        }
    }

    #[test]
    fn engine_rows_are_unique_per_machine_and_intel_has_none() {
        let mut engines = Vec::new();
        for asset in ASSETS.iter().filter(|asset| asset.role == Role::Engine) {
            // One engine per (platform, backend): a second row for the same
            // key would make which build runs depend on table order.
            let key = (asset.platform, asset.backend);
            assert!(
                !engines.contains(&key),
                "{} is a second engine row for {key:?}",
                asset.file
            );
            engines.push(key);
            // Every engine row is whole: an unverified one fails the store
            // for its backend, and a row with no launcher digest skips the
            // birth check that proves the archive produced our binary.
            assert!(asset.verified(), "{} promises nothing", asset.file);
            assert!(
                asset.exe_sha256.is_some(),
                "{} records no server digest",
                asset.file
            );
        }
        // An Intel Mac identified as one must find no engine at all: the
        // only x64 engine we could mount ignores the cache inlet, and a
        // build that runs without isolation is worse than a refusal.
        assert!(
            !engines
                .iter()
                .any(|(platform, _)| *platform == Some(Platform::MacX64)),
            "an Intel Mac must have no engine row"
        );
    }

    #[test]
    fn the_probe_model_carries_its_promises() {
        // The probe model was the last row allowed to be empty; it is hosted
        // now, so nothing is waiting to be filled in, and the probe cannot
        // fail on a placeholder row while every backend looks broken.
        assert!(probe_model().verified());
    }

    #[test]
    fn a_row_outside_the_release_names_its_own_home() {
        // The probe model does not live in the llama.cpp release, so its URL
        // must be its own: home is a fact on the row, pinned to a commit.
        let model = probe_model();
        assert_eq!(model.url(), format!("{PROBE_MODEL_HOME}/{}", model.file));
        assert_eq!(model.file, "stories260K.gguf");
    }

    #[test]
    fn backend_names_round_trip_for_the_verdict_file() {
        for backend in [
            ServerBackend::Metal,
            ServerBackend::Cpu,
            ServerBackend::Vulkan,
        ] {
            assert_eq!(ServerBackend::from_name(backend.name()), Some(backend));
        }
        assert_eq!(ServerBackend::from_name("metal++"), None);
    }

    #[test]
    fn this_machine_maps_to_a_platform_we_know() {
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        assert_eq!(Platform::current(), Some(Platform::MacArm64));
        // Whatever it is, it must not claim a platform we publish nothing for.
        assert!(matches!(
            Platform::current(),
            Some(Platform::MacArm64) | Some(Platform::MacX64) | Some(Platform::WindowsX64) | None
        ));
    }
}
