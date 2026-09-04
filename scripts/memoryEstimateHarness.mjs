/**
 * Harness for src/engine/memoryEstimate.ts (pure peak-memory arithmetic).
 *
 * Anchors against on-device /proc/<pid>/status measurements (Qwen3.5 Q4_K_M,
 * ub=256, ctk q8_0, ctv q4_0). Compile-from-disk pattern (same as
 * engineParamsHarness). Exit 1 on fail.
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
      "src/engine/memoryEstimate.ts",
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
    path.join(projectRoot, "scripts/.build/memoryEstimate.js"),
    path.join(projectRoot, "scripts/.build/engine/memoryEstimate.js"),
    path.join(projectRoot, "scripts/.build/src/engine/memoryEstimate.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled memoryEstimate.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertFiniteNonNeg(n, label) {
  assert(typeof n === "number", `${label} is not a number`);
  assert(Number.isFinite(n), `${label} is not finite: ${n}`);
  assert(n >= 0, `${label} is negative: ${n}`);
}

function withinPct(actual, target, pct) {
  return Math.abs(actual - target) <= target * pct;
}

async function main() {
  console.log("Compiling memoryEstimate.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = require(modPath);
  const {
    estimateMemory,
    fitMemoryEstimate,
    parseMemAvailableBytes,
    COMPUTE_MIB_AT_UBATCH_256,
    FIT_HEADROOM_MIB,
    __resetAvailableMemoryCacheForTests,
  } = mod;

  let passed = 0;
  let failed = 0;
  async function test(name, fn) {
    try {
      await fn();
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(`  FAIL ${name}: ${err.message ?? err}`);
      failed += 1;
    }
  }

  // --- regression anchors (phone measurements) ---

  await test("2B anchor: non-evictable within ±10% of 1333 MiB", () => {
    const est = estimateMemory({
      fileBytes: 1_269_873_920,
      contextTokens: 16384,
      kvBytesPerToken: 4.88 * 1024,
      ubatch: 256,
      repack: true,
    });
    assertFiniteNonNeg(est.nonEvictableMiB, "nonEvictableMiB");
    assert(
      withinPct(est.nonEvictableMiB, 1333, 0.1),
      `2B nonEvictable ${est.nonEvictableMiB.toFixed(1)} MiB not within ±10% of 1333`,
    );
    assert(est.repackMiB > 0, "repack should be on");
    assert(withinPct(est.computeMiB, COMPUTE_MIB_AT_UBATCH_256, 0.01), "compute@256");
  });

  await test("4B anchor: non-evictable within ±10% of 2848 MiB", () => {
    // KV cost for 4B is unknown (registry leaves it undefined) → pass 0.
    const est = estimateMemory({
      fileBytes: 2_834_975_040,
      contextTokens: 8192,
      kvBytesPerToken: 0,
      ubatch: 256,
      repack: true,
    });
    assertFiniteNonNeg(est.nonEvictableMiB, "nonEvictableMiB");
    assert(
      withinPct(est.nonEvictableMiB, 2848, 0.1),
      `4B nonEvictable ${est.nonEvictableMiB.toFixed(1)} MiB not within ±10% of 2848`,
    );
  });

  // --- term behaviour ---

  await test("repack off → repack term is 0", () => {
    const on = estimateMemory({
      fileBytes: 1_269_873_920,
      contextTokens: 1024,
      kvBytesPerToken: 4.88 * 1024,
      ubatch: 256,
      repack: true,
    });
    const off = estimateMemory({
      fileBytes: 1_269_873_920,
      contextTokens: 1024,
      kvBytesPerToken: 4.88 * 1024,
      ubatch: 256,
      repack: false,
    });
    assert(off.repackMiB === 0, `repack off gave ${off.repackMiB}`);
    assert(on.repackMiB > 0, "repack on should be positive");
    assert(
      withinPct(off.nonEvictableMiB, on.nonEvictableMiB - on.repackMiB, 0.001),
      "non-evictable should drop by exactly the repack term",
    );
  });

  // 4B GGUF ≈ 2.82 GB file; REPACK_FRACTION ≈ 0.895 → repack term ≈ 2.4–2.5 GiB.
  // This case exercises estimateMemory({ repack: false }) directly — the term
  // that no_extra_bufts removes at engine load. UI gates always estimate with
  // repack:true (conservative); they do not take a repack parameter.
  await test("4B repack-off drops non-evictable by ~2.5 GB", () => {
    const fileBytes = 2_834_975_040; // 4B Q4_K_M anchor
    const on = estimateMemory({
      fileBytes,
      contextTokens: 8192,
      kvBytesPerToken: 0,
      ubatch: 256,
      repack: true,
    });
    const off = estimateMemory({
      fileBytes,
      contextTokens: 8192,
      kvBytesPerToken: 0,
      ubatch: 256,
      repack: false,
    });
    assert(off.repackMiB === 0, `4B repack off gave ${off.repackMiB}`);
    const drop = on.nonEvictableMiB - off.nonEvictableMiB;
    assert(
      drop >= 2300 && drop <= 2700,
      `4B repack drop ${drop.toFixed(1)} MiB not in 2300–2700 (~2.5 GB)`,
    );
    assert(
      withinPct(drop, on.repackMiB, 0.001),
      "drop must equal the repack term",
    );
  });

  await test("ubatch 128 → compute term halves vs 256", () => {
    const u256 = estimateMemory({
      fileBytes: 1_000_000,
      contextTokens: 0,
      kvBytesPerToken: 0,
      ubatch: 256,
      repack: false,
    });
    const u128 = estimateMemory({
      fileBytes: 1_000_000,
      contextTokens: 0,
      kvBytesPerToken: 0,
      ubatch: 128,
      repack: false,
    });
    assert(withinPct(u256.computeMiB, 249, 0.01), `compute@256=${u256.computeMiB}`);
    assert(withinPct(u128.computeMiB, 249 / 2, 0.01), `compute@128=${u128.computeMiB}`);
    assert(withinPct(u128.computeMiB * 2, u256.computeMiB, 0.001), "128 should be half of 256");
  });

  await test("KV scales linearly with context", () => {
    const a = estimateMemory({
      fileBytes: 0,
      contextTokens: 1000,
      kvBytesPerToken: 1024, // 1 KiB/tok → 1000 KiB = 1000/1024 MiB
      ubatch: 0,
      repack: false,
    });
    const b = estimateMemory({
      fileBytes: 0,
      contextTokens: 2000,
      kvBytesPerToken: 1024,
      ubatch: 0,
      repack: false,
    });
    assert(withinPct(a.kvMiB, 1000 / 1024, 0.001), `kv@1000=${a.kvMiB}`);
    assert(withinPct(b.kvMiB, a.kvMiB * 2, 0.001), "KV should double with ctx");
  });

  // --- malformed inputs ---

  await test("malformed / zero / negative inputs → no NaN, no negative, no throw", () => {
    const cases = [
      {},
      { fileBytes: -1, contextTokens: -5, kvBytesPerToken: -3, ubatch: -10, repack: true },
      { fileBytes: NaN, contextTokens: Infinity, kvBytesPerToken: NaN, ubatch: -0, repack: false },
      { fileBytes: 0, contextTokens: 0, kvBytesPerToken: 0, ubatch: 0, repack: false },
      null,
      undefined,
    ];
    for (const c of cases) {
      const est = estimateMemory(c ?? {});
      for (const [k, v] of Object.entries(est)) {
        assertFiniteNonNeg(v, `${JSON.stringify(c)} → ${k}`);
      }
    }
  });

  // --- parseMemAvailable ---

  await test("parseMemAvailableBytes reads MemAvailable kB", () => {
    const text = [
      "MemTotal:        8000000 kB",
      "MemFree:          100000 kB",
      "MemAvailable:     3145728 kB",
      "Buffers:           50000 kB",
    ].join("\n");
    const bytes = parseMemAvailableBytes(text);
    assert(bytes === 3145728 * 1024, `got ${bytes}`);
  });

  await test("parseMemAvailableBytes rejects missing / malformed", () => {
    assert(parseMemAvailableBytes("") === null, "empty");
    assert(parseMemAvailableBytes("MemTotal: 1 kB\n") === null, "no MemAvailable");
    assert(parseMemAvailableBytes(null) === null, "null");
    assert(parseMemAvailableBytes("MemAvailable: abc kB\n") === null, "non-numeric");
  });

  // --- fit verdicts ---

  await test("fit: unknown when available is null", () => {
    const est = estimateMemory({
      fileBytes: 1_269_873_920,
      contextTokens: 16384,
      kvBytesPerToken: 4.88 * 1024,
      ubatch: 256,
      repack: true,
    });
    const v = fitMemoryEstimate(est, null);
    assert(v.status === "unknown", `status=${v.status}`);
    assert(v.availableMiB === null, "availableMiB");
  });

  await test("fit: does_not_fit when non-evictable exceeds available", () => {
    const est = estimateMemory({
      fileBytes: 2_834_975_040,
      contextTokens: 8192,
      kvBytesPerToken: 0,
      ubatch: 256,
      repack: true,
    });
    const v = fitMemoryEstimate(est, est.nonEvictableMiB - 1);
    assert(v.status === "does_not_fit", `status=${v.status}`);
  });

  await test("fit: tight when within headroom band", () => {
    const est = estimateMemory({
      fileBytes: 1_269_873_920,
      contextTokens: 16384,
      kvBytesPerToken: 4.88 * 1024,
      ubatch: 256,
      repack: true,
    });
    // available just above non-evictable but inside headroom → tight
    const v = fitMemoryEstimate(est, est.nonEvictableMiB + FIT_HEADROOM_MIB / 2);
    assert(v.status === "tight", `status=${v.status} reason=${v.reason}`);
  });

  await test("fit: fits when available covers non-evictable + headroom + total", () => {
    const est = estimateMemory({
      fileBytes: 1_269_873_920,
      contextTokens: 16384,
      kvBytesPerToken: 4.88 * 1024,
      ubatch: 256,
      repack: true,
    });
    const need = Math.max(est.nonEvictableMiB + FIT_HEADROOM_MIB, est.totalMiB) + 1;
    const v = fitMemoryEstimate(est, need);
    assert(v.status === "fits", `status=${v.status} reason=${v.reason}`);
  });

  await test("cache reset helper exists", () => {
    assert(typeof __resetAvailableMemoryCacheForTests === "function", "reset helper");
    __resetAvailableMemoryCacheForTests();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All memoryEstimate harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
