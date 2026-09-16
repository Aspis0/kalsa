use std::io::Read;
use std::net::TcpStream;
use std::time::Instant;

pub(super) const MAX_HEAD: usize = 32 * 1024;
pub(super) const MAX_BODY: usize = 16 * 1024 * 1024;

/// Hop-by-hop headers (RFC 9110 §7.6.1): they describe THIS connection and
/// die on this connection. The door serves one request per connection and
/// closes it, so a promise of reuse must never travel to the upstream, and
/// the upstream's own promise must never reach the phone.
const HOP_BY_HOP: &[&[u8]] = &[
    b"connection",
    b"keep-alive",
    b"proxy-connection",
    b"te",
    b"trailer",
    b"upgrade",
];

pub(super) struct Head {
    pub(super) forwarded: Vec<u8>,
    pub(super) body_length: usize,
    pub(super) authorization: Option<Vec<u8>>,
    /// The client's `Last-Event-ID`, taken out of the forwarded bytes: the
    /// id namespace belongs to the door, and the upstream must never see it.
    pub(super) last_event_id: Option<Vec<u8>>,
}

pub(super) fn read_head(stream: &mut TcpStream, deadline: Instant) -> Result<Head, ()> {
    let mut bytes = Vec::with_capacity(1024);
    loop {
        if bytes.len() == MAX_HEAD {
            return Err(());
        }
        let remaining = deadline.checked_duration_since(Instant::now()).ok_or(())?;
        stream
            .set_read_timeout(Some(remaining.min(super::PATIENCE)))
            .map_err(|_| ())?;
        let mut byte = [0u8; 1];
        match stream.read(&mut byte) {
            Ok(0) => return Err(()),
            Ok(1) => {
                bytes.push(byte[0]);
                if bytes.ends_with(b"\r\n\r\n") {
                    return parse(&bytes);
                }
            }
            Ok(_) => return Err(()),
            Err(_) => return Err(()),
        }
    }
}

fn parse(bytes: &[u8]) -> Result<Head, ()> {
    let end = bytes.len().checked_sub(2).ok_or(())?;
    let mut lines = bytes[..end].split(|byte| *byte == b'\n');
    if !lines.next_back().ok_or(())?.is_empty() {
        return Err(());
    }
    let request_line = lines.next().ok_or(())?.strip_suffix(b"\r").ok_or(())?;
    valid_request_line(request_line)?;

    let mut forwarded = Vec::with_capacity(end + 2);
    forwarded.extend_from_slice(request_line);
    forwarded.extend_from_slice(b"\r\n");
    // First pass: validate everything, take what belongs to the door alone,
    // and collect the names the `Connection` headers list. No forwarding
    // decision here — the order of headers in HTTP is not guaranteed, and a
    // header named by a `Connection` line that comes LATER must die all the
    // same.
    let mut authorization = None;
    let mut last_event_id = None;
    let mut body_length = None;
    let mut named: Vec<Vec<u8>> = Vec::new();
    let mut candidates: Vec<(Vec<u8>, &[u8])> = Vec::new();
    for line in lines {
        let line = line.strip_suffix(b"\r").ok_or(())?;
        let colon = line.iter().position(|byte| *byte == b':').ok_or(())?;
        let name = &line[..colon];
        let value = &line[colon + 1..];
        if !valid_name(name) || !valid_value(value) {
            return Err(());
        }
        let lower = name.to_ascii_lowercase();
        match lower.as_slice() {
            b"authorization" => {
                if authorization.is_some() {
                    return Err(());
                }
                authorization = Some(trim_ows(value).to_vec());
            }
            b"last-event-id" => {
                if last_event_id.is_some() {
                    return Err(());
                }
                last_event_id = Some(trim_ows(value).to_vec());
            }
            b"content-length" => {
                if body_length.is_some() {
                    return Err(());
                }
                let value = trim_ows(value);
                let value = std::str::from_utf8(value).map_err(|_| ())?;
                let length = value.parse::<usize>().map_err(|_| ())?;
                if length > MAX_BODY {
                    return Err(());
                }
                body_length = Some(length);
            }
            b"transfer-encoding" => return Err(()),
            b"connection" => {
                // Headers named by `Connection` die with it.
                for entry in value.split(|byte| *byte == b',') {
                    named.push(trim_ows(entry).to_ascii_lowercase());
                }
            }
            _ => {}
        }
        candidates.push((lower, line));
    }

    // Second pass: forward every header that is not hop-by-hop, not named
    // by any `Connection`, and not the door's private ones. The door serves
    // one request per connection and closes it — in both directions. It
    // says so itself, in its own voice, instead of relaying whatever
    // keep-alive promise the two ends made to each other: a phone must
    // never be handed a socket the door has already scheduled to close.
    forwarded.extend_from_slice(request_line);
    forwarded.extend_from_slice(b"\r\n");
    for (lower, line) in &candidates {
        let kept = !named.contains(lower)
            && !HOP_BY_HOP.contains(&lower.as_slice())
            && lower.as_slice() != b"authorization"
            && lower.as_slice() != b"last-event-id";
        if kept {
            forwarded.extend_from_slice(line);
            forwarded.extend_from_slice(b"\r\n");
        }
    }
    forwarded.extend_from_slice(b"Connection: close\r\n");
    forwarded.extend_from_slice(b"\r\n");
    Ok(Head {
        forwarded,
        body_length: body_length.unwrap_or(0),
        authorization,
        last_event_id,
    })
}

fn valid_request_line(line: &[u8]) -> Result<(), ()> {
    let mut parts = line.split(|byte| *byte == b' ');
    let method = parts.next().ok_or(())?;
    let target = parts.next().ok_or(())?;
    let version = parts.next().ok_or(())?;
    if parts.next().is_some()
        || method.is_empty()
        || !method.iter().copied().all(is_token)
        || target.is_empty()
        || target.iter().copied().any(is_ctl)
        || version != b"HTTP/1.1"
    {
        return Err(());
    }
    Ok(())
}

fn valid_name(name: &[u8]) -> bool {
    !name.is_empty() && name.iter().copied().all(is_token)
}

fn valid_value(value: &[u8]) -> bool {
    value
        .iter()
        .copied()
        .all(|byte| byte == b'\t' || !is_ctl(byte))
}

fn is_token(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&byte)
}

fn is_ctl(byte: u8) -> bool {
    byte < 0x20 || byte == 0x7f
}

fn trim_ows(value: &[u8]) -> &[u8] {
    let start = value
        .iter()
        .position(|byte| *byte != b' ' && *byte != b'\t');
    let end = value
        .iter()
        .rposition(|byte| *byte != b' ' && *byte != b'\t');
    match (start, end) {
        (Some(start), Some(end)) => &value[start..=end],
        _ => &[],
    }
}

#[cfg(test)]
mod tests {
    use super::parse;

    /// The protected property: the phone is never promised a socket the
    /// door has already scheduled to close. A keep-alive request in, a
    /// `Connection: close` out — once, in the door's own voice.
    #[test]
    fn the_phone_is_never_promised_a_socket_the_door_closes() {
        let head = parse(
            b"POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
               Connection: keep-alive\r\n\
               Keep-Alive: timeout=5, max=100\r\n\
               Content-Length: 0\r\n\r\n",
        )
        .expect("a well-formed head parses");
        let forwarded = String::from_utf8(head.forwarded).unwrap();

        assert!(
            !forwarded.to_ascii_lowercase().contains("keep-alive"),
            "the upstream saw the phone's keep-alive promise: {forwarded}"
        );
        assert_eq!(
            forwarded.matches("Connection:").count(),
            1,
            "the forwarded head must carry exactly one connection decision: {forwarded}"
        );
        assert!(
            forwarded.contains("Connection: close\r\n"),
            "the door's own answer is missing: {forwarded}"
        );
        // Everything the door genuinely forwards still flows.
        assert!(forwarded.contains("Host: localhost\r\n"));
        assert_eq!(head.body_length, 0);
        assert!(head.authorization.is_none());
    }

    #[test]
    fn headers_named_by_connection_die_in_both_orders() {
        // The order of headers in HTTP is not guaranteed: a header named by
        // a `Connection` line must die whether that line comes before or
        // after it. `x-hop-only` is deliberately NOT in the fixed
        // hop-by-hop list — `upgrade` would die anyway, and a test that
        // passes only because of the fixed list has seen nothing.
        for head_bytes in [
            &b"POST / HTTP/1.1\r\nHost: x\r\n\
               Connection: x-hop-only\r\n\
               X-Hop-Only: secret\r\n\r\n"[..],
            b"POST / HTTP/1.1\r\nHost: x\r\n\
               X-Hop-Only: secret\r\n\
               Connection: x-hop-only\r\n\r\n",
        ] {
            let head = parse(head_bytes).expect("a well-formed head parses");
            let forwarded = String::from_utf8(head.forwarded).unwrap();
            assert!(
                !forwarded.to_ascii_lowercase().contains("x-hop-only"),
                "a header named by a Connection line survived: {forwarded}"
            );
            assert!(forwarded.contains("Connection: close\r\n"));
        }
    }
}
