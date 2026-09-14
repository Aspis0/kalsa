//! The persisted verdict: which build passed the probe on this machine.
//!
//! The probe costs a download and up to a minute once; the verdict costs a
//! file read afterwards. The file is only trusted while its fingerprint
//! still describes this machine — hardware, driver and release tag — so the
//! "seconds once" stays honest when the machine changes underneath it. A
//! verdict from another release is worthless by definition: a new build has
//! never been proven here.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use kalsa_probe::Backend;

use crate::assets::{ServerBackend, LLAMA_RELEASE};

const MAGIC: &str = "kalsa-runtime v1";
const FILE_NAME: &str = "verdict.txt";

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Verdict {
    pub backend: ServerBackend,
    pub fingerprint: String,
}

/// The fingerprint of the machine (and the release) a verdict belongs to.
/// Includes the Windows driver version, because a driver update is exactly
/// the kind of change that flips a working backend into a refusing one.
/// Elsewhere the driver ships with the OS, which the platform name already
/// stands for.
pub(crate) fn machine_fingerprint(detected: Backend) -> String {
    format!(
        "{}|{}|{detected:?}|{}",
        LLAMA_RELEASE,
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
            fingerprint: machine_fingerprint(Backend::Cpu),
        };
        save(&dir, &verdict).expect("save");
        let loaded = load(&dir).expect("load");
        assert_eq!(loaded, verdict);
        std::fs::remove_file(path(&dir)).expect("remove");
        assert_eq!(load(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_changed_backend_is_a_changed_machine() {
        let metal = machine_fingerprint(Backend::Metal);
        let gpu = machine_fingerprint(Backend::DiscreteGpu {
            vram_bytes: Some(8 << 30),
        });
        let gpu_other = machine_fingerprint(Backend::DiscreteGpu {
            vram_bytes: Some(4 << 30),
        });
        assert_ne!(metal, gpu);
        assert_ne!(gpu, gpu_other, "a smaller card is not the same machine");
        assert_eq!(
            gpu,
            machine_fingerprint(Backend::DiscreteGpu {
                vram_bytes: Some(8 << 30)
            })
        );
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
