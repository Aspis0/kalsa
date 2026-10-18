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

/// A page at a path of its own, for a proof that a navigation lands **there**
/// rather than merely leaving.
pub fn page_at(path: &'static str, body: &str) -> File {
    file(path, "text/html; charset=utf-8", body)
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
    bodies: Arc<Mutex<Vec<String>>>,
    handshakes: Arc<Mutex<usize>>,
}

/// One request as the server saw it: the request line, and what came with it.
///
/// **The body is recorded because a request line is not a request.** "POST
/// /login arrived" and "POST /login arrived with this person's actual password"
/// are different claims, and the whole invariant under test is about the second
/// one.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Received {
    pub line: String,
    pub body: String,
}

impl Arrived {
    /// The first line of every request, which is the method and the path.
    pub fn requests(&self) -> Vec<String> {
        self.lines.lock().expect("not poisoned").clone()
    }

    /// Every request with its body, in the order it arrived.
    pub fn received(&self) -> Vec<Received> {
        let lines = self.lines.lock().expect("not poisoned").clone();
        let bodies = self.bodies.lock().expect("not poisoned").clone();
        lines.into_iter().zip(bodies).map(|(line, body)| Received { line, body }).collect()
    }

    /// What the server received at one path, body and all.
    pub fn body_of(&self, path: &str) -> Option<String> {
        self.received().into_iter().find(|one| one.line.split_whitespace().nth(1) == Some(path)).map(|one| one.body)
    }

    /// Whether a request line names this path. The line is `METHOD PATH VERSION`,
    /// so the path is the second word and nothing else.
    pub fn asked_for(&self, path: &str) -> bool {
        self.requests().iter().any(|line| line.split_whitespace().nth(1) == Some(path))
    }

    /// Every request but the browser's own icon fetches.
    ///
    /// **Chromium asks for a tab's `/favicon.ico` on a schedule of its own**, from
    /// no navigation the test made and at no point the test chose, and it does so
    /// whether or not the fixture serves one. A count taken over every arrival is
    /// therefore a count of the browser's timing as much as of the test's, which
    /// is how this file once lost a run to a tab that had not finished asking.
    /// The request line's second word is the path, and this is every line whose
    /// path is not that one.
    pub fn except_icons(&self) -> Vec<String> {
        self.requests()
            .into_iter()
            .filter(|line| line.split_whitespace().nth(1) != Some("/favicon.ico"))
            .collect()
    }

    pub fn handshakes(&self) -> usize {
        *self.handshakes.lock().expect("not poisoned")
    }
}

/// Serve these files on loopback, and return the address and the record. Bound
/// to a port the operating system picked, so two tests never collide.
pub async fn serve(files: &[File]) -> (String, Arrived) {
    serve_on("127.0.0.1", files).await
}

/// **The same fixture, reachable under another name.** Bound to every local
/// address rather than to `127.0.0.1`, so the one server answers on the whole of
/// `127.0.0.0/8` — which is what makes it the honest way to serve a **second
/// site**: same machine, same process, a different host name, and therefore a
/// different site to anything that decides by registrable domain. (Binding
/// `127.0.0.2` outright is refused on this platform; the whole range is only
/// reachable through a wildcard bind.)
pub async fn serve_on(address: &str, files: &[File]) -> (String, Arrived) {
    let listener = TcpListener::bind(format!("{address}:0")).await.expect("a loopback port");
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
                // **Read the body, not just the headers.** A POST arrives in two
                // pieces and stopping at the blank line threw the second away, so
                // every record here was a request line and nothing about what was
                // sent. That was invisible while the proofs only asked "did a
                // request arrive"; the moment one asks what it carried, the
                // fixture has to be the one that answers.
                let mut header_end = 0_usize;
                let mut wanted = 0_usize;
                loop {
                    if header_end == 0 {
                        if let Some(at) = head.windows(4).position(|w| w == b"\r\n\r\n") {
                            header_end = at + 4;
                            let ask = String::from_utf8_lossy(&head[..header_end]).into_owned();
                            wanted = ask
                                .split("\r\n")
                                .find_map(|line| {
                                    let (name, value) = line.split_once(':')?;
                                    let count = value.trim().parse::<usize>().ok()?;
                                    name.trim().eq_ignore_ascii_case("content-length").then_some(count)
                                })
                                .unwrap_or(0);
                        }
                    }
                    if header_end > 0 && head.len() >= header_end + wanted {
                        break;
                    }
                    match socket.read(&mut chunk).await {
                        Ok(0) | Err(_) => break,
                        Ok(read) => head.extend_from_slice(&chunk[..read]),
                    }
                    if head.len() > 64 * 1024 {
                        break;
                    }
                }
                let ask = String::from_utf8_lossy(&head).into_owned();
                if ask.to_lowercase().contains("upgrade: websocket") {
                    *seen.handshakes.lock().expect("not poisoned") += 1;
                }
                seen.lines.lock().expect("not poisoned").push(ask.lines().next().unwrap_or_default().to_string());
                let body = if header_end > 0 && head.len() >= header_end + wanted {
                    String::from_utf8_lossy(&head[header_end..header_end + wanted]).into_owned()
                } else {
                    String::new()
                };
                seen.bodies.lock().expect("not poisoned").push(body);
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
                // The socket is closed when this task ends, and a browser reads a
                // connection closing mid-response as a truncated one: it commits
                // `chrome-error://chromewebdata/` for the navigation and the test
                // would be blaming the sidecar for the fixture's manners. Saying
                // `Connection: close` makes the close the thing we meant.
                let _ = socket.shutdown().await;
            });
        }
    });
    (format!("http://{address}:{port}"), arrived)
}

/// A real `Sessions` with the fixture's address opened.
///
/// The tests that drive a session need the same opening a browser window gets,
/// and they need it at page level: a page route is consulted before a context
/// route, so this opens the one address the server is on and hands everything
/// else back to the product guard, without a test-only switch in the crate.
pub async fn sessions_on(name: &str, base: &str) -> (kalsa_browser::session::Sessions, Page) {
    let (sessions, page, _landings) = sessions_watching(name, base).await;
    (sessions, page)
}

/// The same window with the store of answers handed back, for the tests that
/// read one — they are the only ones that need to know what the browser actually
/// recorded.
pub async fn sessions_watching(
    name: &str,
    base: &str,
) -> (kalsa_browser::session::Sessions, Page, kalsa_browser::landing::Landings) {
    // **Held for as long as the window is.** The guard removes the profile when it
    // drops, and dropping it at the end of this line would delete the directory
    // Chrome is running in.
    let profile = profile(name);
    let sessions = kalsa_browser::session::Sessions::new(profile.path());
    let (page, landings, _holds) = sessions.page().await.expect("the installed browser starts");
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
    (sessions, page, landings)
}

/// A window for the proofs about a write: the fixture is served, and a write to
/// it is held by **the product's own hold**.
///
/// The fixture is on this computer's own network, which the guard refuses by
/// address before it ever reaches a hold, so this route stands in for the
/// address decision and for nothing else — the same bargain
/// `browser_allowing` makes. Everything about what a held request *is* is the
/// product's: the submission catcher is installed by `launch::start` itself, and
/// the route below holds a write the page made by itself exactly as the guard
/// does, including the one-shot ticket for the write the person just answered.
/// **The one address decision a test stands in for.** The fixture is on this
/// computer's own network, which the guard refuses before a write is ever held,
/// so the rules themselves are exercised everywhere else and this is the only
/// thing a test replaces — the same bargain `browser_allowing` makes for the
/// route.
pub fn the_fixture(
    _url: &str,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = kalsa_browser::guard::Verdict> + Send + '_>> {
    Box::pin(async { kalsa_browser::guard::Verdict::Allow })
}

/// The chat every test drives its window from, and answers in. **A window is
/// bound to one conversation**, and a card raised by another is not this one's
/// to press, so a test that answered in another would be testing nothing.
pub const CHAT: &str = "chat-a";

pub async fn confirming_window(name: &str, base: &str) -> (kalsa_browser::session::Sessions, Page, kalsa_browser::hold::Holds) {
    confirming_window_for(name, base, None).await
}

/// **The same window, answering for a second site.** Two origins, one route, and
/// the same bargain as [`confirming_window`]: the fixture stands in for the
/// address decision — this computer's own network is refused by the guard before
/// a hold is ever reached — and for nothing else, so a pause, a secret and a
/// write are all decided by the product's own predicates.
///
/// This is what a proof about **two sites** needs. There is no address a browser
/// can reach from a test that the guard would allow and that is not this
/// computer's own network, and a name is refused before DNS is even asked.
/// **No browser proof may name a scheme this machine has an app for.**
///
/// A `mailto:` or a `tel:` in a fixture is one keystroke away from handing a
/// person's address to their mail client: Chromium routes an external protocol
/// to the operating system before anything becomes a network request, so no
/// route here can stop it, and the only thing that does is the check in
/// `input.rs` — which is exactly what a proof is for breaking. It has: an Enter
/// key reached the browser with a `mailto:` `formaction` on an image button, and
/// a compose window opened on the machine running the tests, on every run, until
/// dozens were open at once and the machine stopped responding.
///
/// The rule being proved is about the **class** — anything that is not http,
/// https or relative — so `kalsaprobe://` and `kalsaprobe-call:` prove the same
/// thing and hand nothing to anyone. This reads the test files themselves
/// rather than a list somebody has to remember to update, so a fixture cannot
/// quietly reintroduce one.
#[test]
fn no_browser_fixture_names_a_scheme_the_operating_system_handles() {
    // **Every file under `tests/`, recursively, read at the moment the suite
    // runs.** A hardcoded list is a list to forget: it left out the files added
    // since it was written and it never saw `common/` itself, which is where a
    // shared fixture would live. A fixture dropped in a subdirectory is a fixture
    // nobody reads the listing of, so the directory is walked rather than listed,
    // and a new file is covered the day it is written.
    let root = std::path::Path::new("tests");
    let mut read = 0_usize;
    let mut files = Vec::new();
    for path in rust_files(root) {
        let source = std::fs::read_to_string(&path).expect("a test file is readable");
        read += 1;
        files.push(path.clone());
        let flat = flatten(&source);
        for shape in SHAPES_HANDS_OVER.iter().chain(SCHEMES_HANDS_OVER) {
            let found = first_handed_over(&flat, shape);
            assert!(
                found.is_none(),
                "{} puts {} in {shape}, which a browser will follow; use kalsaprobe://",
                path.display(),
                found.unwrap_or_default()
            );
        }
    }
    assert!(read >= 8, "only {read} test files were read, so the sweep is not seeing the suite");
    // **And it goes below `tests/`.** A count is no proof of that — the ten files
    // sitting in `tests/` alone are already past the number above — and a fixture
    // dropped in `common/` is exactly the shared one nobody re-reads. So the walk
    // is checked against a file that is *only* reachable by descending.
    let descended = files.iter().filter(|path| path.parent().is_some_and(|dir| dir.ends_with("common")));
    assert!(descended.count() > 0, "the sweep never read anything under a subdirectory of tests/: {files:?}");
}

/// **Every `.rs` file under a directory, however deep.** `read_dir` on `tests/`
/// alone never saw `common/`, which is where a shared fixture lives and where this
/// file puts its own.
fn rust_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let mut queue = vec![root.to_path_buf()];
    while let Some(dir) = queue.pop() {
        let entries = std::fs::read_dir(&dir).unwrap_or_else(|error| panic!("{} is readable: {error}", dir.display()));
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                queue.push(path);
            } else if path.extension().is_some_and(|one| one == "rs") {
                out.push(path);
            }
        }
    }
    out.sort();
    out
}

/// **The file's own text, comments dropped and every run of whitespace folded to
/// one space.** This is what makes the shapes match across lines: an attribute
/// written as `href =\n  "mailto:…"` is two lines in the file and one shape here,
/// and matching line by line is what let that shape through.
fn flatten(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    for line in source.lines() {
        let line = line.trim_start();
        // A scheme in a comment is the code talking about one, which is where a
        // real one belongs: nothing there ever reaches a browser.
        if line.starts_with("//") {
            continue;
        }
        for word in line.split_whitespace() {
            out.push_str(word);
            out.push(' ');
        }
    }
    out
}

/// The spellings that put a destination in a page, each ending **immediately
/// before the value**. The value is then read properly — quoted or not, with any
/// amount of space in between — so `href="mailto:…"`, `href = "mailto:…"` and
/// `href\n=\n'mailto:…'` are one shape, and a `mailto:` a page merely mentions
/// further along the line is not mistaken for this attribute's value.
const SHAPES_HANDS_OVER: &[&str] = &["href", "action", "formaction"];

/// **The ways a page hands an address to the browser without an attribute.**
/// `window.open` has no `=`, so the shape list would never see it, and a `href`
/// assignment on `location` is covered by `href=` above.
const SCHEMES_HANDS_OVER: &[&str] = &["window.open(", "location.assign(", "location.replace("];

/// The schemes the operating system answers for, in one list, so the matcher and
/// the message cannot disagree.
const HANDED_OVER: &[&str] = &["mailto:", "tel:", "sms:", "facetime:", "zoommtg:", "itms-apps:", "webcal:", "im:", "msteams:", "slack:", "tg:"];

/// **The matcher has teeth, in every shape the sweep claims to cover.** A
/// tripwire that cannot be shown to bite is a comment. Every source here is
/// **built from pieces**, and that is not cleverness: a source written out in full
/// would be exactly what this sweep forbids in a file under `tests/` — the file
/// that holds the proof would be the first thing it flagged. The pieces are the
/// attribute name and the scheme, each harmless on its own.
#[test]
fn the_fixture_sweep_finds_every_shape_and_nothing_else() {
    let caught = [
        attribute("href", MAIL, '"'),
        // **An attribute split across lines, spaced and single-quoted.** Matching
        // one line at a time is what let this through.
        format!("<a\n  href \n  = \n  '{MAIL}'\n  title='x'>write</a>"),
        attribute("action", PHONE, '"'),
        attribute("formaction", MEET, '"'),
        // `xlink:href` is covered by `href`, and this says so.
        format!("<a xlink:href='{MEIL}'>write</a>"),
        // **A call, which has no `=` for the attribute list to find.**
        format!("window.open('{MAIL}');"),
        format!("location.assign(\"{PHONE}\");"),
        format!("location.replace('{CALENDAR}')"),
        // A `location` assignment is an `href` with a dot in front of it.
        format!("location.href = \"{MEIL}\";"),
    ];
    for source in caught {
        assert!(shapes(&source).is_some(), "the sweep would let this through: {source}");
    }

    // **And the near misses**, which are what a matcher this eager gets wrong.
    let spared = [
        // The scheme is mentioned by this element, but it is not this
        // attribute's value — and the browser would follow `/next`.
        format!("<a href=\"/next\" title=\"see the {MEIL} docs\">next</a>"),
        // A comment, which is where a real one belongs: nothing in a comment ever
        // reaches a browser.
        format!("// <a href=\"{MEIL}\">"),
        format!("/// href=\"{MEIL}\""),
        // A list of addresses the code under test is asked about, never opened.
        format!("\"{MEIL}\","),
        // The class, with a scheme no machine has a handler for.
        "<a href=\"kalsaprobe://shop\">shop</a>".to_owned(),
    ];
    for source in spared {
        assert!(shapes(&source).is_none(), "the sweep flagged something harmless: {source}");
    }
}

/// An address in an attribute, spelled the way a page spells it.
fn attribute(name: &str, value: &str, quote: char) -> String {
    format!("<a {name}={quote}{value}{quote}>write</a>")
}

/// The schemes, in pieces. **Each is harmless on its own** — a bare address in a
/// list is where a real one belongs, and nothing here sits in an attribute.
const MAIL: &str = "mailto:giulia@example.com";
const PHONE: &str = "tel:+390000000000";
const MEET: &str = "zoommtg://shop";
const CALENDAR: &str = "webcal://shop";
const MEIL: &str = "sms:+390000000000";

/// The first `(shape, scheme)` the sweep would find in a source, read the way it
/// reads every file in `tests/`.
fn shapes(source: &str) -> Option<(&'static str, String)> {
    let flat = flatten(source);
    SHAPES_HANDS_OVER
        .iter()
        .chain(SCHEMES_HANDS_OVER)
        .find_map(|shape| first_handed_over(&flat, shape).map(|scheme| (*shape, scheme)))
}

/// The scheme at the first value this shape reaches, if it is one the operating
/// system answers for. Nothing else counts: only the value that the browser would
/// actually follow.
fn first_handed_over(flat: &str, shape: &str) -> Option<String> {
    for (at, _) in flat.match_indices(shape) {
        // **The value, properly.** The shape has already taken the attribute name
        // or the call; what follows is an `=` that may be separated from it by
        // nothing, a space, or a line break, and then the value — whose quote may
        // or may not be there. Nothing between here and the value can be confused
        // with the value.
        let after = flat[at + shape.len()..].trim_start();
        let after = after.strip_prefix('=').map_or(after, |rest| rest.trim_start());
        let value = match after.chars().next() {
            Some(quote @ ('"' | '\'')) => {
                let body = &after[quote.len_utf8()..];
                match body.split(quote).next() {
                    Some(body) if !body.is_empty() => body,
                    _ => continue,
                }
            }
            _ => after.split(' ').next().unwrap_or_default(),
        };
        for scheme in HANDED_OVER {
            if value.starts_with(scheme) {
                return Some(scheme.to_string());
            }
        }
    }
    None
}

pub async fn confirming_window_for(
    name: &str,
    base: &str,
    second: Option<&str>,
) -> (kalsa_browser::session::Sessions, Page, kalsa_browser::hold::Holds) {
    let profile = profile(name);
    let sessions = kalsa_browser::session::Sessions::new(profile.path());
    let (page, _landings, holds) = sessions.page().await.expect("the installed browser starts");
    // A window is bound to the chat driving it, and every card it raises carries
    // that: these tests answer in the same conversation they drove from.
    holds.navigated_by(CHAT).await;
    let served = base.to_string();
    let also = second.unwrap_or_default().to_string();
    let holding = holds.clone();
    page.route("**/*", move |route| {
        let (base, holding, also) = (served.clone(), holding.clone(), also.clone());
        async move {
            let request = route.request();
            let url = request.url();
            // **Which of this window's sites is asking.** There is one, or two
            // for the proofs that need a second one; anything else belongs to the
            // guard's own route, and this route steps aside for it.
            let one_of_ours = url.starts_with(&base) || (!also.is_empty() && url.starts_with(&also));
            if !one_of_ours {
                return route.fallback(None).await;
            }
            // **The product's own decisions, all of them except the address one.**
            // A stand-in that reads is-read-and-therefore-fine would pass a proof
            // the product fails: a GET carrying a secret is held, and a paused
            // window holds the page's own writes. The pause is asked with the
            // product's own predicate, not a copy of it.
            let typed = holding.typed().await.values();
            // **The pause is asked with the product's own predicate**, not a copy
            // of it: a fixture that answered "yes while paused" would let every
            // paused proof pass against a rule the route no longer keeps.
            if holding.takes_pass(&request).await || guard::the_persons_paused_navigation(holding.paused(), &request, &typed)
            {
                return route.continue_(None).await;
            }
            if kalsa_browser::hold::is_read(request.method())
                && !kalsa_browser::secret::carries(request.url(), &typed)
            {
                return route.continue_(None).await;
            }
            kalsa_browser::hold::hold_write(&holding, &request, route).await
        }
    })
    .await
    .expect("the test route is installed");
    page.goto(base, None).await.expect("the fixture loads");
    (sessions, page, holds)
}

/// The prefix every profile of ours is named with, and the only thing the sweep
/// will delete.
const PROFILE_PREFIX: &str = "kalsa-browser-test-";

/// **A profile directory of our own, removed when the test that made it ends.**
///
/// This used to be a `String`, removed only on the way *in*, so every run left a
/// Chrome profile in the temporary directory — a run that took a dozen tests left
/// a dozen megabytes nobody would ever collect. The directory is now owned by a
/// value: it goes when the value does, which is when the test's own locals go.
///
/// **It has to be held.** A guard that dropped at the end of the statement that
/// made it would delete the directory Chrome was running in, so every caller
/// binds it: `let profile = profile("name");` and passes `&profile`.
#[derive(Debug)]
pub struct Profile(String);

impl Profile {
    /// The path, as a copy, for the APIs that take an owned `String`. **The guard
    /// still owns the directory**: handing a copy out is not handing it away, and
    /// the directory goes when this value does.
    pub fn path(&self) -> String {
        self.0.clone()
    }
}

impl std::ops::Deref for Profile {
    type Target = str;

    fn deref(&self) -> &str {
        &self.0
    }
}

impl Drop for Profile {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A profile of our own for this test, and a sweep of what earlier runs left.
///
/// **The sweep runs once in the life of the process, not once per profile.** It
/// walks the temporary directory and asks the kernel about every entry it finds,
/// which is a fork each; doing that for every test in a suite turned a four-second
/// run into two minutes. Once is enough — the leftovers it collects are from
/// earlier runs, and there are no more of them appearing while this one goes.
pub fn profile(name: &str) -> Profile {
    static ONCE: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    ONCE.get_or_init(|| {
        swept(&std::env::temp_dir());
    });
    // **The pid first, so the sweep can tell a live run from a dead one.** A
    // suite runs many tests in parallel and they share this pid, so "is the pid
    // that made it still running" is exactly the question worth asking before
    // deleting somebody's directory.
    let dir = std::env::temp_dir().join(format!("{PROFILE_PREFIX}{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("a profile directory is writable");
    Profile(dir.to_string_lossy().into_owned())
}

/// **What earlier runs left behind, and why this one is safe to delete while
/// another is running.** A directory named with a pid that is still alive belongs
/// to a suite in progress and is left alone; one whose pid has gone is a
/// leftover. A directory from before the pid was in the name cannot be checked
/// that way, so it is only removed once it has been untouched for a while.
pub fn swept(root: &std::path::Path) -> usize {
    let mut removed = 0;
    let Ok(entries) = std::fs::read_dir(root) else { return 0 };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(rest) = name.strip_prefix(PROFILE_PREFIX) else { continue };
        let dead = match rest.split_once('-') {
            Some((pid, _)) => match pid.parse::<u32>() {
                Ok(pid) => !process_is_alive(pid),
                // Old naming, where the pid came last: no way to be sure, so the
                // age has to answer for it.
                Err(_) => entry.metadata().is_ok_and(|meta| {
                    meta.modified().is_ok_and(|when| when.elapsed().ok().is_none_or(|since| since > std::time::Duration::from_secs(3600)))
                }),
            },
            None => false,
        };
        if dead && std::fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// Whether a pid is still a process, asked of the kernel with a signal that does
/// nothing: `kill -0` succeeds only if something is there to be signalled.
fn process_is_alive(pid: u32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

#[test]
fn a_profile_is_removed_when_the_test_that_made_it_ends() {
    let dir = {
        let owned = profile("guard");
        let path = owned.0.clone();
        assert!(std::path::Path::new(&path).is_dir(), "the profile is there while the test is");
        path
    };
    assert!(!std::path::Path::new(&dir).exists(), "and gone when the guard drops: {dir}");
}

#[test]
fn the_sweep_removes_a_dead_runs_profile_and_never_a_live_one() {
    let root = std::env::temp_dir().join(format!("kalsa-sweep-{}-{}", std::process::id(), std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or_default()));
    std::fs::create_dir_all(&root).expect("a directory to sweep");
    let dead = root.join(format!("{PROFILE_PREFIX}4294967294-gone"));
    let live = root.join(format!("{PROFILE_PREFIX}{}-in-flight", std::process::id()));
    let someone_elses = root.join("not-ours");
    for dir in [&dead, &live, &someone_elses] {
        std::fs::create_dir_all(dir).expect("a profile to find");
    }

    assert_eq!(swept(&root), 1, "exactly the dead run's directory is removed");
    assert!(!dead.exists(), "a profile of a process that has gone");
    assert!(live.exists(), "a profile of a run in progress is left alone");
    assert!(someone_elses.exists(), "and nothing that is not ours");
    std::fs::remove_dir_all(&root).ok();
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
    let (playwright, context, page, _holds) = browser_allowing_holding(name, base, allowed).await;
    (playwright, context, page)
}

/// The same, handing back the window's store as well. **For the proofs that arm
/// an answer themselves** — a ticket with no person behind it — and so ask the
/// route what it does with one.
pub async fn browser_allowing_holding(
    name: &str,
    base: &str,
    allowed: &str,
) -> (Playwright, BrowserContext, Page, kalsa_browser::hold::Holds) {
    let profile = profile(name);
    let (playwright, context, page, _landings, holds) =
        launch::start(&profile, std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))).await
            .expect("the installed browser starts");
    let base = base.to_string();
    let allowed = allowed.to_string();
    let held = holds.clone();
    context
        .route("**/*", move |route| {
            let (base, allowed, holds) = (base.clone(), allowed.clone(), held.clone());
            async move {
                let request = route.request();
                let url = request.url();
                let opened_by_the_test = url.starts_with(&base) && (allowed.is_empty() || url.contains(&allowed));
                let permitted = if opened_by_the_test {
                    true
                } else {
                    matches!(guard::decide(url).await, guard::Verdict::Allow)
                };
                if !permitted {
                    return route.abort(Some("blockedbyclient")).await;
                }
                // A write to the fixture is held by **the product's own hold**,
                // not by a second copy of it: the test route stands in for the
                // address decision, which is the only thing it may stand in for.
                // The fixture is on this computer's own network, so the guard's
                // own route would refuse it before ever reaching a hold.
                if opened_by_the_test && !kalsa_browser::hold::is_read(request.method()) {
                    let holding = holds.clone();
                    if !holding.takes_pass(&request).await {
                        return kalsa_browser::hold::hold_write(&holding, &request, route).await;
                    }
                }
                route.continue_(None).await
            }
        })
        .await
        .expect("the test route is installed");
    (playwright, context, page, holds)
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
    let profile = profile("without-our-rules");
    let context = playwright
        .chromium()
        .launch_persistent_context_with_options(profile.path(), options)
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