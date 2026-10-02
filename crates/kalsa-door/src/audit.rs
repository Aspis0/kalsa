//! The door's own lines on the log: ids, codes, counts and durations.
//!
//! One request leaves one line, written by the guard [`begin`] installs for the
//! whole call: the status and the byte count are fed by the answers as they go
//! out ([`note_answer`], through `proxy::answer`), so a refusal no branch
//! remembered to report still says what it answered. The guard is a
//! thread-local because the answer writers sit deep below `handle` — the
//! room's routes, the disk tier's — and every connection is served by one
//! worker thread from accept to return, so the slot belongs to exactly one
//! request at a time. The guard clears it on every way out, an unwind
//! included.
//!
//! What never reaches a line: a query string, a chat id, a message body, a
//! credential. A route is cut at its first `?`, a chat id is written as four
//! bytes of its SHA-256, and no function here is ever handed a body.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Instant;

use crate::devices::DeviceId;

pub(crate) mod line;

thread_local! {
    /// The request this worker thread is inside, if any.
    static CURRENT: RefCell<Option<Rc<RequestLog>>> = const { RefCell::new(None) };
}

/// One request as the log will name it. Interior mutability because the
/// writers that fill it in are free functions the request never passes
/// through.
struct RequestLog {
    started: Instant,
    method: RefCell<String>,
    route: RefCell<String>,
    device: Cell<Option<DeviceId>>,
    status: Cell<Option<u16>>,
    reason: RefCell<Option<String>>,
    bytes: Cell<u64>,
    streamed: Cell<bool>,
}

/// The guard `handle` holds for the whole request. Dropping it clears the
/// thread's slot and writes the line, whatever path the request left by.
pub(crate) struct Audit(Option<Rc<RequestLog>>);

pub(crate) fn begin() -> Audit {
    let log = Rc::new(RequestLog {
        started: Instant::now(),
        method: RefCell::new("?".to_string()),
        route: RefCell::new("?".to_string()),
        device: Cell::new(None),
        status: Cell::new(None),
        reason: RefCell::new(None),
        bytes: Cell::new(0),
        streamed: Cell::new(false),
    });
    CURRENT.with(|slot| *slot.borrow_mut() = Some(Rc::clone(&log)));
    Audit(Some(log))
}

impl Drop for Audit {
    fn drop(&mut self) {
        CURRENT.with(|slot| *slot.borrow_mut() = None);
        if let Some(log) = self.0.take() {
            log::info!("{}", request_line(&log));
        }
    }
}

/// Runs `f` over this thread's request, if one is installed.
fn current<T>(f: impl FnOnce(&RequestLog) -> T) -> Option<T> {
    CURRENT.with(|slot| slot.borrow().as_ref().map(|log| f(log)))
}

/// The request line, once the head has been read.
pub(crate) fn head(method: &[u8], target: &[u8]) {
    current(|log| {
        *log.method.borrow_mut() = method_of(method);
        *log.route.borrow_mut() = route_of(target);
    });
}

pub(crate) fn device(device: DeviceId) {
    current(|log| log.device.set(Some(device)));
}

/// The status, when a writer did not already leave one: the first answer's
/// status line is the request's, and a second write (a stream's frames) must
/// not overwrite it.
pub(crate) fn status(status: u16) {
    current(|log| {
        if log.status.get().is_none() {
            log.status.set(Some(status));
        }
    });
}

/// The stable reason code of a refusal, first writer wins: the deepest
/// decision (the disk tier's, the lease's) knows more than the fallback the
/// route branch adds afterwards.
pub(crate) fn reason(code: &str) {
    current(|log| {
        let mut reason = log.reason.borrow_mut();
        if reason.is_none() {
            *reason = Some(code.to_string());
        }
    });
}

/// The answer continues on another thread (the room's live stream): the
/// numbers on this line are the door's part of it, and the word says so.
pub(crate) fn streamed() {
    current(|log| log.streamed.set(true));
}

/// Whether the answer so far is a refusal. The room branch's own fallback
/// code is set only when the room's route answered one — its answers carry
/// their own codes inside the body, which this line does not read.
pub(crate) fn answered_refusal() -> bool {
    current(|log| log.status.get().is_some_and(|status| status >= 400)).unwrap_or(false)
}

/// One answer's bytes, and its status line when they begin with one.
pub(crate) fn note_answer(bytes: &[u8]) {
    current(|log| {
        log.bytes.set(log.bytes.get() + bytes.len() as u64);
        if log.status.get().is_none() {
            if let Some(status) = status_of(bytes) {
                log.status.set(Some(status));
            }
        }
    });
}

/// The one request line. Every field is a number, a word or a path this
/// module has already stripped of everything else.
fn request_line(log: &RequestLog) -> String {
    let device = log
        .device
        .get()
        .map(|device| device.value().to_string())
        .unwrap_or_else(|| "?".to_string());
    let status = log
        .status
        .get()
        .map(|status| status.to_string())
        .unwrap_or_else(|| "?".to_string());
    let reason = match log.reason.borrow().as_deref() {
        Some(code) => format!(" reason {code}"),
        None => String::new(),
    };
    let streamed = if log.streamed.get() { " stream" } else { "" };
    format!(
        "door request: {} {} device {device} status {status}{reason} {}ms {}b{streamed}",
        log.method.borrow(),
        log.route.borrow(),
        log.started.elapsed().as_millis(),
        log.bytes.get(),
    )
}

/// The status line's own code, when the bytes begin with one (`HTTP/1.1 204…`).
fn status_of(bytes: &[u8]) -> Option<u16> {
    let rest = bytes.strip_prefix(b"HTTP/1.1 ")?;
    std::str::from_utf8(rest.get(..3)?).ok()?.parse().ok()
}

/// The method token: uppercase ASCII HTTP methods, or `?`. A client cannot
/// write anything of its own into the line through this field.
fn method_of(method: &[u8]) -> String {
    let token: String = method.iter().map(|byte| *byte as char).collect();
    let known = !token.is_empty() && token.len() <= 16 && token.bytes().all(|b| b.is_ascii_uppercase());
    if known { token } else { "?".to_string() }
}

/// The route, without its query or fragment: the query is the client's (a
/// signed URL, a token) and never reaches the file. Printable ASCII only,
/// so no control byte can be written into a line either.
pub(crate) fn route_of(target: &[u8]) -> String {
    let path = target
        .split(|byte| *byte == b'?' || *byte == b'#')
        .next()
        .unwrap_or(target);
    path.iter()
        .map(|byte| if (0x21..=0x7e).contains(byte) { *byte as char } else { '?' })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MESSAGE: &str = "ciao, my answer is 42 and my name is Marco";

    #[test]
    fn a_request_line_carries_the_route_and_never_the_query_or_a_body() {
        // The target of a real request, with a credential-shaped query: the
        // line must keep the path and nothing after it.
        let target = format!("/v1/chat/completions?api_key=sk-secret&q={MESSAGE}")
            .into_bytes();
        let line = request_line(&RequestLog {
            started: Instant::now(),
            method: RefCell::new(method_of(b"POST")),
            route: RefCell::new(route_of(&target)),
            device: Cell::new(Some(DeviceId::new(3))),
            status: Cell::new(Some(200)),
            reason: RefCell::new(None),
            bytes: Cell::new(4096),
            streamed: Cell::new(false),
        });
        assert!(
            line.starts_with("door request: POST /v1/chat/completions device 3 status 200 "),
            "{line}"
        );
        assert!(line.ends_with("ms 4096b"), "{line}");
        assert!(!line.contains("sk-secret"), "{line}");
        assert!(!line.contains("api_key"), "{line}");
        assert!(!line.contains(MESSAGE), "{line}");
        assert!(!line.contains('?'), "{line}");
        assert!(!line.contains('&'), "{line}");
    }

    #[test]
    fn a_refusal_line_names_its_status_and_reason_code() {
        let line = request_line(&RequestLog {
            started: Instant::now(),
            method: RefCell::new(method_of(b"POST")),
            route: RefCell::new(route_of(b"/kalsa/chat/activate?token=SECRET")),
            device: Cell::new(Some(DeviceId::new(2))),
            status: Cell::new(Some(503)),
            reason: RefCell::new(Some("door.no_slot".to_string())),
            bytes: Cell::new(61),
            streamed: Cell::new(false),
        });
        assert!(
            line.starts_with(
                "door request: POST /kalsa/chat/activate device 2 status 503 reason door.no_slot "
            ),
            "{line}"
        );
        assert!(!line.contains("SECRET"), "{line}");
    }

    #[test]
    fn a_client_cannot_write_anything_into_a_route() {
        assert_eq!(route_of(b"/v1/models?after=9#frag"), "/v1/models");
        assert_eq!(route_of(b"/kalsa/chat/activate"), "/kalsa/chat/activate");
        assert_eq!(route_of(b"\x1b[31m/evil\r\n"), "?[31m/evil??");
        assert_eq!(method_of(b"GET"), "GET");
        assert_eq!(method_of(b"get"), "?");
        assert_eq!(method_of(b"GET\r\nX: y"), "?");
        assert_eq!(method_of(b""), "?");
        assert_eq!(status_of(b"HTTP/1.1 503 Service Unavailable\r\n"), Some(503));
        assert_eq!(status_of(b"POST /x HTTP/1.1"), None);
    }
}
