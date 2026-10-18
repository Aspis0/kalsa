//! A site of our own to serve, a browser to serve it to, and a record of what
//! actually arrived. Shared by the tests that need a real window.
// Each test file uses a different part of this, so the unused half of it is expected.
#![allow(dead_code)]

use kalsa_browser::{find_browser, guard, launch};
use playwright_rs::protocol::{BrowserContext, Page, Playwright};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// One thing the site serves.
pub struct File {
    path: &'static str,
    status: &'static str,
    headers: String,
    body: String,
    delay: Duration,
}

fn file(path: &'static str, kind: &str, body: &str) -> File {
    File {
        path,
        status: "200 OK",
        headers: format!("Content-Type: {kind}"),
        body: body.to_string(),
        delay: Duration::ZERO,
    }
}

pub fn page(body: &str) -> File {
    file("/", "text/html; charset=utf-8", body)
}

pub fn script(body: &str) -> File {
    file("/worker.js", "text/javascript; charset=utf-8", body)
}

/// A file the browser is meant to save. The header is what makes it a download
/// rather than another page.
pub fn download(body: &str) -> File {
    let mut this = file("/file.txt", "text/plain; charset=utf-8", body);
    this.headers = "Content-Type: text/plain; charset=utf-8\r\nContent-Disposition: attachment; filename=\"file.txt\""
        .to_string();
    this
}

/// A redirect, given the address it sends the browser to.
pub fn redirect_to(where_to: &str) -> File {
    File {
        path: "/go",
        status: "302 Found",
        headers: format!("Location: {where_to}"),
        body: String::new(),
        delay: Duration::ZERO,
    }
}

/// A redirect to another path on this same site. The browser resolves it against
/// the origin it is already on, which is how a refusal can be proved against a
/// listener that is listening: the second hop is a real address we control.
pub fn redirect_here(path: &str) -> File {
    redirect_to(path)
}

impl File {
    /// Answer this one late, so a window can be closed while a call waits on it.
    pub fn slow(mut self, wait: Duration) -> File {
        self.delay = wait;
        self
    }
}

/// Every request that reached the site, and how many tried to become a socket.
///
/// A proof that something was refused is worth nothing without this: it is the
/// difference between "the page showed an error" and "nothing ever arrived".
#[derive(Clone, Default)]
pub struct Arrived {
    lines: Arc<Mutex<Vec<String>>>,
    handshakes: Arc<Mutex<usize>>,
}

impl Arrived {
    /// The first line of every request, which is the method and the path.
    pub fn requests(&self) -> Vec<String> {
        self.lines.lock().expect("not poisoned").clone()
    }

    /// Whether a request line names this path. The line is `METHOD PATH VERSION`,
    /// so the path is the second word and nothing else.
    pub fn asked_for(&self, path: &str) -> bool {
        self.requests().iter().any(|line| line.split_whitespace().nth(1) == Some(path))
    }

    pub fn handshakes(&self) -> usize {
        *self.handshakes.lock().expect("not poisoned")
    }
}

/// Serve these files on loopback, and return the address and the record. Bound
/// to a port the operating system picked, so two tests never collide.
pub async fn serve(files: &[File]) -> (String, Arrived) {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("a loopback port");
    let port = listener.local_addr().expect("an address").port();
    let owned: Vec<(String, String, String, String, Duration)> = files
        .iter()
        .map(|one| {
            (
                one.path.to_string(),
                one.status.to_string(),
                one.headers.clone(),
                one.body.clone(),
                one.delay,
            )
        })
        .collect();
    let arrived = Arrived::default();
    let seen = arrived.clone();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let owned = owned.clone();
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut head = Vec::new();
                let mut chunk = [0_u8; 1024];
                loop {
                    match socket.read(&mut chunk).await {
                        Ok(0) | Err(_) => return,
                        Ok(read) => {
                            head.extend_from_slice(&chunk[..read]);
                            if head.windows(4).any(|w| w == b"\r\n\r\n") || head.len() > 16 * 1024 {
                                break;
                            }
                        }
                    }
                }
                let ask = String::from_utf8_lossy(&head).into_owned();
                if ask.to_lowercase().contains("upgrade: websocket") {
                    *seen.handshakes.lock().expect("not poisoned") += 1;
                }
                seen.lines.lock().expect("not poisoned").push(ask.lines().next().unwrap_or_default().to_string());
                let path = ask.split_whitespace().nth(1).unwrap_or("/").to_string();
                let hit = owned.iter().find(|one| one.0 == path).cloned();
                let response = match hit {
                    Some((_, status, headers, body, delay)) => {
                        if !delay.is_zero() {
                            tokio::time::sleep(delay).await;
                        }
                        format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\n{headers}\r\n\r\n{body}", body.len())
                    }
                    None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_string(),
                };
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.flush().await;
            });
        }
    });
    (format!("http://127.0.0.1:{port}"), arrived)
}

/// A real `Sessions` with the fixture's address opened.
///
/// The tests that drive a session need the same opening a browser window gets,
/// and they need it at page level: a page route is consulted before a context
/// route, so this opens the one address the server is on and hands everything
/// else back to the product guard, without a test-only switch in the crate.
pub async fn sessions_on(name: &str, base: &str) -> (kalsa_browser::session::Sessions, Page) {
    let sessions = kalsa_browser::session::Sessions::new(profile(name));
    let page = sessions.page().await.expect("the installed browser starts");
    let base = base.to_string();
    page.route("**/*", move |route| {
        let base = base.clone();
        async move {
            if route.request().url().starts_with(&base) {
                route.continue_(None).await
            } else {
                route.fallback(None).await
            }
        }
    })
    .await
    .expect("the test route is installed");
    (sessions, page)
}

/// A profile directory of our own, thrown away at the end of the test.
pub fn profile(name: &str) -> String {
    let dir = std::env::temp_dir().join(format!("kalsa-browser-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a profile directory is writable");
    dir.to_string_lossy().into_owned()
}

/// The browser, our rules installed, and the one address the tests may reach.
///
/// The product guard refuses loopback, which is the very thing these tests need
/// to watch being refused, so serving a fixture needs an origin the guard allows.
/// The route below is registered after the guard's and hands everything else back
/// to it, so the guard still decides everything it would have decided: this opens
/// the one address the server is on and nothing else.
///
/// The `Playwright` handle is returned and must be held for as long as the page
/// is used: dropping it shuts the driver down.
pub async fn browser_on(name: &str, base: &str) -> (Playwright, BrowserContext, Page) {
    browser_allowing(name, base, "").await
}

/// A window where the test opens only `allowed` — a path on the fixture, or
/// nothing at all, which opens the whole fixture.
///
/// Everything else is put to **the product's own decision**, not to a second
/// copy of the rules and not to a hand-rolled abort: `guard::decide` says allow
/// or refuse, and the refusal aborts. That is what makes the proof worth
/// something — the listener is one the browser really was about to reach, and
/// the decision about it really was the product's.
///
/// Why the test route does not use `fallback` to hand the request back to the
/// guard that `launch::start` installed: `fallback` tells the driver to continue
/// to the next handler, which means the request is already on its way to the
/// network before our abort is sent. The refusal still happens; it happens too
/// late to stop anything. The tests that prove the guard's own route is wired in
/// are the ones with no test route on top of it at all.
pub async fn browser_allowing(name: &str, base: &str, allowed: &str) -> (Playwright, BrowserContext, Page) {
    let (playwright, context, page) = launch::start(&profile(name)).await.expect("the installed browser starts");
    let base = base.to_string();
    let allowed = allowed.to_string();
    context
        .route("**/*", move |route| {
            let (base, allowed) = (base.clone(), allowed.clone());
            async move {
                let request = route.request();
                let url = request.url();
                let opened_by_the_test = url.starts_with(&base) && (allowed.is_empty() || url.contains(&allowed));
                let permitted = if opened_by_the_test {
                    true
                } else {
                    matches!(guard::decide(url).await, guard::Verdict::Allow)
                };
                if permitted {
                    route.continue_(None).await
                } else {
                    route.abort(Some("blockedbyclient")).await
                }
            }
        })
        .await
        .expect("the test route is installed");
    (playwright, context, page)
}

/// Every file under a directory, by path. Used to see what a download left.
pub fn file_list(dir: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(dir)];
    while let Some(here) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&here) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path.clone());
            }
            found.push(path.to_string_lossy().into_owned());
        }
    }
    found.sort();
    found
}

/// A second window on the same fixture, built the way nothing is built in the
/// product: no service-worker block, no download refusal, no guard.
///
/// A proof that a setting changed something is worth nothing without this: the
/// two windows must disagree, or the test would pass on a page that never worked
/// either way.
pub async fn browser_without_our_rules() -> (Playwright, BrowserContext, Page) {
    let executable = find_browser::installed().await.expect("the installed browser");
    let playwright = Playwright::launch().await.expect("the driver starts");
    // The installed browser and a visible window, so this differs from ours in
    // the rules and in nothing else. Left on Playwright's default it would ask
    // for its own Chromium, which is not on this computer and must not be.
    let mut options = playwright_rs::protocol::BrowserContextOptions::default();
    options.headless = Some(false);
    options.executable_path = Some(executable);
    let context = playwright
        .chromium()
        .launch_persistent_context_with_options(profile("without-our-rules"), options)
        .await
        .expect("a context");
    let page = context.new_page().await.expect("a page");
    (playwright, context, page)
}

/// How many service workers the page's origin has registered.
pub async fn registrations(page: &Page) -> usize {
    page.evaluate::<(), usize>("async () => (await navigator.serviceWorker.getRegistrations()).length", None)
        .await
        .expect("the page answers")
}

/// Everything under a directory with this name, written since `since`.
///
/// A browser writes its own profile files — history, caches, sessions — into a
/// profile it is using, so counting every new file would prove nothing. What a
/// refused download must not leave is the file it was refused.
pub fn files_named(dir: &str, name: &str, since: std::time::SystemTime) -> Vec<String> {
    let mut found = Vec::new();
    let mut stack = vec![std::path::PathBuf::from(dir)];
    while let Some(here) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&here) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Ok(written) = entry.metadata().and_then(|meta| meta.modified()) else {
                continue;
            };
            let wanted = path.file_name().is_some_and(|file| file == name);
            if wanted && written >= since {
                found.push(path.to_string_lossy().into_owned());
            }
        }
    }
    found
}

/// The node processes this one started. Used to kill the driver outright rather
/// than to ask politely, which is what a crash looks like from here.
pub fn driver_children() -> Vec<i32> {
    let listing = std::process::Command::new("pgrep").arg("-P").arg(std::process::id().to_string()).output();
    let Ok(listing) = listing else {
        return Vec::new();
    };
    String::from_utf8_lossy(&listing.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<i32>().ok())
        .filter(|pid| *pid != std::process::id() as i32)
        .collect()
}