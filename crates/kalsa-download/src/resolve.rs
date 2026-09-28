//! The name lookup, with a clock on it.
//!
//! ureq 2.12 does not bound DNS: its stream module carries a TODO admitting
//! it, and its default resolver blocks in `to_socket_addrs`. A resolver that
//! never answers would hold the walk, the start command and the page's
//! "Getting ready…" with it, with no error left to classify.

use std::io;
use std::net::{SocketAddr, ToSocketAddrs};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

/// How long a name may take to answer before this crate calls the network
/// blocked. The Windows resolver retries for roughly 12 s in total before
/// it answers on its own, so the deadline must sit above that number.
pub(crate) const RESOLVE_DEADLINE: Duration = Duration::from_secs(15);

/// What the std resolver does, without its patience: `host:port` to
/// addresses, straight through to `getaddrinfo`.
pub(crate) fn std_lookup(netloc: &str) -> io::Result<Vec<SocketAddr>> {
    ToSocketAddrs::to_socket_addrs(netloc).map(|iter| iter.collect())
}

/// A resolver that gives `lookup` at most `deadline`. On expiry it answers
/// with an error, which ureq wraps as a DNS fault — the wire's own
/// classification, and therefore `DownloadError::Unreachable`, the fact the
/// engine decision's network-block sentence reads.
///
/// WHY the lookup runs on its own thread: it is a blocking call with no
/// deadline of its own, and the only way to stop waiting for it is to stop
/// waiting. The thread is detached, blocked in `getaddrinfo` until the
/// resolver answers — one blocked thread per attempt, not a stuck walk.
pub(crate) fn deadline_resolver(
    deadline: Duration,
    lookup: impl Fn(&str) -> io::Result<Vec<SocketAddr>> + Send + Sync + 'static,
) -> impl Fn(&str) -> io::Result<Vec<SocketAddr>> + Send + Sync + 'static {
    let lookup = Arc::new(lookup);
    move |netloc: &str| {
        let (tx, rx) = mpsc::channel();
        let lookup = Arc::clone(&lookup);
        let target = netloc.to_owned();
        let _ = thread::spawn(move || {
            let _ = tx.send(lookup(&target));
        });
        match rx.recv_timeout(deadline) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("name resolution gave up after {deadline:?}"),
            )),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err(io::Error::other("the name lookup stopped without an answer"))
            }
        }
    }
}
