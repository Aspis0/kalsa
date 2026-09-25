//! The app's whole walk against the real world, for one owner-chosen row.
//!
//! The fixture tests prove the walk's pieces, and the `#[ignore]`d tests in
//! `kalsa-download` and `kalsa-launch` fetch real bytes and start real
//! engines — but each of those pins a hand-copied tuple or hand-built argv,
//! so none of them proves the APP's walk: that a repo an owner can name is
//! found in the catalog, stored the way the Model page stores it, honoured
//! by `startup::run` over a real measurement and a real engine decision,
//! and answered by a server that speaks chat. This test walks that order,
//! end to end, for the one row `KALSA_BRAIN_REAL_WALK` names (by the repo
//! the row's file is pinned to).
//!
//! A run downloads only when no verified copy of the row's file is found:
//! the walk's own digest check, or another program's cache the reuse pass
//! trusts, answers first, and the "placed by" line says which happened —
//! and, for another cache, the directory it came from. What a download
//! writes is kept: that file is the product's now. Only the temp state and
//! slot dirs are swept. Reading the real runtime root — its engine build,
//! its caches — is the point of the walk, not a side effect to apologise
//! for.
//!
//! What it proves is the planner for exactly the inputs it gives itself —
//! one device, no phone, a temporary options file — not the owner's
//! configured app.
//!
//! ```text
//! KALSA_BRAIN_REAL_WALK=<repo> cargo test -p kalsa-brain real_walk -- --ignored --nocapture
//! ```

mod http;

use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::Value;

use kalsa_probe::ProbeConfig;
use kalsa_supervisor::{ServerState, StartOutcome, Supervisor};

use crate::capability::CHOSEN_REASON;
use crate::tune_step::{tune_label, tune_line, Tune};
use crate::startup::{self, Machine, Progress, PROCESSOR_FALLBACK_REASON};
use self::http::chat_completion;

/// The env var that names the row to walk, by the repo its file is pinned to.
const ENV_VAR: &str = "KALSA_BRAIN_REAL_WALK";
/// The one conversation the running server is asked for, and the room it
/// gets to finish it.
const PROMPT: &str = "Say OK";
/// Why one word gets this much room: a thinking model (the 26B row is one)
/// spends its first tokens in `reasoning_content` and answers only after, so
/// a 16-token cap made the first 26B run spend every token reasoning and
/// come back `content: ""` with `finish_reason: "length"` — a test defect,
/// not an app one. Still a cap rather than none: the walk must end if a
/// model rambles.
const MAX_TOKENS: u32 = 1024;
/// Progress lines print at this granularity, not per callback: a silent
/// four-minute download reads as a broken test, a line per chunk is a log.
const MARK_BYTES: u64 = 512 * 1024 * 1024;
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

#[test]
#[ignore = "moves gigabytes over the network and starts the real engine; set KALSA_BRAIN_REAL_WALK=<repo>"]
fn the_app_walks_a_chosen_catalog_row_for_real() {
    // This body only runs under --ignored, so reaching it at all was a
    // deliberate ask; an unset var is a mistake, not a skip.
    let repo = std::env::var(ENV_VAR).unwrap_or_else(|error| {
        panic!(
            "set {ENV_VAR}=<repo> to walk one catalog row for real, e.g. \
             {ENV_VAR}=unsloth/gemma-4-E4B-it-GGUF ({error})"
        )
    });
    let repo = repo.trim();
    if repo.is_empty() {
        panic!("{ENV_VAR} is set but empty; name a repo, e.g. {ENV_VAR}=unsloth/gemma-4-E4B-it-GGUF");
    }
    // The walk starts the engine on the product's own loopback port; a port
    // already held (the app running beside this test) would only surface
    // later as the supervisor's PortTaken. Name the real cause here.
    if std::net::TcpListener::bind(("127.0.0.1", startup::PORT)).is_err() {
        panic!(
            "127.0.0.1:{} is already held — the app or a leftover server is running; stop it first",
            startup::PORT
        );
    }

    // ── 1. the row, out of the catalog — exactly one answers ───────────────
    let hits: Vec<kalsa_catalog::UsableEntry> =
        kalsa_catalog::usable().filter(|row| row.source().repo == repo).collect();
    let one = match hits.as_slice() {
        [one] => one,
        [] => panic!(
            "no catalog row's file lives in {repo:?}; the repos on the menu: {}",
            repos_on_the_menu()
        ),
        many => panic!(
            "{repo} names {} catalog rows ({}); a repo must name exactly one",
            many.len(),
            many.iter().map(|row| row.entry().display_name).collect::<Vec<_>>().join(", ")
        ),
    };
    let (entry, source) = (one.entry(), one.source());

    // The temp dirs the walk writes into: the state file (with the choice
    // beside it, where `options::save` puts it) and the engine's slot dir.
    let scratch =
        std::env::temp_dir().join(format!("kalsa-brain-real-walk-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&scratch);
    std::fs::create_dir_all(&scratch).expect("the temp directory is made");
    // Born the moment the scratch exists: a panic anywhere below — the
    // choice save, the walk, an assert — must leave nothing behind. The
    // engine gets its own guard later, once a supervisor exists. Named
    // `_scratch`, never a bare `_`: that would drop the guard on the spot,
    // which is the very thing it exists to prevent.
    let _scratch = Scratch(scratch.clone());
    let state_file = scratch.join("server.state");
    let slot_save_path = scratch.join("slots");

    // ── 2. the owner's choice, stored the way the Model page stores it ─────
    let mut choice = crate::options::load(&state_file);
    choice.model = Some(startup::model_token(entry));
    choice
        .validate()
        .expect("a catalog row's own token is a valid choice");
    crate::options::save(&state_file, choice).expect("the choice is saved by the options writer");
    eprintln!(
        "chosen: {} — {} ({} bytes, sha256 {}…)",
        entry.display_name,
        source.file,
        entry.weights_bytes,
        &source.sha256[..12]
    );

    // ── 3. the machine, measured for real (as main.rs measures it) ─────────
    eprintln!("measuring this machine; the probe runs for real");
    let machine = Machine {
        measurement: kalsa_probe::measure_reliable(&ProbeConfig::default()),
        ram_bytes: startup::ram_bytes(),
    };
    eprintln!(
        "machine: {:.0} GiB RAM, decode {:.1} GB/s, runs on {:?}",
        machine.ram_bytes as f64 / GIB,
        machine.measurement.decode_bandwidth_bytes_per_second() / 1.0e9,
        machine.measurement.will_run_on
    );

    // ── 4. the walk, exactly the product's order ───────────────────────────
    // One mark per transfer kind: runtime and model bytes are different
    // transfers, and a shared mark would mute the model's first lines after
    // the runtime's.
    let (mut runtime_mark, mut model_mark) = (0u64, 0u64);
    let mut transfer = ModelTransfer::default();
    let mut progress = |step: Progress| match step {
        Progress::Measuring => eprintln!("walk: measuring"),
        Progress::Deciding => eprintln!("walk: deciding the engine build"),
        Progress::Choosing => eprintln!("walk: the catalog is choosing"),
        Progress::Tuning { done, total } => eprintln!("walk: tuning {done}/{total}"),
        Progress::RuntimeBytes { done, total } => {
            bytes_mark("runtime", done, total, &mut runtime_mark)
        }
        Progress::ModelBytes { done, total } => {
            transfer.observe(done);
            bytes_mark("model", done, total, &mut model_mark);
        }
    };
    let prepared = startup::run(
        None,
        machine,
        None,
        1,
        None,
        state_file,
        slot_save_path,
        &kalsa_runtime::runtime_root(),
        &mut progress,
    )
    .map_err(|failure| crate::failure::words(&failure))
    .expect("the walk placed the chosen model and prepared the start");

    // ── 4b. the tune's own report: one line per candidate, then the line
    // the panel would show — the Windows walks prove the tune from these.
    if let Some(tune) = &prepared.info.tune {
        // The refusals matter too: a NoWinner tune's whole point is which
        // candidates refused, and the Windows walks print them here.
        let record = match tune {
            Tune::Measured(record) | Tune::NoWinner(record) => Some(record),
            Tune::Skipped => None,
        };
        if let Some(record) = record {
            for (candidate, kept) in &record.trials {
                let word = match kept {
                    kalsa_tune::record::Kept::Best(rate) => format!("{rate:.1} tok/s"),
                    kalsa_tune::record::Kept::Refused(refusal) => format!("refused ({refusal:?})"),
                };
                eprintln!("tune: {} — {word}", tune_label(candidate));
            }
        }
        eprintln!("tune: {}", tune_line(tune));
    }

    // ── 5. the stored choice was honoured, not silently replaced ───────────
    // On a machine that already holds the automatic answer this is the only
    // thing that tells a fallback (with its stale note, or the automatic
    // reason alone) from an honoured choice. Exactly two shapes: the stored
    // choice's own reason, or that same reason behind the processor
    // fallback's prefix — anything else means the walk replaced the choice.
    let reason = prepared.info.reason.as_deref();
    let prefixed = format!("{PROCESSOR_FALLBACK_REASON} {CHOSEN_REASON}");
    assert!(
        reason == Some(CHOSEN_REASON) || reason == Some(prefixed.as_str()),
        "the stored choice was replaced; the walk's own reason: {:?}",
        prepared.info.reason
    );
    assert_eq!(
        prepared.info.display_name.as_deref(),
        Some(entry.display_name),
        "a different row was launched"
    );
    assert_eq!(
        prepared.info.model_sha256.as_deref(),
        Some(source.sha256),
        "the launch record does not carry the row's pinned digest"
    );
    let model_path = &prepared.info.args.model_path;

    // ── 6. the file on disk is the row's, byte for byte ────────────────────
    // Whoever placed the file already held its bytes to the row's sha256 —
    // the downloader for a fetch, the walk's digest check for our own disk
    // copy (startup.rs:495), the reuse pass for another program's cache
    // (claim.rs:82) — so hashing gigabytes again here would only re-buy
    // that answer.
    let on_disk = std::fs::metadata(model_path).expect("the model file exists on disk");
    assert_eq!(
        on_disk.len(),
        entry.weights_bytes,
        "the file on disk is not the row's exact size: {model_path:?}"
    );
    // Which arm of the model step answered. A download lands in the
    // product's own models dir by construction, so anything else with no
    // bytes moved is a reuse from another program's cache, named here.
    let models_dir = kalsa_runtime::runtime_root().join("models");
    let parent = model_path.parent().expect("a file path has a parent");
    if parent == models_dir {
        // In the product's own dir the file carries the row's name, because
        // the walk names its destination from the plan. Outside it a reused
        // copy may carry another program's name — a digest-named blob, or
        // that program's own file name (find_local, startup.rs:479) — so
        // the catalog name is not asserted there; the size check above and
        // the record's pinned digest carry the identity, and the placed-by
        // line names the place.
        assert_eq!(
            model_path.file_name().and_then(|name| name.to_str()),
            Some(source.file),
            "the prepared start does not name the row's file: {}",
            model_path.display()
        );
    }
    if transfer.reported {
        assert_eq!(
            parent, models_dir,
            "a download landed outside the product's models dir"
        );
        eprintln!("placed by: download ({} bytes this run)", transfer.moved());
    } else if parent == models_dir {
        eprintln!("placed by: the file already on disk (no bytes moved)");
    } else {
        eprintln!(
            "placed by: the file already on disk (no bytes moved), reused from {}",
            parent.display()
        );
    }

    // ── 7. the server, through the supervisor, the way the app starts it ───
    let port = prepared.server.port;
    let ready_timeout = prepared.server.ready_timeout;
    let supervisor = Supervisor::new();
    let mut engine_guard = EngineGuard { supervisor: &supervisor, stood_down: false };
    assert_eq!(
        supervisor.start(prepared.server).outcome(),
        StartOutcome::Accepted,
        "the supervisor refused the prepared start"
    );
    eprintln!("waiting for /health; the engine is loading {:.1} GiB", on_disk.len() as f64 / GIB);
    let started = Instant::now();
    // The supervisor enforces `ready_timeout` itself; this loop only needs to
    // outlive it, to catch the verdict it writes when it gives up.
    let deadline = started + ready_timeout + Duration::from_secs(30);
    let up_port = loop {
        match supervisor.state() {
            ServerState::Running { port, .. } => break port,
            ServerState::Failed { reason } => panic!("the server failed to come up: {reason:?}"),
            _ => {
                assert!(
                    Instant::now() < deadline,
                    "the server was not running within {ready_timeout:?} plus the supervisor's margin"
                );
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    };
    assert_eq!(up_port, port, "the supervisor reported a port other than the walk's");
    eprintln!("the server is up on 127.0.0.1:{port} after {:.1?}", started.elapsed());

    let answer = chat_completion(port, PROMPT, MAX_TOKENS);
    // The "model" field is the answering server's self-report, not a
    // process identity: what it proves is that the server behind this port
    // names the path we prepared. The bind race stays a residual — the
    // supervisor's preflight drops its probe bind before the child binds
    // (supervisor.rs:757) — and a field this self-reported cannot close it.
    let served = answer.pointer("/model").and_then(Value::as_str).unwrap_or("<absent>");
    assert_eq!(
        served,
        model_path.to_str().expect("the prepared path is UTF-8"),
        "the server that answered is not the one the walk started"
    );
    let content = answer
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let reasoning = answer
        .pointer("/choices/0/message/reasoning_content")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let finish = answer
        .pointer("/choices/0/finish_reason")
        .and_then(Value::as_str)
        .unwrap_or("<absent>");
    assert!(
        finish == "stop" && !content.trim().is_empty(),
        "the answer did not finish: finish_reason {finish:?}, content {} chars, \
         reasoning_content {} chars",
        content.chars().count(),
        reasoning.chars().count(),
    );
    eprintln!("answer: {content:?}");
    let timings = &answer["timings"];
    eprintln!(
        "timings: prompt {} tokens in {:.1} ms ({:.1} tok/s); decode {} tokens in {:.1} ms ({:.1} tok/s)",
        timing(timings, "prompt_n"),
        timing(timings, "prompt_ms"),
        timing(timings, "prompt_per_second"),
        timing(timings, "predicted_n"),
        timing(timings, "predicted_ms"),
        timing(timings, "predicted_per_second")
    );
    if reasoning.is_empty() {
        eprintln!("reasoning: none");
    } else {
        eprintln!(
            "reasoning: {} chars before the answer",
            reasoning.chars().count()
        );
    }

    // ── 8. down again, proved down; the temp dirs go, the model stays ──────
    supervisor.shutdown();
    assert_eq!(
        supervisor.state(),
        ServerState::Stopped,
        "the server did not report itself stopped"
    );
    engine_guard.stood_down = true;
    std::fs::remove_dir_all(&scratch).expect("the temp directories are removed");
    eprintln!("=== the walk is complete; the model stays in the app's models dir ===");
}

/// Sweeps the temp directories on every exit path, from the moment they
/// exist. The engine has its own guard, later, because no supervisor exists
/// yet when the scratch is made.
struct Scratch(PathBuf);

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Stops the engine on every exit path once the supervisor exists, a failed
/// assert included. Owns only the engine: the temp directories have their
/// own guard, born with the scratch.
struct EngineGuard<'a> {
    supervisor: &'a Supervisor,
    stood_down: bool,
}

impl Drop for EngineGuard<'_> {
    fn drop(&mut self) {
        if !self.stood_down {
            self.supervisor.shutdown();
        }
    }
}

/// What the model step's progress stream said, read to tell a download from
/// a placement that moved no bytes. The first `ModelBytes` reading is the
/// walk's own zero-fire; when the downloader reports at all, its first
/// report is its starting count — the resume offset, or zero — so `moved`
/// is exact for a fresh download and a resumed one alike. A complete
/// `.part` makes the downloader return before any report (fetch.rs:52),
/// leaving the zero-fire alone: `moved` is then 0, which is also exact —
/// no byte moved.
#[derive(Default)]
struct ModelTransfer {
    reported: bool,
    readings: u32,
    start: u64,
    last: u64,
}

impl ModelTransfer {
    fn observe(&mut self, done: u64) {
        self.reported = true;
        self.readings += 1;
        if self.readings == 2 {
            self.start = done;
        }
        self.last = done;
    }

    fn moved(&self) -> u64 {
        self.last - self.start
    }
}

fn bytes_mark(what: &str, done: u64, total: u64, last_mark: &mut u64) {
    let mark = done / MARK_BYTES;
    if mark > *last_mark || done >= total {
        eprintln!("walk: {what} bytes {done} / {total}");
        *last_mark = mark;
    }
}

fn repos_on_the_menu() -> String {
    kalsa_catalog::usable().map(|row| row.source().repo).collect::<Vec<_>>().join(", ")
}

/// One timing figure out of the server's own answer, or the failure to find
/// it is a loud one — a silent 0.0 would read as a measured number.
fn timing(timings: &Value, field: &str) -> f64 {
    timings
        .get(field)
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("the server's timings carry no {field}: {timings}"))
}
