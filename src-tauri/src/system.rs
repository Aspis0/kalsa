//! The session's technical facts, written to the log once per session as
//! soon as each value is known: what this computer is, and what engine and
//! model the walk settled on. The owner's rule, in big letters on the
//! report screen: the log never contains chats, prompts, answers, files or
//! pairing codes — so this block is versions, counts, names of chips and
//! drivers, and nothing else. Serial numbers, the host's name, the user's
//! name, MAC and IP addresses and disk serials are NEVER written, and the
//! builder strips the host name defensively in case one arrives inside a
//! value (an adapter named after the machine, say).

/// One graphics adapter as the facts carry it.
pub(crate) struct Adapter {
    pub(crate) name: String,
    /// The driver's own version string, when the platform publishes one.
    pub(crate) driver: Option<String>,
    /// The VRAM the OS reports, when it reports one. `None` is common:
    /// WMI's AdapterRAM is a 32-bit field that saturates on big cards.
    pub(crate) vram_bytes: Option<u64>,
}

/// The machine's half of the block, gathered at start.
pub(crate) struct Machine {
    pub(crate) os: String,
    pub(crate) arch: &'static str,
    pub(crate) cpu: Option<String>,
    pub(crate) physical_cores: Option<usize>,
    pub(crate) logical_cores: Option<usize>,
    pub(crate) ram_total_bytes: u64,
    pub(crate) ram_available_bytes: Option<u64>,
    /// The probe's measured memory bandwidth, when a measurement exists.
    pub(crate) bandwidth_bytes_per_second: Option<f64>,
    /// Every adapter the machine's own inventory names.
    pub(crate) adapters: Vec<Adapter>,
    /// What the probe concluded the model will run on, in its own words.
    pub(crate) runs_on: String,
}

/// The engine's half, written when the walk has settled a launch.
pub(crate) struct Engine {
    /// The pinned release every shipped archive belongs to (`v1.1.5`).
    pub(crate) release: &'static str,
    /// Which build this launch runs: `metal`, `vulkan` or `cpu`.
    pub(crate) build: &'static str,
    /// The engine's own `--list-devices` answer, as the app parsed it:
    /// device name and its description.
    pub(crate) listed_devices: Vec<(String, String)>,
    /// The `--device` this launch pinned, when it pinned one.
    pub(crate) device: Option<String>,
    /// The catalog's own name for the model (`None` on the dev path).
    pub(crate) model: Option<String>,
    /// The model row's token — repo, name, quant, bytes.
    pub(crate) row: Option<String>,
    pub(crate) context_tokens: u64,
    pub(crate) drafter: bool,
}

fn gib(bytes: u64) -> String {
    format!("{:.1} GiB", bytes as f64 / (1024.0 * 1024.0 * 1024.0))
}

/// One value with the host's own name taken out of it: a machine's name is
/// an identifier, and the block's rule is that no identifier of the
/// household reaches the log. The name matches only as a WHOLE word —
/// bounded by non-alphanumerics or the ends — and case-insensitively: a
/// machine may be named in any case its owner's platform fancied, and a
/// stripped word costs a line of colour commentary while a leaked hostname
/// costs the household's identifier. (A host that happens to equal a CPU
/// word, "max" say, loses that word from the block — the privacy is worth
/// more than the adjective.) Compared by character, because a byte offset
/// into the original would not survive a case mapping that changes
/// length.
fn without_host(value: &str, host: &str) -> String {
    let host: Vec<char> = host.chars().collect();
    if host.len() < 3 {
        return value.to_string();
    }
    let value: Vec<char> = value.chars().collect();
    let boundary = |c: char| !c.is_alphanumeric();
    let mut out = String::with_capacity(value.len());
    let mut at = 0;
    while at < value.len() {
        let before_ok = at == 0 || boundary(value[at - 1]);
        let matches = before_ok
            && (0..host.len()).all(|offset| {
                value
                    .get(at + offset)
                    .is_some_and(|c| c.eq_ignore_ascii_case(&host[offset]))
            })
            && value
                .get(at + host.len())
                .is_none_or(|next| boundary(*next));
        if matches {
            out.push_str("<host>");
            at += host.len();
        } else {
            out.push(value[at]);
            at += 1;
        }
    }
    out
}

/// One gathered string as the block will print it: the printable ASCII a
/// log line can carry, at most `max` characters, and through the same
/// user-name and host-name redaction every other line already gets. The
/// Windows inventory can hand back vendor strings with control characters
/// and local spelling; the log takes none of that.
fn clean_gathered(text: &str, max: usize, host: &str) -> String {
    let ascii: String = text
        .chars()
        .filter(|c| c.is_ascii_graphic() || c.is_ascii_whitespace())
        .collect();
    let clipped: String = ascii.chars().take(max).collect();
    crate::logging::redact_str(&without_host(&clipped, host))
}

/// The machine's half as log lines. Every value goes through
/// [`without_host`], so a fixture that smuggles the host's name into an
/// adapter name still writes `<host>`.
pub(crate) fn machine_lines(machine: &Machine, host: &str) -> Vec<String> {
    let mut lines = Vec::new();
    lines.push(format!(
        "os: {} · {}",
        without_host(&machine.os, host),
        machine.arch
    ));
    if let Some(cpu) = &machine.cpu {
        let said = format!(
            "cpu: {} · {} physical / {} logical cores",
            cpu,
            machine.physical_cores.map_or("?".to_string(), |n| n.to_string()),
            machine
                .logical_cores
                .map_or("?".to_string(), |n| n.to_string()),
        );
        lines.push(without_host(&said, host));
    }
    lines.push(format!(
        "ram: {} total · {} available",
        gib(machine.ram_total_bytes),
        machine
            .ram_available_bytes
            .map_or_else(|| "?".to_string(), gib),
    ));
    if let Some(rate) = machine.bandwidth_bytes_per_second {
        lines.push(format!(
            "memory bandwidth: {:.1} GiB/s (measured)",
            rate / (1024.0 * 1024.0 * 1024.0)
        ));
    }
    lines.push(without_host(
        &format!("runs on: {}", machine.runs_on),
        host,
    ));
    for adapter in &machine.adapters {
        let kind = if kalsa_probe::adapter_is_discrete(&adapter.name.to_lowercase()) {
            "discrete"
        } else {
            "integrated"
        };
        // Adapter strings are vendor output, redacted like any other line:
        // printable ASCII, 80 characters, no user name, no host name.
        lines.push(format!(
            "adapter: {} ({kind}, driver {}, {})",
            clean_gathered(&adapter.name, 80, host),
            clean_gathered(adapter.driver.as_deref().unwrap_or("unknown"), 80, host),
            adapter
                .vram_bytes
                .map_or_else(|| "VRAM not reported".to_string(), gib),
        ));
    }
    lines
}

/// The engine's half as log lines.
pub(crate) fn engine_lines(engine: &Engine, host: &str) -> Vec<String> {
    let mut lines = Vec::new();
    lines.push(format!(
        "engine: kalsa-server {} · {} build",
        engine.release, engine.build
    ));
    for (name, description) in &engine.listed_devices {
        lines.push(without_host(
            &format!("engine device: {name} = {description}"),
            host,
        ));
    }
    if let Some(device) = &engine.device {
        lines.push(format!(
            "device pin: {device} (target and drafter)"
        ));
    }
    if let Some(row) = &engine.row {
        let said = format!(
            "model row: {} · {} · context {} tokens · drafter {}",
            row,
            engine.model.as_deref().unwrap_or("no catalog name"),
            engine.context_tokens,
            if engine.drafter { "on" } else { "off" },
        );
        lines.push(without_host(&said, host));
    }
    lines
}

/// Writes the machine's half, once per session: the second call (a second
/// turn-on) writes nothing.
pub(crate) fn log_machine(machine: &Machine, host: &str) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        for line in machine_lines(machine, host) {
            log::info!("{line}");
        }
    });
}

/// Writes the engine's half, once per session, the same rule.
pub(crate) fn log_engine(engine: &Engine, host: &str) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        for line in engine_lines(engine, host) {
            log::info!("{line}");
        }
    });
}

/// The machine's own name for itself, for the defensive strip: the kernel's
/// nodename on Unix, `COMPUTERNAME` on Windows. Never logged as a fact.
pub(crate) fn host_name() -> String {
    #[cfg(target_os = "windows")]
    {
        std::env::var("COMPUTERNAME").unwrap_or_default()
    }
    #[cfg(not(target_os = "windows"))]
    {
        // SAFETY: `uname` writes into the caller's zeroed array and returns
        // its own success code; on failure the empty name strips nothing.
        unsafe {
            let mut name: libc::utsname = std::mem::zeroed();
            if libc::uname(&mut name) == 0 {
                return std::ffi::CStr::from_ptr(name.nodename.as_ptr())
                    .to_string_lossy()
                    .into_owned();
            }
        }
        String::new()
    }
}

/// The RAM nobody has claimed right now. Best effort: a platform that
/// refuses to say leaves the line at `?`, never blocks the start.
pub(crate) fn available_ram_bytes() -> Option<u64> {
    #[cfg(target_os = "macos")]
    {
        // SAFETY: `host_statistics64` fills the caller's struct of the size
        // it is told and returns its own success code; the page size is the
        // kernel's own published constant.
        unsafe {
            let mut vm_stats: libc::vm_statistics64 = std::mem::zeroed();
            let mut count: libc::mach_msg_type_number_t =
                std::mem::size_of::<libc::vm_statistics64>() as u32
                    / (std::mem::size_of::<libc::integer_t>() as u32);
            // `mach_host_self` is deprecated in favour of the `mach2`
            // crate; this repo stays on `libc` for one call, on purpose.
            #[allow(deprecated)]
            let host = libc::mach_host_self();
            if libc::host_statistics64(
                host,
                libc::HOST_VM_INFO64,
                &mut vm_stats as *mut libc::vm_statistics64 as *mut libc::integer_t,
                &mut count,
            ) == libc::KERN_SUCCESS
            {
                // Free plus inactive: both can be taken without swapping
                // anything back in first.
                let page = libc::vm_page_size as u64;
                return Some(
                    (u64::from(vm_stats.free_count) + u64::from(vm_stats.inactive_count)) * page,
                );
            }
        }
        None
    }
    #[cfg(target_os = "windows")]
    {
        // SAFETY: `GlobalMemoryStatusEx` fills the caller's struct of the
        // size it is told and returns its own success code.
        unsafe {
            let mut status: windows_sys::Win32::System::SystemInformation::MEMORYSTATUSEX =
                std::mem::zeroed();
            status.dwLength =
                std::mem::size_of::<windows_sys::Win32::System::SystemInformation::MEMORYSTATUSEX>()
                    as u32;
            if windows_sys::Win32::System::SystemInformation::GlobalMemoryStatusEx(&mut status)
                != 0
            {
                return Some(status.ullAvailPhys);
            }
        }
        None
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let text = std::fs::read_to_string("/proc/meminfo").ok()?;
        let available = text
            .lines()
            .find(|line| line.starts_with("MemAvailable:"))?;
        available
            .split_whitespace()
            .nth(1)
            .and_then(|kb| kb.parse::<u64>().ok())
            .map(|kb| kb * 1024)
    }
}

/// The OS as the block names it: the product version and build a person
/// means (`macOS 15.6 build 24G84`, `windows 11 25H2 (build 26200.4652)`),
/// falling back to what the platform still knows when the product query
/// will not answer. Never the host's name.
pub(crate) fn os_description() -> String {
    // Asked once per process: the session header and this block print the
    // same line, and the platform query is a process spawn on macOS.
    static OS: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    OS.get_or_init(os_description_uncached).clone()
}

fn os_description_uncached() -> String {
    #[cfg(target_os = "macos")]
    {
        const ASK: [&str; 1] = ["-productVersion"];
        const BUILD: [&str; 1] = ["-buildVersion"];
        let deadline = std::time::Duration::from_secs(5);
        let product = kalsa_probe::command_text("sw_vers", ASK, deadline);
        let build = kalsa_probe::command_text("sw_vers", BUILD, deadline);
        match (product, build) {
            (Some(product), Some(build)) => format!(
                "macos {} (build {})",
                product.trim(),
                build.trim()
            ),
            _ => crate::logging::os_version(),
        }
    }
    #[cfg(target_os = "windows")]
    {
        // GetVersionExW is lied to in an unmanifested process — 6.2.9200,
        // Windows 8's number, whatever runs — so the version the machine
        // runs comes from the registry's own CurrentVersion keys.
        let major = reg_dword("CurrentMajorVersionNumber");
        let build = reg_sz("CurrentBuildNumber").and_then(|text| text.trim().parse().ok());
        match (major, build) {
            (Some(major), Some(build)) => windows_version_line(
                major,
                reg_dword("CurrentMinorVersionNumber").unwrap_or(0),
                build,
                reg_sz("DisplayVersion").as_deref(),
                reg_dword("UBR"),
            ),
            _ => std::env::consts::OS.to_string(),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        crate::logging::os_version()
    }
}

/// The line a Windows version prints: `windows 11 25H2 (build 26200.4652)`.
/// Build 22000 is where Windows 11 starts, and the major number never says
/// so — it stays 10 — so the name follows the build. The marketing version
/// and the revision print only when the machine reports them.
#[cfg(any(target_os = "windows", test))]
fn windows_version_line(
    major: u32,
    minor: u32,
    build: u32,
    display: Option<&str>,
    revision: Option<u32>,
) -> String {
    let name = if build >= 22000 {
        "11".to_string()
    } else {
        format!("{major}.{minor}")
    };
    let display = display
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map_or_else(String::new, |value| format!(" {value}"));
    let revision = revision.map_or_else(String::new, |value| format!(".{value}"));
    format!("windows {name}{display} (build {build}{revision})")
}

/// One REG_DWORD under HKLM's `Windows NT\CurrentVersion`, read through the
/// handle's own key (a null subkey). `None` when the value is absent or is
/// not a DWORD — a machine that cannot say gets no invented number.
#[cfg(target_os = "windows")]
fn reg_dword(value: &str) -> Option<u32> {
    use windows_sys::Win32::System::Registry::{
        RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD,
    };
    let name = wide(value);
    let mut data: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: `data` holds exactly the DWORD `size` declares, and `name` is
    // the terminated buffer the API takes.
    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            std::ptr::null(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            (&mut data as *mut u32).cast(),
            &mut size,
        )
    };
    (status == 0).then_some(data)
}

/// One REG_SZ under the same key. The count the API returns is in bytes and
/// includes the terminator, so the string ends at the first NUL word.
#[cfg(target_os = "windows")]
fn reg_sz(value: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    let name = wide(value);
    let mut size: u32 = 0;
    // SAFETY: sizing call — no data buffer, only the count it writes.
    let sized = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            std::ptr::null(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if sized != 0 || size < 2 {
        return None;
    }
    let mut words = vec![0u16; (size as usize).div_ceil(2)];
    // SAFETY: `words` holds at least the byte count the sizing call fixed.
    let read = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            std::ptr::null(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            words.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if read != 0 {
        return None;
    }
    let end = words
        .iter()
        .position(|&word| word == 0)
        .unwrap_or(words.len());
    String::from_utf16(&words[..end]).ok()
}

/// What Win32 string arguments are: UTF-16, NUL-terminated.
#[cfg(target_os = "windows")]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Every adapter the platform's own inventory names, with the driver
/// version the same inventory carries. Best effort: an inventory that
/// cannot be asked answers empty, and the block says less, never lies.
pub(crate) fn adapters() -> Vec<Adapter> {
    #[cfg(target_os = "windows")]
    {
        // One PowerShell row per adapter: `name|driver|vram_bytes`, the two
        // fields the verdict's own queries ask for, joined in one ask.
        const QUERY: [&str; 4] = [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-CimInstance Win32_VideoController | ForEach-Object { \"$($_.Name)|$($_.DriverVersion)|$($_.AdapterRAM)\" }",
        ];
        let Some(text) = kalsa_probe::command_text(
            "powershell",
            QUERY,
            std::time::Duration::from_secs(10),
        ) else {
            return Vec::new();
        };
        text.lines()
            .map(str::trim)
            .filter(|line| line.contains('|'))
            .filter_map(|line| {
                let mut fields = line.split('|');
                let name = fields.next()?.trim().to_string();
                if name.is_empty() {
                    return None;
                }
                let driver = fields
                    .next()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string);
                let vram_bytes = fields
                    .next()
                    .map(str::trim)
                    .and_then(|value| value.parse::<u64>().ok())
                    .filter(|bytes| *bytes > 0);
                Some(Adapter {
                    name,
                    driver,
                    vram_bytes,
                })
            })
            .collect()
    }
    #[cfg(target_os = "macos")]
    {
        // One adapter: the SoC itself, named by the CPU's brand string, its
        // memory the system's, its driver the OS. `None` when even the chip
        // cannot be named — the block then says nothing about adapters
        // rather than inventing a name.
        kalsa_probe::brand_string()
            .map(|chip| {
                vec![Adapter {
                    name: chip,
                    driver: Some("the OS's own".to_string()),
                    vram_bytes: None,
                }]
            })
            .unwrap_or_default()
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Windows 11 keeps major at 10: the build is the only thing that says
    /// 11, and the marketing version and revision ride when the machine
    /// reports them.
    #[test]
    fn a_windows_version_is_named_by_its_build() {
        assert_eq!(
            windows_version_line(10, 0, 26200, Some("25H2"), Some(4652)),
            "windows 11 25H2 (build 26200.4652)"
        );
        assert_eq!(
            windows_version_line(10, 0, 22000, None, None),
            "windows 11 (build 22000)"
        );
        assert_eq!(
            windows_version_line(10, 0, 19045, Some("22H2"), Some(4046)),
            "windows 10.0 22H2 (build 19045.4046)"
        );
        // A blank marketing version leaves no doubled space in the line.
        assert_eq!(
            windows_version_line(10, 0, 26200, Some(" "), None),
            "windows 11 (build 26200)"
        );
    }

    fn machine() -> Machine {
        Machine {
            os: "macos 25.6.0 (build 24G84)".to_string(),
            arch: "aarch64",
            cpu: Some("Apple M1 Max".to_string()),
            physical_cores: Some(10),
            logical_cores: Some(10),
            ram_total_bytes: 68_719_476_736,
            ram_available_bytes: Some(30_000_000_000),
            bandwidth_bytes_per_second: Some(110.0 * 1024.0 * 1024.0 * 1024.0),
            adapters: vec![Adapter {
                name: "NVIDIA GeForce RTX 4050 Laptop GPU".to_string(),
                driver: Some("31.0.101.2125".to_string()),
                vram_bytes: Some(6_439_305_216),
            }],
            runs_on: "DiscreteGpu".to_string(),
        }
    }

    #[test]
    fn the_block_names_every_adapter_with_its_driver_version() {
        let lines = machine_lines(&machine(), "fixture-host");
        let adapters: Vec<_> = lines.iter().filter(|l| l.starts_with("adapter:")).collect();
        assert_eq!(adapters.len(), 1, "{lines:?}");
        assert!(
            adapters[0].contains("driver 31.0.101.2125"),
            "{}",
            adapters[0]
        );
        assert!(adapters[0].contains("discrete"), "{}", adapters[0]);
        assert!(adapters[0].contains("6.0 GiB"), "{}", adapters[0]);
    }

    #[test]
    fn the_block_never_contains_the_host_s_own_name() {
        // A fixture that smuggles the machine's name into two values: the
        // strip must take it out of both, in any case.
        let mut m = machine();
        m.cpu = Some("Apple M1 Max on marco-studio".to_string());
        m.adapters = vec![Adapter {
            name: "Intel(R) UHD Graphics (marco-studio iGPU)".to_string(),
            driver: None,
            vram_bytes: None,
        }];
        let joined = machine_lines(&m, "marco-studio").join("\n");
        assert!(
            !joined.to_lowercase().contains("marco-studio"),
            "the host's name reached the log: {joined}"
        );
        assert!(joined.contains("<host>"), "{joined}");
    }

    #[test]
    fn the_engine_half_names_release_build_devices_and_the_model_row() {
        let engine = Engine {
            release: "v1.1.5",
            build: "vulkan",
            listed_devices: vec![(
                "Vulkan0".to_string(),
                "NVIDIA GeForce RTX 4050 Laptop GPU (6144 MiB, 5900 MiB free)".to_string(),
            )],
            device: Some("Vulkan0".to_string()),
            model: Some("Alibaba Qwen 3.6".to_string()),
            row: Some("Alibaba/Qwen 3.6/Q4_K_M/22130000000".to_string()),
            context_tokens: 65_536,
            drafter: true,
        };
        let joined = engine_lines(&engine, "fixture-host").join("\n");
        assert!(joined.contains("kalsa-server v1.1.5 · vulkan build"), "{joined}");
        assert!(
            joined.contains("engine device: Vulkan0 = NVIDIA GeForce RTX 4050"),
            "{joined}"
        );
        assert!(joined.contains("device pin: Vulkan0"), "{joined}");
        assert!(joined.contains("context 65536 tokens"), "{joined}");
        assert!(joined.contains("drafter on"), "{joined}");
    }

    /// The host strip matches WHOLE words, case-insensitively, from three
    /// characters up: a host spelled "MAX" is removed where it stands as a
    /// word ("Desk MAX adapter"), a longer host is removed in any case, a
    /// PARTIAL word is never touched ("marco" leaves "marco2" alone), and
    /// a two-letter host strips nothing at all.
    #[test]
    fn the_host_strip_is_whole_word_any_case_and_needs_three_characters() {
        let redactions_host = "MAX";
        assert_eq!(
            without_host("Desk MAX adapter", redactions_host),
            "Desk <host> adapter"
        );
        assert_eq!(
            without_host("the MARCO-STUDIO machine", "marco-studio"),
            "the <host> machine",
            "case-insensitive, hyphenated"
        );
        assert_eq!(
            without_host("running on marco2 today", "marco"),
            "running on marco2 today",
            "a partial word is not the host"
        );
        assert_eq!(
            without_host("an climax adapter", "max"),
            "an climax adapter",
            "a partial word before the match is not the host either"
        );
        assert_eq!(
            without_host("Apple M1 Max", "m"),
            "Apple M1 Max",
            "below three characters, nothing is the host"
        );
        // And the machine's own block keeps its fixture host stripped.
        let m = machine();
        let joined = machine_lines(&m, "fixture-host").join("\n");
        assert!(!joined.contains("fixture-host"), "{joined}");
    }

    /// Adapter strings are vendor output: the block prints printable ASCII
    /// only, at most 80 characters, redacted like any other line.
    #[test]
    fn adapter_strings_arrive_printable_short_and_redacted() {
        let mut m = machine();
        m.adapters = vec![Adapter {
            name: format!("WéirdVendor\u{0007} {} GPU", "X".repeat(200)),
            driver: Some("31.0.101.\u{212B}".to_string()),
            vram_bytes: None,
        }];
        let lines = machine_lines(&m, "fixture-host");
        let adapter = lines
            .iter()
            .find(|l| l.starts_with("adapter:"))
            .expect("the adapter line exists");
        assert!(
            adapter.chars().all(|c| c.is_ascii_graphic() || c == ' '),
            "no control characters, no non-ASCII: {adapter}"
        );
        assert!(
            adapter.chars().count() < 160,
            "the name and driver are clipped to 80 each: {adapter}"
        );
    }
}
