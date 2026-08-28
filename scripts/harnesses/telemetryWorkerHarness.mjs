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
const projectRoot = path.resolve(__dirname, "../..");
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
  test("Content-Length over 4KB rejected early", () => {
    assert(mod.contentLengthExceeds("4097", mod.BODY_LIMIT) === true, "4097");
    assert(mod.contentLengthExceeds("4096", mod.BODY_LIMIT) === false, "4096");
    assert(mod.contentLengthExceeds(null, mod.BODY_LIMIT) === false, "absent");
  });
  test("malformed UTF-8 rejected strictly", () => {
    assert(mod.decodeUtf8Strict(new Uint8Array([0x61])) === "a", "ascii");
    assert(mod.decodeUtf8Strict(new Uint8Array([0xff, 0xfe])) === null, "invalid");
  });
  test("ggml suffix normalized to ggml_*", () => {
    const body = validBody({
      error: { code: "engine.init", detail: "native_crash", signal: "ggml_opencl" },
    });
    assert(mod.validateReport(body) === null, "accept ggml_opencl");
    assert(body.error.signal === "ggml_*", `got ${body.error.signal}`);
    assert(mod.normalizeSignal("ggml_foo_bar") === "ggml_*", "family");
    assert(mod.normalizeSignal("ggml_*") === "ggml_*", "exact token");
  });
  test("signal charset * rejected (except ggml_*)", () => {
    const err = mod.validateReport(
      validBody({ error: { code: "web.fetch", signal: "bad*star" } }),
    );
    assert(typeof err === "string" && /signal/.test(err), err);
    assert(mod.normalizeSignal("ENOSPC") === "ENOSPC", "fixed token");
    assert(mod.normalizeSignal("segmentation fault") === "segmentation fault");
  });
  test("detailsForCode(unknown) does not accept engine-init details", () => {
    const allowed = [...mod.detailsForCode("unknown")];
    assert(allowed.length === 1 && allowed[0] === "unknown", allowed.join(","));
    const err = mod.validateReport(
      validBody({ error: { code: "unknown", detail: "disk_full" } }),
    );
    assert(typeof err === "string" && /detail/.test(err), err);
    assert(
      mod.validateReport(validBody({ error: { code: "unknown", detail: "unknown" } })) ===
        null,
      "unknown/unknown ok",
    );
    assert(
      mod.validateReport(validBody({ error: { code: "unknown" } })) === null,
      "unknown without detail ok",
    );
  });
  test("appVersion Markdown injection rejected", () => {
    for (const v of [
      "1.0.0](https://evil)",
      "1.0.0`rm`",
      "[click](https://x)",
      "not-a-version",
      "v1",
    ]) {
      const err = mod.validateReport(validBody({ appVersion: v }));
      assert(typeof err === "string" && /appVersion/.test(err), `should reject ${v}: ${err}`);
    }
    assert(mod.validateReport(validBody({ appVersion: "0.1.0" })) === null, "0.1.0");
    assert(mod.validateReport(validBody({ appVersion: "1.2.3-rc1" })) === null, "pre");
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
  test("malformed 200 GitHub search → error, no create", () => {
    assert(mod.classifyGithubSearchResponse({ ok: true, status: 200 }) === "error", "{}");
    assert(
      mod.classifyGithubSearchResponse({ ok: true, status: 200, totalCount: null }) ===
        "error",
      "null",
    );
    assert(
      mod.classifyGithubSearchResponse({ ok: true, status: 200, totalCount: -1 }) ===
        "error",
      "-1",
    );
    assert(
      mod.classifyGithubSearchResponse({ ok: true, status: 200, totalCount: 1.5 }) ===
        "error",
      "float",
    );
    assert(mod.decideCreateIssue("error", "error") === "release", "two errors");
    assert(mod.decideCreateIssue("error", "not_found") === "release", "error first");
  });
  test("valid total_count 0 / 1 classified", () => {
    assert(
      mod.classifyGithubSearchResponse({ ok: true, status: 200, totalCount: 0 }) ===
        "not_found",
    );
    assert(
      mod.classifyGithubSearchResponse({ ok: true, status: 200, totalCount: 1 }) ===
        "found",
    );
  });
  test("search timeout treated as error (never create)", () => {
    assert(mod.classifyGithubSearchResponse({ ok: false, threw: true }) === "error");
    assert(mod.decideCreateIssue("not_found", "error") === "release");
    assert(mod.GITHUB_SEARCH_TIMEOUT_MS === 8000, String(mod.GITHUB_SEARCH_TIMEOUT_MS));
  });
  test("quota rejection status is 429", () => {
    assert(mod.reportRejectStatus("quota") === 429, "quota");
    assert(mod.reportRejectStatus("duplicate") === 200, "duplicate");
    assert(mod.reportRejectStatus(undefined) === 200, "other");
  });

  console.log("\n[signature]");
  test("canonical signature excludes signal", () => {
    const input = mod.canonicalSignatureInput(
      validBody({
        error: { code: "web.fetch", detail: "timeout", signal: "ENOSPC" },
        context: { modelCategory: "dense.4b" },
      }),
    );
    const keys = Object.keys(input).sort();
    assert(
      JSON.stringify(keys) ===
        JSON.stringify(
          ["appVersion", "code", "dateBucket", "detail", "deviceBucket", "modelCategory"].sort(),
        ),
      keys.join(","),
    );
    assert(!("signal" in input), "signal must not be a signature field");
    assert(input.code === "web.fetch", "code");
    assert(input.detail === "timeout", "detail");
    const a = mod.signatureFields(
      validBody({ error: { code: "web.fetch", detail: "timeout", signal: "ENOSPC" } }),
    );
    const b = mod.signatureFields(
      validBody({ error: { code: "web.fetch", detail: "timeout", signal: "EACCES" } }),
    );
    assert(a === b, "different signals must not bypass dedupe");
    assert(mod.SIGNATURE_KEYS.includes("signal") === false, "SIGNATURE_KEYS");
  });

  console.log("\n[issue body]");
  test("issue body is allowlisted projection, no _reportId", () => {
    const report = validBody({
      appVersion: "0.1.0",
      error: { code: "web.fetch", detail: "timeout", signal: "ENOSPC" },
      context: { modelCategory: "dense.4b" },
    });
    const body = mod.buildIssueBody("deadbeef", report);
    assert(/Telemetry signature: deadbeef/.test(body), "marker");
    assert(/code: web.fetch/.test(body), "code");
    assert(!/_reportId/.test(body), "_reportId leaked");
    assert(!/```/.test(body), "raw json fence");
    assert(!JSON.stringify(report).includes("_reportId"), "schema");
  });
  test("issue body escapes Markdown / URLs", () => {
    const inj = mod.escapeIssueText("see [x](https://evil.example) and `rm`");
    assert(!/https?:\/\//.test(inj), inj);
    assert(!/`/.test(inj), inj);
    assert(!/\[/.test(inj), inj);
    const body = mod.buildIssueBody("sig", validBody());
    assert(!/_reportId/.test(body), "no report id");
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
  test("expired lease → final transition refused", () => {
    const entry = {
      reportId: "r3",
      sig: "ghi",
      report: {},
      state: "creating",
      reviewAck: false,
      leaseUntil: 500,
      leaseToken: 3,
      createdAt: 0,
    };
    const st = { ...mod.emptyBufferState(), entries: [entry], nextLeaseToken: 4 };
    const refused = mod.applyLeaseTransition(st, "r3", 3, "created", 1000);
    assert(refused.ok === false && refused.reason === "expired", JSON.stringify(refused));
    const stillHeld = mod.applyLeaseTransition(st, "r3", 3, "created", 400);
    assert(stillHeld.ok === true, "unexpired holder may finish");
  });
  test("IP map prune bounds growth", () => {
    const m = new Map();
    for (let i = 0; i < 10; i++) m.set(`ip${i}`, [1]);
    mod.pruneIpMap(m, 100, 10, 3);
    assert(m.size <= 3, `size ${m.size}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
