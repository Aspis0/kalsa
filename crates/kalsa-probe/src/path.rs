//! Which path a number describes, and which path this machine will run on.
//!
//! A bandwidth figure with no execution path attached is how a Mac owner would
//! have been told their machine was too slow for a model it runs fine: the probe
//! measured the CPU, llama.cpp would have decoded on the GPU, and nothing in the
//! output said which one it was talking about.
//!
//! Two different facts, kept apart on purpose:
//!
//! * [`ExecutionPath`] — what the numbers in a [`crate::Measurement`] were
//!   measured on. One variant today, because one path is measured today.
//! * [`Backend`] — what this machine offers, by detection only. Nothing here
//!   runs a GPU kernel; the point is that a CPU-only number is a **floor** for a
//!   machine with a usable GPU, and the caller can branch on that.

/// The path a measurement was taken on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutionPath {
    /// Streaming reads issued by this process's CPU threads, on a buffer larger
    /// than any cache.
    Cpu,
}

impl ExecutionPath {
    /// Said with every measurement: a figure that does not say what it measures
    /// is how the wrong answer got out the first time.
    pub fn note(&self) -> &'static str {
        match self {
            ExecutionPath::Cpu => {
                "Measured on the CPU only, reading a buffer larger than any cache. On a machine \
                 that will decode on a GPU this is a floor, not the machine's bandwidth."
            }
        }
    }
}

/// What this machine will actually run the model on, as far as detection goes.
///
/// Detection only: no GPU code lives here yet, and the variants are the ones the
/// detection can construct today.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Backend {
    /// No discrete GPU found: the CPU is the answer here, not a consolation
    /// prize. Old integrated GPUs read the same system memory at the same speed,
    /// and their Vulkan support frequently does not initialise at all.
    Cpu,
    /// Apple Silicon: unified memory, and llama.cpp decodes through Metal. The
    /// memory *budget* stays system RAM but the available bandwidth is the SoC's,
    /// several times what the CPU can reach.
    Metal,
    /// A discrete NVIDIA or AMD GPU is present. Its VRAM is the budget, not
    /// system RAM, and a model that does not fit entirely in VRAM is decoded
    /// part on the GPU and part on the CPU — which needs both bandwidths and the
    /// split to predict, not one number. `vram_bytes` is None when the platform
    /// cannot tell us honestly (Windows reports a 32-bit figure that saturates).
    DiscreteGpu { vram_bytes: Option<u64> },
    /// No cheap, honest way to find out on this machine.
    Unknown,
}

impl Backend {
    /// True when a model would run on something faster than the path we
    /// measured, so every prediction is a floor rather than a figure.
    ///
    /// This is data, not a sentence: the catalog has to branch on it.
    pub fn is_faster_than_cpu_measurement(&self) -> bool {
        matches!(self, Backend::Metal | Backend::DiscreteGpu { .. })
    }

    /// The honest sentence for the user, alongside the data.
    pub fn note(&self) -> &'static str {
        match self {
            Backend::Cpu => {
                "This machine has no discrete GPU, so the CPU figure above is what a model \
                 will get."
            }
            Backend::Metal => {
                "This Mac decodes on the GPU through Metal, whose bandwidth is the SoC's and \
                 several times the CPU figure above: treat the speed predictions as a floor."
            }
            Backend::DiscreteGpu {
                vram_bytes: Some(vram),
            } => {
                if *vram >= 1024 * 1024 * 1024 {
                    return "A discrete GPU is present, so decode will use its memory rather \
                            than system RAM; the CPU figure above is a floor.";
                }
                "A discrete GPU is present, so decode will use its memory rather than system \
                 RAM; the CPU figure above is a floor."
            }
            Backend::DiscreteGpu { vram_bytes: None } => {
                "A discrete GPU is present but its memory size could not be read honestly, so \
                 the CPU figure above is a floor and the GPU budget is unknown."
            }
            Backend::Unknown => {
                "This machine's GPU was not detected, so the CPU figure above is all we have: \
                 it may be a floor."
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_gpu_makes_the_cpu_figure_a_floor() {
        assert!(!Backend::Cpu.is_faster_than_cpu_measurement());
        assert!(Backend::Metal.is_faster_than_cpu_measurement());
        assert!(Backend::DiscreteGpu {
            vram_bytes: Some(8 << 30)
        }
        .is_faster_than_cpu_measurement());
        assert!(Backend::DiscreteGpu { vram_bytes: None }.is_faster_than_cpu_measurement());
        // Unknown is not a promise in either direction.
        assert!(!Backend::Unknown.is_faster_than_cpu_measurement());
    }

    #[test]
    fn every_backend_says_something_honest() {
        for backend in [
            Backend::Cpu,
            Backend::Metal,
            Backend::DiscreteGpu {
                vram_bytes: Some(8 << 30),
            },
            Backend::DiscreteGpu { vram_bytes: None },
            Backend::Unknown,
        ] {
            let note = backend.note();
            assert!(!note.is_empty());
            if backend.is_faster_than_cpu_measurement() {
                assert!(note.contains("floor"), "{note}");
            }
        }
        assert!(ExecutionPath::Cpu.note().contains("CPU"));
    }
}
