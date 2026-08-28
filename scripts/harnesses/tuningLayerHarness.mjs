/**
 * Harness for src/engine/deviceTuning.ts (pure Device Tuning Layer).
 *
 * Compile-from-disk pattern (same as threadProfileHarness / deviceProfileHarness).
 * Covers design §9 cases 1–10. Exit 1 on fail.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

function compile() {
  // deviceTuning + pure deps (no RN/expo static imports).
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/deviceTuning.ts",
      "src/engine/threadProfile.ts",
      "src/engine/memoryEstimate.ts",
      "src/engine/contextProfile.ts",
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
    path.join(projectRoot, "scripts/.build/deviceTuning.js"),
    path.join(projectRoot, "scripts/.build/engine/deviceTuning.js"),
    path.join(projectRoot, "scripts/.build/src/engine/deviceTuning.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(
    "Could not find compiled deviceTuning.js. Tried:\n",
    candidates.join("\n"),
  );
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Minimal DeviceProfile for harness (only fields the pure path reads). */
function makeProfile(overrides = {}) {
  return {
    brand: null,
    manufacturer: null,
    modelName: null,
    modelId: null,
    totalMemoryBytes: null,
    availableMemoryBytes: null,
    osName: null,
    osVersion: null,
    cpuCoreCount: null,
    ramTier: "low",
    family: "generic",
    isMiuiFamily: false,
    isFoldableCandidate: false,
    isTablet: false,
    ...overrides,
  };
}

/** Minimal ModelInfo for harness. */
function makeModel(overrides = {}) {
  return {
    id: "qwen3.5-2b",
    name: "Qwen 3.5 2B",
    vendor: "Alibaba",
    quant: "Q4_K_M",
    hfRepo: "test",
    revision: "test",
    file: "test.gguf",
    sizeBytes: 1_211_000_000,
    contextLength: 262144,
    engineCtx: 8192,
    kvCache: { k: "q8_0", v: "q4_0" },
    hybrid: true,
    kvBytesPerToken: 5000, // ~4.88 KiB measured for 2B
    descriptionKey: "models.qwen2b.description",
    ...overrides,
  };
}

async function main() {
  console.log("Compiling deviceTuning.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = require(modPath);
  const {
    matchMeasuredPreset,
    resolveBackendPolicy,
    resolveEngineTuningSync,
    resolveEngineTuning,
    nGpuLayersForBackend,
    MEASURED_PRESETS,
  } = mod;

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  OK  ${name}`);
      passed += 1;
    } catch (err) {
      console.error(
        `  FAIL ${name}: ${err instanceof Error ? err.message : err}`,
      );
      failed += 1;
    }
  }

  // Design §9 case 1: Helio G99 synthetic → preset, decode 2 / prefill 8.
  await test("1. helio-g99 capacity signature → soc-preset, 2/8 threads", () => {
    const profile = makeProfile({
      brand: "unihertz",
      cpuCoreCount: 8,
    });
    const caps = [348, 348, 348, 348, 348, 348, 1024, 1024];
    const preset = matchMeasuredPreset(profile, caps);
    assert(preset != null, "preset null");
    assert(preset.id === "helio-g99", `id ${preset.id}`);
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      cpuCapacities: caps,
      request: {},
      platformHint: "android",
    });
    assert(r.n_threads === 2, `decode threads ${r.n_threads}`);
    assert(r.n_threads_prefill === 8, `prefill ${r.n_threads_prefill}`);
    assert(
      r.nThreadsSource === "soc-preset:helio-g99",
      `source ${r.nThreadsSource}`,
    );
  });

  await test("1b. helio-g99 exact capacity signature (unordered) → soc-preset", () => {
    const profile = makeProfile({
      brand: "unihertz",
      modelName: "Jelly Star",
      cpuCoreCount: 8,
    });
    // Unordered multiset of the G99 signature must still match.
    const caps = [1024, 348, 348, 1024, 348, 348, 348, 348];
    const preset = matchMeasuredPreset(profile, caps);
    assert(preset != null && preset.id === "helio-g99", `preset ${preset?.id}`);
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      cpuCapacities: caps,
      request: {},
      platformHint: "android",
    });
    assert(r.n_threads === 2, `threads ${r.n_threads}`);
    assert(r.nThreadsSource === "soc-preset:helio-g99", r.nThreadsSource);
  });

  await test("1c. Jelly Max / Dimensity-like signature + unihertz → NOT soc-preset", () => {
    // Dimensity-7300-like: 6 mid @448 + 2 big @1024 (differs from G99 6×348+2×1024).
    const profile = makeProfile({
      brand: "unihertz",
      modelName: "Jelly Max",
      cpuCoreCount: 8,
    });
    const caps = [448, 448, 448, 448, 448, 448, 1024, 1024];
    const preset = matchMeasuredPreset(profile, caps);
    assert(preset === null, `unexpected preset ${preset?.id}`);
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      cpuCapacities: caps,
      request: {},
      platformHint: "android",
    });
    assert(
      !String(r.nThreadsSource).startsWith("soc-preset"),
      `source must not be soc-preset: ${r.nThreadsSource}`,
    );
  });

  await test("1d. brand-only unihertz 8-core WITHOUT caps → NOT soc-preset", () => {
    const profile = makeProfile({ brand: "unihertz", cpuCoreCount: 8 });
    const preset = matchMeasuredPreset(profile, null);
    assert(preset === null, `brand-only must not match: ${preset?.id}`);
  });

  await test("1e. exact model identity jelly star without caps → helio-g99", () => {
    const profile = makeProfile({
      brand: "unihertz",
      modelName: "Jelly Star",
      cpuCoreCount: 8,
    });
    const preset = matchMeasuredPreset(profile, null);
    assert(preset != null && preset.id === "helio-g99", `preset ${preset?.id}`);
  });

  await test("1f. Jelly Max + unihertz without caps → NOT helio-g99", () => {
    const profile = makeProfile({
      brand: "unihertz",
      modelName: "Jelly Max",
      cpuCoreCount: 8,
    });
    const preset = matchMeasuredPreset(profile, null);
    assert(preset === null, `Jelly Max must not match identity: ${preset?.id}`);
  });

  await test("1g. Jelly Star + brand google → NOT helio-g99 (brand required)", () => {
    const profile = makeProfile({
      brand: "google",
      modelName: "Jelly Star",
      cpuCoreCount: 8,
    });
    const preset = matchMeasuredPreset(profile, null);
    assert(preset === null, `brand google must not match: ${preset?.id}`);
  });

  // Design §9 case 2: SD 8 Gen 2 → 5 threads.
  await test("2. sd-8-gen2 signature → 5 threads, soc-preset", () => {
    const profile = makeProfile({ brand: "samsung", cpuCoreCount: 8 });
    const caps = [266, 266, 266, 811, 811, 811, 811, 1024];
    const preset = matchMeasuredPreset(profile, caps);
    assert(preset != null && preset.id === "sd-8-gen2", `id ${preset?.id}`);
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      cpuCapacities: caps,
      request: {},
      platformHint: "android",
    });
    assert(r.n_threads === 5, `threads ${r.n_threads}`);
    assert(r.nThreadsSource === "soc-preset:sd-8-gen2", r.nThreadsSource);
  });

  // Design §9 case 3: SD 8 Gen 3 → 6 threads.
  await test("3. sd-8-gen3 signature → 6 threads, soc-preset", () => {
    const profile = makeProfile({ brand: "xiaomi", cpuCoreCount: 8 });
    const caps = [1024, 980, 980, 980, 940, 940, 320, 320];
    const preset = matchMeasuredPreset(profile, caps);
    assert(preset != null && preset.id === "sd-8-gen3", `id ${preset?.id}`);
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      cpuCapacities: caps,
      request: {},
      platformHint: "android",
    });
    assert(r.n_threads === 6, `threads ${r.n_threads}`);
    assert(r.nThreadsSource === "soc-preset:sd-8-gen3", r.nThreadsSource);
  });

  // Design §9 case 4: unknown 8-core → fallback 4 (never invents).
  await test("4. unknown 8-core generic → fallback 4", () => {
    const profile = makeProfile({ brand: "generic-oem", cpuCoreCount: 8 });
    const preset = matchMeasuredPreset(profile, null);
    assert(preset === null, `unexpected preset ${preset?.id}`);
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      request: {},
      platformHint: "android",
      // No capacities, no resolvedThreads → pure fallback.
    });
    assert(r.n_threads === 4, `threads ${r.n_threads}`);
    assert(
      r.nThreadsSource === "fallback",
      `source ${r.nThreadsSource} (never invents)`,
    );
  });

  // Design §9 case 5: Apple → 4 + metal backend.
  await test("5. apple / ios → 4 threads + gpu-metal", () => {
    const profile = makeProfile({
      brand: "apple",
      osName: "iOS",
      cpuCoreCount: 6,
    });
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      request: {},
      platformHint: "ios",
    });
    assert(r.n_threads === 4, `threads ${r.n_threads}`);
    assert(
      r.nThreadsSource === "family:apple" ||
        r.nThreadsSource === "soc-preset:apple",
      `source ${r.nThreadsSource}`,
    );
    assert(r.backend.kind === "gpu-metal", `backend ${r.backend.kind}`);
    assert(r.backend.reason === "apple", `reason ${r.backend.reason}`);
    assert(nGpuLayersForBackend(r.backend) === 99, "n_gpu_layers metal");
  });

  // Design §9 case 6: ctx budget tight → n_ctx reduced, floor 2048.
  await test("6. ctx budget: tight availableMiB → n_ctx reduced, floor 2048", () => {
    // Large model + high kv cost + small available → force shrink.
    const model = makeModel({
      id: "qwen3.5-4b",
      sizeBytes: 2_834_975_040,
      engineCtx: 16384,
      contextLength: 262144,
      // High per-token cost so 16k clearly does not fit.
      kvBytesPerToken: 32_000,
    });
    // ~1.5 GiB available — weights+repack alone ~5 GiB would not fit, but
    // non-evictable still includes repack. Use enough available that floor
    // may fit but 16k does not (repack dominates; still test clamp path).
    // With repack on, nonEvictable at any ctx is huge. Use a tiny model so
    // only KV drives the clamp:
    const tiny = makeModel({
      sizeBytes: 50_000_000, // ~48 MiB weights
      engineCtx: 16384,
      contextLength: 262144,
      kvBytesPerToken: 16_000, // 16k tokens ≈ 256 MiB KV
    });
    // available 200 MiB: floor@2048 ≈ 32 MiB KV + small repack/compute fits;
    // 16384 ≈ 256 MiB KV alone does not.
    const profile = makeProfile({
      brand: "generic",
      cpuCoreCount: 8,
      availableMemoryBytes: 200 * 1024 * 1024,
    });
    const r = resolveEngineTuningSync({
      model: tiny,
      profile,
      request: { contextBudget: 16384 },
      platformHint: "android",
      resolvedThreads: 4,
      resolvedThreadsSource: "fallback:capacity-missing",
    });
    assert(r.context.n_ctx < 16384, `n_ctx not reduced: ${r.context.n_ctx}`);
    assert(r.context.n_ctx >= 2048, `below floor: ${r.context.n_ctx}`);
    assert(
      r.context.ctxSource === "memory-budget" ||
        r.context.ctxSource === "floor:2048",
      `ctxSource ${r.context.ctxSource}`,
    );
    assert(r.memory.availableMiB !== null, "availableMiB null");
  });

  await test("6b. ctx never below floor 2048 even when floor is tight", () => {
    const model = makeModel({
      sizeBytes: 50_000_000,
      engineCtx: 16384,
      kvBytesPerToken: 100_000, // even 2048 is large
    });
    const profile = makeProfile({
      availableMemoryBytes: 10 * 1024 * 1024, // 10 MiB — nothing fits
    });
    const r = resolveEngineTuningSync({
      model,
      profile,
      request: { contextBudget: 16384 },
      platformHint: "android",
      resolvedThreads: 4,
    });
    assert(r.context.n_ctx === 2048, `floor violated: ${r.context.n_ctx}`);
  });

  // Design §9 case 7: kv quant q8_0/q4_0 on android cpu-only.
  await test("7. kv quant q8_0/q4_0 on android cpu-only", () => {
    const profile = makeProfile({ brand: "xiaomi", cpuCoreCount: 8 });
    const r = resolveEngineTuningSync({
      model: makeModel({ kvCache: { k: "q8_0", v: "q4_0" } }),
      profile,
      request: {},
      platformHint: "android",
      resolvedThreads: 4,
    });
    assert(r.backend.kind === "cpu-only", r.backend.kind);
    assert(r.kv.type_k === "q8_0", `k ${r.kv.type_k}`);
    assert(r.kv.type_v === "q4_0", `v ${r.kv.type_v}`);
    assert(r.kvSource === "measured:kv-defaults", r.kvSource);
    assert(nGpuLayersForBackend(r.backend) === 0, "n_gpu_layers android");
  });

  // Design §9 case 8: provenance non-empty on every path.
  await test("8. provenance non-empty on every path", () => {
    const cases = [
      {
        profile: makeProfile({ brand: "unihertz", cpuCoreCount: 8 }),
        caps: [348, 348, 348, 348, 348, 348, 1024, 1024],
        platformHint: "android",
      },
      {
        profile: makeProfile({ brand: "apple", osName: "iOS" }),
        caps: null,
        platformHint: "ios",
      },
      {
        profile: makeProfile({ brand: "generic", cpuCoreCount: 8 }),
        caps: null,
        platformHint: "android",
      },
      {
        profile: makeProfile({ brand: "samsung", cpuCoreCount: 8 }),
        caps: [266, 266, 266, 811, 811, 811, 811, 1024],
        platformHint: "android",
      },
    ];
    for (const c of cases) {
      const r = resolveEngineTuningSync({
        model: makeModel(),
        profile: c.profile,
        cpuCapacities: c.caps,
        request: {},
        platformHint: c.platformHint,
      });
      assert(
        typeof r.nThreadsSource === "string" && r.nThreadsSource.length > 0,
        "nThreadsSource empty",
      );
      assert(
        typeof r.ubatchSource === "string" && r.ubatchSource.length > 0,
        "ubatchSource empty",
      );
      assert(
        typeof r.kvSource === "string" && r.kvSource.length > 0,
        "kvSource empty",
      );
      assert(
        typeof r.context.ctxSource === "string" && r.context.ctxSource.length > 0,
        "ctxSource empty",
      );
      assert(
        typeof r.backend.reason === "string" && r.backend.reason.length > 0,
        "backend.reason empty",
      );
      assert(
        typeof r.thermal.guardSource === "string" &&
          r.thermal.guardSource.length > 0,
        "thermal.guardSource empty",
      );
    }
  });

  // Design §9 case 9: ubatch override honored.
  await test("9. ubatch override honored (override:user)", () => {
    const profile = makeProfile({ brand: "xiaomi", cpuCoreCount: 8 });
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      request: { ubatchOverride: 128 },
      platformHint: "android",
      resolvedThreads: 5,
      resolvedThreadsSource: "capacity",
    });
    assert(r.n_ubatch === 128, `ubatch ${r.n_ubatch}`);
    assert(r.ubatchSource === "override:user", r.ubatchSource);
  });

  // Design §9 case 10: availableMemory null → fit "unknown", no throw.
  await test("10. availableMemory null → fit unknown, params resolve", () => {
    const profile = makeProfile({
      brand: "generic",
      cpuCoreCount: 8,
      availableMemoryBytes: null,
    });
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      request: { contextBudget: 8192 },
      platformHint: "android",
      resolvedThreads: 4,
    });
    assert(r.memory.fit === "unknown", `fit ${r.memory.fit}`);
    assert(r.memory.availableMiB === null, "availableMiB not null");
    assert(r.context.n_ctx === 8192, `n_ctx ${r.context.n_ctx}`);
    assert(typeof r.n_threads === "number" && r.n_threads > 0, "threads");
    assert(typeof r.n_ubatch === "number" && r.n_ubatch > 0, "ubatch");
  });

  // Extra: matchMeasuredPreset null for unknown; resolveBackendPolicy android.
  await test("matchMeasuredPreset null for unknown device", () => {
    const profile = makeProfile({ brand: "oneplus", cpuCoreCount: 8 });
    assert(matchMeasuredPreset(profile, null) === null, "brand-only hit");
    assert(
      matchMeasuredPreset(profile, [100, 100, 100, 100, 100, 100, 100, 100]) ===
        null,
      "unknown caps hit",
    );
  });

  await test("resolveBackendPolicy android → cpu-only + hexagon reason", () => {
    const profile = makeProfile({ brand: "xiaomi", osName: "Android" });
    const b = resolveBackendPolicy(profile, "android");
    assert(b.kind === "cpu-only", `kind ${b.kind}`);
    assert(
      typeof b.reason === "string" && b.reason.includes("hexagon"),
      `reason ${b.reason}`,
    );
  });

  await test("resolveBackendPolicy emulator → no-accel", () => {
    const profile = makeProfile({ modelName: "Android SDK built for x86" });
    const b = resolveBackendPolicy(profile, "emulator");
    assert(b.kind === "emulator", b.kind);
    assert(b.reason === "no-accel", b.reason);
  });

  await test("threads override wins over soc-preset", () => {
    const profile = makeProfile({ brand: "unihertz", cpuCoreCount: 8 });
    const caps = [348, 348, 348, 348, 348, 348, 1024, 1024];
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      cpuCapacities: caps,
      request: { threadsOverride: 3 },
      platformHint: "android",
    });
    assert(r.n_threads === 3, `threads ${r.n_threads}`);
    assert(r.nThreadsSource === "override:user", r.nThreadsSource);
  });

  await test("MEASURED_PRESETS has the four design §5 entries", () => {
    assert(Array.isArray(MEASURED_PRESETS), "not array");
    const ids = MEASURED_PRESETS.map((p) => p.id).sort();
    assert(
      ids.join(",") === "apple,helio-g99,sd-8-gen2,sd-8-gen3",
      `ids ${ids.join(",")}`,
    );
  });

  await test("async resolveEngineTuning is exported and resolves", async () => {
    assert(typeof resolveEngineTuning === "function", "missing async export");
    // With resolvedThreads supplied, async path should not need RN.
    const r = await resolveEngineTuning({
      model: makeModel(),
      profile: makeProfile({ brand: "generic", cpuCoreCount: 4 }),
      request: {},
      platformHint: "android",
      resolvedThreads: 4,
      resolvedThreadsSource: "fallback:capacity-missing",
    });
    assert(r.n_threads === 4, `async threads ${r.n_threads}`);
  });

  // Production-path: DeviceProfile.cpuCapacities (G99) → measured preset 2/8.
  // Mirrors LlamaService: profile carries capacities; resolveEngineTuning
  // forwards them so prefill 8 is reachable (not equal-to-decode fallback).
  await test("prod-path: profile.cpuCapacities G99 → preset 2/8 + nThreadsPrefill", () => {
    const caps = [348, 348, 348, 348, 348, 348, 1024, 1024];
    const profile = makeProfile({
      brand: "unihertz",
      modelName: "Jelly Star",
      cpuCoreCount: 8,
      cpuCapacities: caps,
    });
    // No explicit cpuCapacities on TuningInput — only profile field (prod shape).
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile,
      request: {},
      platformHint: "android",
    });
    assert(r.n_threads === 2, `decode ${r.n_threads}`);
    assert(r.n_threads_prefill === 8, `prefill snake ${r.n_threads_prefill}`);
    assert(r.nThreadsPrefill === 8, `prefill camel ${r.nThreadsPrefill}`);
    assert(
      r.nThreadsSource === "soc-preset:helio-g99",
      `source ${r.nThreadsSource}`,
    );
  });

  // Production-path WITHOUT capacities → no phantom prefill claim.
  await test("prod-path: profile WITHOUT cpuCapacities → nThreadsPrefill == n_threads", () => {
    const profile = makeProfile({
      brand: "unihertz",
      modelName: "Jelly Star",
      cpuCoreCount: 8,
      cpuCapacities: null,
    });
    // Identity match still hits helio-g99 (Jelly Star brand+name) even without
    // capacities — that is intentional (exact model identity). Use a generic
    // brand so we exercise the true no-preset fallback path.
    const generic = makeProfile({
      brand: "generic-oem",
      cpuCoreCount: 8,
      cpuCapacities: null,
    });
    const r = resolveEngineTuningSync({
      model: makeModel(),
      profile: generic,
      request: {},
      platformHint: "android",
      resolvedThreads: 4,
      resolvedThreadsSource: "fallback:capacity-missing",
    });
    assert(r.n_threads === 4, `decode ${r.n_threads}`);
    assert(
      r.nThreadsPrefill === r.n_threads,
      `prefill ${r.nThreadsPrefill} != decode ${r.n_threads}`,
    );
    assert(
      r.n_threads_prefill === r.n_threads,
      `snake prefill ${r.n_threads_prefill} != decode`,
    );
    assert(
      !String(r.nThreadsSource).startsWith("soc-preset"),
      `must not claim preset: ${r.nThreadsSource}`,
    );
    // Also: brand-only unihertz without capacities and without exact identity
    // must not invent prefill=8 via family path when only resolvedThreads is set.
    const brandOnly = makeProfile({
      brand: "unihertz",
      cpuCoreCount: 8,
      cpuCapacities: null,
    });
    const r2 = resolveEngineTuningSync({
      model: makeModel(),
      profile: brandOnly,
      request: {},
      platformHint: "android",
      resolvedThreads: 2,
      resolvedThreadsSource: "capacity",
    });
    // capacity source with t<=2 maps to family:android-small, but without caps
    // the resolvedThreads path sets prefill == decode (no phantom 8).
    assert(r2.n_threads === 2, `r2 decode ${r2.n_threads}`);
    assert(
      r2.nThreadsPrefill === r2.n_threads,
      `r2 phantom prefill: ${r2.nThreadsPrefill} vs ${r2.n_threads}`,
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All tuningLayer harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
