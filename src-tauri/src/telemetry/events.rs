use crate::failure::StartupFailure;
use serde_json::json;

pub(crate) fn startup_failure(failure: &StartupFailure) {
    let detail = match failure {
        StartupFailure::NotEnoughDisk(_) => "disk_full",
        StartupFailure::DownloadCorrupted => "model_corrupt",
        StartupFailure::ConnectionLost
        | StartupFailure::DownloadRefused
        | StartupFailure::ModelFileUnwritable => "unknown",
        StartupFailure::Supervisor(reason) => {
            super::supervisor_failure(reason, "load");
            return;
        }
        StartupFailure::ServerFetchFailed
        | StartupFailure::EngineUnreachable
        | StartupFailure::NoBackendWorked => {
            super::record(
                "engine.init",
                "engine",
                "load",
                "load",
                "unknown",
                "",
                json!({}),
                true,
            );
            return;
        }
        StartupFailure::MeasurementUnreliable(_) => {
            tune_failure();
            return;
        }
        _ => return,
    };
    super::record(
        "engine.init",
        "download",
        "download",
        "download",
        detail,
        "",
        json!({}),
        false,
    );
}

pub(crate) fn tune_failure() {
    super::record(
        "unknown",
        "tune",
        "tune_measure",
        "load",
        "unknown",
        "",
        json!({}),
        true,
    );
}

pub(crate) fn web_failure(error: &kalsa_web::WebError, searching: bool) {
    if matches!(error, kalsa_web::WebError::Stopped) {
        return;
    }
    let detail = match error {
        kalsa_web::WebError::Oversize => "payload_too_large",
        kalsa_web::WebError::Timeout => "timeout",
        kalsa_web::WebError::Status(403) => "http_403",
        kalsa_web::WebError::Status(404) => "http_404",
        kalsa_web::WebError::Status(500..=599) => "http_5xx",
        _ => "unknown",
    };
    super::record(
        if searching { "web.search" } else { "web.fetch" },
        "web",
        "tool_call",
        "turn",
        detail,
        "",
        json!({}),
        false,
    );
}

pub(crate) fn ui_event(code: &str) {
    match code {
        "chat.prefill" => super::transition("engine", "prefill"),
        "chat.decode" => super::transition("engine", "decode"),
        // The round is over in every direction; the engine is idle now, and a
        // death while idle must not look like a death mid-answer.
        "chat.turn_end" => super::transition("engine", "other"),
        "chat.turn_network"
        | "chat.turn_timeout"
        | "chat.turn_truncated"
        | "chat.turn_bad_response"
        | "chat.turn_http"
        | "chat.turn_unauthorized"
        | "chat.turn_oversize"
        | "chat.turn_context_overflow" => {
            let detail = if matches!(code, "chat.turn_context_overflow" | "chat.turn_oversize") {
                "ctx_overflow"
            } else {
                "unknown"
            };
            let stage = super::SERVICE
                .get()
                .and_then(|s| s.inner.lock().ok().map(|i| i.engine_stage))
                .unwrap_or("other");
            // The round's end moves the stage to idle before this failure is
            // reported; a stream failure is a failure to produce an answer,
            // and decode is the stage that says so.
            let stage = if stage == "other" { "decode" } else { stage };
            super::record(
                "chat.generation",
                "engine",
                stage,
                "turn",
                detail,
                "",
                json!({}),
                false,
            );
        }
        _ => {}
    }
}
