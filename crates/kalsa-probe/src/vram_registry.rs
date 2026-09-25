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

/// A figure no GPU has is not a size: the decode refuses anything outside
/// `(0, 512 GiB]`. Zero would budget a zero-byte card — the same
/// non-answer as a zero `AdapterRAM` — and a figure past 512 GiB cannot be
/// video memory on any machine this product runs on (the largest shipping
/// cards are under 200 GB), so only a garbage or truncated read can fail
/// the ceiling, never a real card.
const MAX_PLAUSIBLE_BYTES: u64 = 512 * 1024 * 1024 * 1024;

/// One registry value's TYPE and BYTES → the size it names: `REG_QWORD`, or
/// a `REG_BINARY` of exactly eight bytes (the same figure in binary form).
/// A four-byte figure, a wrong-sized anything, an unrelated type, a zero,
/// or a figure no GPU has — none is a size this code may report, and
/// saying so (`None`) is the honest answer, never half a guess.
pub(crate) fn size_from_value(kind: u32, bytes: &[u8]) -> Option<u64> {
    if kind != REG_QWORD && kind != REG_BINARY {
        return None;
    }
    let raw: [u8; 8] = bytes.try_into().ok()?;
    let size = u64::from_le_bytes(raw);
    if size == 0 || size > MAX_PLAUSIBLE_BYTES {
        return None;
    }
    Some(size)
}

/// Which registry entry belongs to `controller`, the name WMI gave the row.
/// The two strings come from different producers — WMI's `Name` and the
/// driver INF's `DriverDesc` — and on the machine this was proven on they
/// are word-for-word identical; only case and surrounding space are allowed
/// to differ, because those are formatting, not identity. The class key can
/// hold STALE entries and enumeration order is promised by nothing, so a
/// name may match more than once: every match must agree on the size, or
/// there is no answer — the first entry's word is not evidence. Two
/// identical cards write the same figure and still agree. No match and an
/// ambiguous one are both honest answers: the caller falls back to
/// AdapterRAM below the cap, and the saturated reading stays the
/// non-answer it always was.
pub(crate) fn size_for(entries: &[(String, u64)], controller: &str) -> Option<u64> {
    let wanted = controller.trim();
    let mut agreed: Option<u64> = None;
    for (driver_desc, size) in entries {
        if !driver_desc.trim().eq_ignore_ascii_case(wanted) {
            continue;
        }
        match agreed {
            None => agreed = Some(*size),
            // Two identical cards write one figure; two answers that do
            // not match name no size this code can trust.
            Some(seen) if seen == *size => {}
            Some(_) => return None,
        }
    }
    agreed
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
use windows_sys::Win32::Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS};
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

/// The class key's subkeys are the numbered adapters plus a few odds and
/// ends — a few dozen at most. A walk whose index reaches this has lost its
/// way (a key that kept answering past every real name would otherwise
/// never end), and stopping is the only honest answer.
const MAX_SUBKEYS: u32 = 256;

/// Two Win32 status codes, restated from winerror.h: the decision below is
/// pure and must compile where `windows-sys` does not (its tests run on
/// any machine), and these are OS ABI — they do not drift.
const STATUS_SUCCESS: u32 = 0;
const STATUS_MORE_DATA: u32 = 234;

/// What one `RegEnumKeyExW` answer means for the walk.
enum Enumeration {
    /// The buffer was too small: grow it and ask at the SAME index.
    Grow,
    /// A real name at this index: take it and advance.
    Take,
    /// The walk is over — the normal end, an error, or the index bound.
    Stop,
}

/// The whole loop condition, decided from one answer. `ERROR_NO_MORE_ITEMS`
/// (259, the normal end) and EVERY other error stop the walk: a version of
/// this loop that only knew the normal end skipped ahead past any other
/// error and would keep asking a failing key at every index forever. The
/// index bound is the belt for a key that keeps answering successfully past
/// every name a display class can hold.
fn enum_decision(status: u32, index: u32) -> Enumeration {
    if index >= MAX_SUBKEYS {
        return Enumeration::Stop;
    }
    if status == STATUS_MORE_DATA {
        return Enumeration::Grow;
    }
    if status != STATUS_SUCCESS {
        return Enumeration::Stop;
    }
    Enumeration::Take
}

/// The names of every subkey under `key`; how the walk ENDS is
/// `enum_decision`'s call — any error, or `MAX_SUBKEYS` — so a failing key
/// stops it instead of feeding it indices forever. `ERROR_MORE_DATA` grows
/// the buffer and asks the SAME index again, so a name is never skipped
/// for being long; 1024 UTF-16 units is where that patience ends, and no
/// display-class subkey comes close.
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
        match enum_decision(status, index) {
            Enumeration::Grow => {
                if buffer.len() >= 1024 {
                    break;
                }
                buffer.resize(buffer.len() * 2, 0);
            }
            Enumeration::Take => {
                if let Ok(name) = String::from_utf16(&buffer[..len as usize]) {
                    names.push(name);
                }
                index += 1;
            }
            Enumeration::Stop => break,
        }
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

    #[test]
    fn a_zero_or_impossible_figure_is_not_a_size() {
        assert_eq!(size_from_value(REG_QWORD, &0u64.to_le_bytes()), None);
        assert_eq!(
            size_from_value(REG_QWORD, &(MAX_PLAUSIBLE_BYTES + 1).to_le_bytes()),
            None
        );
        // The ceiling itself is a size a future card could have.
        assert_eq!(
            size_from_value(REG_QWORD, &MAX_PLAUSIBLE_BYTES.to_le_bytes()),
            Some(MAX_PLAUSIBLE_BYTES)
        );
    }

    #[test]
    fn duplicate_matches_must_agree_to_be_a_size() {
        // Two identical cards write one figure, so duplicates that agree
        // are still the card's size.
        let agree = vec![
            ("NVIDIA GeForce RTX 4050 Laptop GPU".to_string(), 6439305216),
            ("NVIDIA GeForce RTX 4050 Laptop GPU".to_string(), 6439305216),
        ];
        assert_eq!(
            size_for(&agree, "NVIDIA GeForce RTX 4050 Laptop GPU"),
            Some(6439305216)
        );
        // A stale entry beside a live one: they disagree, and enumeration
        // order promises nothing — whichever comes first, the name answers
        // no size and the caller falls back below the cap.
        let live = ("NVIDIA GeForce RTX 4050 Laptop GPU".to_string(), 6439305216);
        let stale = ("NVIDIA GeForce RTX 4050 Laptop GPU".to_string(), 4293918720);
        assert_eq!(
            size_for(
                &[live.clone(), stale.clone()],
                "NVIDIA GeForce RTX 4050 Laptop GPU"
            ),
            None
        );
        assert_eq!(
            size_for(&[stale, live], "NVIDIA GeForce RTX 4050 Laptop GPU"),
            None
        );
    }

    #[test]
    fn any_error_and_the_index_bound_end_the_walk() {
        // 259 is ERROR_NO_MORE_ITEMS — the normal end — and any other
        // non-zero status is an error: the pre-7fef63b loop knew only the
        // normal end and advanced past every other error, so a key failing
        // at each index never ended the walk.
        assert!(matches!(enum_decision(259, 0), Enumeration::Stop));
        assert!(matches!(enum_decision(5, 0), Enumeration::Stop));
        // The belt: successful answers past every name a display class has
        // stop too.
        assert!(matches!(
            enum_decision(STATUS_SUCCESS, MAX_SUBKEYS),
            Enumeration::Stop
        ));
        assert!(matches!(
            enum_decision(STATUS_SUCCESS, MAX_SUBKEYS + 1),
            Enumeration::Stop
        ));
        // The working paths stay working: grow at the same index, take and
        // advance.
        assert!(matches!(
            enum_decision(STATUS_MORE_DATA, 7),
            Enumeration::Grow
        ));
        assert!(matches!(
            enum_decision(STATUS_SUCCESS, 7),
            Enumeration::Take
        ));
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
