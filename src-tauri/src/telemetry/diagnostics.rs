use super::spec;
use regex::Regex;
use serde_json::{Map, Value, json};

fn matches(pattern: &str, text: &str) -> bool {
    Regex::new(pattern).is_ok_and(|re| re.is_match(text))
}

fn hardware(value: &Value, pattern: &str) -> Option<Value> {
    let raw = value.as_str()?;
    // Reject before cleaning too: clipping must never turn a poisoned adapter name into a valid one.
    if raw.len() > spec::HARDWARE_CHARS as usize
        || !raw.bytes().all(|b| (32..=126).contains(&b))
        || !matches(pattern, raw)
    {
        return None;
    }
    let clean = crate::system::clean_gathered(
        raw,
        spec::HARDWARE_CHARS as usize,
        &crate::system::host_name(),
    );
    matches(pattern, &clean).then_some(Value::String(clean))
}

fn ipv4(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    parts.len() == 4 && parts.iter().all(|part| part.parse::<u8>().is_ok())
}

pub(super) fn sanitize(input: &Value) -> Value {
    let mut out = Map::new();
    let Some(fields) = input.as_object() else {
        return Value::Object(out);
    };
    for (key, value) in fields {
        if let Some(allowed) = spec::values(key) {
            if value.as_str().is_some_and(|s| allowed.contains(&s)) {
                out.insert(key.clone(), value.clone());
            }
        }
    }
    for (key, min, max) in [
        ("exitCode", spec::EXIT_CODE_MIN, spec::EXIT_CODE_MAX),
        ("exitSignal", spec::EXIT_SIGNAL_MIN, spec::EXIT_SIGNAL_MAX),
    ] {
        if let Some(n) = fields
            .get(key)
            .and_then(Value::as_i64)
            .filter(|n| (min..=max).contains(n))
        {
            out.insert(key.into(), json!(n));
        }
    }
    if let Some(value) = fields.get("onBattery").filter(|v| v.is_boolean()) {
        out.insert("onBattery".into(), value.clone());
    }
    for (key, pattern) in [
        ("engineRelease", spec::ENGINE_RELEASE_PATTERN),
        ("cpuModel", spec::CPU_MODEL_PATTERN),
        ("gpuDriver", spec::GPU_DRIVER_PATTERN),
    ] {
        if let Some(value) = fields.get(key).and_then(|v| hardware(v, pattern)) {
            if key == "gpuDriver" && value.as_str().is_some_and(ipv4) {
                continue;
            }
            out.insert(key.into(), value);
        }
    }
    if let Some(pattern) = out
        .get("gpuVendor")
        .and_then(Value::as_str)
        .and_then(spec::gpu_pattern)
    {
        if let Some(value) = fields.get("gpuModel").and_then(|v| hardware(v, pattern)) {
            out.insert("gpuModel".into(), value);
        }
    }
    if let Some(value) = fields.get("signature").and_then(Value::as_str).filter(|s| {
        s.len() <= spec::SIGNATURE_CHARS as usize && matches(spec::SIGNATURE_PATTERN, s)
    }) {
        out.insert("signature".into(), json!(value));
    }
    if let Some(crumbs) = fields.get("breadcrumbs").and_then(Value::as_array) {
        let clean: Vec<Value> = crumbs
            .iter()
            .rev()
            .take(spec::BREADCRUMBS as usize)
            .rev()
            .filter_map(|crumb| {
                let mut entry = Map::new();
                for key in ["component", "stage", "sinceStart"] {
                    if let Some(s) = crumb
                        .get(key)
                        .and_then(Value::as_str)
                        .filter(|s| spec::values(key).is_some_and(|values| values.contains(s)))
                    {
                        entry.insert(key.into(), json!(s));
                    }
                }
                (entry.contains_key("component") && entry.contains_key("stage"))
                    .then_some(Value::Object(entry))
            })
            .collect();
        out.insert("breadcrumbs".into(), json!(clean));
    }
    Value::Object(out)
}
