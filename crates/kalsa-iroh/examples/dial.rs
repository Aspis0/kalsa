//! Dev-only dialer: the road's far side, from a terminal. It takes one node
//! id — 64 hex characters, the string a pairing square carries — and dials
//! it exactly the way production dials (`Bridge::connect` under
//! `RelayChoice::N0Public`), then measures what the road did:
//!
//! * the time from dial to the first connected stream,
//! * the path iroh ended on, direct or relay, as `Bridge::remote_paths`
//!   words it,
//! * sequential HTTP round trips to the door through the tunnel — `GET
//!   /v1/models` with NO credential, where an empty 401 is the proof a full
//!   round trip happened (the tunnel carried bytes and the door still owns
//!   authentication),
//! * a two-minute hold, sampling every 10 s, to see whether the path
//!   changes — a relay that upgrades to direct, for instance.
//!
//! Output is plain lines. No credential is used, moved, or printed. The
//! dialer's own node key is throwaway: its identity is not the thing
//! measured, and printing it would only add noise.
//!
//! ```text
//! cargo run -p kalsa-iroh --example dial -- <64-hex node id>
//! ```

use std::str::FromStr;
use std::time::{Duration, Instant};

use kalsa_iroh::{Bridge, BridgeConfig, NodeId, NodeKey, RelayChoice};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// How many sequential round trips make the timing sample. Each one is a
/// fresh tunnel: dial, request, response — what `Bridge::connect` gives.
const ROUND_TRIPS: usize = 20;
/// How long the hold phase samples the path.
const HOLD: Duration = Duration::from_secs(120);
/// One hold sample every this long; each sample is also a keepalive round
/// trip, so "the tunnel stayed up" is measured, not presumed.
const SAMPLE: Duration = Duration::from_secs(10);

/// The request the door answers with its empty 401. No Authorization
/// header travels anywhere in this example.
const REQUEST: &[u8] = b"GET /v1/models HTTP/1.1\r\nHost: kalsa\r\nConnection: close\r\n\r\n";

async fn round_trip(bridge: &Bridge, remote: NodeId) -> Result<(u16, Duration), String> {
    let started = Instant::now();
    let mut tunnel = bridge.connect(remote).await.map_err(|e| e.to_string())?;
    tunnel
        .write_all(REQUEST)
        .await
        .map_err(|e| format!("tunnel write: {e}"))?;
    tunnel
        .flush()
        .await
        .map_err(|e| format!("tunnel flush: {e}"))?;
    let mut response = Vec::new();
    tunnel
        .read_to_end(&mut response)
        .await
        .map_err(|e| format!("tunnel read: {e}"))?;
    let elapsed = started.elapsed();
    let status = std::str::from_utf8(&response)
        .ok()
        .and_then(|text| text.split_whitespace().nth(1))
        .and_then(|code| code.parse().ok())
        .ok_or_else(|| "the tunnel did not carry an HTTP status line".to_string())?;
    Ok((status, elapsed))
}

/// Min, median, p95 of the sample, in milliseconds.
fn summary(sample: &[Duration]) -> (u128, u128, u128) {
    let mut sorted: Vec<u128> = sample.iter().map(Duration::as_millis).collect();
    sorted.sort_unstable();
    let pick = |fraction: f64| sorted[((sorted.len() - 1) as f64 * fraction).round() as usize];
    (*sorted.first().unwrap_or(&0), pick(0.5), pick(0.95))
}

async fn paths_line(bridge: &Bridge, remote: NodeId) -> String {
    let paths = bridge.remote_paths(remote).await;
    if paths.is_empty() {
        "none known".to_string()
    } else {
        paths.join(" | ")
    }
}

async fn run() -> Result<(), String> {
    let argument = std::env::args().nth(1).ok_or_else(|| {
        "usage: cargo run -p kalsa-iroh --example dial -- <64-hex node id>".to_string()
    })?;
    let remote = NodeId::from_str(&argument).map_err(|e| e.to_string())?;
    println!("dialing {remote}");

    // The dialer never accepts: nothing dials it, so its door address is a
    // placeholder the accept loop would only use for inbound traffic.
    let key = NodeKey::generate().map_err(|e| e.to_string())?;
    let bridge = Bridge::start_with_key(
        BridgeConfig::new("127.0.0.1:0".parse().expect("loopback parses"))
            // Spelled out even though it is the default: the road under test.
            .with_relay(RelayChoice::N0Public),
        &key,
    )
    .await
    .map_err(|e| e.to_string())?;

    let started = Instant::now();
    let first = bridge.connect(remote).await.map_err(|e| e.to_string())?;
    drop(first);
    println!(
        "first connected stream in {} ms",
        started.elapsed().as_millis()
    );
    println!("paths: {}", paths_line(&bridge, remote).await);

    let mut ok = 0usize;
    let mut failures = 0usize;
    let mut sample = Vec::new();
    for index in 1..=ROUND_TRIPS {
        match round_trip(&bridge, remote).await {
            Ok((status, elapsed)) => {
                ok += 1;
                sample.push(elapsed);
                println!(
                    "round trip {index}: {status} in {} ms",
                    elapsed.as_millis()
                );
                if status != 401 {
                    return Err(format!(
                        "expected the door's empty 401, got {status} — the measurement is not measuring the door"
                    ));
                }
            }
            Err(sentence) => {
                failures += 1;
                println!("round trip {index}: failed — {sentence}");
            }
        }
    }
    if sample.is_empty() {
        return Err("no round trip succeeded".to_string());
    }
    let (min, median, p95) = summary(&sample);
    println!("round trips: ok={ok} failed={failures} min={min}ms median={median}ms p95={p95}ms");

    let held = Instant::now();
    while held.elapsed() < HOLD {
        tokio::time::sleep(SAMPLE).await;
        let at = held.elapsed().as_millis();
        let paths = paths_line(&bridge, remote).await;
        match round_trip(&bridge, remote).await {
            Ok((status, elapsed)) => println!(
                "hold +{at}ms: {status} in {} ms, paths: {paths}",
                elapsed.as_millis()
            ),
            Err(sentence) => println!("hold +{at}ms: failed — {sentence}, paths: {paths}"),
        }
    }
    Ok(())
}

#[tokio::main(flavor = "multi_thread")]
async fn main() {
    if let Err(sentence) = run().await {
        println!("dial failed: {sentence}");
        std::process::exit(1);
    }
}
