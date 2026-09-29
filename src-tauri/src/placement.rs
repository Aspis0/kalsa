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
/// the weights is skipped, not the model. Progress reports ONE total for
/// the whole plan, and only when something will move: a fully proven plan
/// says nothing at all, so the page never announces bytes that were already
/// placed and verified, and the first reading of a real transfer stays the
/// walk's zero-fire.
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
    if weights_proven.is_none() {
        // The weights alone are the hard requirement: a drafter that does
        // not fit beside them is skipped and retried on the next start,
        // never allowed to refuse a model this disk can hold.
        let weights = (weights_path.clone(), plan.bytes);
        let beside = drafter
            .as_ref()
            .filter(|_| drafter_proven.is_none())
            .map(|(path, file)| (path.clone(), file.bytes));
        let fits_together = beside.as_ref().is_none_or(|drafter_file| {
            ensure_space(models_dir, &[weights.clone(), drafter_file.clone()]).is_ok()
        });
        if !fits_together {
            ensure_space(models_dir, &[weights]).map_err(StartupFailure::from)?;
            eprintln!(
                "kalsa-brain: no room for the drafter beside the weights; starting without it"
            );
            drafter = None;
        }
    }
    let total = plan.total_bytes();
    let weights_move = weights_proven.is_none();
    let drafter_move = drafter.is_some() && drafter_proven.is_none();
    let mut done = 0u64;
    if weights_move || drafter_move {
        // The zero-fire, only when a transfer follows. Its readings start at
        // zero over the plan's one total; bytes already proven show up as
        // the offset the transfers report from, never announced on their
        // own.
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
                Ok(()) => Some(path),
                // A drafter that cannot be placed never fails the start:
                // the weights run without it and the next start tries again.
                Err(fault) => {
                    eprintln!(
                        "kalsa-brain: the drafter could not be placed ({fault:?}); starting without it"
                    );
                    None
                }
            }
        }
        (_, Some(path)) => Some(path),
        (None, None) => None,
    };
    Ok(PlacedModel { weights, drafter })
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
        Err(fault) => {
            eprintln!(
                "kalsa-brain: the drafter's address is not a file name ({fault:?}); starting without it"
            );
            None
        }
    }
}

/// The file name a pinned address must end with — a plain name: no path
/// separator and no `..`, so a plan's address cannot write outside the
/// models directory. Anything else is refused rather than guessed at.
fn plan_file_name(url: &str) -> Result<&str, StartupFailure> {
    match url.rsplit('/').next() {
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
/// total at the offset of everything already accounted for.
fn fetch_file(
    url: &str,
    path: &Path,
    bytes: u64,
    sha256: &str,
    base: u64,
    total: u64,
    progress: &mut dyn FnMut(Progress),
) -> Result<(), StartupFailure> {
    let mut relay = |p: kalsa_download::Progress| {
        progress(Progress::ModelBytes {
            done: base + p.bytes_done,
            total,
        });
    };
    download(url, path, bytes, sha256, &mut relay).map_err(StartupFailure::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_catalog::rows;
    use sha2::{Digest, Sha256};
    use std::io::Write;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-brain-placement-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn digest_of(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// Writes `bytes` under `rel` below `root`, creating directories — the
    /// test-side twin of what ollama, LM Studio or a hub cache has on disk.
    fn planted(root: &std::path::Path, rel: &[&str], bytes: &[u8]) -> PathBuf {
        let mut path = root.to_path_buf();
        for part in rel {
            path = path.join(part);
        }
        std::fs::create_dir_all(path.parent().expect("parent")).expect("mkdirs");
        std::fs::write(&path, bytes).expect("write");
        path
    }

    /// A loopback HTTP server answering every request with the same body:
    /// what a HuggingFace resolve endpoint looks like to this walk, without
    /// touching a real network.
    fn serve(
        body: &'static [u8],
        file: &str,
    ) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let requests = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = std::sync::Arc::clone(&requests);
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let mut buf = [0u8; 1024];
                let _ = std::io::Read::read(&mut stream, &mut buf);
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(body);
                let _ = stream.flush();
            }
        });
        (format!("http://{addr}/{file}"), requests)
    }

    // The loopback bodies and their digests, both constants: the plan's
    // digest field is 'static because the catalog's rows are, so the test
    // does the same thing a row does — pins bytes to a digest known in
    // advance.
    const PLAN_BODY: &[u8] = b"kalsa-brain loopback weights for the download plan test";
    const PLAN_SHA256: &str = "44dff4aa25ed679690893bf2e5b6f68362763235d2b136c980b7da9c147ef626";
    const DRAFTER_BODY: &[u8] = b"kalsa-brain loopback drafter for the download plan test";
    const DRAFTER_SHA256: &str = "9393736b554ca60cd555c0c9ea4104988ef92531db290000d20a5bf74426cb7f";

    fn requests_of(server: &std::sync::Arc<std::sync::atomic::AtomicUsize>) -> usize {
        server.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// The cheap pass over digest-named stores answers BEFORE the generic
    /// scan can reach an equally valid, friendly-named copy in an earlier
    /// root. Both copies hold the exact pinned bytes, so every byte of the
    /// answer is correct either way — this pins WHO answers: a store that
    /// names its blob by the digest is settled by a stat and one confirming
    /// read, and removing the reuse pass (falling back to find_local alone)
    /// turns this red, because the generic engine would return the
    /// friendly-named copy it meets first.
    #[test]
    fn a_digest_named_store_is_reused_before_the_generic_scan_answers() {
        let digest = digest_of(PLAN_BODY);
        let friendly_root = scratch("reuse-friendly");
        let blob_root = scratch("reuse-blobs");
        let friendly = planted(
            &friendly_root,
            &["pub", "unsloth", "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"],
            PLAN_BODY,
        );
        let blob = planted(
            &blob_root,
            &["models", "blobs", &format!("sha256-{digest}")],
            PLAN_BODY,
        );
        let root = scratch("reuse-plan");
        let plan = DownloadPlan {
            url: "https://huggingface.co/example/resolve/0123/weights.gguf".to_string(),
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: None,
        };
        let found = acquire_model(
            &plan,
            &root.join("models"),
            &[friendly_root.clone(), blob_root.clone()],
            true,
            &mut |_| {},
        )
        .expect("the pinned copy in the digest store is on this disk");
        assert_eq!(
            found.weights, blob,
            "the cheap pass must answer first, not {:?}",
            found.weights
        );
        assert_ne!(found.weights, friendly);
        assert!(found.drafter.is_none());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&friendly_root);
        let _ = std::fs::remove_dir_all(&blob_root);
    }

    /// The reuse pass's own promise, kept at the call site: a blob whose
    /// right name lies about its bytes (a torn pull) is refused by the cheap
    /// pass, and that "no" is an optimization failing, not a verdict — the
    /// generic engine underneath still finds the honest copy, named like a
    /// file, in another store. No download is attempted: the plan's URL
    /// points nowhere, so an attempted fetch would fail loudly here.
    #[test]
    fn a_failed_fast_pass_falls_through_to_the_generic_scan() {
        let digest = digest_of(PLAN_BODY);
        let mut torn = PLAN_BODY.to_vec();
        let last = torn.len() - 1;
        torn[last] ^= 0xff;
        let blob_root = scratch("reuse-torn");
        let friendly_root = scratch("reuse-honest");
        planted(
            &blob_root,
            &["models", "blobs", &format!("sha256-{digest}")],
            &torn,
        );
        let friendly = planted(
            &friendly_root,
            &["models", "publisher", "weights.gguf"],
            PLAN_BODY,
        );
        let root = scratch("reuse-fallthrough");
        let plan = DownloadPlan {
            url: "https://huggingface.co/example/resolve/0123/weights.gguf".to_string(),
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: None,
        };
        let found = acquire_model(
            &plan,
            &root.join("models"),
            &[blob_root.clone(), friendly_root.clone()],
            true,
            &mut |_| {},
        )
        .expect("the honest copy is still found");
        assert_eq!(found.weights, friendly);
        assert!(
            !root.join("models").join("weights.gguf").exists(),
            "nothing was downloaded: reuse answered"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&friendly_root);
        let _ = std::fs::remove_dir_all(&blob_root);
    }

    #[test]
    fn the_placement_stops_when_the_model_is_not_consented() {
        // The download gate: without a stored choice a fetch is refused
        // with a distinct verdict and costs zero bytes; with it the file is
        // fetched and digest-verified as always. The gate holds before the
        // disk is consulted, so a copy already here is not consent either.
        let (url, requests) = serve(PLAN_BODY, "stories260K.gguf");
        let root = scratch("ask-placement");
        let plan = DownloadPlan {
            url: url.clone(),
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: None,
        };
        let stopped = place_model(&plan, &root, false, &mut |_| {})
            .expect_err("nothing consents here: the walk waits");
        assert!(
            matches!(stopped, StartupFailure::AwaitingChoice),
            "a distinct verdict, not a download failure: {stopped:?}"
        );
        assert_eq!(
            requests_of(&requests),
            0,
            "the gate must cost no bytes: the download was never called"
        );
        let placed = place_model(&plan, &root, true, &mut |_| {}).expect("downloaded");
        assert_eq!(std::fs::read(&placed.weights).expect("read"), PLAN_BODY);
        let again = place_model(&plan, &root, false, &mut |_| {})
            .expect_err("the file on disk is not the owner's pick");
        assert!(matches!(again, StartupFailure::AwaitingChoice), "{again:?}");
        assert_eq!(
            requests_of(&requests),
            1,
            "one fetch in the whole test: the gate held for the copy on disk too"
        );
    }

    #[test]
    fn a_stale_choice_places_nothing_not_even_a_copy_that_is_already_here() {
        // The gate against a file that is already on disk: a row the stored
        // token does not name is not placed from a local copy either. The
        // stub behind the loopback URL counts requests, so a broken gate
        // would show up here as bytes — and the catalog is never asked.
        let (url, requests) = serve(PLAN_BODY, "stories260K.gguf");
        let root = scratch("stale-local-copy");
        let models = root.join("models");
        std::fs::create_dir_all(&models).expect("mkdir");
        let plan = DownloadPlan {
            url,
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: None,
        };
        let local = models.join(plan.url.rsplit('/').next().expect("a file name"));
        std::fs::write(&local, PLAN_BODY).expect("the copy already here");

        let row = rows().next().expect("the catalog carries rows");
        let stopped = place_model(
            &plan,
            &root,
            crate::startup::consented(Some("not-a-token"), row),
            &mut |_| {},
        )
        .expect_err("a row nobody picked is not placed, not even from disk");
        assert!(
            matches!(stopped, StartupFailure::AwaitingChoice),
            "{stopped:?}"
        );
        assert_eq!(requests_of(&requests), 0, "no request was made");
        assert_eq!(
            std::fs::read(&local).expect("the copy is still there"),
            PLAN_BODY,
            "and it is untouched"
        );
    }

    #[test]
    fn a_plan_downloads_the_weights_and_verifies_the_digest() {
        let (url, requests) = serve(PLAN_BODY, "stories260K.gguf");
        let root = scratch("plan");
        let plan = DownloadPlan {
            url,
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: None,
        };
        let placed = place_model(&plan, &root, true, &mut |_| {}).expect("downloaded");
        assert_eq!(
            std::fs::read(&placed.weights).expect("read"),
            PLAN_BODY,
            "what landed is what the digest promised"
        );
        assert_eq!(digest_of(PLAN_BODY), PLAN_SHA256);
        // A second pass with the file already on disk downloads nothing: the
        // on-disk bytes are re-hashed, and the server must not be asked again.
        let again = place_model(&plan, &root, true, &mut |_| {}).expect("from disk");
        assert_eq!(again, placed);
        assert_eq!(
            requests_of(&requests),
            1,
            "the second pass must be served from disk, not the wire"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_weights_download_that_does_not_match_the_digest_is_thrown_away() {
        let body = &b"bytes a hostile link would serve"[..];
        let (url, _addr) = serve(body, "stories260K.gguf");
        let root = scratch("corrupt");
        let plan = DownloadPlan {
            url,
            bytes: body.len() as u64,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            drafter: None,
        };
        let err =
            place_model(&plan, &root, true, &mut |_| {}).expect_err("the digest is the promise");
        assert!(matches!(err, StartupFailure::DownloadCorrupted), "{err:?}");
        assert!(
            !root.join("models").join("stories260K.gguf").exists(),
            "a corrupt download must not become the model"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_drafter_that_does_not_fit_is_skipped_and_the_weights_place() {
        // The weights alone fit this disk, the drafter beside them does not:
        // the weights place, the drafter is skipped, and the start proceeds
        // without MTP — the drafter is retried on the next start.
        let (url, requests) = serve(PLAN_BODY, "weights.gguf");
        let root = scratch("space-skip");
        let plan = DownloadPlan {
            url,
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: Some(DownloadFile {
                url: "https://unused.invalid/mtp-gemma-4-12B-it-Q8_0.gguf".to_string(),
                bytes: u64::MAX / 2,
                sha256: "0000000000000000000000000000000000000000000000000000000000000000",
            }),
        };
        let placed = place_model(&plan, &root, true, &mut |_| {})
            .expect("the weights are the model, and they fit");
        assert_eq!(
            std::fs::read(&placed.weights).expect("read"),
            PLAN_BODY,
            "the weights landed"
        );
        assert!(
            placed.drafter.is_none(),
            "a drafter with no room is skipped, not the model"
        );
        assert_eq!(requests_of(&requests), 1, "only the weights were fetched");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_drafter_that_fails_its_digest_is_skipped_without_a_part() {
        // The owner's rule: a drafter that cannot be placed never fails the
        // start. Here the wire serves the wrong bytes — the weights verify,
        // the drafter does not, nothing of it survives, and the answer is a
        // start without MTP.
        let (url, _requests) = serve(PLAN_BODY, "weights.gguf");
        let (wrong_drafter, _ignored) = serve(b"not the drafter the pin promised", "mtp.gguf");
        let root = scratch("drafter-corrupt");
        let plan = DownloadPlan {
            url,
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: Some(DownloadFile {
                url: wrong_drafter,
                bytes: b"not the drafter the pin promised".len() as u64,
                sha256: DRAFTER_SHA256,
            }),
        };
        let placed = place_model(&plan, &root, true, &mut |_| {})
            .expect("the weights are placed; the drafter is not the model");
        assert!(placed.weights.is_file());
        assert!(placed.drafter.is_none(), "the failed drafter is skipped");
        assert!(
            !root.join("models").join("mtp.gguf").exists(),
            "a failed drafter must not become a file"
        );
        assert!(
            !root.join("models").join("mtp.gguf.part").exists(),
            "and its mismatched part is thrown away, not kept"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_drafter_beside_present_weights_is_fetched_alone() {
        // The weights proven on disk and the drafter not: only the drafter
        // is fetched, after the weights, into the same models directory —
        // and once both are proven, neither is asked for again.
        let root = scratch("drafter-only");
        let models = root.join("models");
        std::fs::create_dir_all(&models).expect("mkdir");
        std::fs::write(models.join("weights.gguf"), PLAN_BODY).expect("the weights are here");
        let (drafter_url, drafter_requests) = serve(DRAFTER_BODY, "mtp-weights.gguf");
        let plan = DownloadPlan {
            url: "https://unused.invalid/weights.gguf".to_string(),
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: Some(DownloadFile {
                url: drafter_url,
                bytes: DRAFTER_BODY.len() as u64,
                sha256: DRAFTER_SHA256,
            }),
        };
        let placed = place_model(&plan, &root, true, &mut |_| {}).expect("only the drafter moves");
        assert_eq!(placed.weights, models.join("weights.gguf"));
        assert_eq!(
            placed.drafter.as_ref().expect("the drafter is placed"),
            &models.join("mtp-weights.gguf")
        );
        assert_eq!(
            std::fs::read(models.join("mtp-weights.gguf")).expect("read"),
            DRAFTER_BODY
        );
        assert_eq!(
            requests_of(&drafter_requests),
            1,
            "one fetch for the drafter, none for the weights"
        );
        let again = place_model(&plan, &root, true, &mut |_| {}).expect("both proven");
        assert_eq!(again.weights, placed.weights);
        assert_eq!(again.drafter, placed.drafter);
        assert_eq!(
            requests_of(&drafter_requests),
            1,
            "a proven drafter is never re-fetched"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_fully_proven_plan_reports_no_bytes() {
        // The old contract, restored: nothing moves, nothing is announced.
        // A progress line for an already-placed plan reads on the page as a
        // model re-downloading its own bytes, resumed or complete.
        let root = scratch("silent");
        let models = root.join("models");
        std::fs::create_dir_all(&models).expect("mkdir");
        std::fs::write(models.join("weights.gguf"), PLAN_BODY).expect("weights");
        std::fs::write(models.join("mtp.gguf"), DRAFTER_BODY).expect("drafter");
        let (url, requests) = serve(PLAN_BODY, "weights.gguf");
        let (drafter_url, drafter_requests) = serve(DRAFTER_BODY, "mtp.gguf");
        let plan = DownloadPlan {
            url,
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: Some(DownloadFile {
                url: drafter_url,
                bytes: DRAFTER_BODY.len() as u64,
                sha256: DRAFTER_SHA256,
            }),
        };
        let mut readings = 0u32;
        let placed = place_model(&plan, &root, true, &mut |_| readings += 1)
            .expect("both files answer from disk");
        assert_eq!(readings, 0, "a fully proven plan says nothing at all");
        assert!(placed.drafter.is_some());
        assert_eq!(requests_of(&requests), 0);
        assert_eq!(requests_of(&drafter_requests), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_plan_reports_one_total_for_both_files() {
        // One number for the whole plan: every reading the page sees carries
        // the weights-plus-drafter total, starting at the zero-fire and
        // closing at the full plan.
        let (url, _requests) = serve(PLAN_BODY, "weights.gguf");
        let (drafter_url, _drafter_requests) = serve(DRAFTER_BODY, "mtp-weights.gguf");
        let root = scratch("one-total");
        let plan = DownloadPlan {
            url,
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
            drafter: Some(DownloadFile {
                url: drafter_url,
                bytes: DRAFTER_BODY.len() as u64,
                sha256: DRAFTER_SHA256,
            }),
        };
        let mut seen: Vec<(u64, u64)> = Vec::new();
        place_model(&plan, &root, true, &mut |step| {
            if let Progress::ModelBytes { done, total } = step {
                seen.push((done, total));
            }
        })
        .expect("both files place");
        let total = (PLAN_BODY.len() + DRAFTER_BODY.len()) as u64;
        assert_eq!(seen.first(), Some(&(0, total)), "the zero-fire opens it");
        assert!(
            seen.iter().all(|(_, reported)| *reported == total),
            "every reading carries the one total: {seen:?}"
        );
        assert_eq!(seen.last(), Some(&(total, total)), "{seen:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_plan_address_that_is_not_a_plain_name_is_refused() {
        // The name is where the file lands: an address ending in a
        // separator-riding or parent-riding name would write outside the
        // models directory, so it is refused rather than guessed at.
        assert_eq!(
            plan_file_name("https://host/dir/weights.gguf").ok(),
            Some("weights.gguf")
        );
        assert!(plan_file_name("https://host/dir/").is_err());
        assert!(plan_file_name("https://host/dir/back\\..\\weights.gguf").is_err());
        assert!(plan_file_name("https://host/dir/..").is_err());
    }
}
