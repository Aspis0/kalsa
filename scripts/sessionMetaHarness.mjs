/**
 * Harness for pure session meta helpers in src/engine/sessionPersistence.ts.
 *
 * Covers:
 *  - historyHash stability / sensitivity
 *  - sessionMetaMatches equal / mismatch / savedAt ignored / optional fields
 *
 * Compile-from-disk (streamCoalescerHarness pattern) + local node_modules stubs
 * so expo-file-system / AsyncStorage imports resolve under Node without RN.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "scripts/.build/sessionMetaHarness");

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
      "src/engine/ttftFlags.ts",
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
  const {
    historyHash,
    sessionMetaMatches,
    sessionMetaMismatchField,
    sessionMetaKey,
    sessionFilePathForBase,
    computeHistoryHashFromMessages,
    computePromptEnvHash,
    estimateSessionBytes,
    resolveSessionDiskTokens,
    sessionDiskBytesRequired,
    SESSION_DISK_GATE_USED_TOKENS,
    SESSION_BYTES_PER_TOKEN,
    SESSION_DISK_MARGIN,
    SESSION_DISK_FLOOR_BYTES,
    SESSION_DISK_TOKEN_FLOOR,
    SESSION_DISK_TOKENS_PER_HISTORY_MSG,
    sessionLoadHasTokens,
  } = await import(pathToFileURL(modPath).href);

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

  // 1. historyHash stable
  test("historyHash stable: same string twice", () => {
    const s = JSON.stringify([{ role: "user", text: "hello" }]);
    assert(historyHash(s) === historyHash(s), "hash not stable");
    assert(typeof historyHash(s) === "string" && historyHash(s).length > 0, "empty hash");
  });

  // 2. historyHash differs on content change
  test("historyHash differs when message content changes", () => {
    const a = historyHash(JSON.stringify([{ role: "user", text: "hello" }]));
    const b = historyHash(JSON.stringify([{ role: "user", text: "hello!" }]));
    assert(a !== b, "expected different hashes");
  });

  // 3. equal metas match
  test("sessionMetaMatches: equal metas → true", () => {
    const m = {
      formatVersion: 1,
      nCtx: 4096,
      cacheTypeK: "q8_0",
      cacheTypeV: "q4_0",
      mtpNMax: 3,
      specType: "draft-mtp",
      historyHash: "12345",
      savedAt: 1000,
    };
    assert(sessionMetaMatches(m, { ...m, savedAt: 9999 }), "savedAt must not matter");
    assert(sessionMetaMatches(m, m), "self match");
  });

  // 4. mismatches
  const base = {
    formatVersion: 1,
    nCtx: 4096,
    cacheTypeK: "q8_0",
    cacheTypeV: "q4_0",
    historyHash: "abc",
  };

  test("mismatch nCtx", () => {
    assert(!sessionMetaMatches(base, { ...base, nCtx: 8192 }), "nCtx");
  });
  test("mismatch cacheTypeK", () => {
    assert(!sessionMetaMatches(base, { ...base, cacheTypeK: "f16" }), "cacheTypeK");
  });
  test("mismatch cacheTypeV", () => {
    assert(!sessionMetaMatches(base, { ...base, cacheTypeV: "f16" }), "cacheTypeV");
  });
  test("mismatch historyHash", () => {
    assert(!sessionMetaMatches(base, { ...base, historyHash: "zzz" }), "historyHash");
  });
  test("mismatch mtpNMax", () => {
    assert(
      !sessionMetaMatches({ ...base, mtpNMax: 3 }, { ...base, mtpNMax: 4 }),
      "mtpNMax",
    );
  });
  test("mismatch specType", () => {
    assert(
      !sessionMetaMatches({ ...base, specType: "none" }, { ...base, specType: "draft-dflash" }),
      "specType",
    );
  });
  test("match engineKnob equal", () => {
    const knob = '{"nGpuLayers":20}';
    assert(
      sessionMetaMatches(
        { ...base, engineKnob: knob },
        { ...base, engineKnob: knob },
      ),
      "same engineKnob should match",
    );
  });
  test("mismatch engineKnob → field name", () => {
    assert(
      sessionMetaMismatchField(
        { ...base, engineKnob: '{"nGpuLayers":20}' },
        { ...base, engineKnob: '{"nGpuLayers":30}' },
      ) === "engineKnob",
      "engineKnob",
    );
  });
  test("engineKnob absent-vs-absent match", () => {
    const a = { ...base };
    const b = { ...base, engineKnob: undefined };
    assert(sessionMetaMatches(a, b), "undefined === missing engineKnob");
  });
  test("mismatch formatVersion", () => {
    assert(
      !sessionMetaMatches(base, { ...base, formatVersion: 2 }),
      "formatVersion",
    );
  });

  // 5. savedAt difference does NOT cause mismatch
  test("savedAt difference does not mismatch", () => {
    assert(
      sessionMetaMatches(
        { ...base, savedAt: 1 },
        { ...base, savedAt: 2 },
      ),
      "savedAt should be ignored",
    );
  });

  // 6. undefined vs missing optional fields match
  test("undefined vs missing optional fields match", () => {
    const a = { ...base };
    const b = { ...base, mtpNMax: undefined, specType: undefined };
    assert(sessionMetaMatches(a, b), "undefined === missing");
    // One has mtpNMax, other doesn't
    assert(
      !sessionMetaMatches({ ...base, mtpNMax: 2 }, base),
      "present vs missing mtpNMax should mismatch",
    );
  });

  // Bonus pure helpers
  test("sessionMetaKey shape", () => {
    assert(sessionMetaKey("qwen") === "kalsa.session.meta.qwen", sessionMetaKey("qwen"));
  });
  test("sessionFilePathForBase", () => {
    const p = sessionFilePathForBase("file:///docs/", "my-model");
    assert(p === "file:///docs/sessions/my-model.kvs", p);
  });
  test("computeHistoryHashFromMessages stable", () => {
    const msgs = [{ role: "user", text: "x" }];
    assert(
      computeHistoryHashFromMessages(msgs) === computeHistoryHashFromMessages(msgs),
      "stable",
    );
    assert(
      computeHistoryHashFromMessages(msgs) === historyHash(JSON.stringify(msgs)),
      "equals historyHash(JSON.stringify)",
    );
    assert(
      computeHistoryHashFromMessages(null) === historyHash("[]"),
      "null → empty array",
    );
  });

  // promptEnvHash — system-prompt env gate
  test("computePromptEnvHash stable + djb2 shape", () => {
    const a = computePromptEnvHash("en", ["fact one", "fact two"]);
    const b = computePromptEnvHash("en", ["fact one", "fact two"]);
    assert(a === b, "stable");
    assert(typeof a === "string" && a.length > 0, "non-empty");
    const expected = historyHash(
      JSON.stringify({
        locale: "en",
        memoryFactsJoined: "fact one\nfact two",
        hasTools: true,
      }),
    );
    assert(a === expected, "equals historyHash of canonical JSON");
  });

  test("computePromptEnvHash sensitive to locale / facts", () => {
    const base = computePromptEnvHash("en", ["a"]);
    assert(base !== computePromptEnvHash("it", ["a"]), "locale");
    assert(base !== computePromptEnvHash("en", ["b"]), "facts");
    assert(base !== computePromptEnvHash("en", []), "empty facts");
    assert(
      computePromptEnvHash("en", null) === computePromptEnvHash("en", []),
      "null facts ≡ []",
    );
  });

  test("sessionMetaMatches: promptEnvHash equal / mismatch", () => {
    const withEnv = { ...base, promptEnvHash: "env1" };
    assert(sessionMetaMatches(withEnv, { ...withEnv }), "equal promptEnvHash");
    assert(
      !sessionMetaMatches(withEnv, { ...withEnv, promptEnvHash: "env2" }),
      "mismatch promptEnvHash",
    );
    assert(
      !sessionMetaMatches(withEnv, base),
      "present vs missing promptEnvHash should mismatch",
    );
    assert(
      sessionMetaMatches(base, { ...base, promptEnvHash: undefined }),
      "undefined ≡ missing promptEnvHash",
    );
  });

  test("estimateSessionBytes is usedTokens * 64KB", () => {
    assert(estimateSessionBytes(8192) === 8192 * SESSION_BYTES_PER_TOKEN, "8192");
    assert(estimateSessionBytes(0) === 0, "0");
    assert(estimateSessionBytes(-1) === 0, "negative → 0");
  });

  test("SESSION_DISK_GATE_USED_TOKENS defaults on", () => {
    assert(SESSION_DISK_GATE_USED_TOKENS === true, "flag default");
  });

  test("resolveSessionDiskTokens prefers nPast over nCtx", () => {
    assert(
      resolveSessionDiskTokens({ nPast: 400, nCtx: 16384 }) === 400,
      "nPast wins",
    );
    assert(
      resolveSessionDiskTokens({ nPast: 400, historyLength: 20, nCtx: 16384 }) === 400,
      "nPast beats history",
    );
  });

  test("resolveSessionDiskTokens estimates from history length when nPast unknown", () => {
    const expected = Math.max(
      SESSION_DISK_TOKEN_FLOOR,
      4 * SESSION_DISK_TOKENS_PER_HISTORY_MSG,
    );
    assert(
      resolveSessionDiskTokens({ historyLength: 4, nCtx: 16384 }) === expected,
      `history 4 → ${expected}`,
    );
    assert(
      resolveSessionDiskTokens({ historyLength: 0, nCtx: 16384 }) === SESSION_DISK_TOKEN_FLOOR,
      "empty history → token floor",
    );
    assert(
      expected < 16384,
      "history estimate must not collapse to full nCtx",
    );
  });

  test("resolveSessionDiskTokens fail-closed when nPast and history unknown", () => {
    assert(resolveSessionDiskTokens({ nCtx: 16384 }) === null, "nCtx only");
    assert(resolveSessionDiskTokens({}) === null, "empty input");
    assert(resolveSessionDiskTokens({ nPast: 0, nCtx: 16384 }) === null, "nPast 0");
    assert(resolveSessionDiskTokens({ nPast: -1, nCtx: 16384 }) === null, "nPast neg");
  });

  test("resolveSessionDiskTokens caps at nCtx", () => {
    assert(resolveSessionDiskTokens({ nPast: 99999, nCtx: 2048 }) === 2048, "nPast cap");
    const uncapped = 100 * SESSION_DISK_TOKENS_PER_HISTORY_MSG;
    assert(uncapped > 2048, "precondition");
    assert(
      resolveSessionDiskTokens({ historyLength: 100, nCtx: 2048 }) === 2048,
      "history cap",
    );
  });

  test("sessionDiskBytesRequired applies margin and floor", () => {
    const mid = sessionDiskBytesRequired(400);
    assert(
      mid === Math.max(SESSION_DISK_FLOOR_BYTES, 400 * SESSION_BYTES_PER_TOKEN * SESSION_DISK_MARGIN),
      "400 tokens",
    );
    assert(sessionDiskBytesRequired(1) === SESSION_DISK_FLOOR_BYTES, "tiny → floor");
    assert(
      sessionDiskBytesRequired(400) < estimateSessionBytes(16384) * SESSION_DISK_MARGIN,
      "used-token budget << full nCtx",
    );
  });

  test("bakedUserTails payload does not affect sessionMetaMatches", () => {
    assert(
      sessionMetaMatches(base, {
        ...base,
        bakedUserTails: [{ bare: "hi", prefixed: "FACTS\n\nhi" }],
      }),
      "baked tails ignored by gate",
    );
  });

  test("sessionLoadHasTokens rejects 0 / missing / non-number", () => {
    assert(sessionLoadHasTokens({ tokens_loaded: 12 }) === true, "positive");
    assert(sessionLoadHasTokens({ tokens_loaded: 0 }) === false, "zero");
    assert(sessionLoadHasTokens({ tokens_loaded: -1 }) === false, "negative");
    assert(sessionLoadHasTokens({ tokens_loaded: "12" }) === false, "string");
    assert(sessionLoadHasTokens({}) === false, "missing");
    assert(sessionLoadHasTokens(null) === false, "null");
    assert(sessionLoadHasTokens(undefined) === false, "undefined");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
