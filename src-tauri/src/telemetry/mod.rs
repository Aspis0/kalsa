pub(crate) mod commands;
#[cfg(test)]
mod consent_tests;
pub(crate) mod context;
mod diagnostics;
pub(crate) mod events;
mod network;
#[cfg(test)]
mod privacy_tests;
mod resources;
mod sanitize;
mod signals;
mod spec;
mod store;

use kalsa_supervisor::{Failure, ServerState};
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

static SERVICE: OnceLock<Arc<Service>> = OnceLock::new();

struct Inner {
    store: store::Store,
    epoch: u64,
    recent: VecDeque<String>,
    breadcrumbs: VecDeque<Value>,
    base: Value,
    category: &'static str,
    total_ram: u64,
    cpu: resources::Cpu,
    resource_snapshot: Value,
    started: Option<Instant>,
    last_state: Option<ServerState>,
    last_failure: Option<Failure>,
    engine_stage: &'static str,
}

struct Service {
    inner: Mutex<Inner>,
    send_gate: Mutex<()>,
}

pub(crate) fn init(dir: &Path) {
    let service = Arc::new(Service {
        inner: Mutex::new(Inner {
            store: store::Store::load(dir.join("telemetry")),
            epoch: 0,
            recent: VecDeque::new(),
            breadcrumbs: VecDeque::new(),
            base: json!({"osFamily":std::env::consts::OS,"arch":std::env::consts::ARCH}),
            category: "unknown",
            total_ram: crate::startup::ram_bytes(),
            cpu: resources::Cpu::default(),
            resource_snapshot: json!({}),
            started: None,
            last_state: None,
            last_failure: None,
            engine_stage: "load",
        }),
        send_gate: Mutex::new(()),
    });
    if SERVICE.set(Arc::clone(&service)).is_ok() {
        network::start(service);
    }
}

pub(crate) fn transition(component: &'static str, stage: &'static str) {
    if !spec::values("component").is_some_and(|v| v.contains(&component))
        || !spec::values("stage").is_some_and(|v| v.contains(&stage))
    {
        return;
    }
    let Some(service) = SERVICE.get() else {
        return;
    };
    if let Ok(mut inner) = service.inner.lock() {
        if component == "engine" {
            inner.engine_stage = stage;
            if matches!(stage, "prefill" | "load") {
                inner.base.as_object_mut().unwrap().remove("promptTokens");
            }
            if matches!(stage, "prefill" | "decode" | "load") {
                inner
                    .base
                    .as_object_mut()
                    .unwrap()
                    .remove("tokensPerSecond");
            }
        }
        if !inner.store.enabled {
            return;
        }
        let mut crumb = json!({"component":component,"stage":stage});
        if let Some(started) = inner.started {
            crumb["sinceStart"] =
                json!(spec::bucket("sinceStart", started.elapsed().as_secs_f64()));
        }
        if inner.breadcrumbs.back() != Some(&crumb) {
            inner.breadcrumbs.push_back(crumb);
        }
        while inner.breadcrumbs.len() > spec::BREADCRUMBS as usize {
            inner.breadcrumbs.pop_front();
        }
    }
}

pub(crate) fn starting() {
    let Some(service) = SERVICE.get() else {
        return;
    };
    if let Ok(mut inner) = service.inner.lock() {
        inner.last_failure = None;
        inner.last_state = None;
        inner.engine_stage = "load";
        inner.started = Some(Instant::now());
    }
}

pub(crate) fn observe(state: &ServerState) {
    let Some(service) = SERVICE.get() else {
        return;
    };
    let stage = {
        let Ok(mut inner) = service.inner.lock() else {
            return;
        };
        if inner.store.enabled && !matches!(state, ServerState::Failed { .. }) {
            inner.cpu.sample();
            inner.resource_snapshot = resources::memory(inner.total_ram, &inner.cpu);
        }
        if inner.last_state.as_ref() == Some(state) {
            return;
        }
        inner.last_state = Some(state.clone());
        if matches!(state, ServerState::Starting) {
            inner.last_failure = None;
            inner.started = Some(Instant::now());
            inner.engine_stage = "load";
        }
        inner.engine_stage
    };
    match state {
        ServerState::Starting => transition("engine", "load"),
        ServerState::Running { .. } => transition("supervisor", "other"),
        ServerState::Stopping => transition("supervisor", "stop"),
        ServerState::Stopped => transition("supervisor", "other"),
        ServerState::Failed { reason } => supervisor_failure(reason, stage),
    }
}

fn claim_failure(previous: &mut Option<Failure>, failure: &Failure) -> bool {
    if previous.as_ref() == Some(failure) {
        return false;
    }
    *previous = Some(failure.clone());
    true
}

pub(crate) fn supervisor_failure(reason: &Failure, stage: &str) {
    let (detail, raw, extra) = match reason {
        Failure::ServerExited {
            detail,
            exit_code,
            exit_signal,
        } => (
            crash_detail(detail),
            detail.as_str(),
            json!({"exitCode":exit_code,"exitSignal":exit_signal}),
        ),
        Failure::ServerNotStarted { detail } => ("unknown", detail.as_str(), json!({})),
        Failure::NotReady { .. } => ("init_timeout", "", json!({})),
        _ => return,
    };
    let Some(service) = SERVICE.get() else {
        return;
    };
    let stage = {
        let Ok(mut inner) = service.inner.lock() else {
            return;
        };
        if !inner.store.enabled || !claim_failure(&mut inner.last_failure, reason) {
            return;
        }
        if stage == "load" {
            inner.engine_stage
        } else {
            stage
        }
    };
    // A death while a turn was running failed the user's answer, not the
    // engine's start; the stage the report already carries says which.
    let code = if matches!(stage, "prefill" | "decode" | "tool_call") {
        "chat.generation"
    } else {
        "engine.init"
    };
    let phase = if matches!(stage, "prefill" | "decode" | "slot_restore" | "tool_call") {
        "turn"
    } else {
        "load"
    };
    record(code, "engine", stage, phase, detail, raw, extra);
}

fn crash_detail(raw: &str) -> &'static str {
    if crate::oom::is_out_of_memory(raw) {
        "oom"
    } else {
        "native_crash"
    }
}

pub(crate) fn record(
    code: &str,
    component: &str,
    stage: &str,
    phase: &str,
    detail: &str,
    raw: &str,
    extra: Value,
) {
    let Some(service) = SERVICE.get() else {
        return;
    };
    let Ok(mut inner) = service.inner.lock() else {
        return;
    };
    if !inner.store.enabled {
        return;
    }
    let mut diag = inner.base.clone();
    diag.as_object_mut()
        .unwrap()
        .extend(inner.resource_snapshot.as_object().unwrap().clone());
    if let Some(extra) = extra.as_object() {
        diag.as_object_mut().unwrap().extend(extra.clone());
    }
    diag["component"] = json!(component);
    diag["stage"] = json!(stage);
    diag["breadcrumbs"] = json!(inner.breadcrumbs);
    if let Some(started) = inner.started {
        diag["sinceStart"] = json!(spec::bucket("sinceStart", started.elapsed().as_secs_f64()));
    }
    if let Some(signature) = signals::signature(raw).map(|s| crate::logging::redact_str(&s)) {
        diag["signature"] = json!(signature);
    }
    let report = json!({"appVersion":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"osMajor":inner.base["osMajor"].as_str().unwrap_or("0"),"deviceBucket":spec::bucket("deviceBucket",inner.total_ram as f64),"dateBucket":resources::date(now()),"error":{"code":code,"detail":detail,"signal":signals::signal(raw)},"context":{"modelCategory":inner.category,"phase":phase},"diagnostics":diag});
    let Some(report) = sanitize::report(&report) else {
        return;
    };
    let fp = sanitize::fingerprint(&report);
    if inner.recent.contains(&fp) {
        return;
    }
    inner.recent.push_back(fp);
    if inner.recent.len() > 32 {
        inner.recent.pop_front();
    }
    inner.store.enqueue(report);
    if inner.store.save().is_err() {
        inner.store.enabled = false;
        inner.store.queue.clear();
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod failure_tests {
    #[test]
    fn a_crash_is_claimed_once_until_the_next_launch() {
        let reason = kalsa_supervisor::Failure::ServerExited {
            detail: "vk::DeviceLostError".into(),
            exit_code: None,
            exit_signal: Some(6),
        };
        let mut previous = None;
        assert!(super::claim_failure(&mut previous, &reason));
        assert!(!super::claim_failure(&mut previous, &reason));
        previous = None;
        assert!(super::claim_failure(&mut previous, &reason));
    }

    #[test]
    fn an_out_of_memory_death_is_reported_as_oom_in_every_spelling() {
        assert_eq!(super::crash_detail("VK_ERROR_OUT_OF_DEVICE_MEMORY"), "oom");
        assert_eq!(super::crash_detail("vk::OutOfDeviceMemoryError"), "oom");
        assert_eq!(super::crash_detail("signal 11"), "native_crash");
    }

    #[test]
    fn a_crash_is_coded_from_the_stage_it_happened_in() {
        let dir = std::env::temp_dir().join(format!("kalsa-stage-map-{}", std::process::id()));
        let service = std::sync::Arc::new(super::Service {
            inner: std::sync::Mutex::new(super::Inner {
                store: super::store::Store::load(dir.clone()),
                epoch: 0,
                recent: Default::default(),
                breadcrumbs: Default::default(),
                base: serde_json::json!({}),
                category: "unknown",
                total_ram: 0,
                cpu: Default::default(),
                resource_snapshot: serde_json::json!({}),
                started: None,
                last_state: None,
                last_failure: None,
                engine_stage: "load",
            }),
            send_gate: std::sync::Mutex::new(()),
        });
        assert!(
            super::SERVICE.set(service).is_ok(),
            "exactly one test installs the telemetry service"
        );
        let killed = kalsa_supervisor::Failure::ServerExited {
            detail: "engine exited without a message".into(),
            exit_code: None,
            exit_signal: Some(9),
        };
        super::supervisor_failure(&killed, "decode");
        super::supervisor_failure(&kalsa_supervisor::Failure::NotReady { seconds: 30 }, "load");
        super::supervisor_failure(
            &kalsa_supervisor::Failure::ServerExited {
                detail: "vk::OutOfDeviceMemoryError".into(),
                exit_code: Some(137),
                exit_signal: None,
            },
            "decode",
        );
        let store = super::store::Store::load(dir.clone());
        let coded: Vec<(String, String, String)> = store
            .queue
            .iter()
            .map(|item| {
                (
                    item.report["error"]["code"].as_str().unwrap().to_string(),
                    item.report["error"]["detail"].as_str().unwrap_or("").to_string(),
                    item.report["diagnostics"]["stage"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        assert_eq!(
            coded[0],
            (
                "chat.generation".to_string(),
                "native_crash".to_string(),
                "decode".to_string()
            )
        );
        assert_eq!(
            coded[1],
            (
                "engine.init".to_string(),
                "init_timeout".to_string(),
                "load".to_string()
            )
        );
        assert_eq!(
            coded[2],
            (
                "chat.generation".to_string(),
                "oom".to_string(),
                "decode".to_string()
            )
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
