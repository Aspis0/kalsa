//! The room route tests' own harness: labeled device sets, ordinary
//! request helpers, and an SSE reader that waits for what it owes.

use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use super::{DeviceEntry, DeviceId, Devices};

/// One scratch directory per call, unique across the process's tests.
pub(super) fn scratch(name: &str) -> PathBuf {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let unique = NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "kalsa-door-room-{name}-{unique}-{}",
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// The device set the room's tests use: each id with the label the owner
/// gave it, exactly as the app hands the door its stored devices.
pub(super) fn devices_labeled(entries: &[(u32, &str, &str)]) -> Devices {
    let entries = entries
        .iter()
        .map(|(id, label, token)| {
            DeviceEntry::new(DeviceId::new(*id), label.to_string(), token.to_string()).unwrap()
        })
        .collect();
    Devices::new(entries).unwrap()
}

/// One request, one answer: the door's own model, and the room's routes
/// are ordinary answers.
pub(super) fn raw(
    address: std::net::SocketAddr,
    authorization: Option<&str>,
    method: &str,
    target: &str,
    body: &str,
    extra: &[&str],
) -> TcpStream {
    let auth = authorization
        .map(|value| format!("Authorization: {value}\r\n"))
        .unwrap_or_default();
    let extra = extra
        .iter()
        .map(|header| format!("{header}\r\n"))
        .collect::<String>();
    let mut stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(
        stream,
        "{method} {target} HTTP/1.1\r\nHost: localhost\r\n{auth}{extra}\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
    .unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    stream
}

pub(super) fn get_with_header(
    address: std::net::SocketAddr,
    authorization: &str,
    target: &str,
    header: &str,
) -> Vec<u8> {
    read_all(&mut raw(address, Some(authorization), "GET", target, "", &[header]))
}

pub(super) fn post_with_header(
    address: std::net::SocketAddr,
    authorization: &str,
    target: &str,
    body: &str,
    header: &str,
) -> Vec<u8> {
    read_all(&mut raw(
        address,
        Some(authorization),
        "POST",
        target,
        body,
        &[header],
    ))
}

pub(super) fn read_all(stream: &mut TcpStream) -> Vec<u8> {
    let mut response = Vec::new();
    stream.read_to_end(&mut response).unwrap();
    response
}

pub(super) fn get(address: std::net::SocketAddr, authorization: Option<&str>, target: &str) -> Vec<u8> {
    read_all(&mut raw(address, authorization, "GET", target, "", &[]))
}

pub(super) fn post(
    address: std::net::SocketAddr,
    authorization: Option<&str>,
    target: &str,
    body: &str,
) -> Vec<u8> {
    read_all(&mut raw(address, authorization, "POST", target, body, &[]))
}

pub(super) fn put(
    address: std::net::SocketAddr,
    authorization: Option<&str>,
    target: &str,
    body: &str,
) -> Vec<u8> {
    read_all(&mut raw(address, authorization, "PUT", target, body, &[]))
}

/// Opens the events stream without closing the write side: a follower
/// keeps reading, so the socket must stay whole.
pub(super) fn stream_get(
    address: std::net::SocketAddr,
    authorization: &str,
    target: &str,
    last_event_id: Option<&str>,
) -> TcpStream {
    let resume = last_event_id
        .map(|seen| format!("Last-Event-ID: {seen}\r\n"))
        .unwrap_or_default();
    let mut stream = TcpStream::connect(address).unwrap();
    stream.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
    write!(
        stream,
        "GET {target} HTTP/1.1\r\nHost: localhost\r\nAuthorization: {authorization}\r\n\
         {resume}Content-Length: 0\r\nConnection: close\r\n\r\n"
    )
    .unwrap();
    stream
}

/// An SSE reader that waits for its needle and hands back everything it
/// read along the way.
pub(super) struct Reader;

impl Reader {
    pub(super) fn until(stream: &mut TcpStream, needle: &[u8], patience: Duration) -> String {
        let deadline = Instant::now() + patience;
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            let mut chunk = [0u8; 1024];
            match stream.read(&mut chunk) {
                Ok(0) => break,
                Ok(read) => {
                    seen.extend_from_slice(&chunk[..read]);
                    if seen.windows(needle.len()).any(|window| window == needle) {
                        break;
                    }
                }
                Err(_) => {}
            }
        }
        String::from_utf8_lossy(&seen).to_string()
    }
}

pub(super) fn text_of(response: &[u8]) -> String {
    String::from_utf8_lossy(response).to_string()
}

/// The answer's json body, from the blank line after the head.
pub(super) fn body_json(response: &[u8]) -> serde_json::Value {
    let text = text_of(response);
    let body = text.split("\r\n\r\n").nth(1).unwrap_or("");
    serde_json::from_str(body).unwrap_or_else(|_| panic!("the answer's body is not json: {text}"))
}
