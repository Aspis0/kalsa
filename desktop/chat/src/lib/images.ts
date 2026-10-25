/**
 * The image road in: a File from the picker, a paste or a drop becomes the
 * picture this app keeps — decoded, redrawn on a canvas, and stripped of the
 * encoder's metadata segments, so what is stored and sent is app-made bytes
 * and the file's own metadata (EXIF, GPS) is in none of it. Refusals speak
 * the AttachmentError vocabulary; a name or a byte of the file never reaches
 * a log line (the log tokens below are format facts only).
 */

import { AttachmentError, MAX_FILE_BYTES } from "./attachments";
import type { MessageImage } from "./types";

/** The long side a picture keeps: past it the model reads detail nobody
    gains and the data URI only grows. */
const IMAGE_LONG_SIDE = 1536;
/** The first pass; a photo of ordinary noise lands well under the cap at
    this quality, and only a stubborn one pays for another rung. */
const IMAGE_JPEG_QUALITY = 0.85;
/** What one picture may weigh after preparation. The door holds 16 MiB of
    body (kalsa-door request.rs) and the wire budget is 12 MiB, so a picture
    still heavier after the ladder below has no road: it is refused, not
    squeezed past the door to a 413. */
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

/** The ladder a too-heavy picture walks before refusal: quality first (the
    detail it loses is detail the model never read), then the long side.
    PNG has no quality dial — the side alone steps down. */
const JPEG_RUNGS: { side: number; quality: number }[] = [
  { side: IMAGE_LONG_SIDE, quality: IMAGE_JPEG_QUALITY },
  { side: IMAGE_LONG_SIDE, quality: 0.7 },
  { side: 1152, quality: 0.6 },
  { side: 896, quality: 0.5 },
];
const PNG_RUNGS: number[] = [IMAGE_LONG_SIDE, 1152, 896, 640];

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "heic", "heif"]);

/** By the picker's own kinds: mime first, extension where none is given. */
export function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXTENSIONS.has(file.name.split(".").pop()?.toLowerCase() ?? "");
}

export interface PreparedImage extends MessageImage {
  blob: Blob;
}

function aid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `img-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/** One redraw at one rung of the ladder: decode-side scaling, encode, and
    the strip — the sanitizer runs on the encoder's own output because
    WebKit's macOS encoder copies the decoded source's metadata into it (an
    Exif APP1, even a Photoshop APP13, on a canvas that never held either). */
async function encodeRung(
  bitmap: ImageBitmap,
  side: number,
  mime: string,
  quality: number,
  name: string,
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new AttachmentError("unreadable", `“${name}” could not be redrawn.`, {}, "image_canvas");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  const encoded = await toBlob(canvas, mime, quality);
  if (!encoded) {
    throw new AttachmentError("unreadable", `“${name}” could not be redrawn.`, {}, "image_encode");
  }
  const raw = new Uint8Array(await encoded.arrayBuffer());
  const clean = mime === "image/jpeg" ? sanitizedJpeg(raw) : sanitizedPng(raw);
  return { blob: new Blob([clean], { type: mime }), width, height };
}

/** One alpha below full means a background would be invented — the picture
    stays PNG. JPEG sources have no alpha to check. */
function hasVisibleTransparency(ctx: CanvasRenderingContext2D, sourceMime: string): boolean {
  if (sourceMime === "image/jpeg") return false;
  const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height).data;
  for (let at = 3; at < data.length; at += 4) {
    if (data[at] < 255) return true;
  }
  return false;
}

function joinBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The JPEG segments a decoded picture still needs: the frame and its
    tables. Everything else — COM, APP1–APP15 (Exif, XMP, ICC) — is someone's
    writing about the picture, and an allow-list is the only honest side to
    stand on: a segment invented next year is dropped by default, not
    whitelisted by ignorance. */
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

/** A sanitized JPEG: SOI, then only the segments above in their original
    order, then everything from SOS to the end (the entropy data and EOI).
    Anything the walk cannot read leaves the bytes untouched — a sanitizer
    must never corrupt the one picture it was handed. */
function sanitizedJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return bytes;
    const marker = bytes[at + 1];
    // From SOS on, the bytes are entropy data and EOI: no structure left to
    // walk, so everything from here rides as it is.
    if (marker === 0xda || marker === 0xd9) {
      parts.push(bytes.subarray(at));
      return joinBytes(parts);
    }
    const length = 2 + (bytes[at + 2] << 8) + bytes[at + 3];
    if (JPEG_KEEP.has(marker)) {
      parts.push(bytes.subarray(at, at + length));
    }
    at += length;
  }
  return joinBytes(parts);
}

/** The PNG chunks a decoded picture still needs: the header, the colour
    mappings, the data. Everything else — iCCP, tIME, every text chunk,
    eXIf, and any ancillary chunk invented later — is dropped; an allow-list
    drops tomorrow's metadata by default. Kept chunks ride whole in their
    original order, so surviving CRCs stay valid. */
const PNG_KEEP = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "sRGB", "gAMA", "cHRM"]);

function sanitizedPng(bytes: Uint8Array): Uint8Array {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (signature.some((byte, at) => bytes[at] !== byte)) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + at, 8);
    const length = view.getUint32(0);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const total = 12 + length;
    if (at + total > bytes.length) return bytes;
    if (PNG_KEEP.has(type)) {
      parts.push(bytes.subarray(at, at + total));
    }
    at += total;
    if (type === "IEND") return joinBytes(parts);
  }
  return bytes;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (file.size > MAX_FILE_BYTES) {
    throw new AttachmentError(
      "too-big",
      `“${file.name}” is too large to read in the browser (${Math.round(file.size / 1048576)} MB).`,
      {},
      "image_source",
    );
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new AttachmentError(
      "unreadable",
      `“${file.name}” could not be read as an image. The webview this window runs in may not decode this kind.`,
      {},
      `image_${error instanceof Error ? error.name.toLowerCase().replace(/[^a-z0-9]+/g, "_") : "decode"}`,
    );
  }
  try {
    // Transparency is decided once, from the pixels at full size: which
    // encoder the picture needs is a fact of the picture, not of the rung.
    const probe = document.createElement("canvas");
    probe.width = bitmap.width;
    probe.height = bitmap.height;
    const probeCtx = probe.getContext("2d");
    if (!probeCtx) {
      throw new AttachmentError("unreadable", `“${file.name}” could not be redrawn.`, {}, "image_canvas");
    }
    probeCtx.drawImage(bitmap, 0, 0);
    const png = hasVisibleTransparency(probeCtx, file.type);
    const rungs: { side: number; quality: number }[] = png
      ? PNG_RUNGS.map((side) => ({ side, quality: 1 }))
      : JPEG_RUNGS;
    const mime = png ? "image/png" : "image/jpeg";
    let last: { blob: Blob; width: number; height: number } | null = null;
    for (const rung of rungs) {
      last = await encodeRung(bitmap, rung.side, mime, rung.quality, file.name);
      if (last.blob.size <= MAX_IMAGE_BYTES) {
        return { id: aid(), width: last.width, height: last.height, mime, blob: last.blob };
      }
    }
    throw new AttachmentError(
      "unreadable",
      `“${file.name}” stays too large after preparation (${Math.round((last?.blob.size ?? 0) / 1048576)} MB).`,
      {},
      "image_output",
    );
  } finally {
    bitmap.close();
  }
}

/** The wire's form of a stored picture: a data URI, never an http or blob
    URL — the engine reads nothing but the bytes in the request. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("data-url"));
    reader.readAsDataURL(blob);
  });
}
