//! Read a response body with a hard cap, checking for a stop as it goes.
//!
//! Both requests need the same three things: never read more than a fixed
//! number of bytes, notice when the user has stopped, and report a transfer
//! that died. `ureq`'s own `into_string()` does none of them.

use std::io::{self, Read};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::failure;
use crate::WebError;

/// One read at a time, so a stop is noticed within a chunk rather than after
/// the whole body. A socket already blocked in a read still waits for its own
/// timeout — no HTTP client in this crate can be interrupted mid-read.
const CHUNK: usize = 32 * 1024;

/// Read at most `cap` bytes. The flag says the body was longer than that.
pub(crate) fn read_capped(
    reader: impl Read,
    cap: usize,
    stop: &AtomicBool,
) -> Result<(Vec<u8>, bool), WebError> {
    let mut limited = reader.take(cap as u64 + 1);
    let mut buffer = Vec::with_capacity(CHUNK);
    let mut chunk = vec![0u8; CHUNK];
    loop {
        if stop.load(Ordering::Relaxed) {
            return Err(WebError::Stopped);
        }
        match limited.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
            // A signal arriving mid-read is not a failed transfer.
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            // A request that ran past its deadline arrives here, not as a
            // transport error: it deserves its own sentence.
            Err(error) => return Err(failure::from_read(&error)),
        }
    }
    let truncated = buffer.len() > cap;
    buffer.truncate(cap);
    Ok((buffer, truncated))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;

    use super::read_capped;

    #[test]
    fn reads_up_to_the_cap_and_says_so() {
        let open = AtomicBool::new(false);
        let (bytes, truncated) = read_capped(&b"abcdef"[..], 3, &open).expect("read");
        assert_eq!(bytes, b"abc");
        assert!(truncated);

        let (bytes, truncated) = read_capped(&b"abc"[..], 3, &open).expect("read");
        assert_eq!(bytes, b"abc");
        assert!(!truncated);
    }

    #[test]
    fn a_stopped_reader_reads_nothing() {
        let stopped = AtomicBool::new(true);
        assert_eq!(
            read_capped(&b"abcdef"[..], 100, &stopped).unwrap_err(),
            crate::WebError::Stopped
        );
    }
}
