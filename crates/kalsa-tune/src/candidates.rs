//! Which launches are worth measuring: the candidate list, lightest first.

use kalsa_launch::Offload;
use kalsa_runtime::ServerBackend;

/// One launch the tune may measure: which build, how many threads, what
/// offload. `threads: None` means the engine's own default — no count was
/// measured, and the tune does not invent one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub backend: ServerBackend,
    pub threads: Option<usize>,
    pub offload: Offload,
}

/// The offload a graphics candidate gets: no flag at all, so the engine
/// fits its layers to the memory that is actually free at this start (the
/// variant's own doc carries the engine sources). The record stores the
/// offload rather than re-deriving it, because a processor run on the Mac
/// is the Metal build with the offload forced off — not a function of the
/// backend alone.
pub(crate) fn offload_for(backend: ServerBackend) -> Offload {
    if backend == ServerBackend::Cpu {
        Offload::NoGpuBuild
    } else {
        Offload::EngineFitted
    }
}

/// The ordered, de-duplicated candidates: the graphics build first when one
/// answered its probe, then the processor runs ascending by threads.
///
/// Counts come only from what was measured or known — the rule's count,
/// the physical cores, the logical cores — each present value once.
/// Nothing is synthesised: a missing input narrows the list, it never
/// widens it.
pub fn candidates(
    gpu: Option<ServerBackend>,
    rule_threads: Option<usize>,
    physical_cores: Option<usize>,
    logical_cores: Option<usize>,
) -> Vec<Candidate> {
    // A count of zero is a read that measured nothing — unknown, exactly
    // like `None`, everywhere below. The rule can hand one back: its
    // `thread_count` caps a zero plateau rather than filtering it, and the
    // graphics candidate must not render `--threads 0` while the processor
    // list drops it.
    let rule_threads = rule_threads.filter(|count| *count > 0);
    let physical_cores = physical_cores.filter(|count| *count > 0);
    let logical_cores = logical_cores.filter(|count| *count > 0);
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
    // The processor runs, measured rather than assumed (the owner's
    // ruling): on Metal it is the SAME build with the offload forced off —
    // `--n-gpu-layers 0` on the one macOS archive, which carries Metal and
    // CPU together — and elsewhere the CPU build with no GPU flag at all.
    let processor = match graphics {
        Some(ServerBackend::Metal) => Candidate {
            backend: ServerBackend::Metal,
            threads: None,
            offload: Offload::ForcedOff,
        },
        _ => Candidate {
            backend: ServerBackend::Cpu,
            threads: None,
            offload: Offload::NoGpuBuild,
        },
    };
    let mut counts = [rule_threads, physical_cores, logical_cores]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    counts.sort_unstable();
    counts.dedup();
    for threads in counts {
        list.push(Candidate { threads: Some(threads), ..processor });
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
            offload: Offload::EngineFitted,
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

    /// The Mac, measured rather than assumed: the Metal build with no
    /// offload flag (the engine fits its layers), then the same build with
    /// the offload forced off at each known count — three launches, so the
    /// tune runs.
    #[test]
    fn metal_measures_engine_fitted_and_forced_off() {
        let list = candidates(Some(ServerBackend::Metal), Some(8), Some(10), Some(10));
        assert_eq!(
            list,
            vec![
                Candidate {
                    backend: ServerBackend::Metal,
                    threads: Some(8),
                    offload: Offload::EngineFitted,
                },
                Candidate {
                    backend: ServerBackend::Metal,
                    threads: Some(8),
                    offload: Offload::ForcedOff,
                },
                Candidate {
                    backend: ServerBackend::Metal,
                    threads: Some(10),
                    offload: Offload::ForcedOff,
                },
            ]
        );
        assert!(needs_tuning(&list), "three launches: measuring can decide");
    }

    /// A zero count is unknown everywhere — including the graphics
    /// candidate, whose count comes from the rule the same way: the rule
    /// caps rather than filters, so `Some(0)` can arrive and must not
    /// become `--threads 0`.
    #[test]
    fn a_zero_count_is_unknown_to_every_candidate() {
        let zero_rule = candidates(Some(ServerBackend::Vulkan), Some(0), Some(16), Some(32));
        assert_eq!(zero_rule[0].threads, Some(16), "zero rule falls to the physical count");
        assert!(
            zero_rule.iter().all(|candidate| candidate.threads != Some(0)),
            "no candidate may carry a count nobody measured: {zero_rule:?}"
        );

        let all_zero = candidates(Some(ServerBackend::Vulkan), Some(0), Some(0), Some(0));
        assert_eq!(all_zero[0].threads, None, "zero and None are alike: unknown");
        assert!(all_zero.iter().all(|candidate| candidate.threads != Some(0)));
    }
}
