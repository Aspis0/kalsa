//! The assistant's two web tools, as commands the page can call.
//!
//! The request goes out from here, in Rust, and never from the webview: the
//! page's content security policy admits `connect-src` to this machine only,
//! and a search engine is not a reason to widen it. `ureq` is already the
//! workspace's HTTP client (see `kalsa-download`).
//!
//! The blocking call runs on a background thread for the same reason the model
//! download does: the window has to keep drawing while the network is slow.
//! `Err` carries a sentence, which is what the page shows and what the model
//! reads as the tool's answer — a failed search must never end the turn.
//!
//! Stop reaches all the way in here. Each call is given an id by the page, and
//! `brain_web_stop` sets that call's flag; the crate checks it before every
//! request and between reads. What it cannot do is interrupt a socket already
//! waiting in a read — no HTTP client in this crate can be withdrawn mid-read —
//! so a stopped call ends at its next step, or when the read times out.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::State;

/// The web calls that are running, by the id the page gave them.
#[derive(Default)]
pub(crate) struct WebCalls(Mutex<HashMap<u64, Arc<AtomicBool>>>);

impl WebCalls {
    fn start(&self, id: u64) -> Arc<AtomicBool> {
        let stop = Arc::new(AtomicBool::new(false));
        if let Ok(mut calls) = self.0.lock() {
            calls.insert(id, Arc::clone(&stop));
        }
        stop
    }

    fn finish(&self, id: u64) {
        if let Ok(mut calls) = self.0.lock() {
            calls.remove(&id);
        }
    }

    fn stop(&self, id: u64) {
        if let Ok(mut calls) = self.0.lock() {
            if let Some(flag) = calls.remove(&id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }
}

/// Search the web for `query` and return what the model will read.
#[tauri::command]
pub(crate) async fn brain_web_search(
    id: u64,
    query: String,
    calls: State<'_, WebCalls>,
) -> Result<String, String> {
    let stop = calls.start(id);
    let outcome =
        tauri::async_runtime::spawn_blocking(move || kalsa_web::search(&query, &stop)).await;
    calls.finish(id);
    match outcome {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("The search did not finish. Trying again usually works.".to_string()),
    }
}

/// Open one page and return the text on it. The address gate lives in
/// `kalsa-web`: loopback, private and inward-resolving addresses are refused
/// before the request.
#[tauri::command]
pub(crate) async fn brain_web_fetch(
    id: u64,
    url: String,
    calls: State<'_, WebCalls>,
) -> Result<String, String> {
    let stop = calls.start(id);
    let outcome = tauri::async_runtime::spawn_blocking(move || kalsa_web::fetch(&url, &stop)).await;
    calls.finish(id);
    match outcome {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("The page did not finish loading. Trying again usually works.".to_string()),
    }
}

/// Stop a web call the page is no longer waiting for.
#[tauri::command]
pub(crate) fn brain_web_stop(id: u64, calls: State<WebCalls>) {
    calls.stop(id);
}
