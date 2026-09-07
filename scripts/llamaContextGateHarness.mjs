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
    markChatCompleting,
    markChatCompletingDone,
    isChatCompleting,
    markEmbedInitializing,
    markEmbedInitializingDone,
    markEmbedInFlight,
    markEmbedInFlightDone,
    isEmbedInitializing,
    isEmbedInFlight,
    shouldRefuseEmbedInitOrRelease,
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
    runNativeOpBounded,
    nativeOpBusy,
    isNativeOpChainEmpty,
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
    assert(isChatModel2BClass("lfm2.5-2.6b") === true, "2b class");
    assert(isChatModel2BClass("removed-model") === false, "unknown");
    assert(isChatModel2BClass("qwen3.5-4b") === false, "4b not 2b");
    assert(isChatModel4BClass("qwen3.5-4b") === true, "4b");
    assert(isChatModel4BClass("lfm2.5-2.6b") === false, "2b not 4b");
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

  // Round-8 FIX 1: chatCompleting is a no-op; embedInitializing blocks NEW init.
  // document_chat runs inside a chat completion and must lazy-init the embedder.
  check("chatCompleting is no-op — does NOT block tryAcquireEmbed", () => {
    assert(typeof markChatCompleting === "function", "markChatCompleting exported");
    assert(typeof markChatCompletingDone === "function", "markChatCompletingDone exported");
    assert(isChatCompleting() === false, "always false (legacy no-op)");
    // Co-residency would otherwise allow embed under chat_ready.
    setCoResidencyContext({ totalMemoryBytes: 8e9, chatModelIs2B: true });
    const gen = tryAcquireChat();
    assert(gen !== null, "chat");
    markChatReady(gen);
    assert(tryAcquireEmbed() === true, "embed ok before completing");
    releaseEmbed();
    markChatCompleting();
    assert(isChatCompleting() === false, "still false after mark (no-op)");
    assert(tryAcquireEmbed() === true, "embed ALLOWED while chatCompleting (FIX 1)");
    releaseEmbed();
    markChatCompletingDone();
    assert(tryAcquireEmbed() === true, "embed ok after done");
  });

  check("chatCompleting does not block embed from idle", () => {
    markChatCompleting();
    assert(tryAcquireEmbed() === true, "idle+completing ALLOWS embed (FIX 1)");
    releaseEmbed();
    markChatCompletingDone();
    assert(tryAcquireEmbed() === true, "idle after done allows embed");
  });

  check("embedInitializing blocks tryAcquireEmbed (init race surface)", () => {
    assert(typeof markEmbedInitializing === "function", "markEmbedInitializing exported");
    assert(typeof isEmbedInitializing === "function", "isEmbedInitializing exported");
    assert(isEmbedInitializing() === false, "starts false");
    assert(isEmbedInFlight() === false, "inFlight starts false");
    assert(tryAcquireEmbed() === true, "embed ok before init flag");
    releaseEmbed();
    markEmbedInitializing();
    assert(isEmbedInitializing() === true, "init flag set");
    assert(isEmbedInFlight() === true, "inFlight set with init");
    assert(tryAcquireEmbed() === false, "embed refused while embedInitializing");
    assert(shouldRefuseEmbedInitOrRelease() === true, "refuse init/release");
    markEmbedInitializingDone();
    // after Done, initializing cleared but inFlight may still be true depending
    // on API — markEmbedInitializingDone only clears initializing.
    assert(isEmbedInitializing() === false, "init cleared");
    // Clear inFlight fully.
    markEmbedInFlightDone();
    assert(isEmbedInFlight() === false, "inFlight cleared");
    assert(tryAcquireEmbed() === true, "embed ok after init done");
  });

  check("embed USE path is not blocked by chat completion under co-residency", () => {
    // Simulates hybrid retrieval during document_chat tool loop:
    // chat is ready + completing, embed must still acquire.
    setCoResidencyContext({ totalMemoryBytes: 8e9, chatModelIs2B: true });
    const gen = tryAcquireChat();
    assert(gen !== null, "chat");
    markChatReady(gen);
    markChatCompleting(); // no-op, but still called by LlamaService
    assert(tryAcquireEmbed() === true, "lazy-init ALLOWED during chat completion");
    // USE: already held, re-entrant
    assert(tryAcquireEmbed() === true, "re-entrant use ok");
    releaseEmbed();
    markChatCompletingDone();
  });

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

  // ── Round 9: runNativeOpBounded (atomic check-and-submit) ──────────────
  await checkAsync("runNativeOpBounded empty chain → runs immediately (ok, value)", async () => {
    assert(typeof runNativeOpBounded === "function", "runNativeOpBounded exported");
    assert(typeof isNativeOpChainEmpty === "function", "isNativeOpChainEmpty exported");
    assert(isNativeOpChainEmpty() === true, "start empty");
    assert(nativeOpBusy() === false, "start idle");
    const r = await runNativeOpBounded(async () => 42, 100);
    assert(r.ok === true, `expected ok, got ${JSON.stringify(r)}`);
    assert(r.ok && r.value === 42, `value 42, got ${r.ok ? r.value : "?"}`);
    assert(isNativeOpChainEmpty() === true, "empty after settle");
    assert(nativeOpBusy() === false, "idle after settle");
  });

  await checkAsync(
    "runNativeOpBounded hung predecessor → timeout WITHOUT growing chain",
    async () => {
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
      assert(isNativeOpChainEmpty() === false, "chain non-empty while A holds");

      let boundedStarted = false;
      const t0 = Date.now();
      const r = await runNativeOpBounded(async () => {
        boundedStarted = true;
        return "BOUNDED";
      }, 80);
      const elapsed = Date.now() - t0;
      assert(r.ok === false && r.refused === "timeout", `expected timeout, got ${JSON.stringify(r)}`);
      assert(elapsed >= 60, `should wait ~timeout, elapsed=${elapsed}`);
      assert(boundedStarted === false, "bounded fn must NOT run on timeout");
      assert(nativeOpBusy() === true, "still busy — refuse must not clear chain");
      assert(isNativeOpChainEmpty() === false, "chain still non-empty (predecessor only)");

      // After refusal the chain must still be just the hung predecessor: a
      // probe enqueued now waits behind A and does not start until A settles.
      let probeStarted = false;
      const pProbe = runNativeOp(async () => {
        probeStarted = true;
        return "PROBE";
      });
      await new Promise((r) => setImmediate(r));
      assert(probeStarted === false, "probe waits behind hung A");

      releaseA();
      await pA;
      const probeResult = await pProbe;
      assert(probeResult === "PROBE" && probeStarted === true, "probe runs after A");
      assert(nativeOpBusy() === false, "idle after A+probe settle");
      assert(isNativeOpChainEmpty() === true, "empty after settle");
    },
  );

  await checkAsync(
    "runNativeOpBounded short predecessor → waits then runs (ok)",
    async () => {
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
      // Release A soon; bounded should observe empty and submit before deadline.
      setTimeout(() => releaseA(), 30);
      const r = await runNativeOpBounded(async () => "BOUNDED", 2000);
      assert(r.ok === true && r.value === "BOUNDED", `expected ok/BOUNDED, got ${JSON.stringify(r)}`);
      await pA;
      assert(nativeOpBusy() === false, "idle");
      assert(isNativeOpChainEmpty() === true, "empty");
    },
  );

  await checkAsync(
    "repeated runNativeOpBounded refusals do not accumulate queued ops",
    async () => {
      // Simulates AppShell co-res path: chat acquired while embed_active, then
      // a hung native embed holds the FIFO. Repeated runNativeOpBounded must
      // return timeout and must NOT enqueue ops (queue must not grow).
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
      const pHung = runNativeOp(async () => {
        await hungGate;
        return "HUNG";
      });
      await new Promise((r) => setImmediate(r));
      assert(nativeOpBusy() === true, "hung op busy");
      assert(isNativeOpChainEmpty() === false, "non-empty");

      let extraStarted = 0;
      for (let i = 0; i < 3; i++) {
        const r = await runNativeOpBounded(async () => {
          extraStarted += 1;
          return "INIT";
        }, 40);
        assert(
          r.ok === false && r.refused === "timeout",
          `attempt ${i + 1}: expected timeout, got ${JSON.stringify(r)}`,
        );
      }
      assert(extraStarted === 0, "no init fn ran across 3 refusals");
      assert(nativeOpBusy() === true, "still busy after repeated refusals");
      assert(isNativeOpChainEmpty() === false, "chain still only hung predecessor");

      // Probe: only one extra op if we enqueue now — proves refusals did not
      // leave orphaned init ops on the chain.
      const pProbe = runNativeOp(async () => {
        extraStarted += 1;
        return "PROBE";
      });
      await new Promise((r) => setImmediate(r));
      assert(extraStarted === 0, "probe must not start while hung holds chain");

      releaseHung();
      await pHung;
      const probeResult = await pProbe;
      assert(probeResult === "PROBE" && extraStarted === 1, "probe runs once after hung settles");
      markChatReleased(chatGen);
    },
  );

  await checkAsync(
    "strict deadline: predecessor frees after deadline → still refused",
    async () => {
      // Craft: hung predecessor holds the chain past the deadline. Bounded
      // loop wakes after deadline with chain still non-empty → refuse. Then
      // release predecessor; a fresh empty-chain bounded call succeeds.
      // Deterministic: never free the predecessor until AFTER the timeout
      // result is observed (so late wake cannot accidentally see empty).
      let releaseA;
      const aGate = new Promise((r) => {
        releaseA = r;
      });
      const pA = runNativeOp(async () => {
        await aGate;
        return "A";
      });
      await new Promise((r) => setImmediate(r));
      assert(isNativeOpChainEmpty() === false, "non-empty");

      let boundedRan = false;
      const r = await runNativeOpBounded(async () => {
        boundedRan = true;
        return "LATE";
      }, 50);
      assert(r.ok === false && r.refused === "timeout", `expected timeout, got ${JSON.stringify(r)}`);
      assert(boundedRan === false, "must not run after deadline while chain held");
      assert(isNativeOpChainEmpty() === false, "chain still held by A");

      // Now free A; a subsequent empty-chain bounded call must succeed.
      releaseA();
      await pA;
      // Drain microtasks so pending count decrements.
      await new Promise((r) => setImmediate(r));
      assert(isNativeOpChainEmpty() === true, "empty after A settles");
      const r2 = await runNativeOpBounded(async () => "NOW", 100);
      assert(r2.ok === true && r2.value === "NOW", `expected ok/NOW, got ${JSON.stringify(r2)}`);
    },
  );

  // acquireNativeOpBounded must be gone (replaced by atomic runNativeOpBounded).
  check("acquireNativeOpBounded removed (no export)", () => {
    assert(
      typeof mod.acquireNativeOpBounded !== "function",
      "acquireNativeOpBounded must not be exported",
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
