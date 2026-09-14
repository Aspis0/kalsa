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
//! Researched against release b10950 (2026-09-14). Asset file names follow the
//! release's own naming but the exact sizes and digests below are NOT verified
//! yet — nothing downloads until they are, by design.

/// The llama.cpp release every asset below is cut from. Part of the verdict
/// fingerprint: a new release means a new build, and a new build must be
/// proven on this machine again.
pub(crate) const LLAMA_RELEASE: &str = "b10950";

/// Where the release assets live. One place, so a release bump is one edit.
const RELEASE_BASE: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b10950";

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

/// One release artifact and the promise a download of it is held to.
pub(crate) struct Asset {
    role: Role,
    backend: Option<ServerBackend>,
    platform: Option<Platform>,
    /// The file name in the release; the URL is built from it.
    pub(crate) file: &'static str,
    /// Exact compressed byte size. None until verified against the release.
    pub(crate) size_bytes: Option<u64>,
    /// sha256 over the archive, exactly as published. None until verified.
    pub(crate) sha256: Option<&'static str>,
}

impl Asset {
    /// The download URL: the release base plus the asset's own file name.
    pub(crate) fn url(&self) -> String {
        format!("{RELEASE_BASE}/{}", self.file)
    }

    /// A row without both promises is not downloadable, whatever its URL
    /// says: `store` refuses it before a single byte moves.
    pub(crate) fn verified(&self) -> bool {
        self.size_bytes.is_some() && self.sha256.is_some()
    }
}

// TODO(marco): fill every None below with the exact size and sha256 you verify
// against https://github.com/ggml-org/llama.cpp/releases/tag/b10950 (the
// ~figures in the comments are the researched approximations, not promises).
// The digests are what makes a download provably the build we meant; until
// they are in, this crate refuses to download anything, on purpose.
const ASSETS: &[Asset] = &[
    // macOS ships one archive per architecture with Metal and CPU inside.
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Metal),
        platform: Some(Platform::MacArm64),
        file: "llama-b10950-bin-macos-arm64.zip",
        size_bytes: None, // ~11 MB
        sha256: None,
    },
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Metal),
        platform: Some(Platform::MacX64),
        file: "llama-b10950-bin-macos-x64.zip",
        size_bytes: None, // ~11 MB
        sha256: None,
    },
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Cpu),
        platform: Some(Platform::WindowsX64),
        file: "llama-b10950-bin-win-cpu-x64.zip",
        size_bytes: None, // ~18 MB
        sha256: None,
    },
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Vulkan),
        platform: Some(Platform::WindowsX64),
        file: "llama-b10950-bin-win-vulkan-x64.zip",
        size_bytes: None, // ~32 MB
        sha256: None,
    },
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Cuda12),
        platform: Some(Platform::WindowsX64),
        file: "llama-b10950-bin-win-cuda-12.4-x64.zip",
        size_bytes: None, // engine; ~645 MB with the DLL archive below
        sha256: None,
    },
    Asset {
        role: Role::CudaRuntimeDlls,
        backend: Some(ServerBackend::Cuda12),
        platform: Some(Platform::WindowsX64),
        file: "cudart-llama-bin-win-cuda-12.4-x64.zip",
        size_bytes: None, // DLLs; see the engine row above
        sha256: None,
    },
    Asset {
        role: Role::Engine,
        backend: Some(ServerBackend::Cuda13),
        platform: Some(Platform::WindowsX64),
        file: "llama-b10950-bin-win-cuda-13.0-x64.zip",
        size_bytes: None, // engine; ~541 MB with the DLL archive below
        sha256: None,
    },
    Asset {
        role: Role::CudaRuntimeDlls,
        backend: Some(ServerBackend::Cuda13),
        platform: Some(Platform::WindowsX64),
        file: "cudart-llama-bin-win-cuda-13.0-x64.zip",
        size_bytes: None, // DLLs; see the engine row above
        sha256: None,
    },
    // llama.cpp publishes no GGUFs, so the probe's tiny model is our own
    // asset. /health only answers 200 once a model is loaded, which is why
    // the probe needs one at all: a few MB against the gigabytes this crate
    // exists to precede.
    // TODO(marco): host it and fill in the real home, size and digest.
    Asset {
        role: Role::ProbeModel,
        backend: None,
        platform: None,
        file: "kalsa-probe-tiny-q4_0.gguf",
        size_bytes: None, // a few MB at most
        sha256: None,
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
    fn no_row_invents_a_digest_or_a_size() {
        // A made-up digest would pass verification and then poison the one
        // check that makes a download trustworthy. Absence is honest; a
        // plausible-looking lie is not.
        for backend in [
            ServerBackend::Metal,
            ServerBackend::Cpu,
            ServerBackend::Vulkan,
            ServerBackend::Cuda12,
            ServerBackend::Cuda13,
        ] {
            let platform = if backend == ServerBackend::Metal {
                Platform::MacArm64
            } else {
                Platform::WindowsX64
            };
            for asset in assets_for(platform, backend) {
                assert!(!asset.verified(), "{} is not verified yet", asset.file);
            }
        }
        assert!(!probe_model().verified());
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
