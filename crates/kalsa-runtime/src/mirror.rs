//! One archive, two sources: the app's CDN first, then its mirror.
//!
//! The mirror is safe because it is not trusted: `download` publishes a part only when its size and
//! sha256 match the row. A CDN prefix the mirror resumes can end in a size or digest mismatch.

use std::io;
use std::path::Path;
use std::thread;
use std::time::Duration;

use kalsa_download::{download, DownloadError, Progress};

const LOCK_RETRIES: u32 = 10;
const LOCK_RETRY_PAUSE: Duration = Duration::from_millis(50);

/// Downloads `url` into `dest`, and from `mirror` when that fails.
///
/// Only a failure of the source itself falls through: the wire, an HTTP
/// refusal, wrong bytes (`download` has already deleted that part). A local
/// failure — the part file, the disk — would repeat on the mirror, so it is
/// returned at once, the mirror's own included. When both sources fail the
/// CDN's error is returned, so every caller keeps the words and the
/// classification it had before the mirror existed.
///
/// `progress` counts bytes of the file, not of attempts: it never exceeds the
/// total, and it restarts from zero only when the part was thrown away.
pub(crate) fn download_with_mirror(
    url: &str,
    mirror: Option<&str>,
    dest: &Path,
    size: u64,
    sha: &str,
    progress: &mut dyn FnMut(Progress),
) -> Result<(), DownloadError> {
    let first = match download(url, dest, size, sha, progress) {
        Err(error) if !is_local(&error) => error,
        done => return done,
    };
    let Some(mirror) = mirror else {
        return Err(first);
    };
    match download_from_mirror(mirror, dest, size, sha, progress) {
        Err(error) if is_local(&error) => Err(error),
        Err(_) => Err(first),
        done => done,
    }
}

/// The mirror resumes whatever prefix the CDN left in the part, and a 206 is
/// accepted on its start alone, so the joined file can fail the gate. `download`
/// has then deleted the part: one more attempt starts from zero.
fn download_from_mirror(
    url: &str,
    dest: &Path,
    size: u64,
    sha: &str,
    progress: &mut dyn FnMut(Progress),
) -> Result<(), DownloadError> {
    match download_retrying_lock(url, dest, size, sha, progress) {
        Err(DownloadError::SizeMismatch { .. } | DownloadError::DigestMismatch { .. }) => {
            download_retrying_lock(url, dest, size, sha, progress)
        }
        done => done,
    }
}

/// `download`, retrying only a part file that is still locked. The first
/// source's lock can outlive its close for an instant — a process spawned on
/// another thread holds the file description until its exec — and a claim
/// that gives up on that would skip the mirror for nothing. `WouldBlock` comes
/// from the claim alone, before a byte moves, so repeating is harmless.
fn download_retrying_lock(
    url: &str,
    dest: &Path,
    size: u64,
    sha: &str,
    progress: &mut dyn FnMut(Progress),
) -> Result<(), DownloadError> {
    let mut result = download(url, dest, size, sha, progress);
    for _ in 0..LOCK_RETRIES {
        match &result {
            Err(DownloadError::Io(e)) if e.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(LOCK_RETRY_PAUSE);
                result = download(url, dest, size, sha, progress);
            }
            _ => break,
        }
    }
    result
}

fn is_local(error: &DownloadError) -> bool {
    matches!(
        error,
        DownloadError::Io(_) | DownloadError::DiskFull | DownloadError::NotEnoughSpace { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::thread;

    const GOOD: &[u8] = b"the bytes the table promises";

    /// Same length as `GOOD`, so only the digest can tell them apart.
    const BAD: &[u8] = b"the bytes a proxy substitute";

    /// A loopback server that answers every request, counting them.
    struct Source {
        url: String,
        hits: Arc<AtomicUsize>,
    }

    fn serve(body: &'static [u8]) -> Source {
        serve_with("200 OK", body)
    }

    /// A source that is up but refuses: an HTTP error, which is how a blocked
    /// or broken CDN answers when it answers at all. A closed port would
    /// need a freed one, and a parallel test can bind it back.
    fn refuse() -> Source {
        serve_with("503 Service Unavailable", b"")
    }

    fn serve_with(status: &'static str, body: &'static [u8]) -> Source {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let url = format!(
            "http://{}/archive.zip",
            listener.local_addr().expect("addr")
        );
        let hits = Arc::new(AtomicUsize::new(0));
        let counted = Arc::clone(&hits);
        thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                counted.fetch_add(1, Ordering::SeqCst);
                let mut head = [0u8; 4096];
                let read = stream.read(&mut head).unwrap_or(0);
                let request = String::from_utf8_lossy(&head[..read]);
                // A resume is answered like a real CDN does: 206, from the
                // offset asked for — whatever the bytes before it were.
                let from = request
                    .lines()
                    .find_map(|line| line.strip_prefix("Range: bytes="))
                    .and_then(|range| range.trim_end_matches('-').parse::<usize>().ok())
                    .filter(|from| *from > 0 && *from < body.len() && status == "200 OK");
                let _ = match from {
                    Some(from) => write!(
                        stream,
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\n\
                         Content-Range: bytes {from}-{}/{}\r\nConnection: close\r\n\r\n",
                        body.len() - from,
                        body.len() - 1,
                        body.len()
                    )
                    .and_then(|()| stream.write_all(&body[from..])),
                    None => write!(
                        stream,
                        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    )
                    .and_then(|()| stream.write_all(body)),
                };
            }
        });
        Source { url, hits }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-runtime-mirror-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn run(
        url: &str,
        mirror: &str,
        dest: &Path,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<(), DownloadError> {
        let sha = format!("{:x}", Sha256::digest(GOOD));
        download_with_mirror(url, Some(mirror), dest, GOOD.len() as u64, &sha, progress)
    }

    #[test]
    fn a_refusing_primary_falls_through_to_the_mirror() {
        let dir = scratch("refused");
        let dest = dir.join("archive.zip");
        let primary = refuse();
        let mirror = serve(GOOD);
        run(&primary.url, &mirror.url, &dest, &mut |_| {}).expect("the mirror serves it");
        assert_eq!(primary.hits.load(Ordering::SeqCst), 1);
        assert_eq!(std::fs::read(&dest).expect("read"), GOOD);
        assert_eq!(mirror.hits.load(Ordering::SeqCst), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bad_bytes_from_the_primary_are_deleted_and_the_mirror_is_asked() {
        let dir = scratch("bad-bytes");
        let dest = dir.join("archive.zip");
        let primary = serve(BAD);
        let mirror = serve(GOOD);
        let mut seen = Vec::new();
        run(&primary.url, &mirror.url, &dest, &mut |p| seen.push(p)).expect("the mirror serves it");
        assert_eq!(std::fs::read(&dest).expect("read"), GOOD);
        assert_eq!(primary.hits.load(Ordering::SeqCst), 1);
        assert_eq!(mirror.hits.load(Ordering::SeqCst), 1);
        assert!(!dir.join("archive.zip.part").exists());
        assert!(
            seen.iter().all(|p| p.bytes_done <= p.bytes_total),
            "no event may count past the promised total: {seen:?}"
        );
        assert_eq!(seen.last().map(|p| p.bytes_done), Some(GOOD.len() as u64));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn when_both_fail_the_error_is_the_primarys() {
        let dir = scratch("both");
        let dest = dir.join("archive.zip");
        let primary = refuse();
        let mirror = serve(BAD);
        let err = run(&primary.url, &mirror.url, &dest, &mut |_| {}).expect_err("neither works");
        assert!(
            matches!(err, DownloadError::Refused { status: 503 }),
            "the CDN's own error, not the mirror's digest mismatch: {err}"
        );
        assert_eq!(
            mirror.hits.load(Ordering::SeqCst),
            2,
            "the mirror was tried, and once more from scratch — no more"
        );
        assert!(!dest.exists());
        assert!(!dir.join("archive.zip.part").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_good_primary_never_touches_the_mirror() {
        let dir = scratch("primary-ok");
        let dest = dir.join("archive.zip");
        let primary = serve(GOOD);
        let mirror = serve(GOOD);
        run(&primary.url, &mirror.url, &dest, &mut |_| {}).expect("the primary serves it");
        assert_eq!(mirror.hits.load(Ordering::SeqCst), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A destination that verified bytes cannot be published onto: a
    /// directory with something in it. A download reaches the end of the wire
    /// and then fails on the disk — local, AFTER the source was contacted.
    fn unpublishable_dest(dir: &Path) -> PathBuf {
        let dest = dir.join("archive.zip");
        std::fs::create_dir(&dest).expect("dest dir");
        std::fs::write(dest.join("occupant"), b"in the way").expect("occupant");
        dest
    }

    #[test]
    fn a_local_failure_on_the_cdn_side_does_not_go_to_the_mirror() {
        let dir = scratch("local-first");
        let dest = dir.join("archive.zip");
        // Another download holds the part file: the CDN's claim fails on the
        // disk. It lets go shortly after, inside the mirror attempt's lock
        // retries, so a walk that did fall through would succeed — and the
        // mirror's hit counter would show it.
        let held = std::fs::File::create(dir.join("archive.zip.part")).expect("part");
        held.lock().expect("lock");
        let release = thread::spawn(move || {
            thread::sleep(Duration::from_millis(120));
            drop(held);
        });
        let primary = serve(GOOD);
        let mirror = serve(GOOD);
        let err = run(&primary.url, &mirror.url, &dest, &mut |_| {}).expect_err("part is held");
        release.join().expect("release thread");
        assert!(
            matches!(&err, DownloadError::Io(e) if e.kind() == io::ErrorKind::WouldBlock),
            "{err}"
        );
        assert_eq!(mirror.hits.load(Ordering::SeqCst), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_local_failure_on_the_mirror_is_reported_as_itself() {
        let dir = scratch("local-mirror");
        let dest = unpublishable_dest(&dir);
        let primary = refuse();
        let mirror = serve(GOOD);
        let err = run(&primary.url, &mirror.url, &dest, &mut |_| {}).expect_err("cannot publish");
        assert!(
            matches!(err, DownloadError::Io(_)),
            "the disk's error, not the CDN's 503: {err}"
        );
        assert_eq!(primary.hits.load(Ordering::SeqCst), 1);
        assert_eq!(mirror.hits.load(Ordering::SeqCst), 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cdn_prefix_that_spoils_the_resume_is_retried_from_zero() {
        let dir = scratch("prefix");
        let dest = dir.join("archive.zip");
        // What a CDN that served other bytes left behind before it dropped.
        std::fs::write(dir.join("archive.zip.part"), &BAD[..14]).expect("prefix");
        let primary = refuse();
        let mirror = serve(GOOD);
        run(&primary.url, &mirror.url, &dest, &mut |_| {}).expect("the second try is whole");
        assert_eq!(std::fs::read(&dest).expect("read"), GOOD);
        assert_eq!(
            mirror.hits.load(Ordering::SeqCst),
            2,
            "the resume that failed the gate, then the fresh one"
        );
        assert!(!dir.join("archive.zip.part").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
