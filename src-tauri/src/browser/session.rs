//! The commands the chat's browser tools call: one per tool, read-only.

use serde_json::{Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};

use super::confirm;
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
    conversation: String,
) -> Result<String, super::error::CommandFailure> {
    call(&app, &state, "browser_open", two("url", Value::from(url), &conversation)).await
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

/// Clicks one element. **A write this causes is held, not sent**: the card comes
/// back through `browser_cards` and the person decides, on a desktop turn only —
/// the chat offers this tool on a desktop and not on a phone.
#[tauri::command]
pub(crate) async fn brain_browser_click(
    app: AppHandle,
    state: State<'_, BrowserState>,
    r#ref: String,
    conversation: String,
) -> Result<String, super::error::CommandFailure> {
    let said = call(&app, &state, "browser_click", two("ref", Value::from(r#ref), &conversation)).await?;
    confirm::refresh(&app, &state).await;
    Ok(said)
}

/// Fills one field. Enter follows a one-line field, so this is the call a write
/// usually comes from, and it is held the same way.
#[tauri::command]
pub(crate) async fn brain_browser_type(
    app: AppHandle,
    state: State<'_, BrowserState>,
    r#ref: String,
    text: String,
    conversation: String,
) -> Result<String, super::error::CommandFailure> {
    let mut args = two("ref", Value::from(r#ref), &conversation);
    args.insert("text".to_owned(), Value::from(text));
    let said = call(&app, &state, "browser_type", args).await?;
    confirm::refresh(&app, &state).await;
    Ok(said)
}

/// The person said yes. The id is spent inside the sidecar before anything is
/// dispatched, so a second press sends nothing more.
#[tauri::command]
pub(crate) async fn brain_browser_confirm(
    app: AppHandle,
    state: State<'_, BrowserState>,
    id: String,
    conversation: String,
) -> Result<String, super::error::CommandFailure> {
    confirm::answer(&app, &state, id, conversation, true).await
}

/// The person said no. Nothing was sent and the page is as it was.
#[tauri::command]
pub(crate) async fn brain_browser_decline(
    app: AppHandle,
    state: State<'_, BrowserState>,
    id: String,
    conversation: String,
) -> Result<String, super::error::CommandFailure> {
    confirm::answer(&app, &state, id, conversation, false).await
}

/// Pausa. Kalsa stops driving the browser, and the person's own submissions are
/// not held while they have it: they are acting, and a held navigation freezes
/// the page it is holding.
///
/// Host-only in the sidecar too — a model that could pause itself could stop being
/// answerable to the person who has to decide about its writes.
#[tauri::command]
pub(crate) async fn brain_browser_pause(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<(), super::error::CommandFailure> {
    // **A Pausa pressed while a call is running cuts that call short.** The call
    // is what Kalsa is doing, and the person has just said to stop doing it; a
    // refusal here would leave the control doing nothing, which is the one thing
    // a pause must never be. The session stays open — the person wants the
    // window, not the end of it — and the pause goes in as soon as the slot is
    // free.
    state.inner().browser().interrupt();
    call(&app, &state, "browser_pause", Map::new()).await.map(|_| ())
}

/// Riprendi, and the page read fresh: the person has had the window, and the
/// model must not go on reading a page it last saw before that.
#[tauri::command]
pub(crate) async fn brain_browser_resume(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<String, super::error::CommandFailure> {
    call(&app, &state, "browser_resume", Map::new()).await
}

/// Ends the session. The window closing and the app quitting both come here:
/// a browser left running after its window is gone is a window nobody can see
/// and nothing can stop.
///
/// **A call in flight does not hold this up.** `end()` raises the slot's kill
/// handle first, so a slow page is cut short rather than waited for, and the
/// lease that call was holding is dropped on the way out — which kills the
/// sidecar child.
#[tauri::command]
pub(crate) async fn brain_browser_close(app: AppHandle) -> Result<(), super::error::CommandFailure> {
    let state = app.state::<BrowserState>();
    // The window going takes its cards with it: there is nobody left to answer
    // them, and a card left on screen outlives the thing it was about. Each is
    // declined and said, rather than the window simply going blank.
    confirm::decline_all(&app, &state).await;
    state.inner().pending().clear();
    let _ = app.emit(confirm::CARDS, Vec::<super::pending::Card>::new());
    state.inner().end();
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

/// What a browser call carries besides its own argument: **the conversation that
/// is driving**. Every write it causes is stamped with it, and a card can only be
/// answered where it was raised — so this travels with the call rather than
/// being remembered on the sidecar, where a second chat would be indistinguishable
/// from the first.
fn two(name: &str, value: Value, conversation: &str) -> Map<String, Value> {
    let mut args = one(name, value);
    args.insert("conversation".to_owned(), Value::from(conversation));
    args
}