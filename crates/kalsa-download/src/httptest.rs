//! A throwaway origin for the tests, on `127.0.0.1:0`: the port is the OS's
//! to give, the content is the test's, and nothing outside the process is
//! touched. One hand-rolled status line apiece, like `health` in the
//! supervisor — no HTTP server dependency for a test fixture.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

/// What the origin does with a `Range` header. `Ignore` models the CDN that
/// answers 200 to a resume: the whole file is coming whether we asked or not.
pub enum RangeMode {
    Honor,
    Ignore,
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
    let honor = matches!(mode, RangeMode::Honor);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let _ = answer(stream, &content, honor, &seen);
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
    honor: bool,
    seen: &Mutex<Vec<Option<u64>>>,
) -> std::io::Result<()> {
    let range = read_range(&mut stream, seen)?;
    let len = content.len() as u64;
    match range.filter(|_| honor) {
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
        None => {
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(head.as_bytes())?;
            stream.write_all(content)
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
