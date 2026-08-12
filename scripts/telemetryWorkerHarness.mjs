/**
 * Pure Worker telemetry harness (no live deploy).
 * Compiles workers/telemetry/schema.ts and exercises schema / lease / search.
 * Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/telemetryWorkerHarness");
const require = createRequire(import.meta.url);

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "workers/telemetry/schema.ts",
      "--outDir",
      outDir,
      "--module",
      "nodenext",
      "--target",
      "es2020",
      "--moduleResolution",
      "nodenext",
      "--skipLibCheck",
      "--ignoreConfig",
      "--esModuleInterop",
      "--types",
      "node",
    ],
    { cwd: projectRoot, encoding: "utf8", shell: true },
  );
  if (r.status !== 0) {
    console.error("tsc failed:\n", r.stdout, r.stderr);
    process.exit(1);
  }
}

function resolveBuilt(base) {
  const candidates = [
    path.join(outDir, `telemetry/${base}`),
    path.join(outDir, `workers/telemetry/${base}`),
    path.join(outDir, base),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find ${base}. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function validBody(over = {}) {
  return {
    v: 1,
    app: "kalsa",
    appVersion: "0.1.0",
    platform: "android",
    deviceBucket: "low",
    osMajor: "13",
    error: { code: "web.fetch", detail: "timeout" },
    context: {},
    dateBucket: "2026-08-12",
    manual: false,
    ...over,
  };
}

function main() {
  console.log("Compiling worker schema…");
  compile();
  const mod = require(resolveBuilt("schema.js"));
  let passed = 0;
  let failed = 0;
  function test(name, fn) {
    try {
      fn();
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
      failed += 1;
    }
  }

  console.log("\n[schema]");
  test("valid report → null", () => {
    assert(mod.validateReport(validBody()) === null, "ok");
  });
  test("unknown top-level key → 400 reason", () => {
    const err = mod.validateReport({ ...validBody(), extra: 1 });
    assert(typeof err === "string" && /unknown key/.test(err), err);
  });
  test("invalid detail → 400", () => {
    const err = mod.validateReport(
      validBody({ error: { code: "web.fetch", detail: "not-an-enum" } }),
    );
    assert(typeof err === "string" && /detail/.test(err), err);
  });
  test("invalid signal → 400", () => {
    const err = mod.validateReport(
      validBody({ error: { code: "web.fetch", signal: "user typed free text" } }),
    );
    assert(typeof err === "string" && /signal/.test(err), err);
  });
  test("chunks rejected for non-embed codes", () => {
    const err = mod.validateReport(
      validBody({
        error: { code: "web.fetch", detail: "timeout" },
        context: { chunks: 3 },
      }),
    );
    assert(typeof err === "string" && /chunks/.test(err), err);
  });
  test("chunks accepted for embed.native", () => {
    const err = mod.validateReport(
      validBody({
        error: { code: "embed.native", detail: "oom" },
        context: { chunks: 3 },
      }),
    );
    assert(err === null, err);
  });
  test("invalid calendar dateBucket → 400", () => {
    const err = mod.validateReport(validBody({ dateBucket: "2026-02-29" }));
    assert(typeof err === "string" && /dateBucket/.test(err), err);
  });
  test("raw-body 413 rule is 4 KiB", () => {
    assert(mod.BODY_LIMIT === 4 * 1024, String(mod.BODY_LIMIT));
  });

  console.log("\n[flush auth]");
  test("/flush without token → 503", () => {
    const r = mod.validFlushAuth(undefined, "Bearer x");
    assert(r.ok === false && r.status === 503, JSON.stringify(r));
  });
  test("/flush wrong bearer → 401", () => {
    const r = mod.validFlushAuth("secret", "Bearer other");
    assert(r.ok === false && r.status === 401, JSON.stringify(r));
  });
  test("/flush matching bearer → ok", () => {
    const r = mod.validFlushAuth("secret", "Bearer secret");
    assert(r.ok === true, JSON.stringify(r));
  });

  console.log("\n[search decision]");
  test("HTTP 500 → error, no create", () => {
    assert(mod.classifyGithubSearchResponse({ ok: false, status: 500 }) === "error");
    assert(mod.decideCreateIssue("error", null) === "release");
  });
  test("timeout/throw → error, no create", () => {
    assert(mod.classifyGithubSearchResponse({ ok: false, threw: true }) === "error");
    assert(mod.decideCreateIssue("not_found", "error") === "release");
  });
  test("two consecutive not_found → create", () => {
    assert(mod.decideCreateIssue("not_found", "not_found") === "create");
  });
  test("found on first or second → mark_created", () => {
    assert(mod.decideCreateIssue("found", null) === "mark_created");
    assert(mod.decideCreateIssue("not_found", "found") === "mark_created");
  });

  console.log("\n[lease CAS]");
  test("concurrent acquire: only first wins", () => {
    const entry = {
      reportId: "r1",
      sig: "abc",
      report: {},
      state: "pending",
      reviewAck: false,
      leaseUntil: 0,
      leaseToken: 0,
      createdAt: 0,
    };
    const st0 = { ...mod.emptyBufferState(), entries: [entry] };
    const a = mod.tryAcquireLease(st0, "r1", 1000, 5000);
    assert(a.ok === true, "first acquire");
    const b = mod.tryAcquireLease(a.state, "r1", 1001, 5000);
    assert(b.ok === false && b.reason === "leased", `second=${JSON.stringify(b)}`);
    const stale = mod.applyLeaseTransition(a.state, "r1", a.token + 1, "created");
    assert(stale.ok === false && stale.reason === "stale_token", "stale fence");
    const ok = mod.applyLeaseTransition(a.state, "r1", a.token, "created");
    assert(ok.ok === true, "owner can complete");
    assert(ok.state.entries[0].state === "created", "created");
  });
  test("expired lease can be re-acquired", () => {
    const entry = {
      reportId: "r2",
      sig: "def",
      report: {},
      state: "creating",
      reviewAck: false,
      leaseUntil: 500,
      leaseToken: 7,
      createdAt: 0,
    };
    const st = { ...mod.emptyBufferState(), entries: [entry], nextLeaseToken: 8 };
    const a = mod.tryAcquireLease(st, "r2", 1000, 5000);
    assert(a.ok === true, "reacquire after expiry");
    assert(a.token === 8, `token ${a.token}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
