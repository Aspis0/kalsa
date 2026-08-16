/**
 * Harness for src/engine/deviceProfile.ts
 * (pure deviceFamilyForBrand + isFoldableModelName + modelGateVerdict,
 * real getRamTier fixtures, and the real blocked download path).
 *
 * Compile-from-disk pattern (same as threadProfileHarness). Exit 1 on fail.
 * Does NOT wire into CI workflows (another agent owns that).
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import Module from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

function compile() {
  // Compile deviceProfile and its pure deps plus the registry/downloader used
  // by the real blocked-download assertion. Native modules are stubbed only
  // while the compiled downloader is loaded below.
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/deviceProfile.ts",
      "src/engine/contextProfile.ts",
      "src/engine/memoryEstimate.ts",
      "src/engine/threadProfile.ts",
      "src/engine/ModelRegistry.ts",
      "src/engine/ModelDownloader.ts",
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
    diskRequirementBytes,
    __resetDeviceProfileCacheForTests,
  } = mod;

  const contextProfilePath = path.join(projectRoot, "scripts/.build/engine/contextProfile.js");
  const { getRamTier, resolveContextProfile } = require(contextProfilePath);
  const modelRegistryPath = path.join(projectRoot, "scripts/.build/engine/ModelRegistry.js");
  const { MODEL_REGISTRY } = require(modelRegistryPath);
  const qwen4b = MODEL_REGISTRY.find((entry) => entry.id === "qwen3.5-4b");
  const qwen4bQ3 = MODEL_REGISTRY.find((entry) => entry.id === "qwen3.5-4b-q3");
  assert(qwen4b, "qwen3.5-4b missing from registry");
  assert(qwen4bQ3, "qwen3.5-4b-q3 missing from registry");

  // Load the real downloader with native modules stubbed only at the boundary.
  // The blocked case must return before its internal downloadFile is reached.
  let downloadCalls = 0;
  const originalModuleLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "@react-native-async-storage/async-storage") {
      return { default: {} };
    }
    if (request === "expo-file-system/legacy") {
      return {
        documentDirectory: "file:///tmp/",
        createDownloadResumable: () => {
          downloadCalls += 1;
          throw new Error("download should not have started");
        },
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
  let downloadModelBundle;
  try {
    const downloaderPath = path.join(projectRoot, "scripts/.build/engine/ModelDownloader.js");
    ({ downloadModelBundle } = require(downloaderPath));
  } finally {
    Module._load = originalModuleLoad;
  }

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

  // --- real Android MemTotal tier fixtures ---

  await test("S23 MemTotal 7,417,589,760 → high, no context upgrade", () => {
    const totalMemoryBytes = 7_417_589_760;
    assert(getRamTier(totalMemoryBytes) === "high", "S23 must classify as high");
    assert(
      resolveContextProfile({
        hybrid: qwen4b.hybrid,
        kvCache: qwen4b.kvCache,
        catalogCtx: qwen4b.engineCtx,
        totalMemoryBytes,
      }).nCtx === 8192,
      "S23 must keep catalog context",
    );
    const v = modelGateVerdict({
      totalMemoryBytes,
      availableMemoryBytes: 4_000 * 1024 * 1024,
      freeDiskBytes: 10_000_000_000,
      ramTier: getRamTier(7_417_589_760),
      modelMinRamTier: qwen4b.minRamTier,
      modelNonEvictableMiB: null,
      modelSizeBytes: qwen4b.sizeBytes + (qwen4b.mmproj?.sizeBytes ?? 0),
    });
    assert(v.allowed === true, `allowed=${v.allowed}`);
  });

  await test("7.6e9 MemTotal → high and context upgrade", () => {
    const totalMemoryBytes = 7_600_000_000;
    assert(getRamTier(totalMemoryBytes) === "high", "7.6e9 must classify as high");
    assert(
      resolveContextProfile({
        hybrid: qwen4b.hybrid,
        kvCache: qwen4b.kvCache,
        catalogCtx: qwen4b.engineCtx,
        totalMemoryBytes,
      }).nCtx === 16384,
      "7.6e9 must upgrade context",
    );
  });

  await test("nominal 6GB low MemAvailable: download allowed, load blocked", () => {
    const totalMemoryBytes = 5_600_000_000;
    const availableMemoryBytes = 2_500 * 1024 * 1024;
    const contextTokens = resolveContextProfile({
      hybrid: qwen4bQ3.hybrid,
      kvCache: qwen4bQ3.kvCache,
      catalogCtx: qwen4bQ3.engineCtx,
      totalMemoryBytes,
    }).nCtx;
    const modelNonEvictableMiB = estimateModelNonEvictableMiB({
      sizeBytes: qwen4bQ3.sizeBytes + (qwen4bQ3.mmproj?.sizeBytes ?? 0),
      contextTokens,
    });
    const input = {
      totalMemoryBytes,
      availableMemoryBytes,
      freeDiskBytes: 10_000_000_000,
      ramTier: getRamTier(totalMemoryBytes),
      modelMinRamTier: qwen4bQ3.minRamTier,
      modelNonEvictableMiB,
      modelSizeBytes: qwen4bQ3.sizeBytes + (qwen4bQ3.mmproj?.sizeBytes ?? 0),
    };
    const download = modelGateVerdict(input, { checkVolatileMemory: false });
    assert(download.allowed === true, `download allowed=${download.allowed}`);
    assert(download.reason === "ok", `download reason=${download.reason}`);
    const load = modelGateVerdict(input);
    assert(load.allowed === false, `load allowed=${load.allowed}`);
    assert(load.reason === "blocked_ram", `load reason=${load.reason}`);
  });

  await test("nominal 4GB MemTotal 3,700,000,000 → low", () => {
    assert(getRamTier(3_700_000_000) === "low", "4GB must classify as low");
  });

  await test("blocked verdict prevents the real download function", async () => {
    let blocked = false;
    try {
      await downloadModelBundle(qwen4b, {
        locale: "en",
        gate: { allowed: false, reason: "blocked_tier" },
      });
    } catch {
      blocked = true;
    }
    assert(blocked, "blocked download should stop before file work");
    assert(downloadCalls === 0, `download calls=${downloadCalls}`);
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
      contextTokens: 16384,
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

  await test("diskRequirementBytes 1 GiB → 1.1 GiB", () => {
    const gib = 1024 * 1024 * 1024;
    const need = diskRequirementBytes(gib);
    assert(need === gib * 1.1, `need=${need}`);
  });

  await test("diskRequirementBytes 0 → 0", () => {
    assert(diskRequirementBytes(0) === 0, `got ${diskRequirementBytes(0)}`);
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
