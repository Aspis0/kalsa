/**
 * Shared fixtures for the download Worker tests: an in-memory R2 bucket,
 * manifests built from real hashes, and a request helper.
 */
import { createHash } from "node:crypto";

import worker, { type Env } from "./index";

export const WIN = {
  key: "releases/0.0.1/Kalsa-alpha-0.0.1-windows.exe",
  name: "Kalsa-alpha-0.0.1-windows.exe",
  bytes: "windows installer bytes\n".repeat(64),
};
export const MAC = {
  key: "releases/0.0.1/Kalsa-alpha-0.0.1-mac.dmg",
  name: "Kalsa-alpha-0.0.1-mac.dmg",
  bytes: "mac installer bytes\n".repeat(32),
};

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function entryFor(file: { key: string; name: string; bytes: string }) {
  return {
    key: file.key,
    name: file.name,
    size: Buffer.byteLength(file.bytes),
    sha256: sha256Hex(file.bytes),
  };
}

export function manifestJson(over: { windows?: unknown; mac?: unknown; notes?: unknown } = {}): string {
  return JSON.stringify({
    ...("notes" in over ? { notes: over.notes } : {}),
    windows: "windows" in over ? over.windows : entryFor(WIN),
    mac: "mac" in over ? over.mac : entryFor(MAC),
  });
}

/** Objects in the bucket: `current.json` plus both installers, unless overridden. */
export function standardObjects(over: Record<string, string> = {}): Record<string, string> {
  return {
    "current.json": manifestJson(),
    [WIN.key]: WIN.bytes,
    [MAC.key]: MAC.bytes,
    ...over,
  };
}

type FakeOptions = {
  /** Hex sha256 that R2 reports for a key, as a checksum-carrying object would. */
  checksums?: Record<string, string>;
};

export function fakeBucket(objects: Record<string, string>, options: FakeOptions = {}): R2Bucket {
  const checksumOf = (key: string) => {
    const hex = options.checksums?.[key];
    return hex === undefined ? undefined : { sha256: Uint8Array.from(Buffer.from(hex, "hex")).buffer };
  };
  return {
    async get(key) {
      const body = objects[key];
      if (body === undefined) return null;
      const bytes = Buffer.from(body, "utf8");
      return {
        key,
        size: bytes.byteLength,
        checksums: checksumOf(key),
        body: new Response(bytes).body!,
        text: async () => body,
      };
    },
    async head(key) {
      const body = objects[key];
      if (body === undefined) return null;
      return { key, size: Buffer.byteLength(body, "utf8"), checksums: checksumOf(key) };
    },
  };
}

/** A bucket whose every read fails, as during an R2 outage. */
export function brokenBucket(): R2Bucket {
  const fail = async () => {
    throw new Error("r2 unavailable");
  };
  return { get: fail, head: fail };
}

/** A test key only: real keys are set as a Worker secret and never appear in the repo. */
export const LINK_KEY = "fake_link_key_for_tests_only_0123456789";
export const BASE = `/download/${LINK_KEY}`;
export const UPDATE_KEY = "fake_update_key_for_tests_only_987654321";
export const UPDATE_BASE = `/download/update/${UPDATE_KEY}`;

export function envWith(objects: Record<string, string>, options?: FakeOptions): Env {
  return { DOWNLOADS: fakeBucket(objects, options), LINK_KEY, UPDATE_KEY };
}

/** The version every updater fixture belongs to; its update keys sit under releases/<VERSION>/. */
export const VERSION = "0.0.1";
/** Stand-in for the content of a Tauri `.sig` file: one base64 line. */
export const SIG = "dGVzdC1zaWduYXR1cmU=";
export const MAC_UPDATE = {
  key: "releases/0.0.1/Kalsa-alpha-0.0.1-mac.app.tar.gz",
  name: "Kalsa-alpha-0.0.1-mac.app.tar.gz",
  bytes: "mac updater archive\n".repeat(16),
};

export function updateEntry(file: { key: string; name: string; bytes: string }) {
  return { ...entryFor(file), signature: SIG };
}

/** A manifest with a version and an update per platform; the Windows update is the installer itself. */
export function manifestWithUpdates(over: { version?: unknown; notes?: unknown; windowsUpdate?: unknown; macUpdate?: unknown } = {}): string {
  return JSON.stringify({
    version: "version" in over ? over.version : VERSION,
    ...("notes" in over ? { notes: over.notes } : {}),
    windows: { ...entryFor(WIN), update: "windowsUpdate" in over ? over.windowsUpdate : updateEntry(WIN) },
    mac: { ...entryFor(MAC), update: "macUpdate" in over ? over.macUpdate : updateEntry(MAC_UPDATE) },
  });
}

export function send(
  env: Env,
  path: string,
  init: RequestInit = {},
  host = "kalsa.io",
  scheme: "https" | "http" = "https",
): Promise<Response> {
  return worker.fetch(new Request(`${scheme}://${host}${path}`, init), env);
}
