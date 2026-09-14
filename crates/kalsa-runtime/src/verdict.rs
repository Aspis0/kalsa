//! The persisted verdict: which build passed the probe on this machine.
//!
//! The probe costs a download and up to a minute once; the verdict costs a
//! file read afterwards. The file is only trusted while its fingerprint
//! still describes what was proven — the exact archive bytes, this machine's
//! hardware and driver — so the "seconds once" stays honest when the machine
//! or the build changes underneath it. A verdict for bytes that were never
//! probed is worthless by definition.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use kalsa_probe::Backend;

use crate::assets::{self, Platform, ServerBackend};

const MAGIC: &str = "kalsa-runtime v1";
const FILE_NAME: &str = "verdict.txt";

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Verdict {
    pub backend: ServerBackend,
    pub fingerprint: String,
}

/// The fingerprint a verdict for `backend` is held to: the digests of the
/// exact bytes that passed the probe — every archive of the build, engine
/// first — plus the machine facts that can flip a working backend into a
/// refusing one. The digests, not the release tag, because a row corrected
/// in place changes the bytes without changing the release: those bytes have
/// never been proven here, and the verdict must say so. An unfilled row
/// cannot be downloaded anyway; reading it as "unfilled" keeps the
/// fingerprint defined for the build-already-on-disk path.
///
/// The Windows driver version is included because a driver update is exactly
/// the kind of change that flips a working backend into a refusing one.
/// Elsewhere the driver ships with the OS, which the platform name already
/// stands for.
pub(crate) fn fingerprint(platform: Platform, backend: ServerBackend, detected: Backend) -> String {
    let build = assets::assets_for(platform, backend)
        .into_iter()
        .map(|asset| asset.sha256.unwrap_or("unfilled"))
        .collect::<Vec<_>>()
        .join("+");
    format!(
        "{build}|{}|{detected:?}|{}",
        std::env::consts::OS,
        driver_version()
    )
}

#[cfg(target_os = "windows")]
fn driver_version() -> String {
    let output = std::process::Command::new("wmic")
        .args(["path", "win32_VideoController", "get", "DriverVersion"])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            parse_driver_versions(&String::from_utf8_lossy(&output.stdout))
                .unwrap_or_else(|| "unknown".to_string())
        }
        // A verdict that survives without a driver reading is weaker, not
        // wrong: the probe proved this build here, and only a proven change
        // of machine should unprove it.
        _ => "unknown".to_string(),
    }
}

#[cfg(not(target_os = "windows"))]
fn driver_version() -> String {
    "os".to_string()
}

/// The driver versions in `wmic get DriverVersion` output, sorted so the
/// fingerprint does not depend on enumeration order.
#[cfg(any(target_os = "windows", test))]
pub(crate) fn parse_driver_versions(text: &str) -> Option<String> {
    let mut versions: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !line.eq_ignore_ascii_case("driverversion")
                && line.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .collect();
    versions.sort_unstable();
    (!versions.is_empty()).then(|| versions.join(","))
}

/// The verdict saved on this machine, if it parses. A torn or foreign file
/// reads as no verdict: the cost of re-probing is seconds.
pub(crate) fn load(dir: &Path) -> Option<Verdict> {
    let text = std::fs::read_to_string(path(dir)).ok()?;
    let mut backend = None;
    let mut fingerprint = None;
    for line in text.lines().skip(1) {
        match line.split_once('=') {
            Some(("backend", value)) => backend = ServerBackend::from_name(value),
            Some(("fingerprint", value)) => fingerprint = Some(value.to_string()),
            _ => {}
        }
    }
    // The magic must lead: a file we cannot recognise is not a verdict we
    // can trust, whoever wrote it.
    if !text.starts_with(MAGIC) {
        return None;
    }
    match (backend, fingerprint) {
        (Some(backend), Some(fingerprint)) => Some(Verdict {
            backend,
            fingerprint,
        }),
        _ => None,
    }
}

pub(crate) fn save(dir: &Path, verdict: &Verdict) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut file = std::fs::File::create(path(dir))?;
    // Written in one call: a torn write reads as no verdict at all, which is
    // the safe direction, but there is no reason to prefer torn.
    file.write_all(
        format!(
            "{MAGIC}\nbackend={}\nfingerprint={}\n",
            verdict.backend.name(),
            verdict.fingerprint
        )
        .as_bytes(),
    )?;
    file.flush()
}

fn path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-runtime-verdict-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_verdict_survives_a_restart_while_the_machine_is_unchanged() {
        let dir = scratch("roundtrip");
        let verdict = Verdict {
            backend: ServerBackend::Vulkan,
            fingerprint: fingerprint(Platform::WindowsX64, ServerBackend::Vulkan, Backend::Cpu),
        };
        save(&dir, &verdict).expect("save");
        let loaded = load(&dir).expect("load");
        assert_eq!(loaded, verdict);
        std::fs::remove_file(path(&dir)).expect("remove");
        assert_eq!(load(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_changed_build_or_machine_is_a_changed_fingerprint() {
        let vulkan = |detected| fingerprint(Platform::WindowsX64, ServerBackend::Vulkan, detected);
        assert_eq!(
            vulkan(Backend::Cpu),
            vulkan(Backend::Cpu),
            "the same build on the same machine is one fingerprint"
        );
        assert_ne!(
            vulkan(Backend::Cpu),
            vulkan(Backend::Metal),
            "a detection change is a machine change"
        );
        assert_ne!(
            vulkan(Backend::DiscreteGpu {
                vram_bytes: Some(8 << 30)
            }),
            vulkan(Backend::DiscreteGpu {
                vram_bytes: Some(4 << 30)
            }),
            "a smaller card is not the same machine"
        );
        assert_ne!(
            fingerprint(Platform::WindowsX64, ServerBackend::Vulkan, Backend::Cpu),
            fingerprint(Platform::WindowsX64, ServerBackend::Cuda12, Backend::Cpu),
            "a different build is a different fingerprint"
        );
    }

    #[test]
    fn the_fingerprint_carries_the_build_bytes_not_the_release() {
        // Digest over release tag: correcting a row in place changes the
        // bytes without changing the release, and those bytes have never
        // been probed. For a multi-archive build every archive counts.
        let cuda12 = assets::assets_for(Platform::WindowsX64, ServerBackend::Cuda12);
        let digests: Vec<&str> = cuda12
            .iter()
            .map(|asset| asset.sha256.expect("the row is filled in"))
            .collect();
        let fp = fingerprint(Platform::WindowsX64, ServerBackend::Cuda12, Backend::Cpu);
        for digest in digests {
            assert!(fp.contains(digest), "{fp}");
        }
        let fp = fingerprint(Platform::WindowsX64, ServerBackend::Vulkan, Backend::Cpu);
        let engine = assets::assets_for(Platform::WindowsX64, ServerBackend::Vulkan)
            .into_iter()
            .next()
            .and_then(|asset| asset.sha256)
            .expect("the vulkan engine row is filled in");
        assert!(fp.contains(engine), "{fp}");
    }

    #[test]
    fn a_torn_or_foreign_verdict_file_reads_as_none() {
        let dir = scratch("foreign");
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(path(&dir), "someone else's state file\nbackend=vulkan\n").expect("write");
        assert_eq!(load(&dir), None);
        std::fs::write(
            path(&dir),
            "kalsa-runtime v1\nbackend=not-a-backend\nfingerprint=x\n",
        )
        .expect("write");
        assert_eq!(load(&dir), None);
        std::fs::write(path(&dir), "kalsa-runtime v1\nbackend=vulkan\n").expect("write");
        assert_eq!(
            load(&dir),
            None,
            "a verdict without its fingerprint is not one"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn driver_versions_sort_so_enumeration_order_cannot_flip_a_fingerprint() {
        assert_eq!(
            parse_driver_versions("DriverVersion\n\n32.0.15.6109\n31.0.15.3623\n"),
            Some("31.0.15.3623,32.0.15.6109".to_string())
        );
        assert_eq!(parse_driver_versions("DriverVersion\n"), None);
    }
}
