//! What the page asks the browser for. Today that is the driver and nothing
//! else: whether it is installed, the press that installs it, a way to call that
//! press off, and the control that empties the profile.
//!
//! The download runs on a blocking thread — it is a blocking HTTP read — and
//! reports progress as an event, so the page shows a bar and the chat is never
//! blocked by it. The status check reads every file of the installed driver, so
//! it runs off the UI thread too: Settings must not stall while a 42 MB tree is
//! being hashed.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

use super::driver::{self, Status};
use super::error::BrowserError;
use super::profile;
use super::state::BrowserState;

/// The progress of the one download that may be running.
const PROGRESS_EVENT: &str = "brain_browser_driver_progress";

/// A progress event every this many bytes: a 42 MB archive is about forty-two
/// events, not one per network chunk.
const PROGRESS_STEP: u64 = 1024 * 1024;

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    done: u64,
    total: u64,
}

/// Whether the driver is here, and what it would weigh.
///
/// On a blocking thread: this re-hashes every file of the installed driver, and
/// a UI thread that waits on that is a Settings page that stops responding while
/// a megabyte of page spins.
#[tauri::command]
pub(crate) async fn brain_browser_driver_status(app: AppHandle) -> Result<Status, super::error::CommandFailure> {
    let app_data = app_data(&app)?;
    tokio::task::spawn_blocking(move || driver::status(&app_data))
        .await
        .map_err(|_| BrowserError::Failed)?
        .map_err(Into::into)
}

/// Downloads, verifies and unpacks the driver.
///
/// The reply is the finished state; the bar is the events in between. An
/// archive whose digest is not the pinned one never reaches a directory, so a
/// failure here leaves nothing that could be launched.
#[tauri::command]
pub(crate) async fn brain_browser_driver_download(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<Status, super::error::CommandFailure> {
    let app_data = app_data(&app)?;
    let cancel = state.begin().await?;
    let reporting = app.clone();

    let moving = app_data.clone();
    let installed = tokio::task::spawn_blocking(move || {
        let mut last = 0;
        let mut report = |done: u64, total: u64| {
            if worth_reporting(last, done, total) {
                last = done;
                emit(&reporting, Progress { done, total });
            }
        };
        driver::install(&moving, &cancel, &mut report)
    })
    .await
    .map_err(|_| BrowserError::Failed)?;

    // The slot is only given up once the transfer has actually stopped — the
    // join above is that moment — so a Cancel is never answered by a second
    // press that finds the first one still writing. Nothing between here and
    // the join may return early.
    state.release().await;
    let _dir = installed?;
    Ok(driver::status(&app_data)?)
}

/// Calls off the download that is running.
///
/// The flag is read at the next chunk boundary, so this returns immediately and
/// the download thread stops on its own; the slot stays taken until it has. A
/// press with nothing running is not a failure — the person wanted it stopped,
/// and it is. It returns the same shape as its neighbours rather than a bare
/// `Result<(), BrowserError>`, which the command macro cannot carry: a command's
/// error type is serialized to the page like every other field.
#[tauri::command]
pub(crate) async fn brain_browser_driver_cancel(state: State<'_, BrowserState>) -> Result<(), super::error::CommandFailure> {
    if let Some(cancel) = state.running().await {
        cancel.stop();
    }
    Ok(())
}

/// Empties the browser's profile: the logins, the cookies, the history. The
/// driver beside it is left alone — it is ours, not the person's.
#[tauri::command]
pub(crate) async fn brain_browser_clear_data(
    app: AppHandle,
    state: State<'_, BrowserState>,
) -> Result<(), super::error::CommandFailure> {
    // A clear while a download is writing beside it would race the tree rename,
    // and a person pressing both at once means one of them will think it worked
    // when it did not.
    if state.running().await.is_some() {
        return Err(BrowserError::Busy.into());
    }
    // And a clear while the browser is open is the same mistake: the profile
    // folder is in use, and emptying it leaves a live browser writing into a
    // directory that no longer says what it is.
    if state.session_open() {
        return Err(BrowserError::Busy.into());
    }
    let app_data = app_data(&app)?;
    tokio::task::spawn_blocking(move || profile::clear(&app_data))
        .await
        .map_err(|_| BrowserError::Failed)??;
    Ok(())
}

/// The app's own data folder, where the driver and the profile live. Kalsa's
/// folder and nowhere else: never the browser's, never a shared location.
fn app_data(app: &AppHandle) -> Result<PathBuf, BrowserError> {
    app.path().app_data_dir().map_err(|_| BrowserError::Storage)
}

/// Whether a report is worth sending. The first one always goes out, whatever
/// it says: a line faster than a megabyte a second would otherwise paint
/// nothing until it was done. Then one per megabyte, and always the last byte —
/// a bar that stops at 99% looks like a stall.
fn worth_reporting(last: u64, done: u64, total: u64) -> bool {
    last == 0 || done.saturating_sub(last) >= PROGRESS_STEP || done == total
}

/// A progress event nobody is listening for is not a failure: the download
/// carries on, because the person pressed it either way.
fn emit(app: &AppHandle, progress: Progress) {
    if let Err(error) = app.emit(PROGRESS_EVENT, progress) {
        log::warn!("browser driver progress was not delivered: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reports a 42 MB download sends, by running the rule over the sizes
    /// a fetch reports.
    fn reports(dones: &[u64], total: u64) -> Vec<u64> {
        let mut last = 0;
        let mut sent = Vec::new();
        for done in dones {
            if worth_reporting(last, *done, total) {
                last = *done;
                sent.push(*done);
            }
        }
        sent
    }

    #[test]
    fn a_bar_jumps_a_megabyte_and_always_ends_on_the_last_byte() {
        let total = 42_353_180;
        let sent = reports(&[512 * 1024, 1024 * 1024, 40 * 1024 * 1024, total], total);
        assert_eq!(sent, vec![512 * 1024, 40 * 1024 * 1024, total]);
    }

    #[test]
    fn a_short_archive_still_reports_its_start_and_its_end() {
        assert_eq!(reports(&[0, 100], 100), vec![0, 100], "a small download must not show an empty bar");
    }

    #[test]
    fn a_line_arriving_in_pieces_shorter_than_a_megabyte_reports_its_start_and_its_end() {
        // Three chunks of 2 KiB: two reports, not none. A silent bar reads as
        // a hung press, and a bar that stops short of the end reads as a stall.
        let total = 6 * 1024;
        assert_eq!(reports(&[2048, 4096, total], total), vec![2048, total]);
    }

    #[test]
    fn the_progress_event_is_the_browsers_own_and_not_the_updates_one() {
        assert_eq!(PROGRESS_EVENT, "brain_browser_driver_progress");
        assert_ne!(PROGRESS_EVENT, "brain_update_progress");
    }
}