/**
 * End-to-end tests for workers/telemetry/read.mjs: the real Worker route behind
 * a local HTTP bridge. Exit 1 on fail.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, entry, makeEnv, seeded, storageWith, worker } from "./test-support.mjs";

const execAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const READ_TOKEN = "cli-read-token-fixture";
const work = mkdtempSync(path.join(tmpdir(), "kalsa-read-cli-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

let currentEnv = null;
let requests = 0;
const server = http.createServer(async (req, res) => {
  requests += 1;
  const headers = req.headers.authorization ? { authorization: req.headers.authorization } : {};
  const r = await worker.fetch(
    new Request(`https://telemetry.kalsa.io${req.url}`, { method: req.method, headers }),
    currentEnv,
  );
  res.writeHead(r.status, { "content-type": "application/json" });
  res.end(await r.text());
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;

// Stands in for `npx wrangler r2 object get`: writes --file only for keys in FAKE_R2_KEYS.
const r2dir = path.join(work, "r2read");
const fakeBin = mkdtempSync(path.join(work, "bin-"));
const fakeNpx = path.join(fakeBin, "npx");
writeFileSync(
  fakeNpx,
  `#!${process.execPath}
const { writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const key = args[args.indexOf("get") + 1].replace("kalsa-reports/", "");
const file = args[args.indexOf("--file") + 1];
if (!(process.env.FAKE_R2_KEYS ?? "").split(",").includes(key)) {
  console.error("The specified key does not exist.");
  process.exit(1);
}
writeFileSync(file, "redacted log body");
`,
);
chmodSync(fakeNpx, 0o755);
let fakeR2Keys = "";

async function run(args, token = READ_TOKEN) {
  const env = {
    PATH: `${fakeBin}:${process.env.PATH}`,
    READ_TOKEN: token,
    TELEMETRY_WORKER_URL: url,
    R2READ_DIR: r2dir,
    FAKE_R2_KEYS: fakeR2Keys,
  };
  try {
    const r = await execAsync(process.execPath, ["workers/telemetry/read.mjs", ...args], { cwd: root, env });
    return { status: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    return { status: err.code, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const iso = (ms) => new Date(ms).toISOString();
let passed = 0;
let failed = 0;

async function test(name, fn) {
  requests = 0;
  try {
    await fn();
    console.log(`  OK  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
    failed += 1;
  }
}

console.log("\n[read.mjs paging and output]");
await test("pages through 1203 reports, newest first, with mode 0600 and no token echo", async () => {
  currentEnv = makeEnv(seeded(1203), { READ_TOKEN });
  const out = path.join(work, "all.json");
  const r = await run(["--out", out]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!(r.stdout + r.stderr).includes(READ_TOKEN), "token printed");
  const data = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(data.count, 1203);
  assert.equal(data.total, 1203);
  assert.equal(data.skipped, 0);
  const sigs = data.entries.map((e) => e.sig);
  assert.equal(new Set(sigs).size, 1203, "duplicate or missing sigs");
  assert.equal(sigs[0], "sig-1202");
  assert.equal(sigs.at(-1), "sig-0");
  assert.equal(requests, 4, "500 + 500 + 203 + the empty page that ends the loop");
  assert.equal(statSync(out).mode & 0o777, 0o600);
});
await test("paging loses no report that shares a millisecond across a page boundary", async () => {
  const tied = Array.from({ length: 1203 }, (_, i) => entry(i, BASE + Math.floor(i / 3) * 60_000));
  currentEnv = makeEnv(storageWith(tied), { READ_TOKEN });
  const out = path.join(work, "tied.json");
  const r = await run(["--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const sigs = JSON.parse(readFileSync(out, "utf8")).entries.map((e) => e.sig);
  assert.equal(new Set(sigs).size, 1203);
});
await test("--since bounds the paged read", async () => {
  currentEnv = makeEnv(seeded(1203), { READ_TOKEN });
  const out = path.join(work, "since.json");
  const r = await run(["--since", iso(BASE + 100 * 60_000), "--out", out]);
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(data.count, 1103);
  assert.equal(data.entries.at(-1).sig, "sig-100");
});
await test("--logs finds each log on the logged day or a neighbouring UTC day", async () => {
  const withLogs = { ...entry(0), count: 2, logRefs: ["2026-10-09/ABCD2345", "2026-10-09/WXYZ2345"] };
  currentEnv = makeEnv(storageWith([withLogs, entry(1)]), { READ_TOKEN });
  fakeR2Keys = "2026-10-10/ABCD2345.log,2026-10-08/WXYZ2345.log";
  const r = await run(["--logs", "--out", path.join(work, "logs.json")]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /logs=2026-10-09\/ABCD2345,2026-10-09\/WXYZ2345/);
  assert.ok(r.stdout.includes("2026-10-09/ABCD2345  found 2026-10-10/ABCD2345.log → " + path.join(r2dir, "2026-10-10_ABCD2345.log")), r.stdout);
  assert.ok(r.stdout.includes("2026-10-09/WXYZ2345  found 2026-10-08/WXYZ2345.log → " + path.join(r2dir, "2026-10-08_WXYZ2345.log")), r.stdout);
  assert.equal(readFileSync(path.join(r2dir, "2026-10-10_ABCD2345.log"), "utf8"), "redacted log body");
});
await test("--logs reports a log missing after trying the logged day and both neighbours", async () => {
  const lost = { ...entry(0), count: 1, logRefs: ["2026-10-09/QQQQ2345"] };
  currentEnv = makeEnv(storageWith([lost]), { READ_TOKEN });
  fakeR2Keys = "";
  const r = await run(["--logs", "--out", path.join(work, "lost.json")]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(
    r.stdout.includes("2026-10-09/QQQQ2345  missing (tried 2026-10-09, 2026-10-08, 2026-10-10)"),
    r.stdout,
  );
});
await test("without --logs no log is fetched", async () => {
  const withLogs = { ...entry(0), count: 2, logRefs: ["2026-10-09/ABCD2345"] };
  currentEnv = makeEnv(storageWith([withLogs]), { READ_TOKEN });
  fakeR2Keys = "2026-10-09/ABCD2345.log";
  rmSync(r2dir, { recursive: true, force: true });
  const plain = await run(["--out", path.join(work, "nologs.json")]);
  assert.equal(plain.status, 0, plain.stderr);
  assert.ok(!plain.stdout.includes("found"), "a log was looked up without --logs");
  assert.ok(!existsSync(r2dir), "a log was written without --logs");
});
await test("--seen-since finds an old report that recurred, on the last page; paging unchanged", async () => {
  const old = { ...entry(0), count: 4, lastSeenAt: BASE + 30 * 3600_000 };
  const others = Array.from({ length: 1202 }, (_, i) => entry(i + 1));
  currentEnv = makeEnv(storageWith([old, ...others]), { READ_TOKEN });
  const out = path.join(work, "seen.json");
  const r = await run(["--seen-since", iso(BASE + 25 * 3600_000), "--out", out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 reports, 4 occurrences seen since .* \(of 1203 fetched\)/);
  const data = JSON.parse(readFileSync(out, "utf8"));
  assert.deepEqual(data.entries.map((e) => e.sig), ["sig-0"]);
  assert.equal(requests, 4, "paging must still read every page");
});
await test("--seen-since rejects a non-date", async () => {
  const r = await run(["--seen-since", "nope"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--seen-since is not a date/);
  assert.equal(requests, 0);
});
await test("malformed entries are reported as skipped, not fatal", async () => {
  currentEnv = makeEnv(storageWith([entry(0), entry(1), { ...entry(2), createdAt: undefined }]), { READ_TOKEN });
  const out = path.join(work, "skipped.json");
  const r = await run(["--out", out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 reports, 2 occurrences \(total 2, skipped 1\)/);
});
await test("summary prints the engine signature tally, weighted by count", async () => {
  const diag = (i, count) => ({ ...entry(i), count, report: { ...entry(i).report, diagnostics: { signature: "GGML_ASSERT ggml-vulkan.cpp:1234" } } });
  currentEnv = makeEnv(storageWith([diag(0, 4), diag(1, 1), entry(2)]), { READ_TOKEN });
  const r = await run(["--out", path.join(work, "sig.json")]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /diagnostics\.signature \(top 10\)\n\s+GGML_ASSERT ggml-vulkan\.cpp:1234\s+5 \(2 reports\)\n\s+\(none\)\s+1 \(1 reports\)/);
});
await test("summary weights each report by its occurrence count", async () => {
  const seven = { ...entry(0), count: 7 };
  currentEnv = makeEnv(storageWith([seven, entry(1)]), { READ_TOKEN });
  const r = await run(["--out", path.join(work, "weighted.json")]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /2 reports, 8 occurrences/);
  assert.match(r.stdout, /error\.code\n\s+engine\.init\s+8 \(2 reports\)/);
  assert.match(r.stdout, /engine\.init\/native_crash\s+-\/-\s+x7 last=/);
});

console.log("\n[read.mjs output file safety]");
await test("an existing --out file is refused, not overwritten, before any request", async () => {
  currentEnv = makeEnv(seeded(3), { READ_TOKEN });
  const existing = path.join(work, "keep.json");
  writeFileSync(existing, "keep", { mode: 0o644 });
  const r = await run(["--out", existing]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /refusing to write/);
  assert.equal(readFileSync(existing, "utf8"), "keep");
  assert.equal(statSync(existing).mode & 0o777, 0o644, "permissions changed");
  assert.equal(requests, 0, "a request was made before the refusal");
});
await test("a symlink at --out is refused and its target is untouched", async () => {
  currentEnv = makeEnv(seeded(3), { READ_TOKEN });
  const victim = path.join(work, "victim.txt");
  const link = path.join(work, "link.json");
  writeFileSync(victim, "victim", { mode: 0o644 });
  symlinkSync(victim, link);
  const r = await run(["--out", link]);
  assert.equal(r.status, 1);
  assert.equal(readFileSync(victim, "utf8"), "victim");
  assert.ok(lstatSync(link).isSymbolicLink(), "link replaced");
});
await test("default path is a unique timestamped file, created with mode 0600", async () => {
  currentEnv = makeEnv(seeded(2), { READ_TOKEN });
  const r = await run([]);
  assert.equal(r.status, 0, r.stderr);
  const written = r.stdout.match(/→ (\S+)/)[1];
  assert.match(path.basename(written), /^kalsa-telemetry-\d{4}-\d{2}-\d{2}T[\d-]+Z\.json$/);
  assert.equal(statSync(written).mode & 0o777, 0o600);
  unlinkSync(written);
});

console.log("\n[read.mjs argument and auth errors]");
await test("bad --since is refused before any request", async () => {
  const r = await run(["--since", "nope"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--since is not a date/);
  assert.equal(requests, 0);
});
await test("wrong token → exit 1, status only, token not printed", async () => {
  currentEnv = makeEnv(seeded(3), { READ_TOKEN });
  const r = await run(["--out", path.join(work, "never.json")], "wrong-token-zz");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /HTTP 401 unauthorized/);
  assert.ok(!(r.stdout + r.stderr).includes("wrong-token-zz"));
});

server.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
