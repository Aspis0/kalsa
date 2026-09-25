//! The `llama.cpp` builds this product can run, and the proof that a download
//! is the build we meant.
//!
//! Two facts shape this table. CUDA is thirty times the CPU build (~645 MB
//! against ~18 MB compressed), so the heavy backends cannot live in the
//! installer: ship small, fetch the backend this machine justifies. And a
//! download without a digest is a bet, not a build: `kalsa-download` renames
//! bytes onto their final name only when size and sha256 both hold, so every
//! row must carry both before it is allowed to move.
//!
//! Sizes and digests below are exact, and each came from the publisher that
//! serves it: upstream's rows from the GitHub release's own asset list on
//! 2026-09-14 (GitHub publishes a sha256 digest per asset), the macOS arm64
//! engine from Kalsa's own published manifest for the release it names
//! (`https://dl.kalsa.io/kalsa-server/<tag>/manifest.json`, the
//! macos-arm64/metal row, read live on 2026-09-23 — an archive rebuilt from
//! the same tag is not byte-identical, so the manifest the publisher serves
//! is the record of THAT object). Two publishers share one table because the
//! table describes what this app may run, not who built it.
//!
//! Note the macOS builds ship as `.tar.gz`, not `.zip`, unlike every
//! Windows row.

/// Where upstream's release assets live. One place, so a release bump is
/// one edit.
const RELEASE_BASE: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b10950";

/// Where Kalsa's own fork of the engine is published: the app's CDN, not
/// GitHub. The fork is the only engine that reads the door's private
/// headers, so it is the only one this app may mount.
const FORK_BASE: &str = "https://dl.kalsa.io/kalsa-server/v1.1.1";

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
    /// The Windows CPU build (~18 MB): the only build that always works.
    Cpu,
    /// The Windows Vulkan build (~32 MB): the cheap way to reach any recent
    /// NVIDIA or AMD GPU. Needs Vulkan 1.2 + `storageBuffer16BitAccess` —
    /// llama.cpp refuses devices below that with "Unsupported device" at
    /// device init, which is why the probe, not detection, decides.
    Vulkan,
    /// The Windows CUDA 12 build: engine plus a separate CUDA DLL archive,
    /// ~645 MB together. Supports sm_50 and up, driver >= 551.61.
    Cuda12,
    /// The Windows CUDA 13 build: same shape, ~541 MB together. Supports
    /// sm_75 and up (the whole GTX 10 series is out), driver >= 580.
    Cuda13,
}

impl ServerBackend {
    /// Stable name for file names and the verdict file.
    pub fn name(&self) -> &'static str {
        match self {
            ServerBackend::Metal => "metal",
            ServerBackend::Cpu => "cpu",
            ServerBackend::Vulkan => "vulkan",
            ServerBackend::Cuda12 => "cuda12",
            ServerBackend::Cuda13 => "cuda13",
        }
    }

    /// The name a file may carry for this build, or `None` when it names
    /// no build of ours — a record written by something else.
    pub fn from_name(name: &str) -> Option<ServerBackend> {
        match name {
            "metal" => Some(ServerBackend::Metal),
            "cpu" => Some(ServerBackend::Cpu),
            "vulkan" => Some(ServerBackend::Vulkan),
            "cuda12" => Some(ServerBackend::Cuda12),
            "cuda13" => Some(ServerBackend::Cuda13),
            _ => None,
        }
    }
}

/// What one archive is, inside its backend.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    /// The llama-server archive itself.
    Engine,
    /// The CUDA runtime DLLs, published apart from the engine: the engine
    /// archive alone will not start.
    CudaRuntimeDlls,
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
    /// Where this asset is published. A fact about the asset: upstream's
    /// rows share [`RELEASE_BASE`], the macOS arm64 engine lives at the
    /// fork's own CDN home, the probe model shares neither, and `url`
    /// special-cases none of them.
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
    /// trusted by provenance alone. Engine rows only: the CUDA runtime
    /// archives and the probe model hold no server, so theirs stays None
    /// with no further comment needed.
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

// Upstream's sizes and sha256 digests below are the release's own published
// figures, read from the GitHub release asset list on 2026-09-14 and
// transcribed verbatim. The digest is what makes a download provably the
// build we meant: `kalsa-download` renames bytes onto their final name only
// when size and sha256 both hold.
// The upstream engine rows' exe_sha256 was measured on 2026-09-15 on a
// macOS arm64 machine: each archive downloaded through `kalsa-download`
// (which refuses to rename bytes whose size and digest do not hold),
// extracted with this crate's own extractor, and the server executable
// hashed — `llama-server` under `llama-b10950/` for the upstream macOS
// tarballs, `llama-server.exe` at the archive root for the Windows zips.
// Nothing was executed to learn them: a digest is over bytes, and the
// archive digest already proves whose bytes.
// The four Windows engine archives ship the byte-identical server; only
// their backend libraries differ. Non-engine rows carry no server, so
// theirs stays None: there is nothing to hash.
//
// The fork row's numbers are transcribed from Kalsa's own published
// manifest for the release the row names — `FORK_BASE` + `/manifest.json`,
// the macos-arm64/metal row, read live on 2026-09-23 — because an archive
// rebuilt from the same tag is not byte-identical and the manifest the
// publisher serves is the record of THAT object. `size_bytes` and `sha256`
// are what `store.rs` verifies the download against, so they are data and
// not prose: `dev/test-engine-pin.py` re-reads the manifest and compares
// this row field by field (home, file, size_bytes, sha256, exe_sha256).
// Reading v1.1.0's manifest beside v1.1.1's settles the one question the
// row's comment answers: the archives differ in size (11 205 316 ->
// 11 207 195) and digest (9ee5d9f5… -> a90d88a1…), and their launchers do
// not — exe_sha256 327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde
// in BOTH manifests.
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
        file: "kalsa-server-v1.1.1-bin-macos-arm64.tar.gz",
        format: Some(ArchiveFormat::TarGz),
        // `exe_sha256` is the thin launcher `kalsa-server`, the binary the
        // archive's `libllama-server-impl.dylib` is loaded by. Its bytes do
        // NOT change between v1.1.0 and v1.1.1 — VERIFIED, not deduced:
        // both releases' published manifests state exe_sha256
        // 327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde,
        // read live on 2026-09-23, and the concurrency artifact records that
        // same digest as `provenance.engine_sha256` for the binary that
        // actually ran. So it is NOT the version identity — the ARCHIVE
        // `sha256` is, and it is the only number that tells the two
        // releases apart.
        // `crates/kalsa-runtime/src/marker.rs` keeps using this digest only
        // as an integrity check on the launcher, never to tell versions
        // apart.
        exe_sha256: Some("327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde"),
        size_bytes: Some(11_207_195),
        sha256: Some("a90d88a1650367c6821f70e625a4ff2d43744d5986580c206434381a732075a7"),
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
        home: RELEASE_BASE,
        file: "llama-b10950-bin-win-cpu-x64.zip",
        format: Some(ArchiveFormat::Zip),
        exe_sha256: Some("55fc2a7d17fb1ed5b4b81da5c4b87b6c04e65c84bf0bac371a55d783ea07a457"),
        size_bytes: Some(18_426_198),
        sha256: Some("36acf4d8880042beaab9d6a248bd47255988b43049a0a91a79f349c4193b79b9"),
    },
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Vulkan),
        platform: Some(Platform::WindowsX64),
        home: RELEASE_BASE,
        file: "llama-b10950-bin-win-vulkan-x64.zip",
        format: Some(ArchiveFormat::Zip),
        exe_sha256: Some("55fc2a7d17fb1ed5b4b81da5c4b87b6c04e65c84bf0bac371a55d783ea07a457"),
        size_bytes: Some(31_673_509),
        sha256: Some("787061f560eb2f14db7c03396cb56e59759b6dfccd162dc341b10cfa3bd5b779"),
    },
    // CUDA 12.4: 254 MB engine plus a 391 MB runtime archive, 645 MB in all.
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Cuda12),
        platform: Some(Platform::WindowsX64),
        home: RELEASE_BASE,
        file: "llama-b10950-bin-win-cuda-12.4-x64.zip",
        format: Some(ArchiveFormat::Zip),
        exe_sha256: Some("55fc2a7d17fb1ed5b4b81da5c4b87b6c04e65c84bf0bac371a55d783ea07a457"),
        size_bytes: Some(254_068_367),
        sha256: Some("b184393e8dc54fdcca4f4de5059b02d143d2dc813e7cd5d900d1b494d127004c"),
    },
    Asset {
        role: Role::CudaRuntimeDlls,
        backend: Some(ServerBackend::Cuda12),
        platform: Some(Platform::WindowsX64),
        home: RELEASE_BASE,
        file: "cudart-llama-bin-win-cuda-12.4-x64.zip",
        format: Some(ArchiveFormat::Zip),
        exe_sha256: None,
        size_bytes: Some(391_443_627),
        sha256: Some("8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6"),
    },
    // CUDA 13.3 - the release publishes 13.3, not 13.0: 150 MB engine plus
    // the same-sized runtime archive, 541 MB in all.
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Cuda13),
        platform: Some(Platform::WindowsX64),
        home: RELEASE_BASE,
        file: "llama-b10950-bin-win-cuda-13.3-x64.zip",
        format: Some(ArchiveFormat::Zip),
        exe_sha256: Some("55fc2a7d17fb1ed5b4b81da5c4b87b6c04e65c84bf0bac371a55d783ea07a457"),
        size_bytes: Some(149_703_269),
        sha256: Some("f960ae6651bc832c3ddb59e1afbf2c9e8cb6f63cbe125997596ab93b56db8011"),
    },
    Asset {
        role: Role::CudaRuntimeDlls,
        backend: Some(ServerBackend::Cuda13),
        platform: Some(Platform::WindowsX64),
        home: RELEASE_BASE,
        file: "cudart-llama-bin-win-cuda-13.3-x64.zip",
        format: Some(ArchiveFormat::Zip),
        exe_sha256: None,
        size_bytes: Some(390_970_417),
        sha256: Some("1462a050eb4c684921ba51dcc4cc488a036674c3e73e9945ee705b854808d03e"),
    },
    // The probe's tiny model: stories260K from ggml-org/tiny-llamas, the
    // models llama.cpp's own CI leans on. Size and digest verified against
    // the downloaded file (2026-09-14); the header reads as GGUFv3 with 48
    // tensors, which b10950 will load. UNPROVEN: nobody has run llama-server
    // against it yet, so a failed probe should suspect this file before
    // blaming the backend.
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

/// Every archive a backend needs, engine first: the CUDA DLL archive is
/// useless without the engine next to it.
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
        // CUDA is engine + separate CUDA DLL archive, per the release layout.
        assert_eq!(
            assets_for(Platform::WindowsX64, ServerBackend::Cuda12).len(),
            2
        );
        assert_eq!(
            assets_for(Platform::WindowsX64, ServerBackend::Cuda13).len(),
            2
        );
        // Nothing is published for any other platform.
        assert!(assets_for(Platform::MacArm64, ServerBackend::Vulkan).is_empty());
    }

    #[test]
    fn every_url_points_at_the_researched_release_by_name() {
        for asset in assets_for(Platform::WindowsX64, ServerBackend::Cuda12) {
            let url = asset.url();
            assert!(url.starts_with(RELEASE_BASE));
            // The tag lives in the URL path; the CUDA runtime archive's own
            // file name does not carry it, which matches the release layout.
            assert!(url.contains("b10950"), "{url}");
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
        // the CUDA runtime archives and the probe model hold no server, so
        // a digest there would bless bytes that are never executed.
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
        assert_eq!(row.file, "kalsa-server-v1.1.1-bin-macos-arm64.tar.gz");
        assert_eq!(row.format, Some(ArchiveFormat::TarGz));
        assert_eq!(row.size_bytes, Some(11_207_195));
        assert_eq!(
            row.sha256,
            Some("a90d88a1650367c6821f70e625a4ff2d43744d5986580c206434381a732075a7"),
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
            ServerBackend::Cuda12,
            ServerBackend::Cuda13,
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
