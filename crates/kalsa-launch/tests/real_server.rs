//! The rendered argv against the real binary, on this real machine.
//!
//! The unit tests assert strings this crate renders; only a real
//! `llama-server` can prove those strings are an argv it accepts and a
//! server that answers. That gate failed once already: `--flash-attn` takes
//! a value in llama.cpp b10950, so the rendered argv parsed in every unit
//! test and still refused to start.
//!
//! Worse, a value the server does not accept is **ignored or clamped in
//! silence** — the default verbosity says nothing about batch, micro-batch
//! or cache type. So the only honest proof that the owner's choices reach
//! the machine is to start the real binary with the harness's own `-lv 5`
//! and read back `n_ctx`, `n_batch`, `n_ubatch` and the cache line it
//! prints. The `-lv 5` is the harness's flag, never `argv()`'s: raised
//! verbosity makes the server log the user's prompt token by token, and a
//! shipped command line must never ask for that (the unit test
//! `the_argv_never_asks_the_server_to_log_prompts` forbids it). A throwaway
//! test server that only ever sees "Say OK" can afford the flag.
//!
//! Ignored by default. Run it deliberately:
//!
//! ```text
//! KALSA_REAL_SERVER=/path/to/llama-server \
//! KALSA_REAL_MODEL=/path/to/model.gguf \
//! cargo test -p kalsa-launch --test real_server -- --ignored --nocapture
//! ```
//!
//! The model must be catalog-shaped: the q8_0 cache this crate pins needs a
//! head dimension divisible by the quantization's block size (32). The tiny
//! probe model stories260K (head dim 8) is refused at load with "K cache
//! type q8_0 ... does not divide n_embd_head_k=8" — a property of the
//! model, not of the argv.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use kalsa_launch::{KvCache, Offload, ServerArgs};

/// Fixed, so a stray server from an earlier run is findable; the unit tests
/// never bind it and 8137 is the supervisor's territory.
const PORT: u16 = 8138;
/// The port the owner-knob tests use — deliberately not the app's and not
/// the smoke test's, so a stray process is identifiable.
const KNOBS_PORT: u16 = 8139;
/// Model load on a cold cache can take a while; /health answers 503 until
/// the model is up, and the deadline is for a server that never answers.
const HEALTH_DEADLINE: Duration = Duration::from_secs(120);
const REQUEST_TIMEOUT: Duration = Duration::from_millis(10_000);

/// One server at a time, always: two resident models fight over the GPU, and
/// measured contention has killed a running server. The test harness runs
/// tests in parallel by default, so this is a process-wide lock rather than
/// a convention. Poison is recovered deliberately — a failed test must not
/// turn the other three into a locked-up run; the child guard has already
/// killed its server on the way out.
static ONE_SERVER: Mutex<()> = Mutex::new(());

fn one_server_at_a_time() -> std::sync::MutexGuard<'static, ()> {
    ONE_SERVER
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The two paths every real test needs, or a printed skip. Returning `None`
/// keeps the harness's "0 passed, N ignored" honest when the vars are unset.
fn real_launch() -> Option<(String, String)> {
    let exe = std::env::var("KALSA_REAL_SERVER")
        .ok()
        .filter(|s| !s.is_empty());
    let model = std::env::var("KALSA_REAL_MODEL")
        .ok()
        .filter(|s| !s.is_empty());
    match (exe, model) {
        (Some(exe), Some(model)) => Some((exe, model)),
        _ => {
            eprintln!("skipped: set KALSA_REAL_SERVER and KALSA_REAL_MODEL");
            None
        }
    }
}

/// The owner's decided values as data — all three launch knobs explicit, so a
/// constant leaking back into `argv()` shows up as a wrong number the server
/// prints, not as a missing flag nobody notices.
fn launch_args(
    model: &str,
    port: u16,
    context: u64,
    batch: u32,
    ubatch: u32,
    cache: KvCache,
) -> ServerArgs {
    ServerArgs {
        model_path: PathBuf::from(model),
        port,
        context_tokens: context,
        // A real roof, not zero: zero disables the prompt cache and the
        // server accepts it in silence, which is the failure mode this file
        // exists to catch.
        cache_ram_mib: 1024,
        threads: Some(4),
        offload: Offload::All,
        idle_unload_seconds: 300,
        batch_size: batch,
        ubatch_size: ubatch,
        kv_cache: cache,
    }
}

/// Kills the child on every path, drop runs even when an assert panics: no
/// orphaned server is left holding a port and a few GiB of RAM.
struct ServerChild(Child);

impl Drop for ServerChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Spawns `llama-server` with `argv`, stdout discarded and stderr to a file
/// (a full pipe blocks the child mid-startup). `verbose` appends the
/// harness's own `-lv 5`, which is how the server's `n_ctx`, `n_batch`,
/// `n_ubatch` and cache lines become readable.
fn spawn_server(exe: &str, argv: &[String], label: &str, verbose: bool) -> (ServerChild, PathBuf) {
    let stderr_path = std::env::temp_dir().join(format!("kalsa-launch-server-{label}.log"));
    let stderr = std::fs::File::create(&stderr_path).expect("create the server log file");
    let mut command = Command::new(exe);
    command.args(argv).stdout(Stdio::null()).stderr(Stdio::from(stderr));
    if verbose {
        command.args(["-lv", "5"]);
    }
    let child = ServerChild(command.spawn().expect("spawn the real llama-server"));
    (child, stderr_path)
}

/// Waits until `/health` answers 200, or the binary dies, or the deadline
/// passes. The server's own last words are quoted on failure: they are why
/// it never came up.
fn wait_for_health(child: &mut ServerChild, addr: SocketAddr, stderr_path: &Path) {
    let deadline = Instant::now() + HEALTH_DEADLINE;
    loop {
        if let Some(status) = child.0.try_wait().expect("poll the server") {
            panic!(
                "the server exited before answering /health ({status}): {}",
                stderr_tail(stderr_path)
            );
        }
        if http_status(addr, "/health", "GET", None) == Some(200) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "the server did not answer /health within {}s: {}",
            HEALTH_DEADLINE.as_secs(),
            stderr_tail(stderr_path)
        );
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// The server's log as text, for reading back what it actually did.
fn read_log(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|_| "(no server output)".to_string())
}

/// The integer a log line assigns to `field`, read from the token before the
/// `=`. Matching the field token rather than a substring is the point: a
/// search for "n_batch" must not answer a question about "n_ubatch", and the
/// value — not the field's presence — is what the test is about.
fn logged_value(log: &str, field: &str) -> Option<u64> {
    for line in log.lines() {
        let Some((left, right)) = line.split_once('=') else {
            continue;
        };
        if left.split_whitespace().last() != Some(field) {
            continue;
        }
        if let Some(value) = right
            .split_whitespace()
            .next()
            .and_then(|value| value.parse().ok())
        {
            return Some(value);
        }
    }
    None
}

/// Every `llama_kv_cache: size = N MiB` the server printed, summed. Hybrid
/// (SWA) models print two caches, and the memory the machine pays is their
/// sum, so reading only the first would understate a real model.
fn logged_kv_mib(log: &str) -> f64 {
    log.lines()
        .filter(|line| line.contains("llama_kv_cache: size ="))
        .filter_map(|line| {
            line.split("size =")
                .nth(1)?
                .split_whitespace()
                .next()?
                .parse::<f64>()
                .ok()
        })
        .sum()
}

/// The lines an assert message should quote, so a failure shows what the
/// server actually said instead of only what the test expected.
fn logged_launch_lines(log: &str) -> String {
    let lines: Vec<&str> = log
        .lines()
        .filter(|line| {
            line.contains("n_ctx")
                || line.contains("n_batch")
                || line.contains("n_ubatch")
                || line.contains("llama_kv_cache: size =")
        })
        .collect();
    if lines.is_empty() {
        "(the server printed no context, batch or cache line)".to_string()
    } else {
        lines.join(" | ")
    }
}

#[test]
#[ignore = "runs the real llama-server; set KALSA_REAL_SERVER and KALSA_REAL_MODEL"]
fn the_rendered_argv_starts_a_server_that_answers() {
    let Some((exe, model)) = real_launch() else {
        return;
    };
    let _guard = one_server_at_a_time();

    // The value a real start would carry, built as data — not a copy of what
    // argv() happens to render today.
    let args = ServerArgs {
        model_path: PathBuf::from(&model),
        port: PORT,
        context_tokens: 512,
        // The roof is rendered even though this smoke test does not exercise
        // conversations: a zero would disable the function outright and the
        // binary would accept it in silence, so no value but a real one —
        // the same MiB scale the production plan ships — proves the unit is
        // what llama-server expects.
        cache_ram_mib: 6144,
        threads: Some(4),
        offload: Offload::All,
        idle_unload_seconds: 300,
        batch_size: 2048,
        ubatch_size: 512,
        kv_cache: KvCache::Q8_0,
    };
    let argv = args.argv();
    eprintln!("argv: {argv:?}");

    let (mut child, stderr_path) = spawn_server(&exe, &argv, "8138", false);
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    wait_for_health(&mut child, addr, &stderr_path);

    // One real turn: the phone talks to /v1/chat/completions, so a server
    // that loads but does not answer there is not a server that works.
    let body = r#"{"messages":[{"role":"user","content":"Reply with the single word OK."}],"max_tokens":4}"#;
    let status = http_status(addr, "/v1/chat/completions", "POST", Some(body))
        .expect("the completion request must be answered");
    assert_eq!(status, 200, "the chat completion must answer 200");
    eprintln!("the server answered /health and one chat completion");
    let _ = std::fs::remove_file(&stderr_path);
}

/// TEST 1 — the owner's three choices reach the real server. Everything here
/// is proven from the server's own mouth; the unit tests only proved the
/// string. Goes RED the moment `argv()` renders a constant instead of the
/// decided value.
#[test]
#[ignore = "runs the real llama-server; set KALSA_REAL_SERVER and KALSA_REAL_MODEL"]
fn the_owners_batch_microbatch_and_cache_reach_the_real_server() {
    let Some((exe, model)) = real_launch() else {
        return;
    };
    let _guard = one_server_at_a_time();

    let args = launch_args(&model, KNOBS_PORT, 2048, 1024, 256, KvCache::F16);
    let (mut child, stderr_path) = spawn_server(&exe, &args.argv(), "knobs", true);
    let addr = SocketAddr::from(([127, 0, 0, 1], KNOBS_PORT));
    wait_for_health(&mut child, addr, &stderr_path);
    let log = read_log(&stderr_path);
    let n_ctx = logged_value(&log, "n_ctx");
    let n_batch = logged_value(&log, "n_batch");
    let n_ubatch = logged_value(&log, "n_ubatch");
    eprintln!("the server printed n_ctx={n_ctx:?} n_batch={n_batch:?} n_ubatch={n_ubatch:?}");

    assert_eq!(
        n_ctx,
        Some(2048),
        "the server's n_ctx is not the context we asked for: {}",
        logged_launch_lines(&log)
    );
    assert_eq!(
        n_batch,
        Some(1024),
        "the server's n_batch is not the batch we asked for: {}",
        logged_launch_lines(&log)
    );
    assert_eq!(
        n_ubatch,
        Some(256),
        "the server's n_ubatch is not the micro-batch we asked for: {}",
        logged_launch_lines(&log)
    );

    let cache_line = log
        .lines()
        .find(|line| line.contains("llama_kv_cache: size ="))
        .expect("the server must print its KV cache size");
    assert!(
        cache_line.contains("K (f16)") && cache_line.contains("V (f16)"),
        "the server did not allocate the f16 cache we asked for: {cache_line}"
    );

    let _ = std::fs::remove_file(&stderr_path);
}

/// TEST 2 — the cache type really doubles the memory. This is the same
/// interaction `policy.rs` encodes in arithmetic; here it is measured on the
/// real machine, one server at a time.
#[test]
#[ignore = "runs the real llama-server; set KALSA_REAL_SERVER and KALSA_REAL_MODEL"]
fn the_cache_type_doubles_the_kv_the_server_allocates() {
    let Some((exe, model)) = real_launch() else {
        return;
    };
    let _guard = one_server_at_a_time();

    let addr = SocketAddr::from(([127, 0, 0, 1], KNOBS_PORT));
    let mut sizes: Vec<(&'static str, f64)> = Vec::new();
    for cache in [KvCache::Q8_0, KvCache::F16] {
        let args = launch_args(&model, KNOBS_PORT, 2048, 1024, 256, cache);
        let (mut child, stderr_path) = spawn_server(&exe, &args.argv(), cache.flag(), true);
        wait_for_health(&mut child, addr, &stderr_path);
        let log = read_log(&stderr_path);
        let mib = logged_kv_mib(&log);
        assert!(
            mib > 0.0,
            "the server printed no KV cache size for {}: {}",
            cache.flag(),
            logged_launch_lines(&log)
        );
        eprintln!("{}: KV total {mib:.2} MiB", cache.flag());
        sizes.push((cache.flag(), mib));
        // Killed before the next server starts: two resident models fight
        // over the GPU, and that contention has killed a running server.
        drop(child);
        let _ = std::fs::remove_file(&stderr_path);
    }

    let (_, q8_0_mib) = sizes[0];
    let (_, f16_mib) = sizes[1];
    let ratio = f16_mib / q8_0_mib;
    // q8_0 stores 34 bytes per 32 elements (a 2-byte scale per block), so the
    // exact element ratio is 2 / (34/32) = 64/34 ≈ 1.882; f16 is exactly 2
    // bytes per element. "About twice" is that band, not 2.000.
    assert!(
        (1.8..=2.1).contains(&ratio),
        "the f16 cache ({f16_mib:.2} MiB) is not about twice the q8_0 cache \
         ({q8_0_mib:.2} MiB): ratio {ratio:.3}"
    );
}

/// TEST 3 — the context the server grants is the context we asked for, read
/// from `/props` rather than inferred from argv.
#[test]
#[ignore = "runs the real llama-server; set KALSA_REAL_SERVER and KALSA_REAL_MODEL"]
fn the_context_the_server_grants_is_the_context_we_asked_for() {
    let Some((exe, model)) = real_launch() else {
        return;
    };
    let _guard = one_server_at_a_time();

    let args = launch_args(&model, KNOBS_PORT, 2048, 1024, 256, KvCache::Q8_0);
    let (mut child, stderr_path) = spawn_server(&exe, &args.argv(), "props", true);
    let addr = SocketAddr::from(([127, 0, 0, 1], KNOBS_PORT));
    wait_for_health(&mut child, addr, &stderr_path);

    let response = http_request(addr, "/props", "GET", None).expect("/props must answer");
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or_default();
    let json: serde_json::Value =
        serde_json::from_str(body).unwrap_or_else(|error| panic!("/props is not JSON ({error}): {body}"));
    let n_ctx = json["default_generation_settings"]["n_ctx"].as_u64();
    eprintln!("/props default_generation_settings.n_ctx = {n_ctx:?}");
    assert_eq!(
        n_ctx,
        Some(args.context_tokens),
        "the server granted a different context than we asked for: {body}"
    );

    let _ = std::fs::remove_file(&stderr_path);
}

/// One HTTP request over a fresh connection, the supervisor's way: no client,
/// no async. The whole response is returned as text so a caller can take the
/// status off the head or the body after the blank line.
fn http_request(addr: SocketAddr, path: &str, method: &str, body: Option<&str>) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(&addr, REQUEST_TIMEOUT).ok()?;
    let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(REQUEST_TIMEOUT));
    let mut request = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n", addr.port());
    if let Some(body) = body {
        request.push_str("Content-Type: application/json\r\n");
        request.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    request.push_str("Connection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    if let Some(body) = body {
        stream.write_all(body.as_bytes()).ok()?;
    }
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    Some(String::from_utf8_lossy(&response).into_owned())
}

/// The status off the head of a response.
fn http_status(addr: SocketAddr, path: &str, method: &str, body: Option<&str>) -> Option<u16> {
    let response = http_request(addr, path, method, body)?;
    let head = response.split("\r\n\r\n").next()?;
    let mut parts = head.split_whitespace();
    let version = parts.next()?;
    let code = parts.next()?.parse().ok()?;
    version.starts_with("HTTP/1.").then_some(code)
}

/// The server's own last words, for the failure message.
fn stderr_tail(path: &std::path::Path) -> String {
    let Ok(text) = std::fs::read_to_string(path) else {
        return "(no server output)".to_string();
    };
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(5);
    lines[start..].join(" | ")
}
