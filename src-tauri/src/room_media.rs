//! The host's own media commands: the room's shelf driven from this
//! computer — reserve, feed, publish, read — the same caps and checks a
//! phone's upload road runs through the door, with no door hop. The host
//! is [`kalsa_room::MemberId::Host`], who sees the whole room; the read
//! command serves the webview its pixels.

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

/// A blob's bytes for the page: the mime it was published with, and the
/// body the shelf verified.
#[derive(Serialize)]
pub struct RoomMediaBytesDto {
    pub mime: String,
    pub data: Vec<u8>,
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

/// A published blob's bytes, for the page's own rendering. The host sees
/// the whole room; there is no floor on this read.
#[tauri::command]
pub fn brain_room_media_read(
    brain: tauri::State<'_, crate::Brain>,
    id: String,
) -> Result<RoomMediaBytesDto, RoomCommandError> {
    let room = room_of(&brain)?;
    let (mime, data) = room.media_bytes(&id).ok_or(RoomCommandError {
        code: "media_not_found",
    })?;
    Ok(RoomMediaBytesDto { mime, data })
}
