/**
 * Harness for src/engine/llamaContextGate.ts (shared chat/embed lifecycle gate).
 * Compile-from-disk. Exit 1 on fail.
 *
 * Cases: chat blocks embed, chat_loading blocks embed, embed releases → chat
 * acquirable, co-residency on 8GB+ 2B, co-residency refused on 4B / ≤6GB,
 * ownership tokens (stale release, double-acquire), reset.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const outDir = path.join(projectRoot, "scripts/.build/llamaContextGateHarness");

function compile() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const r = spawnSync(
    "npx",
    [
      "tsc",
      "src/engine/llamaContextGate.ts",
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
    path.join(outDir, "llamaContextGate.js"),
    path.join(outDir, "engine/llamaContextGate.js"),
    path.join(outDir, "src/engine/llamaContextGate.js"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error("Could not find compiled llamaContextGate.js. Tried:\n", candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling llamaContextGate.ts …");
  compile();
  const modPath = resolveBuilt();
  console.log("Loading", modPath);
  const mod = require(modPath);
  const {
    tryAcquireChat,
    markChatReady,
    markChatReleased,
    tryAcquireEmbed,
    releaseEmbed,
    getState,
    getChatGeneration,
    setCoResidencyContext,
    allowsCoResidency,
    isChatModel2BClass,
    isChatModel4BClass,
    __resetForTests,
    CO_RESIDENCY_MIN_MEMORY_BYTES,
  } = mod;

  let passed = 0;
  let failed = 0;
  function check(name, fn) {
    try {
      __resetForTests();
      fn();
      console.log(`PASS ${name}`);
      passed++;
    } catch (e) {
      console.log(`FAIL ${name} — ${e && e.message ? e.message : e}`);
      failed++;
    }
  }

  check("idle → tryAcquireChat → chat_loading (returns gen)", () => {
    assert(getState() === "idle", `start idle, got ${getState()}`);
    const gen = tryAcquireChat();
    assert(typeof gen === "number" && gen > 0, `gen number, got ${gen}`);
    assert(getState() === "chat_loading", `got ${getState()}`);
    assert(getChatGeneration() === gen, "getChatGeneration matches");
  });

  check("chat_loading blocks embed", () => {
    const gen = tryAcquireChat();
    assert(gen !== null, "chat");
    assert(tryAcquireEmbed() === false, "embed must refuse during chat_loading");
    assert(getState() === "chat_loading", `state ${getState()}`);
  });

  check("chat_ready blocks embed without co-residency", () => {
    setCoResidencyContext({ totalMemoryBytes: 4e9, chatModelIs2B: true });
    const gen = tryAcquireChat();
    assert(gen !== null, "chat");
    markChatReady(gen);
    assert(getState() === "chat_ready", `got ${getState()}`);
    assert(tryAcquireEmbed() === false, "embed must refuse on ≤6GB chat_ready");
  });

  check("embed_active blocks chat without co-residency", () => {
    setCoResidencyContext({ totalMemoryBytes: 4e9, chatModelIs2B: false });
    assert(tryAcquireEmbed() === true, "embed");
    assert(getState() === "embed_active", `got ${getState()}`);
    assert(tryAcquireChat() === null, "chat must refuse while embed_active");
  });

  check("releaseEmbed → chat acquirable", () => {
    assert(tryAcquireEmbed() === true, "embed");
    releaseEmbed();
    assert(getState() === "idle", `got ${getState()}`);
    const gen = tryAcquireChat();
    assert(gen !== null, "chat after release");
    assert(getState() === "chat_loading", `got ${getState()}`);
  });

  check("markChatReleased returns to idle", () => {
    const gen = tryAcquireChat();
    assert(gen !== null, "chat");
    markChatReady(gen);
    markChatReleased(gen);
    assert(getState() === "idle", `got ${getState()}`);
  });

  check("markChatReleased after failed load (chat_loading → idle)", () => {
    const gen = tryAcquireChat();
    assert(gen !== null, "chat");
    assert(getState() === "chat_loading", "loading");
    markChatReleased(gen);
    assert(getState() === "idle", `got ${getState()}`);
  });

  check("§5 co-residency: 8GB+ 2B allows embed while chat_ready", () => {
    setCoResidencyContext({ totalMemoryBytes: 8e9, chatModelIs2B: true });
    assert(allowsCoResidency() === true, "allowsCoResidency");
    const gen = tryAcquireChat();
    assert(gen !== null, "chat");
    markChatReady(gen);
    assert(tryAcquireEmbed() === true, "embed co-reside");
    // state stays chat_ready under co-residency
    assert(getState() === "chat_ready", `got ${getState()}`);
    releaseEmbed();
    assert(getState() === "chat_ready", "still chat_ready after releaseEmbed");
  });

  check("§5 co-residency refused for 4B even on 8GB+", () => {
    setCoResidencyContext({ totalMemoryBytes: 8e9, chatModelIs2B: false });
    assert(allowsCoResidency() === false, "no co-res for 4B");
    const gen = tryAcquireChat();
    assert(gen !== null, "chat");
    markChatReady(gen);
    assert(tryAcquireEmbed() === false, "embed refused for 4B");
  });

  check("isChatModel2BClass / isChatModel4BClass helpers", () => {
    assert(isChatModel2BClass("qwen3.5-2b") === true, "2b");
    assert(isChatModel2BClass("gemma-4-e2b") === true, "e2b");
    assert(isChatModel2BClass("qwen3.5-4b") === false, "4b not 2b");
    assert(isChatModel4BClass("qwen3.5-4b") === true, "4b");
    assert(isChatModel4BClass("qwen3.5-4b-q3") === true, "4b-q3");
    assert(isChatModel4BClass("qwen3.5-2b") === false, "2b not 4b");
    assert(isChatModel2BClass(null) === false, "null");
  });

  check("CO_RESIDENCY_MIN_MEMORY_BYTES is 6e9", () => {
    assert(CO_RESIDENCY_MIN_MEMORY_BYTES === 6e9, `got ${CO_RESIDENCY_MIN_MEMORY_BYTES}`);
  });

  check("__resetForTests clears everything", () => {
    setCoResidencyContext({ totalMemoryBytes: 8e9, chatModelIs2B: true });
    const gen = tryAcquireChat();
    markChatReady(gen);
    tryAcquireEmbed();
    __resetForTests();
    assert(getState() === "idle", `got ${getState()}`);
    assert(allowsCoResidency() === false, "co-res cleared");
    assert(getChatGeneration() === 0, "gen cleared");
  });

  // ── FIX 1: ownership tokens ─────────────────────────────────────────────
  check("double-acquire rejected while chat_loading", () => {
    const gen1 = tryAcquireChat();
    assert(gen1 !== null && gen1 > 0, "first acquire");
    assert(getState() === "chat_loading", "loading");
    const gen2 = tryAcquireChat();
    assert(gen2 === null, "second acquire must return null");
    assert(getState() === "chat_loading", "still loading");
    assert(getChatGeneration() === gen1, "gen unchanged");
  });

  check("double-acquire rejected while chat_ready", () => {
    const gen1 = tryAcquireChat();
    markChatReady(gen1);
    assert(getState() === "chat_ready", "ready");
    const gen2 = tryAcquireChat();
    assert(gen2 === null, "second acquire must return null");
    assert(getState() === "chat_ready", "still ready");
  });

  check("stale release after new gen acquired cannot idle newer load", () => {
    const oldGen = tryAcquireChat();
    assert(oldGen !== null, "old gen");
    // Simulate: old load cancelled conceptually, but we acquire a NEW gen only
    // after releasing the old one properly. Force the race: release old, acquire new,
    // then a late stale release of old must not affect new.
    markChatReleased(oldGen);
    assert(getState() === "idle", "idle after proper release");
    const newGen = tryAcquireChat();
    assert(newGen !== null && newGen > oldGen, `new gen ${newGen} > old ${oldGen}`);
    assert(getState() === "chat_loading", "new load loading");
    // Stale release of old gen — must be a no-op.
    markChatReleased(oldGen);
    assert(getState() === "chat_loading", "still chat_loading after stale release");
    markChatReady(newGen);
    assert(getState() === "chat_ready", "new gen ready");
    // Stale ready of old gen — no-op.
    markChatReady(oldGen);
    assert(getState() === "chat_ready", "still ready");
    // Stale release of old while ready — no-op.
    markChatReleased(oldGen);
    assert(getState() === "chat_ready", "stale release cannot idle ready");
    // Proper release of new gen.
    markChatReleased(newGen);
    assert(getState() === "idle", "idle after new gen release");
  });

  check("stale markChatReady cannot promote a different gen", () => {
    const gen1 = tryAcquireChat();
    markChatReleased(gen1);
    const gen2 = tryAcquireChat();
    // Stale ready for gen1 while gen2 is loading.
    markChatReady(gen1);
    assert(getState() === "chat_loading", "stale ready must not promote");
    markChatReady(gen2);
    assert(getState() === "chat_ready", "current gen ready");
  });

  check("gens are monotonic", () => {
    const a = tryAcquireChat();
    markChatReleased(a);
    const b = tryAcquireChat();
    markChatReleased(b);
    const c = tryAcquireChat();
    assert(a < b && b < c, `monotonic ${a}<${b}<${c}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
