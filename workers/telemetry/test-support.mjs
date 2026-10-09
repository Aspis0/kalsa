/**
 * Shared fixtures for the Worker route tests: compiles the real index.ts and
 * drives it over an in-memory Durable Object storage.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE = Date.UTC(2026, 9, 1);
export const ENDPOINT = "https://telemetry.kalsa.io";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = mkdtempSync(path.join(tmpdir(), "kalsa-worker-route-"));
process.on("exit", () => rmSync(out, { recursive: true, force: true }));

const compile = spawnSync(
  "npx",
  [
    "tsc",
    "workers/telemetry/index.ts",
    "workers/telemetry/cf-ambient.d.ts",
    "--outDir", out,
    "--module", "commonjs",
    "--target", "es2022",
    "--lib", "es2022,webworker",
    "--skipLibCheck",
    "--ignoreConfig",
    "--types", "node",
  ],
  { cwd: root, encoding: "utf8" },
);
if (compile.status !== 0) {
  console.error("tsc failed:\n", compile.stdout, compile.stderr);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const built = require(path.join(out, "index.js"));
export const worker = built.default;
export const TelemetryBuffer = built.TelemetryBuffer;

/** Hands out the raw stored object (no clone), so in-place edits show up. */
export class FakeStorage {
  data = new Map();
  writes = 0;
  async get(key) {
    return this.data.get(key);
  }
  async put(key, value) {
    this.writes += 1;
    this.data.set(key, structuredClone(value));
  }
  async transaction(fn) {
    return fn({ get: (k) => this.get(k), put: (k, v) => this.put(k, v) });
  }
}

export function entry(i, createdAt = BASE + i * 60_000) {
  return {
    reportId: `rid-${i}`,
    sig: `sig-${i}`,
    report: {
      v: 1,
      app: "kalsa",
      appVersion: "1.1.3",
      platform: "windows",
      deviceBucket: "mid",
      osMajor: "11",
      error: { code: "engine.init", detail: "native_crash" },
      context: { phase: "load", modelCategory: "unknown" },
      dateBucket: "2026-10-01",
      manual: false,
    },
    state: "pending",
    reviewAck: false,
    leaseUntil: 0,
    leaseToken: 0,
    createdAt,
  };
}

export function storageWith(entries) {
  const storage = new FakeStorage();
  storage.data.set("state", { entries, hourBucket: 0, hourCount: 0, nextLeaseToken: 1 });
  return storage;
}

export function seeded(count) {
  return storageWith(Array.from({ length: count }, (_, i) => entry(i)));
}

export function makeEnv(storage, secrets = {}) {
  const buffer = new TelemetryBuffer({ storage });
  return {
    TELEMETRY_BUFFER: {
      idFromName: () => "singleton",
      get: () => ({ fetch: (input, init) => buffer.fetch(new Request(input, init)) }),
    },
    ...secrets,
  };
}

let ipSeq = 0;

/** POST /report from a fresh client IP unless one is given (the per-IP limit is 10/h). */
export async function postReport(env, body, ip = `test-ip-${ipSeq++}`) {
  const res = await worker.fetch(
    new Request(`${ENDPOINT}/report`, {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json() };
}

export async function getReports(env, query = "", authorization = null) {
  const headers = authorization === null ? {} : { authorization };
  const res = await worker.fetch(new Request(`${ENDPOINT}/admin/reports${query}`, { headers }), env);
  return { status: res.status, body: await res.json(), headers: res.headers };
}
