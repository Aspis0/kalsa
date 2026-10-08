//! "Turn on": the walk from nothing to a supervised server.
//!
//! The order is the product: decide the backend (a standing verdict means
//! nothing is downloaded), put the chosen model on disk, start the server
//! and keep it up. It runs entirely off the main thread and reports its
//! progress as data; two presses cannot run two walks, which is the command
//! guard's job, not this file's.
//!
//! The download is consented before the walk starts: the first run's pick
//! stores the choice, and the walk fetches what it names. A turn-on with nothing
//! stored is refused before any walk (`first_run::require_choice`); the
//! model's own fetch refuses too (`AwaitingChoice`), as the second line. A
//! stored choice this walk cannot honour stops there too — and is
//! forgotten, so the home page offers the pick again.
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
    fits, memory_budget, rows, usable, usable_with_q8, ChoiceInput, Decision, DownloadPlan,
    MemoryBudget, ModelEntry, PhoneModel, CHOOSER_CONTEXT_TOKENS,
};
use kalsa_download::default_roots;
// The cheap first pass over stores that name blobs by digest; find_local
// stays underneath it, so this is an optimization on top of the engine the
// download path already used.
use kalsa_launch::{KvCache, LaunchInput, Offload, ServerArgs, ServerSettings};
use kalsa_probe::Measurement;
use kalsa_reuse::find_reusable;
use kalsa_runtime::ServerBackend;
use kalsa_supervisor::{ServerConfig, DEFAULT_STOP_GRACE};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::capability::{CHOSEN_REASON, PHONE_FREE_REASON};
use crate::failure::StartupFailure;
use crate::options::LaunchOverrides;
use crate::placement::place_model;

/// Loopback port. The phone reaches it through a tunnel, never over the LAN.
pub(crate) const PORT: u16 = 8130;
/// Loading a model from a slow disk on an old machine is not fast.
pub(crate) const READY_TIMEOUT: Duration = Duration::from_secs(600);
/// Long enough for a clean unload, short enough that closing the window is not
/// a hang: the supervisor escalates to SIGKILL after the second one.
const STOP_GRACE: Duration = Duration::from_secs(2);
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
#[derive(Clone)]
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
    /// lifetimes have finished, and how many are planned so far. The
    /// second field is named for the page's own wire: ProgressStep reads
    /// `total`, and one name on both sides is cheaper than a mapping.
    /// `candidate` is the page's third number: the candidate this report
    /// is about — `done + 1` when it starts, `done` when it closes (or
    /// when only the plan lowered) — so the walk can name the test on
    /// screen and time one candidate against the ones behind it.
    Tuning {
        done: usize,
        total: usize,
        candidate: usize,
        /// The tune's budget in whole seconds (kalsa-tune's own clock). The
        /// page has nothing to average before two lifetimes have finished,
        /// and this is what its wait counts down from instead — no lifetime
        /// begins past it, so it is an end the page may name.
        budget_seconds: u64,
        /// The budget (or a shape that never began) stopped this tune short
        /// of its plan: `total` is what the start still owes, so `done ==
        /// total` never means finished here — the page keeps its bar at the
        /// height reached and says the rest runs next start.
        cut: bool,
        /// True only on a stop that still OWES that next start: a marker
        /// will be written, so a later start measures the rest. False on a
        /// second cut, whose verdict saves as a normal record — nothing is
        /// owed, and the page says what was kept instead.
        retry_next: bool,
        /// Whether the tune ended WITH a winner — the flag the stop's line
        /// reads once `retry_next` is false: what was kept is only kept if
        /// there was something to keep, or the page promises a "best" that
        /// never existed and the rule stands instead.
        kept_winner: bool,
    },
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

/// The drafter this launch carries, when placement proved one: where it
/// landed, the pin it was proven against — the pin is what the tune's
/// fingerprint and the record's key travel on — and its size, which is
/// what the window is funded around.
pub(crate) struct DrafterLaunch {
    pub(crate) path: PathBuf,
    pub(crate) sha256: &'static str,
    pub(crate) bytes: u64,
}

/// The row's vision projector as this launch knows it: the pin (for the
/// chat's offer and the on-demand download) and where its verified file
/// belongs. `proven` is `Some` only when the file answered for itself on
/// disk before the plan ran — the fact that decides both the argv's
/// `--mmproj` and whether the memory plan charges the file at all.
#[derive(Clone, Debug)]
pub(crate) struct MmprojLaunch {
    pub(crate) url: String,
    pub(crate) sha256: &'static str,
    pub(crate) bytes: u64,
    /// The verified file this launch passes to the engine, when it was on
    /// disk. `None` renders no vision flags and leaves the chat an offer.
    pub(crate) proven: Option<PathBuf>,
}

/// The plan's own seams, kept beside the launch record so a later question
/// about this launch — vision's fit check is the one today — re-asks the
/// ONE arithmetic ([`kalsa_launch::plan`]) with the same inputs the walk
/// used, never a recomputation beside it.
#[derive(Clone, Copy, Debug)]
pub(crate) struct LaunchSizing {
    pub(crate) backend: ServerBackend,
    pub(crate) budget: MemoryBudget,
    pub(crate) row: &'static ModelEntry,
    pub(crate) drafter_bytes: u64,
}

/// The exact launch data kept by the shell after the supervisor receives it.
/// The UI reads this rather than reconstructing values from argv strings.
#[derive(Debug, Clone)]
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
    /// This start's checked speed, as the panel shows it — the check's own
    /// words, composed where the tune's words live. `None` when no check
    /// ran (no graphics winner, or the development path).
    pub(crate) checked: Option<String>,
    /// The drafter's pinned sha256, when this launch carries one: the tune's
    /// fingerprint keys on it, so a changed drafter is re-measured and a
    /// launch without one never reuses a record that had it. `None` on the
    /// development path and when placement fell back to target-only.
    pub(crate) drafter_sha256: Option<String>,
    /// The row's projector: its pin, where its verified file belongs, and
    /// whether that file was proven this launch. `None` on the development
    /// path and on every row with no projector — there is nothing to offer
    /// and nothing to enable.
    pub(crate) mmproj: Option<MmprojLaunch>,
    /// The walk's own sizing seams, for the fit question a later command
    /// asks about this launch. `None` on the development path, where there
    /// is no row and no budget to re-ask the arithmetic with.
    pub(crate) sizing: Option<LaunchSizing>,
}

#[derive(Debug)]
pub(crate) struct PreparedStart {
    pub(crate) server: ServerConfig,
    pub(crate) info: LaunchInfo,
    /// The graphics winner's processor alternative — config and args —
    /// resolved during the tune: what the per-start check switches to when
    /// the card answers slow. None unless the launch is a graphics winner.
    pub(crate) processor: Option<(ServerConfig, ServerArgs)>,
    /// The plan's own launch — config AND args — beside the tuned one:
    /// main.rs retries with this when the tuned launch fails to load (and
    /// so tells the panel what actually ran), and compares it to know
    /// whether the tune changed anything at all. `None` only until the
    /// tune step has run — the development path never sets it.
    pub(crate) rule_launch: Option<(ServerConfig, ServerArgs)>,
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
    let chosen = overrides.model.as_deref();
    // The build that won carries the backend it was chosen for; a dev-pinned
    // binary has no verdict, so the platform's default path stands in.
    let (mut backend, mut exe) = match server_override {
        Some(exe) => {
            log::info!(
                "machine: {} GiB RAM, runs on {:?}, card {}, backend dev-pinned",
                machine.ram_bytes / (1024 * 1024 * 1024),
                machine.measurement.will_run_on,
                kalsa_probe::discrete_name().as_deref().unwrap_or("none named")
            );
            (dev_backend(), exe)
        }
        None => {
            progress(Progress::Deciding);
            let decision = kalsa_runtime::decide(machine.measurement.will_run_on, &mut |p| {
                progress(Progress::RuntimeBytes {
                    done: p.bytes_done,
                    total: p.bytes_total,
                })
            })?;
            // The machine check, as the walk will act on it: the RAM it
            // budgets, the graphics it measured and named, the backend the
            // decision chose.
            log::info!(
                "machine: {} GiB RAM, runs on {:?}, card {}, backend {}",
                machine.ram_bytes / (1024 * 1024 * 1024),
                machine.measurement.will_run_on,
                kalsa_probe::discrete_name().as_deref().unwrap_or("none named"),
                decision.backend.name()
            );
            (decision.backend, decision.exe)
        }
    };
    // One card, named by the engine itself: a graphics build on a machine
    // with two Vulkan devices splits layers across both (slower than either
    // alone) and can refuse to start when the MTP drafter lands on the
    // other, so the start pins the card detection named — matched against
    // the build's own `--list-devices` descriptions, with the single-listed-
    // device rule when detection named nothing (the integrated GPU's case).
    // No unambiguous card means no graphics build: the CPU build stands,
    // because starting on the wrong card is worse than starting on none.
    let mut device = None;
    // The engine's own `--list-devices` answer, kept for the session facts
    // (the engine block logs what the app asked and what it pinned).
    let mut listed_devices: Vec<(String, String)> = Vec::new();
    if backend == ServerBackend::Vulkan {
        let listed = kalsa_runtime::list_devices(&exe);
        let (routed, chosen) = device_route(
            machine.measurement.will_run_on,
            listed.as_deref(),
            kalsa_probe::discrete_name,
        );
        listed_devices = listed.unwrap_or_default();
        if routed != backend {
            progress(Progress::Deciding);
            let cpu = kalsa_runtime::decide_cpu(machine.measurement.will_run_on, &mut |p| {
                progress(Progress::RuntimeBytes {
                    done: p.bytes_done,
                    total: p.bytes_total,
                })
            })?;
            backend = cpu.backend;
            exe = cpu.exe;
        }
        device = chosen;
    }
    let model = match model_override {
        // Development: the developer pinned the file and owns its bytes, so
        // the choice is skipped entirely — an unpaired machine must still be
        // able to run a dev build.
        Some(path) => path,
        None => {
            progress(Progress::Choosing);
            // The MAIN verdict (the build that answered its probe) travels
            // to the tune separately from the chosen build: on the Lenovo
            // the model choice falls through to the processor while the
            // graphics candidate must still be offered for measuring.
            let main = (backend, exe.clone());
            let step =
                choose_with_processor_fallback((backend, exe), &machine, phone, chosen, || {
                    progress(Progress::Deciding);
                    kalsa_runtime::decide_cpu(machine.measurement.will_run_on, &mut |p| {
                        progress(Progress::RuntimeBytes {
                            done: p.bytes_done,
                            total: p.bytes_total,
                        })
                    })
                });
            let (build, exe, plan, row, reason) = match step {
                Ok(step) => step,
                // `AwaitingChoice` out of the walk names a token nothing
                // answers to any more: forgotten, so Home offers the pick
                // again. A chosen row the walk refuses arrives in its own
                // words and stays chosen — nothing unpicked is fetched,
                // taken from disk or started.
                Err(StartupFailure::AwaitingChoice) => {
                    forget_choice(&state_file);
                    return Err(StartupFailure::AwaitingChoice);
                }
                Err(failure) => return Err(failure),
            };
            // Consent is the stored row itself, checked against the row
            // about to be placed; without it nothing is used — not even a
            // copy already on disk.
            let placed = place_model(&plan, root, consented(chosen, row), progress)?;
            log::info!("model picked: {} ({} bytes)", model_token(row), plan.bytes);
            let drafter = placed
                .drafter
                .zip(plan.drafter.as_ref())
                .map(|(path, file)| DrafterLaunch {
                    path,
                    sha256: file.sha256,
                    bytes: file.bytes,
                });
            // The projector is checked, never fetched: the chat offers it
            // while the pin has no verified file, and the owner's explicit
            // yes is the only thing that downloads one. A proven file takes
            // the fast road — size, then the record beside the file, then
            // the digest — exactly as the weights do. A pin whose address
            // does not name a plain file is no offer at all, like a
            // drafter's.
            let mmproj = plan.mmproj.as_ref().and_then(|pin| {
                // A pin whose address does not name a plain file builds no
                // destination and so is no offer at all, like a drafter's.
                if crate::placement::projector_destination(pin, root).is_none() {
                    log::warn!("the projector's address does not name a plain file; no vision");
                    return None;
                }
                let proven = crate::placement::proven_projector(pin, root);
                if let Some(verified) = &proven {
                    log::info!(
                        "projector: {} verified on disk, passing it",
                        verified
                            .file_name()
                            .and_then(|name| name.to_str())
                            .unwrap_or("mmproj")
                    );
                }
                Some(crate::startup::MmprojLaunch {
                    url: pin.url.clone(),
                    sha256: pin.sha256,
                    bytes: pin.bytes,
                    proven,
                })
            });
            let mut prepared = planned_config_with_overrides(
                build,
                exe,
                device,
                placed.weights,
                drafter,
                mmproj,
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
            let mut memo = crate::tune_step::Memo {
                // The probe's counts, both: available_parallelism answers
                // for THIS process's affinity and moves with a limit — a
                // key built on it re-tuned whenever one blinked.
                cores: (kalsa_probe::physical_cores(), kalsa_probe::logical_cores()),
                processor: None,
            };
            crate::tune_step::tune_launch(
                &mut prepared,
                &machine,
                root,
                main,
                &mut memo,
                progress,
                |resolved, rule, prior, inner, checkpoint| {
                    crate::tune_step::measure_with_rule(
                        root,
                        resolved,
                        rule,
                        prior,
                        inner,
                        checkpoint,
                    )
                },
            );
            // The engine's facts, as the walk settles them — on every start,
            // an in-process restart included. The tune's winner is logged by
            // the tune itself and is not repeated here.
            crate::system::log_engine(
                &crate::system::Engine {
                    release: kalsa_runtime::RELEASE,
                    build: backend.name(),
                    listed_devices,
                    device: prepared.info.args.device.clone(),
                    model: prepared.info.display_name.clone(),
                    row: Some(model_token(row)),
                    context_tokens: prepared.info.args.context_tokens,
                    drafter: prepared.info.args.draft.is_some(),
                },
                &crate::system::host_name(),
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
///
/// A stored choice is honoured when this walk can run it. One the winning
/// budget cannot hold answers in the chosen model's own words — over budget
/// (`ChosenModelUnfundable`) or withheld by the speed floors
/// (`NothingFastEnough`) — and keeps the choice: the card arm below hands
/// the over-budget case to the processor budget. A token nothing answers to,
/// and a row no fetched file answers to, stop the walk (`AwaitingChoice`);
/// there is no automatic answer beside the choice: a model the owner did not
/// pick is never started, not even one already on disk.
fn choose_model(
    winner: ServerBackend,
    machine: &Machine,
    phone: Option<PhoneModel>,
    chosen: Option<&str>,
) -> Result<(DownloadPlan, &'static ModelEntry, String), StartupFailure> {
    let input = choice_input(winner, machine, phone);
    if let Some(token) = chosen {
        let Some(row) = row_for_token(token) else {
            return Err(StartupFailure::AwaitingChoice);
        };
        if let Some(run) = kalsa_catalog::runnable_row(&input, row) {
            return Ok((run.download, run.entry, CHOSEN_REASON.to_string()));
        }
        // A row no fetched file answers to is not a choice the walk can act
        // on — it stops and is forgotten, like the unknown token above.
        let on_the_menu = usable().any(|candidate| {
            let entry = candidate.entry();
            entry.repo == row.repo
                && entry.quant == row.quant
                && entry.weights_bytes == row.weights_bytes
        });
        if !on_the_menu {
            return Err(StartupFailure::AwaitingChoice);
        }
        // On the menu and refused here: the catalog's own fit predicate, at
        // the window the row is priced at (`priced_context`, the same figure
        // `runnable_on` judged), so "over budget" is the same fact — not a
        // recomputation beside it. A row that fits but does not run is the
        // floors' verdict. Both keep the choice; the card arm hands the
        // over-budget case to the processor budget.
        return Err(
            if fits(
                row,
                row.priced_context(input.context_tokens),
                &memory_budget(input.backend, input.ram_bytes),
            ) {
                StartupFailure::NothingFastEnough
            } else {
                StartupFailure::ChosenModelUnfundable
            },
        );
    }
    automatic_choice(&input, phone)
}

/// The answer this computer would give with nobody choosing: the row that
/// takes the first card (`largest_that_runs_well`) — the biggest row that
/// cleared its line while some line was cleared, the fastest of them where
/// none could be. This is the whole promise for everyone who never opens
/// the page that offers a choice, so it is one function and the
/// stored-choice branch is beside it, not inside it.
fn automatic_choice(
    input: &ChoiceInput,
    phone: Option<PhoneModel>,
) -> Result<(DownloadPlan, &'static ModelEntry, String), StartupFailure> {
    match phone {
        // No `PhoneUnknown` can reach the walk from either arm: this one
        // runs `choose` only when a phone is in the input it is given, and
        // the phone-free question never asks for one.
        None => {
            let run =
                kalsa_catalog::largest_that_runs_well(&input).map_err(StartupFailure::from)?;
            Ok((run.download, run.entry, PHONE_FREE_REASON.to_string()))
        }
        Some(_) => {
            let selection = match kalsa_catalog::choose(&input) {
                Decision::Pick(selection) => selection,
                // The phone decides whether this computer is an upgrade,
                // never whether the brain can run: "nothing beats your
                // phone" is a verdict on the upgrade, and the walk answers
                // it by starting anyway with the machine-only pick, said to
                // nobody — the owner's ruling.
                Decision::Refuse(refusal)
                    if refusal.reason == kalsa_catalog::RefusalReason::NothingBetter =>
                {
                    let run =
                        kalsa_catalog::largest_that_runs_well(&input).map_err(StartupFailure::from)?;
                    return Ok((run.download, run.entry, FALLBACK_PICK_REASON.to_string()));
                }
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

/// The sentence for the pick the walk starts when the phone comparison
/// refused: the machine-only answer, chosen with no phone in the question.
pub(crate) const FALLBACK_PICK_REASON: &str =
    "Kalsa picked this because it runs well on this computer.";

/// Which build and device the graphics start routes to. A dedicated card is
/// matched by the name detection gave it, and with no name there is nothing
/// to match. The single-listed-device rule belongs to the one case detection
/// positively knows is an integrated GPU (a Windows machine with no dedicated
/// card, `Backend::Cpu`): when detection learned nothing (`Unknown`) a lone
/// visible device may be an iGPU beside a sleeping dedicated card, and the
/// start stays on the CPU build. `discrete_name` is asked only for a dedicated
/// card.
fn device_route(
    will_run_on: kalsa_probe::Backend,
    listed: Option<&[(String, String)]>,
    discrete_name: impl FnOnce() -> Option<String>,
) -> (ServerBackend, Option<String>) {
    match will_run_on {
        kalsa_probe::Backend::DiscreteGpu { .. } => match discrete_name() {
            Some(name) => kalsa_runtime::route(listed, Some(&name)),
            None => (ServerBackend::Cpu, None),
        },
        kalsa_probe::Backend::Cpu => kalsa_runtime::route(listed, None),
        _ => (ServerBackend::Cpu, None),
    }
}

/// Why the walk starts the processor build after the graphics build's
/// catalog answer refused: the card's memory holds no row this app ships —
/// the owner's ruling after the Lenovo walk (RTX 4050 6 GiB, 32 GiB RAM,
/// E4B ran on the processor at ~11.8 tok/s that night). The sentence says
/// which memory sized the model, never which build runs it: the tune may
/// still pick the graphics build.
pub(crate) const PROCESSOR_FALLBACK_REASON: &str =
    "No model fits this computer's graphics card's memory alone, so this model is sized for this computer's memory.";

/// The graphics build's catalog answer, with the processor fallback the
/// owner ruled in. `decide_processor` is lazy — an answer that fits the card
/// never pays for it — and only the builds whose budget IS the card's memory
/// (Vulkan) fall back: a processor refusal is a real refusal, and
/// Metal budgets RAM already. And only over-budget refusals fall back at
/// all: the fallback's sentence is about the card's memory holding no
/// runnable answer — the automatic one, or the owner's chosen row — which
/// is true of exactly those. A phone comparison or a speed floor are other
/// facts and reach the owner unchanged (the processor would be slower
/// still); MachineNotMeasured, Unresolved and the rest travel as they are.
pub(crate) fn choose_with_processor_fallback(
    build: (ServerBackend, PathBuf),
    machine: &Machine,
    phone: Option<PhoneModel>,
    chosen: Option<&str>,
    decide_processor: impl FnOnce() -> Result<kalsa_runtime::Decision, kalsa_runtime::DecideError>,
) -> Result<
    (
        ServerBackend,
        PathBuf,
        DownloadPlan,
        &'static ModelEntry,
        String,
    ),
    StartupFailure,
> {
    let (winner, exe) = build;
    let budgets_the_card = matches!(winner, ServerBackend::Vulkan);
    match choose_model(winner, machine, phone, chosen) {
        Ok((plan, row, reason)) => Ok((winner, exe, plan, row, reason)),
        // Only a refusal that says "this budget could not hold a model"
        // buys the fallback — `NothingFits` for the automatic answer,
        // `ChosenModelUnfundable` for a chosen row. NothingFastEnough (the
        // floors, which the processor would only fail harder) is another
        // fact, other words; NothingBetter cannot arrive — the phone
        // comparison's refusal is taken by the machine-only fallback above.
        Err(graphics_refusal)
            if budgets_the_card
                && matches!(
                    graphics_refusal,
                    StartupFailure::NothingFits | StartupFailure::ChosenModelUnfundable
                ) =>
        {
            // The ruling: a GPU build that probes well but whose card holds
            // no row is not a reason to refuse the machine (Lenovo walk:
            // 6.4 GB of VRAM minus the margin leaves ~3.0 GiB — under the
            // smallest row — while 32 GiB of RAM funds one). The processor
            // answer carries the sentence that says which memory decided.
            let decision = match decide_processor() {
                Ok(decision) => decision,
                // A wire that refused the processor route — its probe
                // model or every fetch — outranks the card refusal: the
                // processor route is how this machine would run at all,
                // and the sentence that names the network is the one the
                // owner can act on.
                Err(error @ kalsa_runtime::DecideError::EngineUnreachable { .. }) => {
                    return Err(error.into());
                }
                // The processor route failing otherwise must not wear
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

/// Whether the row the walk is about to place IS the owner's stored choice:
/// the only consent a fetch has. The automatic answer behind a stale token —
/// or a row this machine cannot run now — consents to nothing, so it is used
/// only when it is already on disk.
pub(crate) fn consented(stored: Option<&str>, row: &ModelEntry) -> bool {
    stored.is_some_and(|token| model_token(row) == token)
}

/// The stored choice this walk cannot honour, forgotten — so the home page
/// offers the pick again rather than a choice the walk refuses. Nothing to
/// forget is nothing to do; a failed save leaves the stale token, and the
/// walk stops on it again at the next turn-on.
fn forget_choice(state_file: &Path) {
    let mut overrides = crate::options::load(state_file);
    if overrides.model.is_none() {
        return;
    }
    overrides.model = None;
    let _ = crate::options::save(state_file, overrides);
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
        ServerBackend::Vulkan => match detected {
            // No card of its own: the integrated GPU decodes out of shared
            // system RAM, so the budget stays the CPU path — the same
            // arithmetic, and the same pick from the chooser, this machine
            // had when only the CPU build was offered.
            kalsa_probe::Backend::Cpu => kalsa_probe::Backend::Cpu,
            // A GPU build decodes in the card's memory: the budget is the VRAM
            // detection read, when it could read one honestly.
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

/// Whether the row's file already answers on this disk, by the same two
/// no-download checks [`acquire_model`] makes: a digest-verified copy in
/// this app's models directory, or a reusable one in another program's
/// store. It hashes a present file whole, so it belongs on a blocking
/// thread, never in a read the window makes often.
pub(crate) fn model_on_disk(root: &Path, entry: &ModelEntry) -> bool {
    let Some(source) = entry_source(entry) else {
        return false;
    };
    let url = source.url();
    let name = match url.rsplit('/').next() {
        Some(name) if !name.is_empty() => name,
        _ => return false,
    };
    if file_digest_is(&root.join("models").join(name), source.bytes, source.sha256) {
        return true;
    }
    find_reusable(&default_roots(), source.bytes, source.sha256).is_some()
}

/// The entry as the catalog's own pairing holds it: the row, or the Q8
/// variant nested under it. A served variant is an entry in its own right,
/// so the search walks rows and their variants — the table's own structure,
/// not a copy of the rule that decides which one a machine serves. `None`
/// — the row is not on the menu — means there is no file to look for.
fn entry_on_menu(entry: &ModelEntry) -> Option<kalsa_catalog::UsableEntry<'static>> {
    let is_the_entry = |candidate: &ModelEntry| {
        candidate.repo == entry.repo
            && candidate.display_name == entry.display_name
            && candidate.quant == entry.quant
            && candidate.weights_bytes == entry.weights_bytes
    };
    usable_with_q8().find_map(|(row, variant)| {
        if is_the_entry(row.entry()) {
            return Some(row);
        }
        variant.filter(|variant| is_the_entry(variant.entry()))
    })
}

/// The row's own source, from the catalog's pairing: the pinned address the
/// download is held to.
fn entry_source(entry: &ModelEntry) -> Option<&'static kalsa_catalog::GgufSource> {
    Some(entry_on_menu(entry)?.source())
}

/// What downloading this entry costs, as one number: its own pinned file
/// plus the drafter its row ships beside it — the same two files one
/// progress bar carries. The bool says whether there is a second file, for
/// the copy that says "file" or "files".
pub(crate) fn entry_download(entry: &ModelEntry) -> Option<(u64, bool)> {
    let found = entry_on_menu(entry)?;
    let drafter = found.drafter().map_or(0, |drafter| drafter.bytes);
    Some((found.source().bytes + drafter, drafter > 0))
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
    row: &'static ModelEntry,
    machine: &Machine,
    state_file: PathBuf,
) -> Result<PreparedStart, StartupFailure> {
    planned_config_with_overrides(
        backend,
        exe,
        None,
        model,
        None,
        None,
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
    (1..=requested.max(1))
        .rev()
        .find(|slots| funds(*slots))
        .unwrap_or(1)
}

fn planned_config_with_overrides(
    backend: ServerBackend,
    exe: PathBuf,
    // The card the device step pinned this launch to (None everywhere no
    // card was named): the plan carries it so every rebuild from these
    // args — the tune's rule, its clones, the retry — keeps the pin.
    device: Option<String>,
    model: PathBuf,
    drafter: Option<DrafterLaunch>,
    mmproj: Option<MmprojLaunch>,
    row: &'static ModelEntry,
    reason: String,
    model_sha256: &str,
    machine: &Machine,
    devices: u32,
    state_file: PathBuf,
    slot_save_path: PathBuf,
    overrides: LaunchOverrides,
) -> Result<PreparedStart, StartupFailure> {
    let automatic = ServerSettings::defaults(kalsa_launch::DEFAULT_IDLE_UNLOAD_SECONDS);
    // The raw owner choice, not yet floored: whether a projector RIDES is
    // not settled here (the drop rule below can still take it away), and
    // `kalsa_launch::plan` floors where it learns the projector — from the
    // charged `mmproj_bytes`, the same `proven` fact this function later
    // writes into `plan.args.mmproj`.
    let batch_size = overrides.batch_size.unwrap_or(automatic.batch_size);
    let ubatch_size = overrides.ubatch_size.unwrap_or(automatic.ubatch_size);
    let kv_cache = overrides.kv_cache.unwrap_or_default();
    let budget = memory_budget(
        budget_backend(backend, machine.measurement.will_run_on),
        machine.ram_bytes,
    );
    // The projector is charged only while it is being passed: `mmproj_bytes`
    // is the proven file's cost, zero the moment the drop rule below takes
    // the file out of the launch.
    let mut mmproj = mmproj;
    let mmproj_bytes = |m: Option<&MmprojLaunch>| {
        m.as_ref()
            .and_then(|m| m.proven.as_ref().map(|_| m.bytes))
            .unwrap_or(0)
    };
    let build = |cache: KvCache, context_limit: Option<u64>, parallel: u32, charged: u64| {
        LaunchInput {
            backend,
            model: row,
            budget,
            drafter_bytes: drafter.as_ref().map_or(0, |drafter| drafter.bytes),
            mmproj_bytes: charged,
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
        }
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
        kalsa_launch::plan(&build(
            kv_cache,
            overrides.context_tokens,
            slots,
            mmproj_bytes(mmproj.as_ref()),
        ))
        .is_some()
    });
    // The engine's path is known here, before any `LaunchInput` exists: the
    // walk decides the build first and hands its exe in. Probe it now, so the
    // number the plan divides by is the number the door will serve.
    let parallel = planned_parallel(&exe, affordable);
    if affordable < requested_parallel {
        log::warn!(
            "{requested_parallel} devices are enrolled on this computer, but the \
             plan funds only {affordable} of them at once; the plan is for {affordable} devices, \
             and the door will refuse the rest with a sentence saying the seats are full and \
             naming no device. Change the context in Advanced, or forget a device on the \
             Devices page."
        );
    }
    if parallel < affordable {
        log::warn!(
            "the engine at {} carries no x-kalsa-slot inlet; the plan is \
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
    // The drafter's rule, applied to the projector: a proven file whose
    // bytes would sink the launch is dropped, never the row — a start that
    // cannot fund the projector runs without it (the chat sees an offer
    // again), and one whose row cannot be funded at all is refused as it
    // always was. Settled BEFORE the maxima, so every panel figure below is
    // the arithmetic of the launch that actually runs.
    if mmproj_bytes(mmproj.as_ref()) > 0
        && kalsa_launch::plan(&build(
            kv_cache,
            overrides.context_tokens,
            parallel,
            mmproj_bytes(mmproj.as_ref()),
        ))
        .is_none()
    {
        if kalsa_launch::plan(&build(kv_cache, overrides.context_tokens, parallel, 0)).is_some() {
            if let Some(pin) = mmproj.as_mut() {
                pin.proven = None;
            }
            log::info!("the projector does not fit the plan beside the row; starting without it");
        } else {
            return Err(StartupFailure::ChosenModelUnfundable);
        }
    }
    // The funded maximum for each cache type: f16 costs twice per token and
    // therefore funds a smaller context. Either may be absent — the row can
    // be unfundable under one cache and fine under the other — so this is not
    // an error until the cache actually being launched has no maximum. The
    // maximum is NOT the automatic context any more: `plan` with no owner
    // choice answers the smaller chat default where the machine funds it, so
    // the guards and the panel read the ceiling from `funded_maximum`.
    let maxima = ContextMaxima {
        q8_0: kalsa_launch::funded_maximum(&build(
            KvCache::Q8_0,
            None,
            parallel,
            mmproj_bytes(mmproj.as_ref()),
        )),
        f16: kalsa_launch::funded_maximum(&build(
            KvCache::F16,
            None,
            parallel,
            mmproj_bytes(mmproj.as_ref()),
        )),
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
    let mut plan = kalsa_launch::plan(&build(
        kv_cache,
        overrides.context_tokens,
        parallel,
        mmproj_bytes(mmproj.as_ref()),
    ))
    .ok_or(StartupFailure::ChosenModelUnfundable)?;
    if let Some(seconds) = overrides.idle_unload_seconds {
        plan.args.idle_unload_seconds = seconds;
    }
    // The drafter rides the launch only as a proven file: acquire_model
    // verified it before this ran, and the engine cannot load half a pair.
    // n_max is the pre-tune default; the tune's first run measures 2/3/4
    // against off and keeps the fastest.
    plan.args.draft = drafter.as_ref().map(|drafter| kalsa_launch::Draft {
        model_path: drafter.path.clone(),
        n_max: kalsa_launch::DEFAULT_DRAFT_N_MAX,
    });
    plan.args.device = device;
    // The projector rides the launch only as a proven file, the drafter's
    // rule: acquire's check answered for these bytes before this ran.
    plan.args.mmproj = mmproj.as_ref().and_then(|pin| pin.proven.clone());
    let args = plan.args;
    // What the panel shows beside the context control: the context the
    // launcher picks with no owner choice, and the launcher's own two KV
    // terms for pricing any length the owner types. All of it is the
    // launcher's arithmetic, computed here where the row is known.
    let automatic_context = ContextMaxima {
        q8_0: kalsa_launch::plan(&build(
            KvCache::Q8_0,
            None,
            parallel,
            mmproj_bytes(mmproj.as_ref()),
        ))
        .map(|plan| plan.args.context_tokens),
        f16: kalsa_launch::plan(&build(
            KvCache::F16,
            None,
            parallel,
            mmproj_bytes(mmproj.as_ref()),
        ))
        .map(|plan| plan.args.context_tokens),
    };
    let context_prices = ContextPrices {
        // From the PLANNED args, not the raw owner choice: with a projector
        // the plan floored the micro-batch, and the panel's price must be
        // built from the same number the argv renders.
        q8_0: kalsa_launch::context_price(row, KvCache::Q8_0, u64::from(args.ubatch_size), parallel),
        f16: kalsa_launch::context_price(row, KvCache::F16, u64::from(args.ubatch_size), parallel),
    };
    let server = ServerConfig {
        exe,
        argv: args.argv(),
        state_file,
        port: PORT,
        ready_timeout: READY_TIMEOUT,
        stop_grace: STOP_GRACE.max(DEFAULT_STOP_GRACE / 2),
    };
    let drafter_sha256 = drafter.as_ref().map(|drafter| drafter.sha256.to_string());
    let drafter_bytes = drafter.as_ref().map_or(0, |drafter| drafter.bytes);
    Ok(PreparedStart {
        server,
        rule_launch: None,
        processor: None,
        info: LaunchInfo {
            args,
            maximum_context: maxima,
            automatic_context,
            context_prices,
            display_name: Some(row.display_name.to_owned()),
            reason: Some(reason),
            model_sha256: Some(model_sha256.to_string()),
            drafter_sha256,
            mmproj,
            sizing: Some(LaunchSizing {
                backend,
                budget,
                row,
                drafter_bytes,
            }),
            tune: None,
            checked: None,
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
    if overrides
        .context_tokens
        .is_some_and(|context| context > maximum)
    {
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
        device: None,
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
        // The dev path has no catalog row — the developer pinned the file —
        // so it renders no sampling flags and the engine keeps its own
        // defaults.
        sampling: kalsa_catalog::Sampling::default(),
        // And no drafter and no projector: the developer pinned one file
        // and owns its bytes.
        draft: None,
        mmproj: None,
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
        rule_launch: None,
        processor: None,
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
            drafter_sha256: None,
            display_name: None,
            reason: None,
            // A pinned file no catalog row named: there is no pinned digest
            // to carry, and none is computed from the file.
            model_sha256: None,
            mmproj: None,
            sizing: None,
            tune: None,
            checked: None,
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

/// Size first, then the record, then the digest: the cheap checks decide
/// whether the expensive one is worth running.
pub(crate) fn file_digest_is(path: &Path, size: u64, sha: &str) -> bool {
    file_digest_checked(path, size, sha).unwrap_or(false)
}

/// The same check with its answer's honesty: `Err` when the file was never
/// read whole — absent, not the promised size, or the disk said no — which
/// is not an answer. `Ok(true)` is the pinned file, proven by reading it
/// whole once (the record beside it then answers for the launches after,
/// on its stamp and its sample) or by that record; `Ok(false)` is read
/// whole and not it, the one answer a caller may treat as final.
pub(crate) fn file_digest_checked(path: &Path, size: u64, sha: &str) -> std::io::Result<bool> {
    let started = std::time::Instant::now();
    let mut file = std::fs::File::open(path)?;
    let meta = file.metadata()?;
    if meta.len() != size {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "the file is not the size the pin promises",
        ));
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "the file".to_string());
    // A file that was read whole once and has not moved since — same size,
    // same time, same file id, and its sample reads back to the digest the
    // record holds — is answered from that record: the read that ended in a
    // match is the expensive part, and repeating it every launch is the
    // minute of silence this record exists to end.
    let stamp = crate::verified::Stamp::of(&meta);
    if stamp
        .as_ref()
        .is_some_and(|stamp| crate::verified::unchanged(path, sha, stamp))
    {
        log::info!(
            "model check: {name}: sample matched, sha256 skipped ({size} bytes, {:.2}s)",
            started.elapsed().as_secs_f64()
        );
        return Ok(true);
    }
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => hasher.update(&buf[..n]),
            Err(error) => return Err(error),
        }
    }
    let digest = format!("{:x}", hasher.finalize());
    let matched = digest.eq_ignore_ascii_case(sha);
    log::info!(
        "model check: {name}: sha256 {} ({size} bytes, {:.1}s)",
        if matched { "verified" } else { "mismatch" },
        started.elapsed().as_secs_f64()
    );
    if matched {
        // Only a match is worth writing down, and only for a stamp that held
        // still through the whole read: the record must describe the bytes
        // that are at the path now. A mismatch is read again next launch in
        // any case, because the bytes may be replaced in between.
        let after = file
            .metadata()
            .ok()
            .and_then(|meta| crate::verified::Stamp::of(&meta));
        if let Some(stamp) = crate::verified::recordable(stamp, after) {
            crate::verified::record(path, sha, &stamp);
        }
    }
    Ok(matched)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kalsa_probe::{Backend, ExecutionPath, Reliability, Series};
    use std::io::Write;

    /// The single-device rule is the integrated GPU's alone: a lone listed
    /// device is pinned only when detection knows no dedicated card exists.
    /// With detection blind (`Unknown`) or a dedicated card it cannot name,
    /// that device may be the iGPU beside a sleeping dedicated one — CPU.
    #[test]
    fn only_a_known_integrated_gpu_gets_the_single_device_rule() {
        let lone = vec![("Vulkan0".to_string(), "Intel(R) Iris(R) Plus Graphics".to_string())];
        let pinned = (ServerBackend::Vulkan, Some("Vulkan0".to_string()));
        let cpu = (ServerBackend::Cpu, None);
        let none = || -> Option<String> { None };
        assert_eq!(device_route(Backend::Cpu, Some(&lone), none), pinned);
        assert_eq!(device_route(Backend::Unknown, Some(&lone), none), cpu);
        assert_eq!(device_route(Backend::Metal, Some(&lone), none), cpu);
        // A dedicated card is matched by its name, and without one there is
        // nothing to match.
        let dedicated = Backend::DiscreteGpu { vram_bytes: Some(6 << 30) };
        let card = vec![("Vulkan0".to_string(), "NVIDIA GeForce RTX 4050 Laptop GPU".to_string())];
        let named = || Some("NVIDIA GeForce RTX 4050 Laptop GPU".to_string());
        assert_eq!(device_route(dedicated, Some(&card), named), pinned);
        assert_eq!(device_route(dedicated, Some(&lone), named), cpu);
        assert_eq!(device_route(dedicated, Some(&card), none), cpu);
        // Nothing listed is nothing to pin, whatever detection says.
        assert_eq!(device_route(Backend::Cpu, None, none), cpu);
    }

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

    /// The fixture machine where two rows run on 16 GiB: at the plain
    /// fixture's 80 GB/s the small-dense line leaves only the LFM file
    /// runnable, and a stored choice needs a row to differ from.
    fn two_row_machine() -> Machine {
        let mut measurement = measured(80.0e9, Backend::Cpu);
        measurement.decode_bytes_per_second = Some(150.0e9);
        Machine {
            measurement,
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

    /// One modification time on an existing file, where the file handle is
    /// opened for writing because the platform's own setter wants that much
    /// permission.
    fn set_mtime(path: &Path, at: std::time::SystemTime) {
        std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .expect("open")
            .set_modified(at)
            .expect("set the time");
    }

    /// The check reads a file whole once and writes the record beside it;
    /// the launch after that answers from the record — the stamp and the
    /// sample — without reading the file, the minute of silence a 22 GB
    /// model used to cost every start. The other half is the security
    /// property: a change on disk (a byte inside the sample with the time
    /// even put back, a byte under a new time, a size that moved, a pin the
    /// record does not name) is read again and answered on its bytes.
    #[test]
    fn a_proven_file_is_answered_by_its_record_until_something_moves() {
        let dir = scratch("digest-record");
        let path = dir.join("model.gguf");
        let pinned = b"the pinned bytes";
        std::fs::write(&path, pinned).expect("write");
        let sha = digest_of(pinned);
        let size = pinned.len() as u64;
        assert!(file_digest_checked(&path, size, &sha).expect("the first read"));
        // Same size, another byte under it, the time put back: the record's
        // sample is read, disagrees, and the bytes are read whole and
        // refused — the stamp alone is not the answer.
        let at = std::fs::metadata(&path)
            .expect("stat")
            .modified()
            .expect("mtime");
        std::fs::write(&path, b"XXXXXXXXXXXXXXXX").expect("write");
        set_mtime(&path, at);
        assert!(
            !file_digest_checked(&path, size, &sha).expect("the sample's answer"),
            "a changed sample re-reads and refuses"
        );
        // The time moved: still read again, and still not the pinned bytes.
        set_mtime(&path, at + std::time::Duration::from_secs(1));
        assert!(
            !file_digest_checked(&path, size, &sha).expect("the second read"),
            "a moved time re-reads"
        );
        // The pinned bytes back, and a pin the record does not name: the
        // match re-records, the other pin reads again and disagrees.
        std::fs::write(&path, pinned).expect("write");
        assert!(file_digest_checked(&path, size, &sha).expect("the third read"));
        let other = digest_of(b"another model entirely");
        assert!(
            !file_digest_checked(&path, size, &other).expect("the fourth read"),
            "a moved pin re-reads"
        );
        // A size that is not the pin's is refused before any read at all.
        assert!(file_digest_checked(&path, size + 1, &sha).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn with_nothing_stored_the_automatic_decision_is_the_same_decision() {
        // The automatic answer for a walk that fetches it: the development
        // path's pinned binary, and the answer a walk with nothing stored
        // still owes. What
        // this answers must still be exactly what the catalog answers,
        // plan and reason and all, compared against the catalog itself
        // rather than against a copied expectation.
        let machine = machine(Backend::Cpu);
        let input = choice_input(ServerBackend::Cpu, &machine, None);
        let automatic = kalsa_catalog::largest_that_runs_well(&input).expect("something runs");
        let (plan, row, reason) = choose_model(ServerBackend::Cpu, &machine, None, None)
            .expect("an undecided walk still chooses automatically");

        assert_eq!(row.repo, automatic.entry.repo);
        assert_eq!(row.quant, automatic.entry.quant);
        assert_eq!(row.weights_bytes, automatic.entry.weights_bytes);
        assert_eq!(
            plan.url, automatic.download.url,
            "the same file, byte for byte"
        );
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
            choose_model(ServerBackend::Cpu, &machine, None, None).expect("the automatic answer");
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
            None,
            PathBuf::from("/models/chosen.gguf"),
            None,
            None,
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
        let file_digest = digest_of(b"other bytes entirely: what a re-hash would produce");
        assert_ne!(
            &config.info.model_sha256.as_deref().expect("carried")[..8],
            &file_digest[..8],
            "the weights were re-hashed instead of the row's pin"
        );
    }

    /// The pin the device step chose reaches the launch itself: the plan
    /// carries it into the args and argv it builds, so the server starts on
    /// the one card — and every later rebuild of these args (the tune's
    /// rule, its clones, the retry) inherits the same pin.
    #[test]
    fn the_pinned_device_reaches_the_final_launch() {
        let machine = machine(Backend::DiscreteGpu {
            vram_bytes: Some(8 << 30),
        });
        let (plan, row, reason) = choose_model(ServerBackend::Vulkan, &machine, None, None)
            .expect("the automatic answer");
        let config = planned_config_with_overrides(
            ServerBackend::Vulkan,
            PathBuf::from("/server/kalsa-server"),
            Some("Vulkan0".to_string()),
            PathBuf::from("/models/chosen.gguf"),
            None,
            None,
            row,
            reason,
            plan.sha256,
            &machine,
            1,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides::default(),
        )
        .expect("a card-sized row is fundable on this test machine");
        assert_eq!(config.info.args.device.as_deref(), Some("Vulkan0"));
        assert!(
            config
                .server
                .argv
                .windows(2)
                .any(|pair| pair[0] == "--device" && pair[1] == "Vulkan0"),
            "the launch must name the card: {:?}",
            config.server.argv
        );
    }

    /// The owner's Lenovo as measurement.json records it: 33 945 935 872 B of
    /// RAM, the 6 439 305 216-byte card, and 62 460 761 598 B/s timed on the
    /// CPU with no chip figure beside it — the machine whose first-run screen
    /// offers Gemma 4 E4B.
    fn lenovo() -> Machine {
        Machine {
            measurement: measured(
                62_460_761_598.0,
                Backend::DiscreteGpu {
                    vram_bytes: Some(6_439_305_216),
                },
            ),
            ram_bytes: 33_945_935_872,
        }
    }

    #[test]
    fn the_pick_the_preview_offers_funds_on_the_card_the_start_sizes_it_against() {
        // One machine, two answers, one arithmetic: the page reads
        // `capability::dto` and the walk runs `choose_model` and then the
        // launch plan. Vulkan's budget IS the card detection read
        // (`budget_backend`), so both size the row against the same
        // 5 365 563 392 B — and the Lab measured that card holding E4B plus
        // its 98 653 280-byte drafter at 3 828 MiB.
        let machine = lenovo();

        // The preview, read as the page reads it — the JSON, not the struct's
        // private fields.
        let preview = crate::capability::dto(
            &machine.measurement,
            machine.ram_bytes,
            None,
            false,
            &scratch("lenovo-preview"),
        );
        let json = serde_json::to_value(&preview).expect("serialise");
        assert_eq!(json["model"]["name"], "Google Gemma 4 E4B", "{json}");
        // The preview's "up to N" is the card's funded maximum for the row;
        // the launch takes the chat default out of it.
        let promised = json["model"]["context_tokens"]
            .as_u64()
            .expect("the preview must promise a window the start then funds");
        assert_eq!(promised, 131_072, "the card's funded maximum for the row");

        // The start path: the token the page sends back, the row it names,
        // and the plan that builds the server beside the proven drafter.
        let row = rows()
            .find(|entry| entry.display_name == "Google Gemma 4 E4B" && entry.quant == "Q4_K_M")
            .expect("the test row left the catalog");
        let token = model_token(row);
        let (plan, chosen, reason) =
            choose_model(ServerBackend::Vulkan, &machine, None, Some(&token))
                .expect("the preview's pick is runnable on the card");
        assert_eq!(chosen.repo, row.repo, "the token names the row on the page");
        let config = planned_config_with_overrides(
            ServerBackend::Vulkan,
            PathBuf::from("/server/kalsa-server"),
            None,
            PathBuf::from("/models/chosen.gguf"),
            Some(DrafterLaunch {
                path: PathBuf::from("/models/drafter.gguf"),
                sha256: TEST_SHA256,
                bytes: 98_653_280,
            }),
            None,
            chosen,
            reason,
            plan.sha256,
            &machine,
            1,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides::default(),
        )
        .expect("the pick the preview offers funds on the card it was sized against");
        assert_eq!(
            config.info.args.context_tokens, CHOOSER_CONTEXT_TOKENS,
            "the chooser's own window, funded"
        );
        assert!(
            promised >= u64::from(config.info.args.context_tokens),
            "the preview's maximum must cover the window the launch funds: {promised} vs {}",
            config.info.args.context_tokens
        );
    }

    #[test]
    fn a_stored_choice_on_a_slow_seven_gb_machine_fails_for_speed_not_for_memory() {
        // The band where the walk's two predicates used to disagree: the
        // budget sits between what LFM's Q8 file costs at its 32 768-token
        // cap and what a flat 65 536-token window would cost. The row fits
        // the window it is priced at, and at this bandwidth its pessimistic
        // end is below reading speed — the floors' verdict. Pricing the
        // flat window answered "over budget" for a machine that funds the
        // row and only refuses its speed.
        let machine = Machine {
            measurement: measured(5.0e9, Backend::Cpu),
            ram_bytes: 7_000_000_000,
        };
        let row = rows()
            .find(|entry| entry.repo == "LiquidAI/LFM2.5-VL-3B" && entry.quant == "Q8_0")
            .expect("the Q8 row is in the catalog");
        let budget = memory_budget(Backend::Cpu, machine.ram_bytes);
        assert!(
            kalsa_catalog::footprint_bytes(row, row.priced_context(CHOOSER_CONTEXT_TOKENS))
                .total_bytes()
                <= budget.usable_bytes,
            "the premise: the row fits the window it is priced at"
        );
        assert!(
            kalsa_catalog::footprint_bytes(row, CHOOSER_CONTEXT_TOKENS).total_bytes()
                > budget.usable_bytes,
            "the premise: the flat window is what this budget cannot hold"
        );
        let token = model_token(row);
        let failure = match choose_model(ServerBackend::Cpu, &machine, None, Some(&token)) {
            Err(failure) => failure,
            Ok((_, row, _)) => panic!("{} must not run at 5 GB/s", row.repo),
        };
        assert!(
            matches!(failure, StartupFailure::NothingFastEnough),
            "{failure:?}"
        );
    }

    #[test]
    fn a_choice_the_catalog_does_not_know_stops_the_walk() {
        // A token from a build whose catalog has moved on: the walk stops
        // with AwaitingChoice. It never picks a model itself — no plan, so
        // no URL, is built for one.
        let machine = machine(Backend::Cpu);
        let failure = choose_model(ServerBackend::Cpu, &machine, None, Some("not-a-token"))
            .expect_err("a stale choice must not choose something else");
        assert!(
            matches!(failure, StartupFailure::AwaitingChoice),
            "{failure:?}"
        );
    }

    #[test]
    fn a_stale_choice_clears_itself_and_places_nothing() {
        // The walk's model step against a stored choice nothing answers to:
        // the walk stops, forgets the choice so Home offers the pick again,
        // and never reaches a file. No plan is built, so no catalog URL can
        // be touched whatever the gate does.
        let root = scratch("stale-walk");
        let state_file = root.join("server.state");
        let stale = LaunchOverrides {
            model: Some("not-a-token".to_string()),
            ..LaunchOverrides::default()
        };
        crate::options::save(&state_file, stale).expect("store the stale choice");

        let failure = run(
            // A development build pins the binary, so no engine is decided
            // or fetched on the way to the model step.
            Some(PathBuf::from("/dev/null/stand-in-server")),
            machine(Backend::Cpu),
            None,
            1,
            None,
            state_file.clone(),
            root.join("slots"),
            &root,
            &mut |_| {},
        )
        .expect_err("a choice this walk cannot honour must not start");
        assert!(
            matches!(failure, StartupFailure::AwaitingChoice),
            "{failure:?}"
        );
        assert!(
            crate::options::load(&state_file).model.is_none(),
            "the stale choice is forgotten, so Home offers the pick again"
        );
        assert!(
            !root.join("models").exists(),
            "nothing was placed: the walk never reached the file"
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_choice_with_no_file_left_to_fetch_stops_the_walk() {
        // The other way a stored choice goes stale: the catalog still knows
        // the row, and there is nothing left to fetch for it — the research
        // rows carry no file. The walk stops; it does not pick something
        // the owner did not choose.
        let machine = machine(Backend::Cpu);
        let without_file = rows()
            .find(|entry| {
                !kalsa_catalog::usable().any(|candidate| {
                    candidate.entry().repo == entry.repo && candidate.entry().quant == entry.quant
                })
            })
            .expect("the catalog carries rows with no file");
        assert!(
            row_for_token(&model_token(without_file)).is_some(),
            "the token resolves: this is not the unknown-token case"
        );

        let failure = choose_model(
            ServerBackend::Cpu,
            &machine,
            None,
            Some(&model_token(without_file)),
        )
        .expect_err("a row with nothing to fetch stops the walk");
        assert!(
            matches!(failure, StartupFailure::AwaitingChoice),
            "{failure:?}"
        );
    }

    /// The owner's ruling: a card whose budget, after the margin, holds no
    /// row this app ships, while the RAM funds several. The fixture's 2 GiB
    /// card budgets 1.0 GiB and every row is charged more on the card; the
    /// processor build picks — and the reason says which memory decided.
    #[test]
    fn the_graphics_refusal_falls_back_to_the_processor_and_says_why() {
        let machine = Machine {
            measurement: measured(
                80.9e9,
                Backend::DiscreteGpu {
                    vram_bytes: Some(2 * 1024 * 1024 * 1024),
                },
            ),
            ram_bytes: 32 * 1024 * 1024 * 1024,
        };
        // The refusal that started this: budgeted on the card, nothing fits.
        assert!(
            choose_model(ServerBackend::Vulkan, &machine, None, None).is_err(),
            "2.0 GB of VRAM minus the margin must hold no row"
        );

        // The walk's fallback asks the processor route for its own answer,
        // prefixed by the sentence that says which memory sized the model.
        let expected = choose_model(ServerBackend::Cpu, &machine, None, None)
            .expect("the processor budget is 32 GiB of RAM");
        let (build, exe, plan, row, reason) = choose_with_processor_fallback(
            (
                ServerBackend::Vulkan,
                PathBuf::from("/builds/vulkan-server.exe"),
            ),
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
        assert_eq!(
            row.repo, expected.1.repo,
            "the processor build's own choice"
        );
        assert_eq!(plan.sha256, expected.0.sha256, "its own pinned file");
        assert!(
            !PROCESSOR_FALLBACK_REASON.contains("processor"),
            "the sentence must not claim where the model runs — the tune may \
             still pick the graphics build: {PROCESSOR_FALLBACK_REASON}"
        );
        assert!(
            reason.contains(PROCESSOR_FALLBACK_REASON),
            "the reason must say which memory sized the model: {reason}"
        );
        assert!(
            reason.contains(&expected.2),
            "the choice's own words follow: {reason}"
        );
    }

    #[test]
    fn a_nothing_better_phone_refusal_starts_the_machine_only_pick() {
        // The owner's ruling: the phone decides whether this computer is an
        // upgrade, never whether the brain can run. Rows that FIT the card
        // next to a phone no shipped row beats used to refuse with the
        // phone comparison's NothingBetter; the walk now answers it by
        // starting the machine-only pick, silently.
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
        let (plan, row, reason) =
            choose_model(ServerBackend::Vulkan, &machine, Some(phone), None)
                .expect("the machine-only pick starts");
        let machine_only =
            choose_model(ServerBackend::Vulkan, &machine, None, None).expect("the plain answer");
        assert_eq!(
            plan.sha256, machine_only.0.sha256,
            "the same file the phone-free question picks"
        );
        assert_eq!(row.repo, machine_only.1.repo, "the same row");
        assert_eq!(
            reason, FALLBACK_PICK_REASON,
            "said as the fallback pick, never as a phone comparison: {reason}"
        );

        // The processor fallback's guard is untouched: the card's budget
        // answer is what that fallback exists for, and the machine-only
        // pick above never reaches it.
        let calls = std::cell::Cell::new(0);
        let started = choose_with_processor_fallback(
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
        .expect("the machine-only pick starts through the fallback path too");
        assert_eq!(started.3.repo, row.repo, "the same row survives both roads");
        assert_eq!(
            calls.get(),
            0,
            "the card's budget held the row, so the processor decide never runs"
        );
    }

    #[test]
    fn the_processor_fallback_belongs_to_a_card_budget_only() {
        // The guard's other half: the fallback exists because the CARD's
        // budget refused every row while the machine's RAM holds one. A
        // CPU winner that finds nothing is the machine itself — the decide
        // must not run and the refusal stands in its own words.
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 2 * 1024 * 1024 * 1024,
        };
        assert!(
            matches!(
                choose_model(ServerBackend::Cpu, &machine, None, None),
                Err(StartupFailure::NothingFits)
            ),
            "the fixture must be a machine no row fits"
        );
        let calls = std::cell::Cell::new(0);
        let err = choose_with_processor_fallback(
            (ServerBackend::Cpu, PathBuf::from("/builds/cpu-server.exe")),
            &machine,
            None,
            None,
            || {
                calls.set(calls.get() + 1);
                Ok(kalsa_runtime::Decision {
                    backend: ServerBackend::Cpu,
                    exe: PathBuf::from("/builds/cpu-server.exe"),
                })
            },
        )
        .expect_err("nothing fits, and a CPU winner has no card to fall back from");
        assert!(matches!(err, StartupFailure::NothingFits), "{err:?}");
        assert_eq!(
            calls.get(),
            0,
            "a CPU winner must never reach the processor decide"
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
                    vram_bytes: Some(2 * 1024 * 1024 * 1024),
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
    fn a_wire_blocked_processor_route_says_so_not_nothing_fits() {
        // The card route had no row, and the processor route died on the
        // wire before any answer: the network is the reason nothing starts,
        // and its sentence wins over a budget refusal the owner cannot act
        // on from this machine.
        let machine = Machine {
            measurement: measured(
                80.9e9,
                Backend::DiscreteGpu {
                    vram_bytes: Some(2 * 1024 * 1024 * 1024),
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
                Err(kalsa_runtime::DecideError::EngineUnreachable {
                    probe_model_reason: None,
                    attempts: vec![],
                })
            },
        )
        .expect_err("the wire refused every fetch");
        assert_eq!(calls.get(), 1, "the fixture reaches the decide");
        assert!(
            matches!(err, StartupFailure::EngineUnreachable),
            "the network's own sentence: {err:?}"
        );
    }

    #[test]
    fn a_stored_choice_gets_the_processor_fallback_too() {
        // The card's budget holds no row at all, and the owner's pick runs
        // on the processor budget: the fallback the automatic answer gets
        // must serve a chosen row the same way, prefix and all. Refusing it
        // as if nobody had chosen anything is the bug this pins.
        let machine = Machine {
            measurement: measured(
                80.9e9,
                Backend::DiscreteGpu {
                    vram_bytes: Some(2 * 1024 * 1024 * 1024),
                },
            ),
            ram_bytes: 32 * 1024 * 1024 * 1024,
        };
        let cpu_input = choice_input(ServerBackend::Cpu, &machine, None);
        let chosen = rows()
            .find(|entry| kalsa_catalog::runnable_row(&cpu_input, entry).is_some())
            .expect("a 32 GiB machine runs some row on the processor budget");
        let card_input = choice_input(ServerBackend::Vulkan, &machine, None);
        assert!(
            !fits(
                chosen,
                card_input.context_tokens,
                &memory_budget(card_input.backend, card_input.ram_bytes),
            ),
            "the fixture's card budget must refuse the chosen row"
        );
        let calls = std::cell::Cell::new(0);
        let (backend, _exe, _plan, row, reason) = choose_with_processor_fallback(
            (
                ServerBackend::Vulkan,
                PathBuf::from("/builds/vulkan-server.exe"),
            ),
            &machine,
            None,
            Some(&model_token(chosen)),
            || {
                calls.set(calls.get() + 1);
                Ok(kalsa_runtime::Decision {
                    backend: ServerBackend::Cpu,
                    exe: PathBuf::from("/builds/cpu-server.exe"),
                })
            },
        )
        .expect("the chosen row runs on the processor budget");
        assert_eq!(calls.get(), 1, "the card refusal reached the decide");
        assert_eq!(backend, ServerBackend::Cpu, "the processor build won");
        assert_eq!(row.display_name, chosen.display_name, "the chosen row ran");
        let prefixed = format!("{PROCESSOR_FALLBACK_REASON} {CHOSEN_REASON}");
        assert_eq!(
            reason, prefixed,
            "the reason says who chose and what sized it"
        );
    }

    #[test]
    fn a_chosen_row_that_fits_neither_budget_stops_in_its_own_words() {
        // Over the card's budget and over the processor budget too: the
        // walk stops, but in the chosen model's words — the variant the
        // fold keeps — never `AwaitingChoice`, which would forget the
        // choice and claim nothing was ever picked.
        let machine = Machine {
            measurement: measured(
                80.9e9,
                Backend::DiscreteGpu {
                    vram_bytes: Some(5 * 1024 * 1024 * 1024),
                },
            ),
            ram_bytes: 4 * 1024 * 1024 * 1024,
        };
        let cpu_input = choice_input(ServerBackend::Cpu, &machine, None);
        let chosen = usable().next().expect("the menu has rows").entry();
        assert!(
            row_for_token(&model_token(chosen)).is_some(),
            "a menu row resolves"
        );
        assert!(
            rows().all(|entry| !fits(
                entry,
                cpu_input.context_tokens,
                &memory_budget(cpu_input.backend, cpu_input.ram_bytes),
            )),
            "the fixture's processor budget must hold no row"
        );
        let calls = std::cell::Cell::new(0);
        let err = choose_with_processor_fallback(
            (
                ServerBackend::Vulkan,
                PathBuf::from("/builds/vulkan-server.exe"),
            ),
            &machine,
            None,
            Some(&model_token(chosen)),
            || {
                calls.set(calls.get() + 1);
                Ok(kalsa_runtime::Decision {
                    backend: ServerBackend::Cpu,
                    exe: PathBuf::from("/builds/cpu-server.exe"),
                })
            },
        )
        .expect_err("no budget here can run the chosen row");
        assert_eq!(calls.get(), 1, "the card arm tried the processor budget");
        assert!(
            matches!(err, StartupFailure::ChosenModelUnfundable),
            "the chosen row's own refusal: {err:?}"
        );
    }

    #[test]
    fn a_token_nothing_answers_to_is_still_awaiting_choice() {
        // A token the catalog no longer knows is no choice at all: the walk
        // stops with the set-up sentence and the fold forgets it, so Home
        // offers the pick again.
        let machine = two_row_machine();
        assert!(matches!(
            choose_model(ServerBackend::Cpu, &machine, None, Some("no such token")),
            Err(StartupFailure::AwaitingChoice)
        ));
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
        // for: the chooser's own footprint at its own pricing window, with
        // the pick's drafter charged when this machine runs one beside it —
        // the row's file alone would prove less than the launch reserves.
        let budget = memory_budget(Backend::Cpu, machine.ram_bytes);
        let footprint = kalsa_catalog::candidate_footprint(
            entry_on_menu(row).expect("the pick is on the menu"),
            &choice_input(ServerBackend::Cpu, &machine, None),
        );
        assert!(
            footprint.total_bytes() <= budget.usable_bytes,
            "the pick fits the budget it was sized against"
        );
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
        // reasons this walk cannot tell apart, so the sentence is the one
        // plain retry.
        assert_eq!(spoken, "Kalsa couldn't start. Try again.");
        assert_eq!(
            err.code_and_params().0,
            "startup.could_not_start",
            "the unwritable slot path rides under the plain retry code"
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
        // The sentence hides the probe's words and says what the owner can do.
        assert_eq!(
            crate::failure::words(&err),
            "Kalsa couldn't check this computer. Wait a moment and try again."
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
        let row = rows()
            .find(|entry| entry.display_name == "Liquid LFM 2.5")
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
            budget_backend(ServerBackend::Vulkan, detected),
            detected,
            "a GPU build decodes in the card"
        );
        // The integrated GPU's case: the graphics build won on a machine
        // with no card of its own — decode runs out of shared system RAM,
        // so the budget is the CPU path and the chooser's pick is what this
        // machine had when only the CPU build was offered.
        assert_eq!(
            budget_backend(ServerBackend::Vulkan, Backend::Cpu),
            Backend::Cpu,
            "an iGPU decodes from system RAM"
        );
        let row = rows()
            .find(|entry| entry.display_name == "Google Gemma 4 26B")
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
    fn a_row_that_cannot_fund_the_sixty_four_k_window_is_not_offered() {
        // The chooser prices this row at the window it serves it at — the
        // dense 12B trains past 65_536, so the chooser's window is its
        // price — and a row the machine cannot fund at that window is not
        // offered at all, however well it funds a smaller one: the pick
        // comes from rows that hold the window they will be served at. At
        // 11 GiB the dense 12B funds 8192 tokens and not 65_536, and the
        // tier goes to the row that funds the window — never to the
        // smallest row on the menu just because it fits. The bandwidth is
        // the fixture's raised to 150 GB/s so the row that does fund the
        // window also clears its speed line: the window is the only thing
        // deciding here.
        let mut measurement = measured(80.0e9, Backend::Cpu);
        measurement.decode_bytes_per_second = Some(150.0e9);
        let machine = Machine {
            measurement,
            ram_bytes: 11 * 1024 * 1024 * 1024,
        };
        let budget = memory_budget(Backend::Cpu, machine.ram_bytes);
        let twelve = rows()
            .find(|entry| entry.repo == "google/gemma-4-12B-it")
            .expect("the row is in the catalog");
        assert!(
            kalsa_catalog::footprint_bytes(twelve, 8_192).total_bytes() <= budget.usable_bytes
                && kalsa_catalog::footprint_bytes(twelve, CHOOSER_CONTEXT_TOKENS).total_bytes()
                    > budget.usable_bytes,
            "the premise: this machine funds the 12B at a smaller window, \
             not at the chooser's"
        );
        let (plan, row, reason) =
            choose_model(ServerBackend::Cpu, &machine, None, None).expect("the tier is not empty");
        assert_ne!(
            row.repo, "google/gemma-4-12B-it",
            "a row that cannot fund the window is not offered"
        );
        assert_eq!(row.repo, "google/gemma-4-E4B-it");
        assert_eq!(
            reason, PHONE_FREE_REASON,
            "no phone, so the phone-free words"
        );
        // The plan and the row travel together by construction — the model
        // step answers with the file its own row pins — so the plan still
        // names a real, pinned file.
        assert!(plan.bytes > 0 && !plan.url.is_empty(), "{:?}", plan.url);
    }

    #[test]
    fn the_server_starts_with_the_launch_plan_not_the_supervisor_constants() {
        // The product path: the context comes from the chosen row's cache
        // geometry against the real budget. Liquid LFM 2.5 on 8 GiB funds
        // its trained 32_768 at q8_0 — the same figure the row's header
        // caps the launch's 65_536 chat default at — with the plan's own
        // cache roof of 466 MiB. The flags are still the launch
        // decision's — q8_0 cache under flash attention, no GPU flags on a
        // CPU build.
        let row = rows()
            .find(|entry| entry.display_name == "Liquid LFM 2.5")
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
            "32768",
            "{joined}"
        );
        assert_eq!(
            rendered_value(&config.server.argv, "--cache-ram"),
            "466",
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
            drafter_bytes: 0,
            mmproj_bytes: 0,
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
                None,
                PathBuf::from("/models/chosen.gguf"),
                None,
                None,
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

        let fork = engine_dir(
            "seats-inlet",
            Some(b"a module carrying x-kalsa-slot inside"),
        );
        let three = run_three(fork.clone()).expect("three seats of the big row are fundable");
        assert_eq!(three.info.args.parallel, 3, "three devices, three seats");
        assert!(
            three.server.argv.join(" ").contains("--parallel 3"),
            "the engine must run the seats the door serves: {}",
            three.server.argv.join(" ")
        );

        let blind = engine_dir(
            "seats-no-inlet",
            Some(b"a module that never heard of the door"),
        );
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
    /// number and says so: Liquid LFM 2.5 (the Q8_0 file) on 6.7 GB of RAM
    /// funds one 5742-token slot, and two slots would each get about 2871 —
    /// under the 4096-token floor.
    /// The plan stays at one seat; the door then refuses the second device
    /// with words.
    #[test]
    fn a_machine_that_cannot_fund_the_family_keeps_the_smaller_number() {
        let row = rows()
            .find(|entry| entry.display_name == "Liquid LFM 2.5")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 6_700_000_000,
        };
        let fork = engine_dir(
            "seats-unfunded",
            Some(b"a module carrying x-kalsa-slot inside"),
        );
        let config = planned_config_with_overrides(
            ServerBackend::Cpu,
            fork.clone(),
            None,
            PathBuf::from("/models/chosen.gguf"),
            None,
            None,
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
        assert!(matches!(err, StartupFailure::ContextTooLarge { .. }));
        assert_eq!(
            crate::failure::words(&err),
            "This conversation length is too long for this AI. Choose a smaller one in \
             Advanced."
        );
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
        let row = rows()
            .find(|entry| entry.display_name == "Liquid LFM 2.5")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 8 * 1024 * 1024 * 1024,
        };
        let err = planned_config_with_overrides(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            None,
            PathBuf::from("/models/chosen.gguf"),
            None,
            None,
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
                context_tokens: Some(262_144),
                idle_unload_seconds: Some(600),
                internet_road: false,
                ..LaunchOverrides::default()
            },
        )
        .expect_err("262144 exceeds the row's funded maximum on 8 GiB");
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
                None,
                PathBuf::from("/models/chosen.gguf"),
                None,
                None,
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
        // Above the machine's maximum: refused. The approved sentence names
        // the fix, not the figure.
        let err = run(Some(262_145)).expect_err("one token above the maximum is refused");
        assert!(
            matches!(err, StartupFailure::ContextTooLarge { .. }),
            "{err:?}"
        );
        assert_eq!(
            crate::failure::words(&err),
            "This conversation length is too long for this AI. Choose a smaller one in \
             Advanced."
        );
    }

    #[test]
    fn a_context_only_q8_0_funds_is_refused_when_f16_is_chosen() {
        // Liquid LFM 2.5 (the Q8_0 file, 2.87 GB) on 6.95 GB of CPU funds
        // 27_284 tokens at q8_0 and 13_642 at f16: the halved per-token
        // price is what moves the f16 maximum (both below the row's
        // 32_768 trained cap, which would otherwise level them). 20_000
        // fits the q8_0 cache and not the f16 one — choosing f16 must
        // refuse it, not start a server whose f16 cache would
        // oversubscribe the machine. If the guard read the q8_0 maximum
        // instead of the chosen cache's, this would be accepted.
        let row = rows()
            .find(|entry| entry.display_name == "Liquid LFM 2.5")
            .expect("the test row left the catalog");
        let machine = Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 6_950_000_000,
        };
        let err = planned_config_with_overrides(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            None,
            PathBuf::from("/models/chosen.gguf"),
            None,
            None,
            row,
            TEST_REASON.to_string(),
            TEST_SHA256,
            &machine,
            // One seat: f16's funded maximum is a per-slot figure here.
            1,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides {
                context_tokens: Some(20_000),
                idle_unload_seconds: Some(600),
                kv_cache: Some(KvCache::F16),
                ..LaunchOverrides::default()
            },
        )
        .expect_err("20000 is beyond the f16 funded maximum of 13642");
        assert!(
            matches!(err, StartupFailure::ContextTooLarge { .. }),
            "{err:?}"
        );
        // The approved sentence tells the owner what to do and leaves the
        // figures out; the enum arm still carries the funded maximum and
        // the cache it was funded for, pinned here.
        // The other half of the premise: the same window fits q8_0.
        let fits_q8 = planned_config_with_overrides(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            None,
            PathBuf::from("/models/chosen.gguf"),
            None,
            None,
            row,
            TEST_REASON.to_string(),
            TEST_SHA256,
            &machine,
            1,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides::default(),
        )
        .expect("20000 fits the q8_0 cache");
        // The override is a ceiling, not a target: below the funded maximum
        // the plan starts the window the machine funds.
        assert_eq!(fits_q8.info.args.context_tokens, 27_284);
        assert_eq!(
            crate::failure::words(&err),
            "This conversation length is too long for this AI. Choose a smaller one in \
             Advanced."
        );
        match err {
            StartupFailure::ContextTooLarge { maximum_tokens, cache } => {
                assert_eq!(maximum_tokens, 13_642, "the funded maximum travels");
                assert!(matches!(cache, Some(KvCache::F16)), "{cache:?}");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_model_the_machine_cannot_fund_stops_the_walk_honestly() {
        let row = rows()
            .find(|entry| entry.display_name == "Google Gemma 4 E4B")
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
            .find(|entry| entry.display_name == "Liquid LFM 2.5")
            .expect("the test row left the catalog");
        row.trained_context_tokens = Some(0);
        // The record keeps its row for the whole launch, so the mutated
        // copy is leaked here — a test-only immortal, never the catalog's.
        let row: &'static ModelEntry = Box::leak(Box::new(row));
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
            "Kalsa couldn't start with this AI. Pick another one on the AI page.",
            "{err:?}"
        );
    }

    #[test]
    fn a_metal_machine_gets_the_full_offload_the_budget_accounted_for() {
        let row = rows()
            .find(|entry| entry.display_name == "Liquid LFM 2.5")
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
            .find(|entry| entry.display_name == "Liquid LFM 2.5")
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
            Some("Liquid LFM 2.5"),
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

    #[test]
    fn a_served_q8_entry_is_found_by_the_catalogs_own_pairing() {
        // The variant is an entry in its own right, nested under its row:
        // the on-disk lookup must find its pinned source through the same
        // pairing — or a served Q8 pick would read "not on disk" forever and
        // re-download on every start. The row's own entry still answers too.
        let row = kalsa_catalog::DOWNLOADABLE
            .iter()
            .find(|row| row.model.repo == "google/gemma-4-12B-it")
            .expect("the row that carries a variant");
        let variant = row.q8.as_ref().expect("the variant");
        let served = entry_source(&variant.model).expect("the variant's source is found");
        assert!(
            served.url().ends_with("/gemma-4-12B-it-Q8_0.gguf"),
            "{}",
            served.url()
        );
        assert_eq!(served.bytes, 12_669_647_328);
        let base = entry_source(&row.model).expect("the row's own source is found");
        assert!(base.url().ends_with("/gemma-4-12B-it-Q4_K_M.gguf"));
    }

    #[test]
    fn the_first_run_prices_a_drafter_row_as_weights_plus_drafter() {
        // What Start's one download number is made of: the E4B row's own
        // file plus the MTP drafter its row pins, and the bool the copy
        // says "files" with — while a row that ships no drafter prices its
        // file alone.
        let e4b = rows()
            .find(|entry| entry.repo == "google/gemma-4-E4B-it")
            .expect("the row is in the catalog");
        assert_eq!(
            entry_download(e4b),
            Some((4_977_171_584 + 98_653_280, true))
        );
        let lfm = rows()
            .find(|entry| entry.repo == "LiquidAI/LFM2.5-VL-3B" && entry.quant == "Q8_0")
            .expect("the row is in the catalog");
        assert_eq!(entry_download(lfm), Some((2_874_779_680, false)));
    }

    /// The machine this window pair is planned on: 9.5 GB is where this row
    /// still fits WITH its drafter and already buys its window token by
    /// token, so the drafter's bytes are what moves both figures.
    fn e4b_machine() -> Machine {
        Machine {
            measurement: measured(80.0e9, Backend::Cpu),
            ram_bytes: 9_500_000_000,
        }
    }

    /// The E4B row planned on `e4b_machine`, with the proven drafter given
    /// or withheld — the one builder both window tests read.
    fn planned_e4b(drafter: Option<crate::startup::DrafterLaunch>) -> PreparedStart {
        let machine = e4b_machine();
        let row = rows()
            .find(|entry| entry.repo == "google/gemma-4-E4B-it")
            .expect("the row is in the catalog");
        planned_config_with_overrides(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            None,
            PathBuf::from("/models/chosen.gguf"),
            drafter,
            None,
            row,
            TEST_REASON.to_string(),
            TEST_SHA256,
            &machine,
            1,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides::default(),
        )
        .expect("the row funds the fixture machine")
    }

    #[test]
    fn a_proven_drafter_rides_the_launch_args_and_plans_the_smaller_window() {
        // The wiring, not the renderer: a drafter proven on disk reaches the
        // launch args as the one draft fact — and its bytes are what the
        // window and the chat roof were sized around, so the drafted plan
        // funds fewer of both than the same row runs without one.
        let without = planned_e4b(None);
        assert!(
            without.info.args.draft.is_none(),
            "no proven drafter, no draft flags"
        );
        let with = planned_e4b(Some(crate::startup::DrafterLaunch {
            path: PathBuf::from("/models/mtp-chosen.gguf"),
            sha256: TEST_SHA256,
            bytes: 98_653_280,
        }));
        assert_eq!(
            with.info.args.draft,
            Some(kalsa_launch::Draft {
                model_path: PathBuf::from("/models/mtp-chosen.gguf"),
                n_max: kalsa_launch::DEFAULT_DRAFT_N_MAX,
            })
        );
        assert!(
            with.info.args.context_tokens < without.info.args.context_tokens,
            "the drafted window is the smaller one: {} vs {}",
            with.info.args.context_tokens,
            without.info.args.context_tokens
        );
        assert!(
            with.info.args.cache_ram_mib < without.info.args.cache_ram_mib,
            "and so is its chat roof: {} vs {} MiB",
            with.info.args.cache_ram_mib,
            without.info.args.cache_ram_mib
        );
        assert_eq!(with.server.argv.len(), without.server.argv.len() + 12);
    }

    /// The projector ride's three consumers — the args, the argv and the
    /// panel's price — must read ONE micro-batch. The plan floors it for a
    /// projector (`kalsa_launch::VISION_UBATCH`, 1024); this pins that the
    /// price built here uses the PLANNED args, not the raw owner choice. On
    /// the E4B's sliding window the fixed term depends on the micro-batch,
    /// so pricing at the raw 512 is a different, detectable number.
    #[test]
    fn a_vision_launch_prices_and_renders_the_same_micro_batch() {
        let row = rows()
            .find(|entry| entry.repo == "google/gemma-4-E4B-it")
            .expect("the row is in the catalog");
        let machine = machine(Backend::Cpu);
        let config = planned_config_with_overrides(
            ServerBackend::Cpu,
            PathBuf::from("/server/llama-server"),
            None,
            PathBuf::from("/models/chosen.gguf"),
            None,
            Some(MmprojLaunch {
                url: "https://example.invalid/mmproj.gguf".to_string(),
                sha256: TEST_SHA256,
                bytes: 559_874_816,
                proven: Some(PathBuf::from("/models/mmproj-gemma-4-E4B-it-Q8_0.gguf")),
            }),
            row,
            TEST_REASON.to_string(),
            TEST_SHA256,
            &machine,
            1,
            PathBuf::from("/state/server.state"),
            PathBuf::from("/slots"),
            LaunchOverrides::default(),
        )
        .expect("the row funds its projector on the fixture machine");
        let joined = config.server.argv.join(" ");
        assert_eq!(
            rendered_value(&config.server.argv, "--ubatch-size"),
            "1024",
            "{joined}"
        );
        assert!(joined.contains("--mmproj"), "{joined}");
        assert_eq!(config.info.args.ubatch_size, 1024);
        // The price built here uses the PLANNED micro-batch: on this
        // sliding-window row the fixed term depends on it, so pricing at
        // the raw 512 would be a different number.
        let price = config.info.context_prices.q8_0.expect("the q8_0 price");
        let planned = kalsa_launch::context_price(
            row,
            KvCache::Q8_0,
            u64::from(config.info.args.ubatch_size),
            config.info.args.parallel,
        )
        .expect("the row has a price");
        assert_eq!(price, planned, "the price uses the planned micro-batch");
        let raw = kalsa_launch::context_price(row, KvCache::Q8_0, 512, config.info.args.parallel)
            .expect("the row has a price");
        assert_ne!(price, raw, "the price is not built from the raw 512");
    }
}
