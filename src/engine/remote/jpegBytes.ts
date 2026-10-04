/**
 * A JPEG's own structure, read on the bytes themselves: the frame's size, and
 * the sanitized picture this app is allowed to send. The camera and the OS
 * write EXIF, GPS and everything else anyone cares to record into APP1–APP15
 * and COM; those are dropped wherever they sit — including between the two
 * scans of a progressive picture — so no metadata segment survives a walk.
 *
 * The walk is strict. `sanitizeJpegBytes` answers null when it cannot follow
 * the bytes to the end of image, and a caller must NEVER fall back to the
 * input: it re-encodes through the platform encoder and sanitizes that, or it
 * refuses the picture. A sanitizer that passes unknown bytes through is a
 * privacy hole with a comment about enthusiasm.
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

/** Markers that carry no length: TEM, SOI, EOI and the restart markers. */
function isStandalone(marker: number): boolean {
  return marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7);
}

/** SOF0–SOF15 minus the three markers that share the range but are not frames
 *  (DHT, JPG, DAC). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** A segment's own length field, two of its bytes included; null when it is
    not even there or says something impossible. */
function segmentLength(bytes: Uint8Array, at: number): number | null {
  if (at + 4 > bytes.length) return null;
  const length = 2 + (bytes[at + 2] << 8) + bytes[at + 3];
  return length >= 2 ? length : null;
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
 * SOI, the frames and tables a decoder needs in their original order, every
 * scan header with its entropy-coded data, then EOI. Null for anything this
 * walk cannot follow to the end — including bytes that are not a JPEG.
 */
export function sanitizeJpegBytes(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === undefined) return null;
    // A fill byte (0xFF 0xFF): padding before a marker, never one itself.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd9) {
      // End of image: carry the pair and stop. Bytes after it belong to no
      // picture this app sends.
      parts.push(bytes.subarray(at, at + 2));
      return joinBytes(parts);
    }
    if (marker === 0xda) {
      const length = segmentLength(bytes, at);
      if (length === null || at + length > bytes.length) return null;
      parts.push(bytes.subarray(at, at + length));
      at += length;
      // Entropy-coded data, up to the next real marker: 0xFF 0x00 is a
      // stuffed byte, 0xFF D0–D7 a restart marker, 0xFF 0xFF a fill byte.
      const start = at;
      while (at < bytes.length) {
        if (bytes[at] !== 0xff) {
          at += 1;
          continue;
        }
        const next = bytes[at + 1];
        if (next === undefined) return null;
        if (next === 0xff) {
          at += 1;
          continue;
        }
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          at += 2;
          continue;
        }
        break;
      }
      parts.push(bytes.subarray(start, at));
      continue;
    }
    // A marker with no length outside a scan is not a picture this walk can
    // trust, and neither is a segment running past the bytes.
    if (isStandalone(marker)) return null;
    const length = segmentLength(bytes, at);
    if (length === null || at + length > bytes.length) return null;
    if (JPEG_KEEP.has(marker)) parts.push(bytes.subarray(at, at + length));
    at += length;
  }
  // Ran out of bytes before EOI: the picture is not whole.
  return null;
}

/** The frame's own size, from its first frame header. Null for bytes that are
 *  not a JPEG this walk can read — the caller re-encodes those instead. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xda || isStandalone(marker)) return null;
    if (isStartOfFrame(marker)) {
      const height = (bytes[at + 5] << 8) | bytes[at + 6];
      const width = (bytes[at + 7] << 8) | bytes[at + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    const length = segmentLength(bytes, at);
    if (length === null) return null;
    at += length;
  }
  return null;
}
