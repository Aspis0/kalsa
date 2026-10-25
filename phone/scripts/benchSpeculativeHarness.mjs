/**
 * Harness for src/bench/benchConfig.ts speculative override (chat path).
 *
 * Covers pure parseSpeculativeArg + tryHandleBenchCommand routing with a
 * mocked AsyncStorage (RN package needs `window` under Node).
 *
 * Compile-from-disk pattern (same as thinkingBudgetsHarness). Exit 1 on fail.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
    parseSpeculativeArg,
    setSpeculativeOverride,
    getSpeculativeOverride,
    tryHandleBenchCommand,
    formatBenchStatus,
    BENCH_SPECULATIVE_KEY,
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

  // ── pure parseSpeculativeArg ───────────────────────────────────────────
  await test('parse "none" → {type:"none"}', () => {
    const r = parseSpeculativeArg("none");
    assert(r && r.type === "none" && !("nMax" in r), `got ${JSON.stringify(r)}`);
  });

  await test('parse "mtp" → {type:"draft-mtp"}', () => {
    const r = parseSpeculativeArg("mtp");
    assert(r && r.type === "draft-mtp", `got ${JSON.stringify(r)}`);
  });

  await test('parse "clear" → "clear"', () => {
    assert(parseSpeculativeArg("clear") === "clear", "expected clear sentinel");
  });

  await test('parse "default" → "clear"', () => {
    assert(parseSpeculativeArg("default") === "clear", "expected clear sentinel");
  });

  await test('parse "dflash" → null (not supported via chat)', () => {
    assert(parseSpeculativeArg("dflash") === null, "dflash must be invalid");
  });

  await test('parse junk → null', () => {
    assert(parseSpeculativeArg("nope") === null, "junk must be invalid");
    assert(parseSpeculativeArg("") === null, "empty must be invalid");
  });

  // ── setSpeculativeOverride + getSpeculativeOverride round-trip ─────────
  await test('set "none" persists JSON {type:none}', async () => {
    store.clear();
    const ok = await setSpeculativeOverride("none");
    assert(ok === true, "set should succeed");
    const raw = store.get(BENCH_SPECULATIVE_KEY);
    assert(raw === JSON.stringify({ type: "none" }), `raw storage got ${raw}`);
    const got = await getSpeculativeOverride();
    assert(got?.type === "none", `get got ${JSON.stringify(got)}`);
  });

  await test('set "mtp" persists JSON {type:draft-mtp}', async () => {
    store.clear();
    const ok = await setSpeculativeOverride("mtp");
    assert(ok === true, "set should succeed");
    const raw = store.get(BENCH_SPECULATIVE_KEY);
    assert(raw === JSON.stringify({ type: "draft-mtp" }), `raw storage got ${raw}`);
    const got = await getSpeculativeOverride();
    assert(got?.type === "draft-mtp", `get got ${JSON.stringify(got)}`);
  });

  await test('set "clear" / "default" removes key', async () => {
    store.clear();
    store.set(BENCH_SPECULATIVE_KEY, JSON.stringify({ type: "none" }));
    assert((await setSpeculativeOverride("clear")) === true, "clear should succeed");
    assert(!store.has(BENCH_SPECULATIVE_KEY), "key should be removed after clear");
    assert((await getSpeculativeOverride()) === undefined, "get after clear → undefined");

    store.set(BENCH_SPECULATIVE_KEY, JSON.stringify({ type: "draft-mtp" }));
    assert((await setSpeculativeOverride("default")) === true, "default should succeed");
    assert(!store.has(BENCH_SPECULATIVE_KEY), "key should be removed after default");
  });

  await test('set "dflash" / junk → false, no write', async () => {
    store.clear();
    assert((await setSpeculativeOverride("dflash")) === false, "dflash must fail");
    assert((await setSpeculativeOverride("junk")) === false, "junk must fail");
    assert(store.size === 0, "invalid modes must not write");
  });

  // ── tryHandleBenchCommand routing (args lowercased by handler) ─────────
  await test("command missing arg → usage", async () => {
    const r = await tryHandleBenchCommand("/bench speculative");
    assert(typeof r === "string" && r.includes("missing speculative"), `got ${r}`);
  });

  await test("command invalid (dflash) → error + usage", async () => {
    const r = await tryHandleBenchCommand("/bench speculative dflash");
    assert(typeof r === "string" && r.includes("invalid speculative"), `got ${r}`);
    assert(r.includes("bench usage:"), "should include usage");
  });

  await test("command uppercase MTP lowercased → draft-mtp", async () => {
    store.clear();
    const r = await tryHandleBenchCommand("/bench speculative MTP");
    assert(typeof r === "string" && r.includes("speculative=draft-mtp"), `got ${r}`);
    const got = await getSpeculativeOverride();
    assert(got?.type === "draft-mtp", `storage got ${JSON.stringify(got)}`);
  });

  await test("command slash-free bench:speculative none", async () => {
    store.clear();
    const r = await tryHandleBenchCommand("bench:speculative none");
    assert(typeof r === "string" && r.includes("speculative=none"), `got ${r}`);
  });

  await test("command clear → status shows speculative=default", async () => {
    store.clear();
    store.set(BENCH_SPECULATIVE_KEY, JSON.stringify({ type: "draft-mtp" }));
    const r = await tryHandleBenchCommand("/bench speculative clear");
    assert(typeof r === "string" && r.includes("speculative=default"), `got ${r}`);
    assert((await getSpeculativeOverride()) === undefined, "cleared");
  });

  await test("formatBenchStatus includes speculative=default when absent", async () => {
    store.clear();
    const s = await formatBenchStatus();
    assert(s.includes("speculative=default"), `got ${s}`);
    assert(s.includes("thinking="), `got ${s}`);
    assert(s.includes("format="), `got ${s}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All benchSpeculative harness cases passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
