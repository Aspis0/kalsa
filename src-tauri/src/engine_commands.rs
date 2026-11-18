//! Tauri commands for M3a. No generic run-command surface exists.
//!
//! Each command is `async`: a plain command runs on the main thread, and an install or a start would freeze the window.

use std::sync::Arc;

use kalsa_engine_host::{EngineHost, EngineState, EngineStatus};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress<'a> {
    id: &'a str,
    stage: &'a str,
    done: u64,
    total: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusEvent<'a> {
    id: &'a str,
    state: &'a EngineState,
    port: Option<u16>,
    message: Option<String>,
}

fn status_event<'a>(id: &'a str, status: &'a EngineStatus) -> StatusEvent<'a> {
    StatusEvent {
        id,
        state: &status.state,
        port: status.port,
        message: status.message.clone(),
    }
}

fn progress(app: AppHandle, id: String) -> impl Fn(&str, u64, u64) + Send + Sync + 'static {
    move |stage, done, total| {
        let _ = app.emit(
            "engine-install-progress",
            InstallProgress { id: &id, stage, done, total },
        );
    }
}

#[tauri::command(async)]
pub fn engine_install(
    app: AppHandle,
    host: State<'_, Arc<EngineHost>>,
    id: String,
) -> Result<(), String> {
    host.install(&id, &progress(app.clone(), id.clone()))
}

#[tauri::command(async)]
pub fn engine_uninstall(host: State<'_, Arc<EngineHost>>, id: String) -> Result<(), String> {
    host.uninstall(&id)
}

#[tauri::command(async)]
pub fn engine_start(
    app: AppHandle,
    host: State<'_, Arc<EngineHost>>,
    id: String,
    model: String,
) -> Result<EngineStatus, String> {
    let status = host.start(&id, &model, &progress(app.clone(), id.clone()))?;
    let _ = app.emit("engine-status", status_event(&id, &status));
    Ok(status)
}

#[tauri::command(async)]
pub fn engine_stop(
    app: AppHandle,
    host: State<'_, Arc<EngineHost>>,
    id: String,
) -> Result<(), String> {
    host.stop(&id)?;
    let status = host.status(&id);
    let _ = app.emit("engine-status", status_event(&id, &status));
    Ok(())
}

#[tauri::command(async)]
pub fn engine_status(host: State<'_, Arc<EngineHost>>, id: String) -> EngineStatus {
    host.status(&id)
}
