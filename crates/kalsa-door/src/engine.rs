//! The door as a client of the engine: one hand-built HTTP/1.1 request to
//! `/slots/:id_slot`, on the port the door was constructed with.
//!
//! The crate has three dependencies and no HTTP client, so the request is
//! written out here — and it is worth reading as a wire form: `POST`, the
//! slot in the path, the action in the query, the name in a json body the
//! engine parses with `request_data.at("filename")`
//! (`server-context.cpp:5638`, `:5674`), and the door's own two private
//! headers. Those are the headers a completion carries, so the engine sees the
//! same device and — on a restore — stamps the slot with that device's
//! namespace instead of dropping it (`server-context.cpp:2882-2885`).

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Instant;

use crate::proxy;
use crate::request;
use crate::response;

/// The largest answer read back: a few numbers in one object.
const MAX_REPLY: usize = 64 * 1024;

/// Why a call did not produce an answer. The two are different facts: a
/// refusal means the engine looked at the work and said no; unreachable means
/// it may not know the action happened at all, which is why the caller may
/// only close a sequence on the first.
pub(super) enum Call {
    Unreachable,
    Refused,
}

/// Where the engine is and how to reach it as one device, so the sequence
/// functions take one argument instead of five.
pub(super) struct Engine<'a> {
    pub(super) port: u16,
    pub(super) slot: u32,
    pub(super) salt: &'a [u8; 32],
    pub(super) deadline: Instant,
}

impl Engine<'_> {
    /// One action. `field` is the number the caller needs back — `n_saved`
    /// out of a save — and a reply without it is unreachable, never a
    /// success: the door can only tell a save that wrote a chat from one that
    /// wrote an empty slot if the engine says how much it wrote.
    pub(super) fn call(
        &self,
        action: &str,
        filename: Option<&str>,
        field: Option<&str>,
    ) -> Result<u64, Call> {
        let body = filename
            .map(|name| format!("{{\"filename\":\"{name}\"}}"))
            .unwrap_or_default();
        let mut head = Vec::with_capacity(256);
        head.extend_from_slice(
            format!(
                "POST /slots/{}?action={action} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n\
                 Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                self.slot,
                self.port,
                body.len()
            )
            .as_bytes(),
        );
        request::private_headers(&mut head, self.slot, self.salt);
        head.extend_from_slice(b"\r\n");
        head.extend_from_slice(body.as_bytes());

        let left = self
            .deadline
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
            .ok_or(Call::Unreachable)?;
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, self.port));
        let mut engine =
            TcpStream::connect_timeout(&address, left).map_err(|_| Call::Unreachable)?;
        proxy::set_write_deadline(&engine, self.deadline).map_err(|_| Call::Unreachable)?;
        engine.write_all(&head).map_err(|_| Call::Unreachable)?;
        let reply =
            response::read_upstream_head(&mut engine, self.deadline).map_err(|_| Call::Unreachable)?;
        let (status, length) = reply_head(&reply.raw).ok_or(Call::Unreachable)?;
        if !(200..300).contains(&status) {
            return Err(Call::Refused);
        }
        let Some(field) = field else {
            return Ok(0);
        };
        let length = length
            .filter(|length| *length <= MAX_REPLY)
            .ok_or(Call::Unreachable)?;
        let mut body = vec![0u8; length];
        engine.read_exact(&mut body).map_err(|_| Call::Unreachable)?;
        number(&body, field).ok_or(Call::Unreachable)
    }
}

/// The status and the declared body length of an engine reply.
fn reply_head(head: &[u8]) -> Option<(u16, Option<usize>)> {
    let text = std::str::from_utf8(head).ok()?;
    let mut lines = text.split("\r\n");
    let status = lines.next()?.get(9..12)?.parse().ok()?;
    let mut length = None;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = Some(value.trim().parse().ok()?);
            }
        }
    }
    Some((status, length))
}

/// The number the engine reports under `name`, read out of its json by hand:
/// one integer in a small object, and the only thing the door wants from it.
fn number(body: &[u8], name: &str) -> Option<u64> {
    let needle = format!("\"{name}\"");
    let at = body
        .windows(needle.len())
        .position(|window| window == needle.as_bytes())?;
    let rest = &body[at + needle.len()..];
    let colon = rest.iter().position(|byte| *byte == b':')?;
    let digits: Vec<u8> = rest[colon + 1..]
        .iter()
        .copied()
        .skip_while(u8::is_ascii_whitespace)
        .take_while(u8::is_ascii_digit)
        .collect();
    std::str::from_utf8(&digits).ok()?.parse().ok()
}
