//! The model walk against the real world: what is already on this machine,
//! and what the real extracted engine serves for it.
//!
//! `real_engine.rs` proves the release downloads, extracts and answers. This
//! file proves the two halves around the model: that a catalog row which is
//! already on the machine is *found* before anything is fetched, and that the
//! real engine, pointed at a real GGUF, serves completions a human would
//! recognise as text.
//!
//! Ignored by default. The first test only reads caches; the second runs a
//! child server and needs two environment variables:
//! `KALSA_BRAIN_SERVER_BIN` (the extracted llama-server) and
//! `KALSA_BRAIN_MODEL` (any real GGUF on this machine):
//!
//! ```text
//! cargo test -p kalsa-runtime --test real_model -- --ignored --nocapture
//! ```

use kalsa_download::{default_roots, find_local};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// The four catalog rows that carry a `GgufSource` — (file, bytes, sha256),
/// copied from `crates/kalsa-catalog/src/manifest.rs`, which is where they
/// live and the only place they may be corrected.
const SOURCED_ROWS: &[(&str, u64, &str)] = &[
    (
        "LFM2.5-8B-A1B-IQ4_XS.gguf",
        4_588_301_888,
        "2237675ffa1c2d5a277db4ef02b79e613fc172d4b63511ae8cbcb8c3d75d1148",
    ),
    (
        "Phi-mini-MoE-instruct-Q4_K_S.gguf",
        4_616_170_016,
        "16e1824f25a890ead375fd7f6476ef0813128079796286319e5594e8ffa1aefa",
    ),
    (
        "granite-4.0-h-tiny-Q4_K_M.gguf",
        4_230_976_352,
        "5a38b08c441ae1adbafb1d2b8a7167e0d48734d83af68b268cefea1eec553dcd",
    ),
    (
        "Trinity-Nano-Preview-Q4_K_M.gguf",
        3_786_957_088,
        "287562a3824ce2277e2c71cfcc70248b2d90f7fa342a4779979e0bf3e37ad546",
    ),
];

#[test]
#[ignore = "scans the machine's model caches; harmless but slow"]
fn a_catalog_row_may_already_be_on_this_machine() {
    let roots = default_roots();
    eprintln!("roots scanned: {roots:?}");
    for (file, bytes, sha) in SOURCED_ROWS {
        match find_local(&roots, *bytes, sha) {
            Some(path) => eprintln!("FOUND   {file} at {}", path.display()),
            None => eprintln!("absent  {file}"),
        }
    }
}

/// Kills the child on every way out of this test — return, assert, panic —
/// because a leaked llama-server holds gigabytes and a port on Marco's
/// machine, and no test is worth that.
struct ChildGuard(std::process::Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// The server binary and the model to serve, from the environment, the same
/// names the shell's development overrides use.
fn engine_and_model() -> Option<(PathBuf, PathBuf)> {
    let bin = std::env::var_os("KALSA_BRAIN_SERVER_BIN").map(PathBuf::from)?;
    let model = std::env::var_os("KALSA_BRAIN_MODEL").map(PathBuf::from)?;
    if !bin.is_file() || !model.is_file() {
        eprintln!(
            "skip: KALSA_BRAIN_SERVER_BIN={bin:?} KALSA_BRAIN_MODEL={model:?} — one of them is not a file"
        );
        return None;
    }
    Some((bin, model))
}

/// A free loopback port: bound, read, released for the child to take.
fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .expect("bind :0")
        .local_addr()
        .expect("addr")
        .port()
}

/// One raw HTTP request; the whole response as bytes.
fn http(port: u16, request: &str) -> String {
    // The readiness poll runs before the child is listening: a refused
    // connection there is "not yet", never a failure.
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return String::new();
    };
    stream
        .set_read_timeout(Some(Duration::from_secs(300)))
        .expect("read timeout");
    stream.write_all(request.as_bytes()).expect("write");
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response
}

/// The body of an HTTP response, after the blank line.
fn body_of(response: &str) -> &str {
    response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or("")
}

fn chat_request(port: u16, prompt: &str, max_tokens: u32) -> String {
    let payload = serde_json::json!({
        "model": "kalsa",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.7,
    });
    format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload.to_string().len(),
        payload
    )
}

#[test]
#[ignore = "runs the real engine as a child on a real model"]
fn the_real_engine_serves_a_real_model() {
    let Some((bin, model)) = engine_and_model() else {
        return;
    };
    let port = free_port();
    // `--flash-attn` takes a value in this build: without `on` it swallows
    // the next flag and the child exits before serving anything.
    let mut child = ChildGuard(
        std::process::Command::new(&bin)
            .args([
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--model",
            ])
            .arg(&model)
            .args([
                "--flash-attn",
                "on",
                "-ngl",
                "999",
                "-c",
                "4096",
                "--no-webui",
            ])
            .current_dir(bin.parent().expect("the binary has a directory"))
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("the engine starts"),
    );

    // Readiness is a deadline, never a sleep: a real model takes real time.
    let deadline = Instant::now() + Duration::from_secs(600);
    let mut healthy = false;
    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.0.try_wait() {
            panic!("the engine exited while starting: {status}");
        }
        if http(
            port,
            "GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
        )
        .contains("200 OK")
        {
            healthy = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    assert!(healthy, "the engine never answered /health");

    let started = Instant::now();
    // The fixture models reason before speaking: a 48-token budget is spent
    // entirely inside reasoning_content and the user-visible answer is empty.
    // 256 is the budget the live run proved sufficient.
    let response = http(
        port,
        &chat_request(port, "Say hello in one short sentence.", 256),
    );
    let wall = started.elapsed();
    let body = body_of(&response);
    let parsed: serde_json::Value = serde_json::from_str(body).expect("a JSON completion");
    let text = parsed["choices"][0]["message"]["content"]
        .as_str()
        .expect("a message content string");
    assert!(!text.trim().is_empty(), "the engine produced no text");

    let tokens = parsed["usage"]["completion_tokens"].as_u64().unwrap_or(0) as f64;
    eprintln!("=== generated on the Mac ===");
    eprintln!("{text}");
    eprintln!(
        "=== {} completion tokens in {:.2?} = {:.1} tok/s (wall clock) ===",
        tokens,
        wall,
        if wall.as_secs_f64() > 0.0 {
            tokens / wall.as_secs_f64()
        } else {
            0.0
        }
    );
}
