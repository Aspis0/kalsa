import { parsePairingQr, type PairingQrErrorCode } from "./pairingQr";
import type { PairingSquare } from "./pairingTransport";

const MAX_INVITE_CHARS = 16_384;
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export type PairingInviteError = PairingQrErrorCode | "invalidLink" | "invalidFragment" | "tooLarge" | "missingNode";
export type PairingInviteResult =
  | { ok: true; square: PairingSquare }
  | { ok: false; error: PairingInviteError };

function decodeBase64Url(value: string): string | null {
  if (!value || value.length > MAX_INVITE_CHARS) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return null;

  const bytes: number[] = [];
  let bits = 0;
  let accumulator = 0;
  for (const character of value) {
    const digit = BASE64URL.indexOf(character);
    if (digit < 0) return null;
    accumulator = (accumulator << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }
  // Unused trailing bits must be zero; otherwise multiple fragments encode
  // the same bytes, which makes link de-duplication ambiguous.
  if (accumulator !== 0) return null;
  try {
    return decodeURIComponent(bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""));
  } catch {
    return null;
  }
}

function validateJson(json: string): PairingInviteResult {
  if (json.length > MAX_INVITE_CHARS) return { ok: false, error: "tooLarge" };
  const parsed = parsePairingQr(json);
  if (!parsed.ok) return parsed;
  if (!parsed.square.node) return { ok: false, error: "missingNode" };
  return parsed;
}

export function decodePairingInviteFragment(fragment: string): PairingInviteResult {
  if (fragment.length > MAX_INVITE_CHARS) return { ok: false, error: "tooLarge" };
  const json = decodeBase64Url(fragment);
  return json === null ? { ok: false, error: "invalidFragment" } : validateJson(json);
}

export function parsePairingInvite(input: string): PairingInviteResult {
  const value = input.trim();
  if (!value) return { ok: false, error: "invalidLink" };
  if (value.length > MAX_INVITE_CHARS) return { ok: false, error: "tooLarge" };
  if (value.startsWith("{")) return validateJson(value);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "invalidLink" };
  }
  const webLink = parsed.protocol === "https:" && parsed.hostname === "kalsa.io" && parsed.pathname === "/pair";
  const appLink = parsed.protocol === "kalsa:" && parsed.hostname === "pair" && parsed.pathname === "";
  if ((!webLink && !appLink) || parsed.username || parsed.password || parsed.search || !parsed.hash) {
    return { ok: false, error: "invalidLink" };
  }
  return decodePairingInviteFragment(parsed.hash.slice(1));
}

export function createPairingLinkDeduper(): (url: string) => boolean {
  const seen = new Set<string>();
  return (url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  };
}
