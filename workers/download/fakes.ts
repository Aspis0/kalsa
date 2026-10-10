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

export function manifestJson(over: { windows?: unknown; mac?: unknown } = {}): string {
  return JSON.stringify({
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

export function envWith(objects: Record<string, string>, options?: FakeOptions): Env {
  return { DOWNLOADS: fakeBucket(objects, options) };
}

export function send(env: Env, path: string, init: RequestInit = {}, host = "kalsa.io"): Promise<Response> {
  return worker.fetch(new Request(`https://${host}${path}`, init), env);
}
