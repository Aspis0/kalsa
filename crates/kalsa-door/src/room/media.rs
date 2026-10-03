//! The room's media routes: the upload road (`POST /kalsa/room/media` to
//! reserve, `PUT .../{upload}/{index}` to feed a chunk,
//! `POST .../{upload}/complete` to publish) and the download that streams
//! a published blob with its `Range` honoured. The wire here is thin over
//! the shelf the store keeps (`kalsa-room/src/media.rs`): the caps, the
//! digest, the magic bytes and the join floor are the store's verdicts;
//! this file frames them as HTTP and answers each with the protocol's
//! stable code.
//!
//! Nothing a media request carries can name a file: blobs have no
//! filenames anywhere in this door, and the ids in a path are checked
//! opaque hex before anything answers on their behalf.

use std::io::Read;
use std::net::TcpStream;
use std::time::Instant;

use kalsa_room::{MediaError, MemberId, Room};
use serde_json::{json, Value};
use std::sync::Arc;

use super::answers::{json_error, json_ok, read_body, store_failed};
use super::{RoomDoor, MALFORMED};
use crate::cors;
use crate::proxy;
use crate::request::UnsealedHead;

/// The most one chunk request may carry on the wire — the same number the
/// shelf enforces on the stored bytes, restated here so an oversized body
/// is refused before a byte of it is read.
const CHUNK_MAX: usize = 4 * 1024 * 1024;

/// The frames a video names are shape-checked here before the store sees
/// the request; the store checks them again, against its own shelf.
const FRAMES_MAX: usize = 4;

/// Routes the `/kalsa/room/media/...` subtree. The caller has been
/// authenticated and enrolled by the room's router; membership is the
/// door's to have enforced already, the shelf's rules the store's.
pub(super) fn serve(
    client: &mut TcpStream,
    door: &Arc<RoomDoor>,
    head: &UnsealedHead,
    member: MemberId,
    origin: Option<&[u8]>,
    deadline: Instant,
    path: &[u8],
) -> Vec<u8> {
    let rest = &path[b"/kalsa/room/media/".len()..];
    let segments: Vec<&[u8]> = rest.split(|byte| *byte == b'/').collect();
    match (head.method.as_slice(), segments.as_slice()) {
        (b"POST", [upload, b"complete"]) => {
            let _ = proxy::discard_request_body(client, head.body_length, deadline);
            match std::str::from_utf8(upload).ok().filter(|id| is_id(id)) {
                Some(upload) => complete(&door.room, member, origin, upload),
                None => refusal(origin, &MediaError::Unknown),
            }
        }
        (b"PUT", [_, _]) => chunk(client, &door.room, head, member, origin, deadline, rest),
        (b"GET", [id]) => match std::str::from_utf8(id).ok().filter(|id| is_id(id)) {
            Some(id) => download(client, &door.room, member, head, origin, deadline, id),
            None => refusal(origin, &MediaError::Unknown),
        },
        _ => {
            let _ = proxy::discard_request_body(client, head.body_length, deadline);
            refusal(origin, &MediaError::Unknown)
        }
    }
}

/// A media or upload id as the room mints them: 32 lowercase hex
/// characters. Anything else names nothing the shelf could hold.
fn is_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Reserves an upload: kind, mime, size, digest, pixels — and, for a
/// video, the still frames its sender already published beside it. Routed
/// from `mod` at the bare `/kalsa/room/media` path.
pub(super) fn create(
    client: &mut TcpStream,
    room: &Arc<Room>,
    head: &UnsealedHead,
    member: MemberId,
    origin: Option<&[u8]>,
    deadline: Instant,
) -> Vec<u8> {
    let Some(body) = read_body(client, head.body_length, deadline) else {
        return json_error(413, origin, "too_large", "The media request is too long.");
    };
    let Ok(value) = serde_json::from_slice::<Value>(&body) else {
        return json_error(400, origin, "bad_request", MALFORMED);
    };
    let Some(kind) = value
        .get("kind")
        .and_then(Value::as_str)
        .and_then(kind_of)
    else {
        return json_error(400, origin, "bad_request", MALFORMED);
    };
    let dim = |field: &str| {
        value
            .get(field)
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
    };
    let Some(spec) = (|| {
        Some(kalsa_room::MediaSpec {
            kind,
            mime: value.get("mime").and_then(Value::as_str)?.to_string(),
            bytes: value.get("bytes").and_then(Value::as_u64)?,
            sha256: value.get("sha256").and_then(Value::as_str)?.to_string(),
            width: dim("width")?,
            height: dim("height")?,
            duration_ms: value.get("duration_ms").and_then(Value::as_u64),
            frames: match value.get("frames") {
                None => Vec::new(),
                Some(frames) => match frames.as_array() {
                    Some(frames) if frames.len() <= FRAMES_MAX => frames
                        .iter()
                        .map(|frame| frame.as_str().unwrap_or_default().to_string())
                        .collect(),
                    _ => return None,
                },
            },
        })
    })() else {
        return json_error(400, origin, "bad_request", MALFORMED);
    };
    match room.media_create(member, spec) {
        Ok(upload) => json_ok(origin, &json!({ "upload": upload })),
        Err(error) => refusal(origin, &error),
    }
}

/// One chunk, bounded before it is read: a body past the chunk cap is
/// refused without its bytes, and an idempotent re-send of an index the
/// shelf already holds is answered from what is there. `rest` is the
/// `/{upload}/{index}` the router cut.
fn chunk(
    client: &mut TcpStream,
    room: &Arc<Room>,
    head: &UnsealedHead,
    member: MemberId,
    origin: Option<&[u8]>,
    deadline: Instant,
    rest: &[u8],
) -> Vec<u8> {
    let named: Vec<&[u8]> = rest.split(|byte| *byte == b'/').collect();
    let (upload, index) = match named.as_slice() {
        [upload, index] => (
            std::str::from_utf8(upload).ok().filter(|id| is_id(id)),
            std::str::from_utf8(index)
                .ok()
                .and_then(|index| index.parse::<u32>().ok()),
        ),
        _ => (None, None),
    };
    let (Some(upload), Some(index)) = (upload, index) else {
        let _ = proxy::discard_request_body(client, head.body_length, deadline);
        return json_error(400, origin, "bad_request", MALFORMED);
    };
    if head.body_length > CHUNK_MAX {
        let _ = proxy::discard_request_body(client, head.body_length, deadline);
        return json_error(413, origin, "too_large", "A chunk is at most 4 MiB.");
    }
    let mut bytes = vec![0u8; head.body_length];
    if proxy::set_read_deadline(client, deadline).is_err() || client.read_exact(&mut bytes).is_err()
    {
        return json_error(400, origin, "bad_request", MALFORMED);
    }
    match room.media_chunk(member, upload, index, &bytes) {
        Ok(received) => json_ok(origin, &json!({ "received": received })),
        Err(error) => refusal(origin, &error),
    }
}

/// Verifies the upload whole and publishes it. The answer is the blob's
/// descriptor — the id a post names, and the pixels it rode in with.
fn complete(room: &Arc<Room>, member: MemberId, origin: Option<&[u8]>, upload: &str) -> Vec<u8> {
    match room.media_complete(member, upload) {
        Ok(asset) => json_ok(origin, &serde_json::to_value(&asset).unwrap_or(json!(null))),
        Err(error) => refusal(origin, &error),
    }
}

/// Streams a published blob, `Range` honoured: 206 with the asked slice,
/// 416 for a slice the blob does not have, the whole body when no (single,
/// satisfiable) range was asked. `Cache-Control: private` — the bytes are
/// one member's room, not a cache's.
fn download(
    client: &mut TcpStream,
    room: &Arc<Room>,
    member: MemberId,
    head: &UnsealedHead,
    origin: Option<&[u8]>,
    deadline: Instant,
    id: &str,
) -> Vec<u8> {
    let file = match room.media_resolve(member, id) {
        Ok(file) => file,
        Err(error) => return refusal(origin, &error),
    };
    let range = head
        .range
        .as_deref()
        .and_then(|header| parse_range(header, file.len));
    if let Some(Err(())) = range {
        let head = format!(
            "HTTP/1.1 416 Range Not Satisfiable\r\n{}\
             Content-Range: bytes */{}\r\nContent-Length: 0\r\n\
             Cache-Control: private\r\nConnection: close\r\n\r\n",
            cors::origin_headers(origin),
            file.len
        );
        let _ = proxy::answer_to(client, head.as_bytes(), deadline);
        return Vec::new();
    }
    let (start, end) = range
        .map(|slice| slice.expect("the unsatisfiable case returned above"))
        .unwrap_or((0, file.len.saturating_sub(1)));
    let mut head = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\n",
        if range.is_some() {
            "206 Partial Content"
        } else {
            "200 OK"
        },
        file.mime
    );
    head.push_str(&cors::origin_headers(origin));
    head.push_str("Cache-Control: private\r\n");
    if range.is_some() {
        head.push_str(&format!(
            "Content-Range: bytes {start}-{end}/{}\r\n",
            file.len
        ));
    }
    head.push_str(&format!(
        "Content-Length: {}\r\nConnection: close\r\n\r\n",
        end - start + 1
    ));
    if proxy::answer_to(client, head.as_bytes(), deadline).is_err() {
        return Vec::new();
    }
    stream_blob(client, &file.path, start, end, deadline);
    Vec::new()
}

/// The blob's bytes from `start` through `end`, both ends in, in slices
/// that never hold more than the buffer.
fn stream_blob(
    client: &mut TcpStream,
    path: &std::path::Path,
    start: u64,
    end: u64,
    deadline: Instant,
) {
    let Ok(mut file) = std::fs::File::open(path) else {
        return;
    };
    use std::io::Seek;
    if file.seek(std::io::SeekFrom::Start(start)).is_err() {
        return;
    }
    let mut left = end - start + 1;
    let mut buffer = [0u8; 64 * 1024];
    while left > 0 {
        let want = buffer.len().min(left as usize);
        match file.read(&mut buffer[..want]) {
            Ok(0) => return,
            Ok(read) => {
                if proxy::write_with_deadline(client, &buffer[..read], deadline).is_err() {
                    return;
                }
                left -= read as u64;
            }
            Err(_) => return,
        }
    }
}

/// One `bytes=a-b` / `bytes=a-` / `bytes=-s` range, inclusive at both
/// ends, clamped to the blob. Anything else — other units, several ranges,
/// a malformed line — is no range at all: the whole blob is served, which
/// is what a client that cannot follow its own range request needs. A
/// start past the end, and an empty suffix, are unsatisfiable.
fn parse_range(header: &[u8], len: u64) -> Option<Result<(u64, u64), ()>> {
    let header = std::str::from_utf8(header).ok()?;
    let spec = header.strip_prefix("bytes=")?;
    let spec = spec.split(',').next()?.trim();
    if spec.is_empty() {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = if start.trim().is_empty() {
        let suffix: u64 = end.trim().parse().ok()?;
        let start = len.checked_sub(suffix).filter(|_| suffix > 0)?;
        (start, len.saturating_sub(1))
    } else {
        let start: u64 = start.trim().parse().ok()?;
        let end = if end.trim().is_empty() {
            len.saturating_sub(1)
        } else {
            end.trim().parse::<u64>().ok()?.min(len.saturating_sub(1))
        };
        (start, end)
    };
    if start >= len || start > end {
        return Some(Err(()));
    }
    Some(Ok((start, end)))
}

/// The door's spelling of the shelf's refusals: one stable code, one
/// sentence, the status the protocol gives each.
pub(super) fn refusal(origin: Option<&[u8]>, error: &MediaError) -> Vec<u8> {
    let (status, code) = match error {
        MediaError::BadRequest => (400, "bad_request"),
        MediaError::Incomplete => (400, "media_incomplete"),
        MediaError::BadSha => (400, "media_bad_sha"),
        MediaError::BadMagic => (400, "media_bad_magic"),
        MediaError::TooLarge => (413, "too_large"),
        MediaError::Full => (413, "room_media_full"),
        MediaError::Unknown => (404, "media_not_found"),
        MediaError::NotYours => (403, "media_not_yours"),
        MediaError::Forbidden => (403, "media_forbidden"),
        MediaError::Io(_) => return json_error(500, origin, "internal", store_failed()),
    };
    json_error(status, origin, code, &error.to_string())
}

fn kind_of(kind: &str) -> Option<kalsa_room::MediaKind> {
    match kind {
        "image" => Some(kalsa_room::MediaKind::Image),
        "video" => Some(kalsa_room::MediaKind::Video),
        _ => None,
    }
}
