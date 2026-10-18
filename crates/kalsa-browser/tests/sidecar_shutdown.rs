//! What ending a session leaves running on this computer.
//!
//! The sidecar is not asked to stop, it is dropped: the host holds it with
//! `kill_on_drop` (`kalsa-mcp/src/launch.rs:101`), which is SIGKILL and not a
//! word. So "the sidecar stopped" is true by construction and worth nothing —
//! what matters is the two processes it was holding up: Playwright's **node
//! driver** and the **Chrome** it started, which are children of a process that
//! has just been killed and are therefore nobody's to stop.
//!
//! Every pid here is one this test watched being born, found by walking the
//! process table from the sidecar's own pid and by the profile directory in
//! Chrome's arguments. Nothing is matched by name, so another browser on this
//! computer — or another test's — can neither make this pass nor make it fail.
//!
//! It is a real sidecar: the binary this crate builds, spoken to over stdio the
//! way the host speaks to it, with the driver this install verified.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// How long a person would wait to be sure nothing was left running. A browser
/// that takes longer than this to notice its parent is gone is a browser that
/// outlives the window.
const PATIENCE: Duration = Duration::from_secs(10);

/// How often to look while waiting for the tree to go.
const LOOK: Duration = Duration::from_millis(100);

/// How long the browser's process set must stop changing before we believe we
/// have seen all of it.
///
/// **This is the whole of the flake, and it was a race rather than a slowness.**
/// Chrome starts helpers over a second or so — a zygote, a gpu process, a
/// renderer per page — and the old test took its picture the moment the driver
/// and *one* browser process appeared. Every helper born after that photograph
/// was not in it: not waited for, not reported, and if the driver was killed
/// while one was still being spawned, an orphan could be left running. The
/// browser had not been slow; the test had been early, and early is a race.
const SETTLE: Duration = Duration::from_millis(600);

/// Ending the session leaves no node driver and no Chrome of ours behind.
///
/// The sidecar is killed the way the host kills it — SIGKILL, no warning, no
/// chance to clean up — and every process it was holding up is gone within
/// `PATIENCE`. The driver sees the pipes its parent held close, ends, and takes
/// the browser with it; nothing here has to be asked, and nothing here is asked.
#[test]
fn ending_the_session_leaves_no_driver_and_no_browser_running() {
    let mut sidecar = Sidecar::start();
    sidecar.initialize();
    // A read of the first page: `browser_open` is refused by the address rules
    // before anything is started, and this needs Playwright really running.
    sidecar.call(2, "browser_read", "{}");

    let profile = format!("kalsa-browser-profile-{}-", sidecar.pid());
    // **Waited for, not sampled once.** The teardown below already polls for
    // these processes to go; asking instead for them to appear is the same
    // question asked once. Sampling once was the whole of the flake: the read
    // answers as soon as the page is read, and the driver and Chrome are a
    // moment behind it in the process table — on an idle machine never, and
    // with a dozen browser tests running beside it often enough to matter. A
    // proof that cannot be the victim of when it is taken is worth more than one
    // that fails for the machine it ran on.
    let (running, took) = wait_for_start(&profile, sidecar.pid());
    assert!(
        running.driver.is_some() && !running.browser.is_empty(),
        "nothing was started, so nothing was proved: driver {:?}, browser {:?}",
        running.driver,
        running.browser
    );
    assert!(
        took < PATIENCE + SETTLE,
        "they took {took:?} to appear and settle, which is a start-up claim of its own"
    );

    sidecar.kill();
    // **Every process that ever belonged to us, not only the ones in the
    // photograph.** A helper born while we were looking is still ours, and the
    // verdict is about the window leaving nothing behind.
    let waited = wait_for_all(&profile, &running);

    // Whatever survived is stopped here, so a failure does not leave a browser
    // running on somebody's machine — and then said.
    let survived: Vec<u32> = running
        .all()
        .into_iter()
        .filter(|pid| alive(*pid))
        .collect();
    for pid in &survived {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).stderr(Stdio::null()).status();
    }

    assert!(
        survived.is_empty(),
        "ending the session left {} running after {waited:?}: {survived:?}",
        survived.len()
    );
}

/// One line of the process table: who it is and whose it is.
struct Row {
    pid: u32,
    ppid: u32,
    command: String,
}

/// What a session was holding up while it was open.
#[derive(Default, Clone)]
struct Running {
    /// Playwright's node driver: a child of the sidecar, and the only one.
    driver: Option<u32>,
    /// The Chrome it started, and every helper under it — all of them name our
    /// profile directory in their arguments, which is how they are found without
    /// guessing at a command line.
    browser: Vec<u32>,
}

impl Running {
    fn all(&self) -> Vec<u32> {
        self.driver.iter().copied().chain(self.browser.iter().copied()).collect()
    }
}

/// The processes a live sidecar is holding up.
fn running(profile: &str, sidecar: u32) -> Running {
    let table = table();
    let mut found = Running::default();
    found.driver = table.iter().find(|row| row.ppid == sidecar && row.command.contains("/node ")).map(|row| row.pid);
    found.browser = table
        .iter()
        .filter(|row| row.command.contains(profile) && found.driver.is_none_or(|driver| driver != row.pid))
        .map(|row| row.pid)
        .collect();
    found
}

/// The processes a live session is holding, and how long they took to appear.
///
/// Polls until the driver and a browser are both in the table, so the finding
/// is about the sidecar's children and not about when the test happened to
/// look. Bounded by [`PATIENCE`] for the same reason the teardown is: a start
/// that never appears is a finding, and a wait that never ends is not.
fn wait_for_start(profile: &str, sidecar: u32) -> (Running, Duration) {
    let started = Instant::now();
    // The budget is the patience plus the settle, and they are different things:
    // a browser that takes its time is allowed to, so long as it finishes
    // arriving rather than never arriving.
    let budget = PATIENCE + SETTLE;
    let mut last: HashSet<u32> = HashSet::new();
    let mut quiet_since = Instant::now();
    loop {
        let found = running(profile, sidecar);
        // **The same set, not the same number.** A helper that dies and is
        // replaced leaves the count where it was while everything about the
        // browser changed, and comparing sizes would call that settled. The
        // timer restarts on a *change*: quiet is the absence of one.
        let now: HashSet<u32> = found.all().into_iter().collect();
        if now != last {
            quiet_since = Instant::now();
        }
        last = now;
        if found.driver.is_some()
            && !found.browser.is_empty()
            && quiet_since.elapsed() >= SETTLE
        {
            return (found, started.elapsed());
        }
        if started.elapsed() >= budget {
            return (found, started.elapsed());
        }
        std::thread::sleep(LOOK);
    }
}

/// How long it took for every one of them to go, given a deadline.
///
/// **Two conditions, and both have to hold.** The processes in the photograph
/// must be gone, *and* nothing new may be matching our profile: a helper that
/// appears after the kill is one the driver left behind, and stopping the wait
/// while it is still appearing is how an orphan is missed.
fn wait_for_all(profile: &str, was: &Running) -> Duration {
    let wanted: HashSet<u32> = was.all().into_iter().collect();
    let started = Instant::now();
    while started.elapsed() < PATIENCE {
        // `u32::MAX` is a pid nobody has: the lookup is by profile, so the
        // driver is not found by parentage here and `was` covers it.
        let stragglers: Vec<u32> = running(profile, u32::MAX)
            .all()
            .into_iter()
            .chain(wanted.iter().copied().filter(|pid| alive(*pid)))
            .collect();
        if stragglers.is_empty() {
            break;
        }
        std::thread::sleep(LOOK);
    }
    started.elapsed()
}

/// Whether a pid is still a process. `kill -0` says so without touching it, and
/// the answer is the command's **exit status**: `kill` runs perfectly well to
/// report that there is nothing there, and a run that succeeded is not a process
/// that is alive.
fn alive(pid: u32) -> bool {
    Command::new("kill")
        .args(["-0", &pid.to_string()])
        // A pid that has gone is an answer, not a complaint, and this runs on
        // every pid on every poll.
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// The whole process table, as `ps` reports it.
fn table() -> Vec<Row> {
    let listed = Command::new("ps").args(["-Ao", "pid,ppid,command"]).output().expect("the process table is readable");
    String::from_utf8_lossy(&listed.stdout)
        .lines()
        .skip(1)
        .filter_map(|line| {
            let mut words = line.splitn(3, char::is_whitespace);
            let pid = words.next()?.trim().parse().ok()?;
            let ppid = words.next()?.trim().parse().ok()?;
            Some(Row { pid, ppid, command: words.next().unwrap_or_default().trim().to_owned() })
        })
        .collect()
}

/// The real sidecar, spoken to the way the host speaks to it: one JSON-RPC
/// message per line on stdin, one per line back on stdout.
///
/// Answers are read on a thread of their own, because the wait for one is a
/// blocking read and a sidecar that never answers must fail the test rather than
/// hang it.
struct Sidecar {
    child: Child,
    stdin: Option<ChildStdin>,
    answers: mpsc::Receiver<String>,
}

impl Sidecar {
    /// Started with the same environment the launcher gives it
    /// (`browser/server_env.rs`): the few values a browser needs to find itself,
    /// and the one driver directory this install verified.
    fn start() -> Self {
        let driver = std::env::var("PLAYWRIGHT_DRIVER_PATH")
            .expect("PLAYWRIGHT_DRIVER_PATH names the driver; the browser tests need it");
        let mut command = Command::new(env!("CARGO_BIN_EXE_kalsa-browser"));
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .env_clear()
            .env("PATH", std::env::var("PATH").expect("a path"))
            .env("HOME", std::env::var("HOME").expect("a home"))
            .env("PLAYWRIGHT_DRIVER_PATH", driver);
        for name in ["TMPDIR", "LANG", "USER", "LOGNAME"] {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
        let mut child = command.spawn().expect("the sidecar starts");
        let stdin = child.stdin.take().expect("a line in");
        let stdout = child.stdout.take().expect("a line out");
        let (sender, answers) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    return;
                }
            }
        });
        Self { child, stdin: Some(stdin), answers }
    }

    fn pid(&self) -> u32 {
        self.child.id()
    }

    fn initialize(&mut self) {
        self.send(1, "initialize", r#"{"protocolVersion":"2026-07-28","capabilities":{},"clientInfo":{"name":"the test","version":"0"}}"#);
        self.await_answer(1);
        self.line(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
    }

    fn call(&mut self, id: u32, tool: &str, arguments: &str) {
        self.send(id, "tools/call", &format!(r#"{{"name":"{tool}","arguments":{arguments}}}"#));
        self.await_answer(id);
    }

    fn send(&mut self, id: u32, method: &str, params: &str) {
        self.line(&format!(r#"{{"jsonrpc":"2.0","id":{id},"method":"{method}","params":{params}}}"#));
    }

    fn line(&mut self, line: &str) {
        let stdin = self.stdin.as_mut().expect("the sidecar is still being written to");
        writeln!(stdin, "{line}").expect("the sidecar is still reading");
        stdin.flush().expect("the line is out");
    }

    /// The answer to one request, however many notifications came in between.
    /// The test fails rather than waits for ever: a sidecar that has stopped
    /// answering is a finding, not a hang.
    fn await_answer(&self, id: u32) {
        let wanted = format!("\"id\":{id}");
        let deadline = Duration::from_secs(60);
        let started = Instant::now();
        while started.elapsed() < deadline {
            let Ok(line) = self.answers.recv_timeout(deadline - started.elapsed()) else {
                break;
            };
            if line.contains(&wanted) {
                return;
            }
        }
        panic!("the sidecar never answered request {id}");
    }

    /// SIGKILL, which is exactly what dropping the host's `Child` does
    /// (`kill_on_drop`, `kalsa-mcp/src/launch.rs:101`). Nothing is sent first,
    /// and nothing is given a chance to tidy up.
    fn kill(&mut self) {
        self.child.kill().expect("the sidecar is still running");
        self.child.wait().expect("the sidecar is reaped");
    }
}
