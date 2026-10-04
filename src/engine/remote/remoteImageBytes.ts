/**
 * The one place a stored picture becomes bytes for the remote door: the
 * stored sizes decide what can ride (the planner reads no byte of a picture
 * it will not send), then each rider is read, capped on the LONG side — a
 * portrait's height is a side too — stripped by the pure sanitizer and
 * dressed as the `data:` URI the wire carries. Nothing is cached: the file
 * stays the app's own artifact, and history keeps URIs, never base64.
 *
 * A picture this app cannot walk itself, or whose walk fails, is re-encoded
 * through the platform encoder and sanitized again; if that fails too the
 * picture is refused rather than sent as it came.
 *
 * Both expo modules load lazily, so the remote engine — and every node-side
 * test that imports it — stays importable without an expo runtime; only a
 * send that actually carries a picture reaches them.
 */
import { base64ToUint8Array, uint8ArrayToBase64 } from "../../util/base64";
import { jpegSize, sanitizeJpegBytes } from "./jpegBytes";
import type { RemotePicture } from "./openaiMessages";

/** The long side a picture keeps: past it the model reads detail nobody
    gains and the data URI only grows (the desktop's own cap). */
const REMOTE_IMAGE_LONG_SIDE = 1536;
/** The desktop's first-pass quality. */
const REMOTE_IMAGE_QUALITY = 0.85;

const JPEG_MIME = "image/jpeg";
const DATA_URI_PREFIX = `data:${JPEG_MIME};base64,`;

/** What each URI weighs on disk, without reading a byte of it — the planner
    chooses on these, so only pictures that can ride are ever read. A URI
    whose file is gone (or is not a file) is simply absent. */
export async function storedPictureSizes(
  uris: readonly string[],
): Promise<Map<string, number>> {
  const sizes = new Map<string, number>();
  if (uris.length === 0) return sizes;
  try {
    const FileSystem = await import("expo-file-system/legacy");
    for (const uri of uris) {
      if (sizes.has(uri)) continue;
      try {
        const info = await FileSystem.getInfoAsync(uri);
        if (info.exists && info.isDirectory !== true && Number.isFinite(info.size)) {
          sizes.set(uri, info.size);
        }
      } catch {
        // One unreadable file must not cost the others their sizes.
      }
    }
  } catch {
    return sizes;
  }
  return sizes;
}

/** Read every picture once, in the order the turn carries it, and prepare
    exactly the URIs handed over. A URI that repeats keeps one entry; a file
    that cannot be prepared is absent, and the caller decides what that means
    for the turn. */
export async function readRemotePictures(
  uris: readonly string[],
): Promise<Map<string, RemotePicture>> {
  const out = new Map<string, RemotePicture>();
  for (const uri of uris) {
    if (out.has(uri)) continue;
    const picture = await readRemotePicture(uri);
    if (picture !== null) out.set(uri, picture);
  }
  return out;
}

function asPicture(uri: string, clean: Uint8Array): RemotePicture {
  return {
    uri,
    bytes: clean.length,
    dataUri: `${DATA_URI_PREFIX}${uint8ArrayToBase64(clean)}`,
  };
}

async function readRemotePicture(uri: string): Promise<RemotePicture | null> {
  let stored: Uint8Array | null = null;
  try {
    stored = base64ToUint8Array(await readStoredBase64(uri));
  } catch {
    stored = null;
  }
  const size = stored === null ? null : jpegSize(stored);
  // A picture this walk can read whole and that is already inside the cap
  // goes out as stored — no second generation of compression for nothing.
  const clean =
    stored !== null && size !== null && Math.max(size.width, size.height) <= REMOTE_IMAGE_LONG_SIDE
      ? sanitizeJpegBytes(stored)
      : null;
  if (clean !== null) return asPicture(uri, clean);
  // HEIC, PNG, a truncated file, a frame over the cap: the platform encoder
  // writes a JPEG, and its own output is sanitized before it may ride.
  const encoded = await encodeJpegAtCap(uri, size);
  const reClean = encoded === null ? null : sanitizeJpegBytes(encoded);
  return reClean === null ? null : asPicture(uri, reClean);
}

async function readStoredBase64(uri: string): Promise<string> {
  const FileSystem = await import("expo-file-system/legacy");
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

async function discardEncoded(uri: string | undefined): Promise<void> {
  if (uri === undefined || uri.length === 0) return;
  try {
    const FileSystem = await import("expo-file-system/legacy");
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // A cache file this app could not remove is the platform's to reap; the
    // picture itself is already in memory and is not lost with it.
  }
}

/** The platform encoder at the remote cap: resize the long side and save at
    JPEG 0.85 with the bytes inline — one native round trip. The file it
    writes is deleted on the way out, success or failure, because nothing
    here ever reads it back and one UUID per picture per send would grow the
    cache for nothing. */
async function encodeJpegAtCap(
  uri: string,
  size: { width: number; height: number } | null,
): Promise<Uint8Array | null> {
  try {
    const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
    let sides = size;
    if (sides === null) {
      const probe = await ImageManipulator.manipulate(uri).renderAsync();
      sides = { width: probe.width, height: probe.height };
    }
    const context = ImageManipulator.manipulate(uri);
    if (Math.max(sides.width, sides.height) > REMOTE_IMAGE_LONG_SIDE) {
      context.resize(
        sides.width >= sides.height
          ? { width: REMOTE_IMAGE_LONG_SIDE }
          : { height: REMOTE_IMAGE_LONG_SIDE },
      );
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      compress: REMOTE_IMAGE_QUALITY,
      format: SaveFormat.JPEG,
      base64: true,
    });
    try {
      return typeof saved.base64 === "string" ? base64ToUint8Array(saved.base64) : null;
    } finally {
      await discardEncoded(saved.uri);
    }
  } catch {
    return null;
  }
}
