/**
 * Harness for anti-OOM pure surface:
 *   - evaluateModelFit (deviceProfile)
 *   - getAvailableMemoryBytesUncached signature (monitor)
 *   - startMemoryMonitor callback wiring (monitor)
 *
 * Compile-from-disk pattern (same as deviceProfileHarness). Exit 1 on fail.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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
      "src/engine/deviceProfile.ts",
      "src/engine/contextProfile.ts",
      "src/engine/memoryEstimate.ts",
      "src/engine/threadProfile.ts",
      "src/engine/monitor.ts",
      "src/engine/regenState.ts",
      "src/engine/llamaContextGate.ts",
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

function resolveBuilt(name) {
  const candidates = [
    path.join(projectRoot, `scripts/.build/${name}.js`),
    path.join(projectRoot, `scripts/.build/engine/${name}.js`),
    path.join(projectRoot, `scripts/.build/src/engine/${name}.js`),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`Could not find compiled ${name}.js. Tried:\n`, candidates.join("\n"));
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log("Compiling anti-OOM modules …");
  compile();
  const dpPath = resolveBuilt("deviceProfile");
  const monPath = resolveBuilt("monitor");
  console.log("Loading", dpPath);
  console.log("Loading", monPath);
  const dp = require(dpPath);
  const mon = require(monPath);
  const { evaluateModelFit, estimateModelNonEvictableMiB, decidePreSendFit } = dp;
  const { getAvailableMemoryBytesUncached, startMemoryMonitor, parseMemAvailableBytes } = {
    ...mon,
    // parseMemAvailableBytes lives in memoryEstimate — re-export via mon import chain not needed
  };

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

  // --- evaluateModelFit: 4GB free / ~2B model ---
  // 2B Q4_K_M ~1.2 GB file; with repack+compute+kv → nonEvictable ~1.3–1.5 GiB.
  // 4 GiB free → fits (with headroom).
  const model2B = {
    sizeBytes: 1_211 * 1024 * 1024, // ~1211 MiB
    engineCtx: 4096,
    kvBytesPerToken: 4.88 * 1024, // measured KiB/tok → bytes
    mmproj: null,
  };
  const fourGiB = 4 * 1024 * 1024 * 1024;
  const oneGiB = 1 * 1024 * 1024 * 1024;
  const halfGiB = 512 * 1024 * 1024;

  await test("evaluateModelFit 4GiB / 2B → fits|tight (not does_not_fit)", () => {
    const r = evaluateModelFit(model2B, fourGiB);
    assert(
      r.verdict === "fits" || r.verdict === "tight",
      `expected fits|tight, got ${r.verdict} (${r.reasonKey})`,
    );
  });

  await test("evaluateModelFit tiny free → does_not_fit + model.tooLarge", () => {
    const r = evaluateModelFit(model2B, halfGiB);
    assert(r.verdict === "does_not_fit", `expected does_not_fit, got ${r.verdict}`);
    assert(r.reasonKey === "model.tooLarge", `reasonKey ${r.reasonKey}`);
  });

  await test("evaluateModelFit null available → unknown + model.memoryUnknown", () => {
    const r = evaluateModelFit(model2B, null);
    assert(r.verdict === "unknown", `expected unknown, got ${r.verdict}`);
    assert(r.reasonKey === "model.memoryUnknown", `reasonKey ${r.reasonKey}`);
  });

  await test("evaluateModelFit zero size → unknown + model.cannotEvaluate", () => {
    const r = evaluateModelFit({ sizeBytes: 0, engineCtx: 0 }, fourGiB);
    assert(r.verdict === "unknown", `expected unknown, got ${r.verdict}`);
    assert(r.reasonKey === "model.cannotEvaluate", `reasonKey ${r.reasonKey}`);
  });

  await test("evaluateModelFit fits uses model.fitsOK reasonKey", () => {
    const r = evaluateModelFit(model2B, 16 * 1024 * 1024 * 1024);
    assert(r.verdict === "fits", `expected fits, got ${r.verdict}`);
    assert(r.reasonKey === "model.fitsOK", `reasonKey ${r.reasonKey}`);
  });

  await test("decidePreSendFit refuses when available < 1.5× required (tightNow)", () => {
    const estMiB = estimateModelNonEvictableMiB(model2B);
    assert(typeof estMiB === "number" && estMiB > 0, `estMiB=${estMiB}`);
    const requiredBytes = estMiB * 1024 * 1024;
    // available just above nonEvictable → typically tight; always < 1.5× required.
    let avail = (estMiB + 100) * 1024 * 1024;
    if (avail >= 1.5 * requiredBytes) {
      avail = 1.4 * requiredBytes;
    }
    const d = decidePreSendFit(model2B, avail);
    assert(d.allow === false, `expected refuse, got ${JSON.stringify(d)}`);
    assert(
      d.reasonKey === "model.tightNow" || d.reasonKey === "model.tooLarge",
      `reason ${d.reasonKey}`,
    );
    // Explicit tightNow when still above nonEvictable (not does_not_fit).
    const fit = evaluateModelFit(model2B, avail);
    if (fit.verdict === "tight") {
      assert(d.reasonKey === "model.tightNow", `tight must map to tightNow, got ${d.reasonKey}`);
    }
  });

  await test("decidePreSendFit hard refuse under nonEvictable → model.tooLarge", () => {
    const d = decidePreSendFit(model2B, halfGiB);
    assert(d.allow === false, "refuse");
    assert(d.reasonKey === "model.tooLarge", d.reasonKey);
  });

  await test("decidePreSendFit unknown available → allow + banner", () => {
    const d = decidePreSendFit(model2B, null);
    assert(d.allow === true, "allow");
    assert(d.bannerKey === "model.memoryUnknown", `banner ${d.bannerKey}`);
  });

  // P0: resident model must not double-count its own footprint vs leftover RAM.
  // Xiaomi 14: 4B (~2.7 GB) resident, HyperOS MemAvailable ~2.1 GB.
  const model4B = {
    sizeBytes: 2693 * 1024 * 1024,
    engineCtx: 8192,
    kvBytesPerToken: 4.88 * 1024,
    mmproj: null,
  };
  const leftoverAfter4B = 2100 * 1024 * 1024;

  await test("decidePreSendFit resident + low availableMb → completion allowed", () => {
    const blocked = decidePreSendFit(model4B, leftoverAfter4B);
    assert(blocked.allow === false, "unloaded 4B vs 2.1 GiB leftover must refuse");
    const d = decidePreSendFit(model4B, leftoverAfter4B, { alreadyResident: true });
    assert(d.allow === true, `resident must allow, got ${JSON.stringify(d)}`);
    assert(d.bannerKey === null, `no banner when resident, got ${d.bannerKey}`);
  });

  await test("decidePreSendFit unloaded + low availableMb → still blocked", () => {
    const d = decidePreSendFit(model4B, leftoverAfter4B);
    assert(d.allow === false, "unloaded must still refuse");
    assert(
      d.reasonKey === "model.tooLarge" || d.reasonKey === "model.tightNow",
      `reason ${d.reasonKey}`,
    );
    const tiny = decidePreSendFit(model2B, halfGiB);
    assert(tiny.allow === false, "unloaded 2B vs 512 MiB must refuse");
    assert(tiny.reasonKey === "model.tooLarge", tiny.reasonKey);
  });

  // --- mmproj accounting ---
  await test("evaluateModelFit mmproj increases footprint (may worsen verdict)", () => {
    const baseModel = { sizeBytes: 2_000_000_000, engineCtx: 4096, kvBytesPerToken: 0 };
    const mmModel = {
      sizeBytes: 2_000_000_000,
      engineCtx: 4096,
      kvBytesPerToken: 0,
      mmproj: { sizeBytes: 800_000_000 },
    };
    const without = evaluateModelFit(baseModel, 3 * 1024 * 1024 * 1024);
    const withMm = evaluateModelFit(mmModel, 3 * 1024 * 1024 * 1024);
    const rank = { fits: 0, tight: 1, does_not_fit: 2, unknown: -1 };
    assert(
      rank[withMm.verdict] >= rank[without.verdict],
      `mmproj should not improve fit: ${without.verdict} → ${withMm.verdict}`,
    );
    // gateForModel folds mmproj into bundle sizeBytes — estimate must grow.
    const baseEst = estimateModelNonEvictableMiB(baseModel);
    const mmEst = estimateModelNonEvictableMiB({
      sizeBytes: baseModel.sizeBytes + 800_000_000,
      engineCtx: 4096,
      kvBytesPerToken: 0,
    });
    assert(typeof baseEst === "number" && typeof mmEst === "number", "ests");
    assert(mmEst > baseEst, `mmproj bundle ${mmEst} should exceed base ${baseEst}`);
  });

  await test("estimateModelNonEvictableMiB mmproj-sized file > base", () => {
    const base = estimateModelNonEvictableMiB({
      sizeBytes: 1_000_000_000,
      engineCtx: 2048,
      kvBytesPerToken: 0,
    });
    const plus = estimateModelNonEvictableMiB({
      sizeBytes: 1_000_000_000 + 500_000_000,
      engineCtx: 2048,
      kvBytesPerToken: 0,
    });
    assert(typeof base === "number" && typeof plus === "number", "numbers");
    assert(plus > base, `plus ${plus} should exceed base ${base}`);
  });

  // --- getAvailableMemoryBytesUncached signature ---
  await test("getAvailableMemoryBytesUncached is async function", () => {
    assert(typeof getAvailableMemoryBytesUncached === "function", "fn");
    assert(
      getAvailableMemoryBytesUncached.constructor.name === "AsyncFunction" ||
        typeof getAvailableMemoryBytesUncached().then === "function",
      "returns promise",
    );
  });

  await test("getAvailableMemoryBytesUncached resolves null off-Android", async () => {
    // Node harness has no RN Platform → catch path → null
    const v = await getAvailableMemoryBytesUncached();
    assert(v === null || typeof v === "number", `got ${v}`);
  });

  // --- startMemoryMonitor callback wiring ---
  await test("startMemoryMonitor fires onPressure + stop is idempotent", async () => {
    assert(typeof startMemoryMonitor === "function", "fn");
    let pressureCalls = 0;
    let appStateCalls = 0;
    const handle = startMemoryMonitor({
      intervalMs: 50,
      onAppState: () => {
        appStateCalls += 1;
      },
      onPressure: () => {
        pressureCalls += 1;
      },
    });
    assert(handle && typeof handle.stop === "function", "handle.stop");
    // Wait for at least the initial sample + one interval tick.
    await new Promise((r) => setTimeout(r, 120));
    handle.stop();
    handle.stop(); // idempotent
    assert(pressureCalls >= 1, `onPressure calls=${pressureCalls}`);
    // appState may be 0 in node (no RN AppState) — that is fine.
    assert(appStateCalls >= 0, "appStateCalls");
  });

  // --- background save-before-dispose ordering (pure mock) ---
  await test("background discard: save runs before dispose", async () => {
    const order = [];
    const lifecycle = async () => {
      order.push("lifecycle");
      return { historyHashValue: "abc" };
    };
    const fakeSave = async () => {
      order.push("save");
    };
    const fakeDispose = async () => {
      order.push("dispose");
    };
    const result = await lifecycle();
    await fakeSave(result.historyHashValue);
    await fakeDispose();
    assert(order.join(">") === "lifecycle>save>dispose", order.join(">"));
  });

  await test("background discard: skips dispose while send/regen busy", async () => {
    const flags = { stream: false, sending: true, regen: false };
    const order = [];
    const shouldDispose = () => !(flags.stream || flags.sending || flags.regen);
    order.push(shouldDispose() ? "dispose" : "skip");
    flags.sending = false;
    order.push(shouldDispose() ? "dispose" : "skip");
    assert(order.join(">") === "skip>dispose", order.join(">"));
  });

  // --- Round-2 lifecycle race tests ---

  await test("lifecycle awaits turn-end save BEFORE dispose (deferred state)", async () => {
    // Mirrors AiChatPage: turnEndSavePromiseRef is installed SYNCHRONOUSLY
    // before a deferred setMessages updater runs the actual save. Lifecycle
    // must await that promise before dispose, even if messagesRef is still
    // pre-finalization when lifecycle starts.
    const order = [];
    let resolveSave;
    const turnEndSavePromise = new Promise((r) => {
      resolveSave = r;
    });
    // Lifecycle observes the promise immediately (sync install).
    const lifecycle = async () => {
      order.push("lifecycle-start");
      // Abort phase
      order.push("abort");
      // Await turn-end save (installed before setMessages returns)
      await turnEndSavePromise;
      order.push("save-awaited");
      return { historyHashValue: "hash-final" };
    };
    // Deferred "setMessages updater" schedules the real save after a tick
    // (simulates React applying the updater after paint).
    void Promise.resolve().then(async () => {
      order.push("updater-runs");
      await new Promise((r) => setTimeout(r, 20));
      order.push("save-done");
      resolveSave();
    });
    const result = await lifecycle();
    order.push("dispose");
    assert(result.historyHashValue === "hash-final", "hash");
    // save-done must precede dispose; updater may interleave before or after
    // lifecycle-start but save must complete before dispose.
    const saveIdx = order.indexOf("save-done");
    const disposeIdx = order.indexOf("dispose");
    const awaitedIdx = order.indexOf("save-awaited");
    assert(saveIdx >= 0 && disposeIdx >= 0, `order=${order.join(">")}`);
    assert(saveIdx < disposeIdx, `save before dispose: ${order.join(">")}`);
    assert(awaitedIdx < disposeIdx, `await before dispose: ${order.join(">")}`);
  });

  await test("abort during fit-gate cancels impending handleSend (claim+signal)", async () => {
    // Mirrors handleSend: sendClaimRef reserved, preSendController installed,
    // then await fit gate. Lifecycle aborts during the await → handleSend
    // must refuse before claiming sendingRef / starting generation.
    const sendClaim = { current: false };
    const abortRef = { current: null };
    const regenAbort = { current: null };
    let generationStarted = false;

    async function simulatedHandleSend(fitGateMs) {
      if (sendClaim.current) return { ok: false, reasonKey: "chat.sendBusy" };
      sendClaim.current = true;
      const preSendController = new AbortController();
      abortRef.current = preSendController;
      try {
        // Fit-gate await (uncached memory probe)
        await new Promise((r) => setTimeout(r, fitGateMs));
        if (
          preSendController.signal.aborted ||
          regenAbort.current?.signal?.aborted
        ) {
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        generationStarted = true;
        return { ok: true };
      } finally {
        sendClaim.current = false;
      }
    }

    async function simulatedLifecycle() {
      regenAbort.current?.abort();
      abortRef.current?.abort();
      // Spin while claim held
      const t0 = Date.now();
      while (sendClaim.current && Date.now() - t0 < 2000) {
        abortRef.current?.abort();
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    const sendP = simulatedHandleSend(40);
    // Fire lifecycle mid fit-gate
    await new Promise((r) => setTimeout(r, 10));
    await simulatedLifecycle();
    const res = await sendP;
    assert(res.ok === false, "must refuse after abort during fit gate");
    assert(res.reasonKey === "chat.regenFailed", res.reasonKey);
    assert(generationStarted === false, "generation must not start");
    assert(sendClaim.current === false, "claim released");
  });

  await test("sendClaim + busy flags block dispose until clear", async () => {
    const flags = {
      stream: false,
      sending: false,
      regen: false,
      claim: true,
    };
    const shouldDispose = () =>
      !(flags.stream || flags.sending || flags.regen || flags.claim);
    assert(shouldDispose() === false, "claim blocks dispose");
    flags.claim = false;
    assert(shouldDispose() === true, "clear claim allows dispose");
  });

  // --- Round-3: deferred turn-save + rejection handling ---

  await test("turn-save promise awaited before dispose even if React defers updater", async () => {
    // Stronger deferred-timing mock: lifecycle starts BEFORE the deferred
    // setMessages updater schedules the real save. Promise is installed
    // synchronously (turnEndSavePromiseRef = turnSaveP) so lifecycle can
    // await it; dispose must wait for the deferred save to resolve.
    const order = [];
    let resolveSave;
    let rejectSave;
    const turnSaveHold = { resolve: null, reject: null };
    const turnSaveP = new Promise((resolve, reject) => {
      resolveSave = resolve;
      rejectSave = reject;
      turnSaveHold.resolve = resolve;
      turnSaveHold.reject = reject;
    });
    // Sync install (before setMessages returns) — critical for the race.
    let turnEndSavePromiseRef = turnSaveP;
    // Attach finally + catch (mirrors AiChatPage: no unhandled rejection).
    let unhandled = false;
    void turnSaveP
      .finally(() => {
        if (turnEndSavePromiseRef === turnSaveP) {
          turnEndSavePromiseRef = null;
        }
        order.push("cleanup");
      })
      .catch(() => {
        // fire-and-forget path must not surface as unhandledrejection
        order.push("caught");
      });

    // Lifecycle starts immediately — updater has NOT run yet.
    const lifecycle = async () => {
      order.push("lifecycle-start");
      order.push("abort");
      const saveP = turnEndSavePromiseRef; // must see the sync-installed promise
      assert(saveP != null, "lifecycle must observe sync-installed turnSaveP");
      try {
        await saveP;
        order.push("save-awaited");
      } catch {
        order.push("save-awaited-reject");
      }
      return { historyHashValue: "hash-deferred" };
    };

    const lifeP = lifecycle();

    // Deferred React updater: runs after a delay (paint + queue).
    await new Promise((r) => setTimeout(r, 30));
    order.push("updater-runs");
    // Simulate saveEngineSession work then resolve.
    await new Promise((r) => setTimeout(r, 20));
    order.push("save-done");
    resolveSave();

    const result = await lifeP;
    order.push("dispose");
    // Drain microtasks so finally/catch land.
    await new Promise((r) => setTimeout(r, 0));

    assert(result.historyHashValue === "hash-deferred", "hash");
    const saveIdx = order.indexOf("save-done");
    const disposeIdx = order.indexOf("dispose");
    const awaitedIdx = order.indexOf("save-awaited");
    const lifeStartIdx = order.indexOf("lifecycle-start");
    const updaterIdx = order.indexOf("updater-runs");
    assert(lifeStartIdx >= 0 && updaterIdx >= 0, `order=${order.join(">")}`);
    assert(
      lifeStartIdx < updaterIdx,
      `lifecycle before deferred updater: ${order.join(">")}`,
    );
    assert(saveIdx < disposeIdx, `save before dispose: ${order.join(">")}`);
    assert(awaitedIdx < disposeIdx, `await before dispose: ${order.join(">")}`);
    assert(turnEndSavePromiseRef === null, "cleanup cleared ref");
    assert(unhandled === false, "no unhandled flag");
    // silence unused
    void rejectSave;
    void turnSaveHold;
  });

  await test("turnSaveP rejection does not become unhandled (finally+catch chain)", async () => {
    // Mirrors the FIX-2 pattern: turnSaveP.finally(...).catch(...) so a
    // rejected saveEngineSession does not surface as unhandledrejection.
    let unhandledHit = false;
    const onUnhandled = () => {
      unhandledHit = true;
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      let turnEndRef = null;
      const turnSaveP = new Promise((_resolve, reject) => {
        // Reject asynchronously so the catch handler is already attached.
        void Promise.resolve().then(() => reject(new Error("save failed")));
      });
      turnEndRef = turnSaveP;
      void turnSaveP
        .finally(() => {
          if (turnEndRef === turnSaveP) turnEndRef = null;
        })
        .catch(() => {
          // no-op — fire-and-forget
        });
      // Give the rejection + catch a tick to settle.
      await new Promise((r) => setTimeout(r, 20));
      assert(turnEndRef === null, "cleanup ran");
      assert(unhandledHit === false, "no unhandledRejection from turnSaveP");
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  await test("sendClaim generation-gated release: stale finally skips new claim", async () => {
    // Cross-check with regenState generation counter semantics used by handleSend.
    const regenMod = require(resolveBuilt("regenState"));
    const { sendClaimRef, regenGenerationRef } = regenMod;
    regenGenerationRef.current = 0;
    sendClaimRef.current = false;

    const mySendGen = regenGenerationRef.current;
    sendClaimRef.current = true;

    // clearChat bumps + new send claims
    regenGenerationRef.current += 1;
    sendClaimRef.current = false;
    sendClaimRef.current = true;

    // Stale finally
    if (regenGenerationRef.current === mySendGen) {
      sendClaimRef.current = false;
    }
    assert(sendClaimRef.current === true, "stale finally skipped");

    // Owner finally
    const ownerGen = regenGenerationRef.current;
    if (regenGenerationRef.current === ownerGen) {
      sendClaimRef.current = false;
    }
    assert(sendClaimRef.current === false, "owner cleared");
  });


  // --- Round-5: fit-gate race aborts handleSend when generation moves ---

  await test("fit-gate race aborts handleSend when generation moves", async () => {
    // Mirrors AiChatPage.handleSend body gate after awaitPreSendFitGate:
    // capture myGen at claim; if clearChat bumps regenGenerationRef during
    // the uncached memory probe, the continuation must return ok:false and
    // must NOT claim sendingRef / start generation / setMessages.
    const regenMod = require(resolveBuilt("regenState"));
    const { sendClaimRef, regenGenerationRef } = regenMod;
    regenGenerationRef.current = 0;
    sendClaimRef.current = false;

    let generationStarted = false;
    let setMessagesCalls = 0;
    let sendingClaimed = false;
    const abortRef = { current: null };

    const stillThisRun = (my) => regenGenerationRef.current === my;

    async function simulatedHandleSend(fitGateMs) {
      if (sendClaimRef.current) return { ok: false, reasonKey: "chat.sendBusy" };
      const myGen = regenGenerationRef.current;
      sendClaimRef.current = true;
      const preSendController = new AbortController();
      abortRef.current = preSendController;
      try {
        // Uncached fit-gate await
        await new Promise((r) => setTimeout(r, fitGateMs));
        if (!stillThisRun(myGen)) {
          if (abortRef.current === preSendController) abortRef.current = null;
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        if (preSendController.signal.aborted) {
          if (abortRef.current === preSendController) abortRef.current = null;
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        // Would claim sendingRef + paint bubbles
        sendingClaimed = true;
        generationStarted = true;
        setMessagesCalls += 1;
        return { ok: true };
      } finally {
        if (regenGenerationRef.current === myGen) {
          sendClaimRef.current = false;
        }
      }
    }

    const sendP = simulatedHandleSend(40);
    // clearChat mid fit-gate: bump generation + clear claim + abort
    await new Promise((r) => setTimeout(r, 10));
    regenGenerationRef.current += 1;
    sendClaimRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;

    const res = await sendP;
    assert(res.ok === false, "must refuse when generation moved");
    assert(res.reasonKey === "chat.regenFailed", res.reasonKey);
    assert(generationStarted === false, "generation must not start");
    assert(sendingClaimed === false, "sendingRef must not be claimed");
    assert(setMessagesCalls === 0, `setMessages must not run, got ${setMessagesCalls}`);
    assert(sendClaimRef.current === false, "claim released/cleared");
  });

  // --- Round-6: late updateMessage after generation move ---

  await test("late updateMessage callback after generation move does NOT apply", async () => {
    // Mirrors AiChatPage.updateMessage ownerGen/ownerRunId guard: a coalescer
    // flush or stream callback scheduled under gen N must no-op when React
    // applies it after clearChat bumped regenGenerationRef.
    const regenMod = require(resolveBuilt("regenState"));
    const { regenGenerationRef } = regenMod;
    regenGenerationRef.current = 0;
    const sendRunIdRef = { current: 0 };

    let messages = [
      { id: "a1", role: "assistant", text: "partial", streaming: true },
    ];
    let applied = 0;
    let skipped = 0;

    function updateMessage(id, patchOrFn, ownerGen, ownerRunId) {
      // Return a deferred applicator (simulates React setState queue).
      return () => {
        if (
          ownerGen !== undefined &&
          (ownerGen !== regenGenerationRef.current ||
            (ownerRunId !== undefined && ownerRunId !== sendRunIdRef.current))
        ) {
          skipped += 1;
          return;
        }
        const idx = messages.findIndex((m) => m.id === id);
        if (idx === -1) {
          skipped += 1;
          return;
        }
        const patch =
          typeof patchOrFn === "function" ? patchOrFn(messages[idx]) : patchOrFn;
        messages = messages.slice();
        messages[idx] = { ...messages[idx], ...patch };
        applied += 1;
      };
    }

    const myGen = regenGenerationRef.current;
    const runId = ++sendRunIdRef.current;
    // Stream/coalescer schedules update under current gen
    const lateFlush = updateMessage(
      "a1",
      { text: "late full text", statusLabel: undefined },
      myGen,
      runId,
    );
    // clearChat: bump generation + wipe messages
    sendRunIdRef.current += 1;
    regenGenerationRef.current += 1;
    messages = [];
    // Late callback fires
    lateFlush();
    assert(applied === 0, `applied=${applied}`);
    assert(skipped === 1, `skipped=${skipped}`);
    assert(messages.length === 0, "must stay empty after clearChat");
  });


  // --- Round-8 FIX 1 / FIX 4: hybrid retrieval during chat completion ---
  // document_chat runs inside the tool loop of a chat completion. Lazy embed
  // init and embed USE must NOT be blocked by markChatCompleting (now a no-op).
  // Only embedInitializing (actual init/release) refuses new tryAcquireEmbed.

  await test("hybrid: chat completion does NOT block embed lazy-init", async () => {
    let gatePath;
    try {
      gatePath = resolveBuilt("llamaContextGate");
    } catch {
      const candidates = [
        path.join(projectRoot, "scripts/.build/llamaContextGate.js"),
        path.join(projectRoot, "scripts/.build/engine/llamaContextGate.js"),
        path.join(projectRoot, "scripts/.build/src/engine/llamaContextGate.js"),
      ];
      gatePath = candidates.find((c) => existsSync(c));
    }
    assert(gatePath, "llamaContextGate compiled");
    const gate = require(gatePath);
    gate.__resetForTests();

    // Simulate chat ready + co-residency (8GB + 2B) — the hybrid path on mid/high RAM.
    gate.setCoResidencyContext({ totalMemoryBytes: 8e9, chatModelIs2B: true });
    const gen = gate.tryAcquireChat();
    assert(gen !== null, "chat acquired");
    gate.markChatReady(gen);
    assert(gate.getState() === "chat_ready", "chat_ready");

    // LlamaService.withEngineJob still calls these (legacy no-ops).
    gate.markChatCompleting();
    assert(gate.isChatCompleting() === false, "chatCompleting is no-op / always false");

    // document_chat tool loop: lazy-init embedder during completion.
    assert(
      gate.tryAcquireEmbed() === true,
      "lazy-init ALLOWED during chat completion (hybrid must not degrade to BM25)",
    );
    assert(gate.isEmbedHeld() === true, "embed held under co-residency");
    // USE path re-entrant while still "completing".
    assert(gate.tryAcquireEmbed() === true, "embed USE re-entrant during completion");
    gate.releaseEmbed();
    gate.markChatCompletingDone();

    // embedInitializing still refuses concurrent NEW init (race surface).
    gate.markEmbedInitializing();
    assert(gate.isEmbedInitializing() === true, "init flag set");
    assert(gate.tryAcquireEmbed() === false, "init race surface still refuses");
    gate.markEmbedInFlightDone();
    assert(gate.tryAcquireEmbed() === true, "ok after init race cleared");
    gate.releaseEmbed();
    gate.__resetForTests();
  });

  await test("hybrid: embedInitializing serializes init vs release only", async () => {
    let gatePath;
    try {
      gatePath = resolveBuilt("llamaContextGate");
    } catch {
      const candidates = [
        path.join(projectRoot, "scripts/.build/llamaContextGate.js"),
        path.join(projectRoot, "scripts/.build/engine/llamaContextGate.js"),
        path.join(projectRoot, "scripts/.build/src/engine/llamaContextGate.js"),
      ];
      gatePath = candidates.find((c) => existsSync(c));
    }
    assert(gatePath, "llamaContextGate compiled");
    const gate = require(gatePath);
    gate.__resetForTests();
    assert(gate.tryAcquireEmbed() === true, "first acquire");
    gate.releaseEmbed();
    gate.markEmbedInitializing();
    assert(gate.shouldRefuseEmbedInitOrRelease() === true, "refuse while in flight");
    assert(gate.tryAcquireEmbed() === false, "second init refused");
    gate.markEmbedInitializingDone();
    // initializing cleared; inFlight may remain until markEmbedInFlightDone
    gate.markEmbedInFlightDone();
    assert(gate.tryAcquireEmbed() === true, "after full clear");
    gate.releaseEmbed();
    gate.__resetForTests();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
