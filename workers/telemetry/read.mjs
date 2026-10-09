#!/usr/bin/env node
/**
 * Maintainer read of stored telemetry reports via GET /admin/reports (READ_TOKEN).
 *
 * Usage:
 *   READ_TOKEN=… TELEMETRY_WORKER_URL=https://telemetry.kalsa.io \
 *     node workers/telemetry/read.mjs [--since ISO] [--out file]
 *
 * Pages through the whole buffer, newest first, and writes the entries to --out
 * (default /tmp/kalsa-telemetry-<timestamp>.json). The file is created exclusively
 * with mode 0600: an existing path or symlink is refused, never overwritten.
 * Never prints the token or the raw body.
 */
import { closeSync, constants as fsConstants, lstatSync, openSync, writeSync } from "node:fs";

const PAGE_LIMIT = 500;
const FETCH_TIMEOUT_MS = 30_000;

function usage(msg) {
  console.error(
    `${msg}\nusage: READ_TOKEN=… TELEMETRY_WORKER_URL=… node workers/telemetry/read.mjs [--since ISO] [--out file]`,
  );
  process.exit(1);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const opts = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const flag = args[i];
  const value = args[i + 1];
  if (!["--since", "--out"].includes(flag) || value === undefined) {
    usage(`bad argument: ${flag ?? "(missing)"}`);
  }
  opts[flag.slice(2)] = value;
}

const base = (process.env.TELEMETRY_WORKER_URL || "").replace(/\/$/, "");
const token = process.env.READ_TOKEN || "";
if (!base) usage("TELEMETRY_WORKER_URL unset");
if (!token) usage("READ_TOKEN unset");
if (opts.since !== undefined && Number.isNaN(Date.parse(opts.since))) {
  usage("--since is not a date");
}
const outPath =
  opts.out ?? `/tmp/kalsa-telemetry-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

function pathExists(p) {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Exclusive create: refuses an existing file or symlink, never truncates one. */
function writeNew(p, text) {
  let fd;
  try {
    fd = openSync(
      p,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
  } catch (err) {
    if (err.code === "EEXIST" || err.code === "ELOOP") fail(`refusing to write ${p}: it already exists`);
    throw err;
  }
  try {
    const buf = Buffer.from(text);
    for (let off = 0; off < buf.length; ) off += writeSync(fd, buf, off, buf.length - off);
  } finally {
    closeSync(fd);
  }
}

async function fetchPage(before) {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (opts.since !== undefined) params.set("since", opts.since);
  if (before !== undefined) params.set("before", before);
  const res = await fetch(`${base}/admin/reports?${params}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    let code = "";
    try {
      code = JSON.parse(text).error ?? "";
    } catch {
      /* non-JSON error body: print the status only */
    }
    fail(`HTTP ${res.status} ${code}`.trim());
  }
  return JSON.parse(text);
}

if (pathExists(outPath)) fail(`refusing to write ${outPath}: it already exists`);

let page = await fetchPage(undefined);
const { total, skipped } = page;
const entries = [];
let before;
for (;;) {
  entries.push(...page.entries);
  if (page.count === 0 || page.nextBefore === null) break;
  if (before !== undefined && Date.parse(page.nextBefore) >= Date.parse(before)) {
    fail("paging cursor did not advance; stopping");
  }
  before = page.nextBefore;
  page = await fetchPage(before);
}

writeNew(outPath, JSON.stringify({ total, count: entries.length, skipped, entries }));

console.log(`${entries.length} reports (total ${total}, skipped ${skipped}) → ${outPath}`);

function tally(label, values, top = Infinity) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  console.log(`\n${label}`);
  for (const [value, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`  ${String(n).padStart(4)}  ${value}`);
  }
}

tally("platform", entries.map((e) => e.report.platform ?? "(none)"));
tally("appVersion", entries.map((e) => e.report.appVersion ?? "(none)"));
tally("error.code", entries.map((e) => e.report.error?.code ?? "(none)"));
tally("error.detail", entries.map((e) => e.report.error?.detail ?? "(none)"));
tally("diagnostics.component", entries.map((e) => e.report.diagnostics?.component ?? "(none)"));
tally("diagnostics.stage", entries.map((e) => e.report.diagnostics?.stage ?? "(none)"));
tally(
  "diagnostics.signature (top 10)",
  entries.map((e) => e.report.diagnostics?.signature ?? "(none)"),
  10,
);

console.log("\nnewest 5");
for (const e of entries.slice(0, 5)) {
  const r = e.report;
  console.log(
    `  ${e.receivedAt}  ${r.platform ?? "-"}  v${r.appVersion ?? "-"}  ` +
      `${r.error?.code ?? "-"}/${r.error?.detail ?? "-"}  ` +
      `${r.diagnostics?.component ?? "-"}/${r.diagnostics?.stage ?? "-"}  ` +
      `sig=${e.sig.slice(0, 12)}  ack=${e.reviewAck}`,
  );
}
