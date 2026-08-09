/**
 * Harness for shouldSaveSession in src/engine/sessionPersistence.ts.
 *
 * Pure save-gate: precedence of reason strings (no_context, disposing,
 * kv_not_chat, kv_not_reproducible) and the happy path. No llama.rn.
 *
 * Compile-from-disk (sessionMetaHarness pattern) + local node_modules stubs
 * so expo-file-system / AsyncStorage imports resolve under Node without RN.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/sessionSaveGateHarness");

function writeStubs() {
  const nm = path.join(outDir, "node_modules");

  // expo-file-system/legacy
  const efsDir = path.join(nm, "expo-file-system");
  mkdirSync(path.join(efsDir), { recursive: true });
  writeFileSync(
    path.join(efsDir, "package.json"),
    JSON.stringify({ name: "expo-file-system", type: "module", exports: { "./legacy": "./legacy.js" } }),
  );
  writeFileSync(
    path.join(efsDir, "legacy.js"),
    `
export const documentDirectory = "file:///tmp/kalsa-harness/";
export async function getFreeDiskStorageAsync() { return Number.MAX_SAFE_INTEGER; }
export async function makeDirectoryAsync() {}
export async function getInfoAsync() { return { exists: false, isDirectory: false }; }
export async function deleteAsync() {}
export async function readDirectoryAsync() { return []; }
`,
  );

  // @react-native-async-storage/async-storage
  const asDir = path.join(nm, "@react-native-async-storage", "async-storage");
  mkdirSync(asDir, { recursive: true });
  writeFileSync(
    path.join(asDir, "package.json"),
    JSON.stringify({ name: "@react-native-async-storage/async-storage", type: "module", main: "index.js" }),
  );
  writeFileSync(
    path.join(asDir, "index.js"),
    `
const store = new Map();
export default {
  async getItem(k) { return store.has(k) ? store.get(k) : null; },
  async setItem(k, v) { store.set(k, v); },
  async removeItem(k) { store.delete(k); },
  async getAllKeys() { return [...store.keys()]; },
  async multiRemove(keys) { for (const k of keys) store.delete(k); },
};
`,
  );
}

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeStubs();
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/sessionPersistence.ts",
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
    path.join(outDir, "sessionPersistence.js"),
    path.join(outDir, "engine/sessionPersistence.js"),
    path.join(outDir, "src/engine/sessionPersistence.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled sessionPersistence.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling sessionPersistence.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const { shouldSaveSession } = await import(pathToFileURL(modPath).href);

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  OK  ${name}`);
      passed++;
    } catch (e) {
      console.error(`  FAIL ${name}:`, e.message || e);
      failed++;
    }
  }

  const allGood = {
    hasContext: true,
    disposing: false,
    kvHoldsChatSession: true,
    kvReproducible: true,
  };

  test("happy path → save:true", () => {
    const r = shouldSaveSession(allGood);
    assert(r.save === true, `expected save:true got ${JSON.stringify(r)}`);
    assert(r.reason === undefined, `expected no reason got ${r.reason}`);
  });

  test("no_context reason", () => {
    const r = shouldSaveSession({ ...allGood, hasContext: false });
    assert(r.save === false && r.reason === "no_context", JSON.stringify(r));
  });

  test("disposing reason", () => {
    const r = shouldSaveSession({ ...allGood, disposing: true });
    assert(r.save === false && r.reason === "disposing", JSON.stringify(r));
  });

  test("kv_not_chat reason", () => {
    const r = shouldSaveSession({ ...allGood, kvHoldsChatSession: false });
    assert(r.save === false && r.reason === "kv_not_chat", JSON.stringify(r));
  });

  test("kv_not_reproducible (tool turn)", () => {
    const r = shouldSaveSession({ ...allGood, kvReproducible: false });
    assert(r.save === false && r.reason === "kv_not_reproducible", JSON.stringify(r));
  });

  // Precedence: first failing guard wins (same order as saveEngineSession).
  test("precedence: no_context beats disposing", () => {
    const r = shouldSaveSession({
      hasContext: false,
      disposing: true,
      kvHoldsChatSession: false,
      kvReproducible: false,
    });
    assert(r.reason === "no_context", JSON.stringify(r));
  });

  test("precedence: disposing beats kv_not_chat", () => {
    const r = shouldSaveSession({
      hasContext: true,
      disposing: true,
      kvHoldsChatSession: false,
      kvReproducible: false,
    });
    assert(r.reason === "disposing", JSON.stringify(r));
  });

  test("precedence: kv_not_chat beats kv_not_reproducible", () => {
    const r = shouldSaveSession({
      hasContext: true,
      disposing: false,
      kvHoldsChatSession: false,
      kvReproducible: false,
    });
    assert(r.reason === "kv_not_chat", JSON.stringify(r));
  });

  test("precedence: kv_not_reproducible only when others ok", () => {
    const r = shouldSaveSession({
      hasContext: true,
      disposing: false,
      kvHoldsChatSession: true,
      kvReproducible: false,
    });
    assert(r.reason === "kv_not_reproducible", JSON.stringify(r));
  });

  console.log(`\nsessionSaveGateHarness: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All sessionSaveGate harness cases passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
