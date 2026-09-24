//! The walk's one HTTP client: a chat completion sent straight to the
//! engine's loopback port — the request the door forwards upstream, without
//! the door.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde_json::Value;

/// A cold model compiles kernels on its first token; give it room.
const READ_TIMEOUT: Duration = Duration::from_secs(300);
/// How much of a non-200 body is shown: enough to name the cause, never so
/// much that the model's own words become the panic message.
const BODY_SHOWN: usize = 2048;

pub(super) fn chat_completion(port: u16, prompt: &str, max_tokens: u32) -> Value {
    let body = serde_json::json!({
        "messages": [{ "role": "user", "content": prompt }],
        "max_tokens": max_tokens,
    })
    .to_string();
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("the server answers its port");
    stream
        .set_read_timeout(Some(READ_TIMEOUT))
        .expect("a read timeout is set");
    let request = format!(
        "POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes()).expect("the request is sent");
    let mut response = Vec::new();
    stream.read_to_end(&mut response).expect("the response is read to the close");
    let header_end = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .expect("an HTTP response carries a header block");
    let head = String::from_utf8_lossy(&response[..header_end]).to_lowercase();
    let rest = &response[header_end + 4..];
    let status = head.lines().next().unwrap_or_default().to_string();
    // The status is decided before the body is parsed: an error body is
    // rarely JSON, and the panic must carry the server's own words, capped.
    assert!(
        status.contains(" 200 "),
        "the server answered {status}: {}",
        String::from_utf8_lossy(&rest[..rest.len().min(BODY_SHOWN)])
    );
    let body = if head.contains("transfer-encoding: chunked") {
        dechunk(rest)
    } else {
        rest.to_vec()
    };
    serde_json::from_slice(&body)
        .unwrap_or_else(|error| panic!("the body is not the JSON completion ({error})"))
}

/// Undoes `Transfer-Encoding: chunked` framing, which the engine may use
/// for a body whose length was not decided in advance. Every slice is
/// length-checked: a plain indexing panic would say "range" where the truth
/// is a truncated body.
fn dechunk(mut rest: &[u8]) -> Vec<u8> {
    let mut body = Vec::new();
    loop {
        let Some(line_end) = rest.windows(2).position(|window| window == b"\r\n") else {
            panic!(
                "truncated chunked body: no size line in the {} bytes left",
                rest.len()
            );
        };
        let size =
            usize::from_str_radix(size_text(&rest[..line_end]), 16).expect("a hex chunk size");
        rest = &rest[line_end + 2..];
        if size == 0 {
            return body;
        }
        let frame = size + 2; // the chunk and the CRLF after it
        assert!(
            rest.len() >= frame,
            "truncated chunked body: {} of {frame} bytes arrived",
            rest.len()
        );
        body.extend_from_slice(&rest[..size]);
        rest = &rest[frame..];
    }
}

fn size_text(line: &[u8]) -> &str {
    std::str::from_utf8(line)
        .expect("the chunk size is text")
        .split(';')
        .next()
        .expect("a chunk size line")
        .trim()
}
