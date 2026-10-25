//! Core counts: the ceiling under a thread count, and the machine's width.
//!
//! The plateau can ride onto hyperthreading's extra logical threads, and
//! past the physical count that costs throughput (the launch policy carries
//! the evidence); the physical count is what the thread count is capped at,
//! and the logical count (every thread the OS lays out) is the machine's —
//! both asked of the machine, never of this process: a process's
//! `available_parallelism()` answers for its own affinity, which a limit
//! can move between runs, and anything keyed on it re-tunes whenever a
//! limit blinks.

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

static LOGICAL_CACHE: OnceLock<usize> = OnceLock::new();

/// The machine's logical core count — every thread the OS lays out for
/// this machine — or `None` when this platform cannot say. The MACHINE's
/// number, not this process's: `std::thread::available_parallelism()`
/// answers for the calling process's affinity, which a limit or a
/// scheduler policy can move between runs. Cached after the first `Some`,
/// like the physical count; a `None` is not cached.
pub fn logical_cores() -> Option<usize> {
    if let Some(known) = LOGICAL_CACHE.get() {
        return Some(*known);
    }
    let found = platform_logical_cores()?;
    Some(*LOGICAL_CACHE.get_or_init(|| found))
}

/// macOS: the `hw.logicalcpu` sysctl.
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

/// macOS: the `hw.logicalcpu` sysctl.
#[cfg(target_os = "macos")]
fn platform_logical_cores() -> Option<usize> {
    let name = b"hw.logicalcpu\0";
    let mut count: i32 = 0;
    let mut len = std::mem::size_of::<i32>();
    let ok = unsafe {
        libc::sysctlbyname(
            name.as_ptr().cast::<libc::c_char>(),
            &mut count as *mut i32 as *mut std::ffi::c_void,
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    (ok == 0 && count > 0).then_some(count as usize)
}

/// Windows: every active processor in every group, machine-wide and
/// indifferent to this process's affinity. `GetSystemInfo`'s
/// `dwNumberOfProcessors` counts only this process's processor GROUP —
/// on a machine with more than 64 logical processors that is a piece of
/// the machine, not the machine. Zero on failure reads as no answer.
#[cfg(windows)]
fn platform_logical_cores() -> Option<usize> {
    use windows_sys::Win32::System::Threading::{GetActiveProcessorCount, ALL_PROCESSOR_GROUPS};
    let count = unsafe { GetActiveProcessorCount(ALL_PROCESSOR_GROUPS) } as usize;
    (count > 0).then_some(count)
}

/// Linux: every `cpuN` entry under the machine's CPU directory — the
/// OS's layout, not the process's affinity mask.
#[cfg(target_os = "linux")]
fn platform_logical_cores() -> Option<usize> {
    let mut cores = 0usize;
    for entry in std::fs::read_dir("/sys/devices/system/cpu").ok()?.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name
            .strip_prefix("cpu")
            .is_some_and(|index| index.parse::<u32>().is_ok())
        {
            cores += 1;
        }
    }
    (cores > 0).then_some(cores)
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn platform_logical_cores() -> Option<usize> {
    None
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
    /// The machine's logical count, printed beside the physical one —
    /// this is the number the tune's key carries, so it must be the
    /// machine's answer, cached like the physical count.
    #[test]
    fn logical_cores_answers_on_this_machine() {
        let cores = logical_cores();
        println!("logical cores on this machine: {cores:?}");
        let cores = cores.expect("this platform can say");
        assert!(cores >= 1, "{cores}");
        assert!(
            cores >= physical_cores().expect("physical works where logical does"),
            "a machine's logical count is at least its physical one: {cores}"
        );
        assert_eq!(logical_cores(), Some(cores));
    }

    #[test]
    fn physical_cores_answers_on_this_machine() {
        let cores = physical_cores();
        println!("physical cores on this machine: {cores:?}");
        let cores = cores.expect("this platform can say");
        assert!(cores >= 1, "{cores}");
        assert_eq!(physical_cores(), Some(cores));
    }
}
