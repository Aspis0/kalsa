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
      "src/engine/sessionDiskCalibration.ts",
      "src/engine/sessionDiskCalibrationStore.ts",
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

function resolveBuilt(file = "sessionPersistence.js") {
  const candidates = [
    path.join(outDir, file),
    path.join(outDir, `engine/${file}`),
    path.join(outDir, `src/engine/${file}`),
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
    sessionHistoryPrefixAccepts,
    resolveSessionDiskTokens,
    sessionDiskBytesRequired,
    SESSION_DISK_GATE_USED_TOKENS,
    SESSION_BYTES_PER_TOKEN,
    SESSION_DISK_MARGIN,
    SESSION_DISK_FLOOR_BYTES,
    SESSION_DISK_TOKEN_FLOOR,
    SESSION_DISK_TOKENS_PER_HISTORY_MSG,
    sessionLoadHasTokens,
    buildKvDiagPayload,
  } = await import(pathToFileURL(modPath).href);
  const {
    recordSessionDiskSample,
    sessionBytesPerTokenForModel,
  } = await import(pathToFileURL(resolveBuilt("sessionDiskCalibration.js")).href);

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

  // promptEnvHash — system-prompt env gate. Covers locale + memoryFacts +
  // hasTools + the tool NAMES and blockFormat: hasTools alone was a boolean, so
  // turning Web off changed the tool array without changing the hash and the
  // same .kvs was reused under a different system prompt (audit F6, 2026-08-21).
  test("computePromptEnvHash stable + djb2 shape", () => {
    const a = computePromptEnvHash("en", ["fact a"], true, ["web_search"], "md");
    const b = computePromptEnvHash("en", ["fact a"], true, ["web_search"], "md");
    assert(a === b, "stable");
    assert(typeof a === "string" && a.length > 0, "non-empty");
    const expected = historyHash(
      JSON.stringify({
        locale: "en",
        memoryFactsJoined: "fact a",
        hasTools: true,
        tools: ["web_search"],
        blockFormat: "md",
      }),
    );
    assert(a === expected, "equals historyHash of canonical JSON");
  });

  test("computePromptEnvHash sensitive to tool set and blockFormat", () => {
    const base = computePromptEnvHash("en", ["f"], true, ["web_search"], "md");
    assert(
      base !== computePromptEnvHash("en", ["f"], true, ["web_search", "web_fetch"], "md"),
      "tool set change must change the hash (the Web toggle case)",
    );
    assert(
      base !== computePromptEnvHash("en", ["f"], true, ["web_search"], "xml"),
      "blockFormat",
    );
    assert(
      base === computePromptEnvHash("en", ["f"], true, ["web_search", "web_search"], "md"),
      "duplicate tool names are collapsed",
    );
  });

  test("computePromptEnvHash sensitive to locale / facts / hasTools", () => {
    const base = computePromptEnvHash("en", ["f"], true);
    assert(base !== computePromptEnvHash("it", ["f"], true), "locale");
    assert(base !== computePromptEnvHash("en", ["g"], true), "facts");
    assert(base !== computePromptEnvHash("en", ["f"], false), "hasTools");
    assert(
      computePromptEnvHash("en", null, true) === computePromptEnvHash("en", [], true),
      "null ≡ [] facts",
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

  // ── sessionHistoryPrefixAccepts ──────────────────────────────────────────
  const prefixMsgs = [
    { role: "user", text: "hi" },
    { role: "assistant", text: "hello" },
  ];
  const prefixHash = computeHistoryHashFromMessages(prefixMsgs);

  test("prefix ACCEPT: saved prefix == current truncated to count", () => {
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash, historyMessageCount: 2 },
      prefixMsgs,
    );
    assert(r.accept === true, JSON.stringify(r));
  });

  test("prefix ACCEPT: current has one extra user message (pending turn)", () => {
    const current = [...prefixMsgs, { role: "user", text: "next turn" }];
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash, historyMessageCount: 2 },
      current,
    );
    assert(r.accept === true, JSON.stringify(r));
  });

  // Empty suffix: length === count, prefix hash matches → ACCEPT (exact restore).
  test("prefix ACCEPT: empty suffix (nothing appended after count)", () => {
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash, historyMessageCount: 2 },
      prefixMsgs,
    );
    assert(r.accept === true, JSON.stringify(r));
  });

  test("prefix REJECT stale_kv: user + assistant suffix (skipped tool turn)", () => {
    const current = [
      ...prefixMsgs,
      { role: "user", text: "search something" },
      { role: "assistant", text: "tool results summary" },
    ];
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash, historyMessageCount: 2 },
      current,
    );
    assert(
      r.accept === false && r.reason === "stale_kv_completed_turn",
      JSON.stringify(r),
    );
  });

  test("prefix REJECT stale_kv: assistant-only suffix", () => {
    const current = [...prefixMsgs, { role: "assistant", text: "orphan reply" }];
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash, historyMessageCount: 2 },
      current,
    );
    assert(
      r.accept === false && r.reason === "stale_kv_completed_turn",
      JSON.stringify(r),
    );
  });

  test("prefix REJECT: content diverges inside prefix", () => {
    const diverged = [
      { role: "user", text: "hi EDITED" },
      { role: "assistant", text: "hello" },
      { role: "user", text: "next" },
    ];
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash, historyMessageCount: 2 },
      diverged,
    );
    assert(r.accept === false && r.reason === "historyHash", JSON.stringify(r));
  });

  test("prefix REJECT: same count, different content (hash mismatch)", () => {
    const other = [
      { role: "user", text: "different" },
      { role: "assistant", text: "reply" },
    ];
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash, historyMessageCount: 2 },
      other,
    );
    assert(r.accept === false && r.reason === "historyHash", JSON.stringify(r));
  });

  test("prefix REJECT: current shorter than count", () => {
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash, historyMessageCount: 2 },
      [{ role: "user", text: "hi" }],
    );
    assert(r.accept === false && r.reason === "historyHash", JSON.stringify(r));
  });

  test("prefix REJECT: missing/null saved or empty historyHash", () => {
    assert(
      sessionHistoryPrefixAccepts(null, prefixMsgs).accept === false,
      "null saved",
    );
    assert(
      sessionHistoryPrefixAccepts(undefined, prefixMsgs).reason === "historyHash",
      "undefined saved",
    );
    assert(
      sessionHistoryPrefixAccepts({ historyHash: "", historyMessageCount: 2 }, prefixMsgs)
        .reason === "historyHash",
      "empty hash",
    );
    assert(
      sessionHistoryPrefixAccepts({ historyMessageCount: 2 }, prefixMsgs).reason ===
        "historyHash",
      "missing hash",
    );
  });

  test("prefix REJECT: corrupt historyMessageCount", () => {
    const cases = [-1, "3", 1.5, NaN, null];
    for (const bad of cases) {
      const r = sessionHistoryPrefixAccepts(
        { historyHash: prefixHash, historyMessageCount: bad },
        prefixMsgs,
      );
      assert(
        r.accept === false && r.reason === "historyMessageCount",
        `bad=${JSON.stringify(bad)} → ${JSON.stringify(r)}`,
      );
    }
  });

  test("prefix ACCEPT legacy: no historyMessageCount, full hash matches", () => {
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash },
      prefixMsgs,
    );
    assert(r.accept === true, JSON.stringify(r));
  });

  test("prefix REJECT legacy: no historyMessageCount, extra message fails exact", () => {
    const current = [...prefixMsgs, { role: "user", text: "extra" }];
    const r = sessionHistoryPrefixAccepts(
      { historyHash: prefixHash },
      current,
    );
    assert(r.accept === false && r.reason === "historyHash", JSON.stringify(r));
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

  test("buildKvDiagPayload reports restored hybrid tokens", () => {
    const hybridOk = buildKvDiagPayload({
      ok: true,
      tokensLoaded: 1635,
    });
    assert(hybridOk.ok === true, "hybrid ok");
    assert(hybridOk.tokens_on_disk === 1635, "hybrid tokens_on_disk");
    assert(hybridOk.n_past === 1635, "hybrid n_past is tokens_loaded");

    const denseOk = buildKvDiagPayload({
      ok: true,
      tokensLoaded: 1635,
    });
    assert(denseOk.n_past === 1635, "non-hybrid n_past is tokens_loaded");
    assert(denseOk.tokens_on_disk === 1635, "non-hybrid tokens_on_disk");
    assert(denseOk.ok === true, "non-hybrid ok");

    const fail = buildKvDiagPayload({
      ok: false,
      tokensLoaded: undefined,
    });
    assert(fail.ok === false, "fail ok");
    assert(fail.tokens_on_disk === 0, "fail tokens_on_disk defaults 0");
    assert(fail.n_past === 0, "fail hybrid n_past 0");

    const failDense = buildKvDiagPayload({
      ok: false,
      tokensLoaded: "nope",
    });
    assert(failDense.tokens_on_disk === 0, "non-number tokens_loaded → 0");
    assert(failDense.n_past === 0, "non-hybrid fail n_past 0");
  });

  test("session disk calibration rejects zero/missing/failed samples", () => {
    const empty = {};
    assert(sessionBytesPerTokenForModel(empty, "kexp") === null, "missing measurement");
    assert(
      recordSessionDiskSample(empty, {
        ok: true,
        modelId: "kexp",
        fileBytes: 10041119,
        usedTokens: 0,
      }) === empty,
      "zero tokens must not calibrate",
    );
    assert(
      recordSessionDiskSample(empty, {
        ok: true,
        modelId: "kexp",
        fileBytes: undefined,
        usedTokens: 1946,
      }) === empty,
      "missing file size must not calibrate",
    );
    assert(
      recordSessionDiskSample(empty, {
        ok: false,
        modelId: "kexp",
        fileBytes: 10041119,
        usedTokens: 1946,
      }) === empty,
      "failed save must not calibrate",
    );
    const measured = recordSessionDiskSample(empty, {
      ok: true,
      modelId: "kexp",
      fileBytes: 10041119,
      usedTokens: 1946,
    });
    assert(
      sessionBytesPerTokenForModel(measured, "kexp") === 10041119 / 1946,
      "successful save records bytes/token",
    );
    assert(
      estimateSessionBytes(1946, sessionBytesPerTokenForModel(measured, "kexp")) === 10041119,
      "next gate uses the measured rate",
    );
    assert(
      estimateSessionBytes(1, null) === SESSION_BYTES_PER_TOKEN,
      "missing rate uses the unmeasured default",
    );
    assert(
      sessionBytesPerTokenForModel(measured, "other") === null,
      "calibration is per model",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
