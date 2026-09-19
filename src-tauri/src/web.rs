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

/// Open an address in this computer's browser, after checking it with the gate
/// `web_fetch` uses.
///
/// The page asks for this instead of carrying an `href`. A Tauri webview does
/// not reach the system browser on its own, and the grant that would let it —
/// an opener or shell permission — would let the page hand an arbitrary string
/// to the operating system. These addresses come from arguments a model
/// invented, so the answer is not "trust the page to have checked": it is a
/// command that checks, here, every time, and only then hands the address over.
#[tauri::command]
pub(crate) fn brain_open_url(url: String) -> Result<(), String> {
    open_checked(&url)
}

/// The check and the hand-off, apart from the command so that the refusal can
/// be tested without opening anything. **Only refused addresses belong in a
/// test**: anything that gets past the gate really does reach the browser.
fn open_checked(url: &str) -> Result<(), String> {
    kalsa_web::openable(url).map_err(|error| error.to_string())?;
    open_in_browser(url).map_err(|_| {
        "That address could not be opened. This computer may have nothing set up to open links."
            .to_string()
    })
}

/// Hand the address to whatever this computer opens http(s) links with.
///
/// No shell is involved, so the address is one argument and cannot become part
/// of a command line. The child is reaped on its own thread: `open` returns at
/// once, but a click must not wait for a browser, and a dropped child would
/// stay a zombie for as long as the app lives. The Windows launcher is the one
/// path here that this session could not try.
fn open_in_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let opener = "xdg-open";

    let child = std::process::Command::new(opener)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()?;
    std::thread::spawn(move || {
        let mut child = child;
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::open_checked;

    /// What the page may ask to open, and what it may not. Every address here
    /// is refused before anything is spawned, so this test opens nothing.
    #[test]
    fn an_address_the_gate_refuses_never_reaches_the_system() {
        for address in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "data:text/html,<h1>hi</h1>",
            "http://127.0.0.1:8130/v1/models",
            "http://localhost:8130/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]:8130/",
            "http://foo.127.0.0.1.nip.io:8130/",
        ] {
            match open_checked(address) {
                Err(said) => assert!(
                    said.contains("not a public web page"),
                    "{address} was refused, but not in the gate's words: {said}"
                ),
                Ok(()) => panic!("{address} was handed to this computer's browser"),
            }
        }
    }
}
