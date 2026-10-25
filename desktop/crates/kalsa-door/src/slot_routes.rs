//! The engine's own slot routes, and the door's refusal of them before any
//! lease.
//!
//! `GET /slots` reports every slot's state — the prompt and progress of
//! another device's generation included — and `POST /slots/:id_slot` saves,
//! restores or erases one. Neither consults `X-Kalsa-Slot`: the slot comes
//! from the URL. The engine is being taught to refuse a URL that disagrees
//! with the header, and the door still refuses these routes on its own,
//! because an isolation property must not depend on the component it isolates.
//! The fork registers both routes unconditionally; the flags gate the handler,
//! which answers "not supported" without `--slots` or `--slot-save-path`. This
//! app passes neither, so no prompt leaks today — but the route is there, and
//! one flag added for any other reason would make it reachable.
//!
//! The path is read with the engine's own decoder, `cpp-httplib`'s
//! `decode_path_component`, `%uXXXX` and all. That is not decoration: the
//! decoder turns `/%u0073%u006c%u006f%u0074%u0073` into `/slots`, so a matcher
//! that knew only `%XX` would forward a request the engine routes to `/slots`.

use crate::cors;

/// Whether this request target names one of the engine's slot routes.
///
/// Two clauses, and the union is the point. The first is what the engine
/// routes: `GET /slots` compares the path for equality and `POST
/// /slots/:id_slot` matches the prefix `/slots/` plus one segment, so the
/// decoded path is `/slots` or begins with `/slots/`. The second refuses any
/// path whose first resolved segment is `slots` — deliberate over-refusal, so
/// that a decoder difference between the door and the engine cannot become a
/// bypass. It costs nothing today: no legitimate route has that spelling, and
/// the one thing it might catch — a deployed UI asset literally named `slots`,
/// served as a static file — does not exist in the source tree.
/// An exact match alone would make the door's safety depend on this reading of
/// the engine being complete, and that assumption is what hid the `%uXXXX`
/// bypass.
pub(super) fn is_slot_route(target: &[u8]) -> bool {
    let path = decoded_path(path_of(target));
    if path == b"/slots" || path.starts_with(b"/slots/") {
        return true;
    }
    first_resolved_segment(&path).is_some_and(|segment| segment == b"slots")
}

/// The path of a request target, cut as the engine cuts it: everything from
/// the first `#` is dropped, then everything from the first `?` — the left
/// side is the path. There is deliberately no authority removal, because the
/// engine does none: `http://x/slots` stays literally that and routes nowhere.
fn path_of(target: &[u8]) -> &[u8] {
    let target = match target.iter().position(|byte| *byte == b'#') {
        Some(at) => &target[..at],
        None => target,
    };
    match target.iter().position(|byte| *byte == b'?') {
        Some(at) => &target[..at],
        None => target,
    }
}

/// The path with every escape undone exactly as the engine's decoder undoes
/// it: `%uXXXX` is a UTF-16 code point, `%XX` is one byte, and an escape that
/// does not open with the required digits leaves the `%` as itself, so the
/// characters after it are read normally. The `%u` form is the whole reason
/// this is mirrored rather than simplified.
fn decoded_path(component: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(component.len());
    let mut index = 0;
    while index < component.len() {
        if component[index] == b'%' && index + 1 < component.len() {
            if component[index + 1] == b'u' {
                if let Some(code) = hex_value(component, index + 2, 4) {
                    to_utf8(code, &mut out);
                    index += 5; // '%u' and its four digits, with the step below
                } else {
                    out.push(component[index]);
                }
            } else if let Some(byte) = hex_value(component, index + 1, 2) {
                out.push(byte as u8);
                index += 2; // 'XX', with the step below
            } else {
                out.push(component[index]);
            }
        } else {
            out.push(component[index]);
        }
        index += 1;
    }
    out
}

/// `count` hex digits from `start`, or nothing when they run off the end or
/// one of them is not a digit.
fn hex_value(bytes: &[u8], start: usize, count: usize) -> Option<u32> {
    let mut value = 0;
    for offset in 0..count {
        value = value * 16 + u32::from(nibble(*bytes.get(start + offset)?)?);
    }
    Some(value)
}

fn nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// One `%uXXXX` code point, written as the engine writes it: UTF-8 of one to
/// three bytes, and nothing at all for a surrogate — the engine's `to_utf8`
/// returns zero there and the escape is consumed all the same. Four hex digits
/// cannot exceed `0xFFFF`, so its four-byte branch is unreachable from here.
fn to_utf8(code: u32, out: &mut Vec<u8>) {
    match code {
        0x0000..=0x007f => out.push(code as u8),
        0x0080..=0x07ff => out.extend_from_slice(&[
            0xc0u8 | ((code >> 6) & 0x1f) as u8,
            0x80u8 | (code & 0x3f) as u8,
        ]),
        0x0800..=0xd7ff | 0xe000..=0xffff => out.extend_from_slice(&[
            0xe0u8 | ((code >> 12) & 0x0f) as u8,
            0x80u8 | ((code >> 6) & 0x3f) as u8,
            0x80u8 | (code & 0x3f) as u8,
        ]),
        _ => {} // 0xd800..=0xdfff: invalid, and the engine writes nothing either
    }
}

/// The first segment of a path once empty and `.` segments are dropped and
/// `..` pops the segment before it. This normalization is the door's own — the
/// engine does none — and belongs only to the over-refusing clause above, so a
/// spelling that resolves to the slot routes is refused even though the engine
/// would not route it.
fn first_resolved_segment(path: &[u8]) -> Option<&[u8]> {
    let mut segments: Vec<&[u8]> = Vec::new();
    for segment in path.split(|byte| *byte == b'/') {
        match segment {
            b"" | b"." => {}
            b".." => {
                segments.pop();
            }
            _ => segments.push(segment),
        }
    }
    segments.first().copied()
}

/// The refusal: the door's own 403, carrying one honest sentence. It speaks
/// where the 401 does not — the device presented a credential, and it is the
/// request that is wrong — and it names the origin like every other door
/// answer written with a head in hand.
pub(super) fn refusal_response(origin: Option<&[u8]>) -> Vec<u8> {
    const WORDS: &str =
        "The door assigns each device its slot; the engine's slot routes are not served through it.";
    let origin_headers = cors::origin_headers(origin);
    format!(
        "HTTP/1.1 403 Forbidden\r\n{origin_headers}\
         Content-Type: text/plain; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{WORDS}",
        WORDS.len()
    )
    .into_bytes()
}

#[cfg(test)]
mod tests {
    use super::decoded_path;

    /// The decoder is the engine's, escape for escape: `%uXXXX` is a code
    /// point, `%XX` one byte, and a malformed escape leaves its `%` behind for
    /// the following characters to be read normally. The `%u` spelling is the
    /// bypass this decode exists for, so the escapes around it are pinned here
    /// and not only through a socket.
    #[test]
    fn the_decoder_undoes_the_engines_own_escapes_and_no_others() {
        assert_eq!(decoded_path(b"/%u0073%u006c%u006f%u0074%u0073"), b"/slots");
        assert_eq!(decoded_path(b"/%u002fslots"), b"//slots");
        assert_eq!(decoded_path(b"/slots%2F0"), b"/slots/0");
        assert_eq!(decoded_path(b"/%2Fslots"), b"//slots");
        // A successful `%u` consumes 'u' and exactly four digits, so the
        // characters after it are read as themselves.
        assert_eq!(decoded_path(b"/%u0073lots"), b"/slots");
        assert_eq!(decoded_path(b"/%u0800x"), b"/\xe0\xa0\x80x".as_slice());
        // A surrogate code point writes nothing, and the escape is consumed.
        assert_eq!(decoded_path(b"/%uD800lots"), b"/lots");
        // A malformed escape is literal, so these are not slot routes.
        assert_eq!(decoded_path(b"/%uZZZZlots"), b"/%uZZZZlots");
        assert_eq!(decoded_path(b"/%zzlots"), b"/%zzlots");
        assert_eq!(decoded_path(b"/trailing%"), b"/trailing%");
    }
}
