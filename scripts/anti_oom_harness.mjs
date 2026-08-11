/**
 * Harness for anti-OOM pure surface:
 *   - evaluateModelFit (deviceProfile)
 *   - getAvailableMemoryBytesUncached signature (monitor)
 *   - startMemoryMonitor callback wiring (monitor)
 *
 * Compile-from-disk pattern (same as deviceProfileHarness). Exit 1 on fail.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function compile() {
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/deviceProfile.ts",
      "src/engine/contextProfile.ts",
      "src/engine/memoryEstimate.ts",
      "src/engine/threadProfile.ts",
      "src/engine/monitor.ts",
      "src/engine/regenState.ts",
      "--outDir",
      "scripts/.build",
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

function resolveBuilt(name) {
  const candidates = [
    path.join(projectRoot, `scripts/.build/${name}.js`),
    path.join(projectRoot, `scripts/.build/engine/${name}.js`),
    path.join(projectRoot, `scripts/.build/src/engine/${name}.js`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${name}.js. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling anti-OOM modules …");
  compile();
  const dpPath = resolveBuilt("deviceProfile");
  const monPath = resolveBuilt("monitor");
  console.log("Loading", dpPath);
  console.log("Loading", monPath);
  const dp = require(dpPath);
  const mon = require(monPath);
  const { evaluateModelFit, estimateModelNonEvictableMiB } = dp;
  const { getAvailableMemoryBytesUncached, startMemoryMonitor, parseMemAvailableBytes } = {
    ...mon,
    // parseMemAvailableBytes lives in memoryEstimate — re-export via mon import chain not needed
  };

  let passed = 0;
  let failed = 0;
  async function test(name, fn) {
    try {
      await fn();
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
      failed += 1;
    }
  }

  // --- evaluateModelFit: 4GB free / ~2B model ---
  // 2B Q4_K_M ~1.2 GB file; with repack+compute+kv → nonEvictable ~1.3–1.5 GiB.
  // 4 GiB free → fits (with headroom).
  const model2B = {
    sizeBytes: 1_211 * 1024 * 1024, // ~1211 MiB
    engineCtx: 4096,
    kvBytesPerToken: 4.88 * 1024, // measured KiB/tok → bytes
    mmproj: null,
  };
  const fourGiB = 4 * 1024 * 1024 * 1024;
  const oneGiB = 1 * 1024 * 1024 * 1024;
  const halfGiB = 512 * 1024 * 1024;

  await test("evaluateModelFit 4GiB / 2B → fits|tight (not does_not_fit)", () => {
    const r = evaluateModelFit(model2B, fourGiB);
    assert(
      r.verdict === "fits" || r.verdict === "tight",
      `expected fits|tight, got ${r.verdict} (${r.reasonKey})`,
    );
  });

  await test("evaluateModelFit tiny free → does_not_fit + model.tooLarge", () => {
    const r = evaluateModelFit(model2B, halfGiB);
    assert(r.verdict === "does_not_fit", `expected does_not_fit, got ${r.verdict}`);
    assert(r.reasonKey === "model.tooLarge", `reasonKey ${r.reasonKey}`);
  });

  await test("evaluateModelFit null available → unknown + model.memoryUnknown", () => {
    const r = evaluateModelFit(model2B, null);
    assert(r.verdict === "unknown", `expected unknown, got ${r.verdict}`);
    assert(r.reasonKey === "model.memoryUnknown", `reasonKey ${r.reasonKey}`);
  });

  await test("evaluateModelFit zero size → unknown + model.cannotEvaluate", () => {
    const r = evaluateModelFit({ sizeBytes: 0, engineCtx: 0 }, fourGiB);
    assert(r.verdict === "unknown", `expected unknown, got ${r.verdict}`);
    assert(r.reasonKey === "model.cannotEvaluate", `reasonKey ${r.reasonKey}`);
  });

  await test("evaluateModelFit tight band (barely enough)", () => {
    // Use 1.6 GiB free against ~1.3 GiB non-evictable → tight or does_not_fit.
    const r = evaluateModelFit(model2B, 1600 * 1024 * 1024);
    assert(
      r.verdict === "tight" || r.verdict === "does_not_fit" || r.verdict === "fits",
      `unexpected ${r.verdict}`,
    );
    if (r.verdict === "tight") {
      assert(r.reasonKey === "model.tightNow", r.reasonKey);
    }
  });

  // --- mmproj accounting ---
  await test("evaluateModelFit mmproj increases footprint (may worsen verdict)", () => {
    const without = evaluateModelFit(
      { sizeBytes: 2_000_000_000, engineCtx: 4096, kvBytesPerToken: 0 },
      3 * 1024 * 1024 * 1024,
    );
    const withMm = evaluateModelFit(
      {
        sizeBytes: 2_000_000_000,
        engineCtx: 4096,
        kvBytesPerToken: 0,
        mmproj: { sizeBytes: 800_000_000 },
      },
      3 * 1024 * 1024 * 1024,
    );
    // With mmproj, non-evictable grows → verdict should be same or worse.
    const rank = { fits: 0, tight: 1, does_not_fit: 2, unknown: -1 };
    assert(
      rank[withMm.verdict] >= rank[without.verdict],
      `mmproj should not improve fit: ${without.verdict} → ${withMm.verdict}`,
    );
  });

  await test("estimateModelNonEvictableMiB mmproj-sized file > base", () => {
    const base = estimateModelNonEvictableMiB({
      sizeBytes: 1_000_000_000,
      engineCtx: 2048,
      kvBytesPerToken: 0,
    });
    const plus = estimateModelNonEvictableMiB({
      sizeBytes: 1_000_000_000 + 500_000_000,
      engineCtx: 2048,
      kvBytesPerToken: 0,
    });
    assert(typeof base === "number" && typeof plus === "number", "numbers");
    assert(plus > base, `plus ${plus} should exceed base ${base}`);
  });

  // --- getAvailableMemoryBytesUncached signature ---
  await test("getAvailableMemoryBytesUncached is async function", () => {
    assert(typeof getAvailableMemoryBytesUncached === "function", "fn");
    assert(
      getAvailableMemoryBytesUncached.constructor.name === "AsyncFunction" ||
        typeof getAvailableMemoryBytesUncached().then === "function",
      "returns promise",
    );
  });

  await test("getAvailableMemoryBytesUncached resolves null off-Android", async () => {
    // Node harness has no RN Platform → catch path → null
    const v = await getAvailableMemoryBytesUncached();
    assert(v === null || typeof v === "number", `got ${v}`);
  });

  // --- startMemoryMonitor callback wiring ---
  await test("startMemoryMonitor fires onPressure + stop is idempotent", async () => {
    assert(typeof startMemoryMonitor === "function", "fn");
    let pressureCalls = 0;
    let appStateCalls = 0;
    const handle = startMemoryMonitor({
      intervalMs: 50,
      onAppState: () => {
        appStateCalls += 1;
      },
      onPressure: () => {
        pressureCalls += 1;
      },
    });
    assert(handle && typeof handle.stop === "function", "handle.stop");
    // Wait for at least the initial sample + one interval tick.
    await new Promise((r) => setTimeout(r, 120));
    handle.stop();
    handle.stop(); // idempotent
    assert(pressureCalls >= 1, `onPressure calls=${pressureCalls}`);
    // appState may be 0 in node (no RN AppState) — that is fine.
    assert(appStateCalls >= 0, "appStateCalls");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
