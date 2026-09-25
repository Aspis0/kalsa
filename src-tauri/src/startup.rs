//! "Turn on": the walk from nothing to a supervised server.
//!
//! The order is the product: decide the backend (a standing verdict means
//! nothing is downloaded), put the chosen model on disk, start the server
//! and keep it up. It runs entirely off the main thread and reports its
//! progress as data; two presses cannot run two walks, which is the command
//! guard's job, not this file's.
//!
//! The model step follows the catalog: the choice is fetched against its
//! digest (a verified copy in another program's cache beats the download,
//! and the stores that name their blobs by digest are asked first, at the
//! price of a stat). There is no "choice without a plan" case to handle:
//! the catalog's type split means a pick always carries its file's pinned
//! address, and a row with no identified file can never be chosen in the
//! first place.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use kalsa_catalog::{
    memory_budget, rows, ChoiceInput, Decision, DownloadPlan, ModelEntry, PhoneModel,
};
use kalsa_download::{default_roots, download};
// The cheap first pass over stores that name blobs by digest; find_local
// stays underneath it, so this is an optimization on top of the engine the
// download path already used.
use kalsa_reuse::find_reusable;
use kalsa_launch::{KvCache, LaunchInput, Offload, ServerArgs, ServerSettings};
use kalsa_probe::Measurement;
use kalsa_runtime::ServerBackend;
use kalsa_supervisor::{ServerConfig, DEFAULT_STOP_GRACE};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::capability::{CHOSEN_REASON, CHOSEN_STALE_NOTE, PHONE_FREE_REASON};
use crate::failure::StartupFailure;
use crate::options::LaunchOverrides;

/// Loopback port. The phone reaches it through a tunnel, never over the LAN.
pub(crate) const PORT: u16 = 8130;
/// Loading a model from a slow disk on an old machine is not fast.
const READY_TIMEOUT: Duration = Duration::from_secs(600);
/// Long enough for a clean unload, short enough that closing the window is not
/// a hang: the supervisor escalates to SIGKILL after the second one.
const STOP_GRACE: Duration = Duration::from_secs(2);
/// The context the chooser prices each candidate's cache at. It must exclude
/// nothing: priced at 8192 it refused rows the machine funds at a smaller
/// context — Granite 4 Tiny funds 3993 tokens on an 8 GiB machine (6112
/// before the sleeping-chat reserve was carved out, 4584 before its own
/// per-slot recurrent state was priced), and at
/// 8192 the tier was handed to a smaller row. The context that actually runs
/// is `kalsa_launch::plan`'s, derived for the chosen row from the same
/// budget and re-checked against it; a row that cannot fund even one token
/// is refused there, with words.
pub(crate) const CHOOSER_CONTEXT_TOKENS: u64 = 1;
/// The context a development run starts with. The developer pinned the model
/// and owns its bytes, so this is a convenience, not a budgeted decision —
/// the product path never uses it.
const DEV_CONTEXT_TOKENS: u64 = 4096;

/// What the walk needs to know about this machine, gathered once before it
/// starts. The measurement itself, not numbers pulled out of it: whether the
/// bandwidth is a floor — measured on the CPU while the machine would decode
/// on a GPU — is a fact of the measurement, and dropping it on the way to the
/// decision is how a runnable model got refused with a precise and wrong
/// number.
pub(crate) struct Machine {
    pub measurement: Measurement,
    pub ram_bytes: u64,
}

/// How far the walk has got, and when bytes are moving. The shell renders
/// this; a silent four-minute download reads as a broken app.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub(crate) enum Progress {
    /// Measuring this machine, because nothing this run keeps was measured.
    Measuring,
    /// Finding or proving the server build for this machine.
    Deciding,
    /// Bytes moving for the server build and its probe model.
    RuntimeBytes { done: u64, total: u64 },
    /// The catalog is choosing the model.
    Choosing,
    /// Bytes moving for the chosen model itself.
    ModelBytes { done: u64, total: u64 },
    /// Candidate settings being tried on the real model: how many
    /// lifetimes have finished, and how many are planned so far.
    Tuning { done: usize, planned: usize },
}

/// The funded maxima under both cache types. The guard compares against the
/// maximum for the cache type actually being launched — choosing f16 and
/// keeping a context only q8_0 could fund must be refused — and the panel
/// shows both so it never invents the arithmetic itself.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ContextMaxima {
    pub(crate) q8_0: Option<u64>,
    pub(crate) f16: Option<u64>,
}

impl ContextMaxima {
    pub(crate) fn for_cache(&self, cache: KvCache) -> Option<u64> {
        match cache {
            KvCache::Q8_0 => self.q8_0,
            KvCache::F16 => self.f16,
        }
    }
}

/// The launcher's KV price per cache type, for the number the panel shows
/// beside the context control. The pair mirrors [`ContextMaxima`], so the
/// panel reads the price for the cache type it is showing and never does the
/// cache arithmetic itself. `None` under a cache type means the row's
/// per-token figure is unreadable — the same condition that refuses a plan.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ContextPrices {
    pub(crate) q8_0: Option<kalsa_launch::ContextPrice>,
    pub(crate) f16: Option<kalsa_launch::ContextPrice>,
}

impl ContextPrices {
    pub(crate) fn for_cache(&self, cache: KvCache) -> Option<kalsa_launch::ContextPrice> {
        match cache {
            KvCache::Q8_0 => self.q8_0,
            KvCache::F16 => self.f16,
        }
    }
}

/// No price to show before a model is chosen (the development path), and the
/// funded maximum is absent there too: both pairs share the same story.
impl Default for ContextPrices {
    fn default() -> Self {
        Self {
            q8_0: None,
            f16: None,
        }
    }
}

/// The exact launch data kept by the shell after the supervisor receives it.
/// The UI reads this rather than reconstructing values from argv strings.
#[derive(Debug)]
pub(crate) struct LaunchInfo {
    pub(crate) args: ServerArgs,
    pub(crate) maximum_context: ContextMaxima,
    /// The context the launcher picks with no owner choice, per cache type:
    /// the panel shows this instead of a blank, so "Automatic" names the
    /// figure it will actually use.
    pub(crate) automatic_context: ContextMaxima,
    /// The launcher's per-token and per-slot KV terms, per cache type, for
    /// the panel's memory line. Absent on a path with no catalog row.
    pub(crate) context_prices: ContextPrices,
    /// The catalog's own name for what launched — the one model identity the
    /// user is shown. `None` on the development path: the developer pinned a
    /// file and owns its bytes, and no catalog choice was made to name.
    pub(crate) display_name: Option<String>,
    /// The catalog's own reason for this launch, in the words built to be
    /// shown as-is. `None` on the development path: the developer pinned a
    /// file and owns its bytes, and no catalog choice was made to explain.
    pub(crate) reason: Option<String>,
    /// The chosen row's pinned sha256, recorded where the row was chosen. The
    /// disk tier names a saved chat's file by its first eight hex characters,
    /// and this digest is the one the download already verified
    /// (`manifest.rs:51`), never the weights re-hashed here: a pass over tens
    /// of gigabytes at every launch is what the pin exists to avoid. `None` on
    /// the development path, where the developer pinned a file no catalog row
    /// named, so there is no digest to carry.
    pub(crate) model_sha256: Option<String>,
    /// What the tune decided for this launch — the panel's line and the
    /// real walk's report are both words over this. `None` on the
    /// development path, where no choice was made to tune.
    pub(crate) tune: Option<crate::tune_step::Tune>,
}

#[derive(Debug)]
pub(crate) struct PreparedStart {
    pub(crate) server: ServerConfig,
    pub(crate) info: LaunchInfo,
}

/// The whole walk. `server_override` (development) replaces the decide step:
/// the developer pins a binary and owns its bytes. Everything else is the
/// product order.
pub(crate) fn run(
    server_override: Option<PathBuf>,
    machine: Machine,
    phone: Option<PhoneModel>,
    devices: u32,
    model_override: Option<PathBuf>,
    state_file: PathBuf,
    slot_save_path: PathBuf,
    root: &Path,
    progress: &mut dyn FnMut(Progress),
) -> Result<PreparedStart, StartupFailure> {
    // A measurement the probe itself calls unreliable — every attempt failed
    // its checks — would decide a real model on noise. The walk stops; the
    // next turn-on measures again.
    require_reliable(&machine.measurement)?;
    // Before any download or model work: an engine whose disk route cannot be
    // prepared must not be fetched for, because the engine would refuse to
    // start and the tier would never exist.
    prepare_slot_save_dir(&slot_save_path)?;
    let overrides = crate::options::load(&state_file);
    // The build that won carries the backend it was chosen for; a dev-pinned
    // binary has no verdict, so the platform's default path stands in.
    let (backend, exe) = match server_override {
        Some(exe) => (dev_backend(), exe),
        None => {
            progress(Progress::Deciding);
            let decision = kalsa_runtime::decide(machine.measurement.will_run_on, &mut |p| {
                progress(Progress::RuntimeBytes {
                    done: p.bytes_done,
                    total: p.bytes_total,
                })
            })?;
            (decision.backend, decision.exe)
        }
    };
    let model = match model_override {
        // Development: the developer pinned the file and owns its bytes, so
        // the choice is skipped entirely — an unpaired machine must still be
        // able to run a dev build.
        Some(path) => path,
        None => {
            progress(Progress::Choosing);
            let (build, exe, plan, row, reason) = choose_with_processor_fallback(
                (backend, exe),
                &machine,
                phone,
                overrides.model.as_deref(),
                || {
                    progress(Progress::Deciding);
                    kalsa_runtime::decide_cpu(
                        machine.measurement.will_run_on,
                        &mut |p| progress(Progress::RuntimeBytes {
                            done: p.bytes_done,
                            total: p.bytes_total,
                        }),
                    )
                },
            )?;
            let path = place_model(&plan, root, progress)?;
            let mut prepared = planned_config_with_overrides(
                build,
                exe,
                path,
                row,
                reason,
                // The digest of the row whose file was just placed: the
                // model identity a saved chat's name carries.
                plan.sha256,
                &machine,
                devices,
                state_file,
                slot_save_path,
                overrides,
            )?;
            // The tune sits between the plan and the launch: it may rewrite
            // the exe, argv, threads and offload, and it may never fail the
            // walk — every path inside it degrades to the plan as made.
            let main_exe = prepared.server.exe.clone();
            let mut memo = crate::tune_step::Memo {
                cores: (
                    kalsa_probe::physical_cores(),
                    std::thread::available_parallelism().ok().map(|cores| cores.get()),
                ),
                processor: None,
            };
            crate::tune_step::tune_launch(
                &mut prepared,
                &machine,
                root,
                (build, main_exe),
                &mut memo,
                progress,
                |candidates, rule, resolved, inner| {
                    crate::tune_step::measure_with_rule(root, candidates, rule, resolved, inner)
                },
            );
            return Ok(prepared);
        }
    };
    dev_config_with_overrides(
        exe,
        model,
        devices,
        state_file,
        slot_save_path,
        &machine,
        overrides,
    )
}

/// The directory the engine saves a chat's KV state into, made ready before
/// the engine is launched.
///
/// The engine treats a `--slot-save-path` that is not an existing directory
/// as an invalid argument (`common/arg.cpp:3612-3615`), so an engine started
/// without this would die in its own argument parsing; and an engine started
/// with no path at all answers every save with `not supported`. Both are the
/// silence this exists to prevent.
///
/// 0700, stated rather than left to the umask: a saved state is a whole
/// conversation, and the data directory's own permissions are not the
/// boundary.
fn prepare_slot_save_dir(path: &Path) -> Result<(), StartupFailure> {
    std::fs::create_dir_all(path).map_err(|_| StartupFailure::SlotSavePathUnwritable)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| StartupFailure::SlotSavePathUnwritable)?;
    }
    Ok(())
}

/// The model step's answer: what to fetch, the row it belongs to, and the
/// reason to show. With a phone paired, the catalog's full comparison runs
/// (`choose`); with none, the phone-free question does
/// (`largest_that_runs_well`) — the phone decides whether this computer is an
/// upgrade, never whether the brain can run. Each branch carries the row its
/// plan was built from, so the file that is fetched is always the row that was
/// judged, and the reason in the owner's words that came with the branch.
fn choose_model(
    winner: ServerBackend,
    machine: &Machine,
    phone: Option<PhoneModel>,
    chosen: Option<&str>,
) -> Result<(DownloadPlan, &'static ModelEntry, String), StartupFailure> {
    let input = choice_input(winner, machine, phone);
    // A stored choice is honoured first, and only when this machine can
    // actually run that row — it is on the menu (its file is still fetchable)
    // and it fits. Anything else falls back to the automatic answer with a
    // sentence saying so: a model that will not start is worse than one nobody
    // chose.
    if let Some(token) = chosen {
        if let Some(run) = row_for_token(token).and_then(|row| kalsa_catalog::runnable_row(&input, row)) {
            return Ok((run.download, run.entry, CHOSEN_REASON.to_string()));
        }
        let (plan, row, reason) = automatic_choice(&input, phone)?;
        return Ok((plan, row, format!("{CHOSEN_STALE_NOTE}{reason}")));
    }
    automatic_choice(&input, phone)
}

/// The answer this computer would give with nobody choosing: the largest row
/// that runs well with no phone, the catalog's full comparison with one. This
/// is the whole promise for everyone who never opens the page that offers a
/// choice, so it is one function and the stored-choice branch is beside it,
/// not inside it.
fn automatic_choice(
    input: &ChoiceInput,
    phone: Option<PhoneModel>,
) -> Result<(DownloadPlan, &'static ModelEntry, String), StartupFailure> {
    match phone {
        // No `PhoneUnknown` can reach the walk from either arm: this one
        // runs `choose` only when a phone is in the input it is given, and
        // the phone-free question never asks for one.
        None => {
            let run = kalsa_catalog::largest_that_runs_well(&input)
                .map_err(StartupFailure::from)?;
            Ok((run.download, run.entry, PHONE_FREE_REASON.to_string()))
        }
        Some(_) => {
            let selection = match kalsa_catalog::choose(&input) {
                Decision::Pick(selection) => selection,
                Decision::Refuse(refusal) => return Err(refusal.into()),
            };
            let row = chosen_row(
                selection.repo,
                selection.display_name,
                selection.quant,
                selection.weights_bytes,
            )?;
            Ok((selection.download, row, selection.plain_reason))
        }
    }
}

/// Why the walk starts the processor build after the graphics build's
/// catalog answer refused: the card's memory holds no row this app ships —
/// the owner's ruling after the Lenovo walk (RTX 4050 6 GiB, 32 GiB RAM,
/// E4B ran on the processor at ~11.8 tok/s that night).
pub(crate) const PROCESSOR_FALLBACK_REASON: &str =
    "No model fits this computer's graphics card's memory, so this model runs on the processor.";

/// The graphics build's catalog answer, with the processor fallback the
/// owner ruled in. `decide_processor` is lazy — a choice that fits the card
/// never pays for it — and only the builds whose budget IS the card's memory
/// (Vulkan, CUDA) fall back: a processor refusal is a real refusal, and
/// Metal budgets RAM already. And only the NothingFits refusal falls back at
/// all: the fallback's sentence is about the card's memory holding no row,
/// which is true only of that one — a phone comparison, a speed floor or a
/// bad token are other facts and reach the owner unchanged (pinned below).
fn choose_with_processor_fallback(
    build: (ServerBackend, PathBuf),
    machine: &Machine,
    phone: Option<PhoneModel>,
    chosen: Option<&str>,
    decide_processor: impl FnOnce() -> Result<kalsa_runtime::Decision, kalsa_runtime::DecideError>,
) -> Result<(ServerBackend, PathBuf, DownloadPlan, &'static ModelEntry, String), StartupFailure> {
    let (winner, exe) = build;
    let budgets_the_card = matches!(
        winner,
        ServerBackend::Vulkan | ServerBackend::Cuda12 | ServerBackend::Cuda13
    );
    match choose_model(winner, machine, phone, chosen) {
        Ok((plan, row, reason)) => Ok((winner, exe, plan, row, reason)),
        // ONLY NothingFits buys the fallback: the sentence "no model fits
        // this computer's graphics card's memory" is true only of it.
        // NothingBetter / NothingFastEnough (a phone was compared),
        // ChosenModelUnresolved, MachineNotMeasured — other facts, other
        // words — fall through unchanged.
        Err(graphics_refusal)
            if budgets_the_card && matches!(graphics_refusal, StartupFailure::NothingFits) =>
        {
            // The ruling: a GPU build that probes well but whose card holds
            // no row is not a reason to refuse the machine (Lenovo walk:
            // 6.4 GB of VRAM minus the margin leaves ~3.0 GiB — under the
            // smallest row — while 32 GiB of RAM funds one). The processor
            // answer carries the sentence that says which memory decided.
            let decision = match decide_processor() {
                Ok(decision) => decision,
                // The processor route failing must not wear
                // NoBackendWorked ("None of the ways … work"): the
                // graphics build already worked and proved itself. The
                // truthful headline is the original refusal — nothing
                // fits the card, and the processor is no answer either.
                Err(_) => return Err(graphics_refusal),
            };
            let (plan, row, reason) = choose_model(decision.backend, machine, phone, chosen)?;
            Ok((
                decision.backend,
                decision.exe,
                plan,
                row,
                format!("{PROCESSOR_FALLBACK_REASON} {reason}"),
            ))
        }
        Err(graphics_refusal) => Err(graphics_refusal),
    }
}

/// The identity of a catalog row, as one opaque token.
///
/// The page that offers the choice never learns how the catalog is shaped: it
/// is handed this string and hands it back. It is derived from everything
/// [`chosen_row`] matches on — repo, display name, quantisation, weight — so a
/// row that changes in any of them is a different row with a different token,
/// rather than a token that silently means something else. FNV-1a, spelled out
/// because a hash of four fields does not need a dependency.
pub(crate) fn model_token(entry: &ModelEntry) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let fields = entry
        .repo
        .bytes()
        .chain([0])
        .chain(entry.display_name.bytes())
        .chain([0])
        .chain(entry.quant.bytes())
        .chain([0])
        .chain(entry.weights_bytes.to_le_bytes());
    for byte in fields {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// The row a stored token names, or `None` when nothing does. Exactly one
/// match, like [`chosen_row`]: a token several rows answer to names none of
/// them.
pub(crate) fn row_for_token(token: &str) -> Option<&'static ModelEntry> {
    let matches: Vec<&ModelEntry> = rows().filter(|entry| model_token(entry) == token).collect();
    match matches.as_slice() {
        [row] => Some(row),
        [] | [_, _, ..] => None,
    }
}

/// The row a selection names. `repo` alone is not a key — two rows can share
/// one repo, and taking the first would run somebody else's quantisation,
/// footprint and digest — so the row is answered only when exactly one
/// matches on everything the selection carries. Anything else stops the walk
/// instead of starting a model whose numbers belong to another row.
fn chosen_row(
    repo: &str,
    display_name: &str,
    quant: &str,
    weights_bytes: u64,
) -> Result<&'static ModelEntry, StartupFailure> {
    let matches: Vec<&ModelEntry> = rows()
        .filter(|entry| {
            entry.repo == repo
                && entry.display_name == display_name
                && entry.quant == quant
                && entry.weights_bytes == weights_bytes
        })
        .collect();
    match matches.as_slice() {
        [row] => Ok(row),
        [] | [_, _, ..] => Err(StartupFailure::ChosenModelUnresolved),
    }
}

/// The memory path of the build that won. These are two different kinds of
/// fact — what the machine *offers* (`kalsa_probe::Backend`) and which build
/// *won* (`ServerBackend`) — and the budget must follow the winner: when the
/// GPU builds fail and the CPU build wins on a machine with a card, the
/// model will run in system RAM, and sizing it on the VRAM refuses models
/// the machine funds or starts one that does not fit.
///
/// The walk decides the build before it chooses the model, so the winner is
/// known here; nothing is re-derived after the fact.
fn budget_backend(winner: ServerBackend, detected: kalsa_probe::Backend) -> kalsa_probe::Backend {
    match winner {
        ServerBackend::Metal => kalsa_probe::Backend::Metal,
        ServerBackend::Cpu => kalsa_probe::Backend::Cpu,
        // A GPU build decodes in the card's memory: the budget is the VRAM
        // detection read, when it could read one honestly.
        ServerBackend::Vulkan | ServerBackend::Cuda12 | ServerBackend::Cuda13 => match detected {
            kalsa_probe::Backend::DiscreteGpu { vram_bytes } => {
                kalsa_probe::Backend::DiscreteGpu { vram_bytes }
            }
            _ => kalsa_probe::Backend::DiscreteGpu { vram_bytes: None },
        },
    }
}

/// The catalog's input, gathered from the measurement as it stands — every
/// fact travels, none is re-derived or dropped. The backend is the budget
/// path of the build that won, not the machine's raw detection: the catalog
/// sizes candidates for the memory they will actually run in.
fn choice_input(
    winner: ServerBackend,
    machine: &Machine,
    phone: Option<PhoneModel>,
) -> ChoiceInput {
    ChoiceInput {
        backend: budget_backend(winner, machine.measurement.will_run_on),
        ram_bytes: machine.ram_bytes,
        bandwidth_bytes_per_second: machine.measurement.decode_bandwidth_bytes_per_second(),
        compute_flops_per_second: machine.measurement.compute.max(),
        // The measurement's own word on itself: a CPU-path bandwidth under a
        // GPU decode is a floor, which may keep a candidate but must never
        // refuse one. Hardcoding this false re-creates the bug that refused
        // a runnable model with a precise and wrong number.
        bandwidth_is_lower_bound: machine.measurement.bandwidth_is_lower_bound(),
        context_tokens: CHOOSER_CONTEXT_TOKENS,
        phone,
    }
}

/// A measurement the probe itself distrusts — every attempt failed its
/// checks, and the last one came back anyway — must not decide which model a
/// real machine runs. The probe's own word is the authority; this adds
/// nothing to it. The notes it wrote for the user, numbers included, travel
/// with the failure unchanged: they are the reason the owner is told.
pub(crate) fn require_reliable(measurement: &Measurement) -> Result<(), StartupFailure> {
    if measurement.is_reliable() {
        Ok(())
    } else {
        Err(StartupFailure::MeasurementUnreliable(
            measurement.reliability.notes.clone(),
        ))
    }
}

/// Puts the chosen model on disk, against the plan's digest. The plan is
/// not optional: the catalog's pick always carries its file's address.
fn place_model(
    plan: &DownloadPlan,
    root: &Path,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StartupFailure> {
    acquire_model(plan, &root.join("models"), &default_roots(), progress)
}

/// Puts the chosen model on disk, against the plan's digest. A copy already
/// on disk — ours, or another program's — is hash-checked or digest-found
/// before any download happens. Another program's stores are searched cheap
/// pass first (`kalsa-reuse`: stores that NAME blobs by their digest cost a
/// stat, and the store whose name claims our digest is read once to
/// confirm), with `find_local` underneath for stores that name files like
/// files. `roots` is handed in rather than taken from the environment so
/// the search is a fact a test can pin.
fn acquire_model(
    plan: &DownloadPlan,
    models_dir: &Path,
    roots: &[PathBuf],
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StartupFailure> {
    let name = plan.url.rsplit('/').next().unwrap_or_default();
    if name.is_empty() {
        // A plan whose address has no file name cannot be verified, or even
        // stored: refuse rather than invent a plausible name.
        return Err(StartupFailure::WeightsUnverified);
    }
    let path = models_dir.join(name);
    if file_digest_is(&path, plan.bytes, plan.sha256) {
        return Ok(path);
    }
    // A digest-verified copy under ollama, LM Studio or the HF cache beats
    // any download, and it is only ever read. A "not found" from the reuse
    // pass is an optimization failing, never a verdict: find_local still
    // runs underneath it.
    if let Some(found) = find_reusable(roots, plan.bytes, plan.sha256) {
        return Ok(found);
    }
    progress(Progress::ModelBytes {
        done: 0,
        total: plan.bytes,
    });
    let mut relay = |p: kalsa_download::Progress| {
        progress(Progress::ModelBytes {
            done: p.bytes_done,
            total: p.bytes_total,
        })
    };
    download(&plan.url, &path, plan.bytes, plan.sha256, &mut relay)
        .map_err(StartupFailure::from)?;
    Ok(path)
}

/// The reason a test's launch record carries. These tests are about budgets
/// and argv, so the words only have to be recognisable and provably the ones
/// the model step handed over.
#[cfg(test)]
const TEST_REASON: &str = "the catalog chose this row for the test";

/// The digest a test's launch record carries. Of the right shape — a sha256 is
/// 64 lowercase hex characters — because the door reads its first eight. The
/// tests that compare against the catalog read the catalog, not this.
#[cfg(test)]
const TEST_SHA256: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/// The server's configuration, from the launch decision: the context is
/// derived from the chosen row's cache geometry against this machine's real
/// budget, the thread count is the measured plateau, the offload follows the
/// build that won. `None` from [`kalsa_launch::plan`] means the machine
/// cannot fund this model even with a single token of context, and the walk
/// stops honestly — it never starts the server smaller.
#[cfg(test)]
fn planned_config(
    backend: ServerBackend,
    exe: PathBuf,
    model: PathBuf,
    row: &ModelEntry,
    machine: &Machine,
    state_file: PathBuf,
) -> Result<PreparedStart, StartupFailure> {
    planned_config_with_overrides(
        backend,
        exe,
        model,
        row,
        TEST_REASON.to_string(),
        TEST_SHA256,
        machine,
        // The single-slot default: these tests are about the model and the
        // budget, and the capacity rule has its own tests below.
        1,
        state_file,
        // No I/O under `planned_config_with_overrides`: the directory itself
        // is exercised through `run`, where the app's own path arrives.
        PathBuf::from("/slots"),
        LaunchOverrides::default(),
    )
}

/// The slot count the plan may divide by: the requested capacity, taken down
/// to one when the engine at `exe` carries no `x-kalsa-slot` inlet. The door
/// makes the same clamp when it binds (`main.rs`'s `door_capacity`), but only
/// after the plan is built, so a plan that kept the requested number would
/// divide the context by slots the door will never serve: one device would
/// get `1/N` of the window while the machine paid N per-slot KV terms for the
/// other N-1. The probe reads the mounted bytes, so the answer describes the
/// engine this walk chose — and the walk knows that engine before any
/// [`LaunchInput`] is built, because the build decision runs first.
fn planned_parallel(exe: &Path, requested: u32) -> u32 {
    if kalsa_runtime::engine_consumes_private_headers(exe) {
        requested.max(1)
    } else {
        1
    }
}

/// The largest slot count in `1..=requested` the machine actually funds,
/// asked of [`kalsa_launch::plan`] itself so the number the door serves is the
/// number the plan divided by — one source, never two. The enrolled device
/// count is what the machine is asked for, and this is what it can pay for.
///
/// The walk order is the honest one: each slot replicates whatever the model
/// keeps per slot, so more slots buy smaller windows, and the first count from
/// the top that funds is the answer. `requested` is the store's device count,
/// not a constant, so a family of three gets three seats and a lone install
/// gets one.
///
/// One when nothing funds more — including when the model funds nothing at
/// all, where the caller's own [`kalsa_launch::plan`] then refuses at one slot
/// exactly as it did before.
fn funded_parallel(requested: u32, funds: impl Fn(u32) -> bool) -> u32 {
    (1..=requested.max(1)).rev().find(|slots| funds(*slots)).unwrap_or(1)
}

fn planned_config_with_overrides(
    backend: ServerBackend,
    exe: PathBuf,
    model: PathBuf,
    row: &ModelEntry,
    reason: String,
    model_sha256: &str,
    machine: &Machine,
    devices: u32,
    state_file: PathBuf,
    slot_save_path: PathBuf,
    overrides: LaunchOverrides,
) -> Result<PreparedStart, StartupFailure> {
    let automatic = ServerSettings::defaults(kalsa_launch::DEFAULT_IDLE_UNLOAD_SECONDS);
    let batch_size = overrides.batch_size.unwrap_or(automatic.batch_size);
    let ubatch_size = overrides.ubatch_size.unwrap_or(automatic.ubatch_size);
    let kv_cache = overrides.kv_cache.unwrap_or_default();
    let budget = memory_budget(
        budget_backend(backend, machine.measurement.will_run_on),
        machine.ram_bytes,
    );
    let build = |cache: KvCache, context_limit: Option<u64>, parallel: u32| LaunchInput {
        backend,
        model: row,
        budget,
        thread_ramp: &machine.measurement.ramp,
        physical_cores: kalsa_probe::physical_cores(),
        model_path: model.clone(),
        port: PORT,
        context_limit,
        batch_size,
        ubatch_size,
        kv_cache: cache,
        parallel,
        slot_save_path: slot_save_path.clone(),
    };
    // The requested count is the ENROLLED devices — this computer and every
    // paired phone — because the door reserves a slot per stored device for
    // as long as the device is stored. A phone that is away still holds its
    // seat, so a plan sized for whoever happened to be talking would refuse
    // the next device that pairs. Taken down to what this machine funds: with
    // the host enrolled, one seat is the one conversation that used to have
    // no seat at all, and a machine that cannot fund the whole family keeps
    // the smaller number rather than refusing to start.
    let requested_parallel = devices.max(1);
    let affordable = funded_parallel(requested_parallel, |slots| {
        kalsa_launch::plan(&build(kv_cache, overrides.context_tokens, slots)).is_some()
    });
    // The engine's path is known here, before any `LaunchInput` exists: the
    // walk decides the build first and hands its exe in. Probe it now, so the
    // number the plan divides by is the number the door will serve.
    let parallel = planned_parallel(&exe, affordable);
    if affordable < requested_parallel {
        eprintln!(
            "kalsa-brain: {requested_parallel} devices are enrolled on this computer, but the \
             plan funds only {affordable} of them at once; the plan is for {affordable} devices, \
             and the door will refuse the rest with a sentence saying the seats are full and \
             naming no device. Change the context in Advanced, or forget a device on the \
             Devices page."
        );
    }
    if parallel < affordable {
        eprintln!(
            "kalsa-brain: the engine at {} carries no x-kalsa-slot inlet; the plan is \
             for {parallel} device with one slot's context, not the requested \
             {affordable} slots",
            exe.display()
        );
    }
    // A zero trained length is a header we could not read, not a machine
    // that cannot fund the model: `plan` refuses both with a bare `None`,
    // so the honest answer is decided before the arithmetic runs.
    if kalsa_launch::trained_context_unreadable(row) {
        return Err(StartupFailure::ChosenModelContextUnreadable);
    }
    // The funded maximum for each cache type: f16 costs twice per token and
    // therefore funds a smaller context. Either may be absent — the row can
    // be unfundable under one cache and fine under the other — so this is not
    // an error until the cache actually being launched has no maximum. The
    // maximum is NOT the automatic context any more: `plan` with no owner
    // choice answers the smaller chat default where the machine funds it, so
    // the guards and the panel read the ceiling from `funded_maximum`.
    let maxima = ContextMaxima {
        q8_0: kalsa_launch::funded_maximum(&build(KvCache::Q8_0, None, parallel)),
        f16: kalsa_launch::funded_maximum(&build(KvCache::F16, None, parallel)),
    };
    if let (Some(context), Some(maximum)) = (overrides.context_tokens, maxima.for_cache(kv_cache)) {
        // The guard reads the maximum FOR THE CHOSEN CACHE TYPE: a context
        // that only q8_0 could fund is refused when f16 is being launched.
        if context > maximum {
            return Err(StartupFailure::ContextTooLarge {
                maximum_tokens: maximum,
                cache: Some(kv_cache),
            });
        }
    }
    let mut plan = kalsa_launch::plan(&build(kv_cache, overrides.context_tokens, parallel))
        .ok_or(StartupFailure::ChosenModelUnfundable)?;
    if let Some(seconds) = overrides.idle_unload_seconds {
        plan.args.idle_unload_seconds = seconds;
    }
    let args = plan.args;
    // What the panel shows beside the context control: the context the
    // launcher picks with no owner choice, and the launcher's own two KV
    // terms for pricing any length the owner types. All of it is the
    // launcher's arithmetic, computed here where the row is known.
    let automatic_context = ContextMaxima {
        q8_0: kalsa_launch::plan(&build(KvCache::Q8_0, None, parallel))
            .map(|plan| plan.args.context_tokens),
        f16: kalsa_launch::plan(&build(KvCache::F16, None, parallel))
            .map(|plan| plan.args.context_tokens),
    };
    let context_prices = ContextPrices {
        q8_0: kalsa_launch::context_price(row, KvCache::Q8_0, u64::from(ubatch_size), parallel),
        f16: kalsa_launch::context_price(row, KvCache::F16, u64::from(ubatch_size), parallel),
    };
    let server = ServerConfig {
        exe,
        argv: args.argv(),
        state_file,
        port: PORT,
        ready_timeout: READY_TIMEOUT,
        stop_grace: STOP_GRACE.max(DEFAULT_STOP_GRACE / 2),
    };
    Ok(PreparedStart {
        server,
        info: LaunchInfo {
            args,
            maximum_context: maxima,
            automatic_context,
            context_prices,
            display_name: Some(row.display_name.to_owned()),
            reason: Some(reason),
            model_sha256: Some(model_sha256.to_string()),
            tune: None,
        },
    })
}

/// The configuration for a development run: the developer pinned the binary
/// and the model and owns both, so nothing here is budgeted. The context is
/// a dev convenience ([`DEV_CONTEXT_TOKENS`]), the thread count follows the
/// measurement only when there is one, and the offload follows the build the
/// dev walk assumed — there is no verdict for a binary that was never
/// decided.
fn dev_config_with_overrides(
    exe: PathBuf,
    model: PathBuf,
    devices: u32,
    state_file: PathBuf,
    slot_save_path: PathBuf,
    machine: &Machine,
    overrides: LaunchOverrides,
) -> Result<PreparedStart, StartupFailure> {
    // The dev path is unbudgeted, so the funding cap has nothing to say here:
    // the seat count is the enrolled devices, taken down only when the engine
    // cannot isolate. `DEV_CONTEXT_TOKENS` is PER SLOT, so the total rides the
    // seat count exactly as the engine divides `--ctx-size`.
    let parallel = planned_parallel(&exe, devices.max(1));
    let maximum = DEV_CONTEXT_TOKENS.saturating_mul(u64::from(parallel));
    // A pinned development model has no catalog budget. This per-slot default
    // times the seats is therefore the maximum this path will promise;
    // Advanced may lower it, but cannot silently ask an unbudgeted run for
    // more.
    if overrides.context_tokens.is_some_and(|context| context > maximum) {
        return Err(StartupFailure::ContextTooLarge {
            maximum_tokens: maximum,
            cache: None,
        });
    }
    let automatic = ServerSettings::defaults(kalsa_launch::DEFAULT_IDLE_UNLOAD_SECONDS);
    let kv_cache = overrides.kv_cache.unwrap_or_default();
    let plateau_threads =
        kalsa_probe::plateau(&machine.measurement.ramp).map(|(threads, _)| threads);
    // The plan's own rule, one function: the plateau capped at the machine's
    // physical cores (the evidence lives on `LaunchInput::thread_ramp`).
    let threads = kalsa_launch::thread_count(plateau_threads, kalsa_probe::physical_cores());
    let mut args = ServerArgs {
        model_path: model,
        port: PORT,
        context_tokens: maximum,
        // No catalog budget here to carve the roof from; one chat
        // reservation per seat at the dev context keeps the behavior honest.
        // Like the budgeted roof it is priced at the cache the run will use:
        // an f16 chat is bigger, and the server skips one that does not fit.
        cache_ram_mib: kalsa_catalog::footprint::ASSUMED_KV_BYTES_PER_TOKEN
            .saturating_mul(kv_cache.bytes_per_element())
            .saturating_mul(maximum)
            / kalsa_catalog::footprint::MIB,
        threads,
        offload: offload_of_build(&dev_backend()),
        idle_unload_seconds: kalsa_launch::DEFAULT_IDLE_UNLOAD_SECONDS,
        batch_size: overrides.batch_size.unwrap_or(automatic.batch_size),
        ubatch_size: overrides.ubatch_size.unwrap_or(automatic.ubatch_size),
        kv_cache,
        // The dev path takes the same seat rule as the budgeted one: the
        // door builds one seat per enrolled device, and an engine that cannot
        // isolate is planned and served for one.
        parallel,
        // The dev path carries the disk tier too: the engine would refuse to
        // start without a directory for `--slot-save-path`.
        slot_save_path,
    };
    if let Some(context) = overrides.context_tokens {
        args.context_tokens = context;
    }
    if let Some(seconds) = overrides.idle_unload_seconds {
        args.idle_unload_seconds = seconds;
    }
    let server = ServerConfig {
        exe,
        argv: args.argv(),
        state_file,
        port: PORT,
        ready_timeout: READY_TIMEOUT,
        stop_grace: STOP_GRACE.max(DEFAULT_STOP_GRACE / 2),
    };
    Ok(PreparedStart {
        server,
        info: LaunchInfo {
            args,
            // No budget on the dev path, so there is no funded maximum, no
            // automatic figure and no price for either cache type to report.
            maximum_context: ContextMaxima {
                q8_0: None,
                f16: None,
            },
            automatic_context: ContextMaxima {
                q8_0: None,
                f16: None,
            },
            context_prices: ContextPrices::default(),
            display_name: None,
            reason: None,
            // A pinned file no catalog row named: there is no pinned digest
            // to carry, and none is computed from the file.
            model_sha256: None,
            tune: None,
        },
    })
}

/// The build a dev-pinned binary is assumed to be: the platform's own
/// default, the one the product's decision would have reached anyway. A
/// development run has no verdict to name the build.
fn dev_backend() -> ServerBackend {
    match kalsa_runtime::Platform::current() {
        Some(kalsa_runtime::Platform::MacArm64 | kalsa_runtime::Platform::MacX64) => {
            ServerBackend::Metal
        }
        _ => ServerBackend::Cpu,
    }
}

/// What a build's backend implies for the GPU, when there is no budget to
/// check: the Metal build decodes on the GPU out of unified memory, and every
/// other build a dev run can assume is treated as having no GPU to ask for.
fn offload_of_build(backend: &ServerBackend) -> Offload {
    match backend {
        ServerBackend::Metal => Offload::All,
        _ => Offload::NoGpuBuild,
    }
}

/// System RAM, the catalog's fallback budget wherever a card's size cannot
/// be read honestly. Zero when the platform will not say: a budget of zero
/// refuses honestly rather than promising something the machine cannot do.
pub(crate) fn ram_bytes() -> u64 {
    #[cfg(target_os = "macos")]
    {
        let mut value: u64 = 0;
        let mut len = std::mem::size_of::<u64>();
        let name = b"hw.memsize\0";
        let ok = unsafe {
            libc::sysctlbyname(
                name.as_ptr() as *const libc::c_char,
                &mut value as *mut u64 as *mut libc::c_void,
                &mut len,
                std::ptr::null_mut(),
                0,
            )
        };
        if ok == 0 {
            value
        } else {
            0
        }
    }
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..unsafe { std::mem::zeroed() }
        };
        if unsafe { GlobalMemoryStatusEx(&mut status) } != 0 {
            status.ullTotalPhys
        } else {
            0
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // MemTotal is in KiB, and it is what the kernel will actually back.
        std::fs::read_to_string("/proc/meminfo")
            .ok()
            .and_then(|text| {
                text.lines().find_map(|line| {
                    line.strip_prefix("MemTotal:")
                        .and_then(|rest| rest.trim_end_matches("kB").trim().parse::<u64>().ok())
                })
            })
            .map(|kib| kib * 1024)
            .unwrap_or(0)
    }
}

/// Size first, then the digest: the cheap check decides whether the expensive
/// one is worth running.
fn file_digest_is(path: &Path, size: u64, sha: &str) -> bool {
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    if !matches!(file.metadata(), Ok(meta) if meta.len() == size) {
        return false;
    }
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buf[..n]),
            Err(_) => return false,
        }
    }
    let digest = format!("{:x}", hasher.finalize());
    digest.eq_ignore_ascii_case(sha)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_probe::{Backend, ExecutionPath, Reliability, Series};
    use std::io::Write;

    /// A measurement with the shape the catalog predicts from: `bandwidth`
    /// bytes per second on the CPU path, `backend` being what the machine
    /// would actually decode on.
    fn measured(bandwidth: f64, backend: Backend) -> Measurement {
        Measurement {
            ramp: vec![(2, bandwidth)],
            ceiling_bytes_per_second: bandwidth,
            // No chip figure in a fixture: the test machine is whatever
            // `ceiling` says, so the floor rule stays the backend's own.
            decode_bytes_per_second: None,
            ceiling: Series::new(vec![bandwidth]),
            plateau_threads: 2,
            cache: Series::new(vec![200.0e9]),
            compute: Series::new(vec![100.0e9]),
            reliability: Reliability {
                reliable: true,
                effective_parallelism: None,
                threads: 2,
                spread: 0.0,
                cache_ratio: None,
                notes: Vec::new(),
            },
            measured_on: ExecutionPath::Cpu,
            will_run_on: backend,
        }
    }

    fn machine(backend: Backend) -> Machine {
        Machine {
            measurement: measured(80.0e9, backend),
            ram_bytes: 16 * 1024 * 1024 * 1024,
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-brain-startup-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    /// What a flag renders is the whole element that follows it, and the
    /// flag is rendered exactly once. The joined line is not the artifact to
    /// assert on: `contains("--ctx-checkpoints 1")` is also true of
    /// `--ctx-checkpoints 12`, and a saved chat twelve times the size is
    /// exactly what the constant exists to prevent. `position` alone is not
    /// enough either: it reads the first of two renderings and the second
    /// passes in silence, so two occurrences are a fault in the renderer,
    /// not a value to pick between.
    fn rendered_value<'a>(argv: &'a [String], flag: &str) -> &'a str {
        let mut hits = argv.iter().enumerate().filter(|(_, arg)| *arg == flag);
        let (at, _) = hits
            .next()
            .unwrap_or_else(|| panic!("{flag} is not rendered: {argv:?}"));
        assert!(
            hits.next().is_none(),
            "{flag} is rendered more than once: {argv:?}"
        );
        argv.get(at + 1)
            .map(String::as_str)
            .unwrap_or_else(|| panic!("{flag} is rendered with no value: {argv:?}"))
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
        };
        let found = acquire_model(
            &plan,
            &root.join("models"),
            &[friendly_root.clone(), blob_root.clone()],
            &mut |_| {},
        )
        .expect("the pinned copy in the digest store is on this disk");
        assert_eq!(found, blob, "the cheap pass must answer first, not {found:?}");
        assert_ne!(found, friendly);
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
        };
        let found = acquire_model(
            &plan,
            &root.join("models"),
            &[blob_root.clone(), friendly_root.clone()],
            &mut |_| {},
        )
        .expect("the honest copy is still found");
        assert_eq!(found, friendly);
        assert!(
            !root.join("models").join("weights.gguf").exists(),
            "nothing was downloaded: reuse answered"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&friendly_root);
        let _ = std::fs::remove_dir_all(&blob_root);
    }

    /// A loopback HTTP server answering every request with the same body:
    /// what a HuggingFace resolve endpoint looks like to this walk, without
    /// touching a real network.
    fn serve(body: &'static [u8]) -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        let requests = std::sync::Arc::new(AtomicUsize::new(0));
        let counter = std::sync::Arc::clone(&requests);
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                counter.fetch_add(1, Ordering::SeqCst);
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
        (format!("http://{addr}/stories260K.gguf"), requests)
    }

    /// The machine these tests decide for, and a row on the menu that is not
    /// the automatic pick — the shape a real choice has.
    fn a_smaller_row_that_runs(machine: &Machine) -> (&'static ModelEntry, &'static ModelEntry) {
        let input = choice_input(ServerBackend::Cpu, machine, None);
        let automatic = kalsa_catalog::largest_that_runs_well(&input)
            .expect("the test machine runs something");
        let smaller = rows()
            .filter(|entry| entry.weights_bytes < automatic.entry.weights_bytes)
            .find(|entry| kalsa_catalog::runnable_row(&input, entry).is_some())
            .expect("a smaller row runs on the same machine");
        (automatic.entry, smaller)
    }

    #[test]
    fn a_stored_choice_is_the_model_that_runs() {
        // What the owner picked, not what the catalog would have picked. The
        // row is smaller than the automatic one on purpose: a test that
        // happens to agree with the automatic answer proves nothing.
        let machine = machine(Backend::Cpu);
        let (automatic, chosen) = a_smaller_row_that_runs(&machine);
        assert_ne!(automatic.display_name, chosen.display_name);

        let (plan, row, reason) = choose_model(
            ServerBackend::Cpu,
            &machine,
            None,
            Some(&model_token(chosen)),
        )
        .expect("a chosen row this machine can run is a legitimate start");

        assert_eq!(row.display_name, chosen.display_name, "the stored choice was not honoured");
        assert_eq!(reason, CHOSEN_REASON, "and the reason says who chose");
        assert!(plan.bytes > 0 && !plan.url.is_empty() && plan.sha256.len() == 64, "the row brings its own pinned file");
    }

    #[test]
    fn with_nothing_stored_the_automatic_decision_is_the_same_decision() {
        // The whole promise for everyone who never opens the page: with no
        // stored choice the walk must answer exactly what the catalog answers,
        // plan and reason and all. Compared against the catalog itself rather
        // than against a copied expectation.
        let machine = machine(Backend::Cpu);
        let input = choice_input(ServerBackend::Cpu, &machine, None);
        let automatic = kalsa_catalog::largest_that_runs_well(&input).expect("something runs");
        let (plan, row, reason) =
            choose_model(ServerBackend::Cpu, &machine, None, None).expect("no choice is today's walk");

        assert_eq!(row.repo, automatic.entry.repo);
        assert_eq!(row.quant, automatic.entry.quant);
        assert_eq!(row.weights_bytes, automatic.entry.weights_bytes);
        assert_eq!(plan.url, automatic.download.url, "the same file, byte for byte");
        assert_eq!(plan.bytes, automatic.download.bytes);
        assert_eq!(plan.sha256, automatic.download.sha256);
        assert_eq!(reason, PHONE_FREE_REASON, "and the same sentence");
    }

    #[test]
    fn the_record_carries_the_chosen_row_s_pinned_digest_not_a_rehash() {
        // The model identity a saved chat's name carries is the CATALOG ROW's
        // pinned sha256 — the digest the download already verified — read into
        // the record where the row is chosen. `digest_of(PLAN_BODY)` stands in
        // for the digest of some other bytes, which is what a pass over the
        // weights would produce: the record must not carry it.
        let machine = machine(Backend::Cpu);
        let (plan, row, reason) =
            choose_model(ServerBackend::Cpu, &machine, None, None).expect("today's walk");
        let from_catalog = kalsa_catalog::usable()
            .find(|entry| entry.entry().repo == row.repo && entry.entry().quant == row.quant)
            .expect("the chosen row is on the menu")
            .source()
            .sha256;
        assert_eq!(
            plan.sha256, from_catalog,
            "the plan's digest is the catalog row's own"
        );
        let config = planned_config_with_overrides(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            PathBuf::from("/models/chosen.gguf"),
            row,
            reason,
            plan.sha256,
            &machine,
            1,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides::default(),
        )
        .expect("the automatic row is fundable on the test machine");
        assert_eq!(
            config.info.model_sha256.as_deref(),
            Some(plan.sha256),
            "the record dropped or replaced the row's pinned digest"
        );
        // The door takes the first eight characters; a launch record carrying
        // a digest computed from the weights would name every chat by a hash
        // no later launch could find again.
        let file_digest = digest_of(PLAN_BODY);
        assert_ne!(
            &config.info.model_sha256.as_deref().expect("carried")[..8],
            &file_digest[..8],
            "the weights were re-hashed instead of the row's pin"
        );
    }

    #[test]
    fn a_choice_the_catalog_does_not_know_falls_back_and_says_so() {
        // A token from a build whose catalog has moved on. It must not stop
        // the walk and must not be passed over in silence.
        let machine = machine(Backend::Cpu);
        let (plan, row, reason) = choose_model(ServerBackend::Cpu, &machine, None, Some("not-a-token"))
            .expect("a stale choice must not stop the brain from starting");

        let input = choice_input(ServerBackend::Cpu, &machine, None);
        let automatic = kalsa_catalog::largest_that_runs_well(&input).expect("something runs");
        assert_eq!(row.display_name, automatic.entry.display_name);
        assert_eq!(plan.sha256, automatic.download.sha256);
        assert!(reason.starts_with(CHOSEN_STALE_NOTE), "{reason}");
        assert!(reason.contains(PHONE_FREE_REASON), "the automatic answer's own words follow: {reason}");
    }

    #[test]
    fn a_choice_with_no_file_left_to_fetch_falls_back_and_says_so() {
        // The other way a stored choice goes stale: the catalog still knows
        // the row, and there is nothing left to fetch for it — the research
        // rows carry no file. This is the "its file has gone" case, and it
        // falls back for the same reason.
        let machine = machine(Backend::Cpu);
        let without_file = rows()
            .find(|entry| {
                !kalsa_catalog::usable()
                    .any(|candidate| candidate.entry().repo == entry.repo && candidate.entry().quant == entry.quant)
            })
            .expect("the catalog carries rows with no file");
        assert!(
            row_for_token(&model_token(without_file)).is_some(),
            "the token resolves: this is not the unknown-token case"
        );

        let (_, row, reason) = choose_model(
            ServerBackend::Cpu,
            &machine,
            None,
            Some(&model_token(without_file)),
        )
        .expect("a row with nothing to fetch must not stop the brain from starting");
        let input = choice_input(ServerBackend::Cpu, &machine, None);
        let automatic = kalsa_catalog::largest_that_runs_well(&input).expect("something runs");
        assert_eq!(row.display_name, automatic.entry.display_name);
        assert!(reason.starts_with(CHOSEN_STALE_NOTE), "{reason}");
    }

    /// The owner's ruling, on the machine that asked for it: the Lenovo's
    /// RTX 4050 6 GiB against 32 GiB of RAM. Budgeted on the card the
    /// catalog leaves ~3.0 GiB after the margin and every row weighs more;
    /// budgeted on RAM the processor build picks — and the reason says which
    /// memory decided.
    #[test]
    fn the_graphics_refusal_falls_back_to_the_processor_and_says_why() {
        let machine = Machine {
            measurement: measured(
                80.9e9,
                Backend::DiscreteGpu {
                    vram_bytes: Some(6_439_305_216),
                },
            ),
            ram_bytes: 32 * 1024 * 1024 * 1024,
        };
        // The refusal that started this: budgeted on the card, nothing fits.
        assert!(
            choose_model(ServerBackend::Vulkan, &machine, None, None).is_err(),
            "6.4 GB of VRAM minus the margin must hold no row"
        );

        // The walk's fallback ends on the processor, with its own answer and
        // the sentence that says why the processor.
        let expected = choose_model(ServerBackend::Cpu, &machine, None, None)
            .expect("the processor budget is 32 GiB of RAM");
        let (build, exe, plan, row, reason) = choose_with_processor_fallback(
            (ServerBackend::Vulkan, PathBuf::from("/builds/vulkan-server.exe")),
            &machine,
            None,
            None,
            || {
                Ok(kalsa_runtime::Decision {
                    backend: ServerBackend::Cpu,
                    exe: PathBuf::from("/builds/cpu-server.exe"),
                })
            },
        )
        .expect("the fallback picks");
        assert_eq!(build, ServerBackend::Cpu, "the processor build decides");
        assert_eq!(exe, PathBuf::from("/builds/cpu-server.exe"));
        assert_eq!(row.repo, expected.1.repo, "the processor build's own choice");
        assert_eq!(plan.sha256, expected.0.sha256, "its own pinned file");
        assert!(
            reason.contains(PROCESSOR_FALLBACK_REASON),
            "the reason must say why the processor: {reason}"
        );
        assert!(
            reason.contains(&expected.2),
            "the choice's own words follow: {reason}"
        );
    }

    #[test]
    fn a_nothing_better_gpu_refusal_does_not_fall_back() {
        // The guard, pinned from the refusal side: rows that FIT the card
        // next to a phone no shipped row beats produce the phone
        // comparison's NothingFits sibling — NothingBetter — and that one
        // must not trigger the fallback or its sentence (finding 1).
        let machine = Machine {
            measurement: measured(
                80.9e9,
                Backend::DiscreteGpu {
                    vram_bytes: Some(24 << 30),
                },
            ),
            ram_bytes: 32 * 1024 * 1024 * 1024,
        };
        let phone = PhoneModel {
            weights_bytes: 400 << 30,
            parameters: None,
            measured_tokens_per_second: None,
            battery_powered: None,
        };
        assert!(
            matches!(
                choose_model(ServerBackend::Vulkan, &machine, Some(phone), None),
                Err(StartupFailure::NothingBetter)
            ),
            "the fixture must produce the phone comparison's refusal"
        );

        let calls = std::cell::Cell::new(0);
        let err = choose_with_processor_fallback(
            (
                ServerBackend::Vulkan,
                PathBuf::from("/builds/vulkan-server.exe"),
            ),
            &machine,
            Some(phone),
            None,
            || {
                calls.set(calls.get() + 1);
                Ok(kalsa_runtime::Decision {
                    backend: ServerBackend::Cpu,
                    exe: PathBuf::from("/builds/cpu-server.exe"),
                })
            },
        )
        .expect_err("a phone refusal is not the card's to override");
        assert!(matches!(err, StartupFailure::NothingBetter), "{err:?}");
        assert_eq!(
            calls.get(),
            0,
            "the processor decide must run for NothingFits and nothing else"
        );
    }

    #[test]
    fn a_processor_decide_that_fails_keeps_the_nothing_fits_headline() {
        // Finding 3: the graphics build worked — its catalog answer did not
        // fit the card. A dead processor route must not rename that to
        // NoBackendWorked ("None of the ways … work"): the truthful
        // headline is the original refusal.
        let machine = Machine {
            measurement: measured(
                80.9e9,
                Backend::DiscreteGpu {
                    vram_bytes: Some(6_439_305_216),
                },
            ),
            ram_bytes: 32 * 1024 * 1024 * 1024,
        };
        let calls = std::cell::Cell::new(0);
        let err = choose_with_processor_fallback(
            (
                ServerBackend::Vulkan,
                PathBuf::from("/builds/vulkan-server.exe"),
            ),
            &machine,
            None,
            None,
            || {
                calls.set(calls.get() + 1);
                Err(kalsa_runtime::DecideError::NothingWorked { attempts: vec![] })
            },
        )
        .expect_err("no processor answer to give");
        assert_eq!(calls.get(), 1, "the fixture reaches the decide");
        assert!(
            matches!(err, StartupFailure::NothingFits),
            "the fallback's failure must wear the original refusal: {err:?}"
        );
    }

    #[test]
    fn a_token_names_one_row_or_none() {
        // The discipline `chosen_row` has, for the identity the page can send
        // back: exactly one row answers to a token, and every row's token is
        // its own.
        let tokens: Vec<String> = rows().map(model_token).collect();
        let unique: std::collections::HashSet<&String> = tokens.iter().collect();
        assert_eq!(unique.len(), tokens.len(), "two rows share a token");
        for (token, entry) in tokens.iter().zip(rows()) {
            let resolved = row_for_token(token).expect("a row's own token resolves");
            assert_eq!(resolved.display_name, entry.display_name);
            assert_eq!(resolved.weights_bytes, entry.weights_bytes);
        }
    }

    #[test]
    fn the_lower_bound_truth_rides_with_the_measurement() {
        // The exact fact that was once dropped: a CPU-path measurement under
        // a GPU decode is a floor, and the decision must know it from the
        // measurement, not from a constant.
        let cpu = choice_input(ServerBackend::Cpu, &machine(Backend::Cpu), None);
        assert!(!cpu.bandwidth_is_lower_bound);
        assert_eq!(cpu.bandwidth_bytes_per_second, 80.0e9);
        let metal = choice_input(ServerBackend::Metal, &machine(Backend::Metal), None);
        assert!(metal.bandwidth_is_lower_bound);
        assert_eq!(metal.bandwidth_bytes_per_second, 80.0e9);
    }

    #[test]
    fn an_unpaired_machine_still_gets_a_model_and_starts() {
        // The ruling the product made: the phone decides whether this
        // computer is an upgrade, never whether the brain can run. With no
        // phone at all, the model step answers with the largest row the
        // machine runs well, and the plan carries that row's pinned file.
        let machine = machine(Backend::Cpu);
        let (plan, row, reason) = choose_model(ServerBackend::Cpu, &machine, None, None)
            .expect("a standalone brain is a legitimate configuration");
        assert_eq!(
            reason, PHONE_FREE_REASON,
            "with no phone there is no comparison to report: the reason is the\
             phone-free sentence, not a generic claim"
        );
        assert!(
            rows().any(|entry| entry.repo == row.repo && entry.display_name == row.display_name),
            "the row is a real catalog row, not an invention"
        );
        assert!(plan.bytes > 0, "the pinned file travels with the pick");
        assert!(!plan.url.is_empty());
        assert!(
            plan.sha256.len() == 64,
            "the digest the download is held to: {}",
            plan.sha256
        );
        // And the pick is honest about fitting the machine it was chosen
        // for, priced at the same one-token context the chooser uses.
        let budget = memory_budget(Backend::Cpu, machine.ram_bytes);
        let footprint =
            kalsa_catalog::footprint_bytes(row, CHOOSER_CONTEXT_TOKENS);
        assert!(
            footprint.total_bytes() <= budget.usable_bytes,
            "the pick fits the budget it was sized against"
        );
    }

    // The loopback body and its digest, both constants: the plan's digest
    // field is 'static because the catalog's rows are, so the test does the
    // same thing a row does — pins bytes to a digest known in advance.
    const PLAN_BODY: &[u8] = b"kalsa-brain loopback weights for the download plan test";
    const PLAN_SHA256: &str = "44dff4aa25ed679690893bf2e5b6f68362763235d2b136c980b7da9c147ef626";

    #[test]
    fn a_plan_downloads_the_weights_and_verifies_the_digest() {
        let (url, requests) = serve(PLAN_BODY);
        let root = scratch("plan");
        let plan = DownloadPlan {
            url,
            bytes: PLAN_BODY.len() as u64,
            sha256: PLAN_SHA256,
        };
        let path = place_model(&plan, &root, &mut |_| {}).expect("downloaded");
        assert_eq!(
            std::fs::read(&path).expect("read"),
            PLAN_BODY,
            "what landed is what the digest promised"
        );
        assert_eq!(digest_of(PLAN_BODY), PLAN_SHA256);
        // A second pass with the file already on disk downloads nothing: the
        // on-disk bytes are re-hashed, and the server must not be asked again.
        let path_again = place_model(&plan, &root, &mut |_| {}).expect("from disk");
        assert_eq!(path_again, path);
        assert_eq!(
            requests.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "the second pass must be served from disk, not the wire"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_download_that_does_not_match_the_digest_is_thrown_away() {
        let body = &b"bytes a hostile link would serve"[..];
        let (url, _addr) = serve(body);
        let root = scratch("corrupt");
        let plan = DownloadPlan {
            url,
            bytes: body.len() as u64,
            sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        };
        let err =
            place_model(&plan, &root, &mut |_| {}).expect_err("the digest is the promise");
        assert!(matches!(err, StartupFailure::DownloadCorrupted), "{err:?}");
        assert!(
            !root.join("models").join("stories260K.gguf").exists(),
            "a corrupt download must not become the model"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_development_model_override_skips_the_choice_and_shapes_the_server() {
        // Numbers that would refuse (nothing measured, nobody paired) are
        // irrelevant when the developer has pinned the file: the dev flow
        // must survive a machine that has never been paired.
        let root = scratch("override");
        let machine = Machine {
            measurement: measured(0.0, Backend::Cpu),
            ram_bytes: 0,
        };
        let config = run(
            Some(PathBuf::from("/server/llama-server")),
            machine,
            None,
            1,
            Some(PathBuf::from("/dev/model.gguf")),
            PathBuf::from("/state/server.state"),
            root.join("slots"),
            &root,
            &mut |_| {},
        )
        .expect("the override is the answer");
        assert_eq!(config.server.exe, PathBuf::from("/server/llama-server"));
        assert_eq!(config.server.port, PORT);
        let joined = config.server.argv.join(" ");
        assert_eq!(
            rendered_value(&config.server.argv, "--host"),
            "127.0.0.1",
            "{joined}"
        );
        assert_eq!(
            rendered_value(&config.server.argv, "--model"),
            "/dev/model.gguf",
            "{joined}"
        );
        // The machine was never measured, so the thread count is omitted
        // rather than guessed.
        assert!(!joined.contains("--threads"), "{joined}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The disk tier's folder exists, private, before the engine starts — and
    /// the argv names it. `--slot-save-path` is the only route to the save and
    /// restore functions: an engine launched without it answers `not
    /// supported`, which is the silence the tier exists to avoid.
    #[cfg(unix)]
    #[test]
    fn the_saved_chats_directory_is_created_private_and_named_on_the_line() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("slots-private");
        let slots = root.join("slots");
        let config = run(
            Some(PathBuf::from("/server/llama-server")),
            Machine {
                measurement: measured(0.0, Backend::Cpu),
                ram_bytes: 0,
            },
            None,
            1,
            Some(PathBuf::from("/dev/model.gguf")),
            PathBuf::from("/state/server.state"),
            slots.clone(),
            &root,
            &mut |_| {},
        )
        .expect("the dev override is the answer");
        let mode = std::fs::metadata(&slots)
            .expect("the walk made the folder")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o700, "a saved chat is private: {mode:o}");
        let argv = config.server.argv;
        let joined = argv.join(" ");
        assert_eq!(
            rendered_value(&argv, "--slot-save-path"),
            slots.display().to_string(),
            "{joined}"
        );
        // The literal `"1"`, not the constant: the pair is what the plan
        // pins, and asserting the constant would follow it into `"12"`.
        assert_eq!(rendered_value(&argv, "--ctx-checkpoints"), "1", "{joined}");
        assert!(!joined.contains("--swa-full"), "{joined}");
        let _ = std::fs::remove_dir_all(&root);
    }

    /// A folder that cannot be made stops the walk. The engine treats a
    /// `--slot-save-path` that is not a directory as an invalid argument, so
    /// starting anyway would fetch a model for an engine that cannot start.
    ///
    /// The blocker is a regular file where the folder's parent should be:
    /// `create_dir_all` fails with `NotADirectory` on every filesystem.
    #[test]
    fn a_launch_without_a_place_for_saved_chats_is_refused() {
        let root = scratch("slots-unwritable");
        let blocker = root.join("not-a-directory");
        std::fs::write(&blocker, b"a file, not a folder").expect("the blocker");
        let err = run(
            Some(PathBuf::from("/server/llama-server")),
            Machine {
                measurement: measured(0.0, Backend::Cpu),
                ram_bytes: 0,
            },
            None,
            1,
            Some(PathBuf::from("/dev/model.gguf")),
            PathBuf::from("/state/server.state"),
            blocker.join("slots"),
            &root,
            &mut |_| {},
        )
        .expect_err("a folder that cannot be made must stop the walk");
        assert!(
            matches!(err, StartupFailure::SlotSavePathUnwritable),
            "{err:?}"
        );
        let spoken = crate::failure::words(&err);
        // The whole sentence, pinned once: the place could not be made for
        // reasons this walk cannot tell apart, and freeing disk space is not
        // among the ones that help (a file where the folder belongs is
        // `NotADirectory`).
        assert_eq!(
            spoken,
            "The assistant could not prepare the place on this computer where chats are \
             kept, so it did not start."
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_measurement_the_probe_distrusts_stops_the_walk() {
        // Every attempt failed the probe's own checks and the last one came
        // back anyway: deciding on it would decide on noise.
        let mut measurement = measured(80.0e9, Backend::Cpu);
        measurement.reliability.reliable = false;
        measurement.reliability.notes = vec![
            "the repetitions disagreed by 35%: something else was using this machine \
             while it was measured"
                .to_string(),
        ];
        let root = scratch("unreliable");
        let err = run(
            Some(PathBuf::from("/server/llama-server")),
            Machine {
                measurement,
                ram_bytes: 16 * 1024 * 1024 * 1024,
            },
            None,
            1,
            Some(PathBuf::from("/dev/model.gguf")),
            PathBuf::from("/state/server.state"),
            root.join("slots"),
            &root,
            &mut |_| {},
        )
        .expect_err("an unreliable measurement is not a decision");
        let StartupFailure::MeasurementUnreliable(notes) = &err else {
            panic!("not a measurement refusal: {err:?}")
        };
        assert_eq!(notes.len(), 1, "the probe's own notes travel, unchanged");
        assert!(notes[0].contains("disagreed by 35%"), "{notes:?}");
        // And the reason reaches the owner's sentence: the probe's words sit
        // between the opening and the advice that were already approved.
        let spoken = crate::failure::words(&err);
        assert!(spoken.contains("disagreed by 35%"), "{spoken}");
        assert!(
            spoken.starts_with(
                "This computer could not be measured just now — it may be busy. "
            ),
            "{spoken}"
        );
        assert!(
            spoken.ends_with("Waiting a moment and turning on again usually works."),
            "{spoken}"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_selection_that_names_no_row_stops_instead_of_guessing() {
        // repo alone is not a key: a ghost selection must stop the walk, not
        // panic the app with a sentence that says nothing.
        let err = chosen_row("ghost/repo", "Ghost", "Q4_K_M", 1)
            .expect_err("nothing in the catalog is named ghost");
        assert!(
            matches!(err, StartupFailure::ChosenModelUnresolved),
            "{err:?}"
        );
        // And a real row is found on everything the selection carries.
        let row = rows().find(|entry| entry.display_name == "IBM Granite 4 Tiny")
            .expect("the test row left the catalog");
        let found = chosen_row(row.repo, row.display_name, row.quant, row.weights_bytes)
            .expect("the row is in the catalog");
        assert_eq!(found.repo, row.repo);
    }

    #[test]
    fn no_two_catalog_rows_share_an_identity() {
        // chosen_row's key is only as good as the catalog's uniqueness: two
        // rows matching on everything the selection carries would make the
        // lookup ambiguous, and ambiguity must fail loudly here. Both
        // tables: the lookup searches the research record and the download
        // menu together.
        let all: Vec<_> = rows().collect();
        for (index, a) in all.iter().enumerate() {
            for b in &all[index + 1..] {
                let same = a.repo == b.repo
                    && a.display_name == b.display_name
                    && a.quant == b.quant
                    && a.weights_bytes == b.weights_bytes;
                assert!(
                    !same,
                    "{} and {} share an identity",
                    a.display_name, b.display_name
                );
            }
        }
    }

    #[test]
    fn the_budget_follows_the_build_that_won_not_the_machine_detected() {
        // A 6 GiB card was detected, the GPU builds failed, the CPU build
        // won: the model will run in system RAM, so a 13.6 GiB row is funded
        // by the 32 GiB machine and must not be budgeted against the card.
        let detected = Backend::DiscreteGpu {
            vram_bytes: Some(6 * 1024 * 1024 * 1024),
        };
        let machine = Machine {
            measurement: measured(80.0e9, detected),
            ram_bytes: 32 * 1024 * 1024 * 1024,
        };
        assert_eq!(
            budget_backend(ServerBackend::Cpu, detected),
            Backend::Cpu,
            "the CPU build runs in system RAM"
        );
        assert_eq!(
            budget_backend(ServerBackend::Cuda12, detected),
            detected,
            "a GPU build decodes in the card"
        );
        let row = rows().find(|entry| entry.display_name == "Google Gemma 4 26B")
            .expect("the test row left the catalog");
        let config = planned_config(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            PathBuf::from("/models/chosen.gguf"),
            row,
            &machine,
            PathBuf::from("/state/server.state"),
        )
        .expect("system RAM funds what the VRAM budget refused");
        let joined = config.server.argv.join(" ");
        assert!(joined.contains("--n-gpu-layers") == false, "{joined}");
    }

    #[test]
    fn the_chooser_does_not_exclude_a_model_the_machine_funds_at_a_smaller_context() {
        // On 8 GiB, the rows around 4 GiB fund 5–6k tokens each; priced at
        // 8192 the chooser refused every one of them and handed the tier to
        // a smaller row. The pick must come from what the machine funds.
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 8 * 1024 * 1024 * 1024,
        };
        let phone = PhoneModel {
            weights_bytes: 2_200_000_000,
            parameters: Some(kalsa_catalog::Parameters::dense(4_000_000_000)),
            measured_tokens_per_second: None,
            battery_powered: Some(true),
        };
        let (plan, row, reason) =
            choose_model(ServerBackend::Cpu, &machine, Some(phone), None).expect("the tier is not empty");
        assert_ne!(
            reason, PHONE_FREE_REASON,
            "a paired phone means a comparison was made, so the reason is the\
             comparison's own words"
        );
        assert!(!reason.is_empty(), "the comparison must say something");
        let trinity = rows().find(|entry| entry.display_name == "Arcee Trinity Nano")
            .expect("the comparison row left the catalog");
        assert!(
            row.weights_bytes > trinity.weights_bytes,
            "the tier went to {} when bigger funded rows exist",
            row.display_name
        );
        // The plan and the row travel together by construction now — the
        // model step answers with the file its own row pins — so the plan
        // still names a real, pinned file.
        assert!(plan.bytes > 0 && !plan.url.is_empty(), "{:?}", plan.url);
    }

    #[test]
    fn the_server_starts_with_the_launch_plan_not_the_supervisor_constants() {
        // The product path: the context comes from the chosen row's cache
        // geometry against the real budget. Granite 4 Tiny on 8 GiB used to
        // fund 6112 tokens; now the sleeping-chat reserve is carved out first
        // (150_215_464 of the 600_861_856 bytes left), then the row's own
        // 58_060_800-byte recurrent state, and the context funds the rest:
        // 3993 tokens. The flags are still the launch
        // decision's — q8_0 cache under flash attention, no GPU flags on a
        // CPU build.
        let row = rows().find(|entry| entry.display_name == "IBM Granite 4 Tiny")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 8 * 1024 * 1024 * 1024,
        };
        let config = planned_config(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            PathBuf::from("/models/chosen.gguf"),
            row,
            &machine,
            PathBuf::from("/state/server.state"),
        )
        .expect("the model is fundable");
        let joined = config.server.argv.join(" ");
        assert_eq!(
            rendered_value(&config.server.argv, "--ctx-size"),
            "3993",
            "{joined}"
        );
        assert_eq!(
            rendered_value(&config.server.argv, "--cache-ram"),
            "143",
            "{joined}"
        );
        assert!(!joined.contains("8192"), "the old constant, back: {joined}");
        assert_eq!(
            rendered_value(&config.server.argv, "--threads"),
            "2",
            "{joined}"
        );
        assert_eq!(
            rendered_value(&config.server.argv, "--cache-type-k"),
            "q8_0",
            "{joined}"
        );
        assert_eq!(
            rendered_value(&config.server.argv, "--flash-attn"),
            "on",
            "{joined}"
        );
        assert!(!joined.contains("n-gpu-layers"), "{joined}");
    }

    /// A mounted engine the way the walk leaves it: a launcher beside a module
    /// whose bytes are the test's own. `None` is the honest `NotConsumed` case
    /// — an upstream archive, an Intel row, a Windows build — and the fork's
    /// inlet is the lowercase literal the engine matches.
    fn engine_dir(name: &str, module: Option<&[u8]>) -> PathBuf {
        let dir = scratch(name);
        let exe = dir.join("kalsa-server");
        std::fs::write(&exe, b"a thin launcher").expect("launcher");
        if let Some(bytes) = module {
            std::fs::write(dir.join(kalsa_runtime::ENGINE_MODULE_FILE), bytes).expect("module");
        }
        exe
    }

    #[test]
    fn a_clamped_capacity_reaches_the_plan() {
        // The door clamps its capacity to one when the engine carries no
        // `x-kalsa-slot` inlet. The plan divides the context by the slots, so a
        // plan that kept the requested number would give one device `1/N` of
        // the window while the machine paid N per-slot KV terms for the rest.
        // The build decision runs before the model step, so the exe is known
        // when every `LaunchInput` is built and the clamp lands before the plan.
        let row = rows()
            .find(|entry| entry.display_name == "Alibaba Qwen 3.6")
            .expect("the test row left the catalog");
        let budget = memory_budget(Backend::Metal, 64 * 1024 * 1024 * 1024);
        let ramp = &[(1usize, 55.8), (8, 112.2)][..];
        let input = |parallel: u32| LaunchInput {
            backend: ServerBackend::Metal,
            model: row,
            budget,
            thread_ramp: ramp,
            physical_cores: None,
            model_path: PathBuf::from("/models/chosen.gguf"),
            port: PORT,
            context_limit: None,
            batch_size: 2048,
            ubatch_size: 512,
            kv_cache: KvCache::Q8_0,
            parallel,
            slot_save_path: PathBuf::from("/slots"),
        };

        // No inlet: the requested four slots must not reach the plan, and the
        // context must be the one-slot window, not a quarter of it.
        let blind = engine_dir("no-inlet", Some(b"a module that never heard of the door"));
        let requested = 4;
        assert_eq!(
            planned_parallel(&blind, requested),
            1,
            "an engine that cannot isolate must not be planned for four devices"
        );
        let clamped = kalsa_launch::plan(&input(planned_parallel(&blind, requested)))
            .expect("the big row is fundable on 64 GiB");
        let one = kalsa_launch::plan(&input(1)).expect("one slot is fundable");
        assert_eq!(clamped.args.parallel, 1);
        assert_eq!(
            clamped.args.context_tokens, one.args.context_tokens,
            "the clamp must hand the plan the one-slot context, not a divided one"
        );

        // The fork's module carries the inlet: the requested slots stand and
        // the total is what the engine will divide.
        let fork = engine_dir("inlet", Some(b"a module carrying x-kalsa-slot inside"));
        assert_eq!(planned_parallel(&fork, requested), requested);
        let four = kalsa_launch::plan(&input(planned_parallel(&fork, requested)))
            .expect("four slots of the big row are fundable");
        assert_eq!(four.args.parallel, requested);
        assert!(
            four.args.context_tokens > clamped.args.context_tokens,
            "the four-slot total must be the four one-slot windows, not one"
        );

        for exe in [&blind, &fork] {
            if let Some(dir) = exe.parent() {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
    }

    /// The seat count is discovered from the plan, never from a constant:
    /// the first count from the top that funds. This is the rule that lets a
    /// machine which cannot pay for the whole family keep the smaller number
    /// instead of refusing to start at all.
    #[test]
    fn the_funded_seat_count_is_the_first_one_from_the_top_that_funds() {
        assert_eq!(funded_parallel(4, |slots| slots <= 2), 2);
        assert_eq!(
            funded_parallel(1, |_| false),
            1,
            "a model that funds nothing is still asked at one seat, and the \
             caller's own plan refuses it there exactly as before"
        );
        assert_eq!(
            funded_parallel(0, |_| true),
            1,
            "an unreadable store answers zero devices; the seat count stays one"
        );
    }

    /// A family of three on a machine that funds the big row four ways: the
    /// plan must divide the window three ways and the door reads the same
    /// number from `args.parallel`. The same three devices against an engine
    /// that cannot isolate must be planned and served for one — more than one
    /// would wrap onto somebody else's slot.
    #[test]
    fn enrolled_devices_size_the_slots_and_an_engine_that_cannot_isolate_drops_to_one() {
        let row = rows()
            .find(|entry| entry.display_name == "Alibaba Qwen 3.6")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Metal),
            ram_bytes: 64 * 1024 * 1024 * 1024,
        };
        let run_three = |exe: PathBuf| {
            planned_config_with_overrides(
                ServerBackend::Metal,
                exe,
                PathBuf::from("/models/chosen.gguf"),
                row,
                TEST_REASON.to_string(),
                TEST_SHA256,
                &machine,
                3,
                PathBuf::from("/state/server.state"),
                PathBuf::from("/slots"),
                LaunchOverrides::default(),
            )
        };

        let fork = engine_dir("seats-inlet", Some(b"a module carrying x-kalsa-slot inside"));
        let three = run_three(fork.clone()).expect("three seats of the big row are fundable");
        assert_eq!(three.info.args.parallel, 3, "three devices, three seats");
        assert!(
            three.server.argv.join(" ").contains("--parallel 3"),
            "the engine must run the seats the door serves: {}",
            three.server.argv.join(" ")
        );

        let blind = engine_dir("seats-no-inlet", Some(b"a module that never heard of the door"));
        let one = run_three(blind.clone()).expect("one seat is fundable");
        assert_eq!(
            one.info.args.parallel, 1,
            "an engine that cannot isolate must not be planned for three devices"
        );

        for exe in [&fork, &blind] {
            if let Some(dir) = exe.parent() {
                let _ = std::fs::remove_dir_all(dir);
            }
        }
    }

    /// A machine that cannot fund the enrolled family keeps the smaller
    /// number and says so: Granite 4 Tiny on 8 GiB funds one 3993-token slot,
    /// and two slots would each land below the 4096-token floor. The plan
    /// stays at one seat; the door then refuses the second device with words.
    #[test]
    fn a_machine_that_cannot_fund_the_family_keeps_the_smaller_number() {
        let row = rows()
            .find(|entry| entry.display_name == "IBM Granite 4 Tiny")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 8 * 1024 * 1024 * 1024,
        };
        let fork = engine_dir("seats-unfunded", Some(b"a module carrying x-kalsa-slot inside"));
        let config = planned_config_with_overrides(
            ServerBackend::Cpu,
            fork.clone(),
            PathBuf::from("/models/chosen.gguf"),
            row,
            TEST_REASON.to_string(),
            TEST_SHA256,
            &machine,
            2,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides::default(),
        )
        .expect("one seat is fundable even when two are not");
        assert_eq!(
            config.info.args.parallel, 1,
            "two seats would starve both slots; the machine keeps one"
        );
        if let Some(dir) = fork.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    #[test]
    fn persisted_advanced_overrides_reach_the_supervisor_argv() {
        let root = scratch("advanced");
        let state_file = root.join("server.state");
        crate::options::save(
            &state_file,
            LaunchOverrides {
                context_tokens: Some(1024),
                idle_unload_seconds: Some(600),
                internet_road: false,
                ..LaunchOverrides::default()
            },
        )
        .expect("save advanced settings");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 8 * 1024 * 1024 * 1024,
        };
        let config = run(
            Some(PathBuf::from("/server/llama-server")),
            machine,
            None,
            1,
            Some(PathBuf::from("/models/chosen.gguf")),
            state_file,
            root.join("slots"),
            &root,
            &mut |_| {},
        )
        .expect("the saved values are within the machine's bounds");
        assert_eq!(
            rendered_value(&config.server.argv, "--ctx-size"),
            "1024",
            "{:?}",
            config.server.argv
        );
        assert_eq!(
            rendered_value(&config.server.argv, "--sleep-idle-seconds"),
            "600",
            "{:?}",
            config.server.argv
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_dev_context_above_its_safe_ceiling_is_rejected() {
        let root = scratch("dev-context-too-large");
        let state_file = root.join("server.state");
        crate::options::save(
            &state_file,
            LaunchOverrides {
                context_tokens: Some(DEV_CONTEXT_TOKENS + 1),
                idle_unload_seconds: Some(600),
                internet_road: false,
                ..LaunchOverrides::default()
            },
        )
        .expect("save advanced settings");
        let err = run(
            Some(PathBuf::from("/server/llama-server")),
            Machine {
                measurement: measured(0.0, Backend::Cpu),
                ram_bytes: 0,
            },
            None,
            1,
            Some(PathBuf::from("/models/chosen.gguf")),
            state_file,
            root.join("slots"),
            &root,
            &mut |_| {},
        )
        .expect_err("the dev path has a conservative context ceiling");
        assert!(matches!(
            err,
            StartupFailure::ContextTooLarge { .. }
        ));
        assert!(crate::failure::words(&err).contains("Choose a smaller context"));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The development roof is the budgeted roof's smaller cousin, and it
    /// follows the cache type for the same reason: an f16 chat is bigger, and
    /// the server skips a state larger than the cap instead of keeping it warm.
    /// One chat at the dev context is 96 KiB * 4096 = 384 MiB at q8_0, so 768
    /// MiB at f16.
    #[test]
    fn the_development_roof_follows_the_cache_type() {
        let root = scratch("dev-roof-f16");
        let state_file = root.join("server.state");
        crate::options::save(
            &state_file,
            LaunchOverrides {
                kv_cache: Some(KvCache::F16),
                ..LaunchOverrides::default()
            },
        )
        .expect("save the f16 choice");
        let config = run(
            Some(PathBuf::from("/server/llama-server")),
            Machine {
                measurement: measured(0.0, Backend::Cpu),
                ram_bytes: 0,
            },
            None,
            1,
            Some(PathBuf::from("/models/chosen.gguf")),
            state_file,
            root.join("slots"),
            &root,
            &mut |_| {},
        )
        .expect("the dev override is the answer");
        assert_eq!(
            rendered_value(&config.server.argv, "--cache-ram"),
            "768",
            "{:?}",
            config.server.argv
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_catalog_context_above_the_funded_maximum_is_rejected() {
        let row = rows().find(|entry| entry.display_name == "IBM Granite 4 Tiny")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 8 * 1024 * 1024 * 1024,
        };
        let err = planned_config_with_overrides(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            PathBuf::from("/models/chosen.gguf"),
            row,
            TEST_REASON.to_string(),
            TEST_SHA256,
            &machine,
            // One seat: this test is about the context guard, not the
            // capacity rule.
            1,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides {
                context_tokens: Some(8192),
                idle_unload_seconds: Some(600),
                internet_road: false,
                ..LaunchOverrides::default()
            },
        )
        .expect_err("8192 exceeds Granite's funded maximum on 8 GiB");
        assert!(matches!(err, StartupFailure::ContextTooLarge { .. }));
    }

    /// The automatic launch is the chat default, not the machine's funded
    /// maximum: a 64 GiB Mac funds 262 144 for the row on disk but launches
    /// 65 536 when the owner has not chosen. A choice above the default is
    /// honoured right up to the maximum, and one token above it is refused by
    /// the guard, which names the number.
    #[test]
    fn the_automatic_launch_is_the_chat_default_and_a_bigger_choice_is_honoured_to_the_maximum() {
        let row = rows()
            .find(|entry| entry.display_name == "Alibaba Qwen 3.6")
            .expect("the row on disk left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Metal),
            ram_bytes: 64 * 1024 * 1024 * 1024,
        };
        let run = |context: Option<u64>| {
            planned_config_with_overrides(
                ServerBackend::Metal,
                PathBuf::from("/server/llama-server"),
                PathBuf::from("/models/chosen.gguf"),
                row,
                TEST_REASON.to_string(),
                TEST_SHA256,
                &machine,
                // One seat: the maximum this test pins is the per-slot
                // ceiling, not a family's worth of them.
                1,
                PathBuf::from("/state/server.state"),
                PathBuf::from("/slots"),
                LaunchOverrides {
                    context_tokens: context,
                    ..LaunchOverrides::default()
                },
            )
        };
        // No owner choice: the chat default, on a machine that funds four
        // times as much.
        let automatic = run(None).expect("the automatic launch is fundable");
        assert_eq!(automatic.info.args.context_tokens, 65_536);
        assert_eq!(
            automatic.info.maximum_context.q8_0,
            Some(262_144),
            "the maximum the panel and the guard read is still the machine's"
        );
        assert_eq!(automatic.info.automatic_context.q8_0, Some(65_536));
        // Above the default, still funded: honoured as asked.
        let raised = run(Some(131_072)).expect("a choice above the default is honoured");
        assert_eq!(raised.info.args.context_tokens, 131_072);
        // Above the machine's maximum: refused, with the number in the words.
        let err = run(Some(262_145)).expect_err("one token above the maximum is refused");
        assert!(
            matches!(err, StartupFailure::ContextTooLarge { .. }),
            "{err:?}"
        );
        let spoken = crate::failure::words(&err);
        assert!(
            spoken.contains("262144"),
            "the refusal must name the machine's maximum: {spoken}"
        );
    }

    #[test]
    fn a_context_only_q8_0_funds_is_refused_when_f16_is_chosen() {
        // Granite 4 Tiny on 8 GiB of CPU funds 3993 tokens at q8_0 and 1996
        // at f16. 4096 fits the q8_0 cache and not the f16 one: choosing f16
        // must refuse it, not start a server whose f16 cache would
        // oversubscribe the machine. If the guard read the q8_0 maximum
        // instead of the chosen cache's, this would be accepted.
        let row = rows()
            .find(|entry| entry.display_name == "IBM Granite 4 Tiny")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 8 * 1024 * 1024 * 1024,
        };
        let err = planned_config_with_overrides(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            PathBuf::from("/models/chosen.gguf"),
            row,
            TEST_REASON.to_string(),
            TEST_SHA256,
            &machine,
            // One seat: f16's funded maximum is a per-slot figure here.
            1,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides {
                context_tokens: Some(4096),
                idle_unload_seconds: Some(600),
                kv_cache: Some(KvCache::F16),
                ..LaunchOverrides::default()
            },
        )
        .expect_err("4096 is beyond the f16 funded maximum of 1996");
        assert!(
            matches!(err, StartupFailure::ContextTooLarge { .. }),
            "{err:?}"
        );
        // The refusal must carry the figure and the cache it was funded
        // for: the owner is told what to choose below, not just that the
        // request was too large.
        let spoken = crate::failure::words(&err);
        assert!(
            spoken.contains("1996"),
            "the refusal must name the funded maximum: {spoken}"
        );
        assert!(
            spoken.contains("f16"),
            "the refusal must name the chosen cache: {spoken}"
        );
    }

    #[test]
    fn a_model_the_machine_cannot_fund_stops_the_walk_honestly() {
        let row = rows().find(|entry| entry.display_name == "Google Gemma 4 E4B")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 8 * 1024 * 1024 * 1024,
        };
        let err = planned_config(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            PathBuf::from("/models/chosen.gguf"),
            row,
            &machine,
            PathBuf::from("/state/server.state"),
        )
        .expect_err("the weights and buffers alone exceed this budget");
        assert!(
            matches!(err, StartupFailure::ChosenModelUnfundable),
            "{err:?}"
        );
    }

    #[test]
    fn a_zero_trained_length_blames_the_models_data_not_the_machine() {
        // Granite on a roomy machine funds a real context, so zeroing the
        // row's trained length is the only thing that can stop this start.
        // The refusal must say the model's context length could not be read
        // — a fact about the file — never that the machine is short of
        // memory, which is what the unfundable refusal said.
        let mut row = *rows()
            .find(|entry| entry.display_name == "IBM Granite 4 Tiny")
            .expect("the test row left the catalog");
        row.trained_context_tokens = Some(0);
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 32 * 1024 * 1024 * 1024,
        };
        let err = planned_config(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            PathBuf::from("/models/chosen.gguf"),
            &row,
            &machine,
            PathBuf::from("/state/server.state"),
        )
        .expect_err("a model whose trained length reads as zero is not started");
        assert_eq!(
            crate::failure::words(&err),
            "The model chosen for this computer does not say how long a conversation \
             it was built for, so it was not started. An app update may fix this.",
            "{err:?}"
        );
    }

    #[test]
    fn a_metal_machine_gets_the_full_offload_the_budget_accounted_for() {
        let row = rows().find(|entry| entry.display_name == "IBM Granite 4 Tiny")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Metal),
            ram_bytes: 16 * 1024 * 1024 * 1024,
        };
        let config = planned_config(
            ServerBackend::Metal,
            PathBuf::from("/server/llama-server"),
            PathBuf::from("/models/chosen.gguf"),
            row,
            &machine,
            PathBuf::from("/state/server.state"),
        )
        .expect("the model is fundable");
        assert_eq!(
            rendered_value(&config.server.argv, "--n-gpu-layers"),
            "all",
            "{:?}",
            config.server.argv
        );
    }

    #[test]
    fn the_launch_record_names_the_catalogs_choice_and_the_dev_path_does_not() {
        // The name the screen renders is the row's own, carried from the
        // catalog through the launch record — never re-derived from a
        // filename, which stays a Rust-side fact.
        let row = rows()
            .find(|entry| entry.display_name == "IBM Granite 4 Tiny")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 8 * 1024 * 1024 * 1024,
        };
        let config = planned_config(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            PathBuf::from("/models/chosen.gguf"),
            row,
            &machine,
            PathBuf::from("/state/server.state"),
        )
        .expect("the model is fundable");
        assert_eq!(
            config.info.display_name.as_deref(),
            Some("IBM Granite 4 Tiny"),
            "the catalog's own name travels with the launch"
        );
        assert_eq!(
            config.info.reason.as_deref(),
            Some(TEST_REASON),
            "the reason the model step answered with travels with the launch"
        );

        // The development override launches without a catalog choice: the
        // name is absent rather than invented.
        let machine = Machine {
            measurement: measured(0.0, Backend::Cpu),
            ram_bytes: 0,
        };
        let root = scratch("dev-name");
        let dev = run(
            Some(PathBuf::from("/server/llama-server")),
            machine,
            None,
            1,
            Some(PathBuf::from("/dev/model.gguf")),
            PathBuf::from("/state/dev.state"),
            root.join("slots"),
            &root,
            &mut |_| {},
        )
        .expect("the override is the answer");
        assert_eq!(dev.info.display_name, None);
        assert_eq!(
            dev.info.reason, None,
            "nothing was chosen, so there is nothing to explain"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ram_bytes_reports_something_on_this_machine() {
        assert!(ram_bytes() > 0, "the platform refused to say its RAM");
    }
}
