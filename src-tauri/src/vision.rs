//! The owner's yes to vision, and the small state the chat reads.
//!
//! The catalog pins a projector per row; nothing downloads one until the
//! owner accepts the offer. This module is that accept, and it is a WALK:
//! the single-walk claim is taken before any byte moves and held across
//! the download and the restart, so a second enable (or a Turn on) is
//! refused outright instead of racing the fetch, and a Turn off is
//! answered by a generation read before anything began.
//!
//! Two things can land while the bytes move, and each wins over the
//! restart — the projector file is KEPT (the owner paid for the bytes; the
//! next start finds it verified) and nothing is started:
//!
//! * a Turn off — vetoed by the stop generation read when the command
//!   began, so the restart can never undo it;
//! * another model chosen — the restart would boot a row whose projector
//!   this is not, so it waits for the next ordinary start.
//!
//! What the chat polls is [`VisionState`] on the running state: `none`,
//! `offer { bytes }`, `on`. Presence of the verified file IS the accept —
//! there is no second stored flag to disagree with the disk.

use std::path::Path;
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::{Emitter, State};

use kalsa_launch::LaunchInput;

use crate::{Brain, CommandError, WalkGuard};

/// What this launch can see, as the chat reads it from `brain_state`'s
/// running arm. Serde renders `{"state":"none"}`, `{"state":"offer",
/// "bytes":N}`, `{"state":"on"}` — a tagged enum, the shape `StateDto`
/// itself uses, so the chat branches on a name and never parses prose.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub(crate) enum VisionState {
    /// The row ships no projector: there is nothing to offer and nothing to
    /// enable. Also the answer on every path with no launch record.
    None,
    /// The row ships a projector the owner has not accepted: `bytes` is the
    /// download's size, so the chat can show what a yes costs.
    Offer { bytes: u64 },
    /// A verified projector rode this launch: the engine was started with
    /// `--mmproj`, and the chat may send images.
    On,
}

/// The launch record's vision answer: `on` is the launch's own decision —
/// the proven file the plan charged and passed — never a re-read of the
/// disk, which could only disagree with the argv that is actually running.
pub(crate) fn state(info: Option<&crate::startup::LaunchInfo>) -> VisionState {
    match info.and_then(|info| info.mmproj.as_ref()) {
        None => VisionState::None,
        Some(pin) => match pin.proven {
            Some(_) => VisionState::On,
            None => VisionState::Offer { bytes: pin.bytes },
        },
    }
}

/// What the owner's yes still has to do, decided before anything is
/// claimed or fetched.
pub(crate) enum Prepared {
    /// This launch already passes a projector: nothing to fetch, nothing
    /// to restart.
    On,
    /// The projector to fetch on demand, and the row it belongs to.
    Download(Plan),
}

pub(crate) struct Plan {
    /// The pinned file to fetch, with the address, size and digest the
    /// fetch is verified against.
    pub(crate) pin: kalsa_catalog::DownloadFile,
    /// The row whose projector this is, as the choice file names rows
    /// (`startup::model_token`): the restart may only go through while
    /// the stored choice still says this one.
    pub(crate) row_token: String,
}

/// The pre-flight: the running launch's pin, whether its file is already
/// proven, and whether the memory plan can fund it. Pure reads — nothing
/// claimed, nothing fetched — so the command can take its stop generation
/// and its walk claim around everything that follows.
pub(crate) fn prepare(brain: &Brain, state_file: &Path) -> Result<Prepared, CommandError> {
    let info = brain
        .launch_record()
        .ok_or_else(|| no_projector("nothing is running yet"))?;
    let pin = info
        .mmproj
        .clone()
        .ok_or_else(|| no_projector("no projector"))?;
    if pin.proven.is_some() {
        return Ok(Prepared::On);
    }
    // The pin and the row travel together on the catalog path; a record
    // with one and not the other is this app's bug, and the honest answer
    // is the unexpected refusal, not a guess.
    let row = info.sizing.as_ref().map(|sizing| sizing.row).ok_or_else(|| {
        CommandError::from("the launch record carries a projector pin but no row to name")
    })?;
    if projector_fits(brain, &info, pin.bytes, state_file) == Some(false) {
        return Err(CommandError::coded(
            "vision.does_not_fit",
            serde_json::json!({ "bytes": pin.bytes }),
            "The vision projector does not fit this computer's memory beside the model.",
        ));
    }
    Ok(Prepared::Download(Plan {
        pin: kalsa_catalog::DownloadFile {
            url: pin.url.clone(),
            bytes: pin.bytes,
            sha256: pin.sha256,
        },
        row_token: crate::startup::model_token(row),
    }))
}

/// The claim an enable holds for its whole life — download and restart
/// included. This is the single-walk claim every Turn on takes, so a
/// second enable (or a Turn on pressed mid-download) is refused with its
/// own words instead of racing the fetch's part-file lock. The generation
/// returned is the one the restart's settlement is disciplined by.
pub(crate) fn begin(brain: &Brain) -> Result<(WalkGuard<'_>, u64), CommandError> {
    brain
        .begin_walk(|| {})
        .map(|stops| (WalkGuard(brain), stops))
        .ok_or_else(|| {
            CommandError::new(
                "vision.busy",
                "Kalsa is already turning on or enabling vision. Wait a moment.",
            )
        })
}

/// Whether the restart may go through, decided once the bytes are on disk.
pub(crate) enum After {
    Restart,
    /// The projector is placed and kept; `why` names what stopped the
    /// restart. Nothing was started.
    Kept { why: &'static str },
}

pub(crate) fn after_download(
    brain: &Brain,
    state_file: &Path,
    began_at_stops: u64,
    row_token: &str,
) -> After {
    // The Turn off wins. `began_at_stops` was read when the command began,
    // so a stop pressed anywhere after that — during the pre-flight, the
    // claim or the download — has bumped the generation and is caught
    // here, before any restart can undo it.
    if brain.stops.load(Ordering::SeqCst) != began_at_stops {
        return After::Kept {
            why: "a Turn off landed while the projector downloaded",
        };
    }
    // The model must still be the one whose projector this is: a choice
    // made meanwhile would boot a different row on the restart. `None` is
    // the automatic path — the running model came from the chooser, and
    // the restart re-asks it exactly as a Turn on would.
    let chosen = crate::options::load(state_file).model;
    if chosen.as_deref().is_some_and(|token| token != row_token) {
        return After::Kept {
            why: "another model was chosen while the projector downloaded",
        };
    }
    After::Restart
}

/// Whether the plan still funds this launch beside a projector of `bytes`:
/// the walk's own arithmetic, re-asked through the exact seams the last
/// walk kept (`LaunchSizing`) — never a second copy of the budget
/// arithmetic. `None` means the question cannot be asked yet (no kept
/// measurement): the walk stays the arbiter and the download is not
/// blocked on a guess.
fn projector_fits(
    brain: &Brain,
    info: &crate::startup::LaunchInfo,
    bytes: u64,
    state_file: &Path,
) -> Option<bool> {
    let sizing = info.sizing?;
    let measurement = brain.kept_measurement()?;
    let overrides = crate::options::load(state_file);
    let input = LaunchInput {
        backend: sizing.backend,
        model: sizing.row,
        budget: sizing.budget,
        drafter_bytes: sizing.drafter_bytes,
        mmproj_bytes: bytes,
        thread_ramp: &measurement.ramp,
        physical_cores: kalsa_probe::physical_cores(),
        model_path: info.args.model_path.clone(),
        port: crate::startup::PORT,
        context_limit: overrides.context_tokens,
        batch_size: info.args.batch_size,
        ubatch_size: info.args.ubatch_size,
        kv_cache: info.args.kv_cache,
        parallel: info.args.parallel,
        slot_save_path: info.args.slot_save_path.clone(),
    };
    Some(kalsa_launch::plan(&input).is_some())
}

/// The owner's yes to vision: fetch the current model's pinned projector,
/// prove it by its digest, and restart the engine so the projector rides
/// the argv. The whole command is one walk — the claim is taken before the
/// download and held through the restart — and a Turn off or a model
/// switch that lands while the bytes move keeps the file and skips the
/// restart (see [`after_download`]).
#[tauri::command]
pub(crate) async fn brain_vision_enable(
    app: tauri::AppHandle,
    brain: State<'_, Brain>,
) -> Result<VisionState, CommandError> {
    // Before anything: the stop generation this enable began at. A Turn off
    // pressed from here on must survive the whole command.
    let began_at_stops = brain.stops.load(Ordering::SeqCst);
    let state_file = crate::state_file(&app)?;
    let root = kalsa_runtime::runtime_root();
    match prepare(&brain, &state_file)? {
        Prepared::On => Ok(VisionState::On),
        Prepared::Download(plan) => {
            let row_token = plan.row_token;
            let pin = plan.pin;
            let (_walk, stops_seen) = begin(&brain)?;
            let emitter = app.clone();
            // The fetch is the one blocking stretch; it runs off the async
            // runtime like every other download, progress on the same
            // `brain_progress` events the model download uses.
            tauri::async_runtime::spawn_blocking(move || {
                crate::placement::place_projector(&pin, &root, &mut |step| {
                    let _ = emitter.emit("brain_progress", step);
                })
            })
            .await
            .map_err(|_| {
                CommandError::new(
                    "startup.check_failed",
                    "Kalsa couldn't download the vision projector. Wait a moment and try again.",
                )
            })?
            .map_err(CommandError::from)?;
            match after_download(&brain, &state_file, began_at_stops, &row_token) {
                After::Kept { why } => {
                    log::info!("vision: the projector is on disk; no restart — {why}");
                    Ok(state(brain.launch_record().as_ref()))
                }
                After::Restart => {
                    // The restart runs on this command's own claim and the
                    // generation it took: every stop check inside the
                    // settlement still answers to the pre-download number.
                    crate::settle(&app, &brain, state_file, stops_seen).await?;
                    Ok(state(brain.launch_record().as_ref()))
                }
            }
        }
    }
}

/// The one refusal when there is nothing to enable, said once.
fn no_projector(why: &str) -> CommandError {
    CommandError::new(
        "vision.none",
        match why {
            "nothing is running yet" => {
                "Start the brain first; vision belongs to a running model."
            }
            _ => "This model has no vision projector to enable.",
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The chat's whole contract, pinned on the wire shape: `none` where no
    /// pin travels, `offer` with the byte size while the owner has not
    /// accepted, `on` once a launch passed the verified file. `On` reads
    /// the LAUNCH's own decision — a file that arrived under the pin's
    /// destination after the launch must not turn the answer on, because
    /// the running engine never saw it.
    #[test]
    fn the_vision_state_is_the_launchs_own_answer() {
        assert_eq!(state(None), VisionState::None);
        let pin = |proven: Option<std::path::PathBuf>| crate::startup::MmprojLaunch {
            url: "https://huggingface.co/r/resolve/c/mmproj.gguf".to_string(),
            sha256: "0",
            bytes: 1234,
            proven,
        };
        let mut info = crate::startup::LaunchInfo {
            args: {
                let mut args = test_args();
                args.mmproj = None;
                args
            },
            mmproj: Some(pin(None)),
            ..test_info()
        };
        assert_eq!(state(Some(&info)), VisionState::Offer { bytes: 1234 });
        info.mmproj = Some(pin(Some(std::path::PathBuf::from("/models/r__mmproj.gguf"))));
        assert_eq!(state(Some(&info)), VisionState::On);
    }

    fn test_args() -> kalsa_launch::ServerArgs {
        kalsa_launch::ServerArgs {
            model_path: std::path::PathBuf::from("/models/chosen.gguf"),
            port: 8130,
            context_tokens: 8192,
            cache_ram_mib: 1024,
            threads: None,
            offload: kalsa_launch::Offload::All,
            device: None,
            idle_unload_seconds: 300,
            batch_size: 2048,
            ubatch_size: 512,
            kv_cache: kalsa_launch::KvCache::Q8_0,
            parallel: 1,
            slot_save_path: std::path::PathBuf::from("/slots"),
            sampling: kalsa_catalog::Sampling::default(),
            draft: None,
            mmproj: None,
        }
    }

    fn test_info() -> crate::startup::LaunchInfo {
        crate::startup::LaunchInfo {
            args: test_args(),
            maximum_context: crate::startup::ContextMaxima {
                q8_0: None,
                f16: None,
            },
            automatic_context: crate::startup::ContextMaxima {
                q8_0: None,
                f16: None,
            },
            context_prices: Default::default(),
            display_name: None,
            reason: None,
            model_sha256: None,
            tune: None,
            checked: None,
            drafter_sha256: None,
            mmproj: None,
            sizing: None,
        }
    }

    /// A brain whose running launch is a real catalog row with an
    /// un-proven projector pin, and a choice file naming that row — the
    /// state an offer is made from. No kept measurement, so the fit
    /// question stays open (the walk's to answer) exactly as on a machine
    /// that has not turned on since its record.
    fn offered(brain: &Brain, state_file: &std::path::Path) -> &'static kalsa_catalog::ModelEntry {
        let row = kalsa_catalog::rows()
            .find(|entry| entry.display_name == "Liquid LFM 2.5")
            .expect("the test row left the catalog");
        let mut info = test_info();
        info.sizing = Some(crate::startup::LaunchSizing {
            backend: kalsa_runtime::ServerBackend::Cpu,
            budget: kalsa_catalog::memory_budget(
                kalsa_probe::Backend::Cpu,
                16 * 1024 * 1024 * 1024,
            ),
            row,
            drafter_bytes: 0,
        });
        info.mmproj = Some(crate::startup::MmprojLaunch {
            url: "https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF/resolve/a483e9e6/mmproj-F16.gguf"
                .to_string(),
            sha256: "0",
            bytes: 1234,
            proven: None,
        });
        brain.launch.lock().unwrap().replace(info);
        let mut choices = crate::options::load(state_file);
        choices.model = Some(crate::startup::model_token(row));
        crate::options::save(state_file, choices).expect("the choice file takes the row");
        row
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-brain-vision-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// Race 1: a Turn off pressed while the projector downloads wins —
    /// the file is kept, and the restart that would undo the stop never
    /// happens. The generation the command read BEFORE anything is what
    /// catches the bump, wherever after the press it lands.
    #[test]
    fn a_stop_during_the_download_wins_over_the_restart() {
        let brain = Brain::new();
        let state_file = scratch("stop-wins").join("state.json");
        let row = offered(&brain, &state_file);
        match prepare(&brain, &state_file).expect("the offer prepares") {
            Prepared::Download(plan) => {
                assert_eq!(plan.row_token, crate::startup::model_token(row))
            }
            Prepared::On => panic!("nothing is proven yet"),
        }
        let began = brain.stops.load(Ordering::SeqCst);
        let (_walk, _stops_seen) = begin(&brain).expect("the enable claims the walk");
        // The bytes move; the owner presses Turn off:
        brain.stops.fetch_add(1, Ordering::SeqCst);
        match after_download(&brain, &state_file, began, &crate::startup::model_token(row)) {
            After::Kept { why } => assert!(
                why.contains("Turn off"),
                "the refusal names the stop: {why}"
            ),
            After::Restart => panic!("a stop pressed during the download was undone by a restart"),
        }
    }

    /// Race 2: a second enable while the first holds the claim is refused
    /// with its own words, never raced into the fetch's part-file lock.
    /// The claim is the same one a Turn on takes, so a Turn on pressed
    /// mid-download meets the same refusal from its own side.
    #[test]
    fn a_second_enable_while_one_runs_is_refused_not_raced() {
        let brain = Brain::new();
        let state_file = scratch("double-enable").join("state.json");
        offered(&brain, &state_file);
        let first = begin(&brain);
        assert!(first.is_ok(), "the first call claims the walk");
        let second = begin(&brain);
        // `expect_err` is out: the claim's guard is not Debug, and it
        // should not have to be — the refusal is the fact being pinned.
        let refusal = match second {
            Ok((_guard, _)) => panic!("the second call raced the first instead of being refused"),
            Err(refusal) => refusal,
        };
        assert_eq!(refusal.code, "vision.busy", "{refusal:?}");
        drop(first);
    }

    /// Race 3: another model chosen while the bytes move keeps the file
    /// and skips the restart — the restart would boot a row whose
    /// projector this is not. With the choice back on this row (or on no
    /// row at all, the automatic path), the restart goes through.
    #[test]
    fn a_model_chosen_during_the_download_keeps_the_file_and_skips_the_restart() {
        let brain = Brain::new();
        let state_file = scratch("switch").join("state.json");
        let row = offered(&brain, &state_file);
        let began = brain.stops.load(Ordering::SeqCst);
        let (_walk, _stops_seen) = begin(&brain).expect("the enable claims the walk");
        // The bytes move; the owner picks another model on the AI page:
        let mut switched = crate::options::load(&state_file);
        switched.model = Some("0123456789abcdef".to_string());
        crate::options::save(&state_file, switched).expect("the choice file takes it");
        match after_download(&brain, &state_file, began, &crate::startup::model_token(row)) {
            After::Kept { why } => assert!(
                why.contains("another model"),
                "the refusal names the switch: {why}"
            ),
            After::Restart => panic!("the restart would boot a model whose projector this is not"),
        }
        // The same row still chosen: the restart may go through.
        let mut back = crate::options::load(&state_file);
        back.model = Some(crate::startup::model_token(row));
        crate::options::save(&state_file, back).expect("the choice file takes it");
        assert!(matches!(
            after_download(&brain, &state_file, began, &crate::startup::model_token(row)),
            After::Restart
        ));
        // And the automatic path — no stored choice — restarts too: the
        // chooser re-answers as a Turn on would.
        let mut automatic = crate::options::load(&state_file);
        automatic.model = None;
        crate::options::save(&state_file, automatic).expect("the choice file takes it");
        assert!(matches!(
            after_download(&brain, &state_file, began, &crate::startup::model_token(row)),
            After::Restart
        ));
    }
}
