//! The owner's yes to vision, and the small state the chat reads.
//!
//! The catalog pins a projector per row; nothing downloads one until the
//! owner accepts the offer. This module is that accept: it fetches the
//! pinned file through the same digest-checked path every pinned fetch
//! takes, refuses with a reason when the row ships no projector or the
//! memory plan cannot fund one, and then restarts the engine through the
//! ordinary walk so the new argv — `--mmproj`, `--image-max-tokens` — is
//! the walk's own product, never a hand-edit of a running server.
//!
//! What the chat polls is [`VisionState`] on the running state: `none`,
//! `offer { bytes }`, `on`. Presence of the verified file IS the accept —
//! there is no second stored flag to disagree with the disk.

use serde::Serialize;
use tauri::{Emitter, State};

use kalsa_launch::LaunchInput;

use crate::{Brain, CommandError};

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
    state_file: &std::path::Path,
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
/// the argv. Refuses when the row ships none, when a walk is already
/// running, or when the memory plan cannot fund the file — the last said
/// with the byte size, before any of it moves onto the disk.
#[tauri::command]
pub(crate) async fn brain_vision_enable(
    app: tauri::AppHandle,
    brain: State<'_, Brain>,
) -> Result<VisionState, CommandError> {
    let info = brain
        .launch_record()
        .ok_or_else(|| no_projector("nothing is running yet"))?;
    let pin = info
        .mmproj
        .clone()
        .ok_or_else(|| no_projector("this model has no vision projector"))?;
    if pin.proven.is_some() {
        return Ok(VisionState::On);
    }
    if brain.walk_in_progress() {
        return Err(CommandError::new(
            "startup.already_starting",
            "Kalsa is already starting. Wait a moment.",
        ));
    }
    let state_file = crate::state_file(&app)?;
    if projector_fits(&brain, &info, pin.bytes, &state_file) == Some(false) {
        return Err(CommandError::coded(
            "vision.does_not_fit",
            serde_json::json!({ "bytes": pin.bytes }),
            "The vision projector does not fit this computer's memory beside the model.",
        ));
    }
    let root = kalsa_runtime::runtime_root();
    let emitter = app.clone();
    let pinned = kalsa_catalog::DownloadFile {
        url: pin.url.clone(),
        bytes: pin.bytes,
        sha256: pin.sha256,
    };
    tauri::async_runtime::spawn_blocking(move || {
        crate::placement::place_projector(&pinned, &root, &mut |step| {
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
    // The restart is the ordinary walk: the projector's verified file is
    // now found where the walk checks, the tune's record answers without a
    // re-measure (the key never moved), and the launch that settles carries
    // the new argv.
    crate::walk_and_settle(&app, &brain).await?;
    Ok(state(brain.launch_record().as_ref()))
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
}
