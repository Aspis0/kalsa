/**
 * Harness for src/engine/engineParams.ts (pure applyEngineOverride).
 *
 * Covers Android GPU gate, iOS GPU apply, threads passthrough, ubatch clamp,
 * prefill thread comparison, absent fields, empty override. Module has no
 * RN/llama.rn imports — plain node.
 *
 * Compile-from-disk pattern (same as benchEngineHarness). Exit 1 on fail.
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
      "src/engine/engineParams.ts",
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

function resolveBuilt() {
  const candidates = [
    path.join(projectRoot, "scripts/.build/engineParams.js"),
    path.join(projectRoot, "scripts/.build/engine/engineParams.js"),
    path.join(projectRoot, "scripts/.build/src/engine/engineParams.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled engineParams.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Production-like baseline (Android defaults). */
function baseParams() {
  return {
    n_batch: 512,
    n_ubatch: 256,
    n_threads: 4,
    n_gpu_layers: 0,
  };
}

async function main() {
  console.log("Compiling engineParams.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = require(modPath);
  const { applyEngineOverride, applyPrefillThreadOverride } = mod;

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

  // ── android gpu ignored ────────────────────────────────────────────────
  await test("android: nGpuLayers ignored; production n_gpu_layers=0 preserved", () => {
    const params = baseParams();
    // Silence expected warn for this case
    const orig = console.warn;
    const warns = [];
    console.warn = (...a) => {
      warns.push(a.join(" "));
    };
    try {
      applyEngineOverride(params, { nGpuLayers: 1 }, "android");
    } finally {
      console.warn = orig;
    }
    assert(params.n_gpu_layers === 0, `n_gpu_layers got ${params.n_gpu_layers}`);
    assert(
      warns.some((w) => /Hexagon|HTP|Android/i.test(w)),
      `expected Android/Hexagon warn, got ${JSON.stringify(warns)}`,
    );
  });

  // ── ios gpu applied ────────────────────────────────────────────────────
  await test("ios: nGpuLayers applied", () => {
    const params = { ...baseParams(), n_gpu_layers: 99 };
    applyEngineOverride(params, { nGpuLayers: 20 }, "ios");
    assert(params.n_gpu_layers === 20, `got ${params.n_gpu_layers}`);
  });

  // ── threads applied ────────────────────────────────────────────────────
  await test("threads passthrough", () => {
    const params = baseParams();
    applyEngineOverride(params, { nThreads: 6 }, "android");
    assert(params.n_threads === 6, `got ${params.n_threads}`);
    assert(params.n_gpu_layers === 0, "gpu default untouched");
    assert(params.n_ubatch === 256, "ubatch default untouched");
  });

  await test("prefill threads apply after final decode override", () => {
    const params = baseParams();
    applyEngineOverride(params, { nThreads: 2 }, "android");
    applyPrefillThreadOverride(params, 4);
    assert(params.n_threads === 2, `decode ${params.n_threads}`);
    assert(params.n_threads_batch === 4, `prefill ${params.n_threads_batch}`);
  });

  await test("equal final decode/prefill suppresses n_threads_batch", () => {
    const params = baseParams();
    applyEngineOverride(params, { nThreads: 2 }, "android");
    applyPrefillThreadOverride(params, 2);
    assert(!("n_threads_batch" in params), "equal threads must omit batch field");
  });

  await test("invalid prefill values leave n_threads_batch absent", () => {
    for (const value of [0, NaN, 2.5]) {
      const params = baseParams();
      applyPrefillThreadOverride(params, value);
      assert(
        !("n_threads_batch" in params),
        `invalid prefill ${value} must omit batch field`,
      );
    }
  });

  await test("absent prefill override leaves params unchanged", () => {
    const params = baseParams();
    const before = JSON.stringify(params);
    applyPrefillThreadOverride(params, undefined);
    assert(JSON.stringify(params) === before, "production-shaped params changed");
  });

  // ── ubatch clamp at 512 ────────────────────────────────────────────────
  await test("ubatch clamped to n_batch (512)", () => {
    const params = baseParams();
    applyEngineOverride(params, { nUbatch: 9999 }, "ios");
    assert(params.n_ubatch === 512, `got ${params.n_ubatch}`);
  });

  // ── ubatch below cap passes through ────────────────────────────────────
  await test("ubatch below cap passes through", () => {
    const params = baseParams();
    applyEngineOverride(params, { nUbatch: 128 }, "ios");
    assert(params.n_ubatch === 128, `got ${params.n_ubatch}`);
  });

  // ── n_batch missing falls back to 512 for clamp ────────────────────────
  await test("ubatch clamp uses 512 when n_batch absent", () => {
    const params = { n_ubatch: 256, n_threads: 4, n_gpu_layers: 0 };
    applyEngineOverride(params, { nUbatch: 2048 }, "ios");
    assert(params.n_ubatch === 512, `got ${params.n_ubatch}`);
  });

  // ── absent fields leave params untouched ───────────────────────────────
  await test("absent fields leave params untouched", () => {
    const params = baseParams();
    const before = { ...params };
    applyEngineOverride(params, { nThreads: 5 }, "ios");
    assert(params.n_threads === 5, "threads set");
    assert(params.n_gpu_layers === before.n_gpu_layers, "gpu untouched");
    assert(params.n_ubatch === before.n_ubatch, "ubatch untouched");
    assert(params.n_batch === before.n_batch, "batch untouched");
  });

  // ── empty / undefined / null override is a no-op ───────────────────────
  await test("empty override is a no-op", () => {
    const params = baseParams();
    const before = { ...params };
    applyEngineOverride(params, {}, "ios");
    assert(JSON.stringify(params) === JSON.stringify(before), "empty object");
    applyEngineOverride(params, undefined, "ios");
    assert(JSON.stringify(params) === JSON.stringify(before), "undefined");
    applyEngineOverride(params, null, "android");
    assert(JSON.stringify(params) === JSON.stringify(before), "null");
  });

  // ── multi-field non-android ────────────────────────────────────────────
  await test("ios multi-field: all applied with ubatch clamp", () => {
    const params = baseParams();
    applyEngineOverride(
      params,
      { nGpuLayers: 40, nThreads: 6, nUbatch: 1024 },
      "ios",
    );
    assert(params.n_gpu_layers === 40, `gpu ${params.n_gpu_layers}`);
    assert(params.n_threads === 6, `threads ${params.n_threads}`);
    assert(params.n_ubatch === 512, `ubatch ${params.n_ubatch}`);
  });

  // ── android multi-field: gpu skipped, others apply ─────────────────────
  await test("android multi-field: gpu skipped, threads+ubatch apply", () => {
    const params = baseParams();
    const orig = console.warn;
    console.warn = () => {};
    try {
      applyEngineOverride(
        params,
        { nGpuLayers: 99, nThreads: 5, nUbatch: 200 },
        "android",
      );
    } finally {
      console.warn = orig;
    }
    assert(params.n_gpu_layers === 0, `gpu must stay 0, got ${params.n_gpu_layers}`);
    assert(params.n_threads === 5, `threads ${params.n_threads}`);
    assert(params.n_ubatch === 200, `ubatch ${params.n_ubatch}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All engineParams harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
