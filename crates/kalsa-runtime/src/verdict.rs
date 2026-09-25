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

#[cfg(target_os = "windows")]
use kalsa_probe::{command_text, once_present};

use crate::assets::{self, Asset, Platform, ServerBackend};

const MAGIC: &str = "kalsa-runtime v1";
const FILE_NAME: &str = "verdict.txt";
/// The processor fallback's verdict: the same format, its own file, so a
/// fallback answer can never stand in for the main walk's — `decide.rs`'s
/// `verdict_slot` is the one place that chooses between them.
const PROCESSOR_FALLBACK_FILE_NAME: &str = "verdict-fallback.txt";

/// Which verdict file an ask reads and writes. The slot is the ask's
/// identity, not a change of trust: both files parse the same `MAGIC`, carry
/// the same `backend`/`fingerprint` lines, and are gated by the same
/// fingerprint formula — one file name apart.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Slot {
    /// The whole walk's answer (`decide`).
    Main,
    /// The CPU-only ask's answer (`decide_cpu` — the processor fallback).
    ProcessorFallback,
}

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
pub fn fingerprint(platform: Platform, backend: ServerBackend, detected: Backend) -> String {
    fingerprint_of(&assets::assets_for(platform, backend), detected)
}

/// The fingerprint of these exact archives on this machine: every archive's
/// digest, joined in the order they were handed over, plus the machine facts
/// the doc above names.
fn fingerprint_of(assets: &[&Asset], detected: Backend) -> String {
    let build = assets
        .iter()
        .map(|asset| asset.sha256.unwrap_or("unfilled"))
        .collect::<Vec<_>>()
        .join("+");
    format!(
        "{build}|{}|{detected:?}|{}",
        std::env::consts::OS,
        driver_version()
    )
}

/// wmic's query, exactly as it has always run.
#[cfg(any(target_os = "windows", test))]
const WMIC_DRIVERS: [&str; 4] = ["path", "win32_VideoController", "get", "DriverVersion"];

/// The PowerShell fallback for the same class and field, one version per
/// line — the shape `parse_driver_versions` already reads.
#[cfg(any(target_os = "windows", test))]
const POWERSHELL_DRIVERS: [&str; 4] = [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_VideoController | ForEach-Object { $_.DriverVersion }",
];

/// The driver text from whichever producer answered. wmic runs first, as
/// before; PowerShell is the fallback because Windows 11 24H2/25H2 no
/// longer ship wmic — its latency on a real machine is not measured. The
/// fallback is consulted only when wmic did not answer, which is three
/// things: it could not run, it did not succeed, or a zero-exit run printed
/// no version line at all — so a machine with a working wmic pays nothing
/// for the fallback.
#[cfg(any(target_os = "windows", test))]
fn driver_text(
    wmic: impl FnOnce() -> Option<String>,
    powershell: impl FnOnce() -> Option<String>,
) -> Option<String> {
    match wmic().filter(|text| parse_driver_versions(text).is_some()) {
        Some(text) => Some(text),
        None => powershell(),
    }
}

/// How long a producer gets to answer. Ten seconds: far above wmic's or
/// PowerShell's honest work, short enough that a stuck one costs one
/// attempt, not the fingerprint.
#[cfg(target_os = "windows")]
const ANSWER_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

/// The driver version, asked once per process once a version PARSES
/// (`once_present`, for the same reason as the detection): `decide` may
/// compute the fingerprint twice, and a failed read must not freeze
/// "unknown" in place. A verdict that survives without a driver reading is
/// weaker, not wrong: the probe proved this build here, and only a proven
/// change of machine should unprove it.
#[cfg(target_os = "windows")]
fn driver_version() -> String {
    static DRIVERS: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    once_present(&DRIVERS, || {
        driver_text(
            || command_text("wmic", &WMIC_DRIVERS, ANSWER_DEADLINE),
            || command_text("powershell", &POWERSHELL_DRIVERS, ANSWER_DEADLINE),
        )
        .and_then(|text| parse_driver_versions(&text))
    })
    .unwrap_or_else(|| "unknown".to_string())
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
pub(crate) fn load(dir: &Path, slot: Slot) -> Option<Verdict> {
    let text = std::fs::read_to_string(path(dir, slot)).ok()?;
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

pub(crate) fn save(dir: &Path, verdict: &Verdict, slot: Slot) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut file = std::fs::File::create(path(dir, slot))?;
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

fn path(dir: &Path, slot: Slot) -> PathBuf {
    dir.join(match slot {
        Slot::Main => FILE_NAME,
        Slot::ProcessorFallback => PROCESSOR_FALLBACK_FILE_NAME,
    })
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
        save(&dir, &verdict, Slot::Main).expect("save");
        let loaded = load(&dir, Slot::Main).expect("load");
        assert_eq!(loaded, verdict);
        std::fs::remove_file(path(&dir, Slot::Main)).expect("remove");
        assert_eq!(load(&dir, Slot::Main), None);
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
            fingerprint(Platform::WindowsX64, ServerBackend::Cpu, Backend::Cpu),
            "a different build is a different fingerprint"
        );
    }

    #[test]
    fn the_fingerprint_carries_the_build_bytes_not_the_release() {
        // Digest over release tag: correcting a row in place changes the
        // bytes without changing the release, and those bytes have never
        // been probed.
        let fp = fingerprint(Platform::WindowsX64, ServerBackend::Vulkan, Backend::Cpu);
        let engine = assets::assets_for(Platform::WindowsX64, ServerBackend::Vulkan)
            .into_iter()
            .next()
            .and_then(|asset| asset.sha256)
            .expect("the vulkan engine row is filled in");
        assert!(fp.contains(engine), "{fp}");
    }

    #[test]
    fn every_archive_of_a_build_joins_into_the_fingerprint() {
        // Synthetic two-asset build: every table row is a single archive
        // now, so the join — each archive's bytes pinned, not only the
        // first's — needs an input the table cannot express.
        const ENGINE_SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        const EXTRA_SHA: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let engine = Asset {
            role: assets::Role::Engine,
            backend: None,
            platform: None,
            home: "https://example.invalid",
            file: "engine.zip",
            format: None,
            size_bytes: Some(1),
            sha256: Some(ENGINE_SHA),
            exe_sha256: None,
        };
        let extra = Asset {
            role: assets::Role::Engine,
            backend: None,
            platform: None,
            home: "https://example.invalid",
            file: "extra.zip",
            format: None,
            size_bytes: Some(1),
            sha256: Some(EXTRA_SHA),
            exe_sha256: None,
        };
        let fp = fingerprint_of(&[&engine, &extra], Backend::Cpu);
        assert!(
            fp.contains(&format!("{ENGINE_SHA}+{EXTRA_SHA}")),
            "every archive's digest must be in the fingerprint, joined: {fp}"
        );
    }

    #[test]
    fn a_verdict_naming_a_build_this_app_does_not_ship_reads_as_none() {
        // Trap: an install that ran a build offering another backend still
        // has its string on disk. The parse must degrade to "no verdict"
        // (the walk re-chooses), never panic and never block the start.
        let dir = scratch("retired-backend");
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(
            path(&dir, Slot::Main),
            "kalsa-runtime v1\nbackend=cuda12\nfingerprint=x\n",
        )
        .expect("write");
        assert_eq!(load(&dir, Slot::Main), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_torn_or_foreign_verdict_file_reads_as_none() {
        let dir = scratch("foreign");
        std::fs::create_dir_all(&dir).expect("mkdir");
        std::fs::write(
            path(&dir, Slot::Main),
            "someone else's state file\nbackend=vulkan\n",
        )
        .expect("write");
        assert_eq!(load(&dir, Slot::Main), None);
        std::fs::write(
            path(&dir, Slot::Main),
            "kalsa-runtime v1\nbackend=not-a-backend\nfingerprint=x\n",
        )
        .expect("write");
        assert_eq!(load(&dir, Slot::Main), None);
        std::fs::write(path(&dir, Slot::Main), "kalsa-runtime v1\nbackend=vulkan\n")
            .expect("write");
        assert_eq!(
            load(&dir, Slot::Main),
            None,
            "a verdict without its fingerprint is not one"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_processor_fallback_slot_is_the_same_format_in_its_own_file() {
        let dir = scratch("fallback-slot");
        let detected = Backend::DiscreteGpu {
            vram_bytes: Some(6 << 30),
        };
        let verdict = Verdict {
            backend: ServerBackend::Cpu,
            fingerprint: fingerprint(Platform::WindowsX64, ServerBackend::Cpu, detected),
        };
        save(&dir, &verdict, Slot::ProcessorFallback).expect("save");
        // The same format, whatever the file is called: the magic leads, the
        // lines parse back.
        let text = std::fs::read_to_string(path(&dir, Slot::ProcessorFallback)).expect("read");
        assert!(text.starts_with(MAGIC), "{text}");
        assert!(text.contains("backend=cpu"), "{text}");
        assert_eq!(
            load(&dir, Slot::ProcessorFallback).expect("load"),
            verdict,
            "the same fingerprint formula answers from the second slot"
        );
        assert_eq!(load(&dir, Slot::Main), None, "the main file is untouched");
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

    #[test]
    fn the_powershell_fallback_answers_only_when_wmic_cannot() {
        let calls = std::cell::Cell::new(0);
        let fallback = || {
            calls.set(calls.get() + 1);
            Some("31.0.15.5222".to_string())
        };
        assert_eq!(
            driver_text(|| Some("DriverVersion\n32.0.15.6109".to_string()), fallback).as_deref(),
            Some("DriverVersion\n32.0.15.6109"),
            "wmic answered: the fallback must not even run"
        );
        assert_eq!(calls.get(), 0);
        assert_eq!(
            driver_text(|| None, fallback).as_deref(),
            Some("31.0.15.5222"),
            "wmic gone (24H2/25H2): the fallback answers"
        );
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn a_zero_exit_wmic_with_no_version_line_makes_the_fallback_answer() {
        let calls = std::cell::Cell::new(0);
        let fallback = || {
            calls.set(calls.get() + 1);
            Some("31.0.15.5222".to_string())
        };
        assert_eq!(
            driver_text(|| Some("No Instance(s) Available.\r\n".to_string()), fallback).as_deref(),
            Some("31.0.15.5222"),
            "a wmic that says nothing answered nothing"
        );
        assert_eq!(
            driver_text(|| Some("DriverVersion\r\n".to_string()), fallback).as_deref(),
            Some("31.0.15.5222"),
            "a bare header is not a version line either"
        );
        assert_eq!(calls.get(), 2);
    }


    #[test]
    fn both_producers_ask_the_video_controller_class_for_its_driver_versions() {
        assert_eq!(
            WMIC_DRIVERS,
            ["path", "win32_VideoController", "get", "DriverVersion"]
        );
        assert_eq!(
            POWERSHELL_DRIVERS,
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-CimInstance Win32_VideoController | ForEach-Object { $_.DriverVersion }"
            ]
        );
    }

    #[test]
    fn powershell_driver_lines_parse_like_wmic_lines() {
        // One version per line, no header, and a null DriverVersion arriving
        // as an empty line the parser already drops.
        assert_eq!(
            parse_driver_versions("\n31.0.15.3623\n\n32.0.15.6109\n"),
            Some("31.0.15.3623,32.0.15.6109".to_string())
        );
    }
}
