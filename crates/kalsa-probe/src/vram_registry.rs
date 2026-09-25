//! The display adapter's real VRAM, as the driver itself writes it, read
//! from the registry natively — WMI's `AdapterRAM` cannot carry it.
//!
//! The evidence this exists for (the owner's Lenovo, capture 2026-09-24): an
//! RTX 4050 Laptop GPU of 6141 MiB per `nvidia-smi` answered `AdapterRAM` =
//! 4293918720 — 0xFFF00000, the 32-bit field's cap rounded to whole MiB —
//! while the class key `HKLM\SYSTEM\CurrentControlSet\Control\Class\
//! {4d36e968-e325-11ce-bfc1-08002be10318}\0001` holds
//! `HardwareInformation.qwMemorySize` = 6439305216, which is 6141 MiB
//! exactly. The Intel Arc in `0000` has no qwMemorySize at all: there the
//! 32-bit figure is all Windows ever had. docs/WHAT-IS-MISSING.md §22 named
//! this trap in words — "a card of 4 GiB or more can only be sized truly
//! from another source, such as the registry's … qwMemorySize, which was
//! not verified here" — and this is that source, now verified on both
//! machines (the Surface's denied keys are skipped, not fatal).
//!
//! Only the walk is Windows: the decode (value type plus bytes to a size)
//! and the match (DriverDesc to WMI's name) are pure, so the decision they
//! carry is tested on a machine with no such registry.

/// The two value types `qwMemorySize` arrives as, as winreg.h numbers them.
/// `RegGetValueW` reports the type it actually found against these, so a
/// value of any other shape reaches the decode and is refused there.
const REG_BINARY: u32 = 3;
const REG_QWORD: u32 = 11;

/// One registry value's TYPE and BYTES → the size it names: `REG_QWORD`, or
/// a `REG_BINARY` of exactly eight bytes (the same figure in binary form).
/// A four-byte figure, a wrong-sized anything, an unrelated type — none is
/// a size this code may report, and saying so (`None`) is the honest
/// answer, never half a guess.
pub(crate) fn size_from_value(kind: u32, bytes: &[u8]) -> Option<u64> {
    if kind != REG_QWORD && kind != REG_BINARY {
        return None;
    }
    let raw: [u8; 8] = bytes.try_into().ok()?;
    Some(u64::from_le_bytes(raw))
}

/// Which registry entry belongs to `controller`, the name WMI gave the row.
/// The two strings come from different producers — WMI's `Name` and the
/// driver INF's `DriverDesc` — and on the machine this was proven on they
/// are word-for-word identical; only case and surrounding space are allowed
/// to differ, because those are formatting, not identity. No match is an
/// honest answer: the caller then falls back to AdapterRAM, and the
/// saturated reading stays the non-answer it always was.
pub(crate) fn size_for(entries: &[(String, u64)], controller: &str) -> Option<u64> {
    let wanted = controller.trim();
    entries
        .iter()
        .find(|(driver_desc, _)| driver_desc.trim().eq_ignore_ascii_case(wanted))
        .map(|(_, size)| *size)
}

/// The display class's key: every adapter's numbered subkey lives under it,
/// the driver's own values included.
#[cfg(target_os = "windows")]
const CLASS_KEY: &str =
    r"SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}";

/// The values this walk asks for: a name and an eight-byte figure. A value
/// claiming to be larger is not one of them, and the bytes are never read.
#[cfg(target_os = "windows")]
const MAX_VALUE_BYTES: u32 = 4096;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{ERROR_MORE_DATA, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ,
    KEY_WOW64_64KEY, RRF_RT_REG_BINARY, RRF_RT_REG_QWORD, RRF_RT_REG_SZ,
};

/// A key that closes itself: every path out of the walk is an early return,
/// and a handle leaked per adapter would be a handle per detection.
#[cfg(target_os = "windows")]
struct Key(HKEY);

#[cfg(target_os = "windows")]
impl Drop for Key {
    fn drop(&mut self) {
        let _ = unsafe { RegCloseKey(self.0) };
    }
}

/// Every adapter under the class key that wrote a qwMemorySize:
/// (DriverDesc, bytes). Thin on purpose — enumerate the subkeys, read two
/// values each — and tolerant: a subkey that will not open (the Surface has
/// a `Properties` key access refuses; any key may deny) is skipped, not
/// fatal, because its absence costs only its own size.
#[cfg(target_os = "windows")]
pub(crate) fn registry_vram_sizes() -> Vec<(String, u64)> {
    let mut entries = Vec::new();
    let mut class: HKEY = std::ptr::null_mut();
    let path = wide(CLASS_KEY);
    let opened = unsafe {
        RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            path.as_ptr(),
            0,
            KEY_READ | KEY_WOW64_64KEY,
            &mut class,
        )
    };
    if opened != ERROR_SUCCESS {
        return entries;
    }
    let class = Key(class);
    for name in subkeys(&class) {
        let mut adapter: HKEY = std::ptr::null_mut();
        let wide_name = wide(&name);
        let opened = unsafe {
            RegOpenKeyExW(
                class.0,
                wide_name.as_ptr(),
                0,
                KEY_READ | KEY_WOW64_64KEY,
                &mut adapter,
            )
        };
        if opened != ERROR_SUCCESS {
            continue;
        }
        let adapter = Key(adapter);
        let Some(driver_desc) = reg_string(&adapter, "DriverDesc") else {
            continue;
        };
        let Some((kind, bytes)) = reg_value(
            &adapter,
            "HardwareInformation.qwMemorySize",
            RRF_RT_REG_QWORD | RRF_RT_REG_BINARY,
        ) else {
            continue;
        };
        if let Some(size) = size_from_value(kind, &bytes) {
            entries.push((driver_desc, size));
        }
    }
    entries
}

/// A Rust string as the NUL-terminated UTF-16 every registry call takes.
#[cfg(target_os = "windows")]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// The names of every subkey under `key`. An error that is not the end ends
/// the list too — the names are four digits in practice, so the only
/// realistic stops are ERROR_NO_MORE_ITEMS and a buffer no name needs; a
/// name longer than the buffer retries at the SAME index with more room
/// rather than being skipped.
#[cfg(target_os = "windows")]
fn subkeys(key: &Key) -> Vec<String> {
    let mut names = Vec::new();
    let mut index = 0;
    let mut buffer = vec![0u16; 64];
    loop {
        let mut len = buffer.len() as u32;
        let status = unsafe {
            RegEnumKeyExW(
                key.0,
                index,
                buffer.as_mut_ptr(),
                &mut len,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };
        if status == ERROR_MORE_DATA {
            if buffer.len() >= 1024 {
                break;
            }
            buffer.resize(buffer.len() * 2, 0);
            continue;
        }
        if status == ERROR_NO_MORE_ITEMS {
            break;
        }
        if status == ERROR_SUCCESS {
            if let Ok(name) = String::from_utf16(&buffer[..len as usize]) {
                names.push(name);
            }
        }
        // Any other error skips this index only; the index advances, so no
        // error can spin the walk in place.
        index += 1;
    }
    names
}

/// One REG_SZ value as a string — `DriverDesc`, by which this walk and WMI
/// name the same adapter. A value that will not decode is not an adapter
/// this code can match.
#[cfg(target_os = "windows")]
fn reg_string(key: &Key, name: &str) -> Option<String> {
    let (_, bytes) = reg_value(key, name, RRF_RT_REG_SZ)?;
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    let end = units
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(units.len());
    String::from_utf16(&units[..end]).ok()
}

/// One value's raw type and bytes, in the two calls every `RegGetValueW`
/// read has: size first, bytes second. Absent, denied, empty, absurdly
/// large, or resized under us between the calls is "no answer".
#[cfg(target_os = "windows")]
fn reg_value(key: &Key, name: &str, flags: u32) -> Option<(u32, Vec<u8>)> {
    let value = wide(name);
    let mut kind: u32 = 0;
    let mut size: u32 = 0;
    let status = unsafe {
        RegGetValueW(
            key.0,
            std::ptr::null(),
            value.as_ptr(),
            flags,
            &mut kind,
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if (status != ERROR_SUCCESS && status != ERROR_MORE_DATA) || size == 0 || size > MAX_VALUE_BYTES
    {
        return None;
    }
    let mut bytes = vec![0u8; size as usize];
    let status = unsafe {
        RegGetValueW(
            key.0,
            std::ptr::null(),
            value.as_ptr(),
            flags,
            &mut kind,
            bytes.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS {
        return None;
    }
    bytes.truncate(size as usize);
    Some((kind, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_qw_memory_size_decodes_from_both_shapes_it_arrives_in() {
        // The Lenovo's 0001 wrote 6439305216 (= 6141 MiB) as a QWORD figure.
        assert_eq!(
            size_from_value(REG_QWORD, &6439305216u64.to_le_bytes()),
            Some(6439305216)
        );
        // The same eight bytes as a REG_BINARY: accepted just the same.
        assert_eq!(
            size_from_value(REG_BINARY, &6439305216u64.to_le_bytes()),
            Some(6439305216)
        );
        // Little-endian: the bytes as the registry holds them, not as prose.
        assert_eq!(
            size_from_value(REG_QWORD, &[0x00, 0x00, 0x40, 0x80, 0x01, 0x00, 0x00, 0x00]),
            Some(0x180400000)
        );
    }

    #[test]
    fn anything_that_is_not_an_eight_byte_figure_is_not_a_size() {
        // The Arc's `HardwareInformation.MemorySize`: a four-byte REG_BINARY
        // (0x7FFFF800 here) — half a figure, and the 32-bit cap besides.
        assert_eq!(size_from_value(REG_BINARY, &[0x00, 0xF0, 0xFF, 0x7F]), None);
        // A DWORD where a QWORD belongs, a short QWORD, no bytes at all.
        assert_eq!(size_from_value(4, &4293918720u32.to_le_bytes()), None);
        assert_eq!(
            size_from_value(REG_QWORD, &4293918720u32.to_le_bytes()),
            None
        );
        assert_eq!(size_from_value(REG_QWORD, &[]), None);
    }

    #[test]
    fn an_adapter_is_matched_by_its_driver_description() {
        let entries = vec![
            ("NVIDIA GeForce RTX 4050 Laptop GPU".to_string(), 6439305216),
            ("AMD Radeon RX 6800 XT".to_string(), 17179869184),
        ];
        assert_eq!(
            size_for(&entries, "NVIDIA GeForce RTX 4050 Laptop GPU"),
            Some(6439305216)
        );
        // The WMI row arrives tokenised and re-spaced; case and surrounding
        // space are formatting, not identity.
        assert_eq!(
            size_for(&entries, "  nvidia geforce rtx 4050 laptop gpu "),
            Some(6439305216)
        );
        // An adapter the walk holds no entry for (the Arc wrote no
        // qwMemorySize) answers nothing — never a zero, never another card's
        // figure.
        assert_eq!(size_for(&entries, "Intel(R) Arc(TM) Graphics"), None);
        assert_eq!(size_for(&entries, "NVIDIA T400"), None);
        assert_eq!(size_for(&[], "NVIDIA GeForce RTX 4050 Laptop GPU"), None);
    }

    /// The walk against this machine's own registry: it must answer without
    /// panicking whether keys deny it (the Surface's `Properties` does), and
    /// every entry it gives must be a name and a plausible size. The VALUES
    /// are machine-specific — the Lenovo answers
    /// ("NVIDIA GeForce RTX 4050 Laptop GPU", 6439305216), the Surface
    /// nothing — so this prints them as the run's record and asserts only
    /// what every machine must satisfy.
    #[cfg(target_os = "windows")]
    #[test]
    fn the_walk_answers_on_this_machine() {
        let entries = registry_vram_sizes();
        eprintln!("registry VRAM as this machine answers it: {entries:?}");
        for (driver_desc, size) in &entries {
            assert!(!driver_desc.is_empty());
            assert!(*size >= 1024 * 1024, "{driver_desc} claims {size} bytes");
        }
    }
}
