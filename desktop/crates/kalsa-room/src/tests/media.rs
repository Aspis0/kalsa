//! The media shelf: the upload road, the caps and the checks that guard
//! it, and the access rule that ties a blob to the transcript entry that
//! posted it.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::media::{
    MediaError, MediaKind, CHUNK_MAX_BYTES, IMAGE_MAX_BYTES, MIN_CHARGE, QUOTA_BYTES,
    VIDEO_MAX_BYTES,
};
use crate::{Entry, Event, MediaAsset, MediaEvent, MediaSpec, MemberId, PostError, Room};

use super::{open, phone, Scratch};

fn sha256_of(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A JPEG that carries a real SOF0 frame: the room reads an image's pixels
/// from the file's own header, so a fixture of magic bytes alone is not an
/// image to this store.
fn jpeg_bytes(width: u16, height: u16) -> Vec<u8> {
    let mut bytes = vec![0xff, 0xd8]; // SOI
    bytes.extend_from_slice(&[0xff, 0xe0, 0x00, 0x10]); // APP0, length 16
    bytes.extend_from_slice(b"JFIF\0");
    bytes.extend(std::iter::repeat_n(0x00u8, 9)); // the APP0 payload, padded
    bytes.extend_from_slice(&[0xff, 0xc0, 0x00, 0x11, 0x08]); // SOF0, length 17, 8-bit
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&[0x03]); // three components
    bytes.extend(std::iter::repeat_n(0x00u8, 9)); // their triples
    bytes.extend(std::iter::repeat_n(0xa5u8, 200)); // entropy-ish tail
    bytes
}

/// A PNG whose IHDR names the given frame.
fn png_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    bytes.extend_from_slice(&[0x00, 0x00, 0x00, 0x0d]); // IHDR, length 13
    bytes.extend_from_slice(b"IHDR");
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[0x08, 0x06, 0x00, 0x00, 0x00]);
    bytes.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // CRC, unchecked
    bytes.extend(std::iter::repeat_n(0xa5u8, 40));
    bytes
}

/// A lossless WebP whose VP8L chunk packs the frame into its first bits.
fn webp_bytes(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&9u32.to_le_bytes()); // the chunk's own size
    bytes.extend_from_slice(b"WEBP");
    bytes.extend_from_slice(b"VP8L");
    bytes.extend_from_slice(&9u32.to_le_bytes());
    bytes.push(0x2f); // VP8L's signature
    let bits = (width - 1) | ((height - 1) << 14);
    bytes.extend_from_slice(&bits.to_le_bytes());
    bytes.extend(std::iter::repeat_n(0x00u8, 5));
    bytes
}

/// An MP4 past its size floor, its pixels the sender's own (the room never
/// parses a video's box tree).
fn video_bytes() -> Vec<u8> {
    let mut bytes = vec![0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p'];
    bytes.extend(std::iter::repeat_n(0x21u8, 1208));
    bytes
}

/// A video too big for one chunk: two chunks, the second short. (An image
/// never gets here: its cap is one chunk.)
fn big_video() -> Vec<u8> {
    let mut bytes = video_bytes();
    bytes.extend(std::iter::repeat_n(
        0x5au8,
        CHUNK_MAX_BYTES + 1000 - bytes.len(),
    ));
    bytes
}

/// Uploads one blob the honest way — reserve, feed, publish — declaring
/// the pixels a sender's screen would claim, whatever the file says.
fn upload_bytes(
    room: &Room,
    member: MemberId,
    kind: MediaKind,
    mime: &str,
    bytes: &[u8],
    frames: &[String],
) -> Result<MediaAsset, MediaError> {
    upload_as(room, member, mime, bytes, kind, (640, 480), frames)
}

fn upload_as(
    room: &Room,
    member: MemberId,
    mime: &str,
    bytes: &[u8],
    kind: MediaKind,
    dims: (u32, u32),
    frames: &[String],
) -> Result<MediaAsset, MediaError> {
    let (width, height) = dims;
    let upload = room.media_create(
        member,
        MediaSpec {
            kind,
            mime: mime.to_string(),
            bytes: bytes.len() as u64,
            sha256: sha256_of(bytes),
            width,
            height,
            duration_ms: (kind == MediaKind::Video).then_some(30_000),
            frames: frames.to_vec(),
        },
    )?;
    for (index, chunk) in bytes.chunks(CHUNK_MAX_BYTES).enumerate() {
        room.media_chunk(member, &upload, index as u32, chunk)?;
    }
    room.media_complete(member, &upload)
}

fn image_asset(room: &Room, member: MemberId) -> MediaAsset {
    upload_bytes(
        room,
        member,
        MediaKind::Image,
        "image/jpeg",
        &jpeg_bytes(640, 480),
        &[],
    )
    .expect("the image uploads")
}

/// The one shape the flat create tests need, over any bytes' digest.
fn spec_for(kind: MediaKind, mime: &str, bytes: u64, sha256: &str) -> MediaSpec {
    MediaSpec {
        kind,
        mime: mime.to_string(),
        bytes,
        sha256: sha256.to_string(),
        width: if kind == MediaKind::Video { 1280 } else { 640 },
        height: if kind == MediaKind::Video { 720 } else { 480 },
        duration_ms: (kind == MediaKind::Video).then_some(30_000),
        frames: Vec::new(),
    }
}

#[test]
fn an_upload_becomes_a_blob_the_post_names_and_the_room_serves() {
    let (room_dir, room) = open("media_round_trip");
    let member = phone(&room, 1);
    let bytes = jpeg_bytes(640, 480);
    let asset = upload_bytes(&room, member, MediaKind::Image, "image/jpeg", &bytes, &[]).unwrap();
    assert_eq!(asset.bytes, bytes.len() as u64);
    assert_eq!(asset.kind, MediaKind::Image);

    // The post carries the descriptor whole.
    let said = room
        .post(
            member,
            "p1",
            "look at this",
            false,
            std::slice::from_ref(&asset.id),
        )
        .unwrap();
    assert_eq!(said.media.len(), 1);
    assert_eq!(said.media[0].id, asset.id);

    // The bytes are the bytes: what the shelf serves is what arrived.
    let (mime, served) = room.media_bytes(&asset.id).expect("the blob is served");
    assert_eq!(mime, "image/jpeg");
    assert_eq!(served, bytes);

    // The floor travels with the entry's seq: the host reads, the path
    // is the room's own.
    assert_eq!(said.seq, 1);
    let host = room
        .media_resolve(MemberId::Host, &asset.id)
        .expect("the host reads the whole room");
    assert!(host.path.starts_with(room_dir));
    assert_eq!(host.mime, "image/jpeg");
}

#[test]
fn a_chunk_sent_twice_is_answered_not_written_twice() {
    let (_dir, room) = open("media_chunk_twice");
    let member = phone(&room, 1);
    let bytes = big_video();
    let upload = room
        .media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                bytes.len() as u64,
                &sha256_of(&bytes),
            ),
        )
        .unwrap();
    let (head, tail) = bytes.split_at(CHUNK_MAX_BYTES);
    let first = room.media_chunk(member, &upload, 0, head).unwrap();
    let again = room.media_chunk(member, &upload, 0, head).unwrap();
    assert_eq!(first, again, "the re-sent index is the same answer");
    // A short chunk that is not the last one would tear the addressing.
    let (head_only, _) = head.split_at(1000);
    assert!(matches!(
        room.media_chunk(member, &upload, 0, head_only),
        Err(MediaError::BadRequest)
    ));
    let second = room.media_chunk(member, &upload, 1, tail).unwrap();
    assert_eq!(second, bytes.len() as u64);
    let asset = room.media_complete(member, &upload).unwrap();
    assert_eq!(
        room.media_bytes(&asset.id).unwrap().1,
        bytes,
        "the duplicate never disturbed the bytes"
    );
}

#[test]
fn an_upload_that_lied_is_refused_whole() {
    let (_dir, room) = open("media_lied");
    let member = phone(&room, 1);
    let bytes = jpeg_bytes(640, 480);

    // The digest is wrong: refused, nothing published, the upload gone.
    let upload = room
        .media_create(
            member,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                bytes.len() as u64,
                &"a".repeat(64),
            ),
        )
        .unwrap();
    room.media_chunk(member, &upload, 0, &bytes).unwrap();
    assert!(matches!(
        room.media_complete(member, &upload),
        Err(MediaError::BadSha)
    ));
    assert!(room.media_bytes(&upload).is_none());

    // The magic bytes are wrong for the mime: refused the same way.
    let png = png_bytes(640, 480);
    let lying = room
        .media_create(
            member,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                png.len() as u64,
                &sha256_of(&png),
            ),
        )
        .unwrap();
    room.media_chunk(member, &lying, 0, &png).unwrap();
    assert!(matches!(
        room.media_complete(member, &lying),
        Err(MediaError::BadMagic)
    ));

    // Not every chunk arrived: incomplete, and still nothing published.
    let whole = big_video();
    let short = room
        .media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                whole.len() as u64,
                &sha256_of(&whole),
            ),
        )
        .unwrap();
    let (head, _) = whole.split_at(CHUNK_MAX_BYTES);
    room.media_chunk(member, &short, 0, head).unwrap();
    assert!(matches!(
        room.media_complete(member, &short),
        Err(MediaError::Incomplete)
    ));
}

#[test]
fn a_file_below_its_kinds_floor_is_not_that_kind() {
    let (_dir, room) = open("media_floors");
    let member = phone(&room, 1);
    // Three bytes of JPEG magic: no room for a frame, no record, and the
    // reservation died with it.
    let tiny = vec![0xff, 0xd8, 0xff];
    assert!(matches!(
        upload_bytes(&room, member, MediaKind::Image, "image/jpeg", &tiny, &[]),
        Err(MediaError::BadMagic)
    ));
    // Past the floor but with no frame the parser can read: still not a
    // JPEG, whatever its first three bytes say.
    let mut frameless = vec![0xff, 0xd8, 0xff, 0xe0];
    frameless.extend(std::iter::repeat_n(0xa5u8, 300));
    assert!(matches!(
        upload_bytes(
            &room,
            member,
            MediaKind::Image,
            "image/jpeg",
            &frameless,
            &[]
        ),
        Err(MediaError::BadMagic)
    ));
    // An MP4 under its own floor, magic and all.
    let mut short_video = vec![0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p'];
    short_video.extend(std::iter::repeat_n(0x21u8, 100));
    assert!(matches!(
        upload_bytes(
            &room,
            member,
            MediaKind::Video,
            "video/mp4",
            &short_video,
            &[]
        ),
        Err(MediaError::BadMagic)
    ));
    // Every failure gave its charge back: the shelf is as empty as it
    // began, and the whole of it is reservable again.
    for _ in 0..20 {
        room.media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                100 * 1024 * 1024,
                &sha256_of(&tiny),
            ),
        )
        .expect("nothing the liars left is charged");
    }
}

#[test]
fn each_item_costs_the_shelf_at_least_sixty_four_kib() {
    let (_dir, room) = open("media_floor_charge");
    let member = phone(&room, 1);
    let big = 64 * 1024 * 1024;
    for _ in 0..31 {
        room.media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                big,
                &sha256_of(&jpeg_bytes(640, 480)),
            ),
        )
        .expect("the big reservations fit");
    }
    // A tiny item — 1216 real bytes of MP4 — publishes like any other,
    // and costs the shelf the floor's 64 KiB, not its bytes.
    let video = video_bytes();
    upload_bytes(&room, member, MediaKind::Video, "video/mp4", &video, &[])
        .expect("the tiny video publishes");
    // What would exactly fit if the charge were the bare bytes does not:
    // the floor is what the shelf counted.
    let probe = QUOTA_BYTES - 31 * big - video.len() as u64;
    assert!(
        matches!(
            room.media_create(
                member,
                spec_for(MediaKind::Video, "video/mp4", probe, &sha256_of(&video))
            ),
            Err(MediaError::Full)
        ),
        "the tiny item cost {MIN_CHARGE} bytes, not {}",
        video.len()
    );
}

#[test]
fn the_caps_hold_before_a_byte_moves() {
    let (_dir, room) = open("media_caps");
    let member = phone(&room, 1);
    assert!(matches!(
        room.media_create(
            member,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                IMAGE_MAX_BYTES + 1,
                &sha256_of(&jpeg_bytes(640, 480))
            ),
        ),
        Err(MediaError::TooLarge)
    ));
    // The whole shelf is the quota: enough videos at the per-blob cap to
    // name it all, and the next upload of any size is refused — nothing
    // is ever deleted to make room. (The reservations are sparse: no
    // bytes ever move.)
    let video_cap = room
        .media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                QUOTA_BYTES / 21,
                &sha256_of(&jpeg_bytes(640, 480)),
            ),
        )
        .expect("the first reservation is taken");
    for _ in 0..20 {
        room.media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                QUOTA_BYTES / 21,
                &sha256_of(&jpeg_bytes(640, 480)),
            ),
        )
        .expect("the shelf fills");
    }
    assert!(matches!(
        room.media_create(
            member,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                10,
                &sha256_of(&jpeg_bytes(640, 480))
            ),
        ),
        Err(MediaError::Full)
    ));
    // An upload that lied releases its reservation when it dies.
    assert!(room.media_complete(member, &video_cap).is_err());
    assert!(
        room.media_create(
            member,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                10,
                &sha256_of(&jpeg_bytes(640, 480))
            ),
        )
        .is_ok(),
        "the dead upload's place is free again"
    );
}

#[test]
fn a_pixel_bomb_is_refused_whole() {
    let (_dir, room) = open("media_pixel_bomb");
    let member = phone(&room, 1);
    let bombs = [
        (jpeg_bytes(9000, 100), "image/jpeg", "a side past 8192"),
        (
            jpeg_bytes(100, 9000),
            "image/jpeg",
            "the other side past 8192",
        ),
        (png_bytes(7000, 7000), "image/png", "forty-nine megapixels"),
        (webp_bytes(9000, 9000), "image/webp", "a webp bomb"),
    ];
    for (bytes, mime, why) in bombs {
        assert!(
            matches!(
                upload_bytes(&room, member, MediaKind::Image, mime, &bytes, &[]),
                Err(MediaError::TooManyPixels)
            ),
            "{why} is refused: {mime}"
        );
    }
}

#[test]
fn the_recorded_pixels_are_the_files_own_words() {
    let (_dir, room) = open("media_real_pixels");
    let member = phone(&room, 1);
    // Declared 999x999; the file's own SOF0 says 8192x100 — inside the
    // caps, and the descriptor that lands says what the file said.
    let asset = upload_as(
        &room,
        member,
        "image/jpeg",
        &jpeg_bytes(8192, 100),
        MediaKind::Image,
        (999, 999),
        &[],
    )
    .expect("an honest frame publishes");
    assert_eq!((asset.width, asset.height), (8192, 100));
    // A PNG's IHDR is read the same way.
    let png = upload_as(
        &room,
        member,
        "image/png",
        &png_bytes(320, 200),
        MediaKind::Image,
        (1, 1),
        &[],
    )
    .expect("the png publishes");
    assert_eq!((png.width, png.height), (320, 200));
    // And a video's pixels stay its sender's declared ones: the room
    // never opens a box tree.
    let video = upload_as(
        &room,
        member,
        "video/mp4",
        &video_bytes(),
        MediaKind::Video,
        (1280, 720),
        &[],
    )
    .expect("the video publishes");
    assert_eq!((video.width, video.height), (1280, 720));
}

#[test]
fn a_completed_upload_answers_its_descriptor_again() {
    let (_dir, room) = open("media_complete_twice");
    let member = phone(&room, 1);
    let bytes = jpeg_bytes(640, 480);
    let upload = room
        .media_create(
            member,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                bytes.len() as u64,
                &sha256_of(&bytes),
            ),
        )
        .unwrap();
    room.media_chunk(member, &upload, 0, &bytes).unwrap();
    let first = room.media_complete(member, &upload).unwrap();
    // The retry a lost answer owes: the same descriptor, not an error and
    // not a second blob.
    let again = room.media_complete(member, &upload).unwrap();
    assert_eq!(again, first);
    let third = room.media_complete(member, &upload).unwrap();
    assert_eq!(third, first);
    // Nobody else may retry it, either.
    let other = phone(&room, 2);
    assert!(matches!(
        room.media_complete(other, &upload),
        Err(MediaError::NotYours)
    ));
    // And the bytes it named are served exactly as they arrived.
    assert_eq!(room.media_bytes(&first.id).unwrap().1, bytes);
}

#[test]
fn an_index_write_that_fails_fails_the_publish() {
    let (dir, room) = open("media_index_fail");
    let member = phone(&room, 1);
    let bytes = jpeg_bytes(640, 480);
    let upload = room
        .media_create(
            member,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                bytes.len() as u64,
                &sha256_of(&bytes),
            ),
        )
        .unwrap();
    room.media_chunk(member, &upload, 0, &bytes).unwrap();
    // Break the index where the publish must write it: a directory where
    // the atomic rename cannot land.
    let index = dir.join("media").join("index.json");
    let _ = std::fs::remove_file(&index);
    std::fs::create_dir(&index).unwrap();
    assert!(matches!(
        room.media_complete(member, &upload),
        Err(MediaError::Io(_))
    ));
    // The failure rolled the reservation back and left no blob: the
    // shelf's whole quota is still reservable, and nothing is served.
    for _ in 0..20 {
        room.media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                100 * 1024 * 1024,
                &sha256_of(&bytes),
            ),
        )
        .expect("the failed publish charged nothing");
    }
    let page = room.newest_page(1, 10).unwrap();
    assert!(page.messages.is_empty(), "no entry ever landed");
}

#[test]
fn an_upload_belongs_to_its_uploader_alone() {
    let (_dir, room) = open("media_upload_owner");
    let uploader = phone(&room, 1);
    let other = phone(&room, 2);
    let bytes = jpeg_bytes(640, 480);
    let upload = room
        .media_create(
            uploader,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                bytes.len() as u64,
                &sha256_of(&bytes),
            ),
        )
        .unwrap();
    assert!(matches!(
        room.media_chunk(other, &upload, 0, &bytes),
        Err(MediaError::NotYours)
    ));
    room.media_chunk(uploader, &upload, 0, &bytes).unwrap();
    assert!(matches!(
        room.media_complete(other, &upload),
        Err(MediaError::NotYours)
    ));
    let asset = room.media_complete(uploader, &upload).unwrap();
    // And nobody posts another's blob.
    assert!(matches!(
        room.post(
            other,
            "o1",
            "mine now",
            false,
            std::slice::from_ref(&asset.id)
        ),
        Err(PostError::Media(MediaError::NotYours))
    ));
}

#[test]
fn frames_belong_to_videos_and_to_their_sender() {
    let (_dir, room) = open("media_frames");
    let member = phone(&room, 1);
    let stranger = phone(&room, 2);
    let frame = image_asset(&room, member);
    let foreign = image_asset(&room, stranger);
    let video = video_bytes();

    // An image carries no frames.
    let with_frames = MediaSpec {
        frames: vec![frame.id.clone()],
        ..spec_for(
            MediaKind::Image,
            "image/jpeg",
            video.len() as u64,
            &sha256_of(&video),
        )
    };
    assert!(matches!(
        room.media_create(member, with_frames),
        Err(MediaError::BadRequest)
    ));
    // A video's frames are the uploader's own published images.
    let foreign_frames = MediaSpec {
        frames: vec![foreign.id.clone()],
        ..spec_for(
            MediaKind::Video,
            "video/mp4",
            video.len() as u64,
            &sha256_of(&video),
        )
    };
    assert!(matches!(
        room.media_create(member, foreign_frames),
        Err(MediaError::BadRequest)
    ));
    let own_frames = MediaSpec {
        frames: vec![frame.id.clone()],
        ..spec_for(
            MediaKind::Video,
            "video/mp4",
            video.len() as u64,
            &sha256_of(&video),
        )
    };
    let with_frames = room
        .media_create(member, own_frames)
        .expect("the video reserves with its own frame");
    room.media_chunk(member, &with_frames, 0, &video).unwrap();
    let asset = room.media_complete(member, &with_frames).unwrap();
    assert_eq!(asset.frames, vec![frame.id.clone()]);
    // Posting the video opens the frame to the same readers.
    room.post(member, "v1", "", false, std::slice::from_ref(&asset.id))
        .unwrap();
    let (_, frame_bytes) = room.media_bytes(&frame.id).unwrap();
    assert!(!frame_bytes.is_empty());
}

#[test]
fn a_post_without_words_stores_the_fallback_the_room_shows() {
    let (_dir, room) = open("media_fallback");
    let member = phone(&room, 1);
    let image = image_asset(&room, member);
    let said = room
        .post(member, "p1", "", false, std::slice::from_ref(&image.id))
        .unwrap();
    assert_eq!(said.text, "[Image]");
    // Empty text and no media is still nothing at all.
    assert!(matches!(
        room.post(member, "p2", "", false, &[]),
        Err(PostError::EmptyText)
    ));
    // The fallback word does not call the AI.
    assert!(!said.call_ai);
}

#[test]
fn the_join_floor_guards_the_blobs() {
    let (_dir, room) = open("media_floor");
    let first = phone(&room, 1);
    let image = image_asset(&room, first);
    // Unreferenced, the blob is the uploader's alone.
    assert!(matches!(
        room.media_resolve(MemberId::Host, &image.id),
        Err(MediaError::Forbidden)
    ));
    let said = room
        .post(
            first,
            "p1",
            "for everyone",
            false,
            std::slice::from_ref(&image.id),
        )
        .unwrap();
    // A member the room enrolled AFTER the post has the post below their
    // floor, and its blob with it.
    let latecomer = phone(&room, 2);
    room.post(latecomer, "p2", "hello", false, &[]).unwrap();
    assert!(matches!(
        room.media_resolve(latecomer, &image.id),
        Err(MediaError::Forbidden)
    ));
    room.media_resolve(first, &image.id)
        .expect("the uploader reads");
    room.media_resolve(MemberId::Host, &image.id)
        .expect("the host has no floor");
    assert_eq!(said.seq, 1);
}

#[test]
fn a_removed_member_loses_the_rooms_past_media() {
    let (_dir, room) = open("media_removed");
    let member = phone(&room, 1);
    let image = image_asset(&room, member);
    room.post(
        member,
        "p1",
        "here today",
        false,
        std::slice::from_ref(&image.id),
    )
    .unwrap();
    // The owner forgets the device: its member retires, and the road in
    // refuses before any floor is even asked.
    room.forget_device(1).unwrap();
    assert!(matches!(
        room.media_resolve(member, &image.id),
        Err(MediaError::Forbidden)
    ));
    // The same device, paired again, is a NEW member: the past's blobs
    // are as invisible as the past's words.
    let returned = phone(&room, 1);
    assert_ne!(returned, member);
    assert!(matches!(
        room.media_resolve(returned, &image.id),
        Err(MediaError::Forbidden)
    ));
}

#[test]
fn a_reopened_room_serves_the_blobs_it_named() {
    let (dir, room) = open("media_reopen");
    let member = phone(&room, 1);
    let bytes = jpeg_bytes(640, 480);
    let asset = upload_bytes(&room, member, MediaKind::Image, "image/jpeg", &bytes, &[]).unwrap();
    room.post(
        member,
        "p1",
        "still there?",
        false,
        std::slice::from_ref(&asset.id),
    )
    .unwrap();
    drop(room);
    let reopened = super::reopen(&dir).expect("the room reopens");
    // The index carried the blob's record; the transcript rebuilt the
    // reference. The same members read the same bytes.
    let member = reopened.member_of(1).unwrap();
    let (mime, served) = reopened.media_bytes(&asset.id).expect("the blob survived");
    assert_eq!(mime, "image/jpeg");
    assert_eq!(served, bytes);
    reopened
        .media_resolve(member, &asset.id)
        .expect("the reference survived the reopen");
    // And a text-less post's fallback word reads back the same.
    let page = reopened.newest_page(1, 10).unwrap();
    assert_eq!(page.messages[0].media.len(), 1);
}

#[test]
fn the_sweep_takes_what_the_hour_forgot() {
    let (_dir, room) = open("media_sweep");
    let member = phone(&room, 1);
    let bytes = jpeg_bytes(640, 480);
    let upload = room
        .media_create(
            member,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                bytes.len() as u64,
                &sha256_of(&bytes),
            ),
        )
        .unwrap();
    room.media_chunk(member, &upload, 0, &bytes).unwrap();
    room.expire_uploads_for_test();
    // The next create is also the sweep; the aged upload is gone, its
    // reservation with it.
    assert!(room
        .media_create(
            member,
            spec_for(
                MediaKind::Image,
                "image/jpeg",
                bytes.len() as u64,
                &sha256_of(&bytes)
            ),
        )
        .is_ok());
    assert!(matches!(
        room.media_complete(member, &upload),
        Err(MediaError::Unknown)
    ));
}

#[test]
fn a_post_names_its_media_only_once() {
    let (_dir, room) = open("media_once");
    let member = phone(&room, 1);
    let image = image_asset(&room, member);
    let refused = room
        .post(
            member,
            "p1",
            "same blob twice is not two blobs",
            false,
            &[image.id.clone(), image.id.clone()],
        )
        .unwrap_err();
    assert!(matches!(refused, PostError::Media(MediaError::BadRequest)));
}

#[test]
fn the_host_clears_the_shelf_whole_and_tells_the_room() {
    let (_dir, room) = open("media_clear");
    let member = phone(&room, 1);
    let asset = image_asset(&room, member);
    room.post(
        member,
        "p1",
        "gone soon",
        false,
        std::slice::from_ref(&asset.id),
    )
    .unwrap();
    let before = room.next_cursor();
    // A phone cannot clear the shelf; no member but the host may.
    assert!(matches!(
        room.media_clear(member),
        Err(MediaError::Forbidden)
    ));
    room.media_clear(MemberId::Host).unwrap();
    // Every blob is gone and the shelf serves nothing of the past.
    assert!(room.media_bytes(&asset.id).is_none());
    assert!(matches!(
        room.media_resolve(member, &asset.id),
        Err(MediaError::Unknown)
    ));
    // The transcript is untouched: the words and the descriptors stay.
    let page = room.newest_page(1, 10).unwrap();
    assert_eq!(page.messages[0].text, "gone soon");
    assert_eq!(page.messages[0].media.len(), 1);
    // The stream said so, unnumbered.
    let mut events = Vec::new();
    let mut cursor = before;
    room.read_since(
        &mut cursor,
        Instant::now() + Duration::from_secs(1),
        &mut events,
    );
    assert!(events
        .iter()
        .any(|event| matches!(event, Event::Media(MediaEvent::Cleared))));
    // And the quota starts over: the whole shelf is reservable again.
    for _ in 0..20 {
        room.media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                100 * 1024 * 1024,
                &sha256_of(&jpeg_bytes(640, 480)),
            ),
        )
        .expect("the shelf is empty again");
    }
}

#[test]
fn a_media_post_is_one_line_like_any_other() {
    // A text-less post lands one transcript line: what a recovery keeps,
    // it keeps whole, descriptors and all.
    let (_dir, room) = open("media_recovery");
    let member = phone(&room, 1);
    let image = image_asset(&room, member);
    let said: Entry = room
        .post(member, "p1", "", false, std::slice::from_ref(&image.id))
        .unwrap();
    assert_eq!(said.text, "[Image]");
    assert_eq!(said.media[0].sha256.len(), 64);
}

/// The records the index file holds, as the next open reads them — parsed
/// as plain JSON, because the file itself is what the repair is about.
fn index_records(dir: &Path) -> Vec<serde_json::Value> {
    let bytes = std::fs::read(index_path(dir)).unwrap_or_default();
    let stored: serde_json::Value = serde_json::from_slice(&bytes).expect("the index is JSON");
    stored["media"].as_array().cloned().unwrap_or_default()
}

fn index_path(dir: &Path) -> PathBuf {
    dir.join("media").join("index.json")
}

/// Replaces the index with the records given: the forged-index tests write
/// what a bug or a hand could have written.
fn craft_index(dir: &Path, records: &[serde_json::Value]) {
    let stored = serde_json::json!({ "v": crate::shelf::INDEX_VERSION, "media": records });
    let bytes = serde_json::to_vec(&stored).expect("the index serializes");
    std::fs::write(index_path(dir), bytes).expect("the index is written");
}

#[test]
fn a_cleared_shelf_reopens_empty_and_with_its_quota_whole() {
    let (dir, room) = open("media_clear_reopen");
    let _scratch = Scratch::of(&dir);
    let member = phone(&room, 1);
    let asset = image_asset(&room, member);
    room.post(
        member,
        "p1",
        "gone soon",
        false,
        std::slice::from_ref(&asset.id),
    )
    .unwrap();
    room.media_clear(MemberId::Host).unwrap();
    // The file the next open reads holds nothing: the clear writes the
    // index before it deletes a blob, so a clear that dies between the
    // two cannot leave records naming bytes that are about to be gone.
    assert_eq!(
        index_records(&dir).len(),
        0,
        "the cleared index must hold no record"
    );
    drop(room);
    let room = super::reopen(&dir).expect("the cleared room reopens");
    let member = room.member_of(1).unwrap();
    // Nothing of the past is published: the answer is "not in this room",
    // not an io failure over a file that is not there.
    assert!(room.media_bytes(&asset.id).is_none());
    assert!(matches!(
        room.media_resolve(member, &asset.id),
        Err(MediaError::Unknown)
    ));
    // A new publish takes the shelf: the bytes arrive and are served.
    let fresh = image_asset(&room, member);
    assert!(room.media_bytes(&fresh.id).is_some());
    // The quota starts from zero, to the byte: twenty videos at the
    // per-blob cap, then the remainder the fresh image's floor charge
    // left, arrive exactly at the quota. A single ghost charge
    // (MIN_CHARGE) would have refused the remainder, and one byte past it
    // is refused now.
    let cap = VIDEO_MAX_BYTES;
    for _ in 0..20 {
        room.media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                cap,
                &sha256_of(&jpeg_bytes(640, 480)),
            ),
        )
        .expect("the cleared quota takes the whole shelf again");
    }
    let remainder = QUOTA_BYTES - 20 * cap - MIN_CHARGE;
    assert!(remainder <= cap, "the probe is a size the room takes");
    room.media_create(
        member,
        spec_for(
            MediaKind::Video,
            "video/mp4",
            remainder,
            &sha256_of(&jpeg_bytes(640, 480)),
        ),
    )
    .expect("the remainder fits only with no ghost charged");
    assert!(matches!(
        room.media_create(
            member,
            spec_for(
                MediaKind::Video,
                "video/mp4",
                1,
                &sha256_of(&jpeg_bytes(640, 480))
            )
        ),
        Err(MediaError::Full)
    ));
}

#[test]
fn an_index_record_whose_blob_is_gone_is_dropped_and_the_index_rewritten() {
    let (dir, room) = open("media_ghost_record");
    let _scratch = Scratch::of(&dir);
    let member = phone(&room, 1);
    let asset = image_asset(&room, member);
    room.post(
        member,
        "p1",
        "whose bytes are gone",
        false,
        std::slice::from_ref(&asset.id),
    )
    .unwrap();
    // The damage a clear that wrote its index first and died before its
    // deletes leaves behind: the record survives, the blob does not.
    std::fs::remove_file(dir.join("media").join("blobs").join(&asset.id)).unwrap();
    drop(room);
    let room = super::reopen(&dir).expect("the damaged room opens");
    // The ghost is not published again: the shelf says the media is not in
    // this room rather than failing over a file that is not there, and the
    // index on disk no longer names it for the next open to charge.
    assert!(room.media_bytes(&asset.id).is_none());
    let member = room.member_of(1).unwrap();
    assert!(matches!(
        room.media_resolve(member, &asset.id),
        Err(MediaError::Unknown)
    ));
    assert_eq!(
        index_records(&dir).len(),
        0,
        "the ghost must be out of the index"
    );
    // The shelf is whole for what is really there.
    let fresh = image_asset(&room, member);
    assert!(room.media_bytes(&fresh.id).is_some());
    assert_eq!(index_records(&dir).len(), 1, "only the live record is left");
}

#[test]
fn a_missing_frame_blob_leaves_its_video_without_naming_it() {
    let (dir, room) = open("media_frame_ghost");
    let _scratch = Scratch::of(&dir);
    let member = phone(&room, 1);
    let frame = image_asset(&room, member);
    let video = upload_bytes(
        &room,
        member,
        MediaKind::Video,
        "video/mp4",
        &video_bytes(),
        std::slice::from_ref(&frame.id),
    )
    .unwrap();
    // The frame's blob goes, the video's own bytes stay: the video is
    // still published — its file is there — and stops naming a frame the
    // room can no longer produce, so a later post of it references only
    // what a download can answer for.
    std::fs::remove_file(dir.join("media").join("blobs").join(&frame.id)).unwrap();
    drop(room);
    let room = super::reopen(&dir).expect("the room opens");
    assert!(
        room.media_bytes(&video.id).is_some(),
        "the video's own blob is there"
    );
    assert!(room.media_bytes(&frame.id).is_none());
    let records = index_records(&dir);
    assert_eq!(records.len(), 1, "only the video's record survives");
    assert_eq!(records[0]["id"].as_str(), Some(video.id.as_str()));
    assert!(
        records[0].get("frames").is_none(),
        "the dead frame must not be named: {}",
        records[0]
    );
    let member = room.member_of(1).unwrap();
    let posted = room
        .post(member, "p1", "", false, std::slice::from_ref(&video.id))
        .unwrap();
    assert!(posted.media[0].frames.is_empty());
}

#[test]
fn an_index_id_that_could_leave_the_blobs_dir_is_refused() {
    let (dir, room) = open("media_forged_id");
    let _scratch = Scratch::of(&dir);
    let member = phone(&room, 1);
    image_asset(&room, member);
    drop(room);
    // The file a forged id would name: `blobs/../kept.txt` is this one,
    // and both the clear and the heal join an index id onto `blobs`.
    let victim = dir.join("media").join("kept.txt");
    std::fs::write(&victim, b"not media").unwrap();
    let mut records = index_records(&dir);
    assert_eq!(records.len(), 1, "the honest record is the one to forge");
    records[0]["id"] = serde_json::json!("../kept.txt");
    craft_index(&dir, &records);
    // The index is refused whole, as it already is for a record the store
    // would not take: the id is not one the shelf could have minted, so no
    // path outside `blobs` is ever joined, read or deleted.
    assert!(matches!(
        super::reopen(&dir),
        Err(crate::RoomError::Corrupt(_))
    ));
    assert_eq!(
        std::fs::read(&victim).unwrap(),
        b"not media",
        "nothing outside blobs may be touched"
    );
}

#[test]
fn a_frame_id_that_is_not_a_media_id_is_refused() {
    let (dir, room) = open("media_forged_frame");
    let _scratch = Scratch::of(&dir);
    let member = phone(&room, 1);
    let frame = image_asset(&room, member);
    upload_bytes(
        &room,
        member,
        MediaKind::Video,
        "video/mp4",
        &video_bytes(),
        std::slice::from_ref(&frame.id),
    )
    .unwrap();
    drop(room);
    let mut records = index_records(&dir);
    assert_eq!(records.len(), 2, "the frame and the video that names it");
    let video = records
        .iter_mut()
        .find(|record| record["kind"] == "video")
        .expect("the video's record");
    // A frame id is joined onto `blobs` too, when its still is asked for.
    video["frames"] = serde_json::json!(["../kept.txt"]);
    craft_index(&dir, &records);
    assert!(matches!(
        super::reopen(&dir),
        Err(crate::RoomError::Corrupt(_))
    ));
}

#[cfg(unix)]
#[test]
fn a_blob_the_shelf_cannot_check_is_kept_not_dropped() {
    use std::os::unix::fs::PermissionsExt;
    let (dir, room) = open("media_unchecked_blob");
    let _scratch = Scratch::of(&dir);
    let member = phone(&room, 1);
    let blob = image_asset(&room, member);
    drop(room);
    let blobs = dir.join("media").join("blobs");
    {
        let _restore = Restore(
            blobs.clone(),
            std::fs::metadata(&blobs).unwrap().permissions(),
        );
        std::fs::set_permissions(&blobs, std::fs::Permissions::from_mode(0o000)).unwrap();
        // A check that fails for a reason that is not absence — here a
        // permission wall over the whole blobs directory — is not an
        // answer about the file: the record stays and the index is not
        // rewritten from it.
        let room = super::reopen(&dir).expect("the room opens");
        assert_eq!(
            index_records(&dir).len(),
            1,
            "an uncheckable record must be kept"
        );
        drop(room);
    }
    // The wall down: the same record is served, never dropped.
    let room = super::reopen(&dir).expect("the room opens again");
    let (mime, bytes) = room.media_bytes(&blob.id).expect("the blob was kept");
    assert_eq!(mime, "image/jpeg");
    assert_eq!(bytes, jpeg_bytes(640, 480));
}

/// Puts the blobs directory's permissions back however the test ends: an
/// assertion that panics must not leave the scratch tree unwritable.
#[cfg(unix)]
struct Restore(PathBuf, std::fs::Permissions);

#[cfg(unix)]
impl Drop for Restore {
    fn drop(&mut self) {
        let _ = std::fs::set_permissions(&self.0, self.1.clone());
    }
}

#[cfg(unix)]
#[test]
fn a_symlink_where_the_blob_should_be_is_not_published() {
    let (dir, room) = open("media_blob_symlink");
    let _scratch = Scratch::of(&dir);
    let member = phone(&room, 1);
    let blob = image_asset(&room, member);
    drop(room);
    // The shelf only ever renames a plain file into place; a link is not
    // its blob, and following it would serve whatever it points at.
    let target = dir.parent().unwrap().join("outside.txt");
    std::fs::write(&target, b"not media").unwrap();
    let path = dir.join("media").join("blobs").join(&blob.id);
    std::fs::remove_file(&path).unwrap();
    std::os::unix::fs::symlink(&target, &path).unwrap();
    let room = super::reopen(&dir).expect("the room opens");
    assert!(
        room.media_bytes(&blob.id).is_none(),
        "the link's target must not be served"
    );
    assert_eq!(
        index_records(&dir).len(),
        0,
        "the record goes with the blob"
    );
}
