//! Moving bytes, with a `Range` header so a broken connection costs only what
//! it lost.
//!
//! The part file is append-only truth: everything in it was really received.
//! A resume asks for `bytes=N-`; a 206 answer means the server understood, and
//! we append. A 200 answer means the Range was ignored and the whole file is
//! coming — appending would weld a full copy onto the partial one and produce
//! a corrupt file of exactly the right length, so the part file restarts from
//! zero instead. Any other answer is an error, and the part file stays as it
//! was: still resumable.

use std::fs::OpenOptions;
use std::io::{self, Read, Write};
use std::path::Path;

use crate::Progress;
use crate::verify::file_len;

/// Read chunk: big enough that the callbacks are not the bottleneck on a
/// laptop disk, small enough that the buffer is noise.
const CHUNK: usize = 64 * 1024;

/// Streams `url` onto `part`, starting at the part file's current length.
/// Leaves the part file in place — still resumable — on any transport error;
/// whether the finished file is the model is `verify`'s decision, not ours.
pub fn fetch(
    url: &str,
    part: &Path,
    expected_size: u64,
    progress: &mut dyn FnMut(Progress),
) -> io::Result<()> {
    let mut resume_from = file_len(part)?.unwrap_or(0);
    // Longer than the promise cannot be a prefix of it: not resumable.
    if resume_from > expected_size {
        resume_from = 0;
    }
    // Already complete: no request at all, verification decides. This is the
    // crash between last byte and rename, and it costs nothing.
    if resume_from == expected_size {
        return Ok(());
    }
    let resuming = resume_from > 0;
    let mut request = ureq::get(url);
    if resuming {
        request = request.set("Range", &format!("bytes={resume_from}-"));
    }
    let response = request
        .call()
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e.to_string()))?;
    let start = match response.status() {
        // The server is sending the requested suffix; append to it.
        206 if resuming => resume_from,
        // Range ignored, or no Range sent: the body starts at zero, so the
        // part file must too, whatever it held.
        200 => 0,
        code => {
            return Err(io::Error::new(
                io::ErrorKind::Other,
                format!("server answered HTTP {code}"),
            ))
        }
    };
    let mut file = if start > 0 {
        // Append-only: what is already in the part file was really received.
        OpenOptions::new().append(true).open(part)?
    } else {
        OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(part)?
    };
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
            break;
        }
        file.write_all(&chunk[..read])?;
        done += read as u64;
        progress(Progress {
            bytes_done: done,
            bytes_total: expected_size,
        });
    }
    Ok(())
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
        let part = dir.join("model.gguf.part");
        fs::write(&part, &data[..SPLIT as usize]).expect("partial file");
        fetch(&server.url, &part, data.len() as u64, &mut |_| {}).expect("resume");
        assert_eq!(fs::read(&part).expect("read"), data);
        assert_eq!(
            *server.requests.lock().expect("requests"),
            vec![Some(SPLIT)],
            "the server must be asked to skip the surviving prefix"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_200_to_a_range_request_restarts_from_zero() {
        let dir = scratch("fetch-restart");
        let data = payload(3 * SPLIT as usize);
        let server = httptest::serve(data.clone(), RangeMode::Ignore);
        let part = dir.join("model.gguf.part");
        fs::write(&part, &data[..SPLIT as usize]).expect("partial file");
        fetch(&server.url, &part, data.len() as u64, &mut |_| {}).expect("restart");
        // We did ask to resume…
        assert_eq!(
            *server.requests.lock().expect("requests"),
            vec![Some(SPLIT)]
        );
        // …and appending anyway would have produced the right length with the
        // wrong bytes, so exact equality is the assertion.
        assert_eq!(fs::read(&part).expect("read"), data);
        let _ = fs::remove_dir_all(&dir);
    }
}
