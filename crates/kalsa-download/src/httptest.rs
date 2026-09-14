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
    /// No length at all, and more bytes than the caller was promised.
    Overrun,
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
    if matches!(mode, RangeMode::Overrun) {
        // No Content-Length: the body ends when the connection does — late.
        let head = "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n";
        stream.write_all(head.as_bytes())?;
        stream.write_all(content)?;
        return stream.write_all(&content[..OVERRUN]);
    }
    let range = read_range(&mut stream, seen)?;
    let len = content.len() as u64;
    match range.filter(|_| matches!(mode, RangeMode::Honor | RangeMode::Lie)) {
        None => {
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n"
            );
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
