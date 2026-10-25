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

/// Windows reports VRAM in a 32-bit field, and the cap it hands out is not
/// u32::MAX: the owner's Lenovo — an RTX 4050 Laptop GPU of 6141 MiB per
/// nvidia-smi (capture 2026-09-24) — answered `AdapterRAM` = 4293918720 =
/// 0xFFF00000, u32::MAX rounded down to whole MiB, and a parser with a
/// looser bound spent its whole budget 2 GiB short (docs/WHAT-IS-MISSING.md
/// §22 predicted this in words: "a reading just under the 32-bit limit,
/// such as 4293918720, is taken as a real size"). At or above this line the
/// field is saying "at least this much": never a size, an unknown one. On
/// Windows the size then comes from the driver's own registry values
/// (`vram_registry`) when they hold one of at least this cap; BELOW it
/// AdapterRAM itself
/// still stands — it is the fallback the parser has always used, not the
/// liar the cap makes it.
const WMI_SATURATION_BYTES: u64 = 0xFFF00000;

/// A trailing token is a row's memory only at a megabyte or more: model
/// numbers ("RX 6600", "UHD Graphics 630") are small and stay part of the
/// name; real `AdapterRAM` never is.
const TRAILING_MEMORY_FLOOR: u64 = 1024 * 1024;

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
        None => powershell().filter(|text| has_a_controller_line(text)),
    }
}

/// Whether the text holds at least one controller row: wmic prints its
/// column header whenever it prints rows, so an answer with a header and
/// nothing under it — or a zero-exit "No Instance(s) Available." with no
/// header at all — answered nothing, and the fallback must be asked.
/// Residual, declared: a header plus any second NON-EMPTY line counts as
/// a row, whatever that line says.
#[cfg(any(target_os = "windows", test))]
fn has_a_controller_row(text: &str) -> bool {
    let non_empty: Vec<&str> = text.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    let header = non_empty.iter().any(|l| l.to_ascii_lowercase().contains("adapterram"));
    header && non_empty.len() > 1
}

/// Whether the PowerShell answer holds at least one controller LINE. Its
/// shape has no header, so the wmic check above cannot judge it: a line is
/// a controller when a NAME follows the optional leading memory figure.
/// An answer with no controller line — empty, whitespace-only, a lone
/// number — is absent, not `Backend::Cpu`, and not cached; a number with
/// any second token after it ("3221225472 6600") is a controller line.
/// A prose
/// line cannot be told from a controller name here, so a successful
/// PowerShell run that prints prose on stdout is read as a controller,
/// parsed, and cached for the process — declared, not guarded, because
/// controller names are arbitrary text.
#[cfg(any(target_os = "windows", test))]
fn has_a_controller_line(text: &str) -> bool {
    text.lines().any(|line| {
        let mut tokens = line.trim().split_whitespace();
        match tokens.next() {
            // A memory figure is a controller only with a name after it.
            Some(first) if first.parse::<u64>().is_ok() => tokens.next().is_some(),
            Some(_) => true,
            None => false,
        }
    })
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
    static DETECTED: std::sync::OnceLock<Backend> = std::sync::OnceLock::new();
    once_present(&DETECTED, || {
        controllers_text(
            || command_text("wmic", &WMIC_CONTROLLERS, ANSWER_DEADLINE),
            || command_text("powershell", &POWERSHELL_CONTROLLERS, ANSWER_DEADLINE),
        )
        .map(|text| {
            // The registry walk is lazy: it runs at most once per
            // detection, and only when some discrete row's AdapterRAM has
            // no size to give — a machine whose every row stands alone
            // never opens the class key. The once-per-process caching
            // around this closure is unchanged.
            let mut sizes: Option<Vec<(String, u64)>> = None;
            backend_from_video_controllers_with(&text, |name| {
                let entries = sizes.get_or_insert_with(crate::vram_registry::registry_vram_sizes);
                crate::vram_registry::size_for(entries, name)
            })
        })
    })
    .unwrap_or(Backend::Unknown)
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

/// An AMD APU's graphics, which WMI names "Radeon" like a card: its memory is
/// the system's, and AdapterRAM reports a carve-out, not a budget. Integrated
/// is a trailing "Graphics" ("Radeon(TM) Graphics", "Radeon 780M Graphics",
/// "Radeon Vega 8 Graphics", "Radeon(TM) RX Vega 11 Graphics" — the Ryzen
/// 2400G), a three-digit-M model ("Radeon 890M"), or a Vega with an APU's
/// compute-unit count even when the name stops there ("Radeon RX Vega 11":
/// the APUs carry 3 to 11, the cards 56 and 64). A discrete card names an
/// RX, Pro or VII model and does not end in "Graphics" ("Radeon RX 6600M",
/// "Radeon RX Vega 64", "Radeon Pro W7800", "Radeon VII"); the four-digit M
/// of an RX 6800M is not the three-digit M of an APU. `lowered` is already
/// lowercase.
fn is_amd_integrated(lowered: &str) -> bool {
    if !lowered.contains("radeon") {
        return false;
    }
    let tokens: Vec<&str> = lowered.split_whitespace().collect();
    if tokens.last() == Some(&"graphics") {
        return true;
    }
    let pro = tokens.contains(&"pro");
    let apu_vega = tokens
        .windows(2)
        .any(|pair| pair[0] == "vega" && pair[1].parse::<u32>().is_ok_and(|units| units <= 12));
    if apu_vega && !pro {
        return true;
    }
    let card_model = pro || tokens.iter().any(|t| matches!(*t, "rx" | "vii"));
    let apu_model = tokens.iter().any(|t| {
        let digits = t.strip_suffix('m').unwrap_or("");
        digits.len() == 3 && digits.bytes().all(|b| b.is_ascii_digit())
    });
    apu_model && !card_model
}

/// Whether an adapter's already-lowercased name classifies as a discrete
/// GPU — the one row-level rule the budget scan is built on. Public so the
/// app's session facts can label a whole adapter list with the same rule
/// that decided the machine's backend.
pub fn adapter_is_discrete(lowered: &str) -> bool {
    (lowered.contains("nvidia")
        || lowered.contains("geforce")
        || lowered.contains("quadro")
        || lowered.contains("radeon")
        || lowered.contains("rx ")
        || lowered.contains("arc "))
        && !lowered.contains("intel")
        && !is_amd_integrated(lowered)
}

/// Reads the video controllers' text — wmic's or the PowerShell fallback's:
/// each row carries its memory at one end, and which end is read from the
/// text itself ([`row_leads_with_memory`]), never assumed.
///
/// One scan feeds both answers detection gives from this text: whether a
/// card is discrete and the size it budgets (wrapped below) and the name of
/// the row that size came from — the adapter the device step matches the
/// engine's own device list against. Only rows that classify discrete are
/// ever candidates for that name, and it is the row the budget took its
/// size from, so the two answers cannot name different cards. The memory is
/// reported only
/// when it is not a non-answer: zero, or sitting on the 32-bit saturation
/// line (`WMI_SATURATION_BYTES`). In that case — and only in that case —
/// `registry_size` is asked the controller's name and may answer with this
/// machine's driver-written `qwMemorySize`, when it is at least the cap; a
/// valid AdapterRAM stands alone and the registry is never consulted (the
/// owner's rule: a stale same-name entry under a replaced card must not
/// supply the size). Injected rather than called, so the whole decision is
/// testable on a machine with no such registry; the real answer is
/// `vram_registry`'s walk, behind `cfg(windows)`.
pub(crate) fn scan_video_controllers(
    text: &str,
    mut registry_size: impl FnMut(&str) -> Option<u64>,
) -> (bool, Option<u64>, Option<String>) {
    let memory_leads = row_leads_with_memory(text);
    let mut best: Option<u64> = None;
    let mut best_name: Option<String> = None;
    let mut discrete_names: Vec<String> = Vec::new();
    let mut big_unknown: Vec<String> = Vec::new();
    let mut discrete = false;
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        // The memory sits at the producer's own end of the row and is
        // consumed only when it parses as a size: a numberless row keeps
        // its whole name ("NVIDIA T400" stays discrete), and a number
        // inside a name ("RX 6600") is never a size — the trailing side
        // also demands TRAILING_MEMORY_FLOOR, model numbers being small.
        let tokens: Vec<&str> = line.split_whitespace().collect();
        let (memory, name_tokens) = split_row_memory(&tokens, memory_leads);
        let mut name = String::new();
        for token in name_tokens {
            name.push_str(token);
            name.push(' ');
        }
        let lowered = name.to_ascii_lowercase();
        if lowered.contains("name") && lowered.contains("adapterram") {
            continue; // the header row
        }
        let looks_discrete = adapter_is_discrete(&lowered);
        if looks_discrete {
            discrete = true;
            discrete_names.push(name.trim().to_string());
            // The size, by the owner's rule: a valid AdapterRAM — non-zero,
            // below the saturation line — stands on its own and the registry
            // is not consulted, because a stale same-name entry under a
            // replaced card must not supply the size. The registry is asked
            // only when AdapterRAM has no size to give — zero, absent, or
            // saturated — and only a figure of at least the cap counts: a
            // saturated field means "at least the cap", so a smaller
            // registry number cannot be this card's size.
            // Accepted limit: with AdapterRAM zero or absent — not only
            // saturated — a lone stale same-name registry entry at or above
            // the cap can still supply the size when the live entry wrote no
            // qwMemorySize; rare, and it can only name a card of at least
            // the cap that WMI reported as zero or absent.
            // The mirror of that limit, also accepted: the cap floor binds
            // the zero and absent cases too, so a genuine sub-cap card whose
            // AdapterRAM read 0 or absent while its registry holds the true
            // size answers unknown — the safe direction, never inventing a
            // small card from the registry.
            let adapter = memory.filter(|bytes| *bytes != 0 && *bytes < WMI_SATURATION_BYTES);
            let resolved = match adapter {
                Some(bytes) => Some(bytes),
                None => registry_size(name.trim())
                    .filter(|bytes| *bytes >= WMI_SATURATION_BYTES),
            };
            if let Some(bytes) = resolved {
                if best.map_or(true, |current| bytes > current) {
                    best = Some(bytes);
                    best_name = Some(name.trim().to_string());
                }
            } else if memory.is_some_and(|bytes| bytes >= WMI_SATURATION_BYTES) {
                // Big, unknown: the field spoke ("at least this much") and
                // the registry did not — the row keeps its claim on the
                // name instead of losing it to an unread size.
                big_unknown.push(name.trim().to_string());
            }
        }
    }
    // The name from discrete rows only, and the same row the budget took
    // its size from: the biggest resolved size wins (ties keep the first);
    // with no resolved size the lone discrete row is its own answer, and
    // among several the one that said "big, unknown" — a saturated field is
    // a statement, a zero or an absent one is not. Several of those leave
    // the text unable to say which card is meant — no name, never a guess.
    let budget_name = best_name.or_else(|| match discrete_names.len() {
        1 => discrete_names.into_iter().next(),
        _ if big_unknown.len() == 1 => big_unknown.into_iter().next(),
        _ => None,
    });
    (discrete, best, budget_name)
}

/// Which end of a row carries the memory. The PowerShell fallback leads with
/// it and prints no header; wmic prints its fields in the order the query
/// asked — `get name,AdapterRAM` comes back NAME FIRST — and its header
/// ("Name AdapterRAM" / "AdapterRAM Name") declares the order for its rows.
/// Headerless text settles on a leading number, which is PowerShell's shape;
/// no wmic capture exists in the repo to trust (docs/WHAT-IS-MISSING.md §22),
/// so the text itself decides, never this file.
fn row_leads_with_memory(text: &str) -> bool {
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let lowered = line.to_ascii_lowercase();
        if lowered.contains("name") && lowered.contains("adapterram") {
            return !lowered.starts_with("name"); // the header declares it
        }
        if line
            .split_whitespace()
            .next()
            .is_some_and(|token| token.parse::<u64>().is_ok())
        {
            return true; // a number leads: PowerShell's row
        }
    }
    false // no header and no leading number anywhere: wmic's rows without it
}

/// One row split into its memory — at the end the producer puts it, if it
/// put one there — and the name's tokens. The trailing side demands
/// [`TRAILING_MEMORY_FLOOR`]: a name-first row with a blank AdapterRAM
/// leaves its name alone, and names end in small numbers.
fn split_row_memory<'a>(tokens: &'a [&'a str], memory_leads: bool) -> (Option<u64>, &'a [&'a str]) {
    if memory_leads {
        return match tokens.first().and_then(|token| token.parse::<u64>().ok()) {
            Some(bytes) => (Some(bytes), &tokens[1..]),
            None => (None, tokens),
        };
    }
    match tokens.split_last() {
        Some((last, name)) if !name.is_empty() => match last.parse::<u64>() {
            Ok(bytes) if bytes >= TRAILING_MEMORY_FLOOR => (Some(bytes), name),
            _ => (None, tokens),
        },
        _ => (None, tokens),
    }
}

/// What the scan says about this machine's memory path: the card's size when
/// a row resolved one, `None` when the honest answer is unknown — and no
/// card at all when no row is discrete.
#[cfg(any(target_os = "windows", test))]
pub fn backend_from_video_controllers_with(
    text: &str,
    registry_size: impl FnMut(&str) -> Option<u64>,
) -> Backend {
    let (discrete, vram_bytes, _) = scan_video_controllers(text, registry_size);
    if discrete {
        Backend::DiscreteGpu { vram_bytes }
    } else {
        Backend::Cpu
    }
}

/// The name of the discrete adapter the budget came from, from supplied
/// text — the pure half of [`discrete_name`], registry injected. Public on
/// every platform so the device step's tests can run the whole chain (WMI
/// text → name → `--device`) wherever they run.
pub fn discrete_name_from_video_controllers_with(
    text: &str,
    registry_size: impl FnMut(&str) -> Option<u64>,
) -> Option<String> {
    scan_video_controllers(text, registry_size).2
}

/// The WMI name of the discrete adapter the budget came from, asked of the
/// same controller query once per session (a present answer only, like
/// [`backend`]): the engine's `--list-devices` description is matched
/// against it, and a card this query cannot name routes the start to the
/// CPU build — the single-device rule belongs to the integrated GPU alone.
#[cfg(target_os = "windows")]
pub fn discrete_name() -> Option<String> {
    static NAMED: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    once_present(&NAMED, || {
        let text = controllers_text(
            || command_text("wmic", &WMIC_CONTROLLERS, ANSWER_DEADLINE),
            || command_text("powershell", &POWERSHELL_CONTROLLERS, ANSWER_DEADLINE),
        )?;
        // Same lazy registry walk the budget took: which row resolved is
        // the same question with the same answer.
        let mut sizes: Option<Vec<(String, u64)>> = None;
        discrete_name_from_video_controllers_with(&text, |name| {
            let entries = sizes.get_or_insert_with(crate::vram_registry::registry_vram_sizes);
            crate::vram_registry::size_for(entries, name)
        })
    })
}

/// Only Windows rows name a discrete adapter, and only Windows gets a
/// graphics engine row this name could pick a device for.
#[cfg(not(target_os = "windows"))]
pub fn discrete_name() -> Option<String> {
    None
}

/// The same parse with no registry in play: every test that pins the parse
/// itself comes through this door, and the saturated reading it must never
/// accept stays visible here — the registry's own answers belong to
/// `backend_from_video_controllers_with`.
#[cfg(test)]
pub fn backend_from_video_controllers(text: &str) -> Backend {
    backend_from_video_controllers_with(text, |_| None)
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
        // What WMI can actually print below the cap: a 32-bit byte count.
        let text = "AdapterRAM  Name\n3221225472  NVIDIA GeForce GTX 1650\n";
        assert_eq!(
            backend_from_video_controllers(text),
            Backend::DiscreteGpu {
                vram_bytes: Some(3221225472)
            }
        );
        let amd = "AdapterRAM  Name\n4000000000  AMD Radeon RX 6600\n";
        assert_eq!(
            backend_from_video_controllers(amd),
            Backend::DiscreteGpu {
                vram_bytes: Some(4000000000)
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
        // THE CAP, not u32::MAX: the Lenovo's RTX 4050 Laptop GPU — 6141 MiB
        // per nvidia-smi, 6439305216 bytes in the driver's qwMemorySize —
        // answered exactly 4293918720 (0xFFF00000) through AdapterRAM, and
        // the old bound took it as a size: a ~2 GiB budget on a 6 GiB card.
        // The number must stay a non-answer (docs/WHAT-IS-MISSING.md §22
        // predicted this in words); only the registry may turn it into a
        // size, in `the_registry_size_wins…` below.
        let lenovo = "AdapterRAM  Name\n4293918720  NVIDIA GeForce RTX 4050 Laptop GPU\n";
        assert_eq!(
            backend_from_video_controllers(lenovo),
            Backend::DiscreteGpu { vram_bytes: None },
            "0xFFF00000 is the cap saying 'at least this much', not the card"
        );
    }

    #[test]
    fn the_registry_size_wins_and_its_absence_leaves_the_cap_unread() {
        // The Lenovo capture's two rows as the PowerShell fallback printed
        // them: the Arc — Intel, never discrete, its own 32-bit-short
        // 2147479552 — and the RTX 4050 whose AdapterRAM saturated.
        let lenovo = "2147479552  Intel(R) Arc(TM) Graphics\n4293918720  NVIDIA GeForce RTX 4050 Laptop GPU\n";
        let entries = vec![("NVIDIA GeForce RTX 4050 Laptop GPU".to_string(), 6439305216)];
        assert_eq!(
            backend_from_video_controllers_with(lenovo, |name| {
                crate::vram_registry::size_for(&entries, name)
            }),
            Backend::DiscreteGpu {
                vram_bytes: Some(6439305216)
            },
            "the driver's own figure: 6141 MiB, where WMI said 4293918720"
        );
        // The same machine with the registry read gone (empty walk, denied
        // key, no match): the cap must NOT come back as a size — unknown is
        // the only honest answer left.
        assert_eq!(
            backend_from_video_controllers_with(lenovo, |_| None),
            Backend::DiscreteGpu { vram_bytes: None },
            "with no registry answer the saturated AdapterRAM stays unread"
        );
    }

    /// The owner's rule, in five cases: a valid AdapterRAM is never
    /// second-guessed by the registry; a saturated, zero, or absent one is
    /// answered by a registry figure big enough to be a card's; a registry
    /// figure under the cap answers nothing at all; and a figure of exactly
    /// the cap is accepted, because saturation means "at least the cap".
    #[test]
    fn the_registry_is_asked_only_when_adapter_ram_has_no_size_to_give() {
        let valid = "AdapterRAM  Name\n3221225472  NVIDIA GeForce GTX 1650\n";
        assert_eq!(
            backend_from_video_controllers_with(valid, |_| Some(6_439_305_216)),
            Backend::DiscreteGpu {
                vram_bytes: Some(3221225472)
            },
            "a valid AdapterRAM stands; the registry is not consulted"
        );

        let saturated = "AdapterRAM  Name\n4293918720  NVIDIA GeForce RTX 4050 Laptop GPU\n";
        assert_eq!(
            backend_from_video_controllers_with(saturated, |_| Some(6_439_305_216)),
            Backend::DiscreteGpu {
                vram_bytes: Some(6_439_305_216)
            },
            "saturated means at least the cap — the registry may answer"
        );
        assert_eq!(
            backend_from_video_controllers_with(saturated, |_| Some(2 * 1024 * 1024 * 1024)),
            Backend::DiscreteGpu { vram_bytes: None },
            "a registry figure under the cap cannot be this card's size"
        );

        // Zero and absent AdapterRAM ask the registry just as saturation
        // does: WMI gave no size, so the driver's own figure is the only
        // one left.
        let zero = "AdapterRAM  Name\n0  NVIDIA GeForce RTX 4060\n";
        assert_eq!(
            backend_from_video_controllers_with(zero, |_| Some(6_439_305_216)),
            Backend::DiscreteGpu {
                vram_bytes: Some(6_439_305_216)
            },
            "a zero AdapterRAM lets the registry answer"
        );
        let absent = " NVIDIA GeForce RTX 4090\n";
        assert_eq!(
            backend_from_video_controllers_with(absent, |_| Some(6_439_305_216)),
            Backend::DiscreteGpu {
                vram_bytes: Some(6_439_305_216)
            },
            "an absent AdapterRAM lets the registry answer"
        );
        assert_eq!(
            backend_from_video_controllers_with(zero, |_| Some(2 * 1024 * 1024 * 1024)),
            Backend::DiscreteGpu { vram_bytes: None },
            "under the cap answers nothing for a zero AdapterRAM either"
        );

        // The boundary: a registry figure of exactly the cap is accepted —
        // saturation means "at least the cap", not "more than it". This is
        // the case a floor of 4 GiB would wrongly reject.
        assert_eq!(
            backend_from_video_controllers_with(saturated, |_| Some(WMI_SATURATION_BYTES)),
            Backend::DiscreteGpu {
                vram_bytes: Some(WMI_SATURATION_BYTES)
            },
            "exactly 0xFFF00000 from the registry is at least the cap"
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
    fn an_empty_blank_or_number_only_powershell_answer_is_absent() {
        // The fallback's own door into the failure-caching bug: a
        // successful PowerShell run with nothing in it would parse to
        // `Backend::Cpu` and be cached for the process. Nothing said is
        // absent — Unknown for this ask, asked again next time.
        let wmic_gone = || None;
        for said_nothing in ["", "   \n\t \n", "3221225472\n"] {
            assert_eq!(
                controllers_text(wmic_gone, || Some(said_nothing.to_string())),
                None,
                "{said_nothing:?} counted as a controller answer"
            );
        }
        assert_eq!(
            controllers_text(wmic_gone, || Some(" NVIDIA T400".to_string())).as_deref(),
            Some(" NVIDIA T400"),
            "a name-only line is a controller"
        );
        assert_eq!(
            controllers_text(wmic_gone, || {
                Some("3221225472  NVIDIA GeForce RTX 4060".to_string())
            })
            .as_deref(),
            Some("3221225472  NVIDIA GeForce RTX 4060"),
            "a memory figure with a name after it is a controller"
        );
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
    fn an_amd_apus_graphics_are_integrated_and_a_radeon_card_is_not() {
        for name in [
            "AMD Radeon(TM) Graphics",
            "AMD Radeon Graphics",
            "AMD Radeon 780M Graphics",
            "AMD Radeon 890M",
            "AMD Radeon 610M",
            "Radeon Vega 8 Graphics",
            "AMD Radeon(TM) Vega 8 Graphics",
            "AMD Radeon(TM) RX Vega 11 Graphics",
            "AMD Radeon RX Vega 11",
            "Radeon RX Vega 10",
            "AMD Radeon(TM) R7 Graphics",
        ] {
            // With the carve-out WMI reports, and without.
            for row in [format!("536870912  {name}"), format!(" {name}")] {
                assert_eq!(backend_from_video_controllers(&row), Backend::Cpu, "{row}");
            }
        }
        for name in [
            "AMD Radeon RX 6600",
            "AMD Radeon RX 6800M",
            "AMD Radeon RX 7600M XT",
            "AMD Radeon RX Vega 56",
            "AMD Radeon RX Vega 64",
            "AMD Radeon Pro Vega 20",
            "AMD Radeon Pro W7800",
            "AMD Radeon Pro WX 3200 Series",
            "AMD Radeon VII",
        ] {
            assert_eq!(
                backend_from_video_controllers(&format!(" {name}")),
                Backend::DiscreteGpu { vram_bytes: None },
                "{name}"
            );
        }
        // An APU beside a real card: the card is the one budgeted.
        assert_eq!(
            backend_from_video_controllers(
                "536870912  AMD Radeon(TM) Graphics\n3221225472  NVIDIA GeForce RTX 4060\n"
            ),
            Backend::DiscreteGpu {
                vram_bytes: Some(3221225472)
            }
        );
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
    fn the_budget_row_names_the_discrete_adapter_for_the_device_step() {
        // The Lenovo capture as PowerShell prints it: the Arc is Intel —
        // never discrete — so the RTX row is both the budget and the name
        // the engine's Vulkan description must match.
        let lenovo = "2147479552  Intel(R) Arc(TM) Graphics\n4293918720  NVIDIA GeForce RTX 4050 Laptop GPU\n";
        assert_eq!(
            discrete_name_from_video_controllers_with(lenovo, |_| None).as_deref(),
            Some("NVIDIA GeForce RTX 4050 Laptop GPU")
        );
        // A numberless row keeps whole its name, header or not.
        assert_eq!(
            discrete_name_from_video_controllers_with(" NVIDIA T400", |_| None).as_deref(),
            Some("NVIDIA T400")
        );
        // No discrete row, no name — and several rows with no readable size
        // cannot say which card the budget would have come from.
        assert_eq!(
            discrete_name_from_video_controllers_with(
                "AdapterRAM  Name\n1073741824  Intel(R) UHD Graphics 630\n",
                |_| None
            ),
            None
        );
        let twin = "4293918720  NVIDIA GeForce RTX 4090\n4293918720  NVIDIA GeForce RTX 3060\n";
        assert_eq!(discrete_name_from_video_controllers_with(twin, |_| None), None);
        // Two cards, one readable size each: the budget's own row wins.
        let sized = "3221225472  NVIDIA GeForce GTX 1650\n4000000000  AMD Radeon RX 6600\n";
        assert_eq!(
            discrete_name_from_video_controllers_with(sized, |_| None).as_deref(),
            Some("AMD Radeon RX 6600")
        );
    }

    /// The producer's field order, read from its own text: PowerShell
    /// leads with the memory and prints no header; wmic's header declares
    /// the order its rows follow (`get name,AdapterRAM` comes back name
    /// first), and a headerless row settles for itself.
    #[test]
    fn the_rows_field_order_comes_from_the_text_not_an_assumption() {
        assert!(row_leads_with_memory("2147479552  Intel(R) Arc(TM) Graphics\n"));
        assert!(row_leads_with_memory("AdapterRAM  Name\r\n3221225472  NVIDIA GeForce GTX 1650\r\n"));
        // A PowerShell answer whose first controller reports no AdapterRAM:
        // the later leading number still settles the order.
        assert!(row_leads_with_memory(
            "  Intel(R) UHD Graphics 770\n3221225472  NVIDIA GeForce RTX 4060\n"
        ));
        assert!(!row_leads_with_memory(""));
        assert!(!row_leads_with_memory(
            "Name  AdapterRAM\r\nNVIDIA GeForce RTX 4050 Laptop GPU  4293918720\r\n"
        ));
        assert!(!row_leads_with_memory(
            "NVIDIA GeForce RTX 4050 Laptop GPU  4293918720\r\n"
        ));
    }

    /// wmic's name-first rows, the owner's machine: the trailing number is
    /// the memory, so the name stays whole — the registry matches
    /// `DriverDesc` exactly, where a name with the AdapterRAM glued on
    /// would size the card wrong and hand the matcher a name the engine's
    /// `--list-devices` can never print.
    #[test]
    fn wmic_name_first_rows_keep_the_name_whole_and_the_size_registry_readable() {
        let text = "Name  AdapterRAM\r\nIntel(R) Arc(TM) Graphics  2147479552\r\nNVIDIA GeForce RTX 4050 Laptop GPU  4293918720\r\n";
        let registry = |name: &str| {
            (name == "NVIDIA GeForce RTX 4050 Laptop GPU").then_some(6_439_305_216u64)
        };
        assert_eq!(
            backend_from_video_controllers_with(text, registry),
            Backend::DiscreteGpu {
                vram_bytes: Some(6_439_305_216)
            },
            "the clean name reaches the registry, so the budget is the card's real size"
        );
        assert_eq!(
            discrete_name_from_video_controllers_with(text, registry).as_deref(),
            Some("NVIDIA GeForce RTX 4050 Laptop GPU")
        );
        // Rows the other way round, and the registry denied: the saturated
        // dGPU is the only discrete row and its name survives the unread
        // size.
        let reversed = "Name  AdapterRAM\r\nNVIDIA GeForce RTX 4050 Laptop GPU  4293918720\r\nIntel(R) Arc(TM) Graphics  2147479552\r\n";
        assert_eq!(
            discrete_name_from_video_controllers_with(reversed, |_| None).as_deref(),
            Some("NVIDIA GeForce RTX 4050 Laptop GPU")
        );
    }

    /// A saturated dGPU beside a readable APU: the name is the dGPU's. The
    /// APU's row never enters the contest (the classifier says integrated,
    /// with its AdapterRAM readable or not), and a saturated card keeps its
    /// claim on the name instead of losing it to an unread size — in both
    /// row orders, with the registry answering or denied.
    #[test]
    fn a_saturated_dgpu_keeps_its_name_against_a_readable_apu() {
        let apu_first = "2147479552  AMD Radeon 780M\n4293918720  NVIDIA GeForce RTX 4050 Laptop GPU\n";
        let dgpu_first = "4293918720  NVIDIA GeForce RTX 4050 Laptop GPU\n2147479552  AMD Radeon 780M\n";
        let registry = |name: &str| {
            (name == "NVIDIA GeForce RTX 4050 Laptop GPU").then_some(6_439_305_216u64)
        };
        for text in [apu_first, dgpu_first] {
            assert_eq!(
                discrete_name_from_video_controllers_with(text, |_| None).as_deref(),
                Some("NVIDIA GeForce RTX 4050 Laptop GPU"),
                "registry denied: {text:?}"
            );
            assert_eq!(
                discrete_name_from_video_controllers_with(text, registry).as_deref(),
                Some("NVIDIA GeForce RTX 4050 Laptop GPU"),
                "registry answering: {text:?}"
            );
            assert_eq!(
                backend_from_video_controllers_with(text, |_| None),
                Backend::DiscreteGpu { vram_bytes: None },
                "the APU is not a card and the saturated dGPU has no size to give: {text:?}"
            );
        }
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
