//! Moving bytes, with a `Range` header so a broken connection costs only what
//! it lost.
//!
//! The part file is append-only truth: everything in it was really received.
//! A resume asks for `bytes=N-`, and a 206 answer counts only when its
//! `Content-Range` starts exactly where we asked — a suffix from any other
//! offset glued onto our prefix is a file of nearly the right length and
//! entirely wrong content, so the part file restarts from zero and the body
//! is fetched whole instead. A 200 to the Range request is the same
//! fall-back. Any other answer is an error, and the part file stays as it
//! was: still resumable.
//!
//! The write is bounded at the size the caller promised: a server that keeps
//! sending does not get to fill the disk the preflight protected.

use std::io::{self, Read, Write};

use crate::part::PartFile;
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
    let (response, start) = connect(url, resume_from)?;
    if start == 0 {
        part.restart()?;
    } else {
        part.append()?;
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
        let read = reader.read(&mut chunk)?;
        if read == 0 {
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
            // The part file is now exactly the promised length, so the next
            // attempt needs no request at all: verification decides.
            return Err(DownloadError::Io(io::Error::new(
                io::ErrorKind::InvalidData,
                "server sent more than the promised size",
            )));
        }
    }
}

/// Asks for the suffix at `resume_from` and checks the answer against the
/// header we sent. Returns the body reader and the offset it starts at.
fn connect(url: &str, resume_from: u64) -> Result<(ureq::Response, u64), DownloadError> {
    if resume_from > 0 {
        let response = send(url, Some(resume_from))?;
        match response.status() {
            // Range ignored: the body is the whole file.
            200 => return Ok((response, 0)),
            206 => match content_range_start(&response) {
                Some(at) if at == resume_from => return Ok((response, resume_from)),
                // Missing or lying: whatever this body is, it does not
                // continue our file.
                _ => {}
            },
            code => return Err(http_error(code)),
        }
    }
    let response = send(url, None)?;
    let start = match response.status() {
        200 => 0,
        // A 206 to a request with no Range is a broken server; its body may
        // only be used if it claims to start at zero.
        206 => content_range_start(&response)
            .filter(|at| *at == 0)
            .ok_or_else(|| http_error(206))?,
        code => return Err(http_error(code)),
    };
    Ok((response, start))
}

fn send(url: &str, range: Option<u64>) -> Result<ureq::Response, DownloadError> {
    let mut request = ureq::get(url);
    if let Some(at) = range {
        request = request.set("Range", &format!("bytes={at}-"));
    }
    request
        .call()
        .map_err(|e| DownloadError::Io(io::Error::new(io::ErrorKind::Other, e.to_string())))
}

/// Start offset of `Content-Range: bytes N-M/T`, or None when absent or
/// unintelligible — and None is treated as "not a continuation".
fn content_range_start(response: &ureq::Response) -> Option<u64> {
    let rest = response.header("Content-Range")?.trim().strip_prefix("bytes")?;
    let range = rest.trim_start().split('/').next()?;
    range.split('-').next()?.parse().ok()
}

fn http_error(code: u16) -> DownloadError {
    DownloadError::Io(io::Error::new(
        io::ErrorKind::Other,
        format!("server answered HTTP {code}"),
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

    const SPLIT: u64 = 1024 * 1024;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("kalsa-download-{name}-{}", std::process::id()));
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
        assert_eq!(*server.requests.lock().expect("requests"), vec![Some(SPLIT)]);
        // …and appending anyway would have produced the right length with the
        // wrong bytes, so exact equality is the assertion.
        assert_eq!(fs::read(dir.join("model.gguf.part")).expect("read"), data);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_206_from_the_wrong_offset_is_not_appended() {
        let dir = scratch("fetch-lie");
        let data = payload(3 * SPLIT as usize);
        let server = httptest::serve(data.clone(), RangeMode::Lie);
        fs::write(dir.join("model.gguf.part"), &data[..SPLIT as usize]).expect("partial file");
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        // The fixture answers 206 with a Content-Range that starts past the
        // prefix we asked to resume; trusting it would glue on a wrong
        // suffix. The right answer is to ask again from zero.
        fetch(&server.url, &mut part, data.len() as u64, &mut |_| {}).expect("refetch");
        assert_eq!(
            *server.requests.lock().expect("requests"),
            vec![Some(SPLIT), None],
            "a mismatched Content-Range must be answered with a fresh request"
        );
        assert_eq!(fs::read(dir.join("model.gguf.part")).expect("read"), data);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_server_that_overruns_is_stopped_at_the_promised_size() {
        let dir = scratch("fetch-overrun");
        let data = payload(1024 * 1024);
        let server = httptest::serve(data.clone(), RangeMode::Overrun);
        let mut part = PartFile::claim(dir.join("model.gguf.part")).expect("claim");
        let err = fetch(&server.url, &mut part, data.len() as u64, &mut |_| {})
            .expect_err("the overrun must be refused");
        assert!(
            matches!(&err, DownloadError::Io(e) if e.kind() == io::ErrorKind::InvalidData),
            "{err:?}"
        );
        assert_eq!(
            part.len().expect("len"),
            data.len() as u64,
            "not one byte past the promise"
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
