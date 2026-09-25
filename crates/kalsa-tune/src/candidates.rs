//! Which launches are worth measuring: the candidate list, lightest first.

use kalsa_launch::Offload;
use kalsa_runtime::ServerBackend;

/// One launch the tune may measure: which build, how many threads, how much
/// of the processor it frees. `threads: None` means the engine's own
/// default — no count was measured, and the tune does not invent one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub backend: ServerBackend,
    pub threads: Option<usize>,
    pub offload: Offload,
}

/// The offload a build gets: every GPU-capable build offloads all layers
/// (the launch policy's own default for a budget that accounted for the
/// memory it decodes from), and the CPU build has no GPU code to offload
/// with. Kept here because a candidate is decided here — the record
/// re-derives it on load rather than storing it, and this is the only
/// shape `candidates` has ever produced.
pub(crate) fn offload_for(backend: ServerBackend) -> Offload {
    if backend == ServerBackend::Cpu {
        Offload::NoGpuBuild
    } else {
        Offload::All
    }
}

/// The ordered, de-duplicated candidates: the graphics build first when one
/// answered its probe, then the processor runs ascending by threads.
///
/// Processor counts come only from what was measured or known — the rule's
/// count, the physical cores, the logical cores — each present value once.
/// Nothing is synthesised: a missing input narrows the list, it never
/// widens it.
pub fn candidates(
    gpu: Option<ServerBackend>,
    rule_threads: Option<usize>,
    physical_cores: Option<usize>,
    logical_cores: Option<usize>,
) -> Vec<Candidate> {
    // A CPU verdict is not a graphics candidate: there is no offload
    // decision left to make, only processor runs.
    let graphics = match gpu {
        Some(backend) if backend != ServerBackend::Cpu => Some(backend),
        _ => None,
    };
    let mut list = Vec::new();
    if let Some(backend) = graphics {
        list.push(Candidate {
            backend,
            // The rule's count, or physical when the rule gave none: the
            // same counts the rule itself would pick, never a new guess.
            threads: rule_threads.or(physical_cores),
            offload: offload_for(backend),
        });
    }
    // No processor runs under Metal: on Apple Silicon Metal reaches the
    // unified memory's bandwidth and the CPU does not (README: 110 vs a
    // marginal 197 GB/s), and there is no separate CPU build on the Mac
    // for a processor candidate to name.
    if !matches!(graphics, Some(ServerBackend::Metal)) {
        let mut counts = [rule_threads, physical_cores, logical_cores]
            .into_iter()
            .flatten()
            // Zero is the failed-read sentinel `thread_count` already
            // treats as unknown, not a count anyone measured.
            .filter(|count| *count > 0)
            .collect::<Vec<_>>();
        counts.sort_unstable();
        counts.dedup();
        for threads in counts {
            list.push(Candidate {
                backend: ServerBackend::Cpu,
                threads: Some(threads),
                offload: Offload::NoGpuBuild,
            });
        }
    }
    list
}

/// Whether measuring can change the answer at all: one candidate (or none)
/// is the rule's own answer already, and running a server to confirm the
/// only launch in town costs a rung to learn nothing.
pub fn needs_tuning(candidates: &[Candidate]) -> bool {
    candidates.len() > 1
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gpu(threads: usize) -> Candidate {
        Candidate {
            backend: ServerBackend::Vulkan,
            threads: Some(threads),
            offload: Offload::All,
        }
    }

    fn cpu(threads: usize) -> Candidate {
        Candidate {
            backend: ServerBackend::Cpu,
            threads: Some(threads),
            offload: Offload::NoGpuBuild,
        }
    }

    /// The Lenovo: a Vulkan verdict, the rule's 16 equal to the physical
    /// cores, 22 logical — graphics first, then 16 and 22, the rule's count
    /// kept once.
    #[test]
    fn the_lenovo_runs_the_graphics_first_then_the_processor_ascending() {
        let list = candidates(Some(ServerBackend::Vulkan), Some(16), Some(16), Some(22));
        assert_eq!(list, vec![gpu(16), cpu(16), cpu(22)]);
        assert!(needs_tuning(&list), "three launches differ: measuring can decide");
    }

    /// The Surface: no GPU verdict, 4 and 4 are the same count, 8 is a
    /// different one — each present value once, ascending.
    #[test]
    fn the_surface_counts_each_present_thread_count_once() {
        let list = candidates(None, Some(4), Some(4), Some(8));
        assert_eq!(list, vec![cpu(4), cpu(8)]);
        assert!(needs_tuning(&list), "two launches differ: measuring can decide");
    }

    /// The Mac: Metal, one candidate, no processor runs — and one candidate
    /// is visible in the API as "no tune needed" rather than a case the
    /// caller has to reinvent.
    #[test]
    fn metal_is_one_candidate_and_needs_no_tune() {
        let list = candidates(Some(ServerBackend::Metal), Some(8), Some(10), Some(10));
        assert_eq!(
            list,
            vec![Candidate {
                backend: ServerBackend::Metal,
                threads: Some(8),
                offload: Offload::All,
            }]
        );
        assert!(!needs_tuning(&list), "one launch: measuring it cannot change the answer");
    }
}
