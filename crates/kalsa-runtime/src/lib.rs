//! Which `llama-server` build this machine should run, and proof that it
//! works.
//!
//! The product bundles llama.cpp's server and runs it as a child on loopback;
//! the user installs one thing and answers no questions. This crate decides
//! which build this machine gets, fetches it, and — before anything downloads
//! gigabytes of model weights — proves it actually runs here.
//!
//! The order of the whole story is the safety story:
//!
//! 1. detection (`kalsa_probe::Backend`) narrows the [`candidates_for`];
//! 2. a saved [`Decision`] short-circuits everything while its fingerprint
//!    still describes this machine (hardware, driver, release);
//! 3. otherwise each candidate is fetched through `kalsa-download` — size and
//!    sha256 are promises, and nothing downloads until they are verified
//!    against the release — then launched as a disposable child with a tiny
//!    model and a deadline ([`decide`] walks the list, first candidate whose
//!    server answers `/health` wins, and the verdict is saved).
//!
//! Detection only narrows because GPU backends do not always fail cleanly:
//! a missing DLL kills the process before the server starts, and a build
//! refused at device init exits rather than answering. Only a child that
//! answers is proof.
//!
//! Blocking on purpose: this runs on a background thread, and an async
//! runtime would be a dependency on the one thing an old machine cannot
//! spare. Out of scope by design: model selection (`kalsa-catalog`), the UI,
//! the tunnel, the thermal net.

mod assets;
mod candidates;
mod child;
mod decide;
mod disposable;
mod extract;
mod inlet;
mod marker;
mod probe;
mod store;
mod verdict;

/// The per-user directory this crate keeps builds, archives and models in:
/// the shell places the chosen model here so one directory tells the whole
/// story of what is on this machine.
pub fn runtime_root() -> std::path::PathBuf {
    store::root()
}

/// The engine's consent-screen facts for one platform and backend, read
/// from the release table and the store without fetching anything: the
/// exact published bytes a missing engine costs (its archives plus the
/// probe model), and whether a whole build for it already sits on disk.
/// `None` when the release table itself is unverified — sizes nobody
/// pinned are sizes nobody can promise.
pub fn engine_facts(platform: Platform, backend: ServerBackend) -> Option<(u64, bool)> {
    let assets = assets::assets_for(platform, backend);
    let probe = assets::probe_model();
    let mut total = 0u64;
    for asset in assets.iter().chain(std::iter::once(&probe)) {
        if !asset.verified() {
            return None;
        }
        total += asset.size_bytes?;
    }
    let dir = store::builds_dir(&store::root(), backend);
    let runtime: Vec<(&str, &str)> = assets
        .iter()
        .map(|asset| (asset.file, asset.sha256.unwrap_or_default()))
        .collect();
    let table_exe = assets
        .iter()
        .find(|asset| asset.role == assets::Role::Engine)
        .and_then(|asset| asset.exe_sha256);
    let on_disk = marker::validate(&dir, &runtime, table_exe).is_some();
    Some((total, on_disk))
}

pub use assets::{Platform, ServerBackend};
pub use candidates::candidates_for;
pub use decide::{decide, decide_cpu, DecideError, Decision};
pub use disposable::{free_loopback_port, serve, Disposable, ServeError};
pub use inlet::{engine_consumes_private_headers, ENGINE_MODULE_FILE};
// Engine identity, one source: the verdict's own fingerprint format, for
// anything that must move when the verdict would (the tune record).
pub use verdict::fingerprint;
