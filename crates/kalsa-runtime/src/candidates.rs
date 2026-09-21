//! Which builds this machine should try, best first.
//!
//! Detection (`kalsa_probe::Backend`) only *narrows* the candidates: a GPU
//! build can still refuse at device init, and a failing GPU backend does not
//! always fail cleanly (the CUDA error path calls `GGML_ABORT`, a missing DLL
//! kills the process before the server starts). So this list is a plan for
//! the probe, not a verdict — the probe walks it and stops at the first build
//! that actually answers.
//!
//! Candidate order is also *download* order, which is why the ~32 MB Vulkan
//! build comes before either ~645 MB CUDA build: detection cannot tell an
//! NVIDIA card from an AMD one (`kalsa_probe` collapses both into
//! `DiscreteGpu`), and making an AMD owner download 645 MB of CUDA before a
//! 32 MB archive that would have worked is not a decision this crate gets to
//! make twice.

use crate::assets::{Platform, ServerBackend};
use kalsa_probe::Backend;

/// The builds to try on this machine, in order. CPU is always last when it is
/// present at all — and for a machine without a usable discrete GPU it is the
/// whole list, which is a correct answer, not a consolation: an old iGPU
/// reads the same system RAM at the same speed, so there is no decode win to
/// chase.
pub fn candidates_for(platform: Option<Platform>, detected: Backend) -> Vec<ServerBackend> {
    match platform {
        // One macOS archive carries Metal and CPU together; there is nothing
        // to choose, whatever detection said.
        Some(Platform::MacArm64) => vec![ServerBackend::Metal],
        // An Intel Mac has no engine row, so it has no candidate: the fork
        // publishes no x64 archive and upstream's x64 build ignores the
        // door's cache inlet. Reported, not improvised — see the asset
        // table's comment. Intel support is a deliberate future decision.
        Some(Platform::MacX64) => Vec::new(),
        Some(Platform::WindowsX64) => match detected {
            // No discrete GPU: CPU, full stop. Vulkan would only find the
            // same system RAM through a slower, heavier door.
            Backend::Cpu => vec![ServerBackend::Cpu],
            // NVIDIA or AMD, vendor unknown: Vulkan serves both and is cheap
            // to fetch; CUDA 12 stays behind it as the NVIDIA deepening,
            // tried only if Vulkan refuses (device below sm_50, or the
            // driver is older than 551.61, or the device init aborts).
            Backend::DiscreteGpu { .. } => {
                vec![
                    ServerBackend::Vulkan,
                    ServerBackend::Cuda12,
                    ServerBackend::Cpu,
                ]
            }
            // Detection learned nothing (wmic gone, or Metal on Windows):
            // the Vulkan build includes the CPU backend, so probing it costs
            // ~32 MB once and settles the question honestly.
            Backend::Metal | Backend::Unknown => vec![ServerBackend::Vulkan, ServerBackend::Cpu],
        },
        // No build is published for this platform. Reported, not improvised.
        None => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_apple_silicon_mac_runs_metal_and_considers_nothing_else() {
        assert_eq!(
            candidates_for(Some(Platform::MacArm64), Backend::Metal),
            vec![ServerBackend::Metal]
        );
        // Even a surprising detection changes nothing: the archive is the
        // same one archive either way.
        assert_eq!(
            candidates_for(Some(Platform::MacArm64), Backend::Unknown),
            vec![ServerBackend::Metal]
        );
    }

    #[test]
    fn an_intel_mac_is_offered_nothing_rather_than_an_engine_with_no_inlet() {
        assert!(candidates_for(Some(Platform::MacX64), Backend::Unknown).is_empty());
        assert!(candidates_for(Some(Platform::MacX64), Backend::Metal).is_empty());
        assert!(candidates_for(Some(Platform::MacX64), Backend::Cpu).is_empty());
    }

    #[test]
    fn every_candidate_the_planner_names_has_an_engine_row() {
        // The planner and the asset table are two statements of one fact,
        // and a candidate with no row fails at the store ("no executable")
        // instead of at the plan. Pinned here so deleting a row cannot leave
        // a candidate behind.
        for platform in [Platform::MacArm64, Platform::MacX64, Platform::WindowsX64] {
            for detected in [
                Backend::Cpu,
                Backend::Metal,
                Backend::Unknown,
                Backend::DiscreteGpu { vram_bytes: None },
            ] {
                for backend in candidates_for(Some(platform), detected) {
                    let rows = crate::assets::assets_for(platform, backend);
                    assert!(
                        rows.iter().any(|row| row.role == crate::assets::Role::Engine),
                        "{platform:?}/{backend:?} is planned but has no engine row"
                    );
                }
            }
        }
    }

    #[test]
    fn a_machine_without_a_discrete_gpu_gets_cpu_only() {
        assert_eq!(
            candidates_for(Some(Platform::WindowsX64), Backend::Cpu),
            vec![ServerBackend::Cpu]
        );
    }

    #[test]
    fn a_discrete_gpu_tries_the_cheap_gpu_build_before_the_heavy_one() {
        assert_eq!(
            candidates_for(
                Some(Platform::WindowsX64),
                Backend::DiscreteGpu {
                    vram_bytes: Some(8 << 30)
                }
            ),
            vec![
                ServerBackend::Vulkan,
                ServerBackend::Cuda12,
                ServerBackend::Cpu,
            ]
        );
    }

    #[test]
    fn cuda13_waits_until_detection_can_name_the_driver() {
        // CUDA 13 needs sm_75+ and a driver >= 580, and detection today
        // cannot check either. Putting it in the walk would have the probe
        // fetch 541 MB only to fail on machines CUDA 12 already failed on
        // for the same reason.
        let list = candidates_for(
            Some(Platform::WindowsX64),
            Backend::DiscreteGpu { vram_bytes: None },
        );
        assert!(!list.contains(&ServerBackend::Cuda13));
    }

    #[test]
    fn a_platform_with_no_build_gets_no_candidates() {
        assert!(candidates_for(None, Backend::Metal).is_empty());
        assert!(candidates_for(None, Backend::DiscreteGpu { vram_bytes: None }).is_empty());
    }

    #[test]
    fn this_mac_gets_metal_when_detection_says_metal() {
        if Platform::current() == Some(Platform::MacArm64) {
            assert_eq!(
                candidates_for(Platform::current(), Backend::Metal),
                vec![ServerBackend::Metal]
            );
        }
    }
}
