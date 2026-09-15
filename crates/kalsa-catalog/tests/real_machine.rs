//! The prediction against the one judge it has: a real decode, measured.
//!
//! Everything else in this crate is proved against itself. That proves the
//! arithmetic and says nothing about the one fact only the world can settle —
//! whether the speed the catalog predicts for a row is the speed the machine
//! actually delivers. Tonight's first end-to-end run made that answerable:
//! the shell downloaded the pinned Trinity GGUF and served it with the real
//! engine, and this test re-runs both halves and prints them side by side.
//!
//! The machine is probed the way the product probes it, the catalog is asked
//! the way the shell asks it, and the server is started the way the launcher
//! starts it: the argv mirrors the live run — `--flash-attn on` (in build
//! b10950 the flag takes a value and a bare flag swallows the next one),
//! `all` layers on the Metal build, cache q8_0 both tensors, batch 512,
//! ubatch 128, context 4096.
//!
//! Ignored by default: it probes the machine and runs a child server. It
//! needs the same two environment variables the other real tests use:
//!
//! ```text
//! KALSA_BRAIN_SERVER_BIN=.../llama-server KALSA_BRAIN_MODEL=.../model.gguf \
//!   cargo test -p kalsa-catalog --test real_machine -- --ignored --nocapture
//! ```

use kalsa_catalog::{choose, ChoiceInput, Decision, Justification, Parameters, PhoneModel, Prediction, GIB};
use kalsa_probe::{measure_reliable, ProbeConfig};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::{Duration, Instant};

/// The context the prediction and the measurement share. 8192 is the
/// catalog's working context, and at it the 8 GiB tier asks about Trinity —
/// at 4096 the heavier granite-4.0-h-tiny also fits and displaces Trinity in
/// the same-class tiebreak, which would make this test measure a row the
/// shell did not predict.
const CONTEXT_TOKENS: u64 = 8192;

/// The phone the pairing handshake reports: a dense 4B at 2.83 GB, on
/// battery. Trinity is the 8 GiB tier's pick against it, and decode does not
/// depend on the budget — only on the path, the weights and the context — so
/// this is the honest way to ask the catalog about Trinity through the public
/// walk without lying about anything that matters.
fn trinity_tier_input(backend: kalsa_probe::Backend, ceiling: f64, lower_bound: bool) -> ChoiceInput {
    ChoiceInput {
        backend,
        ram_bytes: 8 * GIB,
        bandwidth_bytes_per_second: ceiling,
        bandwidth_is_lower_bound: lower_bound,
        compute_flops_per_second: 100.0e9,
        context_tokens: CONTEXT_TOKENS,
        phone: Some(PhoneModel {
            weights_bytes: 2_834_975_040,
            parameters: Some(Parameters::dense(4_000_000_000)),
            measured_tokens_per_second: None,
            battery_powered: Some(true),
        }),
    }
}

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

/// The same completion request every measured turn: the variance under test
/// is the machine's, not the prompt's.
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

/// The decode throughput the server itself reported for a turn — the same
/// number the live run collected.
fn predicted_per_second(body: &str) -> f64 {
    let parsed: serde_json::Value = serde_json::from_str(body).expect("a JSON completion");
    parsed["timings"]["predicted_per_second"]
        .as_f64()
        .expect("timings.predicted_per_second in the completion")
}

/// The middle of a short slice of turn throughputs.
fn median_of(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    sorted[sorted.len() / 2]
}

#[test]
#[ignore = "probes this machine and runs the real engine as a child"]
fn the_catalog_prediction_meets_the_measured_decode() {
    let Some((bin, model)) = engine_and_model() else {
        return;
    };

    // The machine, probed the way the product probes it. The whole ramp is
    // printed because a ceiling is a claim about a machine, and the shape
    // behind it is how a reader checks the claim.
    let measurement = measure_reliable(&ProbeConfig::default());
    let backend = measurement.will_run_on;
    let ceiling = measurement.ceiling_bytes_per_second;
    let lower_bound = measurement.bandwidth_is_lower_bound();
    for (threads, rate) in &measurement.ramp {
        eprintln!("probe:    {threads:>2} threads  {rate:>8.1} GB/s", rate = rate / 1e9);
    }
    eprintln!(
        "probe:    backend {backend:?}, ceiling {:.1} GB/s at {} threads, reliable: {}, \
         bandwidth_is_lower_bound {lower_bound}",
        ceiling / 1e9,
        measurement.plateau_threads,
        measurement.is_reliable(),
    );
    for note in &measurement.reliability.notes {
        eprintln!("probe:    note: {note}");
    }

    // What the catalog predicts for the Trinity row, through the public walk.
    let input = trinity_tier_input(backend, ceiling, lower_bound);
    let predicted = match choose(&input) {
        Decision::Pick(selection) => {
            assert_eq!(
                selection.repo, "arcee-ai/Trinity-Nano-Preview",
                "the 8 GiB tier must ask about Trinity"
            );
            // The floor path is the active one on a Metal machine: the
            // bandwidth was measured on the CPU while the model decodes on
            // the GPU, and the prediction carries that as its shape.
            assert!(
                lower_bound,
                "on a Metal machine the CPU-path bandwidth must arrive as a floor"
            );
            assert!(
                matches!(selection.decode, Prediction::Floor(_)),
                "a lower-bound bandwidth must predict a floor: {:?}",
                selection.decode
            );
            let plan = selection
                .download
                .expect("Trinity has an identified, pinned source");
            assert!(plan.url.contains("Trinity-Nano-Preview-Q4_K_M.gguf"));
            let predicted = selection.decode.floor();
            eprintln!(
                "predicted: ≥ {predicted:.1} tok/s (Prediction::Floor; the tier picks \
                 Trinity by relief)"
            );
            predicted
        }
        other => panic!("expected a pick for Trinity, got {other:?}"),
    };

    // The real engine, started the way the launcher starts it, on a port
    // nothing else owns.
    let port = free_port();
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
                "512",
                "--ubatch-size",
                "128",
                "--ctx-size",
                &CONTEXT_TOKENS.to_string(),
                "--n-gpu-layers",
                "all",
                "--flash-attn",
                "on",
                "--cache-type-k",
                "q8_0",
                "--cache-type-v",
                "q8_0",
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

    // A short series: one warm-up turn pays for the cold graph, three
    // measured turns are enough for a direction and never heat the machine.
    for _ in 0..1 {
        http(port, &chat_request(port, 16));
    }
    let mut turns: Vec<f64> = Vec::new();
    for _ in 0..3 {
        let response = http(port, &chat_request(port, 64));
        turns.push(predicted_per_second(body_of(&response)));
    }
    let measured = median_of(&turns);
    eprintln!("measured: {measured:.2} tok/s (median of {:?} tok/s turns)", turns);

    // The comparison, with its distance. The direction is the finding, not
    // an assertion: this test is the instrument, and what the numbers say is
    // reported rather than pinned by whoever ran it last.
    let distance = (predicted - measured) / measured * 100.0;
    let direction = if distance > 0.0 {
        "the prediction is ABOVE the measurement (it promises speed that may not arrive)"
    } else if distance < 0.0 {
        "the prediction is BELOW the measurement (it under-sells a machine that can run it)"
    } else {
        "exact"
    };
    eprintln!(
        "distance: {distance:+.1}% — {direction}"
    );
    drop(child);
}


