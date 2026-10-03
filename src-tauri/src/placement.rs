//! A plan's pinned files, placed on disk — each proven by its digest.
//!
//! The weights are the model the owner picked: placing them is the hard
//! requirement, and their faults fail the start. The drafter beside them is
//! an accelerator: when it cannot be named, fitted or fetched, the start
//! goes ahead without it — one line says why, and the next start tries
//! again. Never a model refused over its sidecar.

use std::path::{Path, PathBuf};

use kalsa_catalog::{DownloadFile, DownloadPlan};
use kalsa_download::{default_roots, download, ensure_space};
use kalsa_reuse::find_reusable;

use crate::failure::StartupFailure;
use crate::startup::{file_digest_is, Progress};

/// The plan's files where they answer from: the weights, and the drafter
/// when placing it succeeded. Every path handed back is the digest-verified
/// file.
#[derive(Debug, PartialEq)]
pub(crate) struct PlacedModel {
    pub(crate) weights: PathBuf,
    pub(crate) drafter: Option<PathBuf>,
}

/// Puts the plan's files on disk, against their digests. The plan is not
/// optional: the catalog's pick always carries its file's address.
pub(crate) fn place_model(
    plan: &DownloadPlan,
    root: &Path,
    consented: bool,
    progress: &mut dyn FnMut(Progress),
) -> Result<PlacedModel, StartupFailure> {
    acquire_model(
        plan,
        &root.join("models"),
        &default_roots(),
        consented,
        progress,
    )
}

/// Puts the plan's files on disk, against their digests. The consent gate
/// comes first, before the disk is even looked at: without the owner's
/// stored pick no copy — here or in another program's store — is used and no
/// byte is fetched. Each file is then proven present (this app's copy
/// re-hashed, or a digest-verified copy in another program's store, searched
/// cheap pass first — `kalsa-reuse`: stores that NAME blobs by their digest
/// cost a stat, and the store whose name claims our digest is read once to
/// confirm — with `find_local` underneath for stores that name files like
/// files) or fetched into the same models directory, the weights first and
/// the drafter after. `roots` is handed in rather than taken from the
/// environment so the search is a fact a test can pin.
///
/// When the weights still have to move, the room for everything that would
/// move with them is asked once, before the first byte of any of it — each
/// file's ask shrunk by the bytes already in its `.part`, the same
/// arithmetic the download applies — and a drafter that does not fit beside
/// the weights is skipped, not the model. Progress reports ONE total, and
/// only for the files that will actually place: a fully proven plan says
/// nothing at all, a drafter skipped up front never enters the total, and a
/// drafter lost mid-transfer closes the bar at what did place. The first
/// reading of a real transfer stays the walk's zero-fire.
fn acquire_model(
    plan: &DownloadPlan,
    models_dir: &Path,
    roots: &[PathBuf],
    consented: bool,
    progress: &mut dyn FnMut(Progress),
) -> Result<PlacedModel, StartupFailure> {
    let weights_name = plan_file_name(&plan.url)?;
    // A model is used or fetched only for the owner's stored pick — the
    // automatic pick with nothing stored stops here, before the disk is
    // consulted at all.
    if !consented {
        return Err(StartupFailure::AwaitingChoice);
    }
    let weights_path = models_dir.join(weights_name);
    let weights_proven = proven_file(&weights_path, plan.bytes, plan.sha256, roots);
    let mut drafter = drafter_of(plan, models_dir);
    let drafter_proven = drafter
        .as_ref()
        .and_then(|(path, file)| proven_file(path, file.bytes, file.sha256, roots));
    // A drafter that failed its digest within a day is not fetched again:
    // the pin was wrong against these bytes once, and a retry a start later
    // would only repeat it. Silent on purpose — the launch proceeds as any
    // without-MTP start does.
    if let Some((path, file)) = drafter.as_ref() {
        if drafter_proven.is_none() && drafter_recently_failed(path, file.sha256) {
            drafter = None;
        }
    }
    if weights_proven.is_none() {
        // The weights alone are the hard requirement: a drafter that does
        // not fit beside them is skipped and retried on the next start,
        // never allowed to refuse a model this disk can hold.
        let weights = (weights_path.clone(), plan.bytes);
        if let Some((drafter_path, file)) = drafter.as_ref().filter(|_| drafter_proven.is_none()) {
            let skip = match ensure_space(
                models_dir,
                &[weights.clone(), (drafter_path.clone(), file.bytes)],
            ) {
                Ok(()) => false,
                Err(kalsa_download::DownloadError::NotEnoughSpace { .. }) => {
                    log::warn!("no room for the drafter beside the weights; starting without it");
                    true
                }
                Err(other) => {
                    // A probe that cannot ask is not an answer about room:
                    // the real error is said, and the weights-only probe
                    // below decides the start on its own.
                    log::warn!(
                        "could not ask the disk about room for the drafter ({other}); starting without it"
                    );
                    true
                }
            };
            if skip {
                ensure_space(models_dir, &[weights]).map_err(StartupFailure::from)?;
                drafter = None;
            }
        }
    }
    let total = plan
        .bytes
        .saturating_add(drafter.as_ref().map_or(0, |(_, file)| file.bytes));
    let weights_move = weights_proven.is_none();
    let drafter_move = drafter.is_some() && drafter_proven.is_none();
    let mut done = 0u64;
    if weights_move || drafter_move {
        // The zero-fire, only when a transfer follows. Its readings start at
        // zero over the total of what will place; bytes already proven show
        // up as the offset the transfers report from, never announced on
        // their own.
        progress(Progress::ModelBytes { done, total });
    }
    let weights = match weights_proven {
        Some(path) => {
            done += plan.bytes;
            path
        }
        None => {
            fetch_file(
                &plan.url,
                &weights_path,
                plan.bytes,
                plan.sha256,
                done,
                total,
                progress,
            )?;
            done += plan.bytes;
            weights_path
        }
    };
    let drafter = match (drafter, drafter_proven) {
        (Some((path, file)), None) => {
            match fetch_file(
                &file.url,
                &path,
                file.bytes,
                file.sha256,
                done,
                total,
                progress,
            ) {
                Ok(()) => {
                    let _ = std::fs::remove_file(failed_marker(&path));
                    Some(path)
                }
                // A drafter that cannot be placed never fails the start:
                // the weights run without it and the next start tries again.
                Err(fault) => {
                    // Only a discarded-part fault is remembered: a network
                    // error keeps its `.part` for the resume and costs the
                    // next start only the remaining bytes.
                    if matches!(fault, StartupFailure::DownloadCorrupted) {
                        mark_drafter_failed(&path, file.sha256);
                    }
                    log::warn!("the drafter could not be placed ({fault:?}); starting without it");
                    // The promised total shrank with the drafter: close the
                    // bar at what did place, so the stream's last reading is
                    // a complete one.
                    progress(Progress::ModelBytes { done, total: done });
                    None
                }
            }
        }
        (_, Some(path)) => Some(path),
        (None, None) => None,
    };
    Ok(PlacedModel { weights, drafter })
}

/// A drafter that failed its digest is not retried for a day: the marker
/// beside its would-be file holds when it failed and the pin it failed
/// against, so a permanently wrong pin costs one download a day instead of
/// one per start. A changed pin ignores it, and a placement that succeeds
/// removes it.
const DRAFTER_RETRY_SECONDS: u64 = 24 * 60 * 60;

fn failed_marker(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .map(|name| name.to_os_string())
        .unwrap_or_default();
    name.push(".failed");
    path.with_file_name(name)
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_secs())
}

/// Whether this exact pin failed its digest recently enough that fetching it
/// again today would only repeat it.
fn drafter_recently_failed(path: &Path, sha256: &str) -> bool {
    let Ok(marker) = std::fs::read_to_string(failed_marker(path)) else {
        return false;
    };
    let mut fields = marker.split_whitespace();
    let (Some(at), Some(pinned)) = (fields.next(), fields.next()) else {
        return false;
    };
    let Ok(at) = at.parse::<u64>() else {
        return false;
    };
    // A marker time in the future is a clock that was ahead, not a failure
    // worth waiting for: it reads as stale, so MTP is never suppressed
    // until the clock catches up and a day passes on top of it.
    let now = unix_now();
    pinned == sha256 && at <= now && now - at < DRAFTER_RETRY_SECONDS
}

fn mark_drafter_failed(path: &Path, sha256: &str) {
    let _ = std::fs::write(failed_marker(path), format!("{} {sha256}", unix_now()));
}

/// The drafter's destination and its pin, when the plan carries one and its
/// address names a file: a name it cannot answer to launches without it.
fn drafter_of<'a>(
    plan: &'a DownloadPlan,
    models_dir: &Path,
) -> Option<(PathBuf, &'a DownloadFile)> {
    let file = plan.drafter.as_ref()?;
    match plan_file_name(&file.url) {
        Ok(name) => Some((models_dir.join(name), file)),
        Err(_) => {
            log::warn!("the drafter's address does not name a plain file; starting without it");
            None
        }
    }
}

/// The file name a pinned address must end with — a plain name: no path
/// separator and no `..`, so a plan's address cannot write outside the
/// models directory. A `?query` or `#fragment` is the address's, not the
/// file's, so it is cut before the name is taken — a signed URL would
/// otherwise put its token into a file name. Anything else that is not a
/// plain name is refused rather than guessed at.
fn plan_file_name(url: &str) -> Result<&str, StartupFailure> {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    match path.rsplit('/').next() {
        Some(name) if !name.is_empty() && !name.contains(['/', '\\']) && name != ".." => Ok(name),
        _ => Err(StartupFailure::WeightsUnverified),
    }
}

/// One pinned file already proven on this disk: this app's own copy,
/// re-hashed, or a digest-verified copy in another program's store. `None`
/// means the promised bytes are not here and must be fetched.
fn proven_file(path: &Path, bytes: u64, sha256: &str, roots: &[PathBuf]) -> Option<PathBuf> {
    if file_digest_is(path, bytes, sha256) {
        return Some(path.to_path_buf());
    }
    find_reusable(roots, bytes, sha256)
}

/// One file fetched into `path`, its progress relayed into the plan's one
/// total at the offset of everything already accounted for. The fetch's
/// three facts land in the log: the start, the finish with its duration,
/// and the fault — so a stuck or repeated download reads off the file.
fn fetch_file(
    url: &str,
    path: &Path,
    bytes: u64,
    sha256: &str,
    base: u64,
    total: u64,
    progress: &mut dyn FnMut(Progress),
) -> Result<(), StartupFailure> {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| url.to_string());
    let started = std::time::Instant::now();
    log::info!("download start: {name} ({bytes} bytes)");
    let mut relay = |p: kalsa_download::Progress| {
        progress(Progress::ModelBytes {
            done: base + p.bytes_done,
            total,
        });
    };
    let placed = download(url, path, bytes, sha256, &mut relay);
    match placed {
        Ok(()) => {
            log::info!(
                "download done: {name} ({bytes} bytes in {:.1}s)",
                started.elapsed().as_secs_f64()
            );
            // The download's own publish step just read these bytes whole
            // and matched the pin, so the record beside the file spares the
            // next launch the same read.
            if let Some(stamp) = std::fs::metadata(path)
                .ok()
                .and_then(|meta| crate::verified::Stamp::of(&meta))
            {
                crate::verified::record(path, sha256, &stamp);
            }
            Ok(())
        }
        Err(fault) => {
            log::warn!("download failed: {name}: {fault}");
            Err(fault.into())
        }
    }
}

#[cfg(test)]
mod tests;
