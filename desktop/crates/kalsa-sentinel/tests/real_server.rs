//! The thermal guard against a real llama-server, on this real machine.
//!
//! Everything else in this crate is proved against synthetic streams: that
//! proves the logic and says nothing about the one fact only the world can
//! settle — whether the *variance of a real decode* between identical
//! requests on an idle machine leaves the 0.75 degrade line where it should
//! be. If ordinary requests swing more than the line, the ladder would walk
//! down on a perfectly healthy machine, and no fixture can say so.
//!
//! The server is started the way the product starts it: the argv mirrors
//! `kalsa_launch::ServerArgs::argv()` (crates/kalsa-launch/src/argv.rs) —
//! `--flash-attn on` because in build b10950 the flag takes a value and a
//! bare flag swallows the next one, `-ngl all` on the Metal build, cache
//! q8_0 under flash attention. Each completion's `timings.predicted_per_second`
//! is fed to the sentinel sample by sample, as a real turn would be.
//!
//! Ignored by default: it loads a real model and runs a child server. It
//! needs two environment variables, the same names the other real tests use:
//!
//! ```text
//! KALSA_BRAIN_SERVER_BIN=.../llama-server KALSA_BRAIN_MODEL=.../model.gguf \
//!   cargo test -p kalsa-sentinel --test real_server -- --ignored --nocapture
//! ```

use kalsa_sentinel::{Event, Sample, Sentinel, Step};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// Warm-up turns: the first requests pay for model load and cold caches, and
/// are nobody's baseline.
const WARMUP_TURNS: usize = 3;
/// Measured turns: enough consecutive turns for the detector's persistence
/// gates to have their say, few enough that the test never heats the machine.
const MEASURED_TURNS: usize = 15;
/// The first few measured turns stand in for "what the machine did when it
/// was cool and idle" — the baseline the sentinel takes as input.
const BASELINE_TURNS: usize = 5;

/// The server binary and the model to serve, from the environment, the same
/// names the other real tests use.
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

/// A free loopback port: bound, read, released for the child to take. :0
/// hands out an ephemeral port, never the product's 8130 or the launcher
/// test's 8138.
fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .expect("bind :0")
        .local_addr()
        .expect("addr")
        .port()
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

/// One raw HTTP request; the whole response as bytes. Before the child is
/// listening a refused connection is "not yet", never a failure.
fn http(port: u16, request: &str) -> String {
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

/// An identical completion request, every time: the variance under test is
/// the machine's, not the prompt's.
fn chat_request(port: u16, max_tokens: u32) -> String {
    let payload = serde_json::json!({
        "model": "kalsa",
        "messages": [{"role": "user", "content": "Say hello in one short sentence."}],
        "max_tokens": max_tokens,
        "temperature": 0.0,
    });
    format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload.to_string().len(),
        payload
    )
}

/// The decode throughput the server itself reported for a turn.
fn predicted_per_second(body: &str) -> f64 {
    let parsed: serde_json::Value = serde_json::from_str(body).expect("a JSON completion");
    parsed["timings"]["predicted_per_second"]
        .as_f64()
        .expect("timings.predicted_per_second in the completion")
}

/// The middle of a short slice of turn throughputs: the baseline is a
/// measurement, so one odd turn among the evidence must not set it.
fn median_of(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    sorted[sorted.len() / 2]
}

#[test]
#[ignore = "loads a real model and runs the real engine as a child"]
fn a_real_engine_on_a_cool_machine_stays_sustaining() {
    let Some((bin, model)) = engine_and_model() else {
        return;
    };
    let port = free_port();
    // The canonical argv of `ServerArgs::argv()`, Metal build: `all` layers,
    // flash attention stated with its value, cache q8_0, batch 2048, ubatch
    // 512. No `--threads`: that flag renders only when the probe measured a
    // plateau, and this test lets the server pick its own default. (The
    // plan's `--parallel 1 --cache-ram N` are omitted here; this test does
    // not exercise conversations.)
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
                "--batch-size",
                "2048",
                "--ubatch-size",
                "512",
                "--ctx-size",
                "4096",
                "--n-gpu-layers",
                "all",
                "--flash-attn",
                "on",
                "--cache-type-k",
                "q8_0",
                "--cache-type-v",
                "q8_0",
                "--sleep-idle-seconds",
                "300",
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

    let request = chat_request(port, 256);
    for _ in 0..WARMUP_TURNS {
        http(port, &request);
    }

    let started = Instant::now();
    let mut turns: Vec<(f64, f64)> = Vec::new();
    for _ in 0..MEASURED_TURNS {
        let response = http(port, &request);
        let tps = predicted_per_second(body_of(&response));
        turns.push((started.elapsed().as_secs_f64(), tps));
    }

    let baseline = median_of(
        &turns[..BASELINE_TURNS]
            .iter()
            .map(|(_, tps)| *tps)
            .collect::<Vec<f64>>(),
    );
    let mut sentinel = Sentinel::new(baseline, turns[0].0);
    eprintln!("baseline (median of first {BASELINE_TURNS} turns): {baseline:.2} tok/s");

    let mut all_events = Vec::new();
    for (turn, (at, tps)) in turns.iter().enumerate() {
        let events = sentinel.observe(Sample {
            at: *at,
            tokens_per_second: *tps,
        });
        eprintln!(
            "turn {:>2}  t={:>6.1}s  {:>6.2} tok/s  {:>5.1}% of baseline",
            turn + 1,
            at,
            tps,
            tps / baseline * 100.0
        );
        all_events.extend(events);
    }

    let values: Vec<f64> = turns.iter().map(|(_, tps)| *tps).collect();
    let mean = values.iter().sum::<f64>() / values.len() as f64;
    let spread =
        (values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / values.len() as f64).sqrt();
    let worst = values.iter().cloned().fold(f64::INFINITY, f64::min);
    let best = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    eprintln!("=== the machine's own spread, {} turns ===", values.len());
    eprintln!(
        "mean {mean:.2}  min {worst:.2}  max {best:.2}  std dev {spread:.2}  \
         relative spread {:.1}%",
        spread / mean * 100.0
    );
    eprintln!(
        "worst turn at {:.1}% of baseline; the degrade line is at 75.0%; \
         the recover line at 90.0% (worst margin to the line: {:.1} points)",
        worst / baseline * 100.0,
        (worst / baseline - 0.75) * 100.0
    );

    // The promise under test: a cool, idle machine is never eased. If this
    // fails, the numbers above say the threshold is wrong against real
    // variance — that is the finding, not a flaky test.
    assert!(
        all_events.is_empty(),
        "a healthy machine moved the ladder: {all_events:?}"
    );

    // And the idle policy still sees the silence after the last turn: the
    // owner reports the release, and the sentinel resets for a fresh session.
    let last_at = turns.last().expect("measured turns").0;
    assert_eq!(
        sentinel.note_unload(last_at + 600.0),
        Some(Event::Unload {
            idle_seconds: 600.0,
            from: Step::Full,
        }),
    );
}
