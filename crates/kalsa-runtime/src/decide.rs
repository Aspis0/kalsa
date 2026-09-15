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
#[cfg(test)]
use crate::marker;
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
    use crate::child::Running;

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
        // A build contradicting the recorded digest surfaces as a fetch
        // failure carrying its own reason — distinct from a missing build,
        // and never a silent re-download.
        let err = map_store_error(StoreError::ExeMismatch);
        assert!(
            matches!(err, DecideError::CannotAcquire(_)),
            "{err}"
        );
        assert!(err.to_string().contains("does not match"), "{err}");
    }

    #[test]
    fn a_verdict_that_still_describes_this_machine_skips_the_probe() {
        // The most expensive failure this crate can have is re-probing on
        // every launch: a machine that already knows its answer would
        // re-download up to 645 MB to learn it again, and experience that as
        // an app that eats its connection. So the short-circuit is pinned
        // with the seams decide_in already takes: a build on disk in the
        // scratch root (as the store tests place one), a verdict whose
        // fingerprint matches those same inputs, and a launcher that fails
        // the test the moment the probe tries to run at all.
        let root = scratch("short-circuit");
        let platform = Platform::MacArm64;
        let backend = ServerBackend::Metal;
        let detected = Backend::Metal;

        // The build on disk is proven, not merely present: a copy of the
        // release's own server plus the marker written the way extraction
        // writes it, against this table's digests, exactly as a previous
        // run of the walk would have left it. Skipped loudly on machines
        // with no build on disk — only the release's bytes are accepted
        // now, so invented fixture bytes cannot stand in.
        let Some(server_bytes) = real_metal_server_bytes() else {
            eprintln!("skipping: no real metal build on this machine's disk");
            return;
        };
        let assets = crate::assets::assets_for(platform, backend);
        let runtime: Vec<(&str, &str)> = assets
            .iter()
            .map(|asset| (asset.file, asset.sha256.unwrap_or_default()))
            .collect();
        let exe = root
            .join("builds")
            .join(backend.name())
            .join("llama-server");
        std::fs::create_dir_all(exe.parent().expect("parent")).expect("mkdirs");
        std::fs::write(&exe, server_bytes).expect("exe");
        let exe_sha = marker::sha256_file(&exe).expect("hash");
        marker::write(exe.parent().expect("parent"), &runtime, &exe_sha).expect("marker");
        verdict::save(
            &root,
            &Verdict {
                backend,
                fingerprint: verdict::fingerprint(platform, backend, detected),
            },
        )
        .expect("save verdict");

        let decision = decide_in(&root, Some(platform), detected, &NeverProbe, &mut |_| {})
            .expect("a standing verdict answers without probing");
        assert_eq!(decision.backend, backend);
        assert_eq!(decision.exe, exe, "the on-disk build is the answer");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The release's own server bytes, copied off this machine's disk when a
    /// previous run left a build behind. The short-circuit needs a build the
    /// table accepts, and only the release's bytes hash to the recorded
    /// digest — so the fixture is a copy of them, never invented bytes.
    /// None when there is no build to copy; the caller skips loudly.
    fn real_metal_server_bytes() -> Option<Vec<u8>> {
        let dir = crate::store::root()
            .join("builds")
            .join(ServerBackend::Metal.name());
        let exe = crate::extract::find_server(&dir)?;
        std::fs::read(exe).ok()
    }

    /// A launcher whose whole job is to fail the test if the walk ever
    /// reaches the probe: a machine with a standing verdict must never
    /// launch anything.
    struct NeverProbe;

    impl Launch for NeverProbe {
        fn spawn(
            &self,
            _exe: &Path,
            _args: &[String],
            _inherit: Option<&std::fs::File>,
        ) -> std::io::Result<Box<dyn Running>> {
            panic!("the probe ran although a verdict was standing");
        }
    }
}
