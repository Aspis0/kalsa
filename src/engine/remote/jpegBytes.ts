/**
 * A JPEG's own structure, read on the bytes themselves: the frame's size, and
 * the sanitized picture this app is allowed to send. The camera and the OS
 * write EXIF, GPS and everything else anyone cares to record into APP1–APP15;
 * an allow-list drops each segment a decoder does not need, so a segment
 * invented next year is dropped by default rather than kept through
 * ignorance. Bytes that are not a JPEG at all come back untouched; a walk
 * that breaks mid-file stops there and drops what follows, so nothing the
 * allow-list refused can ride past the break.
 */

/** The JPEG segments a decoded picture still needs: the frame and its tables. */
const JPEG_KEEP = new Set<number>([
  0xd8, // SOI
  0xe0, // APP0 (JFIF)
  0xdb, // DQT
  0xc4, // DHT
  0xdd, // DRI
  0xc0, 0xc1, 0xc2, 0xc3, // SOF0–SOF3
  0xc5, 0xc6, 0xc7, // SOF5–SOF7
  0xc9, 0xca, 0xcb, // SOF9–SOF11
  0xcd, 0xce, 0xcf, // SOF13–SOF15
]);

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** SOF0–SOF15 minus the three markers that share the range but are not frames
 *  (DHT, JPG, DAC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * SOI, then only the segments above in their original order, then everything
 * from SOS to the end (the entropy data and EOI). Not a JPEG: the input
 * itself, unchanged. A JPEG whose walk breaks keeps nothing past the break.
 */
export function sanitizeJpegBytes(bytes: Uint8Array): Uint8Array {
  if (!isJpeg(bytes)) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return bytes;
    const marker = bytes[at + 1];
    // From SOS on there is no structure left to walk: the entropy data and
    // EOI ride as they are.
    if (marker === 0xda || marker === 0xd9) {
      parts.push(bytes.subarray(at));
      return joinBytes(parts);
    }
    const length = 2 + (bytes[at + 2] << 8) + bytes[at + 3];
    if (JPEG_KEEP.has(marker)) parts.push(bytes.subarray(at, at + length));
    at += length;
  }
  return joinBytes(parts);
}

/** The frame's own size, from its first frame header. Null for bytes that are
 *  not a JPEG this walk can read — the caller re-encodes those instead. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (!isJpeg(bytes)) return null;
  let at = 2;
  while (at + 9 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    if (isStartOfFrame(marker)) {
      const height = (bytes[at + 5] << 8) | bytes[at + 6];
      const width = (bytes[at + 7] << 8) | bytes[at + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    at += 2 + (bytes[at + 2] << 8) + bytes[at + 3];
  }
  return null;
}
