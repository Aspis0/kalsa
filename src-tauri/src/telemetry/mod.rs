pub(crate) mod commands;
#[cfg(test)]
mod consent_tests;
pub(crate) mod context;
mod diagnostics;
pub(crate) mod events;
mod log;
mod observability;
mod network;
#[cfg(test)]
mod log_tests;
#[cfg(test)]
mod network_tests;
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
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
    /// What the transport last answered, for the once-per-change log line.
    reach: network::Reach,
    crash_at: Option<Instant>,
    stream_error_at: Option<Instant>,
}

struct Service {
    inner: Mutex<Inner>,
    send_gate: Mutex<()>,
}

/// How close in time a renderer stream error and a supervisor crash must land
/// to count as the same engine death.
const CRASH_RACE: Duration = Duration::from_secs(10);
/// The stages that mean a turn was running.
const TURN_STAGES: &[&str] = &["prefill", "decode", "tool_call"];

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
            reach: network::Reach::Through,
            crash_at: None,
            stream_error_at: None,
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
        restart(&mut inner);
    }
}

/// What a new launch resets: the supervisor's claim, the polled state, the
/// stage, and the dedupe window — a new launch is a new incident, so the
/// same crash reports again. The crash-race stamps deliberately survive:
/// the automatic restart lands about a second after the death, and the
/// renderer's stream error for that death can arrive after it. The race
/// stays bounded by its ten seconds, not by the restart.
fn restart(inner: &mut Inner) {
    inner.last_failure = None;
    inner.last_state = None;
    inner.engine_stage = "load";
    inner.started = Some(Instant::now());
    inner.recent.clear();
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
        if matches!(state, ServerState::Running { .. }) {
            // A running engine is an idle engine: the stage leaves "load"
            // the moment the engine answers, so only a turn moves it away
            // from here.
            inner.engine_stage = "other";
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
    let Some(service) = SERVICE.get() else {
        return;
    };
    let Ok(mut inner) = service.inner.lock() else {
        return;
    };
    record_crash(&mut inner, reason, stage);
}

/// Everything the supervisor's report of a dead engine does once it holds the
/// service lock: claim, resolve the stage, record.
fn record_crash(inner: &mut Inner, reason: &Failure, stage: &str) {
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
    let Some(stage) = crash_stage(inner, reason, stage) else {
        return;
    };
    // A death while a turn was running failed the user's answer, not the
    // engine's start; the stage the report already carries says which.
    let code = if TURN_STAGES.contains(&stage) {
        "chat.generation"
    } else {
        "engine.init"
    };
    let phase = if matches!(stage, "prefill" | "decode" | "slot_restore" | "tool_call") {
        "turn"
    } else {
        "load"
    };
    record_locked(inner, code, "engine", stage, phase, detail, raw, extra, true);
}

/// Claims the failure and resolves the stage its report carries. None when the
/// failure is a repeat or telemetry is off.
fn crash_stage<'a>(inner: &mut Inner, reason: &Failure, stage: &'a str) -> Option<&'a str> {
    if !inner.store.enabled || !claim_failure(&mut inner.last_failure, reason) {
        return None;
    }
    // The renderer's stream error for this same death may still be queued; the
    // crash answers it, keeps one report for one death, and inherits the turn
    // stage that report carried.
    let raced = take_raced_report(inner);
    inner.crash_at = Some(Instant::now());
    Some(raced.unwrap_or(if stage == "load" {
        inner.engine_stage
    } else {
        stage
    }))
}

/// The renderer's queued stream error for a death this crash now answers, if
/// one arrived inside the race window. Taking it is what leaves one report
/// for one death; the turn stage it carried comes back with it. A report
/// whose send is already on the wire is never taken: the server would keep
/// both.
fn take_raced_report(inner: &mut Inner) -> Option<&'static str> {
    if inner
        .stream_error_at
        .is_none_or(|at| at.elapsed() >= CRASH_RACE)
    {
        return None;
    }
    let index = inner.store.queue.iter().rposition(|item| {
        !item.in_flight
            && item.report["error"]["code"] == "chat.generation"
            && item.report["error"]["detail"] == "unknown"
    })?;
    let item = inner.store.queue.remove(index);
    // The window is spent on the report it took: a second crash inside the
    // same ten seconds must not reach for an older, unrelated one.
    inner.stream_error_at = None;
    TURN_STAGES
        .iter()
        .copied()
        .find(|stage| Some(*stage) == item.report["diagnostics"]["stage"].as_str())
}

fn crash_detail(raw: &str) -> &'static str {
    if crate::oom::is_out_of_memory(raw) {
        "oom"
    } else {
        "native_crash"
    }
}

/// Records one report. `with_log` marks a serious failure whose report owes
/// the redacted log an automatic upload.
///
/// The parameter list is the wire report's own shape; the lock it takes is
/// what carried it past clippy's argument limit.
#[allow(clippy::too_many_arguments)]
pub(crate) fn record(
    code: &str,
    component: &str,
    stage: &str,
    phase: &str,
    detail: &str,
    raw: &str,
    extra: Value,
    with_log: bool,
) {
    let Some(service) = SERVICE.get() else {
        return;
    };
    let Ok(mut inner) = service.inner.lock() else {
        return;
    };
    record_locked(&mut inner, code, component, stage, phase, detail, raw, extra, with_log);
}

/// The body of record once the service lock is held. The parameter list is
/// the wire report's own shape; peeling the lock off record() is what carried
/// it past clippy's argument limit.
#[allow(clippy::too_many_arguments)]
fn record_locked(
    inner: &mut Inner,
    code: &str,
    component: &str,
    stage: &str,
    phase: &str,
    detail: &str,
    raw: &str,
    extra: Value,
    with_log: bool,
) {
    if !inner.store.enabled {
        return;
    }
    if code == "chat.generation" && detail == "unknown" {
        // The renderer's stream error and the supervisor's crash for one
        // engine death race each other; a crash already on record wins.
        if inner.crash_at.is_some_and(|at| at.elapsed() < CRASH_RACE) {
            return;
        }
        inner.stream_error_at = Some(Instant::now());
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
    inner.store.enqueue(report, with_log);
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
    use super::{Duration, Instant};
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

    /// A crash death inside the race window, distinct enough from any other
    /// to be its own claim.
    fn death(detail: &str) -> kalsa_supervisor::Failure {
        kalsa_supervisor::Failure::ServerExited {
            detail: detail.into(),
            exit_code: None,
            exit_signal: Some(9),
        }
    }

    #[test]
    fn a_crash_never_takes_a_report_whose_send_is_on_the_wire() {
        let dir = std::env::temp_dir().join(format!("kalsa-inflight-{}", std::process::id()));
        let service = std::sync::Arc::new(super::Service {
            inner: std::sync::Mutex::new(inner(dir.clone(), "decode")),
            send_gate: std::sync::Mutex::new(()),
        });
        super::record_locked(
            &mut service.inner.lock().unwrap(),
            "chat.generation",
            "engine",
            "decode",
            "turn",
            "unknown",
            "",
            stream_error(),
            false,
        );
        // The real pick marks the report in flight and persists it.
        let _ = super::network::pick(&service, super::now() + 3600)
            .expect("the pick takes the queued report");
        {
            let inner = service.inner.lock().unwrap();
            assert!(inner.store.queue[0].in_flight, "the pick marks it");
            assert_eq!(inner.store.queue.len(), 1);
        }
        // A crash lands inside the race window and must leave it alone.
        {
            let mut inner = service.inner.lock().unwrap();
            assert!(super::take_raced_report(&mut inner).is_none());
            assert_eq!(inner.store.queue.len(), 1, "the in-flight report stays");
        }
        super::record_crash(&mut service.inner.lock().unwrap(), &death("engine died mid answer"), "decode");
        let inner = service.inner.lock().unwrap();
        assert_eq!(inner.store.queue.len(), 2, "the crash reports beside it");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_second_crash_inside_the_window_takes_no_older_report() {
        let dir = std::env::temp_dir().join(format!("kalsa-window-{}", std::process::id()));
        let mut inner = inner(dir.clone(), "decode");
        // Two unrelated turn failures, the older one first: each is its own
        // incident, so nothing dedupes either.
        for stage in ["prefill", "decode"] {
            super::record_locked(
                &mut inner,
                "chat.generation",
                "engine",
                stage,
                "turn",
                "unknown",
                "",
                stream_error(),
                false,
            );
        }
        assert_eq!(inner.store.queue.len(), 2);
        // The first crash answers the newest one and spends the window.
        super::record_crash(&mut inner, &death("engine died mid answer"), "decode");
        assert_eq!(
            inner.store.queue.len(),
            2,
            "one crash report beside the older failure"
        );
        // A second crash inside the same ten seconds takes nothing more.
        super::record_crash(&mut inner, &death("vk::OutOfDeviceMemoryError"), "decode");
        assert_eq!(
            inner.store.queue.len(),
            3,
            "the window was spent: the older failure stands on its own"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_stream_error_that_arrives_after_the_restart_is_still_the_same_death() {
        let dir = std::env::temp_dir().join(format!("kalsa-late-{}", std::process::id()));
        let mut inner = inner(dir.clone(), "decode");
        super::record_crash(&mut inner, &death("engine died mid answer"), "decode");
        let reported = inner.store.queue.len();
        // The automatic restart lands about a second later.
        super::restart(&mut inner);
        // The renderer's failure for the same death arrives after it.
        super::record_locked(
            &mut inner,
            "chat.generation",
            "engine",
            "decode",
            "turn",
            "unknown",
            "",
            stream_error(),
            false,
        );
        assert_eq!(
            inner.store.queue.len(),
            reported,
            "the late stream error is the death already reported, not a second report"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_second_launch_reports_the_same_crash_again() {
        let dir = std::env::temp_dir().join(format!("kalsa-relaunch-{}", std::process::id()));
        let mut inner = inner(dir.clone(), "decode");
        super::record_crash(&mut inner, &death("engine died mid answer"), "decode");
        assert_eq!(inner.store.queue.len(), 1);
        super::restart(&mut inner);
        super::record_crash(&mut inner, &death("engine died mid answer"), "decode");
        assert_eq!(
            inner.store.queue.len(),
            2,
            "a new launch is a new incident, not a silenced duplicate"
        );
        std::fs::remove_dir_all(dir).unwrap();
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
                reach: super::network::Reach::Through,
                crash_at: None,
                stream_error_at: None,
            }),
            send_gate: std::sync::Mutex::new(()),
        });
        assert!(
            super::SERVICE.set(service.clone()).is_ok(),
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
        // A finished turn leaves the engine idle, and only then does a death
        // stop being a failed answer.
        super::events::ui_event("chat.decode");
        super::events::ui_event("chat.turn_end");
        super::supervisor_failure(
            &kalsa_supervisor::Failure::ServerExited {
                detail: "engine died while idle".into(),
                exit_code: None,
                exit_signal: Some(9),
            },
            "other",
        );
        // A running engine is an idle one: the stage leaves "load" the
        // moment the engine answers, so a death that finds it idle is not a
        // load crash.
        super::observe(&kalsa_supervisor::ServerState::Starting);
        super::observe(&kalsa_supervisor::ServerState::Running {
            pid: 4242,
            port: 8080,
        });
        super::observe(&kalsa_supervisor::ServerState::Failed {
            reason: kalsa_supervisor::Failure::ServerExited {
                detail: "engine exited: segmentation fault".into(),
                exit_code: None,
                exit_signal: Some(11),
            },
        });
        let inner = service.inner.lock().unwrap();
        assert_eq!(inner.engine_stage, "other");
        let queued = |code: &str, detail: &str, stage: &str| {
            inner
                .store
                .queue
                .iter()
                .any(|item| {
                    item.report["error"]["code"] == code
                        && item.report["error"]["detail"] == detail
                        && item.report["diagnostics"]["stage"] == stage
                })
        };
        assert!(queued("chat.generation", "native_crash", "decode"));
        assert!(queued("engine.init", "init_timeout", "load"));
        assert!(queued("chat.generation", "oom", "decode"));
        assert!(queued("engine.init", "native_crash", "other"));
        // The idle death walked the real state path: its signal is what
        // tells this report from the one handed "other" directly, so the
        // assertion cannot pass on that one alone.
        assert!(
            inner.store.queue.iter().any(|item| {
                item.report["error"]["code"] == "engine.init"
                    && item.report["error"]["detail"] == "native_crash"
                    && item.report["diagnostics"]["stage"] == "other"
                    && item.report["error"]["signal"] == "segmentation fault"
            }),
            "an idle death reports stage other, never load"
        );
        drop(inner);
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn inner(dir: std::path::PathBuf, stage: &'static str) -> super::Inner {
        super::Inner {
            store: super::store::Store::load(dir),
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
            engine_stage: stage,
            reach: super::network::Reach::Through,
            crash_at: None,
            stream_error_at: None,
        }
    }

    fn stream_error() -> super::Value {
        serde_json::json!({})
    }

    #[test]
    fn a_stream_error_that_lands_first_is_replaced_by_the_crash() {
        let dir = std::env::temp_dir().join(format!("kalsa-race-a-{}", std::process::id()));
        let mut inner = inner(dir.clone(), "decode");
        super::record_locked(
            &mut inner,
            "chat.generation",
            "engine",
            "decode",
            "turn",
            "unknown",
            "",
            stream_error(),
            false,
        );
        assert_eq!(inner.store.queue.len(), 1);
        super::record_crash(
            &mut inner,
            &kalsa_supervisor::Failure::ServerExited {
                detail: "engine died mid answer".into(),
                exit_code: None,
                exit_signal: Some(9),
            },
            "decode",
        );
        assert_eq!(inner.store.queue.len(), 1);
        let report = &inner.store.queue[0].report;
        assert_eq!(report["error"]["code"], "chat.generation");
        assert_eq!(report["error"]["detail"], "native_crash");
        assert_eq!(report["diagnostics"]["stage"], "decode");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_stream_error_that_lands_after_the_crash_is_dropped() {
        let dir = std::env::temp_dir().join(format!("kalsa-race-b-{}", std::process::id()));
        let mut inner = inner(dir.clone(), "decode");
        super::record_crash(
            &mut inner,
            &kalsa_supervisor::Failure::ServerExited {
                detail: "engine died mid answer".into(),
                exit_code: None,
                exit_signal: Some(9),
            },
            "decode",
        );
        assert_eq!(inner.store.queue.len(), 1);
        super::record_locked(
            &mut inner,
            "chat.generation",
            "engine",
            "decode",
            "turn",
            "unknown",
            "",
            stream_error(),
            false,
        );
        assert_eq!(inner.store.queue.len(), 1);
        assert_eq!(inner.store.queue[0].report["error"]["detail"], "native_crash");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_stream_error_outside_the_race_window_stands_alone() {
        let dir = std::env::temp_dir().join(format!("kalsa-race-stale-{}", std::process::id()));
        let mut inner = inner(dir.clone(), "decode");
        super::record_locked(
            &mut inner,
            "chat.generation",
            "engine",
            "decode",
            "turn",
            "unknown",
            "",
            stream_error(),
            false,
        );
        inner.stream_error_at = Some(Instant::now() - Duration::from_secs(11));
        super::record_crash(
            &mut inner,
            &kalsa_supervisor::Failure::ServerExited {
                detail: "engine died much later".into(),
                exit_code: None,
                exit_signal: Some(9),
            },
            "decode",
        );
        assert_eq!(inner.store.queue.len(), 2);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
