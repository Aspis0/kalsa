//! The real sidecar, through the real host, from the same funnel the app's
//! commands use. Both tests need Chrome and the Playwright driver on this computer,
//! and a sidecar built with `PLAYWRIGHT_SKIP_DRIVER_DOWNLOAD=1 cargo build -p
//! kalsa-browser`, so both are ignored by default. Run them with
//! `cargo test -p kalsa-brain browser::live -- --ignored`.
//!
//! Every address here is `127.0.0.1` over `http`. Nothing reaches the internet, and
//! no `mailto`, `tel` or custom scheme is opened.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::driver;
use super::error::BrowserError;
use super::host::Browser;

const CHAT: &str = "live-test-chat";
/// The unpacked driver on this computer, linked into the test's own app data.
const DRIVER_SOURCE: &str = "Library/Caches/playwright-rust/1.64.0/playwright-1.64.0-mac-arm64-node24.21.0";

const SHOP: &str = "<!doctype html><h1>the shop</h1>\
<form action=\"/order\" method=\"post\">\
<label for=\"city\">the city</label><input id=\"city\" name=\"city\" type=\"text\">\
<button type=\"submit\">buy it</button></form>";

/// Each request the fixture saw, as method, path and body, in the order they came.
type Seen = Arc<Mutex<Vec<(String, String, String)>>>;

/// Points the app's debug override at the sidecar built in this checkout, and puts
/// back what was set before when it is dropped.
struct DevSidecar(Vec<(&'static str, Option<OsString>)>);

impl DevSidecar {
    fn point_at_the_built_sidecar() -> Self {
        let program = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../target/debug/kalsa-browser"));
        let digest: String = Sha256::digest(std::fs::read(&program).expect("the sidecar is built"))
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let names = ["KALSA_BROWSER_SERVER_BIN", "KALSA_BROWSER_SERVER_SHA256"];
        let saved = names.iter().map(|name| (*name, std::env::var_os(name))).collect();
        std::env::set_var("KALSA_BROWSER_SERVER_BIN", &program);
        std::env::set_var("KALSA_BROWSER_SERVER_SHA256", digest);
        Self(saved)
    }
}

impl Drop for DevSidecar {
    fn drop(&mut self) {
        for (name, value) in &self.0 {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }
}

/// The app data folder for one test, with the driver linked where the app looks for
/// it. Removed by the test that made it.
fn app_data(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("kalsa-live-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let linked = driver::installed(&dir).expect("the driver's place");
    std::fs::create_dir_all(linked.parent().expect("a parent")).expect("the app data folder");
    let home = std::env::var("HOME").expect("a home folder");
    std::os::unix::fs::symlink(PathBuf::from(home).join(DRIVER_SOURCE), &linked).expect("the driver is linked");
    dir
}

/// A loopback server that serves one shop page and records every request it gets.
fn fixture() -> (String, Seen) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
    let base = format!("http://{}", listener.local_addr().expect("the port"));
    let seen = Seen::default();
    let log = seen.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let log = log.clone();
            std::thread::spawn(move || serve(stream, &log));
        }
    });
    (base, seen)
}

fn serve(stream: TcpStream, log: &Seen) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).unwrap_or(0) == 0 {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_owned();
    let path = parts.next().unwrap_or_default().to_owned();
    let mut length = 0;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).unwrap_or(0) == 0 || header == "\r\n" {
            break;
        }
        if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") {
            length = value.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0; length];
    let _ = reader.read_exact(&mut body);
    let body = String::from_utf8_lossy(&body).into_owned();
    log.lock().expect("the log is not poisoned").push((method.clone(), path.clone(), body));
    let (status, page) = match (method.as_str(), path.as_str()) {
        ("GET", "/") => ("200 OK", SHOP),
        ("POST", "/order") => ("200 OK", "<h1>thanks</h1>"),
        _ => ("404 Not Found", "<h1>not here</h1>"),
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
        page.len()
    );
    let _ = reader.get_mut().write_all(response.as_bytes());
}

fn posts(seen: &Seen) -> Vec<(String, String, String)> {
    seen.lock().expect("the log is not poisoned").iter().filter(|(method, _, _)| method == "POST").cloned().collect()
}

/// The `[eN]` ref on the first line of a read that mentions `words`.
fn ref_of(read: &str, words: &str) -> String {
    let line = read
        .lines()
        .find(|line| line.contains(words))
        .unwrap_or_else(|| panic!("no line with {words:?} in the read:\n{read}"));
    let start = line.find("[e").expect("the line carries a ref");
    let end = start + line[start..].find(']').expect("the ref is closed");
    line[start + 1..end].to_owned()
}

/// A call as the model's path makes it.
async fn call(browser: &Browser, app_data: &Path, tool: &str, args: Value) -> Result<String, BrowserError> {
    let args = args.as_object().cloned().expect("arguments are an object");
    browser.call(app_data, tool, args).await
}

/// A call as the person's path makes it: the answers and the list of what waits.
async fn person(browser: &Browser, app_data: &Path, tool: &str, args: Value) -> Result<String, BrowserError> {
    let args = args.as_object().cloned().expect("arguments are an object");
    browser.call_host(app_data, tool, args).await
}

/// **The host reaches the sidecar's own tools, and the sidecar's guard answers for
/// this computer's own network.** Passing this proves the calls from the app get to
/// the browser: the host-only tools answer with their words, and a model's `open` is
/// decided by the sidecar and not by the host's permission table.
#[tokio::test]
#[ignore = "needs Chrome, the Playwright driver and a built kalsa-browser: run with --ignored"]
async fn the_host_reaches_the_sidecars_own_tools_and_its_guard_answers() {
    let _dev = DevSidecar::point_at_the_built_sidecar();
    let app_data = app_data("reach");
    let (base, seen) = fixture();
    let browser = Browser::default();

    let waiting = person(&browser, &app_data, "browser_waiting", json!({})).await.expect("the host lists what waits");
    assert_eq!(waiting, "[]", "nothing is waiting yet");
    person(&browser, &app_data, "browser_pause", json!({})).await.expect("the pause is answered");
    // No page has been opened yet, so the sidecar has nothing to read back after a resume.
    let resumed = person(&browser, &app_data, "browser_resume", json!({})).await;
    assert_eq!(resumed.err().map(|refused| refused.code()), Some("browser.refused"), "the resume reached the sidecar, which has no page to read");

    let opened = call(&browser, &app_data, "browser_open", json!({"url": format!("{base}/"), "conversation": CHAT})).await;
    let refused = opened.err().expect("the sidecar's guard refuses this computer's own network");
    assert_eq!(refused.code(), "browser.refused");
    assert!(
        matches!(&refused, BrowserError::Refused { why: Some(words), .. } if !words.is_empty()),
        "and it says so to the host, which is what the model reads: {refused:?}"
    );
    assert!(seen.lock().expect("the log is not poisoned").is_empty(), "and nothing was asked of the fixture");

    browser.end();
    let _ = std::fs::remove_dir_all(&app_data);
}

/// **The write the model asks for is held, listed, and sent only when the person
/// confirms it.** Blocked for now: the sidecar's guard refuses `127.0.0.1`, which is
/// the only address this fixture can be on, and no test allowance exists in the
/// sidecar. Kept as the spec for that allowance.
#[tokio::test]
#[ignore = "blocked: the sidecar's guard refuses 127.0.0.1 and no test-only allowance exists yet"]
async fn the_real_sidecar_holds_a_write_until_the_person_confirms_it() {
    let _dev = DevSidecar::point_at_the_built_sidecar();
    let app_data = app_data("flow");
    let (base, seen) = fixture();
    let browser = Browser::default();

    call(&browser, &app_data, "browser_open", json!({"url": format!("{base}/"), "conversation": CHAT}))
        .await
        .expect("browser_open reached the browser and the page opened");
    let read = call(&browser, &app_data, "browser_read", json!({})).await.expect("the page reads");
    let city = ref_of(&read, "textbox \"the city\"");
    let buy = ref_of(&read, "button \"buy it\"");
    call(&browser, &app_data, "browser_type", json!({"ref": city, "text": "Bologna", "conversation": CHAT}))
        .await
        .expect("the field takes the text");

    let held = call(&browser, &app_data, "browser_click", json!({"ref": buy, "conversation": CHAT}))
        .await
        .expect("the click is answered");
    assert!(held.contains("awaiting confirm"), "the write is held, not sent: {held}");
    assert!(posts(&seen).is_empty(), "nothing reached the fixture while the write is held");

    let waiting = person(&browser, &app_data, "browser_waiting", json!({})).await.expect("the host lists what waits");
    let cards: Value = serde_json::from_str(&waiting).expect("a list of cards");
    let card = cards.as_array().and_then(|cards| cards.first()).expect("the held write is listed");
    assert_eq!(card["conversation"], CHAT);
    let id = card["id"].as_str().expect("a card id").to_owned();

    person(&browser, &app_data, "browser_pause", json!({})).await.expect("the pause is answered");
    assert!(
        call(&browser, &app_data, "browser_click", json!({"ref": buy, "conversation": CHAT})).await.is_err(),
        "a click while paused is refused"
    );
    person(&browser, &app_data, "browser_resume", json!({})).await.expect("the resume is answered");

    let answered = person(&browser, &app_data, "browser_confirm", json!({"id": id, "conversation": CHAT}))
        .await
        .expect("the confirm is answered");
    let outcome: Value = serde_json::from_str(&answered).expect("an outcome");
    assert_eq!(outcome["code"], "sent", "the confirmed write was sent: {answered}");
    assert_eq!(outcome["host"], "127.0.0.1");
    let sent = posts(&seen);
    assert_eq!(sent.len(), 1, "exactly one request went to the fixture");
    assert_eq!(sent[0].1, "/order");
    assert!(sent[0].2.contains("city=Bologna"), "with the text the person was shown: {}", sent[0].2);

    browser.end();
    let _ = std::fs::remove_dir_all(&app_data);
}
