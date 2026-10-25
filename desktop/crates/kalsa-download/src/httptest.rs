//! A throwaway origin for the tests, on `127.0.0.1:0`: the port is the OS's
//! to give, the content is the test's, and nothing outside the process is
//! touched. One hand-rolled status line apiece, like `health` in the
//! supervisor — no HTTP server dependency for a test fixture.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

/// How far the skipped start of a lying 206 is past the prefix we asked for.
const LIE_SKIP: u64 = 64 * 1024;
/// How many bytes past the promised end the overrun body keeps going.
const OVERRUN: usize = 64 * 1024;
/// How many bytes the stalled origin sends before becoming silent.
pub const STALL_BYTES: usize = 4;

/// The ways the fixture can behave. The misbehaving modes exist because the
/// failures that matter only show up when the server lies.
pub enum RangeMode {
    /// 206 and the requested suffix: a well-behaved origin.
    Honor,
    /// 200 and the whole file: the CDN that ignores Range.
    Ignore,
    /// 206, but the Content-Range names an offset past the one we asked for:
    /// the body is not a continuation of our prefix.
    Lie,
    /// Declares — and sends — more bytes than the caller was promised.
    Overrun,
    /// Answers 403 and nothing else: the publisher refusing.
    Refused,
    /// Serves with no Content-Length, framed by the connection's close,
    /// and sends past the content's end: only the received bytes can
    /// reveal the overrun.
    Oversend,
    /// Declares u64::MAX bytes — honoring a Range with a 206 when one was
    /// asked, so a resumed prefix plus the declaration overflows the count.
    AbsurdLength,
    /// Answers 206 to any request with a Content-Range that starts at 5:
    /// a partial answer nobody asked for, unusable but not a refusal.
    Misplaced,
    /// Answers 304 with no Location: not an error status, and not usable.
    NotModified,
    /// Sends a response head and a short prefix, then stays connected and
    /// silent until the client gives up.
    Stall,
}

pub struct Server {
    pub url: String,
    /// Range start of every request so far, None when there was none.
    pub requests: Arc<Mutex<Vec<Option<u64>>>>,
}

/// Serves one fixed file until the test process ends.
pub fn serve(content: Vec<u8>, mode: RangeMode) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
    let port = listener.local_addr().expect("port").port();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let content = Arc::new(content);
    let seen = Arc::clone(&requests);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let _ = answer(stream, &content, &mode, &seen);
        }
    });
    Server {
        url: format!("http://127.0.0.1:{port}/model.gguf"),
        requests,
    }
}

/// One request per connection: `Connection: close` keeps both sides simple.
fn answer(
    mut stream: TcpStream,
    content: &[u8],
    mode: &RangeMode,
    seen: &Mutex<Vec<Option<u64>>>,
) -> std::io::Result<()> {
    let len = content.len() as u64;
    if matches!(mode, RangeMode::Stall) {
        let _ = read_range(&mut stream, seen)?;
        let head =
            format!("HTTP/1.1 200 OK\r\nContent-Length: {len}\r\nConnection: keep-alive\r\n\r\n");
        stream.write_all(head.as_bytes())?;
        stream.write_all(&content[..STALL_BYTES])?;
        std::thread::park();
    }
    if matches!(mode, RangeMode::Overrun) {
        // The overrun is declared in the header, so a client that reads it
        // can refuse before a single body byte; the body keeps its promise
        // to overrun anyway.
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            len + OVERRUN as u64
        );
        stream.write_all(head.as_bytes())?;
        stream.write_all(content)?;
        return stream.write_all(&content[..OVERRUN]);
    }
    if matches!(mode, RangeMode::Refused) {
        let head = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        return stream.write_all(head.as_bytes());
    }
    if matches!(mode, RangeMode::Oversend) {
        // The request is drained so the close is clean: an undrained socket
        // closes with a reset, and the reset would answer before the extra
        // bytes could. No declaration: a Content-Length would cap ureq's
        // reader at the declared count and the extra could never be seen.
        let _ = read_range(&mut stream, seen)?;
        let head = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
        stream.write_all(head.as_bytes())?;
        stream.write_all(content)?;
        return stream.write_all(&content[..OVERRUN]);
    }
    if matches!(mode, RangeMode::AbsurdLength) {
        let range = read_range(&mut stream, seen)?;
        let head = if let Some(start) = range {
            format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\n\
                 Content-Range: bytes {start}-{}/{}\r\nConnection: close\r\n\r\n",
                u64::MAX,
                u64::MAX - 1,
                u64::MAX
            )
        } else {
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                u64::MAX
            )
        };
        return stream.write_all(head.as_bytes());
    }
    if matches!(mode, RangeMode::Misplaced) {
        let _ = read_range(&mut stream, seen)?;
        let head = format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\n\
             Content-Range: bytes 5-{}/{}\r\nConnection: close\r\n\r\n",
            len.saturating_sub(5),
            len.saturating_sub(1),
            len
        );
        return stream.write_all(head.as_bytes());
    }
    if matches!(mode, RangeMode::NotModified) {
        let _ = read_range(&mut stream, seen)?;
        let head = "HTTP/1.1 304 Not Modified\r\nConnection: close\r\n\r\n";
        return stream.write_all(head.as_bytes());
    }
    let range = read_range(&mut stream, seen)?;
    match range.filter(|_| matches!(mode, RangeMode::Honor | RangeMode::Lie)) {
        None => {
            let head =
                format!("HTTP/1.1 200 OK\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n");
            stream.write_all(head.as_bytes())?;
            stream.write_all(content)
        }
        Some(start) if matches!(mode, RangeMode::Lie) => {
            // A 206 whose Content-Range does not start where we asked.
            let skipped = (start + LIE_SKIP).min(len);
            let head = format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\n\
                 Content-Range: bytes {skipped}-{}/{}\r\nConnection: close\r\n\r\n",
                len - skipped,
                len - 1,
                len,
            );
            stream.write_all(head.as_bytes())?;
            stream.write_all(&content[skipped as usize..])
        }
        Some(start) => {
            let head = format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\n\
                 Content-Range: bytes {start}-{}/{}\r\nConnection: close\r\n\r\n",
                len - start,
                len - 1,
                len,
            );
            stream.write_all(head.as_bytes())?;
            stream.write_all(&content[start as usize..])
        }
    }
}

/// Reads one request head and records its Range start.
fn read_range(
    stream: &mut TcpStream,
    seen: &Mutex<Vec<Option<u64>>>,
) -> std::io::Result<Option<u64>> {
    let mut range = None;
    {
        // TcpStream reads through a shared borrow, so the reader can be
        // dropped before the answer is written.
        let mut reader = BufReader::new(&*stream);
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                return Ok(None);
            }
            let line = line.trim_end();
            if line.is_empty() {
                break;
            }
            if let Some(spec) = line.strip_prefix("Range: bytes=") {
                range = spec.split('-').next().and_then(|start| start.parse().ok());
            }
        }
    }
    if let Ok(mut seen) = seen.lock() {
        seen.push(range);
    }
    Ok(range)
}
