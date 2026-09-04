/**
 * Harness for shouldSaveSession + kvReproducibility state machine.
 *
 * Pure save-gate: precedence of reason strings (no_context, disposing,
 * kv_not_chat, kv_not_reproducible) and the happy path.
 * Plus sticky-flag EVENT TRACES (A1 tool-round, A2 miniapp strip, recovery).
 * No llama.rn.
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
      "src/engine/ttftFlags.ts",
      "src/engine/kvReproducibility.ts",
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

function resolveBuilt(baseName) {
  const candidates = [
    path.join(outDir, `${baseName}.js`),
    path.join(outDir, "engine", `${baseName}.js`),
    path.join(outDir, "src/engine", `${baseName}.js`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${baseName}.js. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Run an event trace from the initial pure state. */
function runTrace(events, nextKvReproState, INITIAL_KV_REPRO_STATE) {
  let state = { ...INITIAL_KV_REPRO_STATE };
  for (const e of events) {
    state = nextKvReproState(state, e);
  }
  return state;
}

function gateFromState(state, shouldSaveSession) {
  return shouldSaveSession({
    hasContext: true,
    disposing: false,
    kvHoldsChatSession: true,
    kvReproducible: state.reproducible,
  });
}

async function main() {
  console.log("Compiling sessionPersistence.ts + kvReproducibility.ts …");
  compile();
  const gatePath = resolveBuilt("sessionPersistence");
  const reproPath = resolveBuilt("kvReproducibility");
  console.log("Loading", gatePath);
  console.log("Loading", reproPath);
  const {
    shouldSaveSession,
    isSameSessionSave,
    rememberSuccessfulSessionSave,
    estimateSessionBytes,
    resolveSessionDiskTokens,
    sessionDiskBytesRequired,
    SESSION_DISK_GATE_USED_TOKENS,
    SESSION_BYTES_PER_TOKEN,
    SESSION_DISK_MARGIN,
    SESSION_DISK_FLOOR_BYTES,
    SESSION_DISK_TOKEN_FLOOR,
    SESSION_DISK_TOKENS_PER_HISTORY_MSG,
  } = await import(pathToFileURL(gatePath).href);
  const { nextKvReproState, INITIAL_KV_REPRO_STATE } = await import(
    pathToFileURL(reproPath).href,
  );

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

  test("session save fingerprint skips only an identical successful save", () => {
    const first = { stem: "kexp__conv", historyHash: "hash-a", usedTokens: 0 };
    assert(!isSameSessionSave(null, first), "no previous save must write");
    const failed = rememberSuccessfulSessionSave(null, first, false);
    assert(failed === null, "failed save must not become the previous save");
    assert(!isSameSessionSave(failed, first), "failed save fingerprint must not skip");
    const saved = rememberSuccessfulSessionSave(null, first, true);
    assert(isSameSessionSave(saved, first), "identical save skips");
    assert(
      !isSameSessionSave(saved, { ...first, historyHash: "hash-b" }),
      "changed hash must still write",
    );
    assert(
      !isSameSessionSave(saved, { ...first, usedTokens: 1 }),
      "changed token count must still write",
    );
    assert(
      !isSameSessionSave(saved, { ...first, stem: "other__conv" }),
      "changed stem must still write",
    );
  });

  // ── Event traces over the state machine (A1 / A2 invariants) ────────────
  // The whole point: clean_completion after tool_calls_detected must stay false
  // (turnInjected guard lives in the pure reducer, not simulated by the harness).

  test("trace: tool turn final emit stays non-reproducible → gate refuses", () => {
    const events = ["turn_start", "tool_calls_detected", "clean_completion"];
    const state = runTrace(events, nextKvReproState, INITIAL_KV_REPRO_STATE);
    assert(state.reproducible === false, `expected false, got ${JSON.stringify(state)}`);
    const gate = gateFromState(state, shouldSaveSession);
    assert(gate.save === false && gate.reason === "kv_not_reproducible", JSON.stringify(gate));
  });

  test("trace: recovery after tool turn → gate allows", () => {
    const events = [
      "turn_start",
      "tool_calls_detected",
      "clean_completion",
      "turn_start",
      "clean_completion",
    ];
    const state = runTrace(events, nextKvReproState, INITIAL_KV_REPRO_STATE);
    assert(state.reproducible === true, `expected true, got ${JSON.stringify(state)}`);
    const gate = gateFromState(state, shouldSaveSession);
    assert(gate.save === true && gate.reason === undefined, JSON.stringify(gate));
  });

  test("trace: A2 miniapp strip recovery → gate allows", () => {
    const events = [
      "turn_start",
      "clean_completion",
      "miniapp_stripped",
      "turn_start",
      "clean_completion",
    ];
    const state = runTrace(events, nextKvReproState, INITIAL_KV_REPRO_STATE);
    assert(state.reproducible === true, `expected true, got ${JSON.stringify(state)}`);
    const gate = gateFromState(state, shouldSaveSession);
    assert(gate.save === true && gate.reason === undefined, JSON.stringify(gate));
  });

  test("trace: combined tool + miniapp then clean → true", () => {
    const events = [
      "turn_start",
      "tool_calls_detected",
      "turn_start",
      "miniapp_stripped",
      "turn_start",
      "clean_completion",
    ];
    const state = runTrace(events, nextKvReproState, INITIAL_KV_REPRO_STATE);
    assert(state.reproducible === true, `expected true, got ${JSON.stringify(state)}`);
  });

  test("trace: abort after tool turn (stickiness) → false", () => {
    const events = ["turn_start", "tool_calls_detected", "turn_start"];
    const state = runTrace(events, nextKvReproState, INITIAL_KV_REPRO_STATE);
    assert(state.reproducible === false, `expected false, got ${JSON.stringify(state)}`);
  });

  test("trace: dispose after tools → true", () => {
    const events = ["turn_start", "tool_calls_detected", "dispose"];
    const state = runTrace(events, nextKvReproState, INITIAL_KV_REPRO_STATE);
    assert(state.reproducible === true, `expected true, got ${JSON.stringify(state)}`);
    assert(state.turnInjected === false, `turnInjected should clear on dispose`);
  });

  test("trace: miniapp strip alone → gate refuses", () => {
    const events = ["turn_start", "clean_completion", "miniapp_stripped"];
    const state = runTrace(events, nextKvReproState, INITIAL_KV_REPRO_STATE);
    assert(state.reproducible === false, `expected false, got ${JSON.stringify(state)}`);
    const gate = gateFromState(state, shouldSaveSession);
    assert(gate.save === false && gate.reason === "kv_not_reproducible", JSON.stringify(gate));
  });

  test("trace: clean turn only → gate allows (no over-block)", () => {
    const events = ["turn_start", "clean_completion"];
    const state = runTrace(events, nextKvReproState, INITIAL_KV_REPRO_STATE);
    assert(state.reproducible === true, `expected true, got ${JSON.stringify(state)}`);
    const gate = gateFromState(state, shouldSaveSession);
    assert(gate.save === true, JSON.stringify(gate));
  });

  // ── P1-2 / V2-0.2: disk-gate on used tokens, not full nCtx ──────────────
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

  console.log(`\nsessionSaveGateHarness: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log("All sessionSaveGate harness cases passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
