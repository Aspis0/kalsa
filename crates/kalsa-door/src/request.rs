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

pub(super) struct UnsealedHead {
    /// Private, not `pub(super)`: `seal` is the only path to wire bytes, so
    /// no other module can append a header or write an unsealed head. The
    /// child test module still reaches it; nothing outside this file can.
    forwarded: Vec<u8>,
    pub(super) body_length: usize,
    pub(super) authorization: Option<Vec<u8>>,
    /// The client's `Origin`, taken once. `None` when it was absent — and
    /// when a second copy arrived, which is an ambiguity rather than an
    /// origin, and never a header the door should reflect.
    pub(super) origin: Option<Vec<u8>>,
    /// A CORS preflight: `OPTIONS` with both the `Origin` and the
    /// `Access-Control-Request-Method` a browser always sends. `OPTIONS`
    /// without those two is some other request and takes the ordinary path.
    pub(super) preflight: bool,
    /// The request target, kept because the door's own routing decision — the
    /// refusal of the engine's slot routes — is made on the path, not on a
    /// header. The upstream never sees this copy; it is already in the
    /// forwarded request line when it is forwarded at all.
    pub(super) target: Vec<u8>,
    /// The client's `Last-Event-ID`, taken out of the forwarded bytes: the
    /// id namespace belongs to the door, and the upstream must never see it.
    pub(super) last_event_id: Option<Vec<u8>>,
}

/// A head sealed with the door's private headers. Producing it consumes the
/// `UnsealedHead`, so the seal cannot be skipped or done twice.
pub(super) struct SealedHead {
    bytes: Vec<u8>,
}
impl UnsealedHead {
    /// Seals the head and hands back the only value that exposes wire bytes.
    /// `parse` has already dropped any client copy, so the engine — which
    /// reads the FIRST match — reads exactly the door's. Not authentication.
    pub(super) fn seal(mut self, slot: u32, salt: &[u8; 32]) -> SealedHead {
        self.forwarded
            .extend_from_slice(format!("X-Kalsa-Slot: {slot}\r\n").as_bytes());
        self.forwarded.extend_from_slice(b"X-Kalsa-Cache-Salt: ");
        self.forwarded.extend_from_slice(hex(salt).as_bytes());
        self.forwarded.extend_from_slice(b"\r\n\r\n");
        SealedHead {
            bytes: self.forwarded,
        }
    }
}

impl SealedHead {
    /// The wire bytes of the sealed head, and the only way to reach them.
    pub(super) fn bytes(&self) -> &[u8] {
        &self.bytes
    }
}

/// Lowercase hex, the form the engine reads.
fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

pub(super) fn read_head(stream: &mut TcpStream, deadline: Instant) -> Result<UnsealedHead, ()> {
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

fn parse(bytes: &[u8]) -> Result<UnsealedHead, ()> {
    let end = bytes.len().checked_sub(2).ok_or(())?;
    let mut lines = bytes[..end].split(|byte| *byte == b'\n');
    if !lines.next_back().ok_or(())?.is_empty() {
        return Err(());
    }
    let request_line = lines.next().ok_or(())?.strip_suffix(b"\r").ok_or(())?;
    let target = request_target(request_line)?;
    let is_options = request_line.split(|byte| *byte == b' ').next() == Some(&b"OPTIONS"[..]);

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
    let mut origin: Option<Vec<u8>> = None;
    let mut origin_twice = false;
    let mut asks_for_method = false;
    let mut slot_seen = false;
    let mut salt_seen = false;
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
            // Kept in `origin` and forwarded: the upstream echoes this back as
            // its own `Access-Control-Allow-Origin`, which is the header the
            // browser needs on the answer. Stripping it here would take the
            // answer's CORS header away with it.
            b"origin" => {
                origin_twice |= origin.is_some();
                origin = Some(trim_ows(value).to_vec());
            }
            b"access-control-request-method" => asks_for_method = true,
            // The door's own private names. The client's value is never
            // kept and never forwarded: the engine consumes the FIRST
            // matching salt header, so a client copy arriving before the
            // door's own would win. A second copy of either is ambiguous and
            // refused like every other repeated private header.
            b"x-kalsa-slot" => {
                if slot_seen {
                    return Err(());
                }
                slot_seen = true;
            }
            b"x-kalsa-cache-salt" => {
                if salt_seen {
                    return Err(());
                }
                salt_seen = true;
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
    // The request line is already in `forwarded` from above.
    for (lower, line) in &candidates {
        let kept = !named.contains(lower)
            && !HOP_BY_HOP.contains(&lower.as_slice())
            && lower.as_slice() != b"authorization"
            && lower.as_slice() != b"last-event-id"
            && lower.as_slice() != b"x-kalsa-slot"
            && lower.as_slice() != b"x-kalsa-cache-salt";
        if kept {
            forwarded.extend_from_slice(line);
            forwarded.extend_from_slice(b"\r\n");
        }
    }
    let origin = origin.filter(|_| !origin_twice);
    let preflight = is_options && asks_for_method && origin.is_some();
    forwarded.extend_from_slice(b"Connection: close\r\n");
    Ok(UnsealedHead {
        forwarded,
        body_length: body_length.unwrap_or(0),
        authorization,
        origin,
        preflight,
        target: target.to_vec(),
        last_event_id,
    })
}

/// The request line's target, once the line is known to be one: method, target,
/// HTTP/1.1, and nothing else. It returns the target because the door's own
/// routing decision reads it, and one parse is one place for a bad line to be
/// refused.
fn request_target(line: &[u8]) -> Result<&[u8], ()> {
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
    Ok(target)
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

    /// The request line opens the forwarded head exactly once. A second
    /// copy turns the head into a malformed message: the upstream reads
    /// the first line as the request and the second as a bogus header.
    #[test]
    fn the_request_line_is_forwarded_exactly_once() {
        const REQUEST_LINE: &str = "GET /v1/models HTTP/1.1";
        let head = parse(
            b"GET /v1/models HTTP/1.1\r\nHost: localhost\r\n\
               Accept: application/json\r\n\
               Connection: keep-alive\r\n\r\n",
        )
        .expect("a well-formed head parses");
        let forwarded = String::from_utf8(head.forwarded).unwrap();

        let matches: Vec<usize> = forwarded
            .split("\r\n")
            .enumerate()
            .filter(|(_, line)| *line == REQUEST_LINE)
            .map(|(index, _)| index)
            .collect();
        assert_eq!(
            matches,
            vec![0],
            "the request line must appear exactly once, as the first line: {forwarded}"
        );
        assert!(
            !forwarded[REQUEST_LINE.len() + 2..].contains(REQUEST_LINE),
            "the request line was repeated later in the head: {forwarded}"
        );
    }

    /// The sealed head is the only thing writable upstream: one blank line,
    /// each private header exactly once.
    #[test]
    fn the_sealed_head_carries_the_private_headers_and_one_terminator() {
        let head = parse(
            b"POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\n\
               Connection: close\r\n\r\n",
        )
        .expect("a well-formed head parses");
        let sealed = head.seal(2, &[0xab; 32]);
        let bytes = sealed.bytes();
        let text = std::str::from_utf8(bytes).expect("the sealed head is ASCII");

        assert!(
            bytes.ends_with(b"\r\n\r\n"),
            "the sealed head must end with its blank line: {text:?}"
        );
        assert!(
            !bytes.ends_with(b"\r\n\r\n\r\n"),
            "the sealed head carried more than one blank line: {text:?}"
        );
        assert_eq!(
            text.matches("\r\n\r\n").count(),
            1,
            "the head must have exactly one terminator: {text:?}"
        );
        assert_eq!(
            text.matches("X-Kalsa-Slot: 2\r\n").count(),
            1,
            "the slot header must be present exactly once: {text:?}"
        );
        assert_eq!(
            text.matches("X-Kalsa-Cache-Salt: ").count(),
            1,
            "the salt header must be present exactly once: {text:?}"
        );
        assert!(
            text.contains("X-Kalsa-Cache-Salt: abababababababababababababababababababababababababababababababab\r\n"),
            "the salt is the lowercase hex of the bytes given: {text:?}"
        );
        // The request line still opens the head exactly once.
        assert_eq!(text.matches("POST /v1/chat/completions HTTP/1.1").count(), 1);
        assert!(text.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
    }

    /// A client's copies of the door's private headers are stripped; a
    /// repeated copy is refused (the engine reads the FIRST header).
    #[test]
    fn client_copies_of_the_private_headers_are_stripped() {
        let head = parse(
            b"POST / HTTP/1.1\r\nHost: x\r\n\
               X-Kalsa-Slot: 999\r\n\
               x-kalsa-cache-salt: deadbeef\r\n\r\n",
        )
        .expect("a well-formed head parses");
        let forwarded = String::from_utf8(head.forwarded).unwrap();
        let lower = forwarded.to_ascii_lowercase();
        assert!(
            !lower.contains("x-kalsa-slot") && !lower.contains("x-kalsa-cache-salt"),
            "a client private header survived into the forwarded head: {forwarded}"
        );
        assert!(!forwarded.contains("999"), "the client slot value survived: {forwarded}");
        assert!(
            !forwarded.contains("deadbeef"),
            "the client salt value survived: {forwarded}"
        );

        let duplicate = parse(
            b"POST / HTTP/1.1\r\nHost: x\r\n\
               X-Kalsa-Slot: 0\r\nX-Kalsa-Slot: 1\r\n\r\n",
        );
        assert!(duplicate.is_err(), "a repeated private header is ambiguous");
        let duplicate_salt = parse(
            b"POST / HTTP/1.1\r\nHost: x\r\n\
               X-Kalsa-Cache-Salt: 0\r\nX-Kalsa-Cache-Salt: 1\r\n\r\n",
        );
        assert!(duplicate_salt.is_err(), "a repeated salt header is ambiguous");

        // A private name the client puts in its own `Connection` line dies
        // with the connection, value included.
        let named = parse(
            b"POST / HTTP/1.1\r\nHost: x\r\n\
               Connection: x-kalsa-slot\r\n\
               X-Kalsa-Slot: 777\r\n\r\n",
        )
        .expect("a well-formed head parses");
        let forwarded = std::str::from_utf8(&named.forwarded).unwrap();
        assert!(
            !forwarded.contains("777") && !forwarded.to_ascii_lowercase().contains("x-kalsa-slot"),
            "a private header named by the client's Connection line survived: {forwarded}"
        );
        let sealed = named.seal(3, &[0u8; 32]);
        let text = std::str::from_utf8(sealed.bytes()).unwrap();
        assert_eq!(text.matches("X-Kalsa-Slot: ").count(), 1);
        assert!(text.contains("X-Kalsa-Slot: 3\r\n"));
    }
}
