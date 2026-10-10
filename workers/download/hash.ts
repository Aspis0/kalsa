/** Lowercase hex of a digest, and the SHA-256 of a text, for ETags and checksum comparison. */

export function hexOf(bytes: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return hexOf(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
