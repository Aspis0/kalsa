/**
 * The one place a stored picture becomes bytes for the remote door: read the
 * file, cap the LONG side (a portrait's height is a side too) by re-encoding
 * at the desktop's JPEG quality when the frame is over it, strip the
 * encoder's metadata with the pure sanitizer, and dress the result as the
 * `data:` URI the wire carries. Nothing is cached: the file stays the app's
 * own artifact, and history keeps URIs, never base64.
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
export const REMOTE_IMAGE_LONG_SIDE = 1536;
/** The desktop's first-pass quality. */
export const REMOTE_IMAGE_QUALITY = 0.85;

const JPEG_MIME = "image/jpeg";
const DATA_URI_PREFIX = `data:${JPEG_MIME};base64,`;

/** Read every staged picture once, in the order the turn carries it. A URI
    that repeats keeps one entry; a file that is gone or unreadable is simply
    absent, and the caller turns it into the wire's placeholder sentence. */
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

async function readStoredBase64(uri: string): Promise<string> {
  const FileSystem = await import("expo-file-system/legacy");
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
}

async function readRemotePicture(uri: string): Promise<RemotePicture | null> {
  try {
    const stored = base64ToUint8Array(await readStoredBase64(uri));
    const size = jpegSize(stored);
    // A JPEG the walk can read and that is already inside the cap goes out
    // as stored — no second generation of compression for nothing.
    const body =
      size !== null && Math.max(size.width, size.height) <= REMOTE_IMAGE_LONG_SIDE
        ? stored
        : await encodeJpegAtCap(uri, size);
    if (body === null) return null;
    const clean = sanitizeJpegBytes(body);
    return {
      uri,
      bytes: clean.length,
      dataUri: `${DATA_URI_PREFIX}${uint8ArrayToBase64(clean)}`,
    };
  } catch {
    return null;
  }
}

/** The platform encoder at the remote cap: resize the long side and save at
    JPEG 0.85 with the bytes inline — one native round trip, and the cache
    file the encoder writes is the platform's own to reap. A source that is
    not a JPEG this walk can read (or carries no frame header) is re-encoded
    whatever its size, which is also what turns HEIC into something the door
    accepts. */
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
    return typeof saved.base64 === "string" ? base64ToUint8Array(saved.base64) : null;
  } catch {
    return null;
  }
}
