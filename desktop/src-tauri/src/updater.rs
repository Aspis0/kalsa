//! The app's own update, from the update server to the restart. Rust asks the
//! server, downloads and checks the signature, stops the engine the way a quit
//! does, and installs. The page only asks and shows what comes back.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::Brain;

const PROGRESS_EVENT: &str = "brain_update_progress";
const AVAILABLE_EVENT: &str = "brain_update_available";
/// A progress event every this many bytes, so a 150 MB download sends about
/// 150 events, not one per network chunk.
const PROGRESS_STEP: u64 = 1024 * 1024;
/// The check is one small JSON request: past this it is a stall, not a slow line.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);
/// A signed installer is a few hundred megabytes; past this the transfer has
/// stalled, and the owner can press Check again.
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const STARTUP_POLL: Duration = Duration::from_secs(2);
const SETTLE_AFTER_READY: Duration = Duration::from_secs(30);
/// The Worker enforces the same limit on the manifest; this one keeps an
/// oversized body from reaching the page.
const NOTES_MAX: usize = 600;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateStatus {
    current: String,
    available: Option<Available>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Available {
    version: String,
    notes: Option<String>,
}

#[derive(Clone, Copy, Serialize)]
pub(crate) struct Progress {
    done: u64,
    total: Option<u64>,
}

/// A command's failure as the wire carries it: the stable code the webview
/// renders in the owner's language, and the English sentence it falls back on.
#[derive(Serialize)]
pub(crate) struct UpdateError {
    code: &'static str,
    params: serde_json::Value,
    text: &'static str,
}

/// Why an update step failed, before it is a sentence. The codes are the
/// webview's keys under `update.` in the per-language `rust.ts` tables.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Failure {
    Check,
    Download,
    Signature,
    Install,
    /// A start is walking: the engine is not free to stop.
    Busy,
    /// A reply is being written: stopping now would cut it off.
    Replying,
    /// The release on offer is no longer the newest; the page checks again.
    Changed,
    UpToDate,
}

impl Failure {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Failure::Check => "update.check_failed",
            Failure::Download => "update.download_failed",
            Failure::Signature => "update.signature_failed",
            Failure::Install => "update.install_failed",
            Failure::Busy => "update.busy",
            Failure::Replying => "update.replying",
            Failure::Changed => "update.changed",
            Failure::UpToDate => "update.up_to_date",
        }
    }

    fn text(self) -> &'static str {
        match self {
            Failure::Check => "Kalsa couldn't check for updates. Try again later.",
            Failure::Download => "Kalsa couldn't download the update. Try again.",
            Failure::Signature => "The update could not be verified, so Kalsa did not install it.",
            Failure::Install => "Kalsa couldn't install the update. Try again.",
            Failure::Busy => "Kalsa is starting. Try again when it is ready.",
            Failure::Replying => "Kalsa is writing a reply. Install the update when it finishes.",
            Failure::Changed => "The update changed since it was checked. Check again.",
            Failure::UpToDate => "Kalsa is already up to date.",
        }
    }
}

impl From<Failure> for UpdateError {
    fn from(failure: Failure) -> Self {
        UpdateError {
            code: failure.code(),
            params: serde_json::Value::Null,
            text: failure.text(),
        }
    }
}

/// A download fails for the network or for the signature the update was
/// checked against. The two read differently to the owner, so they are told
/// apart here, where the plugin's error is still in hand.
pub(crate) fn download_failure(error: &tauri_plugin_updater::Error) -> Failure {
    use tauri_plugin_updater::Error;
    match error {
        Error::Minisign(_)
        | Error::Base64(_)
        | Error::SignatureUtf8(_)
        | Error::SignedVersionMismatch { .. }
        | Error::MissingSignedVersion => Failure::Signature,
        _ => Failure::Download,
    }
}

/// Why the engine may not stop yet, if it may not: a walk in flight, or a
/// reply being written. A walk is named first, because its answer is the
/// stronger one.
pub(crate) fn busy_failure(walk_in_flight: bool, reply_in_flight: bool) -> Option<Failure> {
    if walk_in_flight {
        Some(Failure::Busy)
    } else if reply_in_flight {
        Some(Failure::Replying)
    } else {
        None
    }
}

/// The install goes ahead only for the release the owner was shown: the same
/// version, still on offer. Nothing newer is installed by surprise, and
/// nothing older is either.
pub(crate) fn release_offered(offered: &str, found: Option<&str>) -> Result<(), Failure> {
    match found {
        None => Err(Failure::UpToDate),
        Some(version) if version == offered => Ok(()),
        Some(_) => Err(Failure::Changed),
    }
}

static INSTALL_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// Holds the install slot until it is dropped, so two installs never download,
/// stop and install over each other. A drop on any exit path frees it.
pub(crate) struct InstallGuard<'a>(&'a AtomicBool);

impl<'a> InstallGuard<'a> {
    pub(crate) fn take(flag: &'a AtomicBool) -> Result<Self, Failure> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| Self(flag))
            .map_err(|_| Failure::Busy)
    }
}

impl Drop for InstallGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

/// The startup check waits for an engine that is up and for no start to be
/// walking. The first-run walk downloads for minutes, and an update prompt is
/// no business of that window.
pub(crate) fn may_check(engine_running: bool, walk_in_flight: bool) -> bool {
    engine_running && !walk_in_flight
}

/// Which download bytes earn a progress event: one per `step`, and the last
/// one whatever the step, so the bar reaches its end.
pub(crate) struct ProgressTicks {
    step: u64,
    done: u64,
    reported: u64,
}

impl ProgressTicks {
    pub(crate) fn new(step: u64) -> Self {
        Self {
            step,
            done: 0,
            reported: 0,
        }
    }

    pub(crate) fn add(&mut self, bytes: usize, total: Option<u64>) -> Option<Progress> {
        self.done += bytes as u64;
        let finished = total.is_some_and(|total| self.done >= total);
        if finished || self.done - self.reported >= self.step {
            self.reported = self.done;
            Some(Progress {
                done: total.map_or(self.done, |total| self.done.min(total)),
                total,
            })
        } else {
            None
        }
    }
}

/// The page gets only this sanitised body. The plugin's own check command would
/// hand over the raw `Update.body`, so the page must never be granted it.
fn available(update: &Update) -> Available {
    Available {
        version: update.version.clone(),
        notes: plain_notes(update.body.as_deref()),
    }
}

/// Plain text only: the forbidden characters go, the line break stays, and
/// nothing is left when only whitespace remains.
fn plain_notes(body: Option<&str>) -> Option<String> {
    let text: String = body?
        .chars()
        .filter(|c| *c == '\n' || !is_forbidden(*c))
        .take(NOTES_MAX)
        .collect();
    (!text.trim().is_empty()).then_some(text)
}

/// Controls, zero-width and bidi format characters, and the Unicode line and
/// paragraph separators. The same set as NOTES_FORBIDDEN in manifest.ts.
fn is_forbidden(c: char) -> bool {
    c.is_control()
        || matches!(
            c,
            '\u{200B}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{2066}'..='\u{2069}'
                | '\u{FEFF}'
        )
}

async fn find(app: &AppHandle) -> Result<Option<Update>, Failure> {
    let updater = app
        .updater_builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|_| Failure::Check)?;
    updater.check().await.map_err(|_| Failure::Check)
}

/// The session ends here on purpose: the installer or the restart replaces
/// the process, and neither runs the exit handler that clears the marker.
fn mark_session_clean(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        crate::instance::session_marker::end_cleanly(&dir);
    }
}

/// The version this build was made as: one number, the workspace's. No
/// network, so the Settings page can show it without a check.
#[tauri::command]
pub(crate) fn brain_app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
pub(crate) async fn brain_update_check(app: AppHandle) -> Result<UpdateStatus, UpdateError> {
    let current = app.package_info().version.to_string();
    let available = find(&app).await?.as_ref().map(available);
    Ok(UpdateStatus { current, available })
}

#[tauri::command]
pub(crate) async fn brain_update_install(
    app: AppHandle,
    brain: tauri::State<'_, Arc<Brain>>,
    version: String,
) -> Result<(), UpdateError> {
    let _slot = InstallGuard::take(&INSTALL_IN_FLIGHT)?;
    if let Some(failure) = busy_failure(brain.walk_in_flight(), brain.reply_in_flight()) {
        return Err(failure.into());
    }
    let found = find(&app).await?;
    release_offered(&version, found.as_ref().map(|update| update.version.as_str()))?;
    let mut update = found.ok_or(Failure::UpToDate)?;
    update.timeout = Some(DOWNLOAD_TIMEOUT);
    let mut ticks = ProgressTicks::new(PROGRESS_STEP);
    let reporter = app.clone();
    let bytes = update
        .download(
            |chunk, total| {
                if let Some(progress) = ticks.add(chunk, total) {
                    let _ = reporter.emit(PROGRESS_EVENT, progress);
                }
            },
            || {},
        )
        .await
        .map_err(|error| download_failure(&error))?;
    // The engine stops before the installer touches the app, as a quit does.
    // The stop re-asks whether a reply or a walk started while the bytes came
    // down, and stops nothing if one did. It blocks until the engine is gone,
    // so it runs off the runtime.
    let stopper = app.clone();
    let stopped = tauri::async_runtime::spawn_blocking(move || crate::stop_for_update(&stopper))
        .await
        .map_err(|_| Failure::Install)?;
    stopped?;
    mark_session_clean(&app);
    // On Windows a successful install exits the process from inside the call.
    // Anywhere else it returns, and so does a failed one: either way the app
    // restarts, and a failure brings the services back on the old version.
    if let Err(error) = update.install(bytes) {
        log::error!("the update could not be installed; the app restarts on its current version: {error}");
    }
    app.restart();
}

/// Once per launch: after the engine has been up for a while, with no start
/// walking, check quietly and announce an update if there is one.
pub(crate) fn start_startup_check(app: AppHandle) {
    tauri::async_runtime::spawn(async move { startup_check(app).await });
}

async fn startup_check(app: AppHandle) {
    loop {
        tokio::time::sleep(STARTUP_POLL).await;
        if !ready(&app) {
            continue;
        }
        tokio::time::sleep(SETTLE_AFTER_READY).await;
        if ready(&app) {
            break;
        }
    }
    match find(&app).await {
        Ok(Some(update)) => {
            let _ = app.emit(AVAILABLE_EVENT, available(&update));
        }
        Ok(None) => {}
        Err(failure) => log::info!("the startup update check did not answer: {}", failure.code()),
    }
}

fn ready(app: &AppHandle) -> bool {
    app.try_state::<Arc<Brain>>()
        .is_some_and(|brain| may_check(brain.engine_running(), brain.walk_in_flight()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// One sample from each forbidden range, the edges included; the Worker's
    /// tests drop the same characters.
    const FORBIDDEN_SAMPLES: [char; 14] = [
        '\u{7}', '\u{85}', '\u{200B}', '\u{200C}', '\u{200D}', '\u{200E}', '\u{200F}', '\u{202A}', '\u{202E}', '\u{2028}',
        '\u{2029}', '\u{2066}', '\u{2069}', '\u{FEFF}',
    ];

    #[test]
    fn the_startup_check_waits_for_a_running_engine_with_no_walk() {
        assert!(may_check(true, false));
        assert!(!may_check(true, true), "never during a start's walk");
        assert!(!may_check(false, false), "no engine, nothing to be ready");
        assert!(!may_check(false, true));
    }

    #[test]
    fn a_bad_signature_is_told_apart_from_a_failed_download() {
        use tauri_plugin_updater::Error;
        assert_eq!(download_failure(&Error::MissingSignedVersion), Failure::Signature);
        assert_eq!(
            download_failure(&Error::SignedVersionMismatch {
                signed: "0.0.2".into(),
                announced: "0.0.3".into(),
            }),
            Failure::Signature
        );
        assert_eq!(
            download_failure(&Error::Network("connection reset".into())),
            Failure::Download
        );
    }

    #[test]
    fn a_walk_and_a_reply_each_hold_the_engine_with_their_own_answer() {
        assert_eq!(busy_failure(true, true), Some(Failure::Busy), "a walk is named first");
        assert_eq!(busy_failure(true, false), Some(Failure::Busy));
        assert_eq!(busy_failure(false, true), Some(Failure::Replying));
        assert_eq!(busy_failure(false, false), None, "a free engine may stop");
    }

    #[test]
    fn only_the_release_the_owner_was_shown_is_installed() {
        assert_eq!(release_offered("0.0.3", Some("0.0.3")), Ok(()));
        assert_eq!(release_offered("0.0.3", Some("0.0.4")), Err(Failure::Changed));
        assert_eq!(release_offered("0.0.3", Some("0.0.2")), Err(Failure::Changed));
        assert_eq!(release_offered("0.0.3", None), Err(Failure::UpToDate));
    }

    #[test]
    fn the_notes_reach_the_page_as_plain_text_capped_at_the_limit() {
        assert_eq!(
            plain_notes(Some("Faster start.\nFixed the calculator.")),
            Some("Faster start.\nFixed the calculator.".into())
        );
        assert_eq!(plain_notes(Some("bad\u{7}text\u{1b}[0m")), Some("badtext[0m".into()));
        assert_eq!(plain_notes(Some("  \n  ")), None, "whitespace is no notes");
        assert_eq!(plain_notes(None), None);
        let long = "x".repeat(NOTES_MAX + 100);
        assert_eq!(plain_notes(Some(&long)).map(|text| text.chars().count()), Some(NOTES_MAX));
    }

    #[test]
    fn each_forbidden_character_is_dropped_and_the_line_break_kept() {
        for c in FORBIDDEN_SAMPLES {
            assert_eq!(plain_notes(Some(&format!("a{c}b\nc"))), Some("ab\nc".into()), "U+{:04X}", c as u32);
        }
    }

    #[test]
    fn a_note_made_only_of_forbidden_characters_is_no_notes() {
        assert_eq!(plain_notes(Some("\u{200B}\u{202E}\u{2028}")), None);
    }

    #[test]
    fn the_timeouts_are_a_short_check_and_a_long_download() {
        assert_eq!(CHECK_TIMEOUT, Duration::from_secs(30));
        assert_eq!(DOWNLOAD_TIMEOUT, Duration::from_secs(15 * 60));
    }

    #[test]
    fn every_failure_has_its_own_namespaced_code_and_a_sentence() {
        let all = [
            Failure::Check,
            Failure::Download,
            Failure::Signature,
            Failure::Install,
            Failure::Busy,
            Failure::Replying,
            Failure::Changed,
            Failure::UpToDate,
        ];
        let mut codes: Vec<&str> = all.iter().map(|failure| failure.code()).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), all.len(), "each failure has its own code");
        for failure in all {
            assert!(failure.code().starts_with("update."), "{}", failure.code());
            assert!(!failure.text().is_empty());
        }
    }

    #[test]
    fn progress_is_reported_per_step_and_once_more_at_the_end() {
        let mut ticks = ProgressTicks::new(100);
        assert!(ticks.add(60, Some(250)).is_none());
        let at_step = ticks.add(60, Some(250)).expect("a step has passed");
        assert_eq!((at_step.done, at_step.total), (120, Some(250)));
        assert!(ticks.add(60, Some(250)).is_none());
        let last = ticks.add(70, Some(250)).expect("the end is always reported");
        assert_eq!((last.done, last.total), (250, Some(250)));
    }

    #[test]
    fn progress_never_reports_past_the_total() {
        let mut ticks = ProgressTicks::new(100);
        let over = ticks.add(300, Some(250)).expect("the end is always reported");
        assert_eq!((over.done, over.total), (250, Some(250)));
    }

    #[test]
    fn a_second_install_is_refused_until_the_first_leaves() {
        let flag = AtomicBool::new(false);
        let first = InstallGuard::take(&flag).expect("the first install takes the slot");
        assert_eq!(InstallGuard::take(&flag).err(), Some(Failure::Busy));
        drop(first);
        assert!(InstallGuard::take(&flag).is_ok(), "the release frees the slot");
    }
}
