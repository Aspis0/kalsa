//! The host's own media commands: the room's shelf driven from this
//! computer — reserve, feed, publish, read, clear — the same caps and
//! checks a phone's upload road runs through the door, with no door hop.
//! The host is [`kalsa_room::MemberId::Host`], who sees the whole room.

use serde::Serialize;
use std::sync::Arc;

use crate::room_commands::{media_command_error, RoomCommandError};
use kalsa_room::{MediaAsset, MediaKind, Room};

/// One blob's descriptor, as the host's page reads it: the same shape the
/// protocol carries in a message's `media` array.
#[derive(Serialize)]
pub struct RoomMediaDto {
    pub id: String,
    pub kind: &'static str,
    pub mime: String,
    pub bytes: u64,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
    pub duration_ms: Option<u64>,
    pub frames: Vec<String>,
}

impl RoomMediaDto {
    pub(crate) fn of(asset: &MediaAsset) -> Self {
        Self {
            id: asset.id.clone(),
            kind: kind_of(asset.kind),
            mime: asset.mime.clone(),
            bytes: asset.bytes,
            sha256: asset.sha256.clone(),
            width: asset.width,
            height: asset.height,
            duration_ms: asset.duration_ms,
            frames: asset.frames.clone(),
        }
    }
}

fn kind_of(kind: MediaKind) -> &'static str {
    match kind {
        MediaKind::Image => "image",
        MediaKind::Video => "video",
    }
}

fn room_of(brain: &crate::Brain) -> Result<Arc<Room>, RoomCommandError> {
    brain
        .room
        .get()
        .cloned()
        .ok_or_else(RoomCommandError::internal)
}

/// Reserves an upload: kind, mime, size, digest, pixels, and — for a
/// video — the frame blobs its sender published first. The answer is the
/// upload id the chunk calls name.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn brain_room_media_create(
    brain: tauri::State<'_, crate::Brain>,
    kind: String,
    mime: String,
    bytes: u64,
    sha256: String,
    width: u32,
    height: u32,
    duration_ms: Option<u64>,
    frames: Option<Vec<String>>,
) -> Result<String, RoomCommandError> {
    let room = room_of(&brain)?;
    let kind = match kind.as_str() {
        "image" => MediaKind::Image,
        "video" => MediaKind::Video,
        _ => {
            return Err(RoomCommandError {
                code: "bad_request",
            })
        }
    };
    room.media_create(
        kalsa_room::MemberId::Host,
        kalsa_room::MediaSpec {
            kind,
            mime,
            bytes,
            sha256,
            width,
            height,
            duration_ms,
            frames: frames.unwrap_or_default(),
        },
    )
    .map_err(media_command_error)
}

/// One chunk of an upload, at its fixed place. A re-sent index is
/// answered from what the shelf already holds.
#[tauri::command]
pub fn brain_room_media_chunk(
    brain: tauri::State<'_, crate::Brain>,
    upload: String,
    index: u32,
    bytes: Vec<u8>,
) -> Result<u64, RoomCommandError> {
    let room = room_of(&brain)?;
    room.media_chunk(kalsa_room::MemberId::Host, &upload, index, &bytes)
        .map_err(media_command_error)
}

/// Verifies the upload whole and publishes it; the answer is the
/// descriptor the host's post will name.
#[tauri::command]
pub fn brain_room_media_complete(
    brain: tauri::State<'_, crate::Brain>,
    upload: String,
) -> Result<RoomMediaDto, RoomCommandError> {
    let room = room_of(&brain)?;
    room.media_complete(kalsa_room::MemberId::Host, &upload)
        .map(|asset| RoomMediaDto::of(&asset))
        .map_err(media_command_error)
}

/// A published blob's raw bytes, for the page's own rendering — binary
/// over IPC, no JSON wrapping. The mime lives in the message's media
/// descriptor; this answers only the bytes the shelf verified. The host
/// sees the whole room; there is no floor on this read.
#[tauri::command]
pub fn brain_room_media_read(
    brain: tauri::State<'_, crate::Brain>,
    id: String,
) -> Result<tauri::ipc::Response, RoomCommandError> {
    let room = room_of(&brain)?;
    let bytes = media_read(&room, &id)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The read's body, split out for the tests: the shelf's bytes or the
/// stable not-found code.
pub(crate) fn media_read(room: &Room, id: &str) -> Result<Vec<u8>, RoomCommandError> {
    room.media_bytes(id)
        .map(|(_, bytes)| bytes)
        .ok_or(RoomCommandError {
            code: "media_not_found",
        })
}

/// The host clears the shelf: every blob and in-flight upload is deleted,
/// the quota starts from zero, the transcript stays as it is — its media
/// descriptors remain, and a read of a cleared blob answers
/// `media_not_found`. Every listener is told through the room's
/// `media_cleared` event. No phone route exists for this.
#[tauri::command]
pub fn brain_room_media_clear(
    brain: tauri::State<'_, crate::Brain>,
) -> Result<(), RoomCommandError> {
    let room = room_of(&brain)?;
    room.media_clear(kalsa_room::MemberId::Host)
        .map_err(media_command_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "kalsa-brain-room-media-{name}-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    /// A JPEG with a real SOF0 frame — the shelf reads an image's pixels
    /// from the file's own header.
    fn jpeg_bytes() -> Vec<u8> {
        let mut bytes = vec![0xff, 0xd8];
        bytes.extend_from_slice(&[0xff, 0xe0, 0x00, 0x10]);
        bytes.extend_from_slice(b"JFIF\0");
        bytes.extend(std::iter::repeat_n(0x00u8, 9));
        bytes.extend_from_slice(&[0xff, 0xc0, 0x00, 0x11, 0x08]);
        bytes.extend_from_slice(&480u16.to_be_bytes());
        bytes.extend_from_slice(&640u16.to_be_bytes());
        bytes.extend_from_slice(&[0x03]);
        bytes.extend(std::iter::repeat_n(0x00u8, 9));
        bytes.extend(std::iter::repeat_n(0xa5u8, 200));
        bytes
    }

    fn upload(room: &Room) -> kalsa_room::MediaAsset {
        use sha2::{Digest, Sha256};
        let digest: [u8; 32] = Sha256::digest(jpeg_bytes()).into();
        let sha256: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        let upload = room
            .media_create(
                kalsa_room::MemberId::Host,
                kalsa_room::MediaSpec {
                    kind: MediaKind::Image,
                    mime: "image/jpeg".to_string(),
                    bytes: jpeg_bytes().len() as u64,
                    sha256,
                    width: 640,
                    height: 480,
                    duration_ms: None,
                    frames: Vec::new(),
                },
            )
            .unwrap();
        room.media_chunk(kalsa_room::MemberId::Host, &upload, 0, &jpeg_bytes())
            .unwrap();
        room.media_complete(kalsa_room::MemberId::Host, &upload)
            .unwrap()
    }

    /// The read command's body: the shelf's raw bytes — no JSON, no mime,
    /// the descriptor carries that — or the stable not-found code, before
    /// and after the host clears the shelf.
    #[test]
    fn the_read_answers_the_raw_bytes_or_the_code() {
        let dir = scratch("read");
        let room = Room::open(&dir).unwrap();
        let asset = upload(&room);
        assert_eq!(
            media_read(&room, &asset.id).unwrap_or_default(),
            jpeg_bytes()
        );
        assert_eq!(
            media_read(&room, &"0".repeat(32))
                .err()
                .map(|error| error.code),
            Some("media_not_found")
        );
        room.media_clear(kalsa_room::MemberId::Host).unwrap();
        assert_eq!(
            media_read(&room, &asset.id).err().map(|error| error.code),
            Some("media_not_found")
        );
    }
}
