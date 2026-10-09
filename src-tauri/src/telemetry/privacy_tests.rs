use super::{sanitize, spec};
use serde_json::{Value, json};

pub(super) fn sample() -> Value {
    sanitize::report(&json!({"appVersion":"0.0.1","platform":"linux","deviceBucket":"high","osMajor":"6","dateBucket":"2026-10-09","error":{"code":"engine.init","detail":"native_crash"},"context":{"modelCategory":"moe","phase":"turn"},"diagnostics":{"component":"engine","stage":"prefill","backend":"vulkan","offload":"gpu","engineRelease":"v1.1.5","modelId":"d555925adf131c6e","ramUse":"75-90","freeRam":"1-4gb","cpuLoad":"90+","thermal":"unknown","ctxTokens":"16-64k","promptTokens":"2-8k","sinceStart":"10-60s","osFamily":"linux","arch":"x86_64","gpuVendor":"amd","gpuModel":"AMD Radeon RX 7900 XTX","gpuDriver":"24.2.1","cpuModel":"AMD Ryzen 9 7950X 16-Core Processor","exitSignal":6,"signature":"GGML_ASSERT ggml-vulkan.cpp:1234","breadcrumbs":[{"component":"engine","stage":"load","sinceStart":"lt-10s"},{"component":"engine","stage":"prefill","sinceStart":"10-60s"}]}})).unwrap()
}

#[test]
fn canaries_never_enter_any_payload_field() {
    for canary in [
        "192.168.0.1",
        "127.0.0.1",
        "USER-TEXT-CANARY",
        "/Users/PRIVATE-CANARY/model.gguf",
        "https://SECRET-CANARY.example/query",
        "PRIVATE-HOST-CANARY.local",
        "C:\\private\\MODEL-CANARY.gguf",
    ] {
        let mut input = sample();
        input["unknown"] = json!(canary);
        input["error"] = json!({"code":canary,"detail":canary,"signal":canary,"message":canary});
        input["context"] = json!({"phase":canary,"modelCategory":canary,"url":canary});
        input["diagnostics"] = json!({"component":canary,"stage":canary,"backend":canary,"offload":canary,"engineRelease":canary,"modelId":canary,"osFamily":canary,"arch":canary,"gpuVendor":canary,"gpuModel":canary,"gpuDriver":canary,"cpuModel":canary,"signature":canary,"ramUse":canary,"freeRam":canary,"cpuLoad":canary,"thermal":canary,"ctxTokens":canary,"promptTokens":canary,"tokensPerSecond":canary,"sinceStart":canary,"exitCode":canary,"exitSignal":canary,"onBattery":canary,"breadcrumbs":[{"component":canary,"stage":canary,"sinceStart":canary,"text":canary}]});
        let payload = sanitize::report(&input).unwrap();
        assert!(!payload.to_string().contains(canary));
        assert_eq!(payload["diagnostics"], json!({"breadcrumbs":[]}));
        for key in ["platform", "appVersion", "dateBucket"] {
            let mut invalid = sample();
            // Four-part app versions remain valid in the v1 base contract.
            if key == "appVersion" && ["192.168.0.1", "127.0.0.1"].contains(&canary) {
                continue;
            }
            invalid[key] = json!(canary);
            assert!(sanitize::report(&invalid).is_none());
        }
        for key in ["deviceBucket", "osMajor"] {
            let mut invalid = sample();
            invalid[key] = json!(canary);
            assert!(
                !sanitize::report(&invalid)
                    .unwrap()
                    .to_string()
                    .contains(canary)
            );
        }
    }
}

#[test]
fn signatures_keep_only_known_basename_and_source_line() {
    assert_eq!(
        super::signals::signature(
            "GGML_ASSERT /Users/PRIVATE-CANARY/src/ggml-vulkan.cpp:1234: bad buffer 987 USER-TEXT-CANARY"
        ),
        Some("GGML_ASSERT ggml-vulkan.cpp:1234".into())
    );
    assert_eq!(
        super::signals::signature(
            "/Users/PRIVATE-CANARY/src/ggml-vulkan.cpp:1234: GGML_ASSERT failed for 9000"
        ),
        Some("GGML_ASSERT ggml-vulkan.cpp:1234".into())
    );
    assert_eq!(
        super::signals::signature("vk::DeviceLostError at https://SECRET-CANARY.example 9000"),
        Some("vk::DeviceLostError".into())
    );
    assert!(super::signals::signature("GGML_ASSERT /Users/x/MODEL-CANARY.gguf:1234").is_none());
    assert!(super::signals::signature("PRIVATE-HOST-CANARY.local USER-TEXT-CANARY").is_none());
}

#[test]
fn hardware_poisoned_suffixes_and_paths_are_rejected() {
    for vendor in ["intel", "amd", "nvidia", "apple", "qualcomm"] {
        let name = match vendor {
            "intel" => "Intel(R) Arc A770",
            "amd" => "AMD Radeon RX 7900 XTX",
            "nvidia" => "NVIDIA GeForce RTX 4090",
            "apple" => "Apple M3 Pro",
            _ => "Qualcomm Adreno 740",
        };
        let clean = super::diagnostics::sanitize(
            &json!({"gpuVendor":vendor,"gpuModel":name,"gpuDriver":"32.0.101.1234"}),
        );
        assert_eq!(clean["gpuModel"], name);
        for suffix in [
            " PRIVATE-HOST-CANARY.local",
            " /Users/PRIVATE-CANARY",
            " https://SECRET-CANARY.example",
            " MODEL-CANARY.gguf",
            " USER-TEXT-CANARY",
        ] {
            let bad = super::diagnostics::sanitize(
                &json!({"gpuVendor":vendor,"gpuModel":format!("{name}{suffix}"),"gpuDriver":format!("32.0{suffix}"),"cpuModel":format!("Apple M3 Pro{suffix}")}),
            );
            assert!(bad.get("gpuModel").is_none());
            assert!(bad.get("gpuDriver").is_none());
            assert!(bad.get("cpuModel").is_none());
        }
    }
    for name in [
        "Intel Core i7-13700K",
        "AMD Ryzen 9 7950X 16-Core Processor",
        "Apple M3 Max",
        "Snapdragon 8 Gen 2",
        "A17 Pro",
    ] {
        assert_eq!(
            super::diagnostics::sanitize(&json!({"cpuModel":name}))["cpuModel"],
            name
        );
    }
}

#[test]
fn buckets_and_breadcrumbs_are_bounded() {
    assert_eq!(
        spec::bucket("deviceBucket", (16u64 << 30) as f64),
        Some("mid")
    );
    assert_eq!(spec::bucket("ramUse", 90.0), Some("90+"));
    let crumbs: Vec<Value> = (0..15)
        .map(|_| json!({"component":"engine","stage":"prefill","timestamp":12345}))
        .collect();
    let d = super::diagnostics::sanitize(
        &json!({"breadcrumbs":crumbs,"exitCode":1.5,"exitSignal":128}),
    );
    assert_eq!(d["breadcrumbs"].as_array().unwrap().len(), 8);
    assert!(!d.to_string().contains("timestamp"));
    assert!(d.get("exitCode").is_none());
    assert!(d.get("exitSignal").is_none());
}

#[test]
fn sample_prefill_crash_is_v2_and_under_soft_limit() {
    let sample = sample();
    assert_eq!(sample["v"], 2);
    assert!(sample.to_string().len() < spec::BODY_BYTES as usize);
    if let Ok(path) = std::env::var("KALSA_TELEMETRY_SAMPLE") {
        std::fs::write(path, sample.to_string()).unwrap();
    }
}

#[test]
fn date_and_fingerprint_are_stable() {
    assert_eq!(super::resources::date(0), "1970-01-01");
    assert_eq!(super::resources::date(1791504000), "2026-10-09");
    let mut bad = sample();
    bad["dateBucket"] = json!("2026-02-29");
    assert!(sanitize::report(&bad).is_none());
    assert_eq!(
        sanitize::fingerprint(&sample()),
        sanitize::fingerprint(&sample())
    );
}

#[test]
fn public_catalog_ids_match_shared_contract() {
    let allowed = spec::values("modelId").unwrap();
    for row in kalsa_catalog::rows().chain(
        kalsa_catalog::DOWNLOADABLE
            .iter()
            .filter_map(|entry| entry.q8.as_ref().map(|q8| &q8.model)),
    ) {
        assert!(
            allowed.contains(&crate::startup::model_token(row).as_str()),
            "missing public model {}",
            crate::startup::model_token(row)
        );
    }
}

#[test]
fn drivers_exclude_ipv4_but_keep_intel_versions_and_future_releases() {
    for address in ["192.168.0.1", "127.0.0.1", "255.255.255.255", "0.0.0.0"] {
        assert!(
            super::diagnostics::sanitize(&json!({"gpuDriver": address}))
                .get("gpuDriver")
                .is_none()
        );
    }
    let clean = super::diagnostics::sanitize(
        &json!({"gpuDriver":"31.0.101.5186", "engineRelease":"v9.2.3"}),
    );
    assert_eq!(clean["gpuDriver"], "31.0.101.5186");
    assert_eq!(clean["engineRelease"], "v9.2.3");
    assert!(
        super::diagnostics::sanitize(&json!({"engineRelease":"v9.2.3-extra"}))
            .get("engineRelease")
            .is_none()
    );
}

#[test]
fn a_contract_log_reference_survives_the_sanitizer_and_a_broken_one_does_not() {
    let mut report = sample();
    report["diagnostics"]["logRef"] = json!("2026-10-09/K7XQ2M9P");
    let kept = sanitize::report(&report).unwrap();
    assert_eq!(kept["diagnostics"]["logRef"], "2026-10-09/K7XQ2M9P");
    for broken in [
        // Lowercase is off the id alphabet.
        "2026-10-09/k7xq2m9p",
        // Zero is off it too.
        "2026-10-09/K7XQ2M90",
        // The id is short.
        "2026-10-09/K7XQ2M9",
        // The day is not a date.
        "yesterday/K7XQ2M9P",
        // A path instead of a reference.
        "../../K7XQ2M9P/K7XQ2M9P",
    ] {
        report["diagnostics"]["logRef"] = json!(broken);
        let cleaned = sanitize::report(&report).unwrap();
        assert!(
            cleaned["diagnostics"].get("logRef").is_none(),
            "{broken} must not survive: {cleaned}"
        );
    }
}
