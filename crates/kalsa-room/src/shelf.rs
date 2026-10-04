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
    check_declared, dimensions, opens_like, pixel_error, size_floor, MediaAsset, MediaError,
    MediaKind, MediaSpec, CHUNK_MAX_BYTES, MAX_PUBLISHED, MIN_CHARGE, QUOTA_BYTES,
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
/// `index * CHUNK_MAX_BYTES`, verified whole at complete. `charged` is
/// what the reservation actually took from the quota — the declared size
/// or [`MIN_CHARGE`], whichever is larger — and it is what every failure
/// gives back.
pub(crate) struct Upload {
    pub(crate) owner: MemberId,
    pub(crate) spec: MediaSpec,
    pub(crate) charged: u64,
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
    /// Upload id → the blob it became: the retry a lost complete answer
    /// owes, answered with the same descriptor. Memory only — a restart
    /// forgets it, and a retry past one is honestly `Unknown`.
    completed: HashMap<String, (MediaAsset, MemberId)>,
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
        // The quota a reopened room charges itself is the quota it ran
        // with: each item at its charge, never its bare size.
        let used = published
            .values()
            .map(|(asset, _)| asset.bytes.max(MIN_CHARGE))
            .sum();
        Ok(Self {
            published,
            refs: HashMap::new(),
            uploads: HashMap::new(),
            completed: HashMap::new(),
            used,
            blobs,
            uploads_dir,
            index,
        })
    }

    /// Reserves an upload. The item's charge — its declared bytes or
    /// [`MIN_CHARGE`], whichever is larger — counts against the quota from
    /// this moment, so parallel creates cannot promise the shelf twice.
    /// The fallible disk work happens before any state moves: a failed
    /// write leaves the quota exactly as it was.
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
        if self.published.len() >= MAX_PUBLISHED {
            return Err(MediaError::Full);
        }
        let charge = spec.bytes.max(MIN_CHARGE);
        if self.used + charge > QUOTA_BYTES {
            return Err(MediaError::Full);
        }
        let id = mint_id()?;
        let path = self.uploads_dir.join(&id);
        std::fs::write(&path, []).map_err(MediaError::Io)?;
        if let Err(error) = std::fs::File::options()
            .write(true)
            .open(&path)
            .and_then(|file| file.set_len(spec.bytes))
        {
            let _ = std::fs::remove_file(&path);
            return Err(MediaError::Io(error));
        }
        self.used += charge;
        self.uploads.insert(
            id.clone(),
            Upload {
                owner: member,
                spec,
                charged: charge,
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
    /// right, the file plausibly the kind and size it declared, an image's
    /// own pixels read and bounded — and publishes it. A repeat of a
    /// completed upload by its owner is answered with the same descriptor:
    /// the retry a lost answer owes. Every failure gives the reservation
    /// back and takes the temp file with it.
    pub(crate) fn complete(
        &mut self,
        member: MemberId,
        upload: &str,
    ) -> Result<MediaAsset, MediaError> {
        if let Some((asset, owner)) = self.completed.get(upload) {
            return if *owner == member {
                Ok(asset.clone())
            } else {
                Err(MediaError::NotYours)
            };
        }
        let Some(mut state) = self.uploads.remove(upload) else {
            return Err(MediaError::Unknown);
        };
        if state.owner != member {
            self.uploads.insert(upload.to_string(), state);
            return Err(MediaError::NotYours);
        }
        if state.received_bytes != state.spec.bytes {
            return Err(abandoned(self, &state, MediaError::Incomplete));
        }
        let bytes = match std::fs::read(&state.path) {
            Ok(bytes) => bytes,
            Err(error) => return Err(abandoned(self, &state, MediaError::Io(error))),
        };
        if sha256_hex(&bytes) != state.spec.sha256 {
            return Err(abandoned(self, &state, MediaError::BadSha));
        }
        if !opens_like(&bytes, &state.spec.mime, state.spec.kind)
            || (bytes.len() as u64) < size_floor(&state.spec.mime)
        {
            return Err(abandoned(self, &state, MediaError::BadMagic));
        }
        if state.spec.kind == MediaKind::Image {
            // The pixels are the file's own words or they are nothing: a
            // header the room cannot read is a file that lied about its
            // kind, and a frame past the caps is a bomb.
            let Some((width, height)) = dimensions(&bytes, &state.spec.mime) else {
                return Err(abandoned(self, &state, MediaError::BadMagic));
            };
            if let Some(error) = pixel_error(width, height) {
                return Err(abandoned(self, &state, error));
            }
            state.spec.width = width;
            state.spec.height = height;
        }
        if self.published.len() >= MAX_PUBLISHED {
            return Err(abandoned(self, &state, MediaError::Full));
        }
        let id = mint_id()?;
        let blob = self.blobs.join(&id);
        if let Err(error) = std::fs::rename(&state.path, &blob) {
            return Err(abandoned(self, &state, MediaError::Io(error)));
        }
        let asset = state.spec.clone().asset(id);
        // The index is part of the publish: a write that fails leaves the
        // blob unpublished, the file removed and the charge returned —
        // never a success the next restart cannot explain.
        if let Err(error) = self.write_index(Some((&asset, state.owner))) {
            let _ = std::fs::remove_file(&blob);
            return Err(abandoned(self, &state, MediaError::Io(error)));
        }
        self.published
            .insert(asset.id.clone(), (asset.clone(), state.owner));
        self.completed
            .insert(upload.to_string(), (asset.clone(), state.owner));
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

    /// Sweeps uploads the hour forgot: their charge goes back, their temp
    /// files go with them. Called beside each create.
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
                self.used -= upload.charged;
            }
        }
    }

    /// Empties the shelf: the index first — a write that fails changes
    /// nothing — then the files, then the memory. Transcript entries keep
    /// their descriptors; the blobs behind them are gone, and the quota
    /// starts from zero.
    pub(crate) fn clear(&mut self) -> Result<(), MediaError> {
        self.write_index(None).map_err(MediaError::Io)?;
        let published = std::mem::take(&mut self.published);
        let uploads = std::mem::take(&mut self.uploads);
        self.completed.clear();
        self.refs.clear();
        self.used = 0;
        for (id, _) in published {
            let _ = std::fs::remove_file(self.blobs.join(id));
        }
        for (_, upload) in uploads {
            let _ = std::fs::remove_file(upload.path);
        }
        Ok(())
    }

    /// Publishes the index, atomically, beside whatever the shelf already
    /// holds plus the one record about to land: the same file-leads-memory
    /// rule the roster runs on. The caller is told when it fails.
    fn write_index(&self, arriving: Option<(&MediaAsset, MemberId)>) -> Result<(), std::io::Error> {
        let mut media: Vec<StoredRecord> = self
            .published
            .values()
            .map(|(asset, owner)| StoredRecord {
                asset: asset.clone(),
                owner: owner.wire(),
            })
            .collect();
        if let Some((asset, owner)) = arriving {
            media.push(StoredRecord {
                asset: asset.clone(),
                owner: owner.wire(),
            });
        }
        let stored = StoredMedia {
            v: INDEX_VERSION,
            media,
        };
        let bytes = serde_json::to_vec(&stored)
            .map_err(|_| std::io::Error::other("the media index cannot serialize"))?;
        kalsa_pairing::store::write_owner_only(&self.index, &bytes)
    }
}

/// What a dead upload owes: its temp file gone, its charge back.
fn abandoned(shelf: &mut MediaState, upload: &Upload, error: MediaError) -> MediaError {
    let _ = std::fs::remove_file(&upload.path);
    shelf.used -= upload.charged;
    error
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
