use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::devices::{DeviceId, Devices};
use crate::jobs::ResumeDecision;
use crate::registry::{Registry, StartRefused};
use crate::token::parse_resume;
use crate::request;
use crate::response;
use crate::stream;
use crate::{ActiveDevices, BUSY_RESPONSE, CONNECTION_LIFETIME, DeviceSet, PATIENCE, TOKEN_BYTES, UNAUTHORIZED_RESPONSE, UPSTREAM_FAILURE_RESPONSE};

/// The observer type every serving path shares: it sees exactly the bytes
/// the client receives, never a byte it does not.
pub(super) type Observed = dyn Fn(&[u8]) + Send + Sync;

/// The conditions under which an in-flight exchange stops: the door is
/// shutting down, or the device it serves was revoked while the answer was
/// streaming. Checked between relay steps. The revocation half takes a
/// short read lock to look at an `Arc` — no lock is ever held for I/O, so
/// one streamed answer cannot serialize the house.
pub(super) struct Cancel<'a> {
    stop: &'a AtomicBool,
    devices: &'a DeviceSet,
    device: DeviceId,
}

impl Cancel<'_> {
    pub(super) fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst) || !self.devices.holds(self.device)
    }
}

pub(super) fn handle(
    mut client: TcpStream,
    accepted: Instant,
    head_patience: Duration,
    upstream_port: u16,
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
    let head = {
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
                    let _ = refuse(&mut client, deadline);
                }
                return;
            }
        }
    };
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
            let _ = refuse(&mut client, deadline);
            return;
        }
    };
    // Presence for the running door: this device, exactly while the door is
    // inside this request. Only an authenticated device is ever counted.
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
        resume(&mut client, registry, last_event_id, device, observer, deadline, &cancel);
        return;
    }
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, upstream_port));
    let timeout = match remaining(deadline) {
        Some(timeout) => timeout,
        None => return,
    };
    let mut upstream = match TcpStream::connect_timeout(&address, timeout) {
        Ok(stream) => stream,
        Err(_) => {
            let _ = write_with_deadline(&mut client, UPSTREAM_FAILURE_RESPONSE, deadline);
            return;
        }
    };
    if write_with_deadline(&mut upstream, &head.forwarded, deadline).is_err() {
        return;
    }
    if relay_exact(&mut client, &mut upstream, head.body_length, deadline, &cancel).is_err() {
        return;
    }
    let upstream_head = match response::read_upstream_head(&mut upstream, deadline) {
        Ok(head) => head,
        Err(_) => return,
    };
    // The response head is the last byte a revoked device may receive:
    // everything after it is behind a relay check, so this write is too.
    if cancel.stopped() {
        return;
    }
    if !upstream_head.event_stream {
        // Everything the door does not take custody of moves through as it
        // always has: the upstream's own bytes, untouched.
        if write_with_deadline(&mut client, &upstream_head.raw, deadline).is_err() {
            return;
        }
        if let Some(observer) = observer {
            observer(&upstream_head.raw);
        }
        let _ = relay_response(&mut upstream, &mut client, deadline, &cancel, observer);
        return;
    }
    let job = match registry.start(device, response::client_head(&upstream_head.raw)) {
        Ok(job) => job,
        Err(StartRefused::Entropy) => {
            eprintln!("kalsa door could not mint a job id");
            let _ = write_with_deadline(&mut client, BUSY_RESPONSE, deadline);
            return;
        }
        Err(StartRefused::Busy) => {
            let _ = write_with_deadline(&mut client, BUSY_RESPONSE, deadline);
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
    let gone = gone_response(words);
    let _ = write_with_deadline(client, &gone, deadline);
}

fn gone_response(words: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 410 Gone\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{words}",
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

fn refuse(stream: &mut TcpStream, deadline: Instant) -> io::Result<()> {
    write_with_deadline(stream, UNAUTHORIZED_RESPONSE, deadline)
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
        let response = super::gone_response("It is gone.");
        let text = String::from_utf8(response).unwrap();
        assert!(text.starts_with("HTTP/1.1 410 Gone\r\n"));
        assert!(text.contains("Content-Length: 11\r\n"));
        assert!(text.ends_with("\r\n\r\nIt is gone."));
    }
}
