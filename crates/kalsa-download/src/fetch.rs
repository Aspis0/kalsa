//! Moving bytes, with a `Range` header so a broken connection costs only what
//! it lost.
//!
//! Two decisions here are made from data already in hand, never from one more
//! gamble on the socket: a declared length larger than the promise is an
//! overrun known from the header, and a body that arrives past the promise is
//! an overrun known from the bytes received. Once the promised size is on
//! disk the transfer is over — a reset, an EOF or a talkative server after
//! that point changes nothing.

use std::io::{self, Read, Write};
use std::time::Duration;

use crate::part::PartFile;
use crate::range;
use crate::{DownloadError, Progress};

/// Read chunk: big enough that the callbacks are not the bottleneck on a
/// laptop disk, small enough that the buffer is noise.
const CHUNK: usize = 64 * 1024;

/// Streams `url` onto `part`, starting at the part file's current length.
/// Leaves the part file in place — still resumable — on any transport error;
/// whether the finished file is the model is `verify`'s decision, not ours.
pub fn fetch(
    url: &str,
    part: &mut PartFile,
    expected_size: u64,
    progress: &mut dyn FnMut(Progress),
) -> Result<(), DownloadError> {
    fetch_with_read_timeout(
        url,
        part,
        expected_size,
        progress,
        range::DEFAULT_READ_TIMEOUT,
    )
}

fn fetch_with_read_timeout(
    url: &str,
    part: &mut PartFile,
    expected_size: u64,
    progress: &mut dyn FnMut(Progress),
    read_timeout: Duration,
) -> Result<(), DownloadError> {
    let mut resume_from = part.len()?;
    // Longer than the promise cannot be a prefix of it: not resumable.
    if resume_from > expected_size {
        resume_from = 0;
    }
    // Already complete: no request at all, verification decides. This is the
    // crash between last byte and rename, and it costs nothing.
    if resume_from == expected_size {
        return Ok(());
    }
    let (response, start) = range::connect_with_read_timeout(url, resume_from, read_timeout)?;
    if start == 0 {
        part.restart()?;
    } else {
        part.append()?;
    }
    // An overrun can be known from the header alone: a declared length past
    // the promise is refused before a single body byte reaches the disk the
    // preflight protected.
    let declared: Option<u64> = response
        .header("Content-Length")
        .and_then(|value| value.parse().ok());
    if let Some(declared) = declared {
        if declared > expected_size - start {
            // checked on purpose: a lying length past u64's ceiling is a
            // mismatch, never a panic or a wrap that could read as a small
            // total.
            let actual = start.checked_add(declared).unwrap_or(u64::MAX);
            return Err(overrun(expected_size, actual));
        }
    }
    let file = part.handle();
    let mut reader = response.into_reader();
    let mut chunk = vec![0u8; CHUNK];
    let mut done = start;
    progress(Progress {
        bytes_done: done,
        bytes_total: expected_size,
    });
    loop {
        // The promise is fulfilled: decided. Nothing the socket does after
        // this point — reset, EOF, more bytes — is ours to lose, so we never
        // read it again.
        if done == expected_size {
            return Ok(());
        }
        let read = reader.read(&mut chunk).map_err(DownloadError::Network)?;
        if read == 0 {
            // The server ran out before the promise; the length gate in
            // `verify` will call that what it is.
            return Ok(());
        }
        // Not one byte past the promise, whatever the server sends.
        let take = (expected_size - done).min(read as u64) as usize;
        file.write_all(&chunk[..take]).map_err(disk_full)?;
        done += take as u64;
        progress(Progress {
            bytes_done: done,
            bytes_total: expected_size,
        });
        if take < read {
            // The overrun is not a guess: those bytes were received. The
            // error is returned unconditionally — no further read can turn
            // it into a reset or an EOF. `done` already counts `take`, so
            // the true total adds only what arrived past the promise.
            return Err(overrun(expected_size, done + (read - take) as u64));
        }
    }
}

/// The origin is sending past the promised size: the very mismatch
/// `verify` would report at the end, known the moment it becomes certain.
/// It rides `SizeMismatch` — a mismatch with the publisher's record, not a
/// transport failure — and `download` discards the part on it, keeping the
/// enum's "the part is gone after a mismatch" contract true on this path
/// too.
fn overrun(expected: u64, actual: u64) -> DownloadError {
    DownloadError::SizeMismatch { expected, actual }
}

/// Out of space mid-transfer is the one I/O failure this crate has a specific
/// word for: the part file stays, resumable, once the user has made room.
fn disk_full(e: io::Error) -> DownloadError {
    if e.kind() == io::ErrorKind::StorageFull {
        DownloadError::DiskFull
    } else {
        DownloadError::Io(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::httptest::{self, RangeMode};
    use std::fs;
    use std::path::PathBuf;
    use std::time::Duration;

    const SPLIT: u64 = 1024 * 1024;

    fn scratch(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn payload(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    #[test]
    fn a_resume_continues_at_the_prefix_instead_of_paying_again() {
        let dir = scratch("fetch-resume");
        let data = payload(3 * SPLIT as usize);
        let server = httptest::serve(data.clone(), RangeMode::Honor);
        fs::write(dir.join("model.gguf.part"), &data[..SPLIT as usize]).expect("partial file");
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        fetch(&server.url, &mut part, data.len() as u64, &mut |_| {}).expect("resume");
        assert_eq!(part.len().expect("len"), data.len() as u64);
        assert_eq!(
            *server.requests.lock().expect("requests"),
            vec![Some(SPLIT)],
            "the server must be asked to skip the surviving prefix"
        );
        // Unclaimed first: a held claim byte-locks the file on Windows and
        // fs::read from the path gets os 33. The product reads through the
        // handle (`verify::sha256_hex`); these assertions are about the
        // disk, so they read it unclaimed.
        drop(part);
        assert_eq!(
            fs::read(dir.join("model.gguf.part")).expect("read"),
            data,
            "appended suffix must be the promised content"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_200_to_a_range_request_restarts_from_zero() {
        let dir = scratch("fetch-restart");
        let data = payload(3 * SPLIT as usize);
        let server = httptest::serve(data.clone(), RangeMode::Ignore);
        fs::write(dir.join("model.gguf.part"), &data[..SPLIT as usize]).expect("partial file");
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        fetch(&server.url, &mut part, data.len() as u64, &mut |_| {}).expect("restart");
        // We did ask to resume…
        assert_eq!(
            *server.requests.lock().expect("requests"),
            vec![Some(SPLIT)]
        );
        // …and appending anyway would have produced the right length with the
        // wrong bytes, so exact equality is the assertion.
        // Unclaimed first, for the same os-33 reason as above.
        drop(part);
        assert_eq!(fs::read(dir.join("model.gguf.part")).expect("read"), data);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_server_that_overruns_is_stopped_at_the_promised_size() {
        let dir = scratch("fetch-overrun");
        let data = payload(1024 * 1024);
        let expected = data.len() as u64;
        let server = httptest::serve(data, RangeMode::Overrun);
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        let err = fetch(&server.url, &mut part, expected, &mut |_| {})
            .expect_err("the overrun must be refused");
        // The invariant first: not one byte past the promise reached the part
        // file — here not one byte at all, because the overrun was visible in
        // the declared length before any body byte was asked for.
        assert_eq!(part.len().expect("len"), 0);
        // The kind is the publisher's mismatch, with both of its figures:
        // what was promised, and what the header said would arrive.
        assert!(
            matches!(&err, DownloadError::SizeMismatch { expected: e, actual } if *e == expected
                && *actual == expected + 64 * 1024),
            "{err:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_body_that_overruns_its_own_declaration_reports_the_true_count() {
        let dir = scratch("fetch-oversend");
        let data = payload(1024 * 1024);
        let server = httptest::serve(data.clone(), RangeMode::Oversend);
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        // The promise sits one byte past the content, the body is framed
        // by the connection's close, and the extra bytes ride the same
        // body: only the received count can betray the overrun — and the
        // figure it reports is what arrived, never the promise plus the
        // whole final read.
        let promised = data.len() as u64 + 1;
        let err = fetch(&server.url, &mut part, promised, &mut |_| {})
            .expect_err("the oversend must be refused");
        let DownloadError::SizeMismatch { expected, actual } = err else {
            panic!("the oversend must read as a size mismatch, not {err:?}")
        };
        assert_eq!(expected, promised);
        // How much of the extra one crossing read carries is the socket's
        // choice, so the deterministic facts are the bounds: everything
        // counted arrived, and nothing that never arrived is counted. The
        // old formula — the promise plus the whole final read — could
        // report past what the server sent.
        assert!(actual > promised, "{actual} must sit past the promise");
        assert!(
            actual <= data.len() as u64 + 64 * 1024,
            "{actual} must not count bytes that never arrived"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_length_past_the_u64_ceiling_is_a_mismatch_not_a_wrap() {
        let dir = scratch("fetch-absurd");
        let server = httptest::serve(payload(64), RangeMode::AbsurdLength);
        fs::write(dir.join("model.gguf.part"), b"prefix").expect("prefix");
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        // A resumed prefix plus a declared u64::MAX would overflow the
        // count; the answer is the ceiling, never a wrapped small total.
        let err = fetch(&server.url, &mut part, 1024, &mut |_| {})
            .expect_err("the absurd length must be refused");
        assert!(
            matches!(&err, DownloadError::SizeMismatch { actual, .. } if *actual == u64::MAX),
            "{err:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_quiet_server_times_out_and_keeps_bytes_for_the_next_attempt() {
        let dir = scratch("fetch-stall");
        let data = payload(3 * SPLIT as usize);
        let stalled = httptest::serve(data.clone(), RangeMode::Stall);
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        let url = stalled.url.clone();
        let expected_size = data.len() as u64;
        let (returned, done) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = fetch_with_read_timeout(
                &url,
                &mut part,
                expected_size,
                &mut |_| {},
                Duration::from_secs(1),
            );
            returned.send((result, part)).expect("fetch worker");
        });
        let (result, part) = done
            .recv_timeout(Duration::from_secs(8))
            .expect("a stalled fetch must return before the hard deadline");
        assert!(
            matches!(&result, Err(DownloadError::Network(e)) if e.kind() == io::ErrorKind::TimedOut),
            "a read timeout must be the existing resumable I/O failure: {result:?}"
        );
        assert_eq!(
            part.len().expect("partial length"),
            httptest::STALL_BYTES as u64
        );
        // Unclaimed first, for the same os-33 reason as above.
        drop(part);
        assert_eq!(
            fs::read(dir.join("model.gguf.part")).expect("partial file"),
            data[..httptest::STALL_BYTES],
            "bytes received before the stall must survive it"
        );

        let resumed = httptest::serve(data.clone(), RangeMode::Honor);
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("reclaim");
        fetch(&resumed.url, &mut part, data.len() as u64, &mut |_| {}).expect("resume");
        assert_eq!(
            *resumed.requests.lock().expect("requests"),
            vec![Some(httptest::STALL_BYTES as u64)],
            "the next attempt must resume after the surviving prefix"
        );
        // Unclaimed first, for the same os-33 reason as above.
        drop(part);
        assert_eq!(
            fs::read(dir.join("model.gguf.part")).expect("resumed file"),
            data
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_out_of_space_write_is_its_own_failure_not_a_generic_io_error() {
        let full = io::Error::from(io::ErrorKind::StorageFull);
        assert!(matches!(disk_full(full), DownloadError::DiskFull));
        let other = io::Error::from(io::ErrorKind::PermissionDenied);
        assert!(matches!(disk_full(other), DownloadError::Io(_)));
    }
}
