/**
 * kalsa-report Cloudflare Worker.
 *
 * One route, one job: accept the desktop app's log upload (POST /report) and
 * store it privately in R2. Nothing reads the bucket back here — no GET, no
 * listing; the owner reads reports from the Cloudflare dashboard.
 */

/// <reference path="./cf-ambient.d.ts" />

export interface Env {
  REPORTS: R2Bucket;
  REPORT_RATE_LIMITER: RateLimit;
}

const ZONE_HOST = "kalsa.io";
const MAX_BODY_BYTES = 4 * 1024 * 1024; // two 2 MiB log files
export const DAILY_CAP = 300; // × 4 MiB keeps worst-case storage near 1.2 GiB/day
const MAX_STORE_ATTEMPTS = 3;
const APP_HEADER_PATTERN = /^[0-9A-Za-z._-]{1,32}\/[a-z0-9_]{1,16}\/[a-z0-9_]{1,16}$/;
const LOG_CONTENT_TYPE = /^text\/plain(\s*;\s*charset\s*=\s*"?utf-8"?)?$/i;
// Phone-readable: no 0/O/1/I/L, so a tester can spell an id out loud.
const ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const ID_LENGTH = 8;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function error(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

function tooLarge(): Response {
  return error(413, "payload_too_large", `Body exceeds ${MAX_BODY_BYTES} bytes.`);
}

/** Rejection sampling: 256 % 31 tail bytes are dropped so every char is equiprobable. */
export function newReportId(): string {
  let id = "";
  let batch = new Uint8Array(0);
  let i = 0;
  while (id.length < ID_LENGTH) {
    if (i === batch.length) {
      batch = crypto.getRandomValues(new Uint8Array(64));
      i = 0;
    }
    const byte = batch[i];
    i += 1;
    if (byte >= 248) continue;
    id += ID_ALPHABET[byte % ID_ALPHABET.length];
  }
  return id;
}

type BodyRead = { ok: true; bytes: Uint8Array } | { ok: false; response: Response };

/** Cap enforced mid-stream: a missing or lying Content-Length must not exceed the cap. */
async function readBody(request: Request): Promise<BodyRead> {
  const stream = request.body;
  if (!stream) {
    return { ok: false, response: error(400, "empty_body", "The request body is empty.") };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return { ok: false, response: tooLarge() };
    }
    chunks.push(value);
  }
  if (total === 0) {
    return { ok: false, response: error(400, "empty_body", "The request body is empty.") };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

type StoreResult = { ok: true; id: string } | { ok: false; response: Response };

/** Conditional write: a failed precondition (key taken) returns null, so retry a fresh id. */
async function storeReport(
  env: Env,
  day: string,
  bytes: Uint8Array,
  app: string,
  received: string,
): Promise<StoreResult> {
  for (let attempt = 0; attempt < MAX_STORE_ATTEMPTS; attempt++) {
    const id = newReportId();
    const stored = await env.REPORTS.put(`${day}/${id}.log`, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { app, received },
    });
    if (stored !== null) return { ok: true, id };
  }
  return {
    ok: false,
    response: error(503, "storage_conflict", "Could not allocate a unique report id; retry."),
  };
}

async function handle(request: Request, env: Env): Promise<Response> {
  const received = new Date(); // arrival time, taken before the body is read
  const url = new URL(request.url);
  if (url.protocol !== "https:" || url.hostname !== ZONE_HOST || url.pathname !== "/report") {
    return error(404, "not_found", "Unknown path.");
  }
  if (request.method !== "POST") {
    const res = error(405, "method_not_allowed", "Only POST is supported.");
    res.headers.set("allow", "POST");
    return res;
  }
  const contentType = request.headers.get("content-type");
  if (contentType === null || !LOG_CONTENT_TYPE.test(contentType)) {
    return error(415, "unsupported_media_type", "Send the log as text/plain; charset=utf-8.");
  }
  const app = request.headers.get("x-kalsa-app");
  if (app === null || !APP_HEADER_PATTERN.test(app)) {
    return error(400, "bad_app_header", "X-Kalsa-App must be <version>/<os>/<arch>.");
  }
  const length = request.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length.trim()) && Number(length.trim()) > MAX_BODY_BYTES) {
    return tooLarge();
  }
  // Validation first: rejected requests must not spend the client's rate-limit quota.
  const { success } = await env.REPORT_RATE_LIMITER.limit({
    key: request.headers.get("cf-connecting-ip") ?? "",
  });
  if (!success) {
    return error(429, "rate_limited", "Too many uploads from this address; wait a minute.");
  }
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const day = received.toISOString().slice(0, 10);
  const dayObjects = await env.REPORTS.list({ prefix: `${day}/`, limit: DAILY_CAP });
  if (dayObjects.objects.length >= DAILY_CAP) {
    return error(503, "daily_limit", "Too many reports today; try again tomorrow.");
  }
  const stored = await storeReport(env, day, body.bytes, app, received.toISOString());
  if (!stored.ok) return stored.response;
  return json(201, { id: stored.id });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch {
      return error(500, "internal_error", "Unexpected server error.");
    }
  },
};
