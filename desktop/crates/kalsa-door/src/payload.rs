//! The bodies the door reads itself. Everything else is relayed to the engine
//! untouched; the disk tier's two routes are the exception, and this is what
//! reads their one field.
//!
//! Deliberately hand-written, like the request the disk tier makes to the
//! engine: the crate carries no json library, and this body is one string in
//! one object. It is tolerant of fields it does not know — a client that sends
//! a `filename` beside the id is not naming a file, and refusing the payload
//! would make the door's own name depend on the client never adding a field —
//! and strict about everything it would have to interpret: an escape, a
//! doubled field, a value past a sane nesting depth is refused, not guessed at.

/// The `id` out of a client's body, if the body is one object with one such
/// field. `None` for every other body, including a valid one without an id.
pub(super) fn id(body: &[u8]) -> Option<String> {
    let mut cursor = Cursor { body, at: 0 };
    cursor.space();
    cursor.take(b'{')?;
    let mut id = None;
    cursor.space();
    if cursor.peek() == Some(b'}') {
        cursor.byte()?;
    } else {
        loop {
            cursor.space();
            let name = cursor.string()?;
            cursor.space();
            cursor.take(b':')?;
            cursor.space();
            if name == "id" {
                // A second id is ambiguous, exactly like a second private
                // header: the door refuses rather than picks.
                if id.is_some() {
                    return None;
                }
                id = Some(cursor.string()?);
            } else {
                cursor.skip(0)?;
            }
            cursor.space();
            match cursor.byte()? {
                b',' => continue,
                b'}' => break,
                _ => return None,
            }
        }
    }
    cursor.space();
    (cursor.at == body.len()).then_some(id)?
}

struct Cursor<'a> {
    body: &'a [u8],
    at: usize,
}

impl Cursor<'_> {
    fn peek(&self) -> Option<u8> {
        self.body.get(self.at).copied()
    }

    fn byte(&mut self) -> Option<u8> {
        let byte = self.peek()?;
        self.at += 1;
        Some(byte)
    }

    fn take(&mut self, byte: u8) -> Option<()> {
        (self.byte()? == byte).then_some(())
    }

    fn space(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.at += 1;
        }
    }

    /// A json string with no escape, which is every string this protocol
    /// carries: an id, a field name, a value the door skips.
    fn string(&mut self) -> Option<String> {
        self.take(b'"')?;
        let start = self.at;
        while self.peek()? != b'"' {
            if self.peek() == Some(b'\\') {
                return None;
            }
            self.at += 1;
        }
        let string = std::str::from_utf8(&self.body[start..self.at]).ok()?.to_string();
        self.at += 1;
        Some(string)
    }

    /// Skips one json value, so a field the door does not know cannot shift
    /// the field it does know into a position it would then believe.
    fn skip(&mut self, depth: usize) -> Option<()> {
        if depth > 8 {
            return None;
        }
        match self.peek()? {
            b'"' => self.string().map(|_| ()),
            b'{' => self.delimited(b'{', b'}', depth, true),
            b'[' => self.delimited(b'[', b']', depth, false),
            b't' => self.literal(b"true"),
            b'f' => self.literal(b"false"),
            b'n' => self.literal(b"null"),
            _ => self.number(),
        }
    }

    fn delimited(&mut self, open: u8, close: u8, depth: usize, named: bool) -> Option<()> {
        self.take(open)?;
        self.space();
        if self.peek() == Some(close) {
            self.byte()?;
            return Some(());
        }
        loop {
            self.space();
            if named {
                self.string()?;
                self.space();
                self.take(b':')?;
                self.space();
            }
            self.skip(depth + 1)?;
            self.space();
            match self.byte()? {
                b',' => continue,
                byte if byte == close => return Some(()),
                _ => return None,
            }
        }
    }

    fn literal(&mut self, word: &[u8]) -> Option<()> {
        if self.body[self.at..].starts_with(word) {
            self.at += word.len();
            Some(())
        } else {
            None
        }
    }

    fn number(&mut self) -> Option<()> {
        let start = self.at;
        while matches!(self.peek(), Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E')) {
            self.at += 1;
        }
        (self.at > start && self.body[start..self.at].iter().any(u8::is_ascii_digit)).then_some(())
    }
}
