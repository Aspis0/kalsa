//! The commands the chat's browser tools call: one per tool, read-only.

use std::time::Duration;

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, State};

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

/// Fills one field. A form goes when its own submit button is clicked, so this
/// and that are the calls a write comes from, and both are held the same way.
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
    // **The intent is recorded first, and that is what makes the press always take
    // effect.** A slot running a call is still a session to pause, so this is not
    // refused as busy: from here the app's own gate stops offering browser tools,
    // and the page is told it is paused. What the sidecar is told follows, once
    // the slot is free.
    if !state.inner().pause(&app, true) {
        // There is no session here to pause, and nothing was said about it: a
        // page with no window on it has nothing to put words on.
        return Err(BrowserError::SlotBusy.into());
    }
    // **A Pausa pressed while a call is running cuts that call short.** The call
    // is what Kalsa is doing, and the person has just said to stop doing it; a
    // refusal here would leave the control doing nothing, which is the one thing
    // a pause must never be. The session stays open — the person wants the
    // window, not the end of it — and the pause goes in as soon as the slot is
    // free.
    state.inner().browser().interrupt();
    match push_to_the_sidecar(&app, &state, "browser_pause").await {
        Ok(_) => Ok(()),
        Err(refused) => {
            // **A pause the sidecar would not take must not stand.** Either the
            // host could not answer — in which case `call` has already dropped it
            // and the session with it — or the slot stayed busy, and a `paused`
            // flag the sidecar does not hold is a promise nobody kept. Both end
            // here: the window goes, the pause goes with it, and the person is
            // left with a browser that is closed rather than one this app claims
            // to have stopped and has not.
            state.inner().end(&app);
            Err(refused)
        }
    }
}

/// Riprendi, and the page read fresh: the person has had the window, and the
/// model must not go on reading a page it last saw before that.
#[tauri::command]
pub(crate) async fn brain_browser_resume(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<String, super::error::CommandFailure> {
    if !state.inner().pause(&app, false) {
        return Err(BrowserError::SlotBusy.into());
    }
    match push_to_the_sidecar(&app, &state, "browser_resume").await {
        Ok(reading) => Ok(reading),
        Err(refused) => {
            state.inner().end(&app);
            Err(refused)
        }
    }
}

/// How many times, and how long between them, the app waits for a slot that a
/// Pausa has just freed by interrupting its call.
const SLOT_TRIES: usize = 40;
const SLOT_GAP: Duration = Duration::from_millis(25);
/// **One deadline for the whole press, not one per attempt.** A host call has no
/// timeout of its own, so a sidecar that has stopped answering would hold this
/// command open for as long as it likes — and a person pressing a button must
/// never be left waiting on one. Past this the push has failed, and the caller
/// ends the session rather than leaving a pause the sidecar does not hold.
const PRESS_DEADLINE: Duration = Duration::from_millis(1500);

/// A pause or a resume as the sidecar is told, **once the slot is free**. Only a
/// slot that is merely busy is waited for: anything else refused this call is the
/// sidecar's answer, and is passed on as it is.
async fn push_to_the_sidecar(
    app: &AppHandle,
    state: &State<'_, BrowserState>,
    tool: &str,
) -> Result<String, super::error::CommandFailure> {
    let pushed = tokio::time::timeout(PRESS_DEADLINE, retry_while_busy(app, state, tool)).await;
    match pushed {
        Ok(said) => said,
        Err(_elapsed) => Err(BrowserError::SlotBusy.into()),
    }
}

/// A slot still held by the call the Pausa interrupted, waited for briefly: that
/// call hands the browser back as soon as it notices, and anything still holding
/// it after this is a browser this app cannot reach at all.
async fn retry_while_busy(
    app: &AppHandle,
    state: &State<'_, BrowserState>,
    tool: &str,
) -> Result<String, super::error::CommandFailure> {
    for _ in 0..SLOT_TRIES {
        let said = state.inner().call_host(app, tool, Map::new()).await.map_err(Into::into);
        if said.is_ok() || !state.inner().browser().is_busy() {
            return said;
        }
        tokio::time::sleep(SLOT_GAP).await;
    }
    Err(BrowserError::SlotBusy.into())
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
    // **The end path is one path**: it declines every card the browser was
    // holding, tells the phones, and says to the page that the window is gone.
    state.inner().end(&app);
    Ok(())
}

async fn call(
    app: &AppHandle,
    state: &State<'_, BrowserState>,
    tool: &str,
    args: Map<String, Value>,
) -> Result<String, super::error::CommandFailure> {
    // **One funnel, and it says what the slot settled on.** `BrowserState::call`
    // is where the page is told and where a browser that is gone takes its cards
    // with it, so a caller that asked the host for itself could not have done
    // either.
    state.inner().call(app, tool, args).await.map_err(Into::into)
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