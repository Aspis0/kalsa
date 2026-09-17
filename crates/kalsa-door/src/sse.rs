//! Byte mechanics for server-sent events: splitting a body into events, and
//! rewriting each event with the door's own `id:` line.
//!
//! Event identity belongs to the door. Upstream `id:` lines are dropped, not
//! forwarded: two id sources on one connection would leave the client unsure
//! which one to echo back as `Last-Event-ID`. An event with no `data` line is
//! a keep-alive; it is relayed but never numbered or stored, so the numbered
//! log is exactly what a resuming client must receive — pings carry nothing
//! and their absence cannot open a hole.

use crate::chunk::strip_cr;

/// A broken event stream: a line or an event beyond any honest size.
#[derive(Debug)]
pub(super) struct Malformed;

/// Accumulates body bytes and releases each complete event as one slab of
/// `\n`-terminated lines. A blank line dispatches; a `\r` before the `\n`
/// is stripped, so every slab is normalized before anyone sees it.
pub(super) struct EventSplitter {
    done: Vec<u8>,
    event: Vec<u8>,
}

/// An SSE event must not be unbounded; a stream that sends one is broken.
const MAX_EVENT: usize = 256 * 1024;

impl EventSplitter {
    pub(super) fn new() -> Self {
        Self {
            done: Vec::new(),
            event: Vec::new(),
        }
    }

    pub(super) fn feed(&mut self, input: &[u8], out: &mut Vec<Vec<u8>>) -> Result<(), Malformed> {
        for byte in input.iter().copied() {
            if byte == b'\n' {
                let line = std::mem::take(&mut self.done);
                match strip_cr(&line) {
                    b"" => {
                        if !self.event.is_empty() {
                            out.push(std::mem::take(&mut self.event));
                        }
                    }
                    line => {
                        self.event.extend_from_slice(line);
                        self.event.push(b'\n');
                        if self.event.len() > MAX_EVENT {
                            return Err(Malformed);
                        }
                    }
                }
            } else {
                self.done.push(byte);
                if self.done.len() > MAX_EVENT {
                    return Err(Malformed);
                }
            }
        }
        Ok(())
    }
}

/// Rewrites one raw event slab with the door's id and returns the bytes a
/// client should receive, terminator included. `None` for a keep-alive: no
/// `data` line, so nothing to number, nothing to store. Field names in SSE
/// are case-sensitive; `id` is matched exactly.
pub(super) fn rewrite(raw: &[u8], id: &str) -> Option<Vec<u8>> {
    if !raw.split(|byte| *byte == b'\n').any(data_field) {
        return None;
    }
    let mut out = Vec::with_capacity(raw.len() + id.len() + 10);
    out.extend_from_slice(b"id: ");
    out.extend_from_slice(id.as_bytes());
    out.push(b'\n');
    for line in raw.split(|byte| *byte == b'\n') {
        if line.is_empty() || id_field(line) {
            continue;
        }
        out.extend_from_slice(line);
        out.push(b'\n');
    }
    out.push(b'\n');
    Some(out)
}

/// A keep-alive relayed to an attached client: the slab plus the blank line
/// that ends it. It carries no id and is never stored.
pub(super) fn keepalive(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len() + 1);
    out.extend_from_slice(raw);
    out.push(b'\n');
    out
}

fn id_field(line: &[u8]) -> bool {
    field_is(line, b"id")
}

fn data_field(line: &[u8]) -> bool {
    field_is(line, b"data")
}

fn field_is(line: &[u8], name: &[u8]) -> bool {
    match line.strip_prefix(name) {
        Some(rest) => rest.is_empty() || rest.starts_with(b":"),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split_all(body: &[u8]) -> Vec<Vec<u8>> {
        let mut splitter = EventSplitter::new();
        let mut out = Vec::new();
        splitter.feed(body, &mut out).unwrap();
        out
    }

    #[test]
    fn events_are_released_only_at_blank_lines() {
        // Keep-alives come out as slabs too; it is `rewrite` that tells a
        // numbered event from a keep-alive, by the data line alone.
        let events = split_all(b"data: one\n\ndata: two\ndata: more\n\n: ping\n\n");
        assert_eq!(events.len(), 3);
        assert_eq!(events[0], b"data: one\n");
        assert_eq!(events[1], b"data: two\ndata: more\n");
        assert_eq!(events[2], b": ping\n");
    }

    #[test]
    fn crlf_terminators_are_normalized() {
        let events = split_all(b"data: one\r\n\r\n");
        assert_eq!(events[0], b"data: one\n");
    }

    #[test]
    fn an_oversized_event_is_broken() {
        let mut splitter = EventSplitter::new();
        let mut out = Vec::new();
        let big = vec![b'x'; MAX_EVENT + 1];
        assert!(splitter.feed(&big, &mut out).is_err());
    }

    #[test]
    fn rewriting_numbers_data_events_and_drops_upstream_ids() {
        let out = rewrite(b"id: 7\ndata: token\n", "abc:0").unwrap();
        assert_eq!(out, b"id: abc:0\ndata: token\n\n");
    }

    #[test]
    fn a_keepalive_event_is_not_numbered() {
        assert!(rewrite(b": ping\n", "abc:0").is_none());
        assert_eq!(keepalive(b": ping\n"), b": ping\n\n");
    }

    #[test]
    fn a_bare_data_field_is_data() {
        assert!(rewrite(b"data\n", "abc:0").is_some());
    }
}
