//! The room's media rules: what a picture or video may be, who may read a
//! published blob, and the Room API the door's routes and the host's
//! commands drive. The bytes themselves — the temp files, the immutable
//! blobs, the index — are [`crate::shelf`]'s.
//!
//! The server never transcodes: the sender's device compresses before it
//! uploads, and the room only verifies what arrived against what was
//! declared (size, sha256, and the file's magic bytes against its mime).
//! Blobs are immutable once published and are named by random ids — no
//! filename, no path, no mime+filename pair ever crosses to a client or a
//! log line.
//!
//! One mutex guards the whole shelf. It never nests inside the transcript's
//! write lock while holding the roster's state lock: posting resolves and
//! records its media references with the media lock alone, and takes the
//! write and state locks only before and after. The reverse — a media route
//! holding the media lock and waiting on the write lock — does not exist,
//! so the two never circle.
//!
//! Durability is the index file's (`media/index.json`, the pairing store's
//! owner-only publication, like the roster). It holds every published
//! blob's record and owner. In-flight uploads are memory only: a restart
//! sweeps the uploads directory, and a client past the hour re-sends. A
//! transcript entry carries its media descriptors whole, so history reads
//! even where the index was lost; the blobs behind a lost index are
//! unserved orphans until the owner removes them, and are counted by no
//! quota.

use serde::{Deserialize, Serialize};

use crate::shelf::MediaFile;
use crate::{MemberId, Room};

/// The mimes a blob may wear, and the magic bytes each must open with.
const JPEG: &[u8] = &[0xff, 0xd8, 0xff];
const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
const MIMES: &[(&str, MediaKind)] = &[
    ("image/jpeg", MediaKind::Image),
    ("image/png", MediaKind::Image),
    ("image/webp", MediaKind::Image),
    ("video/mp4", MediaKind::Video),
];

/// One published blob, as the wire carries it: the sender-declared pixels
/// and length that came with the upload, the digest the store verified,
/// and, for a video, the still frames its sender extracted and uploaded
/// beside it (each an image blob of its own).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaAsset {
    pub id: String,
    pub kind: MediaKind,
    pub mime: String,
    pub bytes: u64,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub frames: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
}

impl MediaKind {
    pub(crate) fn mime_family(self) -> &'static str {
        match self {
            Self::Image => "image/",
            Self::Video => "video/",
        }
    }
}

/// The per-blob caps: the sender compressed before it uploaded; the store
/// refuses anything larger rather than shrink it.
pub const IMAGE_MAX_BYTES: u64 = 4 * 1024 * 1024;
pub const VIDEO_MAX_BYTES: u64 = 100 * 1024 * 1024;
/// The whole room's shelf: published blobs plus in-flight uploads. Full is
/// full — nothing is ever deleted to make room.
pub const QUOTA_BYTES: u64 = 2 * 1024 * 1024 * 1024;
/// What one item costs the quota whatever its real size: a shelf of tiny
/// files is a shelf of index records, and the record is the cost.
pub const MIN_CHARGE: u64 = 64 * 1024;
/// The most items the shelf will ever publish: the index is read whole at
/// open, and this is the roof on that read.
pub const MAX_PUBLISHED: usize = 10_000;
/// The most one chunk request may carry (the last may be smaller).
pub const CHUNK_MAX_BYTES: usize = 4 * 1024 * 1024;
/// The most still frames one video may carry.
pub const FRAMES_MAX: usize = 4;
/// The most blobs one post may attach.
pub const POST_MEDIA_MAX: usize = 8;
/// The pixel bomb rule: no side over this, and no frame over
/// [`MAX_PIXELS`] — an image the engine would have to decode into a
/// framebuffersized hole.
pub const MAX_SIDE: u32 = 8192;
pub const MAX_PIXELS: u64 = 40_000_000;

/// Why a media request was refused. The sentences are all a client sees;
/// the io error stays in the value for the app's local log.
#[derive(Debug)]
pub enum MediaError {
    BadRequest,
    /// The upload's chunks have not all arrived.
    Incomplete,
    /// The bytes on disk do not hash to what the upload declared.
    BadSha,
    /// The bytes on disk do not open like the mime they declared.
    BadMagic,
    /// The image's own frame is larger than the room reads: a pixel bomb.
    TooManyPixels,
    /// The declared size is past the cap for its kind.
    TooLarge,
    /// The room's shelf is at its quota.
    Full,
    /// No upload or blob by that id.
    Unknown,
    /// Only the uploader touches its upload or attaches its blob.
    NotYours,
    /// A member the room cannot place, or a blob posted before they joined.
    Forbidden,
    Io(std::io::Error),
}

impl std::fmt::Display for MediaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::BadRequest => f.write_str("the media request is not one the room reads"),
            Self::Incomplete => f.write_str("not all of the upload has arrived yet"),
            Self::BadSha => f.write_str("the upload arrived damaged; send it again"),
            Self::BadMagic => f.write_str("that file is not the kind it said it was"),
            Self::TooManyPixels => f.write_str("that image has too many pixels for this room"),
            Self::TooLarge => f.write_str("the media is larger than this room takes"),
            Self::Full => f.write_str("this room's media shelf is full"),
            Self::Unknown => f.write_str("that media is not in this room"),
            Self::NotYours => f.write_str("only the device that uploaded media may attach it"),
            Self::Forbidden => f.write_str("you were not in the room when that was posted"),
            Self::Io(_) => f.write_str("the room's media store failed on disk"),
        }
    }
}

/// What an upload declares about the whole file it is about to send —
/// the create call's one argument, and the shelf's own record until the
/// bytes arrive and the blob is published.
#[derive(Clone)]
pub struct MediaSpec {
    pub kind: MediaKind,
    pub mime: String,
    pub bytes: u64,
    pub sha256: String,
    pub width: u32,
    pub height: u32,
    pub duration_ms: Option<u64>,
    pub frames: Vec<String>,
}

impl From<&MediaAsset> for MediaSpec {
    fn from(asset: &MediaAsset) -> Self {
        Self {
            kind: asset.kind,
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

impl MediaAsset {
    /// The descriptor as the store judges it: the same rules a create is
    /// held to, for the lines the transcript's loader reads back.
    pub(crate) fn check(&self) -> Result<(), MediaError> {
        check_declared(&MediaSpec::from(self))
    }
}

impl MediaSpec {
    pub(crate) fn asset(self, id: String) -> MediaAsset {
        MediaAsset {
            id,
            kind: self.kind,
            mime: self.mime,
            bytes: self.bytes,
            sha256: self.sha256,
            width: self.width,
            height: self.height,
            duration_ms: self.duration_ms,
            frames: self.frames,
        }
    }
}

/// The create-time rules: a mime the room serves, agreeing with the kind,
/// a size within the kind's cap, a digest shaped like a sha256, and the
/// frames field only where a video carries it. The frames themselves are
/// checked live, against the shelf, at create. The transcript's loader
/// runs the same rules on the descriptors it reads back.
pub(crate) fn check_declared(spec: &MediaSpec) -> Result<(), MediaError> {
    let (_, kind) = MIMES
        .iter()
        .find(|(mime, _)| *mime == spec.mime)
        .ok_or(MediaError::BadRequest)?;
    if *kind != spec.kind {
        return Err(MediaError::BadRequest);
    }
    let cap = match spec.kind {
        MediaKind::Image => IMAGE_MAX_BYTES,
        MediaKind::Video => VIDEO_MAX_BYTES,
    };
    if spec.bytes == 0 || spec.bytes > cap {
        return Err(MediaError::TooLarge);
    }
    let hex = |byte: u8| {
        byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) || byte.is_ascii_uppercase()
    };
    if spec.sha256.len() != 64 || !spec.sha256.bytes().all(hex) {
        return Err(MediaError::BadRequest);
    }
    if spec.width == 0 || spec.height == 0 {
        return Err(MediaError::BadRequest);
    }
    if (spec.kind == MediaKind::Image && (spec.duration_ms.is_some() || !spec.frames.is_empty()))
        || spec.frames.len() > FRAMES_MAX
    {
        return Err(MediaError::BadRequest);
    }
    Ok(())
}

/// The magic bytes each mime must open with: the store trusts the file's
/// own first words over any client's label.
pub(crate) fn opens_like(bytes: &[u8], mime: &str, kind: MediaKind) -> bool {
    if !mime.starts_with(kind.mime_family()) {
        return false;
    }
    match mime {
        "image/jpeg" => bytes.starts_with(JPEG),
        "image/png" => bytes.starts_with(PNG),
        "image/webp" => bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        "video/mp4" => bytes.len() >= 8 && &bytes[4..8] == b"ftyp",
        _ => false,
    }
}

/// The smallest file each kind can plausibly be: below this there is no
/// room for the header that proves the kind, let alone a frame. Chosen as
/// size floors rather than a deeper parse because the frame parse below
/// already proves structure — this only refuses the absurd early.
pub(crate) fn size_floor(mime: &str) -> u64 {
    match mime {
        "image/jpeg" => 125,
        "image/png" => 67,
        "image/webp" => 30,
        "video/mp4" => 1024,
        _ => 0,
    }
}

/// The pixels an image file itself declares: JPEG's SOFn, PNG's IHDR,
/// WebP's VP8X/VP8/VP8L. `None` when the frame cannot be found — a file
/// whose own header cannot be read is not plausibly the kind it claimed.
/// A video's pixels stay the sender's declared ones: the box tree that
/// carries them is a parser of its own, and the room never decodes video.
pub(crate) fn dimensions(bytes: &[u8], mime: &str) -> Option<(u32, u32)> {
    match mime {
        "image/jpeg" => jpeg_dimensions(bytes),
        "image/png" => png_dimensions(bytes),
        "image/webp" => webp_dimensions(bytes),
        _ => None,
    }
}

/// Walks the JPEG's marker segments to the first SOFn (any of C0–CF but
/// the four that are not frames: DHT, JPG, DAC) and reads the frame's own
/// height then width, both big-endian, three bytes past the segment
/// header.
fn jpeg_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let mut at = 2;
    while at + 4 <= bytes.len() {
        if bytes[at] != 0xff {
            // Lost sync between markers: not a JPEG's body.
            return None;
        }
        let marker = bytes[at + 1];
        if marker == 0x01 || (0xd0..=0xd9).contains(&marker) {
            at += 2;
            continue;
        }
        let length = u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]) as usize;
        let frame =
            (0xc0..=0xcf).contains(&marker) && marker != 0xc4 && marker != 0xc8 && marker != 0xcc;
        if frame {
            if at + 9 > bytes.len() {
                return None;
            }
            let height = u16::from_be_bytes([bytes[at + 5], bytes[at + 6]]);
            let width = u16::from_be_bytes([bytes[at + 7], bytes[at + 8]]);
            return (width > 0 && height > 0).then_some((width as u32, height as u32));
        }
        at += 2 + length;
    }
    None
}

/// PNG's first chunk is IHDR by definition, its payload the width then
/// height, both big-endian, at fixed offsets from the file's start.
fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    (width > 0 && height > 0).then_some((width, height))
}

/// WebP's frame sits in the first chunk after the RIFF header: VP8X names
/// the canvas directly (two 24-bit little-endian values, minus one), VP8
/// carries it past the lossy frame tag and sync code (two 14-bit values),
/// VP8L packs width-1 and height-1 into the first 28 bits after its
/// signature.
fn webp_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let tag = bytes.get(12..16)?;
    let le24 = |at: usize| -> u32 {
        u32::from(bytes[at]) | (u32::from(bytes[at + 1]) << 8) | (u32::from(bytes[at + 2]) << 16)
    };
    match tag {
        b"VP8X" if bytes.len() >= 30 => {
            let width = 1 + le24(24);
            let height = 1 + le24(27);
            Some((width, height))
        }
        b"VP8 " if bytes.len() >= 30 => {
            if bytes[23..26] != [0x9d, 0x01, 0x2a] {
                return None;
            }
            let width = u16::from_le_bytes([bytes[26], bytes[27]]) & 0x3fff;
            let height = (u16::from_le_bytes([bytes[28], bytes[29]]) >> 2) & 0x3fff;
            (width > 0 && height > 0).then_some((width as u32, height as u32))
        }
        b"VP8L" if bytes.len() >= 25 => {
            if bytes[20] != 0x2f {
                return None;
            }
            let bits = u32::from_le_bytes([bytes[21], bytes[22], bytes[23], bytes[24]]);
            let width = (bits & 0x3fff) + 1;
            let height = ((bits >> 14) & 0x3fff) + 1;
            Some((width, height))
        }
        _ => None,
    }
}

/// The pixel bomb verdict for a frame the file itself declared.
pub(crate) fn pixel_error(width: u32, height: u32) -> Option<MediaError> {
    if width > MAX_SIDE || height > MAX_SIDE || u64::from(width) * u64::from(height) > MAX_PIXELS {
        Some(MediaError::TooManyPixels)
    } else {
        None
    }
}

/// Whether the declared sha256 and the verified one name the same bytes.
/// The declared digest is folded to lowercase once, at create.
pub(crate) fn normalize_sha256(declared: &str) -> Option<String> {
    let lowered = declared.to_ascii_lowercase();
    let hex = |byte: u8| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte);
    (lowered.len() == 64 && lowered.bytes().all(hex)).then_some(lowered)
}

impl Room {
    /// Reserves an upload on the shelf. The frames a video names must
    /// already be published images of the uploader's own.
    pub fn media_create(&self, member: MemberId, spec: MediaSpec) -> Result<String, MediaError> {
        self.live_member(member)?;
        let sha256 = normalize_sha256(&spec.sha256).ok_or(MediaError::BadRequest)?;
        let mut spec = spec;
        spec.sha256 = sha256;
        let mut media = self.media.lock().unwrap_or_else(|p| p.into_inner());
        media.sweep();
        media.create(member, spec)
    }

    pub fn media_chunk(
        &self,
        member: MemberId,
        upload: &str,
        index: u32,
        bytes: &[u8],
    ) -> Result<u64, MediaError> {
        self.live_member(member)?;
        let mut media = self.media.lock().unwrap_or_else(|p| p.into_inner());
        media.chunk(member, upload, index, bytes)
    }

    pub fn media_complete(&self, member: MemberId, upload: &str) -> Result<MediaAsset, MediaError> {
        self.live_member(member)?;
        let mut media = self.media.lock().unwrap_or_else(|p| p.into_inner());
        media.complete(member, upload)
    }

    /// The blob a member may stream, with their join floor applied. A
    /// member with no join point is refused, exactly as history refuses
    /// one — the floor of nothing is not everything.
    pub fn media_resolve(&self, member: MemberId, id: &str) -> Result<MediaFile, MediaError> {
        self.live_member(member)?;
        let floor = {
            let state = self.lock_state();
            match member {
                MemberId::Host => None,
                // The AI never downloads through a member route; the arm
                // is exhaustiveness, not a road.
                MemberId::Ai => return Err(MediaError::Forbidden),
                MemberId::Member(_) => {
                    Some(state.roster.join_of(member).ok_or(MediaError::Forbidden)?)
                }
            }
        };
        let media = self.media.lock().unwrap_or_else(|p| p.into_inner());
        media.resolve(member, floor, id)
    }

    /// The bytes behind a blob id, for the room's own readers: the AI's
    /// turn and the host. No member check — the callers' office is the
    /// whole room.
    pub fn media_bytes(&self, id: &str) -> Option<(String, Vec<u8>)> {
        self.media
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .bytes_of(id)
    }

    /// The host clears the shelf from the computer itself — no phone
    /// route exists for this, and no member but the host may call it.
    /// Every blob and in-flight upload is deleted, the quota starts from
    /// zero, and the transcript is untouched: its media descriptors stay,
    /// and a download of a cleared blob answers `media_not_found` from
    /// that moment. One `media_cleared` event tells every listener.
    pub fn media_clear(&self, member: MemberId) -> Result<(), MediaError> {
        if member != MemberId::Host {
            return Err(MediaError::Forbidden);
        }
        let cleared = {
            let mut media = self.media.lock().unwrap_or_else(|p| p.into_inner());
            media.clear().is_ok()
        };
        if !cleared {
            return Err(MediaError::Io(std::io::Error::other(
                "the media index could not be rewritten",
            )));
        }
        self.publish_media(crate::MediaEvent::Cleared);
        Ok(())
    }

    /// Records what a landed entry references — after the entry is on
    /// disk, so a blob is only ever opened up to a transcript that exists.
    pub(crate) fn media_reference(&self, assets: &[MediaAsset], seq: u64) {
        if assets.is_empty() {
            return;
        }
        let mut media = self.media.lock().unwrap_or_else(|p| p.into_inner());
        media.reference(assets, seq);
    }

    /// Rebuilds the reference table from the transcript the room opened
    /// with, at open.
    pub(crate) fn media_seed_refs(&self) {
        let state = self.lock_state();
        let mut media = self.media.lock().unwrap_or_else(|p| p.into_inner());
        for message in &state.messages {
            media.reference(&message.media, message.seq);
        }
    }

    fn live_member(&self, member: MemberId) -> Result<(), MediaError> {
        let state = self.lock_state();
        if state.roster.is_live(member) {
            Ok(())
        } else {
            Err(MediaError::Forbidden)
        }
    }

    /// Ages every upload past the sweep's hour: the test's hand on the
    /// clock the sweep runs by.
    #[cfg(test)]
    pub(crate) fn expire_uploads_for_test(&self) {
        self.media
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .expire_uploads();
    }
}
