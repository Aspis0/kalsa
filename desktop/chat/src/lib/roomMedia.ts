/**
 * The room's media road: a prepared picture or video gets onto the shelf
 * through the host's own commands — reserve, feed, publish — the same caps
 * and codes §5b gives a phone, with no door hop. One responsibility: bytes
 * in, a published descriptor out. Every refusal arrives as a code; the
 * sentences are the language table's.
 */

import { invoke } from "./tauri";

/** What one published blob looks like, the shape the protocol carries in a
    message's `media` array and the host commands answer. */
export interface RoomMediaDescriptor {
  id: string;
  kind: "image" | "video";
  mime: string;
  bytes: number;
  sha256: string;
  width: number;
  height: number;
  duration_ms: number | null;
  frames: string[];
}

/** The shelf's own caps (§5b): one picture 4 MiB, one video 100 MiB, the
    room's shelf 2 GiB of published plus in-flight. */
export const ROOM_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const ROOM_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

/** One chunk on the wire — every chunk but the last is exactly this big, at
    `index * ROOM_MEDIA_CHUNK` in the file. */
export const ROOM_MEDIA_CHUNK = 4 * 1024 * 1024;

/** A failed chunk is retried this often before the upload gives up; the
    index is idempotent at the shelf, so a retry never double-writes. */
const CHUNK_RETRIES = 3;

export class RoomMediaError extends Error {
  /** The shelf's own code, stable across languages. */
  code: string;

  constructor(code: string) {
    super(code);
    this.name = "RoomMediaError";
    this.code = code;
  }
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : "internal";
}

/** The file's digest, as the reserve declares it: lowercase hex. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", view);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface RoomUploadSpec {
  kind: "image" | "video";
  mime: string;
  width: number;
  height: number;
  durationMs: number | null;
  /** A video's still frames, published BEFORE this reserve — the shelf
      checks the ids against the shelf. */
  frames: string[];
}

/** Reserve, feed, publish. `onProgress` walks 0→1 over the CHUNKS (the
    reserve and the publish are instant beside them). The bytes are the
    whole final file; the digest must already describe them. */
export async function uploadRoomMedia(
  spec: RoomUploadSpec,
  bytes: Uint8Array,
  onProgress: (fraction: number) => void,
  canceled?: { readonly canceled: boolean },
): Promise<RoomMediaDescriptor> {
  const sha256 = await sha256Hex(bytes);
  const upload = await invoke<string>("brain_room_media_create", {
    kind: spec.kind,
    mime: spec.mime,
    bytes: bytes.byteLength,
    sha256,
    width: spec.width,
    height: spec.height,
    durationMs: spec.durationMs,
    frames: spec.frames.length > 0 ? spec.frames : null,
  }).catch((error) => {
    throw new RoomMediaError(codeOf(error));
  });
  const chunks = Math.ceil(bytes.byteLength / ROOM_MEDIA_CHUNK);
  for (let index = 0; index < chunks; index += 1) {
    if (canceled?.canceled) {
      throw new RoomMediaError("canceled");
    }
    const chunk = bytes.subarray(index * ROOM_MEDIA_CHUNK, (index + 1) * ROOM_MEDIA_CHUNK);
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt += 1) {
      try {
        await invoke<number>("brain_room_media_chunk", {
          upload,
          index,
          bytes: Array.from(chunk),
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError !== null) {
      throw new RoomMediaError(codeOf(lastError));
    }
    onProgress((index + 1) / chunks);
  }
  return invoke<RoomMediaDescriptor>("brain_room_media_complete", { upload }).catch((error) => {
    throw new RoomMediaError(codeOf(error));
  });
}

/** One published blob's bytes, for the page's own rendering. The MIME is
    the caller's to know — the entry's media descriptor says it — because
    the command answers RAW BYTES over binary IPC (`tauri::ipc::Response`,
    an ArrayBuffer here); a view or a number array is the same answer in
    another envelope, and none of them carries a mime. */
export async function readRoomMedia(id: string): Promise<Uint8Array> {
  const answer = await invoke<unknown>("brain_room_media_read", { id });
  if (answer instanceof ArrayBuffer) return new Uint8Array(answer);
  if (ArrayBuffer.isView(answer)) {
    const view = answer as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (Array.isArray(answer)) return Uint8Array.from(answer as number[]);
  throw new RoomMediaError("media_not_found");
}

/** The host's own broom: every blob on the shelf, gone. Downloads answer
    `media_not_found` after it, which the rows meet with the fallback
    words; the page forgets its object URLs beside it
    (`roomMediaCache.forgetAll`). */
export async function clearRoomMedia(): Promise<void> {
  await invoke("brain_room_media_clear").catch((error) => {
    throw new RoomMediaError(codeOf(error));
  });
}
