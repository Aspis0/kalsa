/**
 * Harness for src/engine/llamaContextGate.ts (shared chat/embed lifecycle gate).
 * Compile-from-disk. Exit 1 on fail.
 *
 * Cases: chat blocks embed, chat_loading blocks embed, embed releases → chat
 * acquirable, co-residency on 8GB+ 2B, co-residency refused on 4B / ≤6GB, reset.
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

  check("idle → tryAcquireChat → chat_loading", () => {
    assert(getState() === "idle", `start idle, got ${getState()}`);
    assert(tryAcquireChat() === true, "chat acquire");
    assert(getState() === "chat_loading", `got ${getState()}`);
  });

  check("chat_loading blocks embed", () => {
    assert(tryAcquireChat() === true, "chat");
    assert(tryAcquireEmbed() === false, "embed must refuse during chat_loading");
    assert(getState() === "chat_loading", `state ${getState()}`);
  });

  check("chat_ready blocks embed without co-residency", () => {
    setCoResidencyContext({ totalMemoryBytes: 4e9, chatModelIs2B: true });
    assert(tryAcquireChat() === true, "chat");
    markChatReady();
    assert(getState() === "chat_ready", `got ${getState()}`);
    assert(tryAcquireEmbed() === false, "embed must refuse on ≤6GB chat_ready");
  });

  check("embed_active blocks chat without co-residency", () => {
    setCoResidencyContext({ totalMemoryBytes: 4e9, chatModelIs2B: false });
    assert(tryAcquireEmbed() === true, "embed");
    assert(getState() === "embed_active", `got ${getState()}`);
    assert(tryAcquireChat() === false, "chat must refuse while embed_active");
  });

  check("releaseEmbed → chat acquirable", () => {
    assert(tryAcquireEmbed() === true, "embed");
    releaseEmbed();
    assert(getState() === "idle", `got ${getState()}`);
    assert(tryAcquireChat() === true, "chat after release");
    assert(getState() === "chat_loading", `got ${getState()}`);
  });

  check("markChatReleased returns to idle", () => {
    assert(tryAcquireChat() === true, "chat");
    markChatReady();
    markChatReleased();
    assert(getState() === "idle", `got ${getState()}`);
  });

  check("markChatReleased after failed load (chat_loading → idle)", () => {
    assert(tryAcquireChat() === true, "chat");
    assert(getState() === "chat_loading", "loading");
    markChatReleased();
    assert(getState() === "idle", `got ${getState()}`);
  });

  check("§5 co-residency: 8GB+ 2B allows embed while chat_ready", () => {
    setCoResidencyContext({ totalMemoryBytes: 8e9, chatModelIs2B: true });
    assert(allowsCoResidency() === true, "allowsCoResidency");
    assert(tryAcquireChat() === true, "chat");
    markChatReady();
    assert(tryAcquireEmbed() === true, "embed co-reside");
    // state stays chat_ready under co-residency
    assert(getState() === "chat_ready", `got ${getState()}`);
    releaseEmbed();
    assert(getState() === "chat_ready", "still chat_ready after releaseEmbed");
  });

  check("§5 co-residency refused for 4B even on 8GB+", () => {
    setCoResidencyContext({ totalMemoryBytes: 8e9, chatModelIs2B: false });
    assert(allowsCoResidency() === false, "no co-res for 4B");
    assert(tryAcquireChat() === true, "chat");
    markChatReady();
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
    tryAcquireChat();
    markChatReady();
    tryAcquireEmbed();
    __resetForTests();
    assert(getState() === "idle", `got ${getState()}`);
    assert(allowsCoResidency() === false, "co-res cleared");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
