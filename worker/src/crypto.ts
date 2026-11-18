const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** 32 random bytes, base64url: the shape used for the state, the PKCE verifier and the session id. */
export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function base64Bytes(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

export function decodeBase64Url(value: string): string | null {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bytes = base64Bytes(padded);
  return bytes === null ? null : decoder.decode(bytes);
}

const PLACEHOLDER_KEY = "replace-with-base64-of-32-random-bytes";

/** The signing key must be real: at least 32 bytes once decoded, and never the shipped placeholder. */
export function signingKeyUsable(secret: string | undefined): boolean {
  if (!secret || secret === PLACEHOLDER_KEY) return false;
  const bytes = base64Bytes(secret);
  return bytes !== null && bytes.length >= 32;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** RFC 7636 S256: base64url of the SHA-256 of the verifier, with no padding. */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
}

export async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export async function verify(payload: string, signature: string, secret: string): Promise<boolean> {
  return constantTimeEqual(signature, await sign(payload, secret));
}

/** Both sides are hashed to a fixed width first, so a length mismatch cannot leak through timing. */
export async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}
