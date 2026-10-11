/**
 * current.json in the downloads bucket: what each platform serves. Read on every
 * request, so a release is an upload plus a rewritten manifest. Each platform is
 * validated on its own; a bad entry only hides that platform's part.
 */
import { isSemver } from "./semver";

export const MANIFEST_KEY = "current.json";

export type Platform = "windows" | "mac";
export type Artifact = { key: string; name: string; size: number; sha256: string };
export type Installer = Artifact;
export type Update = Artifact & { signature: string };
export type Manifest = {
  version: string | null;
  notes: string | null;
  windows: Installer | null;
  mac: Installer | null;
  updates: Record<Platform, Update | null>;
};

const KEY = /^releases\/[A-Za-z0-9][A-Za-z0-9._-]{0,31}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SIGNATURE = /^[A-Za-z0-9+/=]{1,4096}$/;
const MAX_SIZE = 64 * 1024 ** 3;
// Mirrors NOTES_MAX and NOTES_CONTROL in scripts/release.mjs; a test keeps them equal.
const NOTES_MAX = 600;
const NOTES_CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/;

const NONE: Manifest = { version: null, notes: null, windows: null, mac: null, updates: { windows: null, mac: null } };

/** The release a key belongs to: `releases/<version>/<name>`. */
export function versionOfKey(key: string): string | null {
  return key.split("/")[1] ?? null;
}

function artifact(value: unknown): Artifact | null {
  if (typeof value !== "object" || value === null) return null;
  const { key, name, size, sha256 } = value as Record<string, unknown>;
  if (typeof key !== "string" || !KEY.test(key)) return null;
  if (typeof name !== "string" || !NAME.test(name)) return null;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0 || size > MAX_SIZE) return null;
  if (typeof sha256 !== "string" || !SHA256.test(sha256)) return null;
  return { key, name, size, sha256 };
}

function update(value: unknown): Update | null {
  if (typeof value !== "object" || value === null) return null;
  const base = artifact(value);
  const signature = (value as Record<string, unknown>).signature;
  if (base === null || typeof signature !== "string" || !SIGNATURE.test(signature)) return null;
  return { ...base, signature };
}

/** An update is offered only for the version the manifest names, never for another release. */
function updateOf(entry: unknown, version: string | null): Update | null {
  if (version === null || typeof entry !== "object" || entry === null) return null;
  const found = update((entry as Record<string, unknown>).update);
  return found !== null && versionOfKey(found.key) === version ? found : null;
}

/** Plain-text notes, or null. Bad notes drop only the notes: the platforms stay valid. */
function notesOf(value: unknown): string | null {
  if (typeof value !== "string" || value === "" || [...value].length > NOTES_MAX) return null;
  return NOTES_CONTROL.test(value) ? null : value;
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
  const { version: rawVersion, notes: rawNotes, windows, mac } = raw as Record<string, unknown>;
  const version = isSemver(rawVersion) ? rawVersion : null;
  return {
    version,
    notes: notesOf(rawNotes),
    windows: artifact(windows),
    mac: artifact(mac),
    updates: { windows: updateOf(windows, version), mac: updateOf(mac, version) },
  };
}

export async function readManifest(bucket: R2Bucket): Promise<Manifest> {
  const object = await bucket.get(MANIFEST_KEY);
  return parseManifest(object === null ? null : await object.text());
}
