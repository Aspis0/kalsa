/**
 * Harness for src/engine/deviceProfile.ts
 * (pure deviceFamilyForBrand + isFoldableModelName + modelGateVerdict).
 *
 * Compile-from-disk pattern (same as threadProfileHarness). Exit 1 on fail.
 * Does NOT wire into CI workflows (another agent owns that).
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
  // Compile deviceProfile + its pure deps (contextProfile, memoryEstimate,
  // threadProfile). memoryEstimate/threadProfile are pure; contextProfile
  // has a guarded require("expo-device") that never runs in these pure tests.
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/deviceProfile.ts",
      "src/engine/contextProfile.ts",
      "src/engine/memoryEstimate.ts",
      "src/engine/threadProfile.ts",
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
    path.join(projectRoot, "scripts/.build/deviceProfile.js"),
    path.join(projectRoot, "scripts/.build/engine/deviceProfile.js"),
    path.join(projectRoot, "scripts/.build/src/engine/deviceProfile.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(
    "Could not find compiled deviceProfile.js. Tried:\n",
    candidates.join("\n"),
  );
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling deviceProfile.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = require(modPath);
  const {
    deviceFamilyForBrand,
    isFoldableModelName,
    modelGateVerdict,
    estimateModelNonEvictableMiB,
    DOWNLOAD_DISK_MARGIN,
    __resetDeviceProfileCacheForTests,
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

  // --- deviceFamilyForBrand ---

  await test("deviceFamilyForBrand xiaomi → xiaomi", () => {
    assert(deviceFamilyForBrand("xiaomi") === "xiaomi", "xiaomi");
  });
  await test("deviceFamilyForBrand redmi → xiaomi", () => {
    assert(deviceFamilyForBrand("redmi") === "xiaomi", "redmi");
  });
  await test("deviceFamilyForBrand poco → xiaomi", () => {
    assert(deviceFamilyForBrand("POCO") === "xiaomi", "POCO");
  });
  await test("deviceFamilyForBrand samsung → samsung", () => {
    assert(deviceFamilyForBrand("samsung") === "samsung", "samsung");
  });
  await test("deviceFamilyForBrand google → pixel", () => {
    assert(deviceFamilyForBrand("google") === "pixel", "google");
  });
  await test("deviceFamilyForBrand random → generic", () => {
    assert(deviceFamilyForBrand("oneplus") === "generic", "oneplus");
  });
  await test("deviceFamilyForBrand undefined → generic", () => {
    assert(deviceFamilyForBrand(undefined) === "generic", "undefined");
    assert(deviceFamilyForBrand(null) === "generic", "null");
    assert(deviceFamilyForBrand("") === "generic", "empty");
  });

  // --- isFoldableModelName ---

  await test("isFoldableModelName SM-F731B → true", () => {
    assert(isFoldableModelName("SM-F731B", null) === true, "SM-F731B");
  });
  await test("isFoldableModelName SM-S911U → false", () => {
    assert(isFoldableModelName("SM-S911U", "Galaxy S23") === false, "SM-S911U");
  });
  await test("isFoldableModelName null/empty → false", () => {
    assert(isFoldableModelName(null, null) === false, "null");
    assert(isFoldableModelName("", "") === false, "empty");
    assert(isFoldableModelName(undefined, undefined) === false, "undefined");
  });
  await test("isFoldableModelName sm-f720 lowercase → true", () => {
    assert(isFoldableModelName("sm-f720b", null) === true, "lowercase sm-f");
    assert(isFoldableModelName(null, "SM-F926B") === true, "name SM-F");
  });

  // --- modelGateVerdict matrix ---

  await test("modelGateVerdict ok (high RAM, enough free)", () => {
    const v = modelGateVerdict({
      totalMemoryBytes: 8_000_000_000,
      availableMemoryBytes: 4_000 * 1024 * 1024,
      freeDiskBytes: 10_000_000_000,
      ramTier: "high",
      modelMinRamTier: "high",
      modelNonEvictableMiB: 2000,
      modelSizeBytes: 3_000_000_000,
    });
    assert(v.allowed === true, `allowed=${v.allowed}`);
    assert(v.reason === "ok", `reason=${v.reason}`);
  });

  await test("modelGateVerdict blocked_tier (low device, high model)", () => {
    const v = modelGateVerdict({
      totalMemoryBytes: 3_000_000_000,
      availableMemoryBytes: 2_000 * 1024 * 1024,
      freeDiskBytes: 10_000_000_000,
      ramTier: "low",
      modelMinRamTier: "high",
      modelNonEvictableMiB: 1000,
      modelSizeBytes: 1_000_000_000,
    });
    assert(v.allowed === false, `allowed=${v.allowed}`);
    assert(v.reason === "blocked_tier", `reason=${v.reason}`);
  });

  await test("modelGateVerdict blocked_ram (nonEvictable > available)", () => {
    const v = modelGateVerdict({
      totalMemoryBytes: 8_000_000_000,
      availableMemoryBytes: 1_000 * 1024 * 1024, // 1000 MiB free
      freeDiskBytes: 10_000_000_000,
      ramTier: "high",
      modelMinRamTier: "mid",
      modelNonEvictableMiB: 2500, // > 1000
      modelSizeBytes: 1_000_000_000,
    });
    assert(v.allowed === false, `allowed=${v.allowed}`);
    assert(v.reason === "blocked_ram", `reason=${v.reason}`);
  });

  await test("modelGateVerdict blocked_disk (size > free)", () => {
    const v = modelGateVerdict({
      totalMemoryBytes: 8_000_000_000,
      availableMemoryBytes: 4_000 * 1024 * 1024,
      freeDiskBytes: 500_000_000, // 500 MB free
      ramTier: "high",
      modelMinRamTier: "mid",
      modelNonEvictableMiB: 1000,
      modelSizeBytes: 3_000_000_000, // 3 GB needed
    });
    assert(v.allowed === false, `allowed=${v.allowed}`);
    assert(v.reason === "blocked_disk", `reason=${v.reason}`);
  });

  await test("modelGateVerdict unknown (all memory null → allowed unknown)", () => {
    const v = modelGateVerdict({
      totalMemoryBytes: null,
      availableMemoryBytes: null,
      freeDiskBytes: null,
      ramTier: "low", // getRamTier(null) is low; no modelMinRamTier → no tier block
      modelNonEvictableMiB: null,
      modelSizeBytes: 1_000_000_000,
    });
    assert(v.allowed === true, `allowed=${v.allowed}`);
    assert(v.reason === "unknown", `reason=${v.reason}`);
  });

  // --- estimate helper smoke ---
  await test("estimateModelNonEvictableMiB returns finite > 0 for 2B-ish", () => {
    const n = estimateModelNonEvictableMiB({
      sizeBytes: 1_280_835_840,
      engineCtx: 16384,
      kvBytesPerToken: Math.round(4.88 * 1024),
    });
    assert(typeof n === "number" && Number.isFinite(n) && n > 0, `got ${n}`);
  });

  await test("DOWNLOAD_DISK_MARGIN ≥ 1.1", () => {
    assert(
      typeof DOWNLOAD_DISK_MARGIN === "number" && DOWNLOAD_DISK_MARGIN >= 1.1,
      `margin=${DOWNLOAD_DISK_MARGIN}`,
    );
  });

  await test("__resetDeviceProfileCacheForTests is a function", () => {
    assert(typeof __resetDeviceProfileCacheForTests === "function", "reset");
    __resetDeviceProfileCacheForTests();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
