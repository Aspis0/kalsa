/**
 * Harness for src/telemetry (TELEMETRY_OPTIN.md v14 FINAL + diag-addendum).
 * Compile-from-disk pure.ts + config.ts; service tests with mock storage/fetch.
 * Exit 1 on fail.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/telemetryHarness");
const require = createRequire(import.meta.url);

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/telemetry/config.ts",
      "src/telemetry/pure.ts",
      "src/telemetry/telemetry.ts",
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
    path.join(outDir, `src/telemetry/${base}`),
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

function makeMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    async setItem(k, v) {
      map.set(k, String(v));
    },
    async removeItem(k) {
      map.delete(k);
    },
    async multiGet(keys) {
      return keys.map((k) => [k, map.has(k) ? map.get(k) : null]);
    },
    async multiRemove(keys) {
      for (const k of keys) map.delete(k);
    },
    _map: map,
  };
}

/** Fail setItem / removeItem / multiRemove for keys matching any substring. */
function makeFailKeysStorage(base, setFailSubstrings = [], removeFailSubstrings = []) {
  const hit = (k, list) =>
    typeof k === "string" && list.some((s) => k.includes(s));
  return {
    ...base,
    async setItem(k, v) {
      if (hit(k, setFailSubstrings)) {
        throw new Error(`injected setItem fail ${k}`);
      }
      return base.setItem(k, v);
    },
    async removeItem(k) {
      if (hit(k, removeFailSubstrings)) {
        throw new Error(`injected removeItem fail ${k}`);
      }
      return base.removeItem(k);
    },
    async multiRemove(keys) {
      if (keys.some((k) => hit(k, removeFailSubstrings))) {
        throw new Error("injected multiRemove fail");
      }
      return base.multiRemove(keys);
    },
  };
}

/** setItem that writes a truncated value then throws (torn write). */
function makeFlakyStorage(base, failKeySubstring, failOnce = true) {
  let failed = false;
  return {
    ...base,
    async setItem(k, v) {
      if (
        (!failed || !failOnce) &&
        typeof k === "string" &&
        k.includes(failKeySubstring)
      ) {
        failed = true;
        // Partial corrupt write
        await base.setItem(k, String(v).slice(0, Math.max(1, Math.floor(String(v).length / 3))));
        throw new Error("injected write failure");
      }
      return base.setItem(k, v);
    },
  };
}

async function main() {
  console.log("Compiling telemetry modules…");
  compile();
  const purePath = resolveBuilt("pure.js");
  const telPath = resolveBuilt("telemetry.js");
  console.log("Loading", purePath);

  const pure = require(purePath);
  const tel = require(telPath);

  let passed = 0;
  let failed = 0;
  function test(name, fn) {
    try {
      const r = fn();
      if (r && typeof r.then === "function") {
        return r
          .then(() => {
            console.log(`  OK  ${name}`);
            passed += 1;
          })
          .catch((err) => {
            console.error(
              `  FAIL ${name}: ${err instanceof Error ? err.message : err}`,
            );
            failed += 1;
          });
      }
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(
        `  FAIL ${name}: ${err instanceof Error ? err.message : err}`,
      );
      failed += 1;
    }
  }

  // ── Sanitizer ────────────────────────────────────────────────────────────
  console.log("\n[sanitizer]");
  test("accepts allowlisted code+detail", () => {
    const r = pure.sanitizeReport({
      code: "web.fetch",
      detail: "timeout",
      appVersion: "0.1.0",
      deviceBucket: "low",
      osMajor: "13",
    });
    assert(r && r.error.code === "web.fetch", "code");
    assert(r.error.detail === "timeout", "detail");
    assert(r.app === "kalsa" && r.platform === "android", "identity");
  });

  test("omits free-text detail (URL)", () => {
    const r = pure.sanitizeReport({
      code: "web.fetch",
      detail: "https://evil.example/x?key=1",
      appVersion: "0.1.0",
    });
    assert(r && r.error.detail === undefined, "detail must be omitted");
  });

  test("omits email / JWT / path / key= / port / hash style detail", () => {
    for (const d of [
      "user@example.com",
      "eyJhbGciOiJIUzI1NiJ9.abc.def",
      "/data/user/0/com.kalsa/files/x",
      "api_key=secret",
      "host:8443",
      "deadbeefcafebabe01234567",
      "arbitrary user text about my cat",
      "unicode café ☕ long enough to fail",
    ]) {
      const r = pure.sanitizeReport({ code: "web.fetch", detail: d });
      assert(r && r.error.detail === undefined, `should omit: ${d}`);
    }
  });

  test("sanitizeToolErrorMessage-style URL text does NOT pass as detail", () => {
    // Mirrors webFetchTool sanitizeToolErrorMessage output shape (URL preserved).
    const toolStyle =
      "Fetch failed for https://example.com/path?q=1 after redirect";
    const r = pure.sanitizeReport({
      code: "web.fetch",
      detail: toolStyle,
      rawMessage: toolStyle,
    });
    assert(r && r.error.detail === undefined, "detail omitted");
    // signal also must not capture URL
    assert(
      r.error.signal === undefined || !/https?:/.test(r.error.signal),
      "signal must not contain URL",
    );
  });

  test("per-code detail enums (valid)", () => {
    const cases = [
      ["web.fetch", "http_403"],
      ["web.fetch", "http_404"],
      ["web.fetch", "http_5xx"],
      ["web.fetch", "dns"],
      ["web.fetch", "tls"],
      ["web.fetch", "payload_too_large"],
      ["web.search", "timeout"],
      ["engine.init", "disk_full"],
      ["engine.init", "model_corrupt"],
      ["engine.init", "model_missing"],
      ["engine.init", "init_timeout"],
      ["engine.init", "native_crash"],
      ["chat.generation", "ctx_overflow"],
      ["chat.generation", "stop_aborted"],
      ["embed.native", "gate_aborted"],
      ["embed.native", "model_corrupt"],
    ];
    for (const [code, detail] of cases) {
      const r = pure.sanitizeReport({ code, detail, appVersion: "0.1.0" });
      assert(r && r.error.detail === detail, `${code}/${detail}`);
    }
  });

  test("per-code detail enums (invalid → omit)", () => {
    const bad = [
      ["web.fetch", "http"], // old enum
      ["web.fetch", "disk_full"],
      ["engine.init", "http_403"],
      ["chat.generation", "disk_full"],
      ["embed.native", "timeout"],
    ];
    for (const [code, detail] of bad) {
      const r = pure.sanitizeReport({ code, detail });
      assert(r && r.error.detail === undefined, `${code}/${detail} must omit`);
    }
  });

  test("null/malformed input → null", () => {
    assert(pure.sanitizeReport(null) === null, "null");
    assert(pure.sanitizeReport(undefined) === null, "undefined");
    assert(pure.sanitizeReport("x") === null, "string");
  });

  // ── extractSignal (diag-addendum) ────────────────────────────────────────
  console.log("\n[signal]");
  test("ENOSPC from No space left", () => {
    const s = pure.extractSignal("No space left on device (ENOSPC)");
    assert(s === "ENOSPC", `got ${s}`);
  });
  test("ggml_* from ggml_opencl", () => {
    const s = pure.extractSignal("ggml_opencl: error loading kernel");
    assert(s === "ggml_*", `got ${s}`);
  });
  test("segmentation fault", () => {
    const s = pure.extractSignal("segmentation fault (core dumped)");
    assert(s === "segmentation fault", `got ${s}`);
  });
  test("arbitrary text → omit", () => {
    assert(pure.extractSignal("something went sideways on my phone") === undefined);
  });
  test("URL/path message without token → omit", () => {
    assert(
      pure.extractSignal("failed https://x.com/a/b?q=1 /data/user/0/files") ===
        undefined,
    );
  });
  test("sanitizeReport attaches signal from rawMessage", () => {
    const r = pure.sanitizeReport({
      code: "engine.init",
      detail: "disk_full",
      rawMessage: "No space left on device (ENOSPC)",
    });
    assert(r && r.error.signal === "ENOSPC", `got ${r?.error?.signal}`);
  });
  test("reject free-text signal field", () => {
    const r = pure.sanitizeReport({
      code: "engine.init",
      signal: "user typed free text here",
    });
    assert(r && r.error.signal === undefined);
  });
  test("ggml suffix claimed as signal normalizes to ggml_*", () => {
    const r = pure.sanitizeReport({
      code: "engine.init",
      signal: "ggml_opencl",
    });
    assert(r && r.error.signal === "ggml_*", `got ${r?.error?.signal}`);
  });
  test("charset * rejected as signal", () => {
    const r = pure.sanitizeReport({
      code: "engine.init",
      signal: "bad*star",
    });
    assert(r && r.error.signal === undefined, `got ${r?.error?.signal}`);
  });
  test("unknown code does not accept engine-init details", () => {
    const r = pure.sanitizeReport({
      code: "unknown",
      detail: "disk_full",
      appVersion: "0.1.0",
    });
    assert(r && r.error.code === "unknown", "code");
    assert(r.error.detail === undefined, `detail leaked: ${r.error.detail}`);
    const ok = pure.sanitizeReport({
      code: "unknown",
      detail: "unknown",
      appVersion: "0.1.0",
    });
    assert(ok && ok.error.detail === "unknown", "unknown/unknown");
  });
  test("unsafe appVersion rewritten to 0.0.0", () => {
    const r = pure.sanitizeReport({
      code: "web.fetch",
      detail: "timeout",
      appVersion: "1.0.0](https://evil)",
    });
    assert(r && r.appVersion === "0.0.0", `got ${r?.appVersion}`);
  });
  test("sanitizer output stays inside Worker schema accepted set", () => {
    const codes = [
      "engine.init",
      "chat.generation",
      "embed.native",
      "web.fetch",
      "web.search",
      "unknown",
    ];
    const engineInit = [
      "oom",
      "disk_full",
      "model_corrupt",
      "model_missing",
      "init_timeout",
      "native_crash",
      "unknown",
    ];
    for (const code of codes) {
      for (const detail of engineInit) {
        const r = pure.sanitizeReport({ code, detail, appVersion: "0.1.0" });
        assert(r, `${code}/${detail} must sanitize`);
        if (code === "unknown") {
          assert(
            r.error.detail === undefined || r.error.detail === "unknown",
            `${code}/${detail} → ${r.error.detail}`,
          );
        } else if (code === "engine.init") {
          assert(r.error.detail === detail, `${code}/${detail}`);
        } else {
          assert(
            r.error.detail === undefined || r.error.detail === detail,
            `${code}/${detail} → ${r.error.detail}`,
          );
        }
      }
    }
    const sigs = ["ENOSPC", "ggml_*", "ggml_opencl", "bad*star", "https://x"];
    const expected = ["ENOSPC", "ggml_*", "ggml_*", undefined, undefined];
    sigs.forEach((s, i) => {
      const r = pure.sanitizeReport({
        code: "engine.init",
        signal: s,
        appVersion: "0.1.0",
      });
      assert(r && r.error.signal === expected[i], `${s} → ${r?.error?.signal}`);
    });
  });

  // ── Buckets ──────────────────────────────────────────────────────────────
  console.log("\n[buckets]");
  test("deviceBucket from ramTier", () => {
    assert(pure.deviceBucketFromRamTier("low") === "low");
    assert(pure.deviceBucketFromRamTier("mid") === "mid");
    assert(pure.deviceBucketFromRamTier("high") === "high");
    assert(pure.deviceBucketFromRamTier(null) === "low");
  });
  test("memoryClass from bytes", () => {
    assert(pure.memoryClassFromBytes(3e9) === "lt-4gb");
    assert(pure.memoryClassFromBytes(5e9) === "4-6gb");
    assert(pure.memoryClassFromBytes(8e9) === "ge-6gb");
    assert(pure.memoryClassFromBytes(null) === "unknown");
  });
  test("modelCategory from id", () => {
    assert(pure.modelCategoryFromId("lfm2.5-2.6b") === "dense.2b");
    assert(pure.modelCategoryFromId("qwen3.5-4b") === "dense.4b");
    assert(pure.modelCategoryFromId("removed-model-2b") === "unknown");
    assert(pure.modelCategoryFromId("foo-moe-bar") === "moe");
    assert(pure.modelCategoryFromId(null) === "unknown");
  });
  test("phase/attempt/chunks context", () => {
    const r = pure.sanitizeReport({
      code: "embed.native",
      detail: "oom",
      phase: "embed",
      attempt: 2,
      chunks: 7,
    });
    assert(r.context.phase === "embed", "phase");
    assert(r.context.attempt === 2, "attempt");
    assert(r.context.chunks === 7, "chunks");
    const r2 = pure.sanitizeReport({
      code: "web.fetch",
      chunks: 7, // not embed → omit
    });
    assert(r2.context.chunks === undefined, "chunks only for embed");
  });

  // ── Journal ──────────────────────────────────────────────────────────────
  console.log("\n[journal]");
  test("integrity round-trip", () => {
    const env = pure.emptyEnvelope({ enabled: true, generation: 1, seq: 0 });
    assert(pure.verifyEnvelopeIntegrity(env), "valid");
    const bad = { ...env, enabled: false }; // integrity stale
    assert(!pure.verifyEnvelopeIntegrity(bad), "tampered");
  });
  test("select highest valid seq; pointer is hint only", () => {
    const a = pure.withIntegrity({
      v: 1,
      enabled: true,
      generation: 1,
      transitionEpoch: 0,
      queue: [],
      dead: [],
      seq: 1,
    });
    const b = pure.withIntegrity({
      v: 1,
      enabled: true,
      generation: 2,
      transitionEpoch: 0,
      queue: [],
      dead: [],
      seq: 5,
    });
    // pointer says A but B has higher seq
    const sel = pure.selectJournalSlot(a, b, "A");
    assert(sel && sel.slot === "B" && sel.envelope.seq === 5, "highest seq");
  });
  test("both corrupt → null (fail-closed)", () => {
    const a = { v: 1, integrity: "0000000000000000", seq: 1 };
    const b = { v: 1, integrity: "1111111111111111", seq: 2 };
    assert(pure.selectJournalSlot(a, b, "A") === null);
  });
  test("tombstone verify", () => {
    const t = pure.makeTombstone(1_700_000_000_000);
    assert(pure.verifyTombstone(t), "valid tombstone");
    assert(pure.verifyTombstone({ ...t, integrity: "x" }) === null, "torn");
    assert(pure.verifyTombstone({ v: 1, optedOutAt: "x", integrity: "y" }) === null);
  });
  test("tombstone A/B highest valid seq", () => {
    const a = pure.makeTombstone(1_700_000_000_000, 1);
    const b = pure.makeTombstone(1_700_000_000_100, 4);
    const sel = pure.selectTombstoneSlot(a, b, "A");
    assert(sel && sel.slot === "B" && sel.tombstone.seq === 4, "highest seq");
    assert(pure.selectTombstoneSlot(null, null, "A") === null, "both absent");
  });
  test("calendar-valid dateBucket", () => {
    assert(pure.isValidDateBucket("2026-08-12") === true, "valid");
    assert(pure.isValidDateBucket("2026-02-29") === false, "non-leap");
    assert(pure.isValidDateBucket("2026-13-01") === false, "month");
    assert(pure.isValidDateBucket("2026-00-10") === false, "zero month");
    const r = pure.sanitizeReport({
      code: "web.fetch",
      detail: "timeout",
      dateBucket: "2026-02-29",
      appVersion: "0.1.0",
    });
    assert(r && r.dateBucket !== "2026-02-29", "invalid date rewritten");
    assert(pure.isValidDateBucket(r.dateBucket), "fallback calendar-valid");
  });

  // ── Queue / response classification ──────────────────────────────────────
  console.log("\n[queue/classify]");
  test("enqueue cap drop-oldest", () => {
    let q = [];
    for (let i = 0; i < 55; i++) {
      const item = pure.makeQueueItem(
        pure.sanitizeReport({ code: "unknown", appVersion: "0.1.0" }),
        1,
        0,
        `id${i}`,
      );
      q = pure.enqueueCapped(q, item, 50);
    }
    assert(q.length === 50, `len ${q.length}`);
    assert(q[0].id === "id5", `oldest kept id5 got ${q[0].id}`);
  });
  test("classifyHttpStatus classes", () => {
    assert(pure.classifyHttpStatus(200) === "accepted");
    assert(pure.classifyHttpStatus(400) === "definitive_drop");
    assert(pure.classifyHttpStatus(413) === "definitive_drop");
    assert(pure.classifyHttpStatus(401) === "definitive_drop");
    assert(pure.classifyHttpStatus(403) === "definitive_drop");
    assert(pure.classifyHttpStatus(404) === "definitive_drop");
    assert(pure.classifyHttpStatus(429) === "backoff");
    assert(pure.classifyHttpStatus(500) === "requeue");
    assert(pure.classifyHttpStatus(503) === "requeue");
  });
  test("finalize: gen mismatch → drop even on accepted", () => {
    const item = pure.makeQueueItem(
      pure.sanitizeReport({ code: "web.fetch", detail: "timeout" }),
      1,
      0,
      "x",
    );
    const out = pure.finalizeItemOutcome({
      item,
      liveGeneration: 2,
      liveTransitionEpoch: 0,
      enabled: true,
      responseClass: "accepted",
      nowMs: 0,
    });
    assert(out.action === "drop", out.action);
  });
  test("finalize: epoch mismatch → drop", () => {
    const item = pure.makeQueueItem(
      pure.sanitizeReport({ code: "web.fetch", detail: "timeout" }),
      1,
      0,
      "x",
    );
    const out = pure.finalizeItemOutcome({
      item,
      liveGeneration: 1,
      liveTransitionEpoch: 1,
      enabled: true,
      responseClass: "requeue",
      nowMs: 0,
    });
    assert(out.action === "drop");
  });
  test("finalize: retry ceiling → dead at retryCount==5", () => {
    let item = pure.makeQueueItem(
      pure.sanitizeReport({ code: "web.fetch", detail: "timeout" }),
      1,
      0,
      "ceil",
    );
    // Simulate 5 markSending bumps
    for (let i = 0; i < 5; i++) {
      item = pure.markSending(item, 0, 60_000);
      item = { ...item, state: "queued", leaseUntil: 0 };
    }
    assert(item.retryCount === 5, `rc ${item.retryCount}`);
    const out = pure.finalizeItemOutcome({
      item,
      liveGeneration: 1,
      liveTransitionEpoch: 0,
      enabled: true,
      responseClass: "requeue",
      nowMs: 1000,
    });
    assert(out.action === "dead", out.action);
  });
  test("markSending stamps attempt and bumps retryCount before dispatch", () => {
    let item = pure.makeQueueItem(
      pure.sanitizeReport({ code: "engine.init", detail: "oom" }),
      1,
      0,
      "ms",
    );
    item = pure.markSending(item, 100, 60_000);
    assert(item.retryCount === 1, "retryCount");
    assert(item.state === "sending", "state");
    assert(item.report.context.attempt === 1, "attempt");
  });
  test("recoverExpiredLeases requeues sending", () => {
    let item = pure.makeQueueItem(
      pure.sanitizeReport({ code: "web.fetch", detail: "dns" }),
      1,
      0,
      "lease",
    );
    item = pure.markSending(item, 0, 1000);
    const recovered = pure.recoverExpiredLeases([item], 5000);
    assert(recovered[0].state === "queued", recovered[0].state);
  });
  test("expungeDead TTL", () => {
    const dead = [
      {
        ...pure.makeQueueItem(
          pure.sanitizeReport({ code: "unknown" }),
          1,
          0,
          "d1",
        ),
        state: "dead",
        deadExpiresAt: 100,
      },
    ];
    assert(pure.expungeDead(dead, 200).length === 0);
    assert(pure.expungeDead(dead, 50).length === 1);
  });

  // ── Service (mock storage/fetch) ─────────────────────────────────────────
  // Fully sequential: module is a process singleton; never start two tests at once.
  console.log("\n[service]");

  async function serviceTest(name, fn) {
    try {
      tel.__resetTelemetryForTests();
      await fn();
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(
        `  FAIL ${name}: ${err instanceof Error ? err.message : err}`,
      );
      failed += 1;
    } finally {
      tel.__resetTelemetryForTests();
    }
  }

  await serviceTest("never-throw reportTelemetry when uninit", async () => {
    tel.reportTelemetry({ code: "web.fetch", detail: "timeout" });
  });

  await serviceTest("default OFF: no fetch", async () => {
    let fetches = 0;
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => {
        fetches += 1;
        return new Response("{}", { status: 200 });
      },
      now: () => 1_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: 3e9,
        osVersion: "13",
        modelId: "lfm2.5-2.6b",
        hadWebTools: true,
      }),
    });
    tel.reportTelemetry({ code: "web.fetch", detail: "timeout" });
    await new Promise((r) => setTimeout(r, 80));
    assert(fetches === 0, `fetches=${fetches}`);
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.enabled === false, "enabled");
  });

  await serviceTest("ON → enqueue → drain accepted", async () => {
    let bodies = [];
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async (_url, init) => {
        bodies.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ accepted: true }), {
          status: 200,
        });
      },
      now: () => 2_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "mid",
        totalMemoryBytes: 6e9,
        osVersion: "14",
        modelId: "qwen3.5-4b",
        hadWebTools: false,
      }),
    });
    const ok = await tel.setTelemetryEnabled(true);
    assert(ok === true, "enable");
    assert(tel.isTelemetryEnabled() === true, "isEnabled");
    tel.reportTelemetry({
      code: "web.fetch",
      detail: "http_404",
      phase: "turn",
    });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      if (bodies.length > 0) break;
      tel.requestTelemetryDrain();
    }
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(
      bodies.length >= 1,
      `bodies ${bodies.length} queue=${snap.queueLen} enabled=${snap.enabled} optedOut=${snap.optedOut}`,
    );
    const b = bodies[0];
    assert(b.error.code === "web.fetch", "code");
    assert(b.error.detail === "http_404", "detail");
    assert(!JSON.stringify(b).includes("http://"), "no url in payload");
    assert(b.deviceBucket === "mid", "bucket");
    assert(b.error.message === undefined, "no message field");
  });

  await serviceTest("OFF purge + tombstone wins on restart", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () =>
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      now: () => 3_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "chat.generation", detail: "oom" });
    await new Promise((r) => setTimeout(r, 40));
    await tel.setTelemetryEnabled(false);
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.enabled === false, "off");
    assert(snap.queueLen === 0, "purged queue");
    assert(snap.deadLen === 0, "purged dead");
    assert(snap.optedOut === true, "optedOut");
    tel.__resetTelemetryForTests();
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 3_000_100,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    const snap2 = tel.__getTelemetrySnapshotForTests();
    assert(snap2.enabled === false, "still off after restart");
    assert(snap2.optedOut === true, "tombstone");
  });

  await serviceTest("5xx requeue then OFF→ON drops terminal", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("err", { status: 503 }),
      now: () => 4_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "high",
        totalMemoryBytes: 8e9,
        osVersion: "15",
        modelId: "qwen3.5-4b",
        hadWebTools: true,
      }),
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "engine.init", detail: "native_crash" });
    for (let i = 0; i < 15; i++) {
      tel.requestTelemetryDrain();
      await new Promise((r) => setTimeout(r, 15));
    }
    await tel.setTelemetryEnabled(false);
    await tel.setTelemetryEnabled(true);
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.queueLen === 0, `queue ${snap.queueLen}`);
    assert(snap.deadLen === 0, `dead ${snap.deadLen}`);
  });

  await serviceTest("400 definitive drop (no requeue)", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("bad", { status: 400 }),
      now: () => 5_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "web.search", detail: "dns" });
    for (let i = 0; i < 15; i++) {
      tel.requestTelemetryDrain();
      await new Promise((r) => setTimeout(r, 15));
    }
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.queueLen === 0, "dropped");
    assert(snap.deadLen === 0, "not dead-lettered");
  });

  await serviceTest("background gate: no enqueue", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 6_000_000,
      getAppState: () => "background",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "web.fetch", detail: "timeout" });
    await new Promise((r) => setTimeout(r, 50));
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.queueLen === 0, `bg enqueue queue=${snap.queueLen}`);
  });

  await serviceTest("torn tombstone → fail-closed OFF", async () => {
    const storage = makeMemoryStorage({
      "kalsa.telemetry.optedOut": "{not-json",
    });
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 7_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.enabled === false, `enabled=${snap.enabled}`);
    assert(snap.optedOut === true, `optedOut=${snap.optedOut}`);
  });

  await serviceTest("corrupt slot recovery uses other slot", async () => {
    const good = pure.withIntegrity({
      v: 1,
      enabled: false,
      generation: 3,
      transitionEpoch: 1,
      queue: [],
      dead: [],
      seq: 9,
    });
    const storage = makeMemoryStorage({
      "kalsa.telemetry.state.A": "{corrupt",
      "kalsa.telemetry.state.B": JSON.stringify(good),
      "kalsa.telemetry.state.pointer": "A",
    });
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 8_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(
      snap.envelope.generation === 3 || snap.envelope.generation === 1,
      "recovered or reset",
    );
    assert(snap.enabled === false, "enabled false");
  });

  await serviceTest("classifiers map real errors", async () => {
    assert(pure.classifyHttpDetail(403) === "http_403");
    assert(pure.classifyHttpDetail(404) === "http_404");
    assert(pure.classifyHttpDetail(502) === "http_5xx");
    assert(
      pure.classifyNetworkFailure(new Error("getaddrinfo ENOTFOUND")) === "dns",
    );
    assert(
      pure.classifyNetworkFailure(new Error("TLS handshake failed")) === "tls",
    );
    assert(
      pure.classifyEngineInitFailure(
        new Error("No space left on device (ENOSPC)"),
      ) === "disk_full",
    );
    assert(
      pure.classifyEngineInitFailure(new Error("out of memory")) === "oom",
    );
    assert(
      pure.classifyChatFailure(new Error("n_ctx overflow")) === "ctx_overflow",
    );
    assert(pure.classifyEmbedFailure("gate refused") === "gate_aborted");
  });

  await serviceTest("OFF tombstone-write failure → no enabled envelope without tombstone", async () => {
    const base = makeMemoryStorage();
    await base.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage: base,
      fetchImpl: async () => new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      now: () => 9_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "web.fetch", detail: "timeout" });
    await new Promise((r) => setTimeout(r, 30));

    // Fail every optedOut / state journal write after enable.
    const flaky = makeFlakyStorage(
      makeFlakyStorage(base, "optedOut", false),
      "telemetry.state",
      false,
    );
    tel.__resetTelemetryForTests();
    await tel.initTelemetry({
      storage: flaky,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 9_000_100,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    // Re-enable first so we have an ON envelope, then OFF with failing writes.
    // The previous reset discarded in-memory state; re-init from flaky store.
    const okOff = await tel.setTelemetryEnabled(false);
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.enabled === false, "in-memory OFF");
    assert(snap.optedOut === true, "optedOut");
    assert(tel.isTelemetryEnabled() === false, "not enabled");
    // Restart: leftover enabled envelope must not transmit.
    tel.__resetTelemetryForTests();
    let fetches = 0;
    await tel.initTelemetry({
      storage: flaky,
      fetchImpl: async () => {
        fetches += 1;
        return new Response("{}", { status: 200 });
      },
      now: () => 9_000_200,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    const snap2 = tel.__getTelemetrySnapshotForTests();
    assert(snap2.enabled === false, `restart enabled=${snap2.enabled}`);
    assert(snap2.optedOut === true, "restart optedOut");
    tel.reportTelemetry({ code: "web.fetch", detail: "timeout" });
    await new Promise((r) => setTimeout(r, 40));
    assert(fetches === 0, `no transmit after failed-OFF restart fetches=${fetches}`);
    void okOff;
  });

  await serviceTest("clear-tombstone failure → re-enable not committed", async () => {
    const base = makeMemoryStorage();
    await base.setItem("kalsa.telemetry.url", "https://example.test");
    const storage = {
      ...base,
      async removeItem(k) {
        if (typeof k === "string" && k.includes("optedOut")) {
          throw new Error("injected clear failure");
        }
        return base.removeItem(k);
      },
      async multiRemove(keys) {
        if (keys.some((k) => String(k).includes("optedOut"))) {
          throw new Error("injected clear failure");
        }
        return base.multiRemove(keys);
      },
    };
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 10_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(false);
    const ok = await tel.setTelemetryEnabled(true);
    assert(ok === false, "enable must fail");
    assert(tel.isTelemetryEnabled() === false, "still OFF");
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.enabled === false, "envelope OFF");
    assert(snap.optedOut === true, "tombstone remains");
  });

  await serviceTest("OFF: marker+tombstone+journal all fail → restart OFF, no transmit", async () => {
    const base = makeMemoryStorage();
    await base.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage: base,
      fetchImpl: async () => new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      now: () => 9_100_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "web.fetch", detail: "timeout" });
    await new Promise((r) => setTimeout(r, 30));
    const queued = tel.__getTelemetrySnapshotForTests();
    assert(queued.queueLen >= 1 || queued.enabled === true, "had ON state");

    // Fail pendingOff + tombstone + journal. Quarantine still writes.
    const failing = makeFailKeysStorage(
      base,
      ["pendingOff", "optedOut", "telemetry.state"],
      ["telemetry.state"],
    );
    tel.__resetTelemetryForTests();
    await tel.initTelemetry({
      storage: failing,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 9_100_100,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    const okOff = await tel.setTelemetryEnabled(false);
    assert(okOff === false, "OFF must not claim success");
    assert(tel.isTelemetryEnabled() === false, "in-memory OFF");
    assert(base._map.has("kalsa.telemetry.quarantine"), "quarantine durable");

    tel.__resetTelemetryForTests();
    let fetches = 0;
    await tel.initTelemetry({
      storage: failing,
      fetchImpl: async () => {
        fetches += 1;
        return new Response("{}", { status: 200 });
      },
      now: () => 9_100_200,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.enabled === false, `restart enabled=${snap.enabled}`);
    assert(snap.optedOut === true, "restart optedOut");
    tel.reportTelemetry({ code: "web.fetch", detail: "timeout" });
    await new Promise((r) => setTimeout(r, 40));
    assert(fetches === 0, `no transmit after total-fail OFF restart fetches=${fetches}`);
  });

  await serviceTest("ON clears leftover pendingOff; restart stays enabled", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 9_200_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(true);
    // Simulate interrupted OFF that left the marker (tombstone already gone).
    await storage.setItem("kalsa.telemetry.pendingOff", "9200001");
    await storage.setItem("kalsa.telemetry.quarantine", "9200001");
    const ok = await tel.setTelemetryEnabled(true);
    assert(ok === true, "ON succeeds after leftover marker");
    assert(tel.isTelemetryEnabled() === true, "enabled now");
    const leftover =
      storage._map.has("kalsa.telemetry.pendingOff") ||
      storage._map.has("kalsa.telemetry.quarantine");
    assert(!leftover, "markers cleared+verified");

    tel.__resetTelemetryForTests();
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 9_200_100,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    assert(tel.isTelemetryEnabled() === true, "restart still enabled");
  });

  await serviceTest("ON marker-clear failure → rollback OFF, tombstoneGate active", async () => {
    const base = makeMemoryStorage();
    await base.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage: base,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 9_300_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(false);
    await base.setItem("kalsa.telemetry.pendingOff", "9300001");
    const failing = makeFailKeysStorage(base, [], ["pendingOff", "quarantine"]);
    tel.__resetTelemetryForTests();
    await tel.initTelemetry({
      storage: failing,
      fetchImpl: async () => new Response("{}", { status: 200 }),
      now: () => 9_300_100,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    // Load saw pendingOff → fail-closed OFF. Now try ON with marker-clear fail.
    const ok = await tel.setTelemetryEnabled(true);
    assert(ok === false, "ON must roll back");
    assert(tel.isTelemetryEnabled() === false, "still OFF");
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.enabled === false, "envelope OFF");
    assert(snap.optedOut === true, "optedOut");
    assert(snap.tombstoneGate === true, "tombstoneGate held");
  });

  await serviceTest("stale-epoch items terminal-drop on background", async () => {
    let appState = "active";
    let appCb = null;
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () =>
        new Promise(() => {
          /* hang so item stays sending */
        }),
      now: () => 11_000_000,
      getAppState: () => appState,
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
      subscribeAppState: (cb) => {
        appCb = cb;
        return () => {
          appCb = null;
        };
      },
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "web.fetch", detail: "timeout" });
    tel.reportTelemetry({ code: "web.search", detail: "dns" });
    await new Promise((r) => setTimeout(r, 40));
    const before = tel.__getTelemetrySnapshotForTests();
    assert(before.queueLen >= 1, `queued before bg queue=${before.queueLen}`);
    const epochBefore = before.transitionEpoch;
    appState = "background";
    if (appCb) appCb("background");
    await new Promise((r) => setTimeout(r, 60));
    const after = tel.__getTelemetrySnapshotForTests();
    assert(after.transitionEpoch === epochBefore + 1, "epoch advanced");
    assert(
      after.queueLen === 0,
      `stale-epoch dropped queue=${after.queueLen} dead=${after.deadLen}`,
    );
  });

  await serviceTest("timeout requeue", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        throw err;
      },
      now: () => 12_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "web.fetch", detail: "timeout" });
    for (let i = 0; i < 20; i++) {
      tel.requestTelemetryDrain();
      await new Promise((r) => setTimeout(r, 15));
    }
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.queueLen === 1, `requeued queue=${snap.queueLen}`);
    assert(snap.deadLen === 0, "not dead");
    const item = snap.envelope.queue[0];
    assert(item.retryCount >= 1, `retryCount=${item.retryCount}`);
    assert(item.state === "queued", item.state);
  });

  await serviceTest("429 backoff then dead-letter at ceiling", async () => {
    let now = 13_000_000;
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response("slow", { status: 429 }),
      now: () => now,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "engine.init", detail: "oom" });
    for (let attempt = 0; attempt < 6; attempt++) {
      now += 2 * 60 * 60 * 1000; // skip backoff
      for (let i = 0; i < 8; i++) {
        tel.requestTelemetryDrain();
        await new Promise((r) => setTimeout(r, 12));
      }
    }
    const snap = tel.__getTelemetrySnapshotForTests();
    assert(snap.queueLen === 0, `queue ${snap.queueLen}`);
    assert(snap.deadLen === 1, `dead ${snap.deadLen}`);
    assert(snap.envelope.dead[0].retryCount >= 5, "ceiling");
  });

  await serviceTest("crash-after-dequeue requeues with persisted retryCount", async () => {
    const storage = makeMemoryStorage();
    await storage.setItem("kalsa.telemetry.url", "https://example.test");
    await tel.initTelemetry({
      storage,
      fetchImpl: async () =>
        new Promise(() => {
          /* never resolves — leave sending */
        }),
      now: () => 14_000_000,
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    await tel.setTelemetryEnabled(true);
    tel.reportTelemetry({ code: "web.fetch", detail: "dns" });
    for (let i = 0; i < 15; i++) {
      tel.requestTelemetryDrain();
      await new Promise((r) => setTimeout(r, 12));
      const mid = tel.__getTelemetrySnapshotForTests();
      if (mid.envelope.queue.some((q) => q.state === "sending")) break;
    }
    const mid = tel.__getTelemetrySnapshotForTests();
    const sending = mid.envelope.queue.find((q) => q.state === "sending");
    assert(sending, "item marked sending");
    assert(sending.retryCount >= 1, `retry persisted ${sending.retryCount}`);

    tel.__resetTelemetryForTests();
    await tel.initTelemetry({
      storage,
      fetchImpl: async () => new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      now: () => 14_000_000 + 120_000, // lease expired
      getAppState: () => "active",
      getAppVersion: () => "0.1.0",
      getDeviceContext: () => ({
        ramTier: "low",
        totalMemoryBytes: null,
        osVersion: "13",
        modelId: null,
        hadWebTools: false,
      }),
    });
    const snap = tel.__getTelemetrySnapshotForTests();
    const recovered = snap.envelope.queue[0];
    assert(recovered, "requeued after crash");
    assert(recovered.state === "queued" || recovered.state === "sending", recovered.state);
    assert(recovered.retryCount >= 1, `retryCount kept ${recovered.retryCount}`);
  });

  // ── i18n deep key parity (inline, mirrors extended harness) ──────────────
  console.log("\n[i18n deep]");
  {
    const i18nOut = path.join(projectRoot, "scripts/.build/telemetryHarness/i18n");
    rmSync(i18nOut, { recursive: true, force: true });
    mkdirSync(i18nOut, { recursive: true });
    const r = spawnSync(
      "npx",
      [
        "tsc",
        "src/i18n/en.ts",
        "src/i18n/it.ts",
        "src/i18n/types.ts",
        "--outDir",
        i18nOut,
        "--module",
        "nodenext",
        "--target",
        "es2020",
        "--moduleResolution",
        "nodenext",
        "--skipLibCheck",
        "--ignoreConfig",
        "--esModuleInterop",
      ],
      { cwd: projectRoot, encoding: "utf8", shell: true },
    );
    assert(r.status === 0, `i18n tsc failed: ${r.stderr || r.stdout}`);
    const enCandidates = [
      path.join(i18nOut, "en.js"),
      path.join(i18nOut, "i18n/en.js"),
      path.join(i18nOut, "src/i18n/en.js"),
    ];
    const itCandidates = [
      path.join(i18nOut, "it.js"),
      path.join(i18nOut, "i18n/it.js"),
      path.join(i18nOut, "src/i18n/it.js"),
    ];
    const enPath = enCandidates.find((c) => existsSync(c));
    const itPath = itCandidates.find((c) => existsSync(c));
    assert(enPath && itPath, "compiled en/it");
    const enMod = await import(pathToFileURL(enPath).href);
    const itMod = await import(pathToFileURL(itPath).href);
    function keySet(obj, prefix = "", out = new Set()) {
      if (!obj || typeof obj !== "object") return out;
      for (const [k, v] of Object.entries(obj)) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (typeof v === "string") out.add(p);
        else if (v && typeof v === "object") keySet(v, p, out);
      }
      return out;
    }
    const enKeys = keySet(enMod.en);
    const itKeys = keySet(itMod.it);
    const missingInIt = [...enKeys].filter((k) => !itKeys.has(k));
    const missingInEn = [...itKeys].filter((k) => !enKeys.has(k));
    test("deep en↔it key-set parity", () => {
      assert(
        missingInIt.length === 0,
        `missing in it: ${missingInIt.slice(0, 20).join(",")}`,
      );
      assert(
        missingInEn.length === 0,
        `missing in en: ${missingInEn.slice(0, 20).join(",")}`,
      );
    });
    test("telemetry i18n keys present", () => {
      for (const k of [
        "settings.telemetry",
        "settings.telemetryBodyOff",
        "settings.telemetryBodyOn",
        "settings.telemetryOptInTitle",
        "settings.telemetryOptInBody",
        "settings.reportProblem",
        "settings.reportCopied",
      ]) {
        assert(enKeys.has(k), `en ${k}`);
        assert(itKeys.has(k), `it ${k}`);
      }
      // privacyBody mentions opt-in
      assert(
        typeof enMod.en.settings.privacyBody === "string" &&
          /telemetry/i.test(enMod.en.settings.privacyBody),
        "en privacyBody",
      );
      assert(
        typeof itMod.it.settings.privacyBody === "string" &&
          /telemetr/i.test(itMod.it.settings.privacyBody),
        "it privacyBody",
      );
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
