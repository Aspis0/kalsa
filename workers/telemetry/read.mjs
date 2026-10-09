#!/usr/bin/env node
/**
 * Maintainer read of stored telemetry reports via GET /admin/reports (READ_TOKEN).
 *
 * Usage:
 *   READ_TOKEN=… TELEMETRY_WORKER_URL=https://telemetry.kalsa.io \
 *     node workers/telemetry/read.mjs [--since ISO] [--seen-since ISO] [--out file] [--logs]
 *
 * --logs downloads each stored log with wrangler into R2READ_DIR (default /tmp/r2read).
 *
 * Pages through the whole buffer, newest first, and writes the entries to --out.
 * --seen-since keeps entries whose lastSeenAt is at or after the instant, so an old
 * report that recurred shows up; it filters after paging, so --since still bounds
 * what the server returns.
 * (default /tmp/kalsa-telemetry-<timestamp>.json). The file is created exclusively
 * with mode 0600: an existing path or symlink is refused, never overwritten.
 * Never prints the token or the raw body.
 */
import { closeSync, constants as fsConstants, lstatSync, openSync, writeSync } from "node:fs";
import { fetchLog } from "./read-logs.mjs";

const PAGE_LIMIT = 500;
const FETCH_TIMEOUT_MS = 30_000;

function usage(msg) {
  console.error(
    `${msg}\nusage: READ_TOKEN=… TELEMETRY_WORKER_URL=… node workers/telemetry/read.mjs [--since ISO] [--seen-since ISO] [--out file] [--logs]`,
  );
  process.exit(1);
}

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const opts = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  if (flag === "--logs") {
    opts.logs = true;
    continue;
  }
  const value = args[i + 1];
  if (!["--since", "--seen-since", "--out"].includes(flag) || value === undefined) {
    usage(`bad argument: ${flag ?? "(missing)"}`);
  }
  opts[flag.slice(2)] = value;
  i += 1;
}

const base = (process.env.TELEMETRY_WORKER_URL || "").replace(/\/$/, "");
const token = process.env.READ_TOKEN || "";
if (!base) usage("TELEMETRY_WORKER_URL unset");
if (!token) usage("READ_TOKEN unset");
if (opts.since !== undefined && Number.isNaN(Date.parse(opts.since))) {
  usage("--since is not a date");
}
if (opts["seen-since"] !== undefined && Number.isNaN(Date.parse(opts["seen-since"]))) {
  usage("--seen-since is not a date");
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

const seenSince = opts["seen-since"];
const shown =
  seenSince === undefined
    ? entries
    : entries.filter((e) => Date.parse(e.lastSeenAt) >= Date.parse(seenSince));

writeNew(outPath, JSON.stringify({ total, count: shown.length, skipped, entries: shown }));

const occurrences = shown.reduce((sum, e) => sum + e.count, 0);
const scope = seenSince === undefined ? "" : ` seen since ${seenSince} (of ${entries.length} fetched)`;
console.log(
  `${shown.length} reports, ${occurrences} occurrences${scope} (total ${total}, skipped ${skipped}) → ${outPath}`,
);

/** Sums each entry's occurrence count under its key; `reports` counts distinct stored reports. */
function tally(label, keyOf, top = Infinity) {
  const sums = new Map();
  for (const e of shown) {
    const key = keyOf(e);
    const t = sums.get(key) ?? { weight: 0, reports: 0 };
    t.weight += e.count;
    t.reports += 1;
    sums.set(key, t);
  }
  console.log(`\n${label}`);
  const rows = [...sums].sort((a, b) => b[1].weight - a[1].weight).slice(0, top);
  for (const [key, t] of rows) {
    console.log(`  ${key.padEnd(32)} ${String(t.weight).padStart(5)} (${t.reports} reports)`);
  }
}

tally("platform", (e) => e.report.platform ?? "(none)");
tally("appVersion", (e) => e.report.appVersion ?? "(none)");
tally("error.code", (e) => e.report.error?.code ?? "(none)");
tally("error.detail", (e) => e.report.error?.detail ?? "(none)");
tally("diagnostics.component", (e) => e.report.diagnostics?.component ?? "(none)");
tally("diagnostics.stage", (e) => e.report.diagnostics?.stage ?? "(none)");
tally("diagnostics.signature (top 10)", (e) => e.report.diagnostics?.signature ?? "(none)", 10);

console.log("\nnewest 5");
for (const e of shown.slice(0, 5)) {
  const r = e.report;
  console.log(
    `  ${e.receivedAt}  ${r.platform ?? "-"}  v${r.appVersion ?? "-"}  ` +
      `${r.error?.code ?? "-"}/${r.error?.detail ?? "-"}  ` +
      `${r.diagnostics?.component ?? "-"}/${r.diagnostics?.stage ?? "-"}  ` +
      `x${e.count} last=${e.lastSeenAt}  logs=${e.logRefs.length ? e.logRefs.join(",") : "-"}  ` +
      `sig=${e.sig.slice(0, 12)}  ack=${e.reviewAck}`,
  );
}

if (opts.logs) {
  const logDir = process.env.R2READ_DIR || "/tmp/r2read";
  console.log("\nlogs");
  for (const e of shown.filter((x) => x.logRefs.length > 0)) {
    console.log(`# sig=${e.sig.slice(0, 12)} x${e.count}`);
    for (const ref of e.logRefs) {
      const found = await fetchLog(ref, logDir);
      console.log(
        found.missing
          ? `  ${ref}  missing (tried ${found.tried.join(", ")})`
          : `  ${ref}  found ${found.key} → ${found.file}`,
      );
    }
  }
}
