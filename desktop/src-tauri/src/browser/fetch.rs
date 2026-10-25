//! Fetching the driver archive, in bytes, with a way to call it off.
//!
//! **Why this is not `kalsa_download::download`.** That crate's progress hook is
//! `FnMut(Progress)` and returns nothing (`crates/kalsa-download/src/download.rs:31`,
//! `fetch.rs:26`): there is no way to stop a transfer from outside it, and the
//! only cancellation it offers is dropping the future, which does nothing to a
//! blocking read already in flight. The driver is the one download a person must
//! be able to call off mid-way, so the transfer is done here where the flag is
//! checked between chunks.
//!
//! **What is given up.** `kalsa-download` resumes a broken line from its `.part`
//! file; this starts over. For a 42 MB file behind an explicit press that is the
//! right trade, and it buys a stronger property: **nothing partial is ever
//! written to disk**. There is no `.part` to leave behind, so "a cancel deletes
//! the partial file" is true because there was never a file — the bytes live in
//! memory until the whole archive has arrived and proven itself.
//!
//! **Why the bytes come back rather than a path.** The digest is checked on
//! exactly the buffer that is then unpacked, so nothing can be swapped between
//! the check and the extract.

use std::io::Read;

use super::error::BrowserError;

/// **One flag with three answers, not two booleans.** The person pressing Stop
/// and the transfer reaching its last step were two separate questions read from
/// two separate places, and a press that landed between them left the installer
/// renaming a directory nobody was going to be told about. So the two contend
/// for the same value and only one of them can win:
///
/// - `Running` — a press wins it by setting `Cancelled`, and the installer then
///   gives up and leaves nothing installed;
/// - `Committed` — the installer wins it at the commit, and every press after
///   that is told the driver is already installed, because it is.
///
/// A compare-exchange is the whole of it. There is no window between "check the
/// flag" and "act on it", because there is no check.
#[derive(Clone, Default)]
pub(crate) struct Cancel(std::sync::Arc<Inner>);

const RUNNING: u8 = 0;
const CANCELLED: u8 = 1;
const COMMITTED: u8 = 2;

#[derive(Default)]
struct Inner {
    state: std::sync::atomic::AtomicU8,
}

impl Cancel {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// What the person pressed. `true` when this press is the one that stopped
    /// it, `false` when the commit got there first and the driver is already
    /// installed — which is not a failure, it is the press arriving too late.
    pub(crate) fn stop(&self) -> bool {
        self.take(RUNNING, CANCELLED)
    }

    /// What the person pressed before the commit. `true` when the transfer has
    /// been called off and must leave nothing behind.
    pub(crate) fn stopped(&self) -> bool {
        self.0.state.load(std::sync::atomic::Ordering::SeqCst) == CANCELLED
    }

    /// The point of no return. `true` when this call is the one that committed,
    /// so the caller may go ahead and put the directory in place; `false` when
    /// the person was faster, and the caller must leave nothing installed.
    ///
    /// A press that arrives after this is answered by `stop` returning `false`,
    /// which is the whole of "already installed": the driver is in place, and
    /// the download reports itself ready rather than cancelled.
    pub(crate) fn commit(&self) -> bool {
        self.take(RUNNING, COMMITTED)
    }

    /// Moves the flag from `from` to `to`, and reports whether this call was the
    /// one that moved it.
    fn take(&self, from: u8, to: u8) -> bool {
        self.0
            .state
            .compare_exchange(from, to, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst)
            .is_ok()
    }
}

/// Read chunk. The flag is checked between two of these, so the worst a cancel
/// waits for is one 64 KiB read.
const CHUNK: usize = 64 * 1024;

/// How long to wait for the connection before giving it up.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// **How long one read may block.** A connect timeout alone is not enough: a
/// server that accepts the connection and then says nothing leaves the read
/// waiting on the operating system, and the only way out of it is a deadline.
/// So every read is a short *slice* rather than one long deadline — it is
/// retried when it runs out, and the flag is read again between two of them, so
/// the worst a Stop waits for is one slice instead of one whole timeout.
const READ_SLICE: std::time::Duration = std::time::Duration::from_millis(500);

/// How long the transfer may make no progress at all before it gives up on a
/// server that is not stalling but dead. Without this, a peer that answers with
/// headers and then nothing holds the one download slot for ever, which is the
/// whole failure this is here to stop.
const STALL_LIMIT: std::time::Duration = std::time::Duration::from_secs(60);

/// Fetches `url` and returns the bytes, but only once the whole file is here and
/// its digest is the one `expected_sha256` names.
///
/// `progress` receives the promised total and the running count.
pub(crate) fn get(
    url: &str,
    expected_size: u64,
    expected_sha256: &str,
    cancel: &Cancel,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<Vec<u8>, BrowserError> {
    // Before the agent exists. A person who presses Stop while the download is
    // still being set up has stopped it, and connecting anyway would spend the
    // traffic they asked not to spend.
    if cancel.stopped() {
        return Err(BrowserError::Cancelled);
    }
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(CONNECT_TIMEOUT)
        .timeout_read(READ_SLICE)
        .build();
    let response = agent.get(url).call().map_err(|_| BrowserError::Download)?;
    let total = response
        .header("Content-Length")
        .and_then(|length| length.parse::<u64>().ok())
        .filter(|length| *length > 0)
        .unwrap_or(expected_size);
    progress(0, total);

    let mut body = Vec::with_capacity(expected_size as usize);
    let mut buffer = vec![0u8; CHUNK];
    let mut reader = response.into_reader();
    let mut last_byte = std::time::Instant::now();
    loop {
        if cancel.stopped() {
            return Err(BrowserError::Cancelled);
        }
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => {
                body.extend_from_slice(&buffer[..read]);
                // A server that keeps sending cannot make us read past what we
                // asked for, and a body longer than the pinned archive is refused
                // on the first byte over rather than after buffering all of it.
                if body.len() as u64 > expected_size {
                    return Err(BrowserError::Corrupt);
                }
                last_byte = std::time::Instant::now();
                progress(body.len() as u64, total);
            }
            // A slice that ran out is not a failure and nothing is lost: the
            // bytes that did arrive are already in `body`, and the loop comes
            // straight back round to read the flag again.
            Err(error) if resumable(error.kind()) => {
                if last_byte.elapsed() > STALL_LIMIT {
                    return Err(BrowserError::Download);
                }
            }
            Err(_) => return Err(BrowserError::Download),
        }
    }

    // The size first: a short line and the wrong driver are two different
    // sentences, and only one of them is worth retrying.
    if body.len() as u64 != expected_size {
        return Err(BrowserError::Corrupt);
    }
    let digest = super::tree::digest_of_bytes(&body);
    if digest != expected_sha256.to_ascii_lowercase() {
        return Err(BrowserError::Corrupt);
    }
    if cancel.stopped() {
        return Err(BrowserError::Cancelled);
    }
    Ok(body)
}

/// Whether a failed read means "nothing arrived yet" rather than "this
/// connection is finished".
///
/// A socket read that runs out of time, that would block, or that was cut short
/// by a signal has lost nothing: the bytes that did arrive are already in the
/// buffer, and asking again is the right move. Anything else is the end of it.
fn resumable(kind: std::io::ErrorKind) -> bool {
    matches!(kind, std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock | std::io::ErrorKind::Interrupted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    /// An HTTP server on the loopback that streams `body`, so the transfer can be
    /// called off in the middle of it rather than before it starts. The counter
    /// is what makes "never started" checkable: a transfer that opens no
    /// connection leaves it at zero, whatever it returns.
    async fn serving(body: Vec<u8>) -> (String, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("binds");
        let address = listener.local_addr().expect("an address");
        let hits = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&hits);
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                counted.fetch_add(1, Ordering::SeqCst);
                let body = body.clone();
                tokio::spawn(async move {
                    use tokio::io::AsyncWriteExt;
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = socket.write_all(header.as_bytes()).await;
                    // In chunks, so a cancel lands between two of them.
                    for piece in body.chunks(16 * 1024) {
                        if socket.write_all(piece).await.is_err() {
                            return;
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                    }
                });
            }
        });
        (format!("http://{address}/driver.tar.gz"), hits)
    }

    fn digest_of(bytes: &[u8]) -> String {
        super::super::tree::digest_of_bytes(bytes)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_finished_transfer_comes_back_with_the_bytes_it_promised() {
        let body = vec![7u8; 256 * 1024];
        let (url, hits) = serving(body.clone()).await;
        let mut seen = Vec::new();
        let got = get(&url, body.len() as u64, &digest_of(&body), &Cancel::new(), &mut |done, total| {
            seen.push((done, total));
        })
        .expect("the transfer finishes");
        assert_eq!(got, body);
        assert_eq!(*seen.last().expect("a last report"), (body.len() as u64, body.len() as u64));
        assert!(hits.load(Ordering::SeqCst) > 0, "the transfer did not come from the server");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_cancel_stops_the_transfer_before_the_whole_file_arrives() {
        let body = vec![7u8; 8 * 1024 * 1024];
        let (url, _hits) = serving(body.clone()).await;
        let cancel = Cancel::new();
        // Ask for a stop as soon as the first chunk is reported, which is well
        // short of the whole file.
        let stop_after = &cancel.clone();
        let refused = get(&url, body.len() as u64, &digest_of(&body), &cancel, &mut |done, _| {
            if done > 0 {
                stop_after.stop();
            }
        })
        .expect_err("the transfer was called off");
        assert_eq!(refused, BrowserError::Cancelled);
        assert!(cancel.stopped(), "the flag is what the page set");
    }

    /// The one that proves the fix rather than the code: returning `Cancelled`
    /// is easy, opening no connection is the claim. A cancel pressed before the
    /// first byte spends no traffic, so the installer test that hands this an
    /// already-stopped flag never reaches the network either.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_transfer_already_cancelled_never_starts() {
        let body = vec![1u8; 4096];
        let (url, hits) = serving(body.clone()).await;
        let cancel = Cancel::new();
        cancel.stop();
        assert_eq!(
            get(&url, body.len() as u64, &digest_of(&body), &cancel, &mut |_, _| {}).err(),
            Some(BrowserError::Cancelled)
        );
        // Long enough for a connection that had been made to have been accepted.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        assert_eq!(hits.load(Ordering::SeqCst), 0, "a cancelled download connected anyway");
    }

    /// A server that answers with the headers and then goes quiet — the shape that
    /// holds a blocking read open with nobody left to stop it.
    async fn stalling(body_len: usize) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("binds");
        let address = listener.local_addr().expect("an address");
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                tokio::spawn(async move {
                    use tokio::io::AsyncWriteExt;
                    let header =
                        format!("HTTP/1.1 200 OK\r\nContent-Length: {body_len}\r\nConnection: close\r\n\r\n");
                    let _ = socket.write_all(header.as_bytes()).await;
                    // Headers, a little body, and then nothing at all.
                    let _ = socket.write_all(b"partial").await;
                    let _ = socket.flush().await;
                    std::future::pending::<()>().await;
                });
            }
        });
        format!("http://{address}/driver.tar.gz")
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_file_that_is_not_the_one_we_pinned_is_refused() {
        let body = vec![3u8; 4096];
        let (url, _hits) = serving(body.clone()).await;
        let wrong = digest_of(b"something else entirely");
        assert_eq!(
            get(&url, body.len() as u64, &wrong, &Cancel::new(), &mut |_, _| {}).err(),
            Some(BrowserError::Corrupt)
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_short_line_is_refused_rather_than_returned() {
        let body = vec![3u8; 4096];
        let (url, _hits) = serving(body.clone()).await;
        let promised = body.len() as u64 + 1000;
        assert_eq!(
            get(&url, promised, &digest_of(&body), &Cancel::new(), &mut |_, _| {}).err(),
            Some(BrowserError::Corrupt)
        );
    }

    /// Nothing partial is ever written: there is no file for a cancel to leave.
    #[test]
    fn the_flag_is_shared_by_every_copy_and_starts_unset() {
        let cancel = Cancel::new();
        assert!(!cancel.stopped());
        let other = cancel.clone();
        other.stop();
        assert!(cancel.stopped());
    }

    /// A server that stops answering gives the transfer back rather than holding
    /// the one download slot. This is the read timeout, and the shape that needs
    /// it: the connection is fine, the body simply never arrives, and a connect
    /// timeout alone never fires.
    ///
    /// The press lands while the transfer is waiting, so the answer has to be
    /// `Cancelled` rather than a network failure — the person asked for this.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_stalled_server_is_given_up_on_instead_of_holding_the_slot() {
        let url = stalling(42_353_180).await;
        let cancel = Cancel::new();
        let stop_at = Duration::from_millis(200);
        tokio::spawn({
            let cancel = cancel.clone();
            async move {
                tokio::time::sleep(stop_at).await;
                cancel.stop();
            }
        });
        let started = std::time::Instant::now();
        let refused = get(&url, 42_353_180, &digest_of(b"whatever"), &cancel, &mut |_, _| {}).expect_err("refused");
        assert_eq!(refused, BrowserError::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(5), "the cancel waited for the server");
    }

    /// A body longer than the pinned archive is refused on the first byte over,
    /// not after buffering all of it: a server that never stops sending must not
    /// be able to grow our memory without limit.
    #[tokio::test(flavor = "multi_thread")]
    async fn a_body_longer_than_the_archive_is_refused_before_it_is_all_read() {
        let body = vec![3u8; 512 * 1024];
        let (url, _hits) = serving(body.clone()).await;
        let cancel = Cancel::new();
        let mut reported = 0u64;
        let refused = get(&url, 4096, &digest_of(&body), &cancel, &mut |done, _| reported = reported.max(done))
            .expect_err("refused");
        assert_eq!(refused, BrowserError::Corrupt);
        // 4096 promised, and it gave up rather than pulling half a megabyte.
        assert!(reported <= 4096 + CHUNK as u64, "it kept reading past the size: {reported}");
    }

    /// The counter the tests above lean on: progress really does report running
    /// counts, so "cancel at the first report" means what it says.
    #[test]
    fn progress_reports_a_running_count_that_rises() {
        let calls = AtomicUsize::new(0);
        let report = |done: u64, _total: u64| {
            assert!(done <= 1_000_000);
            calls.fetch_add(1, Ordering::SeqCst);
        };
        report(0, 1_000_000);
        report(500_000, 1_000_000);
        report(1_000_000, 1_000_000);
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }
}