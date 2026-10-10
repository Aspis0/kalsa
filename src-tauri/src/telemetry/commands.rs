use serde::Serialize;

use super::SERVICE;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    enabled: bool,
    notice_seen: bool,
}

#[tauri::command]
pub(crate) fn brain_telemetry_status() -> Result<Status, &'static str> {
    let service = SERVICE.get().ok_or("telemetry unavailable")?;
    let inner = service.inner.lock().map_err(|_| "telemetry unavailable")?;
    Ok(Status {
        enabled: inner.store.enabled,
        notice_seen: inner.store.notice_seen,
    })
}

#[tauri::command]
pub(crate) async fn brain_telemetry_set(enabled: bool) -> Result<(), &'static str> {
    tauri::async_runtime::spawn_blocking(move || {
        let service = SERVICE.get().ok_or("telemetry unavailable")?;
        set_preference(service, enabled)
    })
    .await
    .map_err(|_| "telemetry unavailable")?
}

pub(super) fn set_preference(
    service: &super::Service,
    enabled: bool,
) -> Result<(), &'static str> {
    let mut inner = service.inner.lock().map_err(|_| "telemetry unavailable")?;
    inner.epoch += 1;
    inner.recent.clear();
    inner.breadcrumbs.clear();
    inner.reach = super::network::Reach::Through;
    inner
        .store
        .set_enabled(enabled)
        .map_err(|_| "telemetry preference could not be saved")
}

#[tauri::command]
pub(crate) fn brain_telemetry_notice_seen() -> Result<(), &'static str> {
    let service = SERVICE.get().ok_or("telemetry unavailable")?;
    let mut inner = service.inner.lock().map_err(|_| "telemetry unavailable")?;
    inner.store.notice_seen = true;
    inner
        .store
        .save()
        .map_err(|_| "telemetry notice could not be saved")
}

#[tauri::command]
pub(crate) fn brain_telemetry_progress(prompt_tokens: u32, tokens_per_second: Option<f64>) {
    let Some(service) = SERVICE.get() else {
        return;
    };
    if let Ok(mut inner) = service.inner.lock() {
        if !inner.store.enabled || inner.engine_stage != "prefill" {
            return;
        }
        inner.base["promptTokens"] = serde_json::json!(super::spec::bucket(
            "promptTokens",
            f64::from(prompt_tokens)
        ));
        if let Some(rate) = tokens_per_second.filter(|rate| rate.is_finite() && *rate >= 0.0) {
            inner.base["tokensPerSecond"] =
                serde_json::json!(super::spec::bucket("tokensPerSecond", rate));
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn off_answers_while_a_send_holds_the_gate_and_invalidates_the_cycle() {
        let dir = std::env::temp_dir().join(format!("kalsa-off-in-flight-{}", std::process::id()));
        let service = std::sync::Arc::new(super::super::Service {
            inner: std::sync::Mutex::new(super::super::Inner {
                store: super::super::store::Store::load(dir.clone()),
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
                reach: super::super::network::Reach::Through,
                crash_at: None,
                stream_error_at: None,
            }),
            send_gate: std::sync::Mutex::new(()),
        });
        let epoch = service.inner.lock().unwrap().epoch;
        let (send, recv) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            // A send is running: the drain holds this gate for the whole
            // cycle, the upload and the report POST included.
            let in_flight = service.send_gate.lock().unwrap();
            scope.spawn(|| send.send(super::set_preference(&service, false)).unwrap());
            let result = recv.recv_timeout(std::time::Duration::from_millis(500));
            drop(in_flight);
            assert_eq!(result.unwrap(), Ok(()));
            // The in-flight cycle's consent check now fails on the epoch
            // alone, whatever its socket was doing.
            assert!(!super::super::network::consent(&service, epoch));
        });
        assert!(!service.inner.lock().unwrap().store.enabled);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
