//! The rendered argv against the real binary, on this real machine.
//!
//! The unit tests assert strings this crate renders; only a real
//! `llama-server` can prove those strings are an argv it accepts and a
//! server that answers. That gate failed once already: `--flash-attn` takes
//! a value in llama.cpp b10950, so the rendered argv parsed in every unit
//! test and still refused to start.
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
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use kalsa_launch::{Offload, ServerArgs};

/// Fixed, so a stray server from an earlier run is findable; the unit tests
/// never bind it and 8137 is the supervisor's territory.
const PORT: u16 = 8138;
/// Model load on a cold cache can take a while; /health answers 503 until
/// the model is up, and the deadline is for a server that never answers.
const HEALTH_DEADLINE: Duration = Duration::from_secs(120);
const REQUEST_TIMEOUT: Duration = Duration::from_millis(10_000);

/// Kills the child on every path, drop runs even when an assert panics: no
/// orphaned server is left holding a port and a few GiB of RAM.
struct ServerChild(Child);

impl Drop for ServerChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
#[ignore = "runs the real llama-server; set KALSA_REAL_SERVER and KALSA_REAL_MODEL"]
fn the_rendered_argv_starts_a_server_that_answers() {
    let Some(exe) = std::env::var("KALSA_REAL_SERVER")
        .ok()
        .filter(|s| !s.is_empty())
    else {
        eprintln!("skipped: set KALSA_REAL_SERVER to a llama-server binary");
        return;
    };
    let Some(model) = std::env::var("KALSA_REAL_MODEL")
        .ok()
        .filter(|s| !s.is_empty())
    else {
        eprintln!("skipped: set KALSA_REAL_MODEL to a catalog-shaped GGUF");
        return;
    };

    // The value a real start would carry, built as data — not a copy of what
    // argv() happens to render today.
    let args = ServerArgs {
        model_path: PathBuf::from(&model),
        port: PORT,
        context_tokens: 512,
        threads: Some(4),
        offload: Offload::All,
    };
    let argv = args.argv();
    eprintln!("argv: {argv:?}");

    // stderr goes to a file, not a pipe: llama.cpp logs its whole backend
    // scan there, and a full pipe blocks the child mid-startup. The file is
    // what this test quotes when the server dies.
    let stderr_path = std::env::temp_dir().join(format!("kalsa-launch-server-{}.log", PORT));
    let stderr = std::fs::File::create(&stderr_path).expect("create the server log file");
    let mut child = ServerChild(
        Command::new(&exe)
            .args(&argv)
            .stdout(Stdio::null())
            .stderr(Stdio::from(stderr))
            .spawn()
            .expect("spawn the real llama-server"),
    );

    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let deadline = Instant::now() + HEALTH_DEADLINE;
    loop {
        if let Some(status) = child.0.try_wait().expect("poll the server") {
            panic!(
                "the server exited before answering /health ({status}): {}",
                stderr_tail(&stderr_path)
            );
        }
        if http_status(addr, "/health", "GET", None) == Some(200) {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the server did not answer /health within {}s: {}",
            HEALTH_DEADLINE.as_secs(),
            stderr_tail(&stderr_path)
        );
        std::thread::sleep(Duration::from_millis(250));
    }

    // One real turn: the phone talks to /v1/chat/completions, so a server
    // that loads but does not answer there is not a server that works.
    let body = r#"{"messages":[{"role":"user","content":"Reply with the single word OK."}],"max_tokens":4}"#;
    let status = http_status(addr, "/v1/chat/completions", "POST", Some(body))
        .expect("the completion request must be answered");
    assert_eq!(status, 200, "the chat completion must answer 200");
    eprintln!("the server answered /health and one chat completion");
    let _ = std::fs::remove_file(&stderr_path);
}

/// One HTTP request over a fresh connection, the supervisor's /health way:
/// no client, no async, status parsed off the head.
fn http_status(addr: SocketAddr, path: &str, method: &str, body: Option<&str>) -> Option<u16> {
    let mut stream = TcpStream::connect_timeout(&addr, REQUEST_TIMEOUT).ok()?;
    let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(REQUEST_TIMEOUT));
    let mut request = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n");
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
    let head = String::from_utf8_lossy(&response);
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
