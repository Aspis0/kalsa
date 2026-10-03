//! The shelf itself: where the room's blobs and uploads live on disk —
//! the temp file an upload writes into, the immutable blob it becomes,
//! and the index file that carries each blob's record and owner across a
//! restart. The rules the wire answers by are `media`'s; this file only
//! keeps the bytes and their bookkeeping honest.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::media::{
    check_declared, opens_like, MediaAsset, MediaError, MediaKind, MediaSpec, CHUNK_MAX_BYTES,
    QUOTA_BYTES,
};

/// How long an in-flight upload may sit before its place is swept.
pub(crate) const UPLOAD_TTL: Duration = Duration::from_secs(60 * 60);

/// What a download is allowed to stream: the blob's place, length and
/// mime, resolved under the lock, read after it.
pub struct MediaFile {
    pub path: PathBuf,
    pub len: u64,
    pub mime: String,
}

/// The index file's stored record: the wire asset plus the owner the wire
/// must never see.
#[derive(Serialize, Deserialize)]
struct StoredMedia {
    v: u8,
    media: Vec<StoredRecord>,
}

#[derive(Serialize, Deserialize)]
struct StoredRecord {
    #[serde(flatten)]
    asset: MediaAsset,
    owner: u32,
}
use crate::{MemberId, RoomError};

/// One upload in flight: reserved at create, fed chunk by chunk at
/// `index * CHUNK_MAX_BYTES`, verified whole at complete.
pub(crate) struct Upload {
    pub(crate) owner: MemberId,
    pub(crate) spec: MediaSpec,
    pub(crate) received: HashSet<u32>,
    pub(crate) received_bytes: u64,
    pub(crate) created: Instant,
    pub(crate) path: PathBuf,
}

pub(crate) const INDEX_NAME: &str = "index.json";
pub(crate) const INDEX_VERSION: u8 = 1;
pub(crate) const BLOBS_DIR: &str = "blobs";
pub(crate) const UPLOADS_DIR: &str = "uploads";

pub(crate) struct MediaState {
    published: HashMap<String, (MediaAsset, MemberId)>,
    /// Media id → the seqs of the transcript entries that reference it,
    /// directly or through a video's frames. Rebuilt from the transcript
    /// at open; posting adds to it.
    refs: HashMap<String, Vec<u64>>,
    uploads: HashMap<String, Upload>,
    used: u64,
    blobs: PathBuf,
    uploads_dir: PathBuf,
    index: PathBuf,
}

impl MediaState {
    /// Opens the shelf inside the room's own directory: the directories,
    /// the index, and the sweep of uploads the last process left behind.
    pub(crate) fn open(room_dir: &Path) -> Result<Self, RoomError> {
        let media_dir = room_dir.join("media");
        let uploads_dir = media_dir.join(UPLOADS_DIR);
        std::fs::create_dir_all(&uploads_dir).map_err(RoomError::Io)?;
        let blobs = media_dir.join(BLOBS_DIR);
        std::fs::create_dir_all(&blobs).map_err(RoomError::Io)?;
        let index = media_dir.join(INDEX_NAME);
        let published = load_index(&index)?;
        // An upload in flight died with the process; its bytes are the
        // sender's to send again, and the directory is the sweep's start.
        for left in std::fs::read_dir(&uploads_dir).map_err(RoomError::Io)? {
            let left = left.map_err(RoomError::Io)?.path();
            if left.is_dir() {
                let _ = std::fs::remove_dir_all(left);
            } else {
                let _ = std::fs::remove_file(left);
            }
        }
        let used = published.values().map(|(asset, _)| asset.bytes).sum();
        Ok(Self {
            published,
            refs: HashMap::new(),
            uploads: HashMap::new(),
            used,
            blobs,
            uploads_dir,
            index,
        })
    }

    /// Reserves an upload. The declared bytes count against the quota from
    /// this moment, so parallel creates cannot promise the shelf twice.
    pub(crate) fn create(
        &mut self,
        member: MemberId,
        spec: MediaSpec,
    ) -> Result<String, MediaError> {
        check_declared(&spec)?;
        // The frames a video names must already be published images of
        // the uploader's own.
        if spec.kind == MediaKind::Video {
            for frame in &spec.frames {
                match self.published.get(frame) {
                    Some((frame_asset, owner))
                        if *owner == member && frame_asset.kind == MediaKind::Image => {}
                    _ => return Err(MediaError::BadRequest),
                }
            }
        }
        if self.used + spec.bytes > QUOTA_BYTES {
            return Err(MediaError::Full);
        }
        let id = mint_id()?;
        self.used += spec.bytes;
        let path = self.uploads_dir.join(&id);
        std::fs::write(&path, []).map_err(MediaError::Io)?;
        std::fs::File::options()
            .write(true)
            .open(&path)
            .and_then(|file| file.set_len(spec.bytes))
            .map_err(MediaError::Io)?;
        self.uploads.insert(
            id.clone(),
            Upload {
                owner: member,
                spec,
                received: HashSet::new(),
                received_bytes: 0,
                created: Instant::now(),
                path,
            },
        );
        Ok(id)
    }

    /// One chunk, at its fixed place: chunk `i` carries the bytes
    /// `[i*CHUNK_MAX, …)` of the declared whole, so every chunk but the
    /// last is exactly CHUNK_MAX — the rule that makes the file's bytes
    /// the declared whole's bytes, whatever order the chunks arrive in. A
    /// re-sent index is the idempotent no-op a retry needs: the bytes
    /// already there are the answer.
    pub(crate) fn chunk(
        &mut self,
        member: MemberId,
        upload: &str,
        index: u32,
        bytes: &[u8],
    ) -> Result<u64, MediaError> {
        let upload_state = self.uploads.get_mut(upload).ok_or(MediaError::Unknown)?;
        if upload_state.owner != member {
            return Err(MediaError::NotYours);
        }
        if bytes.is_empty() || bytes.len() > CHUNK_MAX_BYTES {
            return Err(MediaError::BadRequest);
        }
        let offset = index as u64 * CHUNK_MAX_BYTES as u64;
        let declared = upload_state.spec.bytes;
        if offset >= declared || offset + bytes.len() as u64 > declared {
            return Err(MediaError::BadRequest);
        }
        let last = offset + bytes.len() as u64 == declared;
        if !last && bytes.len() != CHUNK_MAX_BYTES {
            // A short chunk that is not the last one would tear the
            // addressing: the next index would not abut it.
            return Err(MediaError::BadRequest);
        }
        if upload_state.received.contains(&index) {
            return Ok(upload_state.received_bytes);
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .open(&upload_state.path)
            .map_err(MediaError::Io)?;
        use std::io::{Seek, Write};
        file.seek(std::io::SeekFrom::Start(offset))
            .and_then(|_| file.write_all(bytes))
            .map_err(MediaError::Io)?;
        upload_state.received.insert(index);
        upload_state.received_bytes += bytes.len() as u64;
        Ok(upload_state.received_bytes)
    }

    /// Verifies the upload whole — every declared byte present, the digest
    /// right, the magic bytes like the mime — and publishes it.
    pub(crate) fn complete(
        &mut self,
        member: MemberId,
        upload: &str,
    ) -> Result<MediaAsset, MediaError> {
        let state = self.uploads.remove(upload).ok_or(MediaError::Unknown)?;
        if state.owner != member {
            self.uploads.insert(upload.to_string(), state);
            return Err(MediaError::NotYours);
        }
        let mut finish = |result: Result<MediaAsset, MediaError>| {
            if result.is_err() {
                let _ = std::fs::remove_file(&state.path);
                self.used -= state.spec.bytes;
            }
            result
        };
        if state.received_bytes != state.spec.bytes {
            return finish(Err(MediaError::Incomplete));
        }
        let bytes = std::fs::read(&state.path).map_err(MediaError::Io)?;
        if sha256_hex(&bytes) != state.spec.sha256 {
            return finish(Err(MediaError::BadSha));
        }
        if !opens_like(&bytes, &state.spec.mime, state.spec.kind) {
            return finish(Err(MediaError::BadMagic));
        }
        let id = mint_id()?;
        let blob = self.blobs.join(&id);
        std::fs::rename(&state.path, &blob).map_err(MediaError::Io)?;
        let asset = state.spec.asset(id.clone());
        self.published.insert(id, (asset.clone(), state.owner));
        self.publish_index();
        Ok(asset)
    }

    /// The blob a member may stream, or the reason it may not. Access: an
    /// active member, and a transcript entry that references the blob at or
    /// after the member's join floor; an unreferenced blob only to its
    /// uploader. The host has no floor.
    pub(crate) fn resolve(
        &self,
        member: MemberId,
        floor: Option<u64>,
        id: &str,
    ) -> Result<MediaFile, MediaError> {
        let Some((asset, owner)) = self.published.get(id) else {
            return Err(MediaError::Unknown);
        };
        let referenced = self.refs.get(id).is_some_and(|seqs| {
            seqs.iter()
                .any(|seq| floor.is_none_or(|floor| *seq >= floor))
        });
        if !referenced && *owner != member {
            return Err(MediaError::Forbidden);
        }
        let path = self.blobs.join(id);
        let len = std::fs::metadata(&path)
            .map(|meta| meta.len())
            .map_err(MediaError::Io)?;
        Ok(MediaFile {
            path,
            len,
            mime: asset.mime.clone(),
        })
    }

    /// The record behind a published blob id, for the poster's ownership
    /// check in `append`.
    pub(crate) fn asset_of(&self, id: &str) -> Option<&(MediaAsset, MemberId)> {
        self.published.get(id)
    }

    /// The bytes behind a blob id, for the room's own readers — the AI's
    /// turn and the host, who see the whole room by their office. A route
    /// that serves a member resolves its access with [`Self::resolve`]
    /// first.
    pub fn bytes_of(&self, id: &str) -> Option<(String, Vec<u8>)> {
        let (_, (asset, _)) = self.published.get_key_value(id)?;
        let bytes = std::fs::read(self.blobs.join(id)).ok()?;
        Some((asset.mime.clone(), bytes))
    }

    /// Records the transcript entries that reference blobs, so the access
    /// rule can find them. Called once per landed entry.
    pub(crate) fn reference(&mut self, assets: &[MediaAsset], seq: u64) {
        let mut ids = Vec::new();
        for asset in assets {
            ids.push(&asset.id);
            ids.extend(asset.frames.iter());
        }
        for id in ids {
            let refs = self.refs.entry(id.clone()).or_default();
            if refs.last() != Some(&seq) {
                refs.push(seq);
            }
        }
    }

    /// Ages every upload past the sweep's hour, for the tests.
    #[cfg(test)]
    pub(crate) fn expire_uploads(&mut self) {
        for upload in self.uploads.values_mut() {
            upload.created = Instant::now()
                .checked_sub(UPLOAD_TTL)
                .unwrap_or(Instant::now());
        }
    }

    /// Sweeps uploads the hour forgot: their reserved bytes go back, their
    /// temp files go with them. Called beside each create.
    pub(crate) fn sweep(&mut self) {
        let stale: Vec<String> = self
            .uploads
            .iter()
            .filter(|(_, upload)| upload.created.elapsed() >= UPLOAD_TTL)
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            if let Some(upload) = self.uploads.remove(&id) {
                let _ = std::fs::remove_file(upload.path);
                self.used -= upload.spec.bytes;
            }
        }
    }

    /// The whole shelf, atomically, before the caller is told it published:
    /// the same file-leads-memory rule the roster runs on.
    fn publish_index(&self) {
        let stored = StoredMedia {
            v: INDEX_VERSION,
            media: self
                .published
                .values()
                .map(|(asset, owner)| StoredRecord {
                    asset: asset.clone(),
                    owner: owner.wire(),
                })
                .collect(),
        };
        if let Ok(bytes) = serde_json::to_vec(&stored) {
            let _ = kalsa_pairing::store::write_owner_only(&self.index, &bytes);
        }
    }
}

/// The shelf a fresh room reads: every record the index holds, or — where
/// the index is damaged beyond reading — an empty shelf with the damaged
/// file kept beside itself, the transcript's own courtesy for bytes nobody
/// should lose silently.
pub(crate) fn load_index(
    path: &Path,
) -> Result<HashMap<String, (MediaAsset, MemberId)>, RoomError> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(RoomError::Io(error)),
    };
    let Ok(stored) = serde_json::from_slice::<StoredMedia>(&bytes) else {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_secs())
            .unwrap_or(0);
        let _ = std::fs::rename(path, path.with_extension(format!("damaged-{stamp}.json")));
        return Ok(HashMap::new());
    };
    if stored.v != INDEX_VERSION {
        return Err(RoomError::Corrupt("the media index is from a newer format"));
    }
    let mut published = HashMap::new();
    for record in stored.media {
        if record.asset.check().is_err() {
            return Err(RoomError::Corrupt(
                "the media index holds a record the store would not take",
            ));
        }
        let member = MemberId::from_wire(record.owner);
        if published
            .insert(record.asset.id.clone(), (record.asset, member))
            .is_some()
        {
            return Err(RoomError::Corrupt("two blobs hold one media id"));
        }
    }
    Ok(published)
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest: [u8; 32] = Sha256::digest(bytes).into();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// An id nobody chose and nobody can guess into existence: 128 bits, the
/// same shape the room's identity mints.
pub(crate) fn mint_id() -> Result<String, MediaError> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| {
        MediaError::Io(std::io::Error::other(
            "the operating system's entropy pool refused",
        ))
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
