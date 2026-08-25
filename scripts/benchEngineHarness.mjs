/**
 * Harness for src/bench/benchConfig.ts engine override (chat path).
 *
 * Covers pure parseEngineArg + tryHandleBenchCommand routing with a
 * mocked AsyncStorage (RN package needs `window` under Node).
 *
 * Compile-from-disk pattern (same as benchSpeculativeHarness). Exit 1 on fail.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
      "src/bench/benchConfig.ts",
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
    path.join(projectRoot, "scripts/.build/benchConfig.js"),
    path.join(projectRoot, "scripts/.build/bench/benchConfig.js"),
    path.join(projectRoot, "scripts/.build/src/bench/benchConfig.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled benchConfig.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

/** In-memory AsyncStorage so storage ops succeed under Node (no `window`). */
function installAsyncStorageMock() {
  const store = new Map();
  const api = {
    getItem: async (key) => (store.has(key) ? store.get(key) : null),
    setItem: async (key, value) => {
      store.set(key, String(value));
    },
    removeItem: async (key) => {
      store.delete(key);
    },
    clear: async () => {
      store.clear();
    },
    getAllKeys: async () => [...store.keys()],
    multiGet: async (keys) => keys.map((k) => [k, store.has(k) ? store.get(k) : null]),
    multiSet: async (pairs) => {
      for (const [k, v] of pairs) store.set(k, String(v));
    },
    multiRemove: async (keys) => {
      for (const k of keys) store.delete(k);
    },
    mergeItem: async () => {},
    multiMerge: async () => {},
    flushGetRequests: () => {},
  };
  const asPath = require.resolve("@react-native-async-storage/async-storage");
  require.cache[asPath] = {
    id: asPath,
    filename: asPath,
    loaded: true,
    exports: {
      __esModule: true,
      default: api,
      useAsyncStorage: () => api,
    },
  };
  return store;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling benchConfig.ts …");
  compile();
  const modPath = resolveBuilt();

  const store = installAsyncStorageMock();
  console.log("Loading", modPath, "(AsyncStorage mocked)");
  // CJS emit → createRequire so the mock in require.cache is used.
  const mod = require(modPath);
  const {
    parseEngineArg,
    setEngineOverride,
    getEngineOverride,
    registerActiveEngineKnobGetter,
    tryHandleBenchCommand,
    formatBenchStatus,
    BENCH_ENGINE_KEY,
    BENCH_NOREPACK_KEY,
    parseBenchNoRepack,
    getBenchNoRepack,
  } = mod;

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

  // ── pure parseEngineArg ────────────────────────────────────────────────
  await test('parse "gpu=20" → {nGpuLayers:20}', () => {
    const r = parseEngineArg("gpu=20");
    assert(
      r && typeof r === "object" && r.nGpuLayers === 20 && !("nThreads" in r) && !("nUbatch" in r),
      `got ${JSON.stringify(r)}`,
    );
  });

  await test('parse all three → full object', () => {
    const r = parseEngineArg("gpu=20,threads=5,ubatch=256");
    assert(
      r &&
        typeof r === "object" &&
        r.nGpuLayers === 20 &&
        r.nThreads === 5 &&
        r.nUbatch === 256,
      `got ${JSON.stringify(r)}`,
    );
  });

  await test('parse independent prefill threads; absent key stays absent', () => {
    const r = parseEngineArg("threads=2,threadsPrefill=4");
    assert(
      r && r.nThreads === 2 && r.nThreadsPrefill === 4,
      `got ${JSON.stringify(r)}`,
    );
    const without = parseEngineArg("threads=2");
    assert(
      without && !Object.prototype.hasOwnProperty.call(without, "nThreadsPrefill"),
      `absent key got ${JSON.stringify(without)}`,
    );
    const aboveCoreCount = parseEngineArg("threadsPrefill=9999");
    assert(
      aboveCoreCount?.nThreadsPrefill === 9999,
      `above-core count got ${JSON.stringify(aboveCoreCount)}`,
    );
  });

  await test('reject prefill empty, zero, negative, text, float, and unsafe integer', () => {
    for (const value of ["", "0", "-1", "abc", "2.5", "9007199254740992"]) {
      assert(
        parseEngineArg(`threadsPrefill=${value}`) === null,
        `threadsPrefill=${value} should fail`,
      );
    }
  });

  await test("parse junk / empty / unknown / float / negative → null", () => {
    assert(parseEngineArg("nope") === null, "junk");
    assert(parseEngineArg("") === null, "empty");
    assert(parseEngineArg("   ") === null, "whitespace");
    assert(parseEngineArg("foo=1") === null, "unknown key");
    assert(parseEngineArg("gpu=1.5") === null, "float");
    assert(parseEngineArg("gpu=-1") === null, "negative");
    assert(parseEngineArg("gpu=") === null, "missing value");
    assert(parseEngineArg("gpu") === null, "missing =");
  });

  await test('parse "clear" / "default" → "clear"', () => {
    assert(parseEngineArg("clear") === "clear", "clear");
    assert(parseEngineArg("default") === "clear", "default");
  });

  await test('parse "gpu=0" allowed → {nGpuLayers:0}', () => {
    const r = parseEngineArg("gpu=0");
    assert(r && typeof r === "object" && r.nGpuLayers === 0, `got ${JSON.stringify(r)}`);
  });

  await test('parse "threads=0" / "ubatch=0" → null', () => {
    assert(parseEngineArg("threads=0") === null, "threads=0");
    assert(parseEngineArg("ubatch=0") === null, "ubatch=0");
  });

  await test("parse thread and ubatch unsafe integers → null", () => {
    const unsafe = "9007199254740992";
    assert(parseEngineArg(`threads=${unsafe}`) === null, "unsafe threads");
    assert(parseEngineArg(`ubatch=${unsafe}`) === null, "unsafe ubatch");
  });

  // ── setEngineOverride + getEngineOverride round-trip ───────────────────
  await test("set→get round-trip raw JSON equals stringify", async () => {
    store.clear();
    const ok = await setEngineOverride("gpu=20,threads=5,threadsPrefill=8,ubatch=256");
    assert(ok === true, "set should succeed");
    const expected = {
      nGpuLayers: 20,
      nThreads: 5,
      nThreadsPrefill: 8,
      nUbatch: 256,
    };
    const raw = store.get(BENCH_ENGINE_KEY);
    assert(raw === JSON.stringify(expected), `raw storage got ${raw}`);
    const got = await getEngineOverride();
    assert(
      got?.nGpuLayers === 20 &&
        got?.nThreads === 5 &&
        got?.nThreadsPrefill === 8 &&
        got?.nUbatch === 256,
      `get got ${JSON.stringify(got)}`,
    );
  });

  await test("clear removes key", async () => {
    store.clear();
    store.set(BENCH_ENGINE_KEY, JSON.stringify({ nGpuLayers: 20 }));
    assert((await setEngineOverride("clear")) === true, "clear should succeed");
    assert(!store.has(BENCH_ENGINE_KEY), "key should be removed after clear");
    assert((await getEngineOverride()) === undefined, "get after clear → undefined");

    store.set(BENCH_ENGINE_KEY, JSON.stringify({ nThreads: 5 }));
    assert((await setEngineOverride("default")) === true, "default should succeed");
    assert(!store.has(BENCH_ENGINE_KEY), "key should be removed after default");
  });

  await test("storage reader rejects zero thread and batch values", async () => {
    store.set(
      BENCH_ENGINE_KEY,
      JSON.stringify({ nGpuLayers: 0, nThreads: 0, nThreadsPrefill: 0, nUbatch: 0 }),
    );
    const got = await getEngineOverride();
    assert(JSON.stringify(got) === JSON.stringify({ nGpuLayers: 0 }), `got ${JSON.stringify(got)}`);
  });

  await test("active reader rejects zero thread and batch values", async () => {
    store.clear();
    try {
      registerActiveEngineKnobGetter(() =>
        JSON.stringify({ nGpuLayers: 0, nThreads: 0, nThreadsPrefill: 0, nUbatch: 0 }),
      );
      const status = await formatBenchStatus();
      assert(status.includes("ACTIVE: gpu:0"), `status ${status}`);
      assert(!status.includes("threads:"), `status ${status}`);
      assert(!status.includes("ubatch:"), `status ${status}`);
    } finally {
      registerActiveEngineKnobGetter(() => undefined);
      store.clear();
    }
  });

  await test("invalid set returns false, writes nothing", async () => {
    store.clear();
    assert((await setEngineOverride("junk")) === false, "junk must fail");
    assert((await setEngineOverride("gpu=1.5")) === false, "float must fail");
    assert((await setEngineOverride("threads=0")) === false, "threads=0 must fail");
    assert(
      (await setEngineOverride("threadsPrefill=0")) === false,
      "threadsPrefill=0 must fail",
    );
    assert(store.size === 0, "invalid modes must not write");
  });

  // ── tryHandleBenchCommand routing ──────────────────────────────────────
  await test("command bench:engine gpu=20 → status shows engine with gpu:20", async () => {
    store.clear();
    const r = await tryHandleBenchCommand("bench:engine gpu=20");
    assert(typeof r === "string" && r.includes("engine=gpu:20"), `got ${r}`);
    const got = await getEngineOverride();
    assert(got?.nGpuLayers === 20, `storage got ${JSON.stringify(got)}`);
  });

  await test("formatBenchStatus includes engine=default when absent", async () => {
    store.clear();
    const s = await formatBenchStatus();
    assert(s.includes("engine=default"), `got ${s}`);
    assert(s.includes("thinking="), `got ${s}`);
    assert(s.includes("format="), `got ${s}`);
    assert(s.includes("speculative="), `got ${s}`);
  });

  await test("command missing arg → usage", async () => {
    const r = await tryHandleBenchCommand("/bench engine");
    assert(typeof r === "string" && r.includes("missing engine"), `got ${r}`);
    assert(r.includes("bench usage:"), "should include usage");
  });

  await test("multi-field status compact form", async () => {
    store.clear();
    const r = await tryHandleBenchCommand(
      "/bench engine gpu=20,threads=5,threadsPrefill=8,ubatch=256",
    );
    assert(
      typeof r === "string" &&
        r.includes("engine=gpu:20,threads:5,threadsPrefill:8,ubatch:256"),
      `got ${r}`,
    );
  });

  await test("command invalid → error + usage", async () => {
    const r = await tryHandleBenchCommand("/bench engine foo=1");
    assert(typeof r === "string" && r.includes("invalid engine"), `got ${r}`);
    assert(r.includes("bench usage:"), "should include usage");
  });

  // ── kalsa.bench.norepack (no_extra_bufts arm) ──────────────────────────
  // Sealed contract (parseBenchNoRepack JSDoc): tri-state. "1" → true
  // (disable ARM repack), "0" → false (force repack ON), empty / absent /
  // junk → undefined (no bench opinion: per-model loadPolicy decides).
  await test('parseBenchNoRepack: tri-state "1"/true "0"/false else undefined', () => {
    assert(parseBenchNoRepack("1") === true, '"1" → true');
    assert(parseBenchNoRepack("0") === false, '"0" → false (repack forced on)');
    assert(parseBenchNoRepack(null) === undefined, "null → undefined");
    assert(parseBenchNoRepack(undefined) === undefined, "undefined → undefined");
    assert(parseBenchNoRepack("") === undefined, "empty → undefined");
    assert(parseBenchNoRepack("yes") === undefined, "junk → undefined");
  });

  await test("getBenchNoRepack: absent → undefined; '1' → true; '0' → false; junk → undefined", async () => {
    store.clear();
    assert((await getBenchNoRepack()) === undefined, "absent → undefined (policy decides)");
    store.set(BENCH_NOREPACK_KEY, "1");
    assert((await getBenchNoRepack()) === true, "'1' → true");
    store.set(BENCH_NOREPACK_KEY, "0");
    assert((await getBenchNoRepack()) === false, "'0' → false");
    store.set(BENCH_NOREPACK_KEY, "2");
    assert((await getBenchNoRepack()) === undefined, "junk → undefined");
  });

  // Reload skip key must include the *resolved* no_extra_bufts mode from
  // resolveLoadPolicy — otherwise flipping kalsa.bench.norepack with an
  // identical context silently keeps the old engine mode and emits no
  // KALSA_SESSION init telemetry. The bench lever is folded into `load`;
  // there is no local `noExtraBufts` binding.
  await test("initEngine skip-reload key includes resolved load.noExtraBufts", () => {
    const src = readFileSync(
      path.join(projectRoot, "src/engine/LlamaService.ts"),
      "utf8",
    );
    assert(
      /let activeNoExtraBufts\b/.test(src),
      "activeNoExtraBufts state must exist",
    );
    assert(
      src.includes("activeNoExtraBufts === load.noExtraBufts"),
      "skip-reload condition must compare activeNoExtraBufts === load.noExtraBufts",
    );
    assert(
      /activeNoExtraBufts = load\.noExtraBufts\s*;/.test(src),
      "successful load must record activeNoExtraBufts from load policy",
    );
    assert(
      /activeNoExtraBufts = null\s*;/.test(src),
      "dispose must clear activeNoExtraBufts",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All benchEngine harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
