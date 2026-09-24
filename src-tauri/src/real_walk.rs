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
//! It downloads into the app's real models dir and KEEPS what it fetched —
//! that file is the product's now; only the temp state and slot dirs are
//! swept.
//!
//! ```text
//! KALSA_BRAIN_REAL_WALK=<repo> cargo test -p kalsa-brain real_walk -- --ignored --nocapture
//! ```

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde_json::Value;

use kalsa_probe::ProbeConfig;
use kalsa_supervisor::{ServerState, StartOutcome, Supervisor};

use crate::capability::CHOSEN_REASON;
use crate::startup::{self, Machine, Progress};

/// The env var that names the row to walk, by the repo its file is pinned to.
const ENV_VAR: &str = "KALSA_BRAIN_REAL_WALK";
/// The one conversation the running server is asked for, and how short it is.
const PROMPT: &str = "Say OK";
const MAX_TOKENS: u32 = 16;
/// Progress lines print at this granularity, not per callback: a silent
/// four-minute download reads as a broken test, a line per chunk is a log.
const MARK_BYTES: u64 = 512 * 1024 * 1024;
const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

#[test]
#[ignore = "moves gigabytes over the network and starts the real engine; set KALSA_BRAIN_REAL_WALK=<repo>"]
fn the_app_walks_a_chosen_catalog_row_for_real() {
    let repo = match std::env::var(ENV_VAR) {
        Ok(value) => value,
        Err(std::env::VarError::NotPresent) => {
            eprintln!("skip: set {ENV_VAR}=<repo> to walk one catalog row for real");
            return;
        }
        Err(error) => panic!("{ENV_VAR} is not readable: {error}"),
    };
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
    let mut last_mark = 0u64;
    let mut progress = |step: Progress| match step {
        Progress::Measuring => eprintln!("walk: measuring"),
        Progress::Deciding => eprintln!("walk: deciding the engine build"),
        Progress::Choosing => eprintln!("walk: the catalog is choosing"),
        Progress::RuntimeBytes { done, total } => bytes_mark("runtime", done, total, &mut last_mark),
        Progress::ModelBytes { done, total } => bytes_mark("model", done, total, &mut last_mark),
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

    // ── 5. the stored choice was honoured, not silently replaced ───────────
    // On a machine that already holds the automatic answer this is the only
    // thing that tells a fallback (with its stale note, or the automatic
    // reason alone) from an honoured choice.
    assert_eq!(
        prepared.info.reason.as_deref(),
        Some(CHOSEN_REASON),
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
    assert_eq!(
        model_path.file_name().and_then(|name| name.to_str()),
        Some(source.file),
        "the prepared start does not name the row's file: {}",
        model_path.display()
    );

    // ── 6. the file on disk is the row's, byte for byte ────────────────────
    // The downloader already held these bytes to the row's sha256; hashing
    // gigabytes again here would only re-buy that answer.
    let on_disk = std::fs::metadata(model_path).expect("the model file exists on disk");
    assert_eq!(
        on_disk.len(),
        entry.weights_bytes,
        "the file on disk is not the row's exact size: {model_path:?}"
    );

    // ── 7. the server, through the supervisor, the way the app starts it ───
    let port = prepared.server.port;
    let ready_timeout = prepared.server.ready_timeout;
    let supervisor = Supervisor::new();
    // Stands down on every exit path: Drop runs while a failed assert is
    // still unwinding, and the engine must not outlive this test.
    let mut guard = WalkGuard { supervisor: &supervisor, scratch: scratch.clone(), stood_down: false };
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
    let content = answer
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .expect("the completion carries a message content");
    assert!(!content.trim().is_empty(), "the model answered nothing: {answer}");
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

    // ── 8. down again, proved down; the temp dirs go, the model stays ──────
    supervisor.shutdown();
    assert_eq!(
        supervisor.state(),
        ServerState::Stopped,
        "the server did not report itself stopped"
    );
    guard.stood_down = true;
    std::fs::remove_dir_all(&scratch).expect("the temp directories are removed");
    eprintln!("=== the walk is complete; the model stays in the app's models dir ===");
}

/// Stops the server and sweeps the temp directories on every exit path,
/// including a failed assert.
struct WalkGuard<'a> {
    supervisor: &'a Supervisor,
    scratch: PathBuf,
    stood_down: bool,
}

impl Drop for WalkGuard<'_> {
    fn drop(&mut self) {
        if !self.stood_down {
            self.supervisor.shutdown();
        }
        let _ = std::fs::remove_dir_all(&self.scratch);
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

/// One OpenAI-style chat completion against the engine's own loopback port,
/// straight to the server the walk started — the request the door forwards
/// upstream, without the door.
fn chat_completion(port: u16, prompt: &str, max_tokens: u32) -> Value {
    let body = serde_json::json!({
        "messages": [{ "role": "user", "content": prompt }],
        "max_tokens": max_tokens,
    })
    .to_string();
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("the server answers its port");
    // A cold model compiles kernels on the first token; give it room.
    stream
        .set_read_timeout(Some(Duration::from_secs(300)))
        .expect("a read timeout is set");
    let request = format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).expect("the request is sent");
    let mut response = Vec::new();
    stream.read_to_end(&mut response).expect("the response is read to the close");
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("an HTTP response carries a header block");
    let head = String::from_utf8_lossy(&response[..header_end]).to_lowercase();
    let body = if head.contains("transfer-encoding: chunked") {
        dechunk(&response[header_end + 4..])
    } else {
        response[header_end + 4..].to_vec()
    };
    let status = head.lines().next().unwrap_or_default().to_string();
    let parsed = serde_json::from_slice(&body)
        .unwrap_or_else(|error| panic!("the body is not the JSON completion ({error}): {status}"));
    assert!(
        status.contains(" 200 "),
        "the server answered {status}: {}",
        String::from_utf8_lossy(&body)
    );
    parsed
}

/// Undoes `Transfer-Encoding: chunked` framing, which the engine may use
/// for a body with no length decided in advance.
fn dechunk(mut rest: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    loop {
        let line_end = rest
            .windows(2)
            .position(|window| window == b"\r\n")
            .expect("a chunk size line ends");
        let size = usize::from_str_radix(
            std::str::from_utf8(&rest[..line_end])
                .expect("the chunk size is text")
                .split(';')
                .next()
                .expect("a chunk size line")
                .trim(),
            16,
        )
        .expect("a hex chunk size");
        rest = &rest[line_end + 2..];
        if size == 0 {
            return body;
        }
        body.extend_from_slice(&rest[..size]);
        rest = &rest[size + 2..];
    }
}

/// One timing figure out of the server's own answer, or the failure to find
/// it is a loud one — a silent 0.0 would read as a measured number.
fn timing(timings: &Value, field: &str) -> f64 {
    timings
        .get(field)
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("the server's timings carry no {field}: {timings}"))
}
