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
const IMAGE_JPEG_QUALITY = 0.85;
/** What one picture may weigh on the wire, as a data URI the engine reads. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

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

function toBlob(canvas: HTMLCanvasElement, mime: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, IMAGE_JPEG_QUALITY));
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

/** JPEG segments carry metadata in APP1 (Exif) and APP13 (Photoshop); both
    are dropped. Anything the walk cannot read leaves the bytes untouched —
    a sanitizer must never corrupt the one picture it was handed. */
function sanitizedJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return bytes;
    const marker = bytes[at + 1];
    if (marker === 0xda) {
      parts.push(bytes.subarray(at));
      return joinBytes(parts);
    }
    if (marker === 0xe1 || marker === 0xed) {
      at += 2 + (bytes[at + 2] << 8) + bytes[at + 3];
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    const length = 2 + (bytes[at + 2] << 8) + bytes[at + 3];
    parts.push(bytes.subarray(at, at + length));
    at += length;
  }
  return joinBytes(parts);
}

/** PNG metadata is ancillary text and the embedded Exif chunk. Chunk bytes
    are kept whole, so surviving CRCs stay valid. */
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
    if (!["tEXt", "iTXt", "zTXt", "eXIf"].includes(type)) {
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
    const scale = Math.min(1, IMAGE_LONG_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new AttachmentError("unreadable", `“${file.name}” could not be redrawn.`, {}, "image_canvas");
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    const mime = hasVisibleTransparency(ctx, file.type) ? "image/png" : "image/jpeg";
    const encoded = await toBlob(canvas, mime);
    if (!encoded) {
      throw new AttachmentError(
        "unreadable",
        `“${file.name}” could not be redrawn.`,
        {},
        "image_encode",
      );
    }
    // The redraw is not the whole strip: WebKit's macOS encoder copies the
    // decoded source's metadata into its output (an Exif APP1, a Photoshop
    // APP13), so the segments are removed from the encoder's own bytes.
    const raw = new Uint8Array(await encoded.arrayBuffer());
    const clean = mime === "image/jpeg" ? sanitizedJpeg(raw) : sanitizedPng(raw);
    const blob = new Blob([clean], { type: mime });
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new AttachmentError(
        "unreadable",
        `“${file.name}” stays too large after preparation (${Math.round(blob.size / 1048576)} MB).`,
        {},
        "image_output",
      );
    }
    return { id: aid(), width, height, mime, blob };
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
