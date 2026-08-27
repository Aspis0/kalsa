#!/usr/bin/env node
/**
 * Maintainer flush alternative: call GET /flush with FLUSH_TOKEN,
 * or (with wrangler + gh) dump DO and create issues locally.
 *
 * Usage:
 *   FLUSH_TOKEN=… TELEMETRY_WORKER_URL=https://… node workers/telemetry/flush.mjs
 *   AUTO_OPEN_ISSUES is read server-side from Worker env.
 *
 * Logs status + parsed metadata only. Never dumps the raw response body.
 */
const base = (process.env.TELEMETRY_WORKER_URL || "").replace(/\/$/, "");
const token = process.env.FLUSH_TOKEN || "";

if (!base) {
  console.error("TELEMETRY_WORKER_URL unset");
  process.exit(1);
}
if (!token) {
  console.error("FLUSH_TOKEN unset");
  process.exit(1);
}

const res = await fetch(`${base}/flush`, {
  method: "GET",
  headers: { authorization: `Bearer ${token}`, accept: "application/json" },
});
let meta = { ok: res.ok };
try {
  const parsed = JSON.parse(await res.text());
  if (parsed && typeof parsed === "object") {
    for (const k of ["created", "skipped", "duplicates", "released", "reviewed", "error"]) {
      if (k in parsed) meta[k] = parsed[k];
    }
  }
} catch {
  meta.parse = "invalid_json";
}
console.log(res.status, meta);
if (!res.ok) process.exit(1);
