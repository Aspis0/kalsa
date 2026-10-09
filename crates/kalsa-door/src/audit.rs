//! The door's own lines on the log: ids, codes, counts and durations.
//!
//! One request leaves one line, written by the guard [`begin`] installs for the
//! whole call: the status and the byte count are fed by the answers as they go
//! out ([`note_answer`], through `proxy::answer`), and a completion's own
//! counters arrive through [`note_timings`] (`crate::timings`), so a refusal
//! no branch remembered to report still says what it answered and a slow
//! completion can be split into re-reading versus generating. The guard is a
//! thread-local because the answer writers sit deep below `handle` — the
//! room's routes, the disk tier's — and every connection is served by one
//! worker thread from accept to return, so the slot belongs to exactly one
//! request at a time. The guard clears it on every way out, an unwind
//! included.
//!
//! What never reaches a line: a query string, a chat id, a message body, a
//! credential, or the client's own path bytes. The route field is a closed
//! vocabulary of templates the door names, and anything else is `other`.
//! A chat id is written as four bytes of its SHA-256, and no function here is
//! ever handed a body.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Instant;

use crate::devices::DeviceId;
use crate::timings::Timings;

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
    timings: RefCell<Option<Timings>>,
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
        timings: RefCell::new(None),
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

/// The engine's own counters for a completion, as its answer carried them.
/// The stream sends them more than once (the final chunk most completely),
/// so the LAST writer wins — it is the final value that says how the whole
/// completion was spent. The type is numbers only, so nothing a client or
/// the model wrote can ride in beside them.
pub(crate) fn note_timings(timings: Timings) {
    current(|log| *log.timings.borrow_mut() = Some(timings));
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
    let timings = log
        .timings
        .borrow()
        .as_ref()
        .map(|timings| timings.line_suffix())
        .unwrap_or_default();
    format!(
        "door request: {} {} device {device} status {status}{reason} {}ms {}b{streamed}{timings}",
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
    let known =
        !token.is_empty() && token.len() <= 16 && token.bytes().all(|b| b.is_ascii_uppercase());
    if known {
        token
    } else {
        "?".to_string()
    }
}

/// The forwarded spellings the product sends. The door forwards every path to
/// the engine, so its vocabulary here is the set the app and its phones use —
/// the completion and props spellings are the proxy's own two suffix matchers
/// (`is_completion`, `is_props`), the rest are the engine's own routes.
const FORWARDED: &[&[u8]] = &[
    b"/v1/chat/completions",
    b"/chat/completions",
    b"/v1/completions",
    b"/completion",
    b"/v1/props",
    b"/props",
    b"/health",
    b"/v1/models",
    b"/tokenize",
    b"/detokenize",
];

/// The door's route templates, or `other`. A closed vocabulary on purpose: a
/// request target is attacker-chosen bytes — an absolute-form one can carry a
/// user, a password and a host — and only a template this module names may
/// reach the line. Every arm is one of the door's own routers: [`crate::paging`]
/// and [`crate::room`] for the door's routes, [`crate::slot_routes`] for the
/// engine's refused ones (escapes decoded, as the engine decodes them), and the
/// forwarded spellings above. Ids collapse to `<id>`, and a path none of them
/// names is `other`: the log under-reports rather than echoes.
pub(crate) fn route_of(target: &[u8]) -> String {
    // The query is cut first: every arm below is about the path, and a query
    // is the client's (a signed URL, a token) wherever it hangs.
    let path = cut(target);
    if crate::room::owns(path) {
        return match path {
            b"/kalsa/room/info" => "/kalsa/room/info",
            b"/kalsa/room/history" => "/kalsa/room/history",
            b"/kalsa/room/messages" => "/kalsa/room/messages",
            b"/kalsa/room/call" => "/kalsa/room/call",
            b"/kalsa/room/name" => "/kalsa/room/name",
            b"/kalsa/room/events" => "/kalsa/room/events",
            b"/kalsa/room/media" => "/kalsa/room/media",
            // The upload and download paths carry ids only; the template
            // says so and echoes none of them.
            _ if path.starts_with(b"/kalsa/room/media/") => "/kalsa/room/media/<id>",
            _ => "other",
        }
        .to_string();
    }
    if crate::paging::owns(path) {
        return match crate::paging::route(path) {
            Some(crate::paging::Route::Activate) => "/kalsa/chat/activate".to_string(),
            Some(crate::paging::Route::Erase) => "/kalsa/chat/erase".to_string(),
            None => "other".to_string(),
        };
    }
    if crate::slot_routes::is_slot_route(path) {
        return if path.starts_with(b"/slots/") {
            "/slots/<id>".to_string()
        } else {
            "/slots".to_string()
        };
    }
    if path
        .strip_prefix(b"/v1/models/")
        .is_some_and(|id| !id.is_empty())
    {
        return "/v1/models/<id>".to_string();
    }
    if FORWARDED.contains(&path) {
        // The match above proved these are one of the constants, so nothing
        // of a client's choosing can be in them.
        return String::from_utf8_lossy(path).into_owned();
    }
    "other".to_string()
}

/// The path of a target: everything from the first `#` is dropped, then from
/// the first `?` — the same cut the engine and the proxy's own matchers make.
fn cut(target: &[u8]) -> &[u8] {
    let target = match target.iter().position(|byte| *byte == b'#') {
        Some(at) => &target[..at],
        None => target,
    };
    match target.iter().position(|byte| *byte == b'?') {
        Some(at) => &target[..at],
        None => target,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MESSAGE: &str = "ciao, my answer is 42 and my name is Marco";

    #[test]
    fn a_request_line_carries_the_route_and_never_the_query_or_a_body() {
        // The target of a real request, with a credential-shaped query: the
        // line must keep the path and nothing after it.
        let target = format!("/v1/chat/completions?api_key=sk-secret&q={MESSAGE}").into_bytes();
        let line = request_line(&RequestLog {
            started: Instant::now(),
            method: RefCell::new(method_of(b"POST")),
            route: RefCell::new(route_of(&target)),
            device: Cell::new(Some(DeviceId::new(3))),
            status: Cell::new(Some(200)),
            reason: RefCell::new(None),
            bytes: Cell::new(4096),
            streamed: Cell::new(false),
            timings: RefCell::new(None),
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
            timings: RefCell::new(None),
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
    fn the_route_is_a_closed_vocabulary_and_never_the_clients_bytes() {
        // The door's own routes, by its own routers.
        assert_eq!(route_of(b"/kalsa/chat/activate"), "/kalsa/chat/activate");
        assert_eq!(
            route_of(b"/kalsa/chat/activate?token=SECRET"),
            "/kalsa/chat/activate"
        );
        assert_eq!(route_of(b"/kalsa/chat/erase"), "/kalsa/chat/erase");
        assert_eq!(route_of(b"/kalsa/room/history"), "/kalsa/room/history");
        assert_eq!(
            route_of(b"/kalsa/room/events?after=9#frag"),
            "/kalsa/room/events"
        );
        assert_eq!(route_of(b"/kalsa/room/media"), "/kalsa/room/media");
        assert_eq!(
            route_of(b"/kalsa/room/media/5f1e2d3c4b5a69788796a5b4c3d2e1f0"),
            "/kalsa/room/media/<id>"
        );
        assert_eq!(
            route_of(b"/kalsa/room/media/5f1e2d3c4b5a69788796a5b4c3d2e1f0/complete"),
            "/kalsa/room/media/<id>"
        );
        // The engine's refused ones, decoded by the door's own matcher.
        assert_eq!(route_of(b"/slots"), "/slots");
        assert_eq!(route_of(b"/slots/3"), "/slots/<id>");
        assert_eq!(route_of(b"/%u0073%u006c%u006f%u0074%u0073"), "/slots");
        // The forwarded spellings the product sends.
        assert_eq!(
            route_of(b"/v1/chat/completions?api_key=sk-secret#f"),
            "/v1/chat/completions"
        );
        assert_eq!(route_of(b"/v1/completions"), "/v1/completions");
        assert_eq!(route_of(b"/props"), "/props");
        assert_eq!(route_of(b"/health"), "/health");
        assert_eq!(route_of(b"/v1/models"), "/v1/models");
        // An id collapses to the placeholder, whatever it is.
        assert_eq!(route_of(b"/v1/models/kalsa-3?x=1"), "/v1/models/<id>");
        assert_eq!(route_of(b"/v1/models/secret-model"), "/v1/models/<id>");
    }

    #[test]
    fn a_target_that_is_not_a_template_logs_as_other() {
        // An absolute-form target, the P0's shape: authority with a user and
        // a password, and a path that exists. None of it may be echoed.
        let absolute = b"http://user:password@127.0.0.1:8131/v1/chat/completions?token=SECRET";
        let line = route_line(absolute);
        assert!(
            line.starts_with("door request: POST other device 3 status 400 "),
            "{line}"
        );
        assert!(line.ends_with("ms 1b"), "{line}");
        for secret in ["user", "password", "127.0.0.1", "8131", "SECRET"] {
            assert!(!line.contains(secret), "{line}");
        }
        // Junk bytes and near-misses: `other`, never the bytes.
        for target in [
            b"\x1b[31mEVIL\r\n".as_slice(),
            b"/v1/chat/completions/../../etc".as_slice(),
            b"/kalsa/chat/activate/../..".as_slice(),
            b"/kalsa/other".as_slice(),
            b"/v1/logline-shape-probe".as_slice(),
            b"*".as_slice(),
        ] {
            assert_eq!(route_of(target), "other", "{target:?}");
            let line = route_line(target);
            let shown = String::from_utf8_lossy(target);
            assert!(!line.contains(&*shown), "echoed {target:?} into {line}");
            assert!(line.contains("POST other"), "{line}");
        }
        assert_eq!(method_of(b"GET"), "GET");
        assert_eq!(method_of(b"get"), "?");
        assert_eq!(method_of(b"GET\r\nX: y"), "?");
        assert_eq!(method_of(b""), "?");
        assert_eq!(
            status_of(b"HTTP/1.1 503 Service Unavailable\r\n"),
            Some(503)
        );
        assert_eq!(status_of(b"POST /x HTTP/1.1"), None);
    }

    /// One request line for a target, built the way `handle` fills it.
    fn route_line(target: &[u8]) -> String {
        request_line(&RequestLog {
            started: Instant::now(),
            method: RefCell::new(method_of(b"POST")),
            route: RefCell::new(route_of(target)),
            device: Cell::new(Some(DeviceId::new(3))),
            status: Cell::new(Some(400)),
            reason: RefCell::new(None),
            bytes: Cell::new(1),
            streamed: Cell::new(false),
            timings: RefCell::new(None),
        })
    }
}
