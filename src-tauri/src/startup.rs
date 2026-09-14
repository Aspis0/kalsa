//! "Turn on": the walk from nothing to a supervised server.
//!
//! The order is the product: decide the backend (a standing verdict means
//! nothing is downloaded), put the chosen model on disk, start the server
//! and keep it up. It runs entirely off the main thread and reports its
//! progress as data; two presses cannot run two walks, which is the command
//! guard's job, not this file's.
//!
//! The model step follows the catalog: a row with a download plan is fetched
//! against its digest (a verified copy in another program's cache beats the
//! download), and a row without a plan stops the walk honestly — bytes that
//! cannot be proven are not downloaded, and no plausible URL is derived to
//! paper over it.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use kalsa_catalog::{ChoiceInput, Decision, DownloadPlan, PhoneModel, Selection};
use kalsa_download::{default_roots, download, find_local};
use kalsa_probe::Measurement;
use kalsa_supervisor::{
    conservative_threads, ServerConfig, DEFAULT_BATCH, DEFAULT_CTX, DEFAULT_IDLE_SECONDS,
    DEFAULT_STOP_GRACE, DEFAULT_UBATCH,
};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::failure::StartupFailure;

/// Loopback port. The phone reaches it through a tunnel, never over the LAN.
pub(crate) const PORT: u16 = 8130;
/// Loading a model from a slow disk on an old machine is not fast.
const READY_TIMEOUT: Duration = Duration::from_secs(600);
/// Long enough for a clean unload, short enough that closing the window is not
/// a hang: the supervisor escalates to SIGKILL after the second one.
const STOP_GRACE: Duration = Duration::from_secs(2);

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
    root: &Path,
    progress: &mut dyn FnMut(Progress),
) -> Result<ServerConfig, StartupFailure> {
    let exe = match server_override {
        Some(exe) => exe,
        None => {
            progress(Progress::Deciding);
            kalsa_runtime::decide(machine.measurement.will_run_on, &mut |p| {
                progress(Progress::RuntimeBytes {
                    done: p.bytes_done,
                    total: p.bytes_total,
                })
            })?
            .exe
        }
    };
    let model = match model_override {
        // Development: the developer pinned the file and owns its bytes, so
        // the choice is skipped entirely — an unpaired machine must still be
        // able to run a dev build.
        Some(path) => path,
        None => {
            progress(Progress::Choosing);
            let selection = choose_model(&machine, phone)?;
            place_model(selection.download.as_ref(), root, progress)?
        }
    };
    Ok(server_config(exe, model, state_file))
}

/// The catalog's answer for this machine. Pure: nothing here touches the
/// network or the disk.
fn choose_model(machine: &Machine, phone: Option<PhoneModel>) -> Result<Selection, StartupFailure> {
    match kalsa_catalog::choose(&choice_input(machine, phone)) {
        Decision::Pick(selection) => Ok(selection),
        Decision::Refuse(refusal) => Err(refusal.into()),
    }
}

/// The catalog's input, gathered from the measurement as it stands — every
/// fact travels, none is re-derived or dropped.
fn choice_input(machine: &Machine, phone: Option<PhoneModel>) -> ChoiceInput {
    ChoiceInput {
        backend: machine.measurement.will_run_on,
        ram_bytes: machine.ram_bytes,
        bandwidth_bytes_per_second: machine.measurement.ceiling_bytes_per_second,
        compute_flops_per_second: machine.measurement.compute.max(),
        // The measurement's own word on itself: a CPU-path bandwidth under a
        // GPU decode is a floor, which may keep a candidate but must never
        // refuse one. Hardcoding this false re-creates the bug that refused
        // a runnable model with a precise and wrong number.
        bandwidth_is_lower_bound: machine.measurement.bandwidth_is_lower_bound(),
        context_tokens: u64::from(DEFAULT_CTX),
        phone,
    }
}

/// Puts the chosen model on disk. A row with a plan is fetched against its
/// digest; a row without one stops the walk honestly.
fn place_model(
    plan: Option<&DownloadPlan>,
    root: &Path,
    progress: &mut dyn FnMut(Progress),
) -> Result<PathBuf, StartupFailure> {
    match plan {
        Some(plan) => acquire_model(plan, &root.join("models"), progress),
        None => Err(StartupFailure::WeightsUnverified),
    }
}

/// Puts the chosen model on disk, against the plan's digest. A copy already
/// on disk — ours, or another program's — is hash-checked or digest-found
/// before any download happens.
fn acquire_model(
    plan: &DownloadPlan,
    models_dir: &Path,
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
    // any download, and it is only ever read.
    if let Some(found) = find_local(&default_roots(), plan.bytes, plan.sha256) {
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

    fn digest_of(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
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

    #[test]
    fn the_lower_bound_truth_rides_with_the_measurement() {
        // The exact fact that was once dropped: a CPU-path measurement under
        // a GPU decode is a floor, and the decision must know it from the
        // measurement, not from a constant.
        let cpu = choice_input(&machine(Backend::Cpu), None);
        assert!(!cpu.bandwidth_is_lower_bound);
        assert_eq!(cpu.bandwidth_bytes_per_second, 80.0e9);
        let metal = choice_input(&machine(Backend::Metal), None);
        assert!(metal.bandwidth_is_lower_bound);
        assert_eq!(metal.bandwidth_bytes_per_second, 80.0e9);
    }

    #[test]
    fn an_unpaired_machine_is_asked_to_pair_before_anything_else() {
        let err = choose_model(&machine(Backend::Cpu), None)
            .expect_err("nothing can be compared to a phone that never said");
        assert!(matches!(err, StartupFailure::PairPhoneFirst), "{err:?}");
    }

    #[test]
    fn a_row_without_a_plan_stops_the_walk_honestly() {
        let root = scratch("no-plan");
        let err = place_model(None, &root, &mut |_| {})
            .expect_err("bytes that cannot be proven are not downloaded");
        assert!(matches!(err, StartupFailure::WeightsUnverified), "{err:?}");
        assert_eq!(
            std::fs::read_dir(&root).expect("root").count(),
            0,
            "the stop must not touch the disk"
        );
        let _ = std::fs::remove_dir_all(&root);
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
        let path = place_model(Some(&plan), &root, &mut |_| {}).expect("downloaded");
        assert_eq!(
            std::fs::read(&path).expect("read"),
            PLAN_BODY,
            "what landed is what the digest promised"
        );
        assert_eq!(digest_of(PLAN_BODY), PLAN_SHA256);
        // A second pass with the file already on disk downloads nothing: the
        // on-disk bytes are re-hashed, and the server must not be asked again.
        let path_again = place_model(Some(&plan), &root, &mut |_| {}).expect("from disk");
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
            place_model(Some(&plan), &root, &mut |_| {}).expect_err("the digest is the promise");
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
            Some(PathBuf::from("/dev/model.gguf")),
            PathBuf::from("/state/server.state"),
            &root,
            &mut |_| {},
        )
        .expect("the override is the answer");
        assert_eq!(config.model, PathBuf::from("/dev/model.gguf"));
        assert_eq!(config.exe, PathBuf::from("/server/llama-server"));
        assert_eq!(config.port, PORT);
        let joined = config.arguments().join(" ");
        assert!(joined.contains("--host 127.0.0.1"));
        assert!(joined.contains("--model /dev/model.gguf"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn ram_bytes_reports_something_on_this_machine() {
        assert!(ram_bytes() > 0, "the platform refused to say its RAM");
    }
}
