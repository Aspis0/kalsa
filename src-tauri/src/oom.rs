//! Whether a native engine death was an out-of-memory one. The failure report
//! and the restart policy both read this, so they cannot disagree on it.

/// The shapes that mean the engine ran out of memory, in the words the
/// engine's own stderr and the Vulkan and allocator errors print them.
const SHAPES: &[&str] = &[
    "out of memory",
    "out_of_memory",
    "outofdevicememory",
    "vk_error_out_of_device_memory",
    "outofhostmemory",
    "vk_error_out_of_host_memory",
    "enomem",
    "bad_alloc",
];

pub(crate) fn is_out_of_memory(raw: &str) -> bool {
    let said = crate::logging::redact_str(raw).to_lowercase();
    SHAPES.iter().any(|shape| said.contains(shape))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_spelling_of_an_out_of_memory_death_is_recognised() {
        for raw in [
            "out of memory",
            "out_of_memory",
            "vk::OutOfDeviceMemoryError",
            "VK_ERROR_OUT_OF_DEVICE_MEMORY",
            "VK_ERROR_OUT_OF_HOST_MEMORY",
            "std::bad_alloc",
        ] {
            assert!(is_out_of_memory(raw), "{raw} must read as out-of-memory");
        }
    }

    #[test]
    fn other_deaths_are_not_out_of_memory() {
        assert!(!is_out_of_memory("the server stopped answering /health"));
        assert!(!is_out_of_memory("signal 11 (segmentation fault)"));
    }
}
