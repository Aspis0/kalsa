//! What happens to a held write when the process that holds it goes away.
//!
//! The holder is this binary run again as a child (`holder_process` below), so
//! the processes killed here are only ever this test's own. The drivers are the
//! holder's children, which is the shape `driver_death.rs` relies on.

mod common;

use std::process::{ExitStatus, Stdio};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdout, Command};

const BASE_VAR: &str = "KALSA_TEARDOWN_BASE";
const PROFILE_VAR: &str = "KALSA_TEARDOWN_PROFILE";
const HELD: &str = "HELD";
const SENT: &str = "SENT";

/// Processes still holding this profile open: a Chrome window on it, from outside.
fn chrome_on(profile: &str) -> Vec<i32> {
    pids_of(&["-f", profile])
}

/// The children of a process, which for the holder are its driver.
fn children_of(pid: u32) -> Vec<i32> {
    pids_of(&["-P", &pid.to_string()])
}

fn pids_of(args: &[&str]) -> Vec<i32> {
    let Ok(listing) = std::process::Command::new("pgrep").args(args).output() else { return Vec::new() };
    String::from_utf8_lossy(&listing.stdout).lines().filter_map(|line| line.trim().parse().ok()).collect()
}

fn alive(pid: i32) -> bool {
    std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

/// The holder, started as a child of this test, and what it says.
struct Holder {
    child: Child,
    said: Lines<BufReader<ChildStdout>>,
}

impl Holder {
    async fn start(profile: &str, base: &str) -> Holder {
        let mut child = Command::new(std::env::current_exe().expect("this test binary"))
            .args(["holder_process", "--exact", "--ignored", "--nocapture"])
            .env(BASE_VAR, base)
            .env(PROFILE_VAR, profile)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .expect("the holding process starts");
        let said = BufReader::new(child.stdout.take().expect("its output is piped")).lines();
        Holder { child, said }
    }

    /// Waits until the holder has said `word`, which is what it does at each step.
    async fn until(&mut self, word: &str) {
        let said = tokio::time::timeout(Duration::from_secs(60), async {
            while let Some(line) = self.said.next_line().await.expect("the holder's output reads") {
                if line.contains(word) {
                    return true;
                }
            }
            false
        })
        .await
        .expect("the holder answers in time");
        assert!(said, "the holder ended before it said {word}");
    }

    async fn say(&mut self, word: &str) {
        let stdin = self.child.stdin.as_mut().expect("its input is piped");
        stdin.write_all(format!("{word}\n").as_bytes()).await.expect("the holder hears it");
    }
}

/// The process that holds a write: a window, one write the page makes, and then
/// whatever the parent says. It runs only when a test here starts it, so it does
/// nothing when run any other way.
#[tokio::test]
#[ignore = "run only as the holding child of the tests in this file"]
async fn holder_process() {
    let (Ok(base), Ok(profile)) = (std::env::var(BASE_VAR), std::env::var(PROFILE_VAR)) else { return };
    let (_sessions, page, holds) = common::confirming_window(&profile, &base).await;
    page.evaluate::<(), ()>(
        &format!("() => {{ fetch('{base}/order', {{method: 'POST', headers: {{'Content-Type': 'application/x-www-form-urlencoded'}}, body: 'city=Bologna'}}); }}"),
        None,
    )
    .await
    .expect("the page runs the write");
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    while holds.cards().await.is_empty() {
        assert!(std::time::Instant::now() < deadline, "the write was never held");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    println!("{HELD}");

    let mut word = String::new();
    let read = BufReader::new(tokio::io::stdin()).read_line(&mut word).await.expect("its input reads");
    if read == 0 {
        // Its input closed: the clean end. The session drops at the end of this test.
        return;
    }
    if word.trim() == "confirm" {
        let card = holds.cards().await.into_iter().next().expect("the held write");
        holds.answer(&card.id, common::CHAT, true).await;
        tokio::time::sleep(Duration::from_secs(2)).await;
        println!("{SENT}");
    }
    loop {
        tokio::time::sleep(Duration::from_secs(3600)).await;
    }
}

/// **The positive control.** A write the person confirms from the holder does reach
/// the fixture, so the negative tests below are measuring something real.
#[tokio::test]
async fn a_write_the_person_confirms_reaches_the_fixture() {
    let (base, arrived) = common::serve(&[common::page("<h1>the shop</h1>")]).await;
    let mut holder = Holder::start("teardown-confirm", &base).await;
    holder.until(HELD).await;
    holder.say("confirm").await;
    holder.until(SENT).await;
    assert_eq!(arrived.body_of("/order").as_deref(), Some("city=Bologna"), "the confirmed write was sent");
}

/// **What the host does when it abandons a call: the holder is killed outright.**
/// The write is not sent, and the window and its driver do not outlive it.
#[tokio::test]
async fn a_write_held_by_a_killed_process_is_never_sent() {
    let (base, arrived) = common::serve(&[common::page("<h1>the shop</h1>")]).await;
    let profile = "teardown-killed";
    let mut holder = Holder::start(profile, &base).await;
    holder.until(HELD).await;
    let pid = holder.child.id().expect("the holder is running");
    let driver = children_of(pid);
    assert!(!driver.is_empty(), "the holder has a driver to find");
    assert!(!chrome_on(profile).is_empty(), "a window is open before the kill");

    holder.child.kill().await.expect("the holder is killed");
    tokio::time::sleep(Duration::from_secs(3)).await;

    assert_eq!(arrived.body_of("/order"), None, "a write nobody confirmed was sent by the process that died");
    assert!(driver.iter().all(|pid| !alive(*pid)), "the driver outlived its holder: {driver:?}");
    assert!(chrome_on(profile).is_empty(), "the window outlived its holder");
}

/// **A clean end: the holder's input closes and it lets go of the window itself.**
#[tokio::test]
async fn a_write_held_by_a_process_that_ends_cleanly_is_never_sent() {
    let (base, arrived) = common::serve(&[common::page("<h1>the shop</h1>")]).await;
    let profile = "teardown-clean";
    let mut holder = Holder::start(profile, &base).await;
    holder.until(HELD).await;

    drop(holder.child.stdin.take());
    let status: ExitStatus = tokio::time::timeout(Duration::from_secs(30), holder.child.wait())
        .await
        .expect("the holder ends when its input closes")
        .expect("it ends");
    assert!(status.success(), "the holder ended cleanly: {status}");
    tokio::time::sleep(Duration::from_secs(3)).await;

    assert_eq!(arrived.body_of("/order"), None, "a write nobody confirmed was sent on a clean end");
    assert!(chrome_on(profile).is_empty(), "the window outlived its holder");
}
