use std::io::Read;
use std::net::TcpStream;
use std::time::Instant;

pub(super) const MAX_HEAD: usize = 32 * 1024;
pub(super) const MAX_BODY: usize = 16 * 1024 * 1024;

pub(super) struct Head {
    pub(super) forwarded: Vec<u8>,
    pub(super) body_length: usize,
    pub(super) authorization: Option<Vec<u8>>,
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
    let mut authorization = None;
    let mut body_length = None;
    for line in lines {
        let line = line.strip_suffix(b"\r").ok_or(())?;
        let colon = line.iter().position(|byte| *byte == b':').ok_or(())?;
        let name = &line[..colon];
        let value = &line[colon + 1..];
        if !valid_name(name) || !valid_value(value) {
            return Err(());
        }
        if name.eq_ignore_ascii_case(b"authorization") {
            if authorization.is_some() {
                return Err(());
            }
            authorization = Some(trim_ows(value).to_vec());
        } else if name.eq_ignore_ascii_case(b"content-length") {
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
        } else if name.eq_ignore_ascii_case(b"transfer-encoding") {
            return Err(());
        }
        if !name.eq_ignore_ascii_case(b"authorization") {
            forwarded.extend_from_slice(line);
            forwarded.extend_from_slice(b"\r\n");
        }
    }
    forwarded.extend_from_slice(b"\r\n");
    Ok(Head {
        forwarded,
        body_length: body_length.unwrap_or(0),
        authorization,
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
