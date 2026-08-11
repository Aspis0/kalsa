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
    isEmbedHeld,
    __resetForTests,
    CO_RESIDENCY_MIN_MEMORY_BYTES,
    runNativeOp,
    nativeOpBusy,
    acquireNativeOpBounded,
    __resetNativeOpMutexForTests,
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

  // ── FIX 2 / round 7: force handoff REMOVED (block-not-proceed) ──────────
  check("forceChatAcquireAfterEmbedTimeout is not exported (block policy)", () => {
    assert(
      typeof mod.forceChatAcquireAfterEmbedTimeout !== "function",
      "force handoff must be removed — chat must not proceed after embed hang",
    );
    assert(
      typeof mod.abandonNativeOpChain !== "function",
      "abandonNativeOpChain must not be exported — hung op holds the chain",
    );
  });

  check("embed-held without co-res refuses chat acquire (no force path)", () => {
    setCoResidencyContext({ totalMemoryBytes: 4e9, chatModelIs2B: false });
    assert(tryAcquireEmbed() === true, "embed held");
    assert(getState() === "embed_active", `got ${getState()}`);
    assert(tryAcquireChat() === null, "normal acquire refused without co-res");
    // Gate stays embed_active — caller must releaseEmbedder then re-claim;
    // on release timeout AppShell marks hung and refuses chat (no force).
    assert(getState() === "embed_active", "still embed_active after refused chat");
  });

  // ── Shared native-op barrier (round 6) ──────────────────────────────────
  async function checkAsync(name, fn) {
    try {
      __resetForTests();
      await fn();
      console.log(`PASS ${name}`);
      passed++;
    } catch (e) {
      console.log(`FAIL ${name} — ${e && e.message ? e.message : e}`);
      failed++;
    }
  }

  await checkAsync("runNativeOp serializes two ops strictly sequential", async () => {
    assert(typeof runNativeOp === "function", "runNativeOp exported");
    assert(typeof nativeOpBusy === "function", "nativeOpBusy exported");
    const order = [];
    let releaseA;
    const aGate = new Promise((r) => {
      releaseA = r;
    });
    const pA = runNativeOp(async () => {
      order.push("a-start");
      assert(nativeOpBusy() === true, "busy during A");
      await aGate;
      order.push("a-end");
      return "A";
    });
    // Let A start.
    await new Promise((r) => setImmediate(r));
    assert(nativeOpBusy() === true, "busy after A start");
    const pB = runNativeOp(async () => {
      order.push("b-start");
      order.push("b-end");
      return "B";
    });
    // B must not have started while A holds the mutex.
    await new Promise((r) => setImmediate(r));
    assert(order.includes("a-start"), "A started");
    assert(!order.includes("b-start"), "B must wait for A");
    releaseA();
    const [ra, rb] = await Promise.all([pA, pB]);
    assert(ra === "A" && rb === "B", `results ${ra}/${rb}`);
    assert(
      order.join(",") === "a-start,a-end,b-start,b-end",
      `order ${order.join(",")}`,
    );
    assert(nativeOpBusy() === false, "idle after both settle");
  });

  await checkAsync("runNativeOp failure does not break the queue", async () => {
    let secondRan = false;
    const p1 = runNativeOp(async () => {
      throw new Error("boom");
    });
    const p2 = runNativeOp(async () => {
      secondRan = true;
      return 42;
    });
    let caught = false;
    try {
      await p1;
    } catch (e) {
      caught = e && e.message === "boom";
    }
    assert(caught, "first rejects to caller");
    const r2 = await p2;
    assert(r2 === 42 && secondRan === true, "second still runs after failure");
    assert(nativeOpBusy() === false, "idle after failure chain");
  });

  await checkAsync("hung op holds the chain — new op queues, busy stays true", async () => {
    // Round 7: never clear the chain while an op is in flight. A hung op
    // keeps busy=true and queued ops wait behind it (no overlap).
    let releaseA;
    const aGate = new Promise((r) => {
      releaseA = r;
    });
    const pA = runNativeOp(async () => {
      await aGate;
      return "A";
    });
    await new Promise((r) => setImmediate(r));
    assert(nativeOpBusy() === true, "busy while A in flight");
    let bStarted = false;
    const pB = runNativeOp(async () => {
      bStarted = true;
      return "B";
    });
    // B must not start while A holds the mutex (queued behind hung/in-flight).
    await new Promise((r) => setImmediate(r));
    assert(nativeOpBusy() === true, "busy stays true while A holds chain");
    assert(bStarted === false, "B must not start while A is hung/in-flight");
    // No abandon API in production — only test reset can clear (below).
    assert(
      typeof mod.abandonNativeOpChain !== "function",
      "no production chain-clear on hung",
    );
    releaseA();
    const [ra, rb] = await Promise.all([pA, pB]);
    assert(ra === "A" && rb === "B", `results ${ra}/${rb}`);
    assert(bStarted === true, "B ran after A settled");
    assert(nativeOpBusy() === false, "idle after both settle");
  });

  check("__resetNativeOpMutexForTests clears busy", () => {
    assert(typeof __resetNativeOpMutexForTests === "function", "reset export");
    // Fire-and-forget an op that would stay busy if not reset properly is
    // hard without await; just ensure reset is idempotent + busy false.
    __resetNativeOpMutexForTests();
    assert(nativeOpBusy() === false, "busy false after reset");
    __resetForTests();
    assert(nativeOpBusy() === false, "__resetForTests also clears native mutex");
  });

  // ── Round 8 FIX 1: acquireNativeOpBounded (no enqueue) ─────────────────
  await checkAsync("acquireNativeOpBounded returns ok when queue free", async () => {
    assert(typeof acquireNativeOpBounded === "function", "acquireNativeOpBounded exported");
    assert(nativeOpBusy() === false, "start idle");
    const r = await acquireNativeOpBounded(100);
    assert(r === "ok", `expected ok, got ${r}`);
    assert(nativeOpBusy() === false, "still idle — must not enqueue");
  });

  await checkAsync("acquireNativeOpBounded times out while hung op holds chain", async () => {
    let releaseA;
    const aGate = new Promise((r) => {
      releaseA = r;
    });
    const pA = runNativeOp(async () => {
      await aGate;
      return "A";
    });
    await new Promise((r) => setImmediate(r));
    assert(nativeOpBusy() === true, "busy while A holds");
    const t0 = Date.now();
    const r = await acquireNativeOpBounded(80);
    const elapsed = Date.now() - t0;
    assert(r === "timeout", `expected timeout, got ${r}`);
    assert(elapsed >= 60, `should wait ~timeout, elapsed=${elapsed}`);
    assert(nativeOpBusy() === true, "still busy — wait must not clear chain");
    // No extra op was enqueued: only A is on the chain. A second runNativeOp
    // would start only after A settles; we assert bStarted remains false if we
    // only used acquireNativeOpBounded (no runNativeOp from the wait).
    releaseA();
    await pA;
    assert(nativeOpBusy() === false, "idle after A settles");
  });

  await checkAsync("acquireNativeOpBounded ok when busy op finishes before deadline", async () => {
    let releaseA;
    const aGate = new Promise((r) => {
      releaseA = r;
    });
    const pA = runNativeOp(async () => {
      await aGate;
      return "A";
    });
    await new Promise((r) => setImmediate(r));
    assert(nativeOpBusy() === true, "busy");
    // Release A soon; bounded wait should observe free before long timeout.
    setTimeout(() => releaseA(), 30);
    const r = await acquireNativeOpBounded(2000);
    assert(r === "ok", `expected ok after A finishes, got ${r}`);
    await pA;
    assert(nativeOpBusy() === false, "idle");
  });

  await checkAsync(
    "co-res + hung embed: acquireNativeOpBounded refuses without queue growth",
    async () => {
      // Simulates AppShell co-res path: chat acquired while embed_active, then
      // a hung native embed holds the FIFO. Repeated acquireNativeOpBounded
      // must return timeout and must NOT enqueue ops (queue must not grow).
      setCoResidencyContext({ totalMemoryBytes: 8e9, chatModelIs2B: true });
      assert(tryAcquireEmbed() === true, "embed held");
      assert(getState() === "embed_active", "embed_active");
      const chatGen = tryAcquireChat();
      assert(chatGen !== null, "co-res chat acquire ok");
      assert(getState() === "chat_loading", "chat_loading under co-res");

      let releaseHung;
      const hungGate = new Promise((r) => {
        releaseHung = r;
      });
      // Hung embed-like op on the native queue.
      const pHung = runNativeOp(async () => {
        await hungGate;
        return "HUNG";
      });
      await new Promise((r) => setImmediate(r));
      assert(nativeOpBusy() === true, "hung op busy");

      // Track whether any extra op starts (would mean queue growth / enqueue).
      let extraStarted = 0;
      // Three repeated "chat init" attempts — only acquireNativeOpBounded, no
      // runNativeOp(initEngine). Each must timeout; no extras may start.
      for (let i = 0; i < 3; i++) {
        const r = await acquireNativeOpBounded(40);
        assert(r === "timeout", `attempt ${i + 1}: expected timeout, got ${r}`);
      }
      // Enqueue a probe only after the three refusals — it must still be
      // waiting behind the hung op (not started), proving the three waits
      // did not grow a runnable queue of init ops.
      const pProbe = runNativeOp(async () => {
        extraStarted += 1;
        return "PROBE";
      });
      await new Promise((r) => setImmediate(r));
      assert(extraStarted === 0, "probe must not start while hung holds chain");
      assert(nativeOpBusy() === true, "still busy after repeated refusals");

      releaseHung();
      await pHung;
      const probeResult = await pProbe;
      assert(probeResult === "PROBE" && extraStarted === 1, "probe runs once after hung settles");
      markChatReleased(chatGen);
    },
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
