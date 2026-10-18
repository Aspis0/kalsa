//! The commands the chat's browser tools call: one per tool, read-only.

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};

use super::error::BrowserError;
use super::state::BrowserState;

/// Opens an address in the browser.
///
/// Read-only like the rest of this step, and it opens nothing: the sidecar
/// refuses before a request is made, and the page's own words come back.
#[tauri::command]
pub(crate) async fn brain_browser_open(
    app: AppHandle,
    state: State<'_, BrowserState>,
    url: String,
) -> Result<String, super::error::CommandFailure> {
    call(&app, &state, "browser_open", one("url", Value::from(url))).await
}

/// The page as text, with the refs to act on.
#[tauri::command]
pub(crate) async fn brain_browser_read(
    app: AppHandle,
    state: State<'_, BrowserState>,
    page: Option<u64>,
) -> Result<String, super::error::CommandFailure> {
    match page {
        Some(page) => call(&app, &state, "browser_read", one("page", Value::from(page))).await,
        None => call(&app, &state, "browser_read", Map::new()).await,
    }
}

/// Text on the page, matched where it appears.
#[tauri::command]
pub(crate) async fn brain_browser_find(
    app: AppHandle,
    state: State<'_, BrowserState>,
    text: String,
) -> Result<String, super::error::CommandFailure> {
    call(&app, &state, "browser_find", one("text", Value::from(text))).await
}

/// Ends the session. The window closing and the app quitting both come here:
/// a browser left running after its window is gone is a window nobody can see
/// and nothing can stop.
#[tauri::command]
pub(crate) async fn brain_browser_close(app: AppHandle) -> Result<(), super::error::CommandFailure> {
    app.state::<BrowserState>().inner().end();
    Ok(())
}

async fn call(
    app: &AppHandle,
    state: &State<'_, BrowserState>,
    tool: &str,
    args: Map<String, Value>,
) -> Result<String, super::error::CommandFailure> {
    let app_data = app.path().app_data_dir().map_err(|_| BrowserError::Storage)?;
    state.inner().browser().call(&app_data, tool, args).await.map_err(Into::into)
}

fn one(name: &str, value: Value) -> Map<String, Value> {
    let mut args = Map::new();
    args.insert(name.to_owned(), value);
    args
}