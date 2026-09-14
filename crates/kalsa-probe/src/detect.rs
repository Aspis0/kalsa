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

#[cfg(target_os = "windows")]
fn windows_backend() -> Backend {
    // wmic is present on Windows 10 and still on many 11 installs; where it is
    // gone we say Unknown rather than reaching for PowerShell (slow) or a crate.
    let output = std::process::Command::new("wmic")
        .args(["path", "win32_VideoController", "get", "name,AdapterRAM"])
        .output();
    match output {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            backend_from_video_controllers(&text)
        }
        _ => Backend::Unknown,
    }
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

/// Reads `wmic path win32_VideoController get name,AdapterRAM` output.
///
/// The name decides whether it is discrete; the memory is only reported when it
/// is not sitting on the 32-bit saturation point WMI is famous for.
#[cfg(any(target_os = "windows", test))]
pub fn backend_from_video_controllers(text: &str) -> Backend {
    let mut best: Option<u64> = None;
    let mut discrete = false;
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        // WMI prints the memory column first and the name second, but the order
        // is not worth trusting: the first number in the row is the memory, and
        // everything else is the name.
        let mut memory: Option<u64> = None;
        let mut name = String::new();
        for token in line.split_whitespace() {
            if memory.is_none() {
                if let Ok(bytes) = token.parse::<u64>() {
                    memory = Some(bytes);
                    continue;
                }
            }
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
            // A saturated 32-bit reading is "at least this much", not a size.
            if let Some(bytes) = memory.filter(|bytes| *bytes < WMI_SATURATION_BYTES) {
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
