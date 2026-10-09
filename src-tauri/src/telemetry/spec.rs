// Generated from workers/telemetry/contract-v2.ts; regenerate with dev/generate-telemetry-spec.mjs.
pub(super) fn values(key: &str) -> Option<&'static [&'static str]> {
    match key {
        "component" => Some(&[
            "engine",
            "door",
            "supervisor",
            "tune",
            "download",
            "room",
            "pairing",
            "web",
            "ui",
            "governor",
            "slots",
        ]),
        "stage" => Some(&[
            "load",
            "slot_restore",
            "prefill",
            "decode",
            "tool_call",
            "save",
            "wake",
            "stop",
            "download",
            "tune_measure",
            "other",
        ]),
        "backend" => Some(&["metal", "vulkan", "cuda", "cpu", "opencl", "unknown"]),
        "offload" => Some(&["gpu", "cpu", "mixed"]),
        "modelId" => Some(&[
            "2cba59c35d6c921d",
            "5aa3a7df6a68207f",
            "6cf2d69e925c832b",
            "abba3efbfbb7c48d",
            "c006505c9066c0b2",
            "c35de93deed24278",
            "c83a23693c5a5f28",
            "d555925adf131c6e",
            "ec36bdb5993373f7",
            "ee5739cd230cd118",
            "lfm2.5-2.6b",
            "multilingual-e5-small",
            "qwen3.5-4b",
            "whisper-tiny",
        ]),
        "thermal" => Some(&["nominal", "fair", "serious", "critical", "unknown"]),
        "osFamily" => Some(&["windows", "macos", "linux", "android", "ios"]),
        "arch" => Some(&["x86_64", "aarch64", "x86", "arm", "unknown"]),
        "gpuVendor" => Some(&[
            "apple", "nvidia", "amd", "intel", "qualcomm", "arm", "other",
        ]),
        "ramUse" => Some(&["0-50", "50-75", "75-90", "90+"]),
        "cpuLoad" => Some(&["0-50", "50-75", "75-90", "90+"]),
        "freeRam" => Some(&["lt-1gb", "1-4gb", "4-8gb", "ge-8gb"]),
        "ctxTokens" => Some(&["lt-4k", "4-16k", "16-64k", "ge-64k"]),
        "promptTokens" => Some(&["lt-512", "512-2k", "2-8k", "ge-8k"]),
        "tokensPerSecond" => Some(&["lt-1", "1-10", "10-30", "ge-30"]),
        "sinceStart" => Some(&["lt-10s", "10-60s", "1-10m", "ge-10m"]),
        _ => None,
    }
}
pub(super) fn bucket(key: &str, value: f64) -> Option<&'static str> {
    match key {
        "ramUse" => Some(if value < 50.0 {
            "0-50"
        } else if value < 75.0 {
            "50-75"
        } else if value < 90.0 {
            "75-90"
        } else {
            "90+"
        }),
        "cpuLoad" => Some(if value < 50.0 {
            "0-50"
        } else if value < 75.0 {
            "50-75"
        } else if value < 90.0 {
            "75-90"
        } else {
            "90+"
        }),
        "freeRam" => Some(if value < 1073741824.0 {
            "lt-1gb"
        } else if value < 4294967296.0 {
            "1-4gb"
        } else if value < 8589934592.0 {
            "4-8gb"
        } else {
            "ge-8gb"
        }),
        "ctxTokens" => Some(if value < 4096.0 {
            "lt-4k"
        } else if value < 16384.0 {
            "4-16k"
        } else if value < 65536.0 {
            "16-64k"
        } else {
            "ge-64k"
        }),
        "promptTokens" => Some(if value < 512.0 {
            "lt-512"
        } else if value < 2048.0 {
            "512-2k"
        } else if value < 8192.0 {
            "2-8k"
        } else {
            "ge-8k"
        }),
        "tokensPerSecond" => Some(if value < 1.0 {
            "lt-1"
        } else if value < 10.0 {
            "1-10"
        } else if value < 30.0 {
            "10-30"
        } else {
            "ge-30"
        }),
        "sinceStart" => Some(if value < 10.0 {
            "lt-10s"
        } else if value < 60.0 {
            "10-60s"
        } else if value < 600.0 {
            "1-10m"
        } else {
            "ge-10m"
        }),
        "deviceBucket" => Some(if value < 17179869184.0 {
            "low"
        } else if value < 34359738368.0 {
            "mid"
        } else {
            "high"
        }),
        _ => None,
    }
}
pub(super) fn gpu_pattern(vendor: &str) -> Option<&'static str> {
    match vendor {
        "intel" => Some(
            r#"^(Intel\(R\) )?(Iris(\(R\))?( Xe)?( Plus)?( Graphics)?( [0-9]{3,4})?|UHD( Graphics)?( [0-9]{3,4})?|HD( Graphics)?( [0-9]{3,4})?|Arc(\(TM\))? [AB][0-9]{3}( Graphics)?)$"#,
        ),
        "amd" => Some(
            r#"^(AMD )?Radeon(\(TM\))? (RX [0-9]{3,4}( XT| XTX| GRE)?|[0-9]{3,4}M|Pro [A-Z]?[0-9]{3,4}(X)?|Graphics)$"#,
        ),
        "nvidia" => Some(
            r#"^NVIDIA (GeForce (RTX|GTX|GT) [0-9]{3,4}( Ti| SUPER)?( Laptop GPU)?|RTX [A-Z]?[0-9]{3,4}( Ada Generation)?|Quadro [A-Z]?[0-9]{3,4}|Tesla [A-Z][0-9]{2,3})$"#,
        ),
        "apple" => Some(r#"^Apple M[1-9][0-9]?( Pro| Max| Ultra)?$"#),
        "qualcomm" => Some(r#"^(Qualcomm )?Adreno(\(TM\))?( [0-9]{3,4}| X1-[0-9]{2})$"#),
        "arm" => Some(r#"^Mali-[GT][0-9]{2,3}( MP[0-9]{1,2})?$"#),
        _ => None,
    }
}
pub(super) const CPU_MODEL_PATTERN: &str = r#"^(Intel(\(R\))? (Core(\(TM\))? (i[3579]-[0-9]{4,5}[A-Z]{0,3}|Ultra [3579] [0-9]{3}[A-Z]{0,2})|Celeron(\(R\))? [A-Z]?[0-9]{3,4}[A-Z]?|Pentium(\(R\))?( Gold| Silver)? [A-Z]?[0-9]{3,4}[A-Z]?)|AMD Ryzen [3579] [0-9]{4}[A-Z]{0,3}( [0-9]{1,2}-Core Processor)?|Apple M[1-9][0-9]?( Pro| Max| Ultra)?|(Qualcomm )?Snapdragon ([4-8](\+)? Gen [1-9]|X (Elite|Plus))|A[0-9]{2}( Pro| Bionic)?)$"#;
pub(super) const GPU_DRIVER_PATTERN: &str = r#"^[0-9]{1,10}(\.[0-9]{1,10}){1,5}$"#;
pub(super) const SIGNATURE_PATTERN: &str = r#"^(GGML_ASSERT (ggml|ggml-vulkan|ggml-metal|ggml-cuda|ggml-opencl|ggml-backend|llama|llama-context|server-context|server-slot)\.(cpp|c|m|cu):[0-9]{1,7}|vk::(DeviceLostError|OutOfDeviceMemoryError|OutOfHostMemoryError|InitializationFailedError)|CUDA error|out of memory|segmentation fault)$"#;
pub(super) const ASSERT_LOCATION_PATTERN: &str = r#"(?:^|[/\\\s])(ggml(?:-vulkan|-metal|-cuda|-opencl|-backend)?|llama(?:-context)?|server-(?:context|slot))\.(cpp|c|m|cu):([0-9]{1,7})\b"#;
pub(super) const ENGINE_ERROR_PATTERN: &str = r#"\bvk::(?:DeviceLostError|OutOfDeviceMemoryError|OutOfHostMemoryError|InitializationFailedError)\b|\bCUDA error\b|\bout of memory\b|\bsegmentation fault\b"#;
pub(super) const ENGINE_RELEASE_PATTERN: &str = r#"^v\d+\.\d+\.\d+$"#;
pub(super) const BODY_BYTES: i64 = 4096;
pub(super) const SIGNATURE_CHARS: i64 = 80;
pub(super) const HARDWARE_CHARS: i64 = 80;
pub(super) const BREADCRUMBS: i64 = 8;
pub(super) const EXIT_CODE_MIN: i64 = -2147483648;
pub(super) const EXIT_CODE_MAX: i64 = 4294967295;
pub(super) const EXIT_SIGNAL_MIN: i64 = 1;
pub(super) const EXIT_SIGNAL_MAX: i64 = 127;
