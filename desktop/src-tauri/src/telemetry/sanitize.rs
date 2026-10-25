use regex::Regex;
use serde_json::{Value, json};

use super::spec;

const CODES: &[&str] = &[
    "engine.init",
    "chat.generation",
    "embed.native",
    "web.fetch",
    "web.search",
    "unknown",
];

fn matches(pattern: &str, text: &str) -> bool {
    Regex::new(pattern).is_ok_and(|re| re.is_match(text))
}

fn details(code: &str) -> &'static [&'static str] {
    match code {
        "engine.init" => &[
            "oom",
            "disk_full",
            "model_corrupt",
            "model_missing",
            "init_timeout",
            "native_crash",
            "unknown",
        ],
        "chat.generation" => &[
            "oom",
            "native_crash",
            "ctx_overflow",
            "stop_aborted",
            "unknown",
        ],
        "embed.native" => &[
            "oom",
            "model_corrupt",
            "native_crash",
            "gate_aborted",
            "unknown",
        ],
        "web.fetch" | "web.search" => &[
            "http_403",
            "http_404",
            "http_5xx",
            "dns",
            "tls",
            "timeout",
            "oom",
            "payload_too_large",
            "unknown",
        ],
        _ => &["unknown"],
    }
}

pub(super) fn report(input: &Value) -> Option<Value> {
    let platform = input.get("platform")?.as_str()?;
    if !["windows", "macos", "linux"].contains(&platform) {
        return None;
    }
    let version = input.get("appVersion")?.as_str()?;
    if version.len() > 32 || !matches(r"^\d+(\.\d+){1,3}[a-z0-9.-]*$", version) {
        return None;
    }
    let date = input.get("dateBucket")?.as_str()?;
    if !valid_date(date) {
        return None;
    }
    let code = input
        .pointer("/error/code")
        .and_then(Value::as_str)
        .filter(|s| CODES.contains(s))
        .unwrap_or("unknown");
    let mut error = json!({"code":code});
    if let Some(detail) = input
        .pointer("/error/detail")
        .and_then(Value::as_str)
        .filter(|s| details(code).contains(s))
    {
        error["detail"] = json!(detail);
    }
    if let Some(signal) = input
        .pointer("/error/signal")
        .and_then(Value::as_str)
        .filter(|s| super::signals::PATTERNS.iter().any(|(_, token)| token == s))
    {
        error["signal"] = json!(signal);
    }
    let mut context = json!({"modelCategory":"unknown"});
    if let Some(category) = input
        .pointer("/context/modelCategory")
        .and_then(Value::as_str)
        .filter(|s| ["dense.2b", "dense.4b", "moe", "unknown"].contains(s))
    {
        context["modelCategory"] = json!(category);
    }
    if let Some(phase) = input
        .pointer("/context/phase")
        .and_then(Value::as_str)
        .filter(|s| ["download", "load", "turn", "embed", "flush"].contains(s))
    {
        context["phase"] = json!(phase);
    }
    if let Some(n) = input
        .pointer("/context/attempt")
        .and_then(Value::as_u64)
        .filter(|n| (1..=5).contains(n))
    {
        context["attempt"] = json!(n);
    }
    let bucket = input
        .get("deviceBucket")
        .and_then(Value::as_str)
        .filter(|s| ["low", "mid", "high"].contains(s))
        .unwrap_or("low");
    let os = input
        .get("osMajor")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 8 && s.bytes().all(|b| b.is_ascii_digit()))
        .unwrap_or("0");
    let mut diag = super::diagnostics::sanitize(&input["diagnostics"]);
    if diag
        .get("osFamily")
        .is_some_and(|family| family != platform)
    {
        diag.as_object_mut()?.remove("osFamily");
    }
    let report = json!({"v":2,"app":"kalsa","appVersion":version,"platform":platform,"deviceBucket":bucket,"osMajor":os,"error":error,"context":context,"dateBucket":date,"manual":false,"diagnostics":diag});
    (serde_json::to_vec(&report).ok()?.len() <= spec::BODY_BYTES as usize).then_some(report)
}

fn valid_date(date: &str) -> bool {
    if !matches(r"^\d{4}-\d{2}-\d{2}$", date) {
        return false;
    }
    let y = date[..4].parse::<u32>().unwrap_or(0);
    if y < 100 {
        return false;
    }
    let m = date[5..7].parse::<usize>().unwrap_or(0);
    let d = date[8..].parse::<u32>().unwrap_or(0);
    let days = [
        31,
        if y.is_multiple_of(4) && (!y.is_multiple_of(100) || y.is_multiple_of(400)) {
            29
        } else {
            28
        },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    (1..=12).contains(&m) && d > 0 && d <= days[m - 1]
}

pub(super) fn fingerprint(report: &Value) -> String {
    let parts: Vec<&str> = [
        "/error/code",
        "/error/detail",
        "/error/signal",
        "/appVersion",
        "/deviceBucket",
        "/context/modelCategory",
        "/dateBucket",
        "/diagnostics/component",
        "/diagnostics/stage",
        "/diagnostics/signature",
        "/diagnostics/backend",
    ]
    .iter()
    .map(|p| report.pointer(p).and_then(Value::as_str).unwrap_or(""))
    .collect();
    let mut hash = 0xcbf29ce484222325u64;
    for unit in parts.join("|").encode_utf16() {
        hash = (hash ^ u64::from(unit)).wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
