//! HTTP/1.1 chunked framing: turning a chunked body back into body bytes.
//! The event stream behind it is `sse`'s business; this is only the wire.

/// A malformed chunked body. The caller fails the job rather than guessing
/// at what the stream meant.
#[derive(Debug)]
pub(super) struct Malformed;

const MAX_CHUNK_LINE: usize = 1024;

/// Turns an HTTP/1.1 chunked body into body bytes.
pub(super) struct Dechunker {
    state: ChunkState,
    line: Vec<u8>,
}

enum ChunkState {
    Size,
    Data { left: usize },
    AfterData,
    Trailers,
    Done,
}

impl Dechunker {
    pub(super) fn new() -> Self {
        Self {
            state: ChunkState::Size,
            line: Vec::new(),
        }
    }

    pub(super) fn is_done(&self) -> bool {
        matches!(self.state, ChunkState::Done)
    }

    /// Consumes framing bytes, appending body bytes to `out`. Feeding after
    /// the terminal chunk is a caller bug; malformed framing ends the stream.
    pub(super) fn feed(&mut self, input: &[u8], out: &mut Vec<u8>) -> Result<(), Malformed> {
        let mut rest = input;
        loop {
            match self.state {
                ChunkState::Done => return Ok(()),
                ChunkState::Size => {
                    let Some(newline) = rest.iter().position(|byte| *byte == b'\n') else {
                        self.line.extend_from_slice(rest);
                        if self.line.len() > MAX_CHUNK_LINE {
                            return Err(Malformed);
                        }
                        return Ok(());
                    };
                    self.line.extend_from_slice(&rest[..newline]);
                    rest = &rest[newline + 1..];
                    let line = std::mem::take(&mut self.line);
                    let size = chunk_size(strip_cr(&line))?;
                    self.state = if size == 0 {
                        ChunkState::Trailers
                    } else {
                        ChunkState::Data { left: size }
                    };
                }
                ChunkState::Data { left } => {
                    let take = left.min(rest.len());
                    out.extend_from_slice(&rest[..take]);
                    rest = &rest[take..];
                    if rest.is_empty() {
                        self.state = ChunkState::Data { left: left - take };
                        return Ok(());
                    }
                    self.state = ChunkState::AfterData;
                }
                ChunkState::AfterData => {
                    let Some(newline) = rest.iter().position(|byte| *byte == b'\n') else {
                        return Ok(());
                    };
                    rest = &rest[newline + 1..];
                    self.state = ChunkState::Size;
                }
                ChunkState::Trailers => {
                    let Some(newline) = rest.iter().position(|byte| *byte == b'\n') else {
                        self.line.extend_from_slice(rest);
                        if self.line.len() > MAX_CHUNK_LINE {
                            return Err(Malformed);
                        }
                        return Ok(());
                    };
                    let complete = {
                        self.line.extend_from_slice(&rest[..newline]);
                        strip_cr(&self.line).is_empty()
                    };
                    self.line.clear();
                    rest = &rest[newline + 1..];
                    if complete {
                        self.state = ChunkState::Done;
                    }
                }
            }
        }
    }
}

/// Chunk sizes are hexadecimal, per RFC 9112; extensions after `;` are
/// skipped.
fn chunk_size(line: &[u8]) -> Result<usize, Malformed> {
    let hex = line.split(|byte| *byte == b';').next().ok_or(Malformed)?;
    let text = std::str::from_utf8(hex).map_err(|_| Malformed)?;
    usize::from_str_radix(text.trim(), 16).map_err(|_| Malformed)
}

pub(super) fn strip_cr(line: &[u8]) -> &[u8] {
    line.strip_suffix(b"\r").unwrap_or(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dechunk(wire: &[u8]) -> Vec<u8> {
        let mut dechunker = Dechunker::new();
        let mut out = Vec::new();
        dechunker.feed(wire, &mut out).unwrap();
        assert!(dechunker.is_done(), "the terminal chunk was not reached");
        out
    }

    #[test]
    fn a_chunked_body_survives_arbitrary_splits() {
        let wire = b"5\r\nidata\r\nA\r\n:done: end\r\n0\r\n\r\n";
        for split in 1..wire.len() {
            let mut dechunker = Dechunker::new();
            let mut out = Vec::new();
            dechunker.feed(&wire[..split], &mut out).unwrap();
            dechunker.feed(&wire[split..], &mut out).unwrap();
            assert_eq!(out, b"idata:done: end", "split at {split}");
            assert!(dechunker.is_done());
        }
    }

    #[test]
    fn chunk_extensions_and_trailers_are_skipped() {
        assert_eq!(dechunk(b"3;ext=1\r\nabc\r\n0\r\nX: y\r\n\r\n"), b"abc");
    }

    #[test]
    fn a_bad_chunk_size_is_malformed() {
        let mut dechunker = Dechunker::new();
        let mut out = Vec::new();
        assert!(dechunker.feed(b"zz\r\n", &mut out).is_err());
    }
}
