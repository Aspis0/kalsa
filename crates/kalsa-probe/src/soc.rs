//! What an Apple chip's memory bandwidth is, and what decode really reaches on
//! it.
//!
//! The probe measures the CPU, because the CPU is the path it can measure with
//! a portable loop. On a Mac the model decodes on the GPU, where the SoC's whole
//! bandwidth is reachable and the CPU's share of it is not — an M1 Max streams
//! ~110 GB/s from its cores and is specified at 400. Quoting the CPU figure as
//! the answer told the owner of one "at least 17 tokens a second" for a model
//! that does 40–50.
//!
//! What closes that gap is not a second probe — nothing here runs a Metal
//! kernel — but the chip's published figure and ONE measured share:
//! [`crate::predict`]'s five real llama.cpp decodes on an M1 Max fit a marginal
//! 197.0 GB/s against a published 400, which is [`DECODE_SHARE_OF_PUBLISHED`].
//!
//! Three honesties this file owes:
//!
//! * applying one machine's share to a different chip is an **extrapolation**.
//!   It is why the answer still travels as a band and never as a point, and why
//!   independent figures for other backends (CUDA 65–77%, Apple Ultra 43–45%)
//!   are a reason to keep this conservative rather than to widen it;
//! * a chip this table does not know gets **no** figure. The CPU floor is then
//!   what there is, and it says so — a guessed bandwidth is worse than a
//!   number that admits its path;
//! * Apple publishes bandwidth per configuration, not per name: the Max and
//!   Ultra parts ship at two figures depending on GPU core count, and the brand
//!   string does not say which. Those rows carry the **lower** figure, so the
//!   prediction is short of the truth rather than past it.

/// Marginal decode bandwidth as a share of the chip's published figure, from
/// the five-point fit in [`crate::predict`]: 197.0 GB/s reached on a part
/// specified at 400 GB/s (Apple M1 Max, llama.cpp b10950 through Metal,
/// `llama-bench -p 0 -n 128 -r 3`, five dense Q4_K_M models).
pub const DECODE_SHARE_OF_PUBLISHED: f64 =
    crate::predict::MEASURED_DECODE_BYTES_PER_SECOND / M1_MAX_PUBLISHED;

/// The published figure of the part the fit ran on, named because the share
/// above is a share OF it. The table below carries the same number for the
/// lookup; [`the_share_is_the_fitted_rate_over_the_chip_it_ran_on`] is what
/// keeps the two from parting company.
const M1_MAX_PUBLISHED: f64 = 400.0e9;

/// Published unified-memory bandwidth per chip, in bytes per second. Apple's
/// own figures, from the newsroom releases and the technical specifications;
/// where a name ships at two figures the lower one is recorded, because the
/// brand string cannot tell them apart.
const PUBLISHED: &[(&str, f64)] = &[
    ("Apple M1 Max", 400.0e9),
    ("Apple M1 Pro", 200.0e9),
    ("Apple M1 Ultra", 800.0e9),
    ("Apple M1", 68.25e9),
    ("Apple M2 Max", 400.0e9),
    ("Apple M2 Pro", 200.0e9),
    ("Apple M2 Ultra", 800.0e9),
    ("Apple M2", 100.0e9),
    // M3 Max ships at 300 and 400; M4 Max at 410 and 546; M5 Max at 460 and
    // 614. The lower figure is the one that cannot over-promise.
    ("Apple M3 Max", 300.0e9),
    ("Apple M3 Pro", 150.0e9),
    ("Apple M3 Ultra", 819.0e9),
    ("Apple M3", 100.0e9),
    ("Apple M4 Max", 410.0e9),
    ("Apple M4 Pro", 273.0e9),
    ("Apple M4", 120.0e9),
    ("Apple M5 Max", 460.0e9),
    ("Apple M5 Pro", 307.0e9),
    ("Apple M5 Ultra", 1200.0e9),
    ("Apple M5", 153.0e9),
];

/// The published figure for a brand string, or `None` for a chip this table
/// does not know.
///
/// The brand string must name a row exactly. A prefix test is what would let
/// "Apple M4 Ultra" — a chip that has never shipped and has no row — inherit
/// the bare M4's 120 GB/s, 6.8x short, and every prediction on such a machine
/// would be optimistic by that factor. An unknown variant of a known family
/// reads as unmeasured instead, and the caller keeps the CPU figure that says
/// it is a floor: a guessed bandwidth is worse than a number that admits its
/// path.
pub fn published_bandwidth(brand: &str) -> Option<f64> {
    PUBLISHED
        .iter()
        .find(|(name, _)| *name == brand)
        .map(|(_, bytes)| *bytes)
}

/// What decode should reach on this machine's GPU, when the chip is one this
/// table knows. `None` on every other machine and on every other platform: the
/// caller then has the CPU measurement and the note that says it is a floor.
pub fn decode_bandwidth() -> Option<f64> {
    published_bandwidth(&brand_string()?).map(|published| published * DECODE_SHARE_OF_PUBLISHED)
}

/// The CPU's marketing name — sysctl's on macOS, CPUID's brand-string
/// leaves on x86 — and `None` where neither names it (aarch64): the
/// record then carries no chip name, no `cpu:` line prints, and never a
/// wrong name. The record the app keeps of a measurement carries this as
/// the chip's identity: it is the same string the decode estimate below
/// is keyed on, and it is cheap.
#[cfg(target_os = "macos")]
pub fn brand_string() -> Option<String> {
    let out = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .ok()?;
    let name = String::from_utf8(out.stdout).ok()?;
    let name = name.trim().to_string();
    (!name.is_empty()).then_some(name)
}

#[cfg(all(
    not(target_os = "macos"),
    any(target_arch = "x86", target_arch = "x86_64")
))]
pub fn brand_string() -> Option<String> {
    brand_from_bytes(&cpuid_brand_bytes()?)
}

/// CPUID's three brand leaves (0x80000002..=0x80000004): four
/// little-endian registers per leaf, 48 bytes in all, in string order.
/// The first call asks for the highest extended leaf, so a CPU whose
/// answer stops short of the third brand leaf has no brand here to ask.
#[cfg(all(
    not(target_os = "macos"),
    any(target_arch = "x86", target_arch = "x86_64")
))]
fn cpuid_brand_bytes() -> Option<[u8; 48]> {
    #[cfg(target_arch = "x86")]
    use std::arch::x86::__cpuid;
    #[cfg(target_arch = "x86_64")]
    use std::arch::x86_64::__cpuid;

    // The first call asks for the highest extended leaf: a max that stops
    // short of 0x80000004 is a CPU with no brand leaves, and the three
    // leaves below are then never asked for.
    if __cpuid(0x8000_0000).eax < 0x8000_0004 {
        return None;
    }
    let mut bytes = [0u8; 48];
    for index in 0..3u32 {
        let registers = __cpuid(0x8000_0002 + index);
        let at = index as usize * 16;
        bytes[at..at + 4].copy_from_slice(&registers.eax.to_le_bytes());
        bytes[at + 4..at + 8].copy_from_slice(&registers.ebx.to_le_bytes());
        bytes[at + 8..at + 12].copy_from_slice(&registers.ecx.to_le_bytes());
        bytes[at + 12..at + 16].copy_from_slice(&registers.edx.to_le_bytes());
    }
    Some(bytes)
}

/// The 48 bytes as the name they spell: the string ends at the first
/// NUL — whatever follows is padding or a neighbouring field, never the
/// name — every byte before it must be printable ASCII (a vendor that
/// says otherwise earns no name rather than a mangled one), and the
/// padding spaces come off both ends. All spaces is no name.
#[cfg(any(
    test,
    all(
        not(target_os = "macos"),
        any(target_arch = "x86", target_arch = "x86_64")
    )
))]
fn brand_from_bytes(bytes: &[u8; 48]) -> Option<String> {
    let end = bytes
        .iter()
        .position(|&byte| byte == 0)
        .unwrap_or(bytes.len());
    let name = &bytes[..end];
    if !name
        .iter()
        .all(|byte| byte.is_ascii_graphic() || *byte == b' ')
    {
        return None;
    }
    let name = std::str::from_utf8(name).ok()?.trim();
    (!name.is_empty()).then(|| name.to_string())
}

#[cfg(not(any(target_os = "macos", target_arch = "x86", target_arch = "x86_64")))]
pub fn brand_string() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_suffixed_name_is_not_answered_by_its_family() {
        // The bug this ordering exists to prevent: an M1 Max told it has an
        // M1's 68 GB/s would be under-predicted by a factor of six.
        assert_eq!(published_bandwidth("Apple M1 Max"), Some(400.0e9));
        assert_eq!(published_bandwidth("Apple M1 Pro"), Some(200.0e9));
        assert_eq!(published_bandwidth("Apple M1"), Some(68.25e9));
        assert_eq!(published_bandwidth("Apple M5 Ultra"), Some(1200.0e9));
    }

    #[test]
    fn an_ultra_of_a_family_without_an_ultra_row_is_not_answered_by_the_bare_chip() {
        // No M4 Ultra has shipped and the table has no row for one. A prefix
        // match answered "Apple M4 Ultra" with the bare M4's 120 GB/s — 6.8x
        // short — and every speed prediction on such a machine would have
        // been optimistic by that factor. An unknown variant of a known
        // family reads as unmeasured, which the app already handles.
        assert_eq!(published_bandwidth("Apple M4 Ultra"), None);
    }

    #[test]
    fn a_chip_the_table_does_not_know_gets_nothing() {
        assert_eq!(published_bandwidth("Apple M9 Ultra"), None);
        assert_eq!(published_bandwidth("Intel(R) Core(TM) i9-9880H"), None);
        assert_eq!(published_bandwidth(""), None);
    }

    #[test]
    fn brand_bytes_read_as_a_trimmed_name() {
        // The two paddings vendors actually ship: spaces (Intel) and
        // NULs (AMD), both inside the same 48 bytes.
        let mut space_padded = [b' '; 48];
        let intel = b"Intel(R) Core(TM) i7-1065G7";
        space_padded[..intel.len()].copy_from_slice(intel);
        assert_eq!(
            brand_from_bytes(&space_padded),
            Some("Intel(R) Core(TM) i7-1065G7".to_string())
        );
        let mut nul_padded = [0u8; 48];
        let amd = b"AMD Ryzen 9 5900X 12-Core Processor";
        nul_padded[..amd.len()].copy_from_slice(amd);
        assert_eq!(
            brand_from_bytes(&nul_padded),
            Some("AMD Ryzen 9 5900X 12-Core Processor".to_string())
        );
        assert_eq!(brand_from_bytes(&[0u8; 48]), None);
    }

    #[test]
    fn brand_bytes_of_all_spaces_are_no_name() {
        assert_eq!(brand_from_bytes(&[b' '; 48]), None);
    }

    #[test]
    fn the_name_ends_at_the_first_nul_and_what_follows_is_never_read() {
        // Junk after the first NUL — not printable, not the name's
        // business: the cut is what makes the junk unreachable.
        let mut bytes = [0xFFu8; 48];
        let name = b"AMD Ryzen 9 5900X 12-Core Processor";
        bytes[..name.len()].copy_from_slice(name);
        bytes[name.len()] = 0;
        assert_eq!(
            brand_from_bytes(&bytes),
            Some("AMD Ryzen 9 5900X 12-Core Processor".to_string())
        );
    }

    #[test]
    fn a_brand_that_is_not_printable_ascii_is_no_name() {
        // No NUL before the odd byte, so the whole run must be printable:
        // a multi-byte é in a brand is a brand this line will not print.
        let mut bytes = [b' '; 48];
        let odd = b"Fr\xC3\xA9quency CPU";
        bytes[..odd.len()].copy_from_slice(odd);
        assert_eq!(brand_from_bytes(&bytes), None);
    }

    /// The machine's own name, on the hosts that answer: sysctl's on an
    /// Intel Mac, CPUID's brand leaves on x86 Windows and Linux.
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    #[test]
    fn this_cpu_is_named_in_printable_ascii() {
        let name = brand_string().expect("this platform names its CPU");
        assert!(!name.is_empty(), "the brand string was empty");
        assert!(
            name.chars().all(|c| c.is_ascii_graphic() || c == ' '),
            "not printable ASCII: {name:?}"
        );
    }

    #[test]
    fn the_share_is_the_fitted_rate_over_the_chip_it_ran_on() {
        // The share is derived from `predict`'s constant, so it cannot drift
        // from the fit and there is nothing to assert about that. What can
        // still go wrong is the denominator: if the table's M1 Max row were
        // edited, the share would quietly become a share of another part.
        assert_eq!(published_bandwidth("Apple M1 Max"), Some(M1_MAX_PUBLISHED));
        assert!(
            (0.0..1.0).contains(&DECODE_SHARE_OF_PUBLISHED),
            "decode cannot outrun the bus it reads: {DECODE_SHARE_OF_PUBLISHED}"
        );
    }
}
