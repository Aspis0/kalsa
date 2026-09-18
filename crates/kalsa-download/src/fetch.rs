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
            return Err(overrun());
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
        let read = reader.read(&mut chunk)?;
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
            // it into a reset or an EOF.
            return Err(overrun());
        }
    }
}

/// The server is sending past the promised size. Deliberately distinct from a
/// network failure: a lying origin must never be retried against the same
/// URL, while a dropped connection is exactly what resume is for.
fn overrun() -> DownloadError {
    DownloadError::Io(io::Error::new(
        io::ErrorKind::InvalidData,
        "server sent more than the promised size",
    ))
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
        // The kind is deterministic too: decided from the response header,
        // not from a read racing the server's teardown.
        assert!(
            matches!(&err, DownloadError::Io(e) if e.kind() == io::ErrorKind::InvalidData),
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
            matches!(&result, Err(DownloadError::Io(e)) if e.kind() == io::ErrorKind::TimedOut),
            "a read timeout must be the existing resumable I/O failure: {result:?}"
        );
        assert_eq!(
            part.len().expect("partial length"),
            httptest::STALL_BYTES as u64
        );
        assert_eq!(
            fs::read(dir.join("model.gguf.part")).expect("partial file"),
            data[..httptest::STALL_BYTES],
            "bytes received before the stall must survive it"
        );
        drop(part);

        let resumed = httptest::serve(data.clone(), RangeMode::Honor);
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("reclaim");
        fetch(&resumed.url, &mut part, data.len() as u64, &mut |_| {}).expect("resume");
        assert_eq!(
            *resumed.requests.lock().expect("requests"),
            vec![Some(httptest::STALL_BYTES as u64)],
            "the next attempt must resume after the surviving prefix"
        );
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
