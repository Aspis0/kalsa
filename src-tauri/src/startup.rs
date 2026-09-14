//! "Turn on": the walk from nothing to a supervised server.
//!
//! The order is the product: decide the backend (a standing verdict means
//! nothing is downloaded), put the chosen model on disk, start the server
//! and keep it up. It runs entirely off the main thread and reports its
//! progress as data; two presses cannot run two walks, which is the command
//! guard's job, not this file's.
//!
//! One stop is deliberate: the catalog's selection names a repo and a size
//! but no digest and no exact file, and `kalsa-download` will not move bytes
//! it cannot verify. Deriving a plausible URL is how a download 404s a week
//! later (the catalog's own manifest says so), so until rows carry digests
//! the walk stops there and says so — see `StartupFailure::WeightsUnverified`.

use std::path::PathBuf;
use std::time::Duration;

use kalsa_catalog::{ChoiceInput, Decision, PhoneModel};
use kalsa_probe::Backend;
use kalsa_supervisor::{
    conservative_threads, ServerConfig, DEFAULT_BATCH, DEFAULT_CTX, DEFAULT_IDLE_SECONDS,
    DEFAULT_STOP_GRACE, DEFAULT_UBATCH,
};
use serde::Serialize;

use crate::failure::StartupFailure;

/// Loopback port. The phone reaches it through a tunnel, never over the LAN.
pub(crate) const PORT: u16 = 8130;
/// Loading a model from a slow disk on an old machine is not fast.
const READY_TIMEOUT: Duration = Duration::from_secs(600);
/// Long enough for a clean unload, short enough that closing the window is not
/// a hang: the supervisor escalates to SIGKILL after the second one.
const STOP_GRACE: Duration = Duration::from_secs(2);

/// What the walk needs to know about this machine, gathered once before it
/// starts: the detection the backend decision is narrowed by, and the
/// measurement the catalog predicts from.
pub(crate) struct Machine {
    pub detected: Backend,
    pub ram_bytes: u64,
    pub bandwidth_bytes_per_second: f64,
    pub compute_flops_per_second: f64,
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
}

/// The whole walk. `server_override` (development) replaces the decide step:
/// the developer pins a binary and owns its bytes. Everything else is the
/// product order.
pub(crate) fn run(
    server_override: Option<PathBuf>,
    machine: Machine,
    phone: Option<PhoneModel>,
    model_override: Option<PathBuf>,
    state_file: PathBuf,
    progress: &mut dyn FnMut(Progress),
) -> Result<ServerConfig, StartupFailure> {
    let exe = match server_override {
        Some(exe) => exe,
        None => {
            progress(Progress::Deciding);
            kalsa_runtime::decide(machine.detected, &mut |p| {
                progress(Progress::RuntimeBytes {
                    done: p.bytes_done,
                    total: p.bytes_total,
                })
            })?
            .exe
        }
    };
    place_model(exe, machine, phone, model_override, state_file, progress)
}

/// Everything after the server build exists: choose the model, place it,
/// shape the server's configuration. Split from [`run`] so it can be tested
/// without `decide` touching the network.
fn place_model(
    exe: PathBuf,
    machine: Machine,
    phone: Option<PhoneModel>,
    model_override: Option<PathBuf>,
    state_file: PathBuf,
    progress: &mut dyn FnMut(Progress),
) -> Result<ServerConfig, StartupFailure> {
    let model = match model_override {
        // Development: the developer pinned the file and owns its bytes, so
        // the choice is skipped entirely — an unpaired machine must still be
        // able to run a dev build.
        Some(path) => path,
        None => {
            progress(Progress::Choosing);
            let input = ChoiceInput {
                backend: machine.detected,
                ram_bytes: machine.ram_bytes,
                bandwidth_bytes_per_second: machine.bandwidth_bytes_per_second,
                compute_flops_per_second: machine.compute_flops_per_second,
                context_tokens: u64::from(DEFAULT_CTX),
                phone,
            };
            // Pure: nothing here touches the network.
            let selection = match kalsa_catalog::choose(&input) {
                Decision::Pick(selection) => selection,
                Decision::Refuse(refusal) => return Err(refusal.into()),
            };
            // The truthful stop, until rows carry digests. See the module
            // header for why no URL is derived here.
            let _ = selection;
            return Err(StartupFailure::WeightsUnverified);
        }
    };
    Ok(server_config(exe, model, state_file))
}

/// The server's configuration: loopback only, conservative thread and batch
/// counts, the chosen model, the state file the supervisor identifies itself
/// by.
fn server_config(exe: PathBuf, model: PathBuf, state_file: PathBuf) -> ServerConfig {
    ServerConfig {
        exe,
        model,
        state_file,
        port: PORT,
        threads: conservative_threads(
            std::thread::available_parallelism()
                .map(|n| n.get())
                .unwrap_or(4),
        ),
        batch: DEFAULT_BATCH,
        ubatch: DEFAULT_UBATCH,
        ctx: DEFAULT_CTX,
        idle_seconds: DEFAULT_IDLE_SECONDS,
        ready_timeout: READY_TIMEOUT,
        stop_grace: STOP_GRACE.max(DEFAULT_STOP_GRACE / 2),
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

#[cfg(test)]
mod tests {
    use super::*;

    /// The numbers the catalog's own command-line fixture uses: on a 16 GiB
    /// CPU machine they produce a real Pick, not a refusal.
    fn paired_machine() -> Machine {
        Machine {
            detected: Backend::Cpu,
            ram_bytes: 16 * 1024 * 1024 * 1024,
            bandwidth_bytes_per_second: 80.0e9,
            compute_flops_per_second: 100.0e9,
        }
    }

    fn phone() -> Option<PhoneModel> {
        // A small, battery-powered phone: the catalog's relief path fires,
        // so the walk produces a real Pick against the real catalog rows.
        Some(PhoneModel {
            weights_bytes: 500_000_000,
            parameters: None,
            measured_tokens_per_second: None,
            battery_powered: Some(true),
        })
    }

    fn place(
        machine: Machine,
        phone: Option<PhoneModel>,
        model_override: Option<PathBuf>,
    ) -> Result<ServerConfig, StartupFailure> {
        place_model(
            PathBuf::from("/server/llama-server"),
            machine,
            phone,
            model_override,
            PathBuf::from("/state/server.state"),
            &mut |_| {},
        )
    }

    #[test]
    fn a_paired_machine_that_cannot_verify_its_model_stops_before_anything_starts() {
        // The catalog genuinely picks here, and the walk still stops: bytes
        // that cannot be proven are not downloaded, and no server is shaped
        // around a file that does not exist.
        let outcome = place(paired_machine(), phone(), None);
        assert!(
            matches!(outcome, Err(StartupFailure::WeightsUnverified)),
            "{outcome:?}"
        );
    }

    #[test]
    fn an_unpaired_machine_is_asked_to_pair_before_anything_else() {
        let outcome = place(paired_machine(), None, None);
        assert!(
            matches!(outcome, Err(StartupFailure::PairPhoneFirst)),
            "{outcome:?}"
        );
    }

    #[test]
    fn the_development_model_override_skips_the_choice_and_shapes_the_server() {
        // Numbers that would refuse (nothing measured, nobody paired) are
        // irrelevant when the developer has pinned the file: the dev flow
        // must survive a machine that has never been paired.
        let config = place(
            Machine {
                detected: Backend::Cpu,
                ram_bytes: 0,
                bandwidth_bytes_per_second: 0.0,
                compute_flops_per_second: 0.0,
            },
            None,
            Some(PathBuf::from("/dev/model.gguf")),
        )
        .expect("the override is the answer");
        assert_eq!(config.model, PathBuf::from("/dev/model.gguf"));
        assert_eq!(config.exe, PathBuf::from("/server/llama-server"));
        assert_eq!(config.port, PORT);
        assert_eq!(config.ctx, DEFAULT_CTX);
        // Loopback only, in the server's own arguments as well as intent.
        let joined = config.arguments().join(" ");
        assert!(joined.contains("--host 127.0.0.1"));
        assert!(joined.contains("--model /dev/model.gguf"));
    }

    #[test]
    fn ram_bytes_reports_something_on_this_machine() {
        assert!(ram_bytes() > 0, "the platform refused to say its RAM");
    }
}
