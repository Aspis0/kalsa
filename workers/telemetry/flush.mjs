#!/usr/bin/env node
/**
 * Maintainer flush alternative: call GET /flush with FLUSH_TOKEN,
 * or (with wrangler + gh) dump DO and create issues locally.
 *
 * Usage:
 *   FLUSH_TOKEN=… TELEMETRY_WORKER_URL=https://… node workers/telemetry/flush.mjs
 *   AUTO_OPEN_ISSUES is read server-side from Worker env.
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
const text = await res.text();
console.log(res.status, text);
if (!res.ok) process.exit(1);
