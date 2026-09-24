//! What this machine offers, by detection only.
//!
//! No GPU code lives here and no driver is loaded: this asks the platform's own
//! inventory — a compile-time fact, a cheap command, or a file the driver already
//! exports — and answers [`Backend`]. Where an honest answer would cost a heavy
//! dependency or several seconds of the user's first start, it says
//! [`Backend::Unknown`] instead of guessing.
//!
//! The parsers take text, so they are tested here with canned platform output
//! even though only one platform is running.

use crate::path::Backend;

#[cfg(target_os = "windows")]
use crate::{command_text, once_present};

/// Windows reports VRAM in a 32-bit field: it cannot represent 8 GiB at all, and
/// the maximum value means "saturated", not "4294967295 bytes". Anything at or
/// above this is refused rather than reported as a size.
#[cfg(any(target_os = "windows", test))]
const WMI_SATURATION_BYTES: u64 = u32::MAX as u64;

pub fn backend() -> Backend {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        // Every Apple Silicon Mac has a Metal GPU, and llama.cpp uses it.
        Backend::Metal
    }
    #[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
    {
        // An Intel Mac may or may not have a discrete GPU, and finding out means
        // `system_profiler`, which takes seconds. Not worth a first start.
        Backend::Unknown
    }
    #[cfg(target_os = "windows")]
    {
        windows_backend()
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        linux_backend()
    }
}

/// wmic's query, exactly as it has always run: the class and fields the
/// parser below reads, the memory value leading each row.
#[cfg(any(target_os = "windows", test))]
const WMIC_CONTROLLERS: [&str; 4] = ["path", "win32_VideoController", "get", "name,AdapterRAM"];

/// The PowerShell fallback, asking the SAME class for the SAME fields as
/// deterministic line text — no Format-Table, whose widths and locale are
/// not a contract: one `<AdapterRAM> <Name>` line per controller, where a
/// null AdapterRAM leaves the line without its leading number.
#[cfg(any(target_os = "windows", test))]
const POWERSHELL_CONTROLLERS: [&str; 4] = [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_VideoController | ForEach-Object { \"$($_.AdapterRAM) $($_.Name)\" }",
];

/// The controllers' text from whichever producer answered. wmic runs first,
/// exactly as before; PowerShell is the fallback because Windows 11 24H2/25H2
/// no longer ship wmic — its latency on a real machine is not measured. The
/// fallback is consulted only when wmic did not answer, which is three
/// things: it could not run, it did not succeed, or a zero-exit run printed
/// no controller row ("No Instance(s) Available.", or a bare header) — so a
/// machine with a working wmic pays nothing for the fallback.
#[cfg(any(target_os = "windows", test))]
fn controllers_text(
    wmic: impl FnOnce() -> Option<String>,
    powershell: impl FnOnce() -> Option<String>,
) -> Option<String> {
    match wmic().filter(|text| has_a_controller_row(text)) {
        Some(text) => Some(text),
        None => powershell(),
    }
}

/// Whether the text holds at least one controller row: wmic prints its
/// column header whenever it prints rows, so an answer with a header and
/// nothing under it — or a zero-exit "No Instance(s) Available." with no
/// header at all — answered nothing, and the fallback must be asked.
#[cfg(any(target_os = "windows", test))]
fn has_a_controller_row(text: &str) -> bool {
    let non_empty: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let header = non_empty.iter().any(|l| l.to_ascii_lowercase().contains("adapterram"));
    header && non_empty.len() > 1
}

/// How long a producer gets to answer. Ten seconds: far above wmic's or
/// PowerShell's honest work, short enough that a stuck one costs one
/// attempt, not the app.
#[cfg(target_os = "windows")]
const ANSWER_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

/// The detection, asked once per process once it ANSWERS (`once_present`):
/// it is asked twice per measurement and once more by the app's startup
/// seed, and every ask spawns wmic — and on 24H2/25H2, PowerShell. Only a
/// present answer is cached, so one timeout, or a WMI service not yet up
/// at boot, cannot freeze `Unknown` into the record for thirty days.
#[cfg(target_os = "windows")]
fn windows_backend() -> Backend {
    static DETECTED: std::sync::OnceLock<Option<Backend>> = std::sync::OnceLock::new();
    once_present(&DETECTED, Backend::Unknown, || {
        controllers_text(
            || command_text("wmic", &WMIC_CONTROLLERS, ANSWER_DEADLINE),
            || command_text("powershell", &POWERSHELL_CONTROLLERS, ANSWER_DEADLINE),
        )
        .map(|text| backend_from_video_controllers(&text))
    })
}

#[cfg(all(unix, not(target_os = "macos")))]
fn linux_backend() -> Backend {
    // Vendor ids in the driver's own sysfs tree, and the VRAM figures amdgpu and
    // the NVIDIA driver already expose as files: no lspci, no nvidia-smi.
    let mut found = Vec::new();
    if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("card") || name.contains('-') {
                continue;
            }
            let device = entry.path().join("device");
            let vendor = std::fs::read_to_string(device.join("vendor")).unwrap_or_default();
            let vendor = vendor.trim().to_ascii_lowercase();
            let vram = std::fs::read_to_string(device.join("mem_info_vram_total"))
                .ok()
                .and_then(|text| text.trim().parse::<u64>().ok());
            if vendor == "0x10de" || vendor == "0x1002" {
                found.push(DiscreteCard {
                    vendor,
                    vram_bytes: vram,
                });
            }
        }
    }
    if let Some(card) = found
        .into_iter()
        .max_by_key(|card| card.vram_bytes.unwrap_or(0))
    {
        let vram = card.vram_bytes.or_else(nvidia_vram_from_proc);
        return Backend::DiscreteGpu { vram_bytes: vram };
    }
    // No discrete card in sysfs: either none, or a driver that does not export
    // one. Both are "the CPU is the answer here" as far as we can tell.
    Backend::Cpu
}

#[cfg(all(unix, not(target_os = "macos")))]
struct DiscreteCard {
    #[allow(dead_code)]
    vendor: String,
    vram_bytes: Option<u64>,
}

/// The NVIDIA driver writes "Video Memory: 8192 MiB" per GPU under /proc.
#[cfg(all(unix, not(target_os = "macos")))]
fn nvidia_vram_from_proc() -> Option<u64> {
    let entries = std::fs::read_dir("/proc/driver/nvidia/gpus").ok()?;
    for entry in entries.flatten() {
        let text = std::fs::read_to_string(entry.path().join("information")).ok()?;
        if let Some(bytes) = parse_nvidia_video_memory(&text) {
            return Some(bytes);
        }
    }
    None
}

/// `Video Memory: 8192 MiB` (or GiB), as the NVIDIA driver reports it.
#[cfg(any(all(unix, not(target_os = "macos")), test))]
pub fn parse_nvidia_video_memory(text: &str) -> Option<u64> {
    let line = text
        .lines()
        .find(|line| line.trim_start().starts_with("Video Memory:"))?;
    let value = line.split(':').nth(1)?.trim();
    let mut parts = value.split_whitespace();
    let amount: u64 = parts.next()?.parse().ok()?;
    let unit = parts.next()?.to_ascii_lowercase();
    if unit.starts_with("mib") {
        Some(amount * 1024 * 1024)
    } else if unit.starts_with("gib") {
        Some(amount * 1024 * 1024 * 1024)
    } else {
        None
    }
}

/// Reads the video controllers' text — wmic's, or the PowerShell fallback's
/// with the same shape: the memory, when there is one, leading each row.
///
/// The name decides whether it is discrete; the memory is only reported when it
/// is not sitting on the 32-bit saturation point WMI is famous for.
#[cfg(any(target_os = "windows", test))]
pub fn backend_from_video_controllers(text: &str) -> Backend {
    let mut best: Option<u64> = None;
    let mut discrete = false;
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        // The memory, when present, is the row's FIRST token — both
        // producers shape it that way — and it is consumed only when it
        // parses as a size: a numberless row keeps its whole name ("NVIDIA
        // T400" stays discrete), and a number further into a name ("RX
        // 6600") is never a size.
        let mut tokens = line.split_whitespace().peekable();
        let mut memory: Option<u64> = None;
        if let Some(bytes) = tokens.peek().and_then(|token| token.parse::<u64>().ok()) {
            memory = Some(bytes);
            tokens.next();
        }
        let mut name = String::new();
        for token in tokens {
            name.push_str(token);
            name.push(' ');
        }
        let lowered = name.to_ascii_lowercase();
        if lowered.contains("name") && lowered.contains("adapterram") {
            continue; // the header row
        }
        let looks_discrete = (lowered.contains("nvidia")
            || lowered.contains("geforce")
            || lowered.contains("quadro")
            || lowered.contains("radeon")
            || lowered.contains("rx ")
            || lowered.contains("arc "))
            && !lowered.contains("intel");
        if looks_discrete {
            discrete = true;
            // A saturated 32-bit reading is "at least this much", not a
            // size — and a zero AdapterRAM is the same non-answer: no card
            // has zero bytes, so both read as an unknown size.
            if let Some(bytes) = memory.filter(|bytes| *bytes != 0 && *bytes < WMI_SATURATION_BYTES) {
                best = Some(best.map_or(bytes, |current| current.max(bytes)));
            }
        }
    }
    if discrete {
        Backend::DiscreteGpu { vram_bytes: best }
    } else {
        Backend::Cpu
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn intel_only_machines_are_cpu_machines() {
        let text = "AdapterRAM  Name\n1073741824  Intel(R) UHD Graphics 630\n";
        assert_eq!(backend_from_video_controllers(text), Backend::Cpu);
    }

    #[test]
    fn a_discrete_card_is_recognised_with_its_memory() {
        // What WMI can actually print: a 32-bit byte count.
        let text = "AdapterRAM  Name\n3221225472  NVIDIA GeForce GTX 1650\n";
        assert_eq!(
            backend_from_video_controllers(text),
            Backend::DiscreteGpu {
                vram_bytes: Some(3221225472)
            }
        );
        let amd = "AdapterRAM  Name\n4293918720  AMD Radeon RX 6600\n";
        assert_eq!(
            backend_from_video_controllers(amd),
            Backend::DiscreteGpu {
                vram_bytes: Some(4293918720)
            }
        );
    }

    #[test]
    fn a_saturated_wmi_reading_is_not_a_memory_size() {
        // 4 GiB and the 32-bit maximum both mean "at least this much".
        let text = "AdapterRAM  Name\n4294967295  NVIDIA GeForce RTX 4090\n";
        assert_eq!(
            backend_from_video_controllers(text),
            Backend::DiscreteGpu { vram_bytes: None },
            "4090 has 24 GiB, and WMI cannot say so"
        );
    }

    #[test]
    fn nvidia_video_memory_parses_mib_and_gib() {
        assert_eq!(
            parse_nvidia_video_memory("Model: RTX 4090\nVideo Memory: 24564 MiB\n"),
            Some(24564 * 1024 * 1024)
        );
        assert_eq!(
            parse_nvidia_video_memory("Video Memory: 24 GiB\n"),
            Some(24 * 1024 * 1024 * 1024)
        );
        assert_eq!(parse_nvidia_video_memory("Model: something\n"), None);
        assert_eq!(parse_nvidia_video_memory("Video Memory: a lot\n"), None);
    }

    #[test]
    fn the_powershell_fallback_answers_only_when_wmic_cannot() {
        let calls = std::cell::Cell::new(0);
        let fallback = || {
            calls.set(calls.get() + 1);
            Some("3221225472  NVIDIA GeForce RTX 4060".to_string())
        };
        let answered =
            || Some("AdapterRAM  Name\n  Intel(R) UHD Graphics\n".to_string());
        assert_eq!(
            controllers_text(answered, fallback).as_deref(),
            Some("AdapterRAM  Name\n  Intel(R) UHD Graphics\n"),
            "wmic answered: the fallback must not even run"
        );
        assert_eq!(calls.get(), 0);
        assert_eq!(
            controllers_text(|| None, fallback).as_deref(),
            Some("3221225472  NVIDIA GeForce RTX 4060"),
            "wmic gone (24H2/25H2): the fallback answers"
        );
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn a_zero_exit_wmic_with_no_controller_row_makes_the_fallback_answer() {
        let calls = std::cell::Cell::new(0);
        let fallback = || {
            calls.set(calls.get() + 1);
            Some("  Intel(R) UHD Graphics".to_string())
        };
        assert_eq!(
            controllers_text(
                || Some("No Instance(s) Available.\r\n".to_string()),
                fallback
            )
            .as_deref(),
            Some("  Intel(R) UHD Graphics"),
            "a wmic that says nothing answered nothing"
        );
        assert_eq!(
            controllers_text(|| Some("AdapterRAM  Name\r\n".to_string()), fallback).as_deref(),
            Some("  Intel(R) UHD Graphics"),
            "a bare header is not a controller row either"
        );
        assert_eq!(calls.get(), 2);
    }

    #[test]
    fn both_producers_ask_the_video_controller_class_for_the_same_fields() {
        assert_eq!(
            WMIC_CONTROLLERS,
            ["path", "win32_VideoController", "get", "name,AdapterRAM"]
        );
        assert_eq!(POWERSHELL_CONTROLLERS[..3], ["-NoProfile", "-NonInteractive", "-Command"]);
        assert_eq!(
            POWERSHELL_CONTROLLERS[3],
            "Get-CimInstance Win32_VideoController | ForEach-Object { \"$($_.AdapterRAM) $($_.Name)\" }"
        );
    }

    #[test]
    fn powershell_text_with_a_null_adapter_ram_parses_without_inventing_a_size() {
        // The fallback's exact shape for a null AdapterRAM: the interpolation
        // yields nothing, so the row arrives numberless with a leading space —
        // and a number inside a name is never that card's memory.
        assert_eq!(
            backend_from_video_controllers(" NVIDIA GeForce RTX 4090"),
            Backend::DiscreteGpu { vram_bytes: None }
        );
        assert_eq!(
            backend_from_video_controllers(" AMD Radeon RX 6600"),
            Backend::DiscreteGpu { vram_bytes: None }
        );
        assert_eq!(backend_from_video_controllers("  Intel(R) UHD Graphics 770"), Backend::Cpu);
    }

    #[test]
    fn powershell_text_with_two_controllers_picks_the_discrete_one() {
        assert_eq!(
            backend_from_video_controllers(
                "  Intel(R) UHD Graphics 770\n3221225472  NVIDIA GeForce RTX 4060\n"
            ),
            Backend::DiscreteGpu {
                vram_bytes: Some(3221225472)
            }
        );
    }

    #[test]
    fn a_numberless_row_keeps_whole_its_name() {
        // The regression the first-token rule introduced: consuming the
        // first token unconditionally ate the marker itself ("NVIDIA"),
        // and these cards read as CPU.
        assert_eq!(
            backend_from_video_controllers(" NVIDIA T400"),
            Backend::DiscreteGpu { vram_bytes: None }
        );
        assert_eq!(
            backend_from_video_controllers(" NVIDIA RTX A2000"),
            Backend::DiscreteGpu { vram_bytes: None }
        );
        assert_eq!(
            backend_from_video_controllers(" AMD Radeon Pro W2100"),
            Backend::DiscreteGpu { vram_bytes: None }
        );
        // The header row is skipped, and a header alone is no controller.
        assert_eq!(
            backend_from_video_controllers("AdapterRAM  Name\n NVIDIA T400\n"),
            Backend::DiscreteGpu { vram_bytes: None }
        );
        assert_eq!(backend_from_video_controllers("AdapterRAM  Name\n"), Backend::Cpu);
    }

    #[test]
    fn a_zero_adapter_ram_is_an_unknown_size_not_a_zero_byte_card() {
        assert_eq!(
            backend_from_video_controllers("0  NVIDIA GeForce RTX 4060"),
            Backend::DiscreteGpu { vram_bytes: None }
        );
        assert_eq!(
            backend_from_video_controllers(
                "0  NVIDIA GeForce RTX 4060\n3221225472  AMD Radeon RX 6600\n"
            ),
            Backend::DiscreteGpu {
                vram_bytes: Some(3221225472)
            }
        );
    }


    #[test]
    fn this_machine_reports_what_it_really_has() {
        let backend = backend();
        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        assert_eq!(backend, Backend::Metal);

        // Whatever it is, the caller can branch on it and it never claims a GPU
        // it did not detect.
        assert!(matches!(
            backend,
            Backend::Cpu | Backend::Metal | Backend::DiscreteGpu { .. } | Backend::Unknown
        ));
    }
}
