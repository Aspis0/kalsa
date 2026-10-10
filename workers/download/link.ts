/**
 * The secret link: admission of a request to the download page and installers,
 * the key it must carry, and the only paths built from that key. No key, or a
 * key shorter than MIN_KEY_LENGTH, admits nothing.
 */
import { sha256Bytes } from "./hash";

export const MIN_KEY_LENGTH = 32;
const ZONE_HOST = "kalsa.io";
// The page writes the key into its links unescaped, so only URL-safe keys are accepted.
const KEY_CHARS = /^[A-Za-z0-9_-]+$/;
// Hashed in place of a candidate that cannot match, so every request does the same work.
const PLACEHOLDER = "0".repeat(MIN_KEY_LENGTH);

export type Platform = "windows" | "mac";
export type Admission = { kind: "page"; key: string } | { kind: "installer"; key: string; platform: Platform };
type LinkTarget = { kind: "page"; key: string } | { kind: "installer"; key: string; platform: Platform };

export function linkBase(key: string): string {
  return `/download/${key}`;
}

export function installerPath(key: string, platform: Platform): string {
  return `${linkBase(key)}/${platform}`;
}

/** Only `/download/<key>[/]`, `/download/<key>/windows` and `/download/<key>/mac` are link paths. */
export function parseLinkPath(pathname: string): LinkTarget | null {
  const [, root, key, ...rest] = pathname.split("/");
  if (root !== "download" || !key) return null;
  const [only] = rest;
  if (rest.length === 0 || (rest.length === 1 && only === "")) return { kind: "page", key };
  if (rest.length === 1 && (only === "windows" || only === "mac")) {
    return { kind: "installer", key, platform: only };
  }
  return null;
}

function usableSecret(secret: string | undefined): string | null {
  return secret !== undefined && secret.length >= MIN_KEY_LENGTH && KEY_CHARS.test(secret) ? secret : null;
}

/** Both sides are hashed first, so the loop always runs over 32 bytes and never exits early. */
export async function keyMatches(secret: string | undefined, candidate: string): Promise<boolean> {
  const usable = usableSecret(secret);
  const [expected, given] = await Promise.all([sha256Bytes(usable ?? PLACEHOLDER), sha256Bytes(candidate)]);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i];
  return usable !== null && diff === 0;
}

/**
 * Admits a request for its path and key. Every request, admitted or not, runs one
 * key comparison, and any failure while doing so rejects rather than throws.
 */
export async function admit(requestUrl: string, secret: string | undefined): Promise<Admission | null> {
  try {
    const url = new URL(requestUrl);
    const host = url.hostname.replace(/\.$/, "");
    const target = host === ZONE_HOST && url.protocol === "https:" ? parseLinkPath(url.pathname) : null;
    const key = usableSecret(secret);
    const matched = await keyMatches(secret, target?.key ?? PLACEHOLDER);
    if (target === null || key === null || !matched) return null;
    return target.kind === "page"
      ? { kind: "page", key }
      : { kind: "installer", key, platform: target.platform };
  } catch {
    return null;
  }
}
