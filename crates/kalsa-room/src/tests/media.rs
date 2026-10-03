//! The media shelf: the upload road, the caps and the checks that guard
//! it, and the access rule that ties a blob to the transcript entry that
//! posted it.

use crate::media::{MediaError, MediaKind, CHUNK_MAX_BYTES, IMAGE_MAX_BYTES, QUOTA_BYTES};
use crate::{Entry, MediaAsset, MemberId, PostError, Room};

use super::{open, phone};

fn sha256_of(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// An image a phone might have compressed: a JPEG's first words, small
/// enough to hold, long enough to chunk.
fn jpeg_bytes() -> Vec<u8> {
    let mut bytes = vec![0xff, 0xd8, 0xff, 0xe0];
    bytes.extend(std::iter::repeat_n(0xa5u8, 5000));
    bytes
}

/// A video too big for one chunk: two chunks, the second short. (An image
/// never gets here: its cap is one chunk.)
fn big_video() -> Vec<u8> {
    let mut bytes = vec![0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p'];
    bytes.extend(std::iter::repeat_n(0x5au8, CHUNK_MAX_BYTES + 1000 - bytes.len()));
    bytes
}

/// Uploads one blob the honest way — reserve, feed, publish — and answers
/// its descriptor.
fn upload(
    room: &Room,
    member: MemberId,
    kind: MediaKind,
    mime: &str,
    bytes: &[u8],
    frames: &[String],
) -> Result<MediaAsset, MediaError> {
    let upload = room.media_create(
        member,
        crate::MediaSpec {
            kind,
            mime: mime.to_string(),
            bytes: bytes.len() as u64,
            sha256: sha256_of(bytes),
            width: 640,
            height: 480,
            duration_ms: None,
            frames: frames.to_vec(),
        },
    )?;
    for (index, chunk) in bytes.chunks(CHUNK_MAX_BYTES).enumerate() {
        room.media_chunk(member, &upload, index as u32, chunk)?;
    }
    room.media_complete(member, &upload)
}

/// The one shape the flat create tests need, over the common JPEG.
fn spec_for(kind: MediaKind, mime: &str, bytes: u64, sha256: &str) -> crate::MediaSpec {
    crate::MediaSpec {
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

fn image_asset(room: &Room, member: MemberId) -> MediaAsset {
    upload(
        room,
        member,
        MediaKind::Image,
        "image/jpeg",
        &jpeg_bytes(),
        &[],
    )
    .expect("the image uploads")
}

#[test]
fn an_upload_becomes_a_blob_the_post_names_and_the_room_serves() {
    let (room_dir, room) = open("media_round_trip");
    let member = phone(&room, 1);
    let bytes = jpeg_bytes();
    let asset = upload(&room, member, MediaKind::Image, "image/jpeg", &bytes, &[]).unwrap();
    assert_eq!(asset.bytes, bytes.len() as u64);
    assert_eq!(asset.kind, MediaKind::Image);

    // The post carries the descriptor whole.
    let said = room
        .post(member, "p1", "look at this", false, std::slice::from_ref(&asset.id))
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
    let upload = room.media_create(
            member,
            spec_for(MediaKind::Video, "video/mp4", bytes.len() as u64, &sha256_of(&bytes)),
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
    let bytes = jpeg_bytes();

    // The digest is wrong: refused, nothing published, the upload gone.
    let upload = room.media_create(
            member,
            spec_for(MediaKind::Image, "image/jpeg", bytes.len() as u64, &"a".repeat(64)),
        )
        .unwrap();
    room.media_chunk(member, &upload, 0, &bytes).unwrap();
    assert!(matches!(
        room.media_complete(member, &upload),
        Err(MediaError::BadSha)
    ));
    assert!(room.media_bytes(&upload).is_none());

    // The magic bytes are wrong for the mime: refused the same way.
    let mut png = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    png.extend(std::iter::repeat_n(0x00u8, 100));
    let lying = room.media_create(
            member,
            spec_for(MediaKind::Image, "image/jpeg", png.len() as u64, &sha256_of(&png)),
        )
        .unwrap();
    room.media_chunk(member, &lying, 0, &png).unwrap();
    assert!(matches!(
        room.media_complete(member, &lying),
        Err(MediaError::BadMagic)
    ));

    // Not every chunk arrived: incomplete, and still nothing published.
    // (A video, because an image is one chunk by its cap.)
    let whole = big_video();
    let short = room.media_create(
            member,
            spec_for(MediaKind::Video, "video/mp4", whole.len() as u64, &sha256_of(&whole)),
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
fn the_caps_hold_before_a_byte_moves() {
    let (_dir, room) = open("media_caps");
    let member = phone(&room, 1);
    assert!(matches!(
        room.media_create(
            member,
            spec_for(MediaKind::Image, "image/jpeg", IMAGE_MAX_BYTES + 1, &sha256_of(&jpeg_bytes())),
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
            spec_for(MediaKind::Video, "video/mp4", QUOTA_BYTES / 21, &sha256_of(&jpeg_bytes())),
        )
        .expect("the first reservation is taken");
    for _ in 0..20 {
        room.media_create(
            member,
            spec_for(MediaKind::Video, "video/mp4", QUOTA_BYTES / 21, &sha256_of(&jpeg_bytes())),
        )
        .expect("the shelf fills");
    }
    assert!(matches!(
        room.media_create(
            member,
            spec_for(MediaKind::Image, "image/jpeg", 10, &sha256_of(&jpeg_bytes())),
        ),
        Err(MediaError::Full)
    ));
    // An upload that lied releases its reservation when it dies.
    assert!(room.media_complete(member, &video_cap).is_err());
    assert!(
        room.media_create(
            member,
            spec_for(MediaKind::Image, "image/jpeg", 10, &sha256_of(&jpeg_bytes())),
        )
        .is_ok(),
        "the dead upload's place is free again"
    );
}

#[test]
fn an_upload_belongs_to_its_uploader_alone() {
    let (_dir, room) = open("media_upload_owner");
    let uploader = phone(&room, 1);
    let other = phone(&room, 2);
    let bytes = jpeg_bytes();
    let upload = room
        .media_create(
            uploader,
            spec_for(MediaKind::Image, "image/jpeg", bytes.len() as u64, &sha256_of(&bytes)),
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
        room.post(other, "o1", "mine now", false, std::slice::from_ref(&asset.id)),
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
    let video = vec![0x00, 0x00, 0x00, 0x18, b'f', b't', b'y', b'p'];

    // An image carries no frames.
    let with_frames = crate::MediaSpec {
        frames: vec![frame.id.clone()],
        ..spec_for(MediaKind::Image, "image/jpeg", video.len() as u64, &sha256_of(&video))
    };
    assert!(matches!(
        room.media_create(member, with_frames),
        Err(MediaError::BadRequest)
    ));
    // A video's frames are the uploader's own published images.
    let foreign_frames = crate::MediaSpec {
        frames: vec![foreign.id.clone()],
        ..spec_for(MediaKind::Video, "video/mp4", video.len() as u64, &sha256_of(&video))
    };
    assert!(matches!(
        room.media_create(member, foreign_frames),
        Err(MediaError::BadRequest)
    ));
    let own_frames = crate::MediaSpec {
        frames: vec![frame.id.clone()],
        ..spec_for(MediaKind::Video, "video/mp4", video.len() as u64, &sha256_of(&video))
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
        .post(first, "p1", "for everyone", false, std::slice::from_ref(&image.id))
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
    room.post(member, "p1", "here today", false, std::slice::from_ref(&image.id))
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
    let bytes = jpeg_bytes();
    let asset = upload(&room, member, MediaKind::Image, "image/jpeg", &bytes, &[]).unwrap();
    room.post(member, "p1", "still there?", false, std::slice::from_ref(&asset.id))
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
    let bytes = jpeg_bytes();
    let upload = room.media_create(
            member,
            spec_for(MediaKind::Image, "image/jpeg", bytes.len() as u64, &sha256_of(&bytes)),
        )
        .unwrap();
    room.media_chunk(member, &upload, 0, &bytes).unwrap();
    room.expire_uploads_for_test();
    // The next create is also the sweep; the aged upload is gone, its
    // reservation with it.
    assert!(room.media_create(
            member,
            spec_for(MediaKind::Image, "image/jpeg", bytes.len() as u64, &sha256_of(&bytes)),
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
