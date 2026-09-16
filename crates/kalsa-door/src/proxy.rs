use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use subtle::ConstantTimeEq;

use crate::request;
use crate::{
    BUSY_RESPONSE, CONNECTION_LIFETIME, PATIENCE, TOKEN_BYTES, UNAUTHORIZED_RESPONSE,
    UPSTREAM_FAILURE_RESPONSE,
};

pub(super) fn handle(
    mut client: TcpStream,
    accepted: Instant,
    head_patience: Duration,
    upstream_port: u16,
    credential: &[u8; TOKEN_BYTES],
    stop: &AtomicBool,
    active: &AtomicUsize,
    observer: Option<&(dyn Fn(&[u8]) + Send + Sync)>,
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
    if !authenticated(head.authorization.as_deref(), credential) {
        let _ = refuse(&mut client, deadline);
        return;
    }
    let _active = ActiveConnection::new(active);
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
    if relay_exact(&mut client, &mut upstream, head.body_length, deadline, stop).is_err() {
        return;
    }
    let _ = relay_response(&mut upstream, &mut client, deadline, stop, observer);
}

struct ActiveConnection<'a> {
    active: &'a AtomicUsize,
}

impl<'a> ActiveConnection<'a> {
    fn new(active: &'a AtomicUsize) -> Self {
        active.fetch_add(1, Ordering::SeqCst);
        Self { active }
    }
}

impl Drop for ActiveConnection<'_> {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::SeqCst);
    }
}

fn authenticated(value: Option<&[u8]>, expected: &[u8; TOKEN_BYTES]) -> bool {
    let mut presented = [0u8; TOKEN_BYTES];
    let format_ok = value.is_some_and(|value| {
        value.len() == b"Bearer ".len() + TOKEN_BYTES && value.starts_with(b"Bearer ") && {
            presented.copy_from_slice(&value[b"Bearer ".len()..]);
            true
        }
    });
    let equal = bool::from(presented.ct_eq(expected));
    format_ok && equal
}

fn relay_exact(
    from: &mut TcpStream,
    to: &mut TcpStream,
    length: usize,
    deadline: Instant,
    stop: &AtomicBool,
) -> io::Result<()> {
    let mut left = length;
    let mut buffer = [0u8; 16 * 1024];
    while left > 0 {
        if stop.load(Ordering::SeqCst) {
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
    stop: &AtomicBool,
    observer: Option<&(dyn Fn(&[u8]) + Send + Sync)>,
) -> io::Result<()> {
    let mut buffer = [0u8; 16 * 1024];
    loop {
        if stop.load(Ordering::SeqCst) {
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

fn write_with_deadline(stream: &mut TcpStream, bytes: &[u8], deadline: Instant) -> io::Result<()> {
    set_write_deadline(stream, deadline)?;
    stream.write_all(bytes)
}

fn set_read_deadline(stream: &TcpStream, deadline: Instant) -> io::Result<()> {
    let timeout = remaining(deadline)
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "door deadline"))?;
    stream.set_read_timeout(Some(timeout.min(PATIENCE)))
}

fn set_write_deadline(stream: &TcpStream, deadline: Instant) -> io::Result<()> {
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

    #[test]
    fn bearer_comparison_accepts_only_the_exact_credential() {
        let expected = [b'a'; super::super::TOKEN_BYTES];
        let value = format!("Bearer {}", "a".repeat(super::super::TOKEN_BYTES));
        assert!(authenticated(Some(value.as_bytes()), &expected));
        assert!(!authenticated(Some(b"Bearer wrong"), &expected));
        assert!(!authenticated(None, &expected));
    }
}
