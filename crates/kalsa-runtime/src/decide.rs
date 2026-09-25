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
        None,
        &OsLaunch,
        progress,
    )
}

/// Decides for this machine among the CPU builds only — the walk's fallback
/// when the graphics build wins [`decide`] but the catalog, budgeted on the
/// card's memory, has no row that fits (the Lenovo walk: an RTX 4050 with
/// 6 GiB against 32 GiB of RAM, nothing on the menu).
///
/// Restricted this way a saved GPU verdict is no answer and is skipped; a
/// saved CPU verdict short-circuits as usual — from its OWN slot
/// ([`verdict_slot`]): the fallback never writes the main verdict, so the
/// next start asks the GPU verdict first, the catalog is asked on VRAM
/// first, and a future row or margin that fits the card takes the card back
/// with no probe at all. This slot's fingerprint (build digests, detection,
/// OS, on Windows the driver version) gates it exactly as the main one does:
/// a bigger card or a driver update discards it and the whole decide runs
/// again.
pub fn decide_cpu(
    detected: Backend,
    progress: &mut dyn FnMut(Progress),
) -> Result<Decision, DecideError> {
    decide_in(
        &store::root(),
        Platform::current(),
        detected,
        Some(ServerBackend::Cpu),
        &OsLaunch,
        progress,
    )
}

/// The whole walk, with the store root and the process launcher injected.
pub(crate) fn decide_in(
    root: &Path,
    platform: Option<Platform>,
    detected: Backend,
    only: Option<ServerBackend>,
    launch: &dyn Launch,
    progress: &mut dyn FnMut(Progress),
) -> Result<Decision, DecideError> {
    let Some(platform) = platform else {
        return Err(DecideError::NoBuildForThisMachine);
    };
    // What we publish decides before anything else. A machine we identify
    // but publish no engine for — an Intel Mac today — is refused here, in
    // words, before a probe model is fetched, a directory created or a build
    // attempted. Without this the walk reaches the store with an empty asset
    // set and reports "no build works" for a build that was never offered,
    // after downloading the probe model to say it.
    let mut candidates = candidates_for(Some(platform), detected);
    // A CPU-only ask narrows the list — and rules the saved verdict below in
    // or out the same way.
    if let Some(only) = only {
        candidates.retain(|candidate| *candidate == only);
    }
    if candidates.is_empty() {
        return Err(DecideError::NoBuildForThisMachine);
    }
    // A probe child left behind by a force-quit holds a port and a model we
    // will not reuse; the state file's inherited lock is what makes it ours
    // to kill. Done before anything else, so the machine starts clean.
    child::reap_orphan(&state_file(root), DEFAULT_STOP_GRACE);

    // The machine's standing answer, while it still describes what was
    // proven: this build's bytes, on this machine.
    if let Some(verdict) = standing_verdict(root, only, platform, detected) {
        if let Ok(exe) = store::ensure_backend(root, platform, verdict.backend, progress) {
            return Ok(Decision {
                backend: verdict.backend,
                exe,
            });
        }
        // Its build is gone from disk: decide again from the top.
    }
    let model = store::ensure_probe_model(root, progress).map_err(map_store_error)?;
    let port = probe::free_loopback_port()
        .map_err(|e| DecideError::CannotAcquire(format!("no free loopback port: {e}")))?;
    let params = ProbeParams::for_port(port);

    let mut attempts = Vec::new();
    for backend in candidates {
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
                    verdict_slot(only),
                );
                return Ok(Decision { backend, exe });
            }
            Err(reason) => attempts.push((backend, reason)),
        }
    }
    Err(DecideError::NothingWorked { attempts })
}

/// The verdict file this ask reads and writes: the whole walk's own, or —
/// for the CPU-only ask, which only `decide_cpu` (the processor fallback)
/// makes — the fallback's separate slot.
///
/// The slot exists because overwriting the main verdict pinned the machine
/// to the processor forever: the fingerprint carries the build bytes,
/// detection, the OS and the driver, but NOT the catalog or the budget
/// margin, so a CPU verdict left in the main slot kept answering every start
/// even after a new row or a changed margin would have fit the card — and it
/// was saved before the CPU choice had run at all. In two slots the main
/// (GPU) verdict stands through a fallback: every start asks it first, the
/// catalog is asked on VRAM first, and a future row that fits the card is
/// used automatically. Each slot is gated by the same fingerprint as before.
fn verdict_slot(only: Option<ServerBackend>) -> verdict::Slot {
    match only {
        Some(ServerBackend::Cpu) => verdict::Slot::ProcessorFallback,
        _ => verdict::Slot::Main,
    }
}

/// The verdict that answers this ask, if it still describes this machine:
/// this slot's own file, the backend restriction, and the fingerprint — the
/// three gates the short-circuit always had, now per slot.
fn standing_verdict(
    root: &Path,
    only: Option<ServerBackend>,
    platform: Platform,
    detected: Backend,
) -> Option<Verdict> {
    let verdict = verdict::load(root, verdict_slot(only))?;
    (only.is_none_or(|backend| verdict.backend == backend)
        && verdict.fingerprint == verdict::fingerprint(platform, verdict.backend, detected))
    .then_some(verdict)
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
        let err = decide_in(&root, None, Backend::Cpu, None, &OsLaunch, &mut |_| {})
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
        assert!(matches!(err, DecideError::CannotAcquire(_)), "{err}");
        assert!(err.to_string().contains("does not match"), "{err}");
    }

    #[test]
    fn an_intel_mac_is_refused_before_anything_is_fetched_or_touched() {
        // The refusal comes before the probe model download and before any
        // build is attempted: an Intel Mac is not a machine whose build
        // failed, it is a machine we publish nothing for, and the difference
        // is the sentence the user reads.
        let root = scratch("intel-mac");
        let err = decide_in(&root, Some(Platform::MacX64), Backend::Metal, None, &OsLaunch, &mut |_| {})
            .expect_err("no engine is published for an Intel Mac");
        assert!(matches!(err, DecideError::NoBuildForThisMachine), "{err}");
        assert_eq!(
            std::fs::read_dir(&root).expect("root").count(),
            0,
            "the refusal must not download the probe model or stage a build"
        );
        let _ = std::fs::remove_dir_all(&root);
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
        let Some(expected) = assets.iter().find_map(|asset| asset.exe_sha256) else {
            eprintln!("skipping: the table names no executable for this platform");
            let _ = std::fs::remove_dir_all(&root);
            return;
        };
        let exe = root
            .join("builds")
            .join(backend.name())
            .join(crate::extract::SERVER_NAMES[0]);
        std::fs::create_dir_all(exe.parent().expect("parent")).expect("mkdirs");
        std::fs::write(&exe, server_bytes).expect("exe");
        let exe_sha = marker::sha256_file(&exe).expect("hash");
        // A build of a DIFFERENT release is the one thing this fixture must
        // not accept: the store refuses it and would replace it, so a
        // short-circuit test over it would pin a behaviour no machine has.
        // The bytes on disk come from whatever the app last installed, which
        // is an older engine until the pinned one has been downloaded.
        if !exe_sha.eq_ignore_ascii_case(expected) {
            eprintln!(
                "skipping: the build on this machine is not the release the table pins \
                 ({exe_sha} is not {expected}); a previous release is on disk"
            );
            let _ = std::fs::remove_dir_all(&root);
            return;
        }
        marker::write(exe.parent().expect("parent"), &runtime, &exe_sha).expect("marker");
        verdict::save(
            &root,
            &Verdict {
                backend,
                fingerprint: verdict::fingerprint(platform, backend, detected),
            },
            verdict::Slot::Main,
        )
        .expect("save verdict");

        let decision = decide_in(&root, Some(platform), detected, None, &NeverProbe, &mut |_| {})
            .expect("a standing verdict answers without probing");
        assert_eq!(decision.backend, backend);
        assert_eq!(decision.exe, exe, "the on-disk build is the answer");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_fallback_verdict_has_its_own_slot_and_the_main_verdict_stands() {
        // The slot both asks share, pinned at the seam: after a fallback has
        // saved its CPU answer, the main slot still holds the GPU verdict —
        // so a second start asks the GPU verdict first (and its catalog on
        // VRAM first) — while the fallback ask finds its own slot and never
        // the main one's. (Mutating `verdict_slot` to "always main" is the
        // overwrite this replaces: it reddens the load below.)
        let root = scratch("two-slots");
        let platform = Platform::WindowsX64;
        let detected = Backend::DiscreteGpu {
            vram_bytes: Some(6 << 30),
        };
        let main = Verdict {
            backend: ServerBackend::Vulkan,
            fingerprint: verdict::fingerprint(platform, ServerBackend::Vulkan, detected),
        };
        verdict::save(&root, &main, verdict_slot(None)).expect("save the main verdict");
        // What `decide_cpu` does after its probe — into its own slot.
        let fallback = Verdict {
            backend: ServerBackend::Cpu,
            fingerprint: verdict::fingerprint(platform, ServerBackend::Cpu, detected),
        };
        verdict::save(&root, &fallback, verdict_slot(Some(ServerBackend::Cpu)))
            .expect("save the fallback verdict");

        assert_eq!(
            verdict::load(&root, verdict::Slot::Main).as_ref(),
            Some(&main),
            "the fallback overwrote the main verdict"
        );
        assert_eq!(
            standing_verdict(&root, None, platform, detected).as_ref(),
            Some(&main),
            "a second start asks the GPU verdict first"
        );
        assert_eq!(
            standing_verdict(&root, Some(ServerBackend::Cpu), platform, detected).as_ref(),
            Some(&fallback),
            "the fallback ask finds its own slot"
        );
        assert_eq!(verdict_slot(None), verdict::Slot::Main);
        assert_eq!(
            verdict_slot(Some(ServerBackend::Cpu)),
            verdict::Slot::ProcessorFallback
        );
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
