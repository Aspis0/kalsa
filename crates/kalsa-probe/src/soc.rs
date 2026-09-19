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

/// The CPU's marketing name, as the kernel reports it.
#[cfg(target_os = "macos")]
fn brand_string() -> Option<String> {
    let out = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "machdep.cpu.brand_string"])
        .output()
        .ok()?;
    let name = String::from_utf8(out.stdout).ok()?;
    let name = name.trim().to_string();
    (!name.is_empty()).then_some(name)
}

#[cfg(not(target_os = "macos"))]
fn brand_string() -> Option<String> {
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
