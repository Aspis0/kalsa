//! What a transport failure means.
//!
//! `ureq` reports every transport failure the same way, and keeps the reason in
//! the error's source. These are the three the user can tell apart: the address
//! gate refused an address, the request ran past its deadline, or the
//! connection failed for some other reason. Getting this wrong is not
//! cosmetic — a refusal reported as "could not be reached" sends the reader
//! looking at their network.

use std::io;

use crate::WebError;

/// The kind of the underlying I/O error, when there is one.
///
/// Walked, not read off the first link: `ureq` sometimes wraps the I/O error
/// in one of its own, and the reason is then one hop further down. Measured
/// live 2026-09-19 — the first version returned `Network` for a request that
/// had plainly run past its deadline.
fn io_kind(transport: &ureq::Transport) -> Option<io::ErrorKind> {
    let mut source: Option<&(dyn std::error::Error + 'static)> =
        std::error::Error::source(transport);
    while let Some(current) = source {
        if let Some(error) = current.downcast_ref::<io::Error>() {
            return Some(error.kind());
        }
        source = current.source();
    }
    None
}

/// True when this failure was the resolver refusing an address. A page that
/// simply could not be reached has no such source.
fn refused(transport: &ureq::Transport) -> bool {
    io_kind(transport) == Some(io::ErrorKind::PermissionDenied)
}

/// The failure as the sentence it deserves.
pub(crate) fn classify(transport: &ureq::Transport) -> WebError {
    if refused(transport) {
        WebError::Refused
    } else if io_kind(transport) == Some(io::ErrorKind::TimedOut) {
        // The deadline in `REQUEST_BUDGET`, not a missing server: a page that
        // dribbles one byte at a time reaches no other timeout.
        WebError::Timeout
    } else {
        WebError::Network
    }
}

/// The failure a reader's error means. [`classify`]'s reason, one layer down:
/// the body reader hands back an `io::Error`, and a request that ran past its
/// deadline arrives here rather than as a transport error.
pub(crate) fn from_read(error: &io::Error) -> WebError {
    let mut link: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(current) = link {
        let timed_out = current
            .downcast_ref::<io::Error>()
            .is_some_and(|io| io.kind() == io::ErrorKind::TimedOut);
        if timed_out {
            return WebError::Timeout;
        }
        link = current.source();
    }
    WebError::Network
}
