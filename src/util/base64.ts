/**
 * Uint8Array → base64 for RN (no Node Buffer). Hermes-safe: array+join once,
 * never grow a flat string with `+=` across chunks (see pdfText / htmlToText).
 */

/** Chunk size for fromCharCode.apply — must stay well below the ~65 535
 *  argument-count limit (engines throw or silently truncate above that). */
const FROM_CHAR_CODE_CHUNK = 0x8000;

/**
 * Encode bytes as standard base64 (via btoa on a binary string).
 * Throws if btoa is unavailable.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa !== "function") {
    throw new Error("base64 encoder unavailable");
  }
  if (bytes.length === 0) {
    return globalThis.btoa("");
  }
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += FROM_CHAR_CODE_CHUNK) {
    const slice = bytes.subarray(i, i + FROM_CHAR_CODE_CHUNK);
    // Pass the subarray directly — no Array.from boxing of every byte.
    // Chunk stays at 0x8000 so apply's argument count stays far under ~65 535.
    parts.push(
      String.fromCharCode.apply(null, slice as unknown as number[]),
    );
  }
  return globalThis.btoa(parts.join(""));
}
