//! The one question this crate answers: which server build runs on this
//! machine, proven, ready to start.
//!
//! The order of the walk is the product promise: detection narrows, the
//! persisted verdict short-circuits everything, and only otherwise does a
//! candidate get fetched and probed — a few megabytes and, at worst, under a
//! minute, once per machine. Nothing here decides which MODEL to run; that
//! is the catalog's, and it starts from the `Decision` this returns.

use std::fmt;
use std::path::{Path, PathBuf};

use kalsa_download::Progress;
use kalsa_probe::Backend;
use kalsa_supervisor::DEFAULT_STOP_GRACE;

use crate::assets::{Platform, ServerBackend};
use crate::candidates_for;
use crate::child::{self, Launch, OsLaunch};
use crate::probe::{self, ProbeParams};
use crate::store::{self, StoreError};
use crate::verdict::{self, Verdict};

/// The build this machine should run, and where it is.
#[derive(Clone, Debug)]
pub struct Decision {
    pub backend: ServerBackend,
    /// A llama-server that answered `/health` on this machine — now, or when
    /// the persisted verdict was recorded.
    pub exe: PathBuf,
}

/// Why no build is running yet. Every variant is user-facing copy.
#[derive(Debug)]
pub enum DecideError {
    /// The release digests are still placeholders: nothing downloads, by
    /// design, until they are verified.
    UnverifiedAssets,
    /// No server build is published for this platform at all.
    NoBuildForThisMachine,
    /// A build or the probe model could not be put on disk.
    CannotAcquire(String),
    /// Every candidate was fetched (where possible) and every candidate
    /// failed the probe. The reasons are the candidates' own words.
    NothingWorked {
        attempts: Vec<(ServerBackend, String)>,
    },
}

impl fmt::Display for DecideError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DecideError::UnverifiedAssets => write!(
                f,
                "the server builds are not verified against the release yet, so nothing \
                 can be downloaded"
            ),
            DecideError::NoBuildForThisMachine => {
                write!(f, "no server build is published for this platform")
            }
            DecideError::CannotAcquire(reason) => write!(f, "could not fetch the server: {reason}"),
            DecideError::NothingWorked { attempts } => {
                write!(f, "no server build works on this machine:")?;
                for (backend, reason) in attempts {
                    write!(f, "\n  {} — {reason}", backend.name())?;
                }
                Ok(())
            }
        }
    }
}

/// Decides for this machine, using the real store and real processes.
/// Blocking on purpose: call it from a background thread.
pub fn decide(
    detected: Backend,
    progress: &mut dyn FnMut(Progress),
) -> Result<Decision, DecideError> {
    decide_in(
        &store::root(),
        Platform::current(),
        detected,
        &OsLaunch,
        progress,
    )
}

/// The whole walk, with the store root and the process launcher injected.
pub(crate) fn decide_in(
    root: &Path,
    platform: Option<Platform>,
    detected: Backend,
    launch: &dyn Launch,
    progress: &mut dyn FnMut(Progress),
) -> Result<Decision, DecideError> {
    let Some(platform) = platform else {
        return Err(DecideError::NoBuildForThisMachine);
    };
    // A probe child left behind by a force-quit holds a port and a model we
    // will not reuse; the state file's inherited lock is what makes it ours
    // to kill. Done before anything else, so the machine starts clean.
    child::reap_orphan(&state_file(root), DEFAULT_STOP_GRACE);

    // The machine's standing answer, while it still describes what was
    // proven: this build's bytes, on this machine.
    if let Some(verdict) = verdict::load(root) {
        if verdict.fingerprint == verdict::fingerprint(platform, verdict.backend, detected) {
            if let Ok(exe) = store::ensure_backend(root, platform, verdict.backend, progress) {
                return Ok(Decision {
                    backend: verdict.backend,
                    exe,
                });
            }
            // Its build is gone from disk: decide again from the top.
        }
    }
    let model = store::ensure_probe_model(root, progress).map_err(map_store_error)?;
    let port = probe::free_loopback_port()
        .map_err(|e| DecideError::CannotAcquire(format!("no free loopback port: {e}")))?;
    let params = ProbeParams::for_port(port);

    let mut attempts = Vec::new();
    for backend in candidates_for(Some(platform), detected) {
        let exe = match store::ensure_backend(root, platform, backend, progress) {
            Ok(exe) => exe,
            Err(e) => {
                attempts.push((backend, e.to_string()));
                continue;
            }
        };
        match probe::probe(launch, &exe, &model, &params, &state_file(root)) {
            Ok(()) => {
                // Best effort: a failed save costs seconds on the next start,
                // never correctness.
                let _ = verdict::save(
                    root,
                    &Verdict {
                        backend,
                        fingerprint: verdict::fingerprint(platform, backend, detected),
                    },
                );
                return Ok(Decision { backend, exe });
            }
            Err(reason) => attempts.push((backend, reason)),
        }
    }
    Err(DecideError::NothingWorked { attempts })
}

fn map_store_error(e: StoreError) -> DecideError {
    match e {
        StoreError::Unverified => DecideError::UnverifiedAssets,
        other => DecideError::CannotAcquire(other.to_string()),
    }
}

fn state_file(root: &Path) -> PathBuf {
    root.join("probe.state")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-runtime-decide-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    #[test]
    fn a_platform_with_no_build_is_reported_not_improvised() {
        let root = scratch("no-platform");
        let err = decide_in(&root, None, Backend::Cpu, &OsLaunch, &mut |_| {})
            .expect_err("nothing is published for it");
        assert!(matches!(err, DecideError::NoBuildForThisMachine), "{err}");
        assert_eq!(
            std::fs::read_dir(&root).expect("root").count(),
            0,
            "the refusal must not touch the disk"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unverified_row_is_a_refusal_to_download() {
        // The refusal mechanism is pinned at the store, against a fixture
        // the store test owns; here, only the mapping to user-facing copy.
        assert!(matches!(
            map_store_error(StoreError::Unverified),
            DecideError::UnverifiedAssets
        ));
        assert!(matches!(
            map_store_error(StoreError::NoExecutable),
            DecideError::CannotAcquire(_)
        ));
    }
}
