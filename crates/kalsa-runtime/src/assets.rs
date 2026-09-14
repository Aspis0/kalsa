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
//! Sizes and digests below were read from the release's own asset list on
//! 2026-09-14 (GitHub publishes a sha256 digest per asset) and are exact.
//! Note the macOS builds ship as `.tar.gz`, not `.zip`, unlike every
//! Windows row.

/// Where the release assets live. One place, so a release bump is one edit.
const RELEASE_BASE: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b10950";

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
    pub(crate) fn name(&self) -> &'static str {
        match self {
            ServerBackend::Metal => "metal",
            ServerBackend::Cpu => "cpu",
            ServerBackend::Vulkan => "vulkan",
            ServerBackend::Cuda12 => "cuda12",
            ServerBackend::Cuda13 => "cuda13",
        }
    }

    pub(crate) fn from_name(name: &str) -> Option<ServerBackend> {
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
    /// Where this asset is published. A fact about the asset: every row in
    /// the llama.cpp release shares one home, the probe model does not, and
    /// `url` special-cases neither.
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
    /// sha256 of the extracted `llama-server` inside the engine archive: the
    /// identity of what we execute, re-checked on every start, because
    /// nothing under the user's directory is trusted by provenance alone.
    /// Engine rows only; None until filled in, and the build marker's own
    /// record is used meanwhile.
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

// Sizes and sha256 digests below are the release's own published figures,
// read from the GitHub release asset list on 2026-09-14 and transcribed
// verbatim. The digest is what makes a download provably the build we meant:
// `kalsa-download` renames bytes onto their final name only when size and
// sha256 both hold.
// TODO(marco): the engine rows' exe_sha256 — hash the llama-server that comes
// out of each engine archive once, and fill them in. Until then the build
// marker records what it extracted, which is honest about accident and honest
// about its limit.
const ASSETS: &[Asset] = &[
    // macOS ships one archive per architecture with Metal and CPU inside,
    // and ships it as a tar.gz.
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Metal),
        platform: Some(Platform::MacArm64),
        home: RELEASE_BASE,
        file: "llama-b10950-bin-macos-arm64.tar.gz",
        format: Some(ArchiveFormat::TarGz),
        exe_sha256: None,
        size_bytes: Some(11_145_395),
        sha256: Some("6e15e4b6e6646f247dcac1d1de056366b32a1cf73ae747874df9f84bb822e54b"),
    },
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Metal),
        platform: Some(Platform::MacX64),
        home: RELEASE_BASE,
        file: "llama-b10950-bin-macos-x64.tar.gz",
        format: Some(ArchiveFormat::TarGz),
        exe_sha256: None,
        size_bytes: Some(11_194_463),
        sha256: Some("e4ba7d0c11ebb5bdf0279aa5b2e26c8efb28d9694fe8c0a45d12a37437831c75"),
    },
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Cpu),
        platform: Some(Platform::WindowsX64),
        home: RELEASE_BASE,
        file: "llama-b10950-bin-win-cpu-x64.zip",
        format: Some(ArchiveFormat::Zip),
        exe_sha256: None,
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
        exe_sha256: None,
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
        exe_sha256: None,
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
        exe_sha256: None,
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
        // One macOS archive per architecture, all carrying Metal+CPU.
        assert_eq!(
            assets_for(Platform::MacArm64, ServerBackend::Metal).len(),
            1
        );
        assert_eq!(assets_for(Platform::MacX64, ServerBackend::Metal).len(), 1);
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
