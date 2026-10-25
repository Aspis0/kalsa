//! One tool call from the command line, against the real network.
//!
//!     cargo run -p kalsa-web --example tool -- search "query"
//!     cargo run -p kalsa-web --example tool -- fetch https://example.com/
//!
//! It exists so a live check can reach the same functions the Tauri commands
//! call, without a window: `brain_web_search`/`brain_web_fetch` in
//! `src-tauri/src/web.rs` are three lines around these. One JSON object goes
//! to stdout — `{"ok":true,"text":"…"}` or `{"ok":false,"error":"…"}` — which
//! is exactly what the page shows and what the model reads.
//!
//! `--stop-after <ms>` sets the crate's stop flag while the call is in flight,
//! which is how the cooperative stop is exercised without a page to press Stop.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

fn main() {
    let mut args = std::env::args().skip(1);
    let verb = args.next().unwrap_or_default();
    let mut argument = String::new();
    let mut stop_after: Option<u64> = None;
    while let Some(next) = args.next() {
        match next.as_str() {
            "--stop-after" => stop_after = args.next().and_then(|value| value.parse().ok()),
            _ => argument = next,
        }
    }

    let stop = Arc::new(AtomicBool::new(false));
    if let Some(ms) = stop_after {
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(ms));
            stop.store(true, Ordering::Relaxed);
        });
    }

    let outcome = match verb.as_str() {
        "search" => kalsa_web::search(&argument, &stop),
        "fetch" => kalsa_web::fetch(&argument, &stop),
        other => {
            let json = serde_json::json!({ "ok": false, "error": format!("unknown verb: {other}") });
            println!("{json}");
            std::process::exit(2);
        }
    };

    let json = match outcome {
        Ok(text) => serde_json::json!({ "ok": true, "text": text }),
        Err(error) => serde_json::json!({ "ok": false, "error": error.to_string() }),
    };
    println!("{json}");
}
