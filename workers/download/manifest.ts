/**
 * current.json in the downloads bucket: the installer each platform serves.
 * Read on every request, so a release is an upload plus a rewritten manifest.
 * Each platform is validated on its own; a bad entry only hides that button.
 */

export const MANIFEST_KEY = "current.json";

export type Installer = { key: string; name: string; size: number; sha256: string };
export type Manifest = { windows: Installer | null; mac: Installer | null };

const KEY = /^releases\/[A-Za-z0-9][A-Za-z0-9._-]{0,31}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_SIZE = 64 * 1024 ** 3;

const NONE: Manifest = { windows: null, mac: null };

function installer(value: unknown): Installer | null {
  if (typeof value !== "object" || value === null) return null;
  const { key, name, size, sha256 } = value as Record<string, unknown>;
  if (typeof key !== "string" || !KEY.test(key)) return null;
  if (typeof name !== "string" || !NAME.test(name)) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE) return null;
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) return null;
  return { key, name, size, sha256 };
}

export function parseManifest(text: string | null): Manifest {
  if (text === null) return NONE;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NONE;
  }
  if (typeof raw !== "object" || raw === null) return NONE;
  const { windows, mac } = raw as Record<string, unknown>;
  return { windows: installer(windows), mac: installer(mac) };
}

export async function readManifest(bucket: R2Bucket): Promise<Manifest> {
  const object = await bucket.get(MANIFEST_KEY);
  return parseManifest(object === null ? null : await object.text());
}
