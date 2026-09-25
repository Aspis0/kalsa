//! Physical cores: the ceiling under a thread count.
//!
//! The plateau can ride onto hyperthreading's extra logical threads, and
//! past the physical count that costs throughput (the launch policy carries
//! the evidence); this is the number the thread count is capped at.

use std::sync::OnceLock;

static CACHE: OnceLock<usize> = OnceLock::new();

/// The machine's physical core count — logical threads cannot inflate it —
/// or `None` when this platform cannot say. Cached after the first `Some`;
/// a `None` is not cached, so a transient failure can be asked again.
pub fn physical_cores() -> Option<usize> {
    if let Some(known) = CACHE.get() {
        return Some(*known);
    }
    let found = platform_physical_cores()?;
    Some(*CACHE.get_or_init(|| found))
}

/// macOS: the `hw.physicalcpu` sysctl.
#[cfg(target_os = "macos")]
fn platform_physical_cores() -> Option<usize> {
    let name = b"hw.physicalcpu\0";
    let mut count: i32 = 0;
    let mut len = std::mem::size_of::<i32>();
    let ok = unsafe {
        libc::sysctlbyname(
            name.as_ptr().cast::<libc::c_char>(),
            &mut count as *mut i32 as *mut libc::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    (ok == 0 && count > 0).then_some(count as usize)
}

/// Windows: one entry per physical core in `RelationProcessorCore` records.
/// The first call sizes the buffer (`ERROR_INSUFFICIENT_BUFFER`); entries
/// are walked by each entry's own `Size`, never a fixed stride — the
/// PowerShell attempt that assumed a stride broke after one of sixteen
/// entries.
#[cfg(windows)]
fn platform_physical_cores() -> Option<usize> {
    use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
    use windows_sys::Win32::System::SystemInformation::{
        GetLogicalProcessorInformationEx, RelationProcessorCore,
    };

    let mut length: u32 = 0;
    let sizing = unsafe {
        GetLogicalProcessorInformationEx(RelationProcessorCore, std::ptr::null_mut(), &mut length)
    };
    let sized = sizing == 0
        && io_last_error() == Some(ERROR_INSUFFICIENT_BUFFER as i32)
        && length > 0;
    if !sized {
        return None;
    }
    // A topology change between calls only costs another lap: grow to what
    // the OS asks for until it accepts the buffer.
    let mut buffer = vec![0u8; length as usize];
    loop {
        let ok = unsafe {
            GetLogicalProcessorInformationEx(
                RelationProcessorCore,
                buffer.as_mut_ptr().cast(),
                &mut length,
            )
        };
        if ok != 0 {
            break;
        }
        if io_last_error() != Some(ERROR_INSUFFICIENT_BUFFER as i32) {
            return None;
        }
        buffer.resize(length as usize, 0);
    }
    // Header per entry: Relationship (i32) at 0, Size (u32) at 4 — Windows
    // is little-endian, and `Size` is the only stride this walk trusts.
    let returned = (length as usize).min(buffer.len());
    let mut offset = 0usize;
    let mut cores = 0usize;
    while offset + 8 <= returned {
        let entry = &buffer[offset..];
        let relationship = i32::from_le_bytes(entry[0..4].try_into().expect("four bytes"));
        let size = u32::from_le_bytes(entry[4..8].try_into().expect("four bytes")) as usize;
        if size < 8 || offset + size > returned {
            // The OS handed back something this walk cannot trust: no count
            // is better than a wrong one.
            return None;
        }
        if relationship == RelationProcessorCore {
            cores += 1;
        }
        offset += size;
    }
    (cores > 0).then_some(cores)
}

/// The thread's last Win32 error as an `io::Error` would report it — the
/// `GetLastError` value behind the last failed call.
#[cfg(windows)]
fn io_last_error() -> Option<i32> {
    std::io::Error::last_os_error().raw_os_error()
}

/// Linux: unique `(physical_package_id, core_id)` pairs under the CPU
/// topology. **Not run on real Linux** — declared for completeness; cpus
/// without a readable topology are skipped, and no topology at all is
/// `None`.
#[cfg(target_os = "linux")]
fn platform_physical_cores() -> Option<usize> {
    use std::collections::BTreeSet;

    let mut seen = BTreeSet::new();
    for entry in std::fs::read_dir("/sys/devices/system/cpu").ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(index) = name.strip_prefix("cpu").and_then(|n| n.parse::<u32>().ok()) else {
            continue;
        };
        let base = format!("/sys/devices/system/cpu/cpu{index}/topology/");
        let Ok(package) = std::fs::read_to_string(format!("{base}physical_package_id")) else {
            continue;
        };
        let Ok(core) = std::fs::read_to_string(format!("{base}core_id")) else {
            continue;
        };
        seen.insert((package.trim().to_string(), core.trim().to_string()));
    }
    (!seen.is_empty()).then_some(seen.len())
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_physical_cores() -> Option<usize> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The machine's own answer, printed so the Surface (4) and the Lenovo
    /// (16) are checkable by reading the log. Cached: the same answer
    /// again without another syscall.
    #[test]
    fn physical_cores_answers_on_this_machine() {
        let cores = physical_cores();
        println!("physical cores on this machine: {cores:?}");
        let cores = cores.expect("this platform can say");
        assert!(cores >= 1, "{cores}");
        assert_eq!(physical_cores(), Some(cores));
    }
}
