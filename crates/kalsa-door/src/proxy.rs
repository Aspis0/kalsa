use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::cors;
use crate::devices::{DeviceId, Devices};
use crate::jobs::ResumeDecision;
use crate::registry::{Registry, StartRefused};
use crate::token::parse_resume;
use crate::request;
use crate::response;
use crate::slot_routes;
use crate::stream;
use crate::{busy_response, no_slot_response, unauthorized_response, upstream_failure_response, ActiveDevices, BUSY_RESPONSE, CONNECTION_LIFETIME, DeviceSet, LeaseError, PATIENCE, TOKEN_BYTES};

/// The observer type every serving path shares: it sees exactly the bytes
/// the client receives, never a byte it does not.
pub(super) type Observed = dyn Fn(&[u8]) + Send + Sync;

/// The conditions under which an in-flight exchange stops: the door is
/// shutting down, or the device it serves was revoked while the answer was
/// streaming. Checked between relay steps. The revocation half takes a
/// short read lock to look at an `Arc`; no lock is held across a streamed
/// body, so one long answer cannot serialize the house. The revocation gate
/// is the one deliberate exception: held across a head write, never across
/// the stream that follows.
pub(super) struct Cancel<'a> {
    stop: &'a AtomicBool,
    devices: &'a DeviceSet,
    device: DeviceId,
}

impl Cancel<'_> {
    pub(super) fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst) || !self.devices.holds(self.device)
    }

    /// The shared guard for a head write: the revocation check and the write
    /// are one step, so a `swap` that lands here waits for both.
    pub(super) fn revocation_gate(&self) -> std::sync::RwLockReadGuard<'_, ()> {
        self.devices.revocation_gate()
    }
}

pub(super) fn handle(
    mut client: TcpStream,
    accepted: Instant,
    head_patience: Duration,
    upstream_port: u16,
    capacity: u32,
    devices: &DeviceSet,
    registry: &Registry,
    stop: &AtomicBool,
    active: &ActiveDevices,
    observer: Option<&Observed>,
) {
    let deadline = accepted + CONNECTION_LIFETIME;
    // The head patience is the worker's, not the queue's: it counts from
    // when this worker begins reading, so a connection that waited in the
    // queue is not punished for the wait. The session lifetime, though, is
    // the connection's own, and keeps counting from accept.
    let started = Instant::now();
    let mut head = {
        let head_deadline = deadline.min(started + head_patience);
        // A connection past its lifetime is dead on arrival: it is closed
        // rather than read, whatever the head patience would say.
        if Instant::now() >= head_deadline {
            let _ = write_with_deadline(&mut client, BUSY_RESPONSE, head_deadline);
            return;
        }
        match request::read_head(&mut client, head_deadline) {
            Ok(head) => head,
            Err(()) => {
                // Two different facts, two different answers. If the
                // patience was already spent, the door never read a byte:
                // that is pressure, and the answer is the busy one. A head
                // that was read and found wanting is the unauthorized one.
                if Instant::now() >= head_deadline {
                    let _ = write_with_deadline(&mut client, BUSY_RESPONSE, deadline);
                } else {
                    // No head was parsed, so there is no origin to name.
                    let _ = refuse(&mut client, None, deadline);
                }
                return;
            }
        }
    };
    // A CORS preflight is answered here, before the credential scan: the
    // browser sends it WITHOUT the credential it is asking permission to
    // send, so authenticating it would answer `401` and the real request
    // would never leave the webview. This answer grants nothing — no
    // credential is read, no slot is leased, nothing is counted against the
    // capacity, and the upstream is never contacted — which is why it is
    // safe to give without one.
    if head.preflight {
        // The 204 must be readable: an unread body resets the socket on
        // close and erases it, the same trap the refusal path exists for.
        let _ = discard_request_body(&mut client, head.body_length, deadline);
        let _ = write_with_deadline(&mut client, &cors::preflight(head.origin.as_deref()), deadline);
        return;
    }
    // Authentication reads the CURRENT set, as a short-lived Arc: the lock
    // is gone by the time the credential scan runs, and the scan sees
    // either the whole old set or the whole new one.
    let current = devices.current();
    let device = match authenticated(head.authorization.as_deref(), &current) {
        Some(device) => device,
        None => {
            // The refusal must be readable: an unread body would reset the
            // socket on close and erase it. The body is bounded and the read is
            // deadline-bound; the request still goes nowhere.
            let _ = discard_request_body(&mut client, head.body_length, deadline);
            let _ = refuse(&mut client, head.origin.as_deref(), deadline);
            return;
        }
    };
    // The engine's own slot routes are addressed by URL and never consult the
    // slot header, so a paired device that reaches them reads or changes a
    // slot the door did not give it — `GET /slots` reports every slot's
    // prompt. Refused here, after the credential and before any lease: an
    // unauthenticated stranger still gets the 401 alone, and an authenticated
    // device spends no capacity, opens no upstream socket and forwards no
    // byte for a route the door will not serve.
    if slot_routes::is_slot_route(&head.target) {
        let _ = discard_request_body(&mut client, head.body_length, deadline);
        let answer = slot_routes::refusal_response(head.origin.as_deref());
        let _ = write_with_deadline(&mut client, &answer, deadline);
        return;
    }
    // The device's engine slot, under a lease that lasts the whole request.
    // Membership and allocation are one critical section: a device revoked
    // in the window between authentication and here is refused with the 401
    // rather than handed a slot it would keep forever, and a full house is
    // refused with the no-slot 503. The engine does not refuse for us (it
    // wraps `id_slot % slots.size()`), so the door is the only thing
    // standing between a device and somebody else's slot.
    let lease = match devices.lease(device) {
        Ok(lease) => lease,
        Err(LeaseError::NotHeld) => {
            let _ = discard_request_body(&mut client, head.body_length, deadline);
            let _ = refuse(&mut client, head.origin.as_deref(), deadline);
            return;
        }
        Err(LeaseError::NoRoom) => {
            let _ = discard_request_body(&mut client, head.body_length, deadline);
            let _ = write_with_deadline(&mut client, &no_slot_response(capacity, head.origin.as_deref()), deadline);
            return;
        }
    };
    // Presence for the running door: this device, exactly while the door is
    // inside this request. Only an authenticated, slotted device is counted.
    let _active = active.enter(device);
    let cancel = Cancel {
        stop,
        devices,
        device,
    };
    if let Some(last_event_id) = head.last_event_id.as_deref() {
        // Resuming never reaches the upstream: the answer this request asks
        // for already exists in the door or it does not. The retried body is
        // read and discarded first — an unread body sitting in the receive
        // buffer makes the kernel reset the socket on close, and a reset
        // erases everything the client had not read yet.
        if discard_request_body(&mut client, head.body_length, deadline).is_err() {
            return;
        }
        resume(
            &mut client,
            registry,
            last_event_id,
            head.origin.as_deref(),
            device,
            observer,
            deadline,
            &cancel,
        );
        return;
    }
    // The salt is fetched BEFORE any upstream socket exists: a device
    // revoked by then gets the 401 without the door opening a connection for
    // it. The lease holds its slot regardless, so a later revocation cannot
    // hand that slot to anybody else.
    let Some(salt) = devices.cache_salt(device) else {
        let _ = discard_request_body(&mut client, head.body_length, deadline);
        let _ = refuse(&mut client, head.origin.as_deref(), deadline);
        return;
    };
    let body_length = head.body_length;
    // `seal` consumes the head, and the answers after it — the revocation
    // refusal, the upstream-failure 502, the busy 503 — are written with the
    // request's origin still in hand, so it leaves the head here.
    let origin = head.origin.take();
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, upstream_port));
    let timeout = match remaining(deadline) {
        Some(timeout) => timeout,
        None => return,
    };
    let mut upstream = match TcpStream::connect_timeout(&address, timeout) {
        Ok(stream) => stream,
        Err(_) => {
            let answer = upstream_failure_response(origin.as_deref());
            let _ = write_with_deadline(&mut client, &answer, deadline);
            return;
        }
    };
    // The gate makes the check and the write one step: a `swap` that lands
    // here waits, so at the instant of the write the device was not yet
    // revoked; one that landed earlier was seen by `holds()`.
    {
        let gate = devices.revocation_gate();
        if !lease.holds() {
            drop(gate);
            let _ = discard_request_body(&mut client, body_length, deadline);
            let _ = refuse(&mut client, origin.as_deref(), deadline);
            return;
        }
        // Test seam: a request can be parked here, holding the shared guard,
        // so a test can prove a `swap` waits for it.
        #[cfg(test)]
        devices.run_in_write_hook();
        // The sealed bytes are the only thing ever written upstream.
        let sealed = head.seal(lease.slot(), &salt);
        if write_with_deadline(&mut upstream, sealed.bytes(), deadline).is_err() {
            return;
        }
    }
    if relay_exact(&mut client, &mut upstream, body_length, deadline, &cancel).is_err() {
        return;
    }
    let upstream_head = match response::read_upstream_head(&mut upstream, deadline) {
        Ok(head) => head,
        Err(_) => return,
    };
    {
        // Same gate as the request write: the revocation check and the
        // response-head write are one step, so a swap that lands here waits,
        // and the device was not yet revoked at the instant of the write.
        let gate = devices.revocation_gate();
        if cancel.stopped() {
            return;
        }
        if !upstream_head.event_stream {
            // The upstream's own bytes, plus the vary a browser needs and
            // the upstream does not send; nothing else is added to them.
            let relayed = response::with_origin_vary(&upstream_head.raw);
            if write_with_deadline(&mut client, &relayed, deadline).is_err() {
                return;
            }
            drop(gate);
            if let Some(observer) = observer {
                observer(&relayed);
            }
            let _ = relay_response(&mut upstream, &mut client, deadline, &cancel, observer);
            return;
        }
    }
    let job = match registry.start(device, response::client_head(&upstream_head.raw)) {
        Ok(job) => job,
        Err(StartRefused::Entropy) => {
            eprintln!("kalsa door could not mint a job id");
            let answer = busy_response(origin.as_deref());
            let _ = write_with_deadline(&mut client, &answer, deadline);
            return;
        }
        Err(StartRefused::Busy) => {
            let answer = busy_response(origin.as_deref());
            let _ = write_with_deadline(&mut client, &answer, deadline);
            return;
        }
    };
    stream::produce_and_serve(
        &job,
        upstream,
        client,
        upstream_head.chunked,
        deadline,
        &cancel,
        observer,
    );
}

/// Serves a `Last-Event-ID`: the missed events first, then the live tail —
/// or the honest refusal when the answer is gone. The asking device was
/// already identified by the bearer scan; the job answers to that device.
fn resume(
    client: &mut TcpStream,
    registry: &Registry,
    last_event_id: &[u8],
    origin: Option<&[u8]>,
    device: DeviceId,
    observer: Option<&Observed>,
    deadline: Instant,
    cancel: &Cancel,
) {
    let words = match parse_resume(last_event_id) {
        Some(resume) => match registry.find(&resume.token) {
            Some(job) => match job.resume_decision(resume.seen, device) {
                ResumeDecision::Serve => {
                    // The client saw `seen`; the next byte of the answer it
                    // is owed is the event after it.
                    stream::serve_resume(&job, client, resume.seen + 1, observer, deadline, cancel);
                    return;
                }
                ResumeDecision::Refused(words) => words,
            },
            None => "That answer is no longer kept here.",
        },
        None => "The door cannot resume an answer from that id.",
    };
    let gone = gone_response(words, origin);
    // One step with the check: a revoked device does not learn whether the
    // answer it names still exists.
    let gate = cancel.revocation_gate();
    if cancel.stopped() {
        return;
    }
    let _ = write_with_deadline(client, &gone, deadline);
    drop(gate);
}

fn gone_response(words: &str, origin: Option<&[u8]>) -> Vec<u8> {
    let origin_headers = cors::origin_headers(origin);
    format!(
        "HTTP/1.1 410 Gone\r\n{origin_headers}Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{words}",
        words.len()
    )
    .into_bytes()
}

fn discard_request_body(
    client: &mut TcpStream,
    length: usize,
    deadline: Instant,
) -> io::Result<()> {
    let mut left = length;
    let mut buffer = [0u8; 16 * 1024];
    while left > 0 {
        set_read_deadline(client, deadline)?;
        let chunk = left.min(buffer.len());
        let read = client.read(&mut buffer[..chunk])?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "request body ended",
            ));
        }
        left -= read;
    }
    Ok(())
}

/// Which device the bearer credential belongs to, if any. The format check
/// and the credential scan are the same shape as ever — a fixed buffer, a
/// constant-time comparison — and the verdict is combined only after both
/// have run, so a badly formed head costs the same as a well-formed one.
fn authenticated(value: Option<&[u8]>, devices: &Devices) -> Option<DeviceId> {
    let mut presented = [0u8; TOKEN_BYTES];
    let format_ok = value.is_some_and(|value| {
        value.len() == b"Bearer ".len() + TOKEN_BYTES && value.starts_with(b"Bearer ") && {
            presented.copy_from_slice(&value[b"Bearer ".len()..]);
            true
        }
    });
    let matched = devices.authenticate(&presented);
    if format_ok { matched } else { None }
}

fn relay_exact(
    from: &mut TcpStream,
    to: &mut TcpStream,
    length: usize,
    deadline: Instant,
    cancel: &Cancel,
) -> io::Result<()> {
    let mut left = length;
    let mut buffer = [0u8; 16 * 1024];
    while left > 0 {
        if cancel.stopped() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "door stopped"));
        }
        set_read_deadline(from, deadline)?;
        set_write_deadline(to, deadline)?;
        let chunk_length = left.min(buffer.len());
        let read = from.read(&mut buffer[..chunk_length])?;
        if read == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "request body ended",
            ));
        }
        to.write_all(&buffer[..read])?;
        left -= read;
    }
    Ok(())
}

fn relay_response(
    from: &mut TcpStream,
    to: &mut TcpStream,
    deadline: Instant,
    cancel: &Cancel,
    observer: Option<&Observed>,
) -> io::Result<()> {
    let mut buffer = [0u8; 16 * 1024];
    loop {
        if cancel.stopped() {
            return Ok(());
        }
        set_read_deadline(from, deadline)?;
        set_write_deadline(to, deadline)?;
        let read = from.read(&mut buffer)?;
        if read == 0 {
            return Ok(());
        }
        to.write_all(&buffer[..read])?;
        if let Some(observer) = observer {
            observer(&buffer[..read]);
        }
    }
}

fn refuse(stream: &mut TcpStream, origin: Option<&[u8]>, deadline: Instant) -> io::Result<()> {
    write_with_deadline(stream, &unauthorized_response(origin), deadline)
}

pub(super) fn write_with_deadline(
    stream: &mut TcpStream,
    bytes: &[u8],
    deadline: Instant,
) -> io::Result<()> {
    set_write_deadline(stream, deadline)?;
    stream.write_all(bytes)
}

pub(super) fn set_read_deadline(stream: &TcpStream, deadline: Instant) -> io::Result<()> {
    let timeout = remaining(deadline)
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "door deadline"))?;
    stream.set_read_timeout(Some(timeout.min(PATIENCE)))
}

pub(super) fn set_write_deadline(stream: &TcpStream, deadline: Instant) -> io::Result<()> {
    let timeout = remaining(deadline)
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "door deadline"))?;
    stream.set_write_timeout(Some(timeout.min(PATIENCE)))
}

fn remaining(deadline: Instant) -> Option<Duration> {
    let remaining = deadline.checked_duration_since(Instant::now())?;
    (!remaining.is_zero()).then_some(remaining)
}

#[cfg(test)]
mod tests {
    use super::authenticated;
    use crate::devices::{DeviceEntry, DeviceId, Devices};

    fn devices_with(credentials: &[&str]) -> Devices {
        let entries = credentials
            .iter()
            .enumerate()
            .map(|(index, token)| {
                DeviceEntry::new(
                    DeviceId::new(index as u32),
                    format!("device {index}"),
                    token.to_string(),
                )
                .unwrap()
            })
            .collect();
        Devices::new(entries).unwrap()
    }

    #[test]
    fn bearer_comparison_answers_with_the_device_that_matched() {
        let devices = devices_with(&[&"a".repeat(super::super::TOKEN_BYTES), &"b".repeat(64)]);
        let bearer = |token: &str| format!("Bearer {token}").into_bytes();
        assert_eq!(
            authenticated(
                Some(&bearer(&"a".repeat(super::super::TOKEN_BYTES))),
                &devices
            ),
            Some(DeviceId::new(0))
        );
        assert_eq!(
            authenticated(Some(&bearer(&"b".repeat(64))), &devices),
            Some(DeviceId::new(1))
        );
        assert_eq!(authenticated(Some(&b"Bearer wrong"[..]), &devices), None);
        assert_eq!(authenticated(None, &devices), None);
    }

    #[test]
    fn the_gone_response_carries_its_words_and_their_length() {
        let response = super::gone_response("It is gone.", None);
        let text = String::from_utf8(response).unwrap();
        assert!(text.starts_with("HTTP/1.1 410 Gone\r\n"));
        assert!(text.contains("Content-Length: 11\r\n"));
        assert!(text.ends_with("\r\n\r\nIt is gone."));
        assert!(!text.to_ascii_lowercase().contains("access-control-allow-origin"));

        let webview = super::gone_response("It is gone.", Some(b"tauri://localhost"));
        let text = String::from_utf8(webview).unwrap();
        assert!(text.contains("Access-Control-Allow-Origin: tauri://localhost\r\n"));
        assert!(text.ends_with("\r\n\r\nIt is gone."), "the words still end it: {text}");
        assert_eq!(text.matches("Access-Control-Allow-Origin").count(), 1);
    }
}
