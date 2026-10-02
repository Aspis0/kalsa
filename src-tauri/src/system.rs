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

/// One value with the host's own name taken out of it, whatever case it
/// arrived in: a machine's name is an identifier, and the block's rule is
/// that no identifier of the household reaches the log. Compared by
/// character (ASCII case folded), because a byte offset into the original
/// would not survive a case mapping that changes length.
fn without_host(value: &str, host: &str) -> String {
    let host: Vec<char> = host.chars().collect();
    if host.len() < 3 {
        return value.to_string();
    }
    let value: Vec<char> = value.chars().collect();
    let mut out = String::with_capacity(value.len());
    let mut at = 0;
    while at < value.len() {
        let matches = (0..host.len()).all(|offset| {
            value
                .get(at + offset)
                .is_some_and(|c| c.eq_ignore_ascii_case(&host[offset]))
        });
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
        lines.push(without_host(
            &format!(
                "adapter: {} ({kind}, driver {}, {})",
                adapter.name,
                adapter.driver.as_deref().unwrap_or("unknown"),
                adapter
                    .vram_bytes
                    .map_or_else(|| "VRAM not reported".to_string(), gib),
            ),
            host,
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
/// means (`macOS 15.6 build 24G84`, `windows 10.0.26100`), falling back to
/// the kernel's own version when the platform's product query will not
/// answer. Never the host's name.
pub(crate) fn os_description() -> String {
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
        // SAFETY: `GetVersionExW` fills a plain struct of the size it is
        // told.
        unsafe {
            let mut info: windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW =
                std::mem::zeroed();
            info.dwOSVersionInfoSize =
                std::mem::size_of::<windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW>()
                    as u32;
            if windows_sys::Win32::System::SystemInformation::GetVersionExW(&mut info) != 0 {
                return format!(
                    "{} {}.{}.{}",
                    std::env::consts::OS, info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber
                );
            }
        }
        std::env::consts::OS.to_string()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        crate::logging::os_version()
    }
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
        m.cpu = Some("Apple M1 Max on MARCO-STUDIO".to_string());
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
}
