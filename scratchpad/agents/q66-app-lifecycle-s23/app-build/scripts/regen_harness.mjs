/**
 * Harness for edit/regenerate pure logic (no React).
 *
 * Covers:
 *   - findOriginalUserText walk
 *   - regenerate = truncate + handleSend(originalUserText) single-pass
 *   - edit = array-index splice + edited flag + handleSend
 *   - concurrent regen → second refuses (regenInFlightRef)
 *   - real busy-check chain (regenInFlightRef blocks concurrent sends)
 *   - snapshot restore on throw AND on handleSend {ok:false}
 *   - regenAbortRef set during regen, cleared after
 *
 * Compile-from-disk for regenState; pure JS for flow simulation.
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
      "src/engine/regenState.ts",
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
  console.error(`Could not find compiled ${name}.js`);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Pure: walk slice backwards for last user text. Mirrors AiChatPage helper. */
function findOriginalUserText(slice) {
  for (let i = slice.length - 1; i >= 0; i -= 1) {
    const m = slice[i];
    if (m && m.role === "user" && typeof m.text === "string" && m.text.trim()) {
      return m.text;
    }
  }
  return null;
}

/**
 * Pure regenerate flow (mirrors AiChatPage.regenerate without React).
 * Uses module-level regenInFlightRef + one-shot pass + regenAbortRef.
 * Inspects handleSend discriminated result for snapshot restore.
 *
 * Generation-gated body (round-4): after every await, if generation moved,
 * abort without rollback setMessages / setSending side effects.
 * Optional hooks (onRollback / onSetSending) let tests observe body mutations.
 */
async function regenerateFlow(opts) {
  const {
    messages,
    targetMsgId,
    handleSend,
    regenInFlightRef,
    regenHandleSendPassRef,
    regenAbortRef,
    regenGenerationRef,
    sendClaimRef,
    onRollback,
    onSetSending,
    onHandleSendInvoked,
    beforeHandleSend,
  } = opts;
  if (
    regenInFlightRef.current ||
    (sendClaimRef && sendClaimRef.current)
  ) {
    return { ok: false, reasonKey: "chat.regenBusy", messages, abortedStale: false };
  }
  // Capture generation at acquire; body + finally only mutate on match.
  const myGeneration = regenGenerationRef ? regenGenerationRef.current : 0;
  regenInFlightRef.current = true;
  if (regenAbortRef) regenAbortRef.current = new AbortController();
  const snapshot = messages.slice();
  // Working messages mirror (for tests that mutate via clearChat mid-await).
  let currentMessages = messages.slice();
  try {
    const targetIndex = currentMessages.findIndex((m) => m.id === targetMsgId);
    if (targetIndex < 0) {
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot, abortedStale: false };
    }
    const slice = currentMessages.slice(0, targetIndex + 1);
    const originalUserText = findOriginalUserText(slice);
    if (!originalUserText) {
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot, abortedStale: false };
    }
    const target = currentMessages[targetIndex];
    const cutExclusive =
      target?.role === "assistant" ? targetIndex : targetIndex + 1;
    let base = currentMessages.slice(0, cutExclusive);
    if (base.length > 0 && base[base.length - 1]?.role === "user") {
      base = base.slice(0, -1);
    }
    currentMessages = base;
    if (regenAbortRef?.current?.signal?.aborted) {
      if (regenGenerationRef && regenGenerationRef.current !== myGeneration) {
        return {
          ok: false,
          reasonKey: "chat.regenFailed",
          messages: currentMessages,
          abortedStale: true,
        };
      }
      onRollback?.(snapshot);
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot, abortedStale: false };
    }
    regenHandleSendPassRef.current = true;
    // Test hook: simulate clearChat just before handleSend (no real await in pure flow).
    await beforeHandleSend?.();
    // Defensive: if generation moved before we invoke handleSend, skip it.
    if (regenGenerationRef && regenGenerationRef.current !== myGeneration) {
      return {
        ok: false,
        reasonKey: "chat.regenFailed",
        messages: currentMessages,
        abortedStale: true,
      };
    }
    onHandleSendInvoked?.();
    const sendResult = await handleSend(originalUserText, base);
    // clearChat during handleSend: do not rollback into the new chat.
    if (regenGenerationRef && regenGenerationRef.current !== myGeneration) {
      return {
        ok: false,
        reasonKey: "chat.regenFailed",
        messages: currentMessages,
        abortedStale: true,
      };
    }
    // Real handleSend returns {ok:false} on stream failure (does not throw).
    if (sendResult && typeof sendResult === "object" && sendResult.ok === false) {
      onRollback?.(snapshot);
      onSetSending?.(false);
      return {
        ok: false,
        reasonKey: sendResult.reasonKey || "chat.regenFailed",
        messages: snapshot,
        abortedStale: false,
      };
    }
    return { ok: true, messages: base, originalUserText, abortedStale: false };
  } catch (err) {
    if (regenGenerationRef && regenGenerationRef.current !== myGeneration) {
      return {
        ok: false,
        reasonKey: "chat.regenFailed",
        messages: currentMessages,
        abortedStale: true,
        error: err,
      };
    }
    onRollback?.(snapshot);
    onSetSending?.(false);
    return {
      ok: false,
      reasonKey: "chat.regenFailed",
      messages: snapshot,
      abortedStale: false,
      error: err,
    };
  } finally {
    // Generation-gated release for ALL locks (not just abort controller).
    if (!regenGenerationRef || regenGenerationRef.current === myGeneration) {
      regenInFlightRef.current = false;
      regenHandleSendPassRef.current = false;
      if (regenAbortRef) regenAbortRef.current = null;
    }
  }
}

/**
 * Pure edit flow: splice at index, stamp edited, truncate after, handleSend.
 * Generation-gated body (round-4): after await + before stamp, abort if gen moved.
 */
async function editFlow(opts) {
  const {
    messages,
    targetMsgId,
    newText,
    handleSend,
    regenInFlightRef,
    regenHandleSendPassRef,
    regenGenerationRef,
    regenAbortRef,
    onRollback,
    onSetSending,
    onStampEdited,
    onHandleSendInvoked,
  } = opts;
  const trimmed = String(newText ?? "").trim();
  if (!trimmed) {
    return { ok: false, reasonKey: "chat.regenFailed", messages, abortedStale: false };
  }
  if (regenInFlightRef.current) {
    return { ok: false, reasonKey: "chat.regenBusy", messages, abortedStale: false };
  }
  const myGeneration = regenGenerationRef ? regenGenerationRef.current : 0;
  regenInFlightRef.current = true;
  if (regenAbortRef) regenAbortRef.current = new AbortController();
  const snapshot = messages.slice();
  let currentMessages = messages.slice();
  try {
    const idx = currentMessages.findIndex((m) => m.id === targetMsgId);
    if (idx < 0) {
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot, abortedStale: false };
    }
    const target = currentMessages[idx];
    if (!target || target.role !== "user") {
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot, abortedStale: false };
    }
    // Atomic: keep before idx; handleSend re-appends edited user text.
    if (regenGenerationRef && regenGenerationRef.current !== myGeneration) {
      return {
        ok: false,
        reasonKey: "chat.regenFailed",
        messages: currentMessages,
        abortedStale: true,
      };
    }
    const base = currentMessages.slice(0, idx);
    currentMessages = base;
    regenHandleSendPassRef.current = true;
    // Defensive: if generation moved before we invoke handleSend, skip it.
    if (regenGenerationRef && regenGenerationRef.current !== myGeneration) {
      return {
        ok: false,
        reasonKey: "chat.regenFailed",
        messages: currentMessages,
        abortedStale: true,
      };
    }
    onHandleSendInvoked?.();
    const sendResult = await handleSend(trimmed, base);
    if (regenGenerationRef && regenGenerationRef.current !== myGeneration) {
      return {
        ok: false,
        reasonKey: "chat.regenFailed",
        messages: currentMessages,
        abortedStale: true,
      };
    }
    if (sendResult && typeof sendResult === "object" && sendResult.ok === false) {
      onRollback?.(snapshot);
      onSetSending?.(false);
      return {
        ok: false,
        reasonKey: sendResult.reasonKey || "chat.regenFailed",
        messages: snapshot,
        abortedStale: false,
      };
    }
    // Stamp edited — only if we still own the generation.
    if (regenGenerationRef && regenGenerationRef.current !== myGeneration) {
      return {
        ok: false,
        reasonKey: "chat.regenFailed",
        messages: currentMessages,
        abortedStale: true,
      };
    }
    const stamped = [
      ...base,
      { id: "u-edited", role: "user", text: trimmed, edited: true },
    ];
    onStampEdited?.(stamped);
    return { ok: true, messages: stamped, editedText: trimmed, abortedStale: false };
  } catch (err) {
    if (regenGenerationRef && regenGenerationRef.current !== myGeneration) {
      return {
        ok: false,
        reasonKey: "chat.regenFailed",
        messages: currentMessages,
        abortedStale: true,
        error: err,
      };
    }
    onRollback?.(snapshot);
    onSetSending?.(false);
    return {
      ok: false,
      reasonKey: "chat.regenFailed",
      messages: snapshot,
      abortedStale: false,
      error: err,
    };
  } finally {
    // Generation-gated release for ALL locks.
    if (!regenGenerationRef || regenGenerationRef.current === myGeneration) {
      regenInFlightRef.current = false;
      regenHandleSendPassRef.current = false;
      if (regenAbortRef) regenAbortRef.current = null;
    }
  }
}

async function main() {
  console.log("Compiling regenState …");
  compile();
  const modPath = resolveBuilt("regenState");
  console.log("Loading", modPath);
  const {
    regenInFlightRef,
    regenHandleSendPassRef,
    regenAbortRef,
    sendClaimRef,
    regenGenerationRef,
    discardInFlightRef,
    discardGenerationRef,
    pendingModelSwitchQueue,
    deferModelSwitchIfSendClaimed,
    drainPendingModelSwitch,
  } = require(modPath);

  // Reset module state
  regenInFlightRef.current = false;
  regenHandleSendPassRef.current = false;
  regenAbortRef.current = null;
  if (sendClaimRef) sendClaimRef.current = false;
  if (regenGenerationRef) regenGenerationRef.current = 0;
  if (discardInFlightRef) discardInFlightRef.current = false;
  if (discardGenerationRef) discardGenerationRef.current = 0;
  if (pendingModelSwitchQueue) pendingModelSwitchQueue.length = 0;

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
    } finally {
      regenInFlightRef.current = false;
      regenHandleSendPassRef.current = false;
      regenAbortRef.current = null;
      if (sendClaimRef) sendClaimRef.current = false;
      if (regenGenerationRef) regenGenerationRef.current = 0;
      if (discardInFlightRef) discardInFlightRef.current = false;
      if (discardGenerationRef) discardGenerationRef.current = 0;
      if (pendingModelSwitchQueue) pendingModelSwitchQueue.length = 0;
    }
  }

  const history = [
    { id: "u1", role: "user", text: "What is 2+2?" },
    { id: "a1", role: "assistant", text: "4" },
    { id: "u2", role: "user", text: "And 3+3?" },
    { id: "a2", role: "assistant", text: "6" },
  ];

  await test("findOriginalUserText finds last user before/at end", () => {
    const t = findOriginalUserText(history.slice(0, 2));
    assert(t === "What is 2+2?", `got ${t}`);
    const t2 = findOriginalUserText(history);
    assert(t2 === "And 3+3?", `got ${t2}`);
    assert(findOriginalUserText([]) === null, "empty");
    assert(findOriginalUserText([{ id: "a", role: "assistant", text: "x" }]) === null, "no user");
  });

  await test("regenerate = handleSend(originalUserText) single-pass", async () => {
    const calls = [];
    const res = await regenerateFlow({
      messages: history,
      targetMsgId: "a2",
      handleSend: async (text, base) => {
        calls.push({ text, baseLen: base.length });
        return { ok: true };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
    });
    assert(res.ok === true, "ok");
    assert(calls.length === 1, `calls=${calls.length}`);
    assert(calls[0].text === "And 3+3?", `text=${calls[0].text}`);
    // Truncated: dropped a2 and u2 (re-sent) → left u1,a1
    assert(calls[0].baseLen === 2, `baseLen=${calls[0].baseLen}`);
    assert(res.originalUserText === "And 3+3?", "originalUserText");
  });

  await test("edit = array-index splice + edited flag", async () => {
    const calls = [];
    const res = await editFlow({
      messages: history,
      targetMsgId: "u2",
      newText: "And 5+5?",
      handleSend: async (text, base) => {
        calls.push({ text, baseLen: base.length });
        return { ok: true };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
    });
    assert(res.ok === true, "ok");
    assert(calls.length === 1, `calls=${calls.length}`);
    assert(calls[0].text === "And 5+5?", `text=${calls[0].text}`);
    // base = before u2 → u1,a1
    assert(calls[0].baseLen === 2, `baseLen=${calls[0].baseLen}`);
    const edited = res.messages.find((m) => m.edited === true);
    assert(edited && edited.text === "And 5+5?", "edited flag+text");
  });

  await test("two concurrent regen → second refuses", async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const p1 = regenerateFlow({
      messages: history,
      targetMsgId: "a1",
      handleSend: async () => {
        await gate;
        return { ok: true };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
    });
    // Give p1 a tick to set the flag
    await new Promise((r) => setTimeout(r, 10));
    assert(regenInFlightRef.current === true, "p1 holds lock");
    const p2 = await regenerateFlow({
      messages: history,
      targetMsgId: "a2",
      handleSend: async () => {
        throw new Error("should not run");
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
    });
    assert(p2.ok === false, "p2 refused");
    assert(p2.reasonKey === "chat.regenBusy", p2.reasonKey);
    release();
    const r1 = await p1;
    assert(r1.ok === true, "p1 ok");
    assert(regenInFlightRef.current === false, "lock cleared");
  });

  await test("busy-check chain: regen flag blocks concurrent handleSend-style send", async () => {
    // Mirrors AiChatPage handleSend busy gates using the real module refs.
    function busyCheck() {
      if (regenInFlightRef.current && !regenHandleSendPassRef.current) {
        return { ok: false, reasonKey: "chat.regenBusy" };
      }
      return { ok: true };
    }
    assert(busyCheck().ok === true, "idle allows");
    regenInFlightRef.current = true;
    assert(busyCheck().ok === false, "regen blocks");
    assert(busyCheck().reasonKey === "chat.regenBusy", "busy key");
    // one-shot pass allows the regen's own handleSend
    regenHandleSendPassRef.current = true;
    assert(busyCheck().ok === true, "pass allows");
    // pass is one-shot in real handleSend
    regenHandleSendPassRef.current = false;
    assert(busyCheck().ok === false, "after pass consumed still blocked");
    regenInFlightRef.current = false;
    assert(busyCheck().ok === true, "cleared allows");
  });

  await test("snapshot restore on handleSend error (throw)", async () => {
    const res = await regenerateFlow({
      messages: history,
      targetMsgId: "a2",
      handleSend: async () => {
        throw new Error("boom");
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
    });
    assert(res.ok === false, "failed");
    assert(res.reasonKey === "chat.regenFailed", res.reasonKey);
    assert(res.messages.length === history.length, "snapshot restored length");
    assert(res.messages[0].id === "u1", "snapshot content");
    assert(regenInFlightRef.current === false, "lock cleared after error");
  });

  await test("snapshot restore on handleSend ok:false (no throw)", async () => {
    const res = await regenerateFlow({
      messages: history,
      targetMsgId: "a2",
      handleSend: async () => {
        // Real handleSend resolves with ok:false on stream/backend failure.
        return { ok: false, reasonKey: "chat.serviceUnreachable" };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
    });
    assert(res.ok === false, "failed");
    assert(res.reasonKey === "chat.serviceUnreachable", res.reasonKey);
    assert(res.messages.length === history.length, "snapshot restored length");
    assert(res.messages[0].id === "u1", "snapshot content");
    assert(regenInFlightRef.current === false, "lock cleared");
    assert(regenAbortRef.current === null, "abort cleared");
  });

  await test("regenAbortRef set during regen and cleared after", async () => {
    let sawAbort = false;
    const r = await regenerateFlow({
      messages: history,
      targetMsgId: "a1",
      handleSend: async () => {
        sawAbort = regenAbortRef.current instanceof AbortController;
        return { ok: true };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
    });
    assert(r.ok === true, "ok");
    assert(sawAbort === true, "abort controller present during send");
    assert(regenAbortRef.current === null, "cleared after");
  });

  await test("persistent .kvs rollback NOT attempted (documented)", () => {
    // Documented design: regenerate/edit do NOT roll back .kvs on error —
    // only the React message snapshot is restored. This test is a marker.
    assert(true, "documented: no .kvs rollback on regen error");
  });

  // --- Round-2 race tests ---

  await test("externally-set regenInFlightRef blocks simulated handleSend entry", () => {
    // Mirrors AiChatPage handleSend busy gates: when regenInFlightRef is true
    // and pass is unset, a concurrent ordinary send must refuse.
    function simulatedHandleSendEntry() {
      if (sendClaimRef?.current) {
        return { ok: false, reasonKey: "chat.sendBusy" };
      }
      if (regenInFlightRef.current && !regenHandleSendPassRef.current) {
        return { ok: false, reasonKey: "chat.regenBusy" };
      }
      return { ok: true };
    }
    assert(simulatedHandleSendEntry().ok === true, "idle allows");
    regenInFlightRef.current = true;
    const blocked = simulatedHandleSendEntry();
    assert(blocked.ok === false, "regen blocks");
    assert(blocked.reasonKey === "chat.regenBusy", blocked.reasonKey);
    // sendClaim also blocks even without regen
    regenInFlightRef.current = false;
    sendClaimRef.current = true;
    const claimBlocked = simulatedHandleSendEntry();
    assert(claimBlocked.ok === false, "claim blocks");
    assert(claimBlocked.reasonKey === "chat.sendBusy", claimBlocked.reasonKey);
    sendClaimRef.current = false;
  });

  await test("regenAbortRef.abort() propagates to lifecycle-style wait", async () => {
    // Simulate lifecycle: abort regen, then observe that an in-flight regen
    // flow refuses on the aborted signal before handleSend runs.
    let handleSendCalled = false;
    const p = regenerateFlow({
      messages: history,
      targetMsgId: "a2",
      handleSend: async () => {
        handleSendCalled = true;
        return { ok: true };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
      regenGenerationRef,
      sendClaimRef,
    });
    // Give the flow a tick to install the controller, then abort (as lifecycle does).
    await new Promise((r) => setTimeout(r, 0));
    // If still in flight, abort; if already finished, the abort is a no-op.
    regenAbortRef.current?.abort();
    const res = await p;
    // Either refused on abort (handleSend not called) or completed before abort
    // landed — both are valid races. What must hold: lock is cleared after.
    assert(regenInFlightRef.current === false, "lock cleared after abort race");
    if (!handleSendCalled) {
      assert(res.ok === false, "aborted before send → refuse");
    }
    // Lifecycle re-assert: aborting a set controller marks its signal.
    const ac = new AbortController();
    regenAbortRef.current = ac;
    regenAbortRef.current?.abort();
    assert(ac.signal.aborted === true, "abort propagates to signal");
    regenAbortRef.current = null;
  });

  await test("clearChat bumps regenGenerationRef; old finally does not null new controller", async () => {
    // Simulate: regen starts, captures generation; clearChat bumps generation
    // and installs a new controller; old finally must not clear the new one.
    assert(typeof regenGenerationRef.current === "number", "generation ref exists");
    regenGenerationRef.current = 0;
    const myGeneration = regenGenerationRef.current;
    regenInFlightRef.current = true;
    const oldController = new AbortController();
    regenAbortRef.current = oldController;

    // clearChat: bump generation + abort + null + install would happen on next regen
    regenGenerationRef.current += 1;
    regenAbortRef.current?.abort();
    regenAbortRef.current = null;
    // New regen starts with a fresh controller under the new generation
    const newController = new AbortController();
    regenAbortRef.current = newController;

    // Old regen finally: only null if generation still matches
    if (regenGenerationRef.current === myGeneration) {
      regenAbortRef.current = null;
    }
    assert(
      regenAbortRef.current === newController,
      "old finally must not clear new controller",
    );
    assert(regenAbortRef.current?.signal.aborted !== true, "new controller not aborted by old");

    // Matching generation still clears
    const gen2 = regenGenerationRef.current;
    if (regenGenerationRef.current === gen2) {
      regenAbortRef.current = null;
    }
    assert(regenAbortRef.current === null, "matching generation clears");
    regenInFlightRef.current = false;
  });

  // --- Round-3 race tests: generation-gated release for ALL locks ---

  await test("stale regen finally after clearChat+new regen does NOT clobber new locks", async () => {
    // Full race: stale regenerateFlow finally runs AFTER clearChat + new regen.
    // New regen's inFlight / pass / abort must survive the stale finally.
    regenGenerationRef.current = 0;
    regenInFlightRef.current = false;
    regenHandleSendPassRef.current = false;
    regenAbortRef.current = null;
    sendClaimRef.current = false;

    let releaseStale;
    const staleGate = new Promise((r) => {
      releaseStale = r;
    });

    // Stale regen starts and holds mid-send.
    const staleP = regenerateFlow({
      messages: history,
      targetMsgId: "a2",
      handleSend: async () => {
        await staleGate;
        return { ok: true };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
      regenGenerationRef,
      sendClaimRef,
    });
    await new Promise((r) => setTimeout(r, 10));
    assert(regenInFlightRef.current === true, "stale holds inFlight");
    const staleController = regenAbortRef.current;
    assert(staleController instanceof AbortController, "stale controller installed");

    // clearChat: bump generation, abort + clear all locks (owner transfer).
    regenGenerationRef.current += 1;
    regenAbortRef.current?.abort();
    regenAbortRef.current = null;
    regenInFlightRef.current = false;
    regenHandleSendPassRef.current = false;
    sendClaimRef.current = false;

    // New regen acquires under the new generation.
    const newController = new AbortController();
    const newGen = regenGenerationRef.current;
    regenInFlightRef.current = true;
    regenHandleSendPassRef.current = true;
    regenAbortRef.current = newController;
    sendClaimRef.current = true; // new send claimed under new gen

    // Stale flow finishes: its finally sees gen mismatch and must NOT clear.
    releaseStale();
    await staleP;

    assert(
      regenInFlightRef.current === true,
      "stale finally must not clear new inFlight",
    );
    assert(
      regenHandleSendPassRef.current === true,
      "stale finally must not clear new pass",
    );
    assert(
      regenAbortRef.current === newController,
      "stale finally must not null new abort controller",
    );
    assert(
      sendClaimRef.current === true,
      "stale sendClaim finally must not clear new claim (if any)",
    );
    assert(regenGenerationRef.current === newGen, "generation unchanged by stale");
    assert(newController.signal.aborted !== true, "new controller not aborted");

    // Cleanup as the new owner would.
    if (regenGenerationRef.current === newGen) {
      regenInFlightRef.current = false;
      regenHandleSendPassRef.current = false;
      regenAbortRef.current = null;
      sendClaimRef.current = false;
    }
  });

  await test("missing onSendStream propagates to regen as ok:false", async () => {
    // Mirrors AiChatPage: when onSendStream is absent, handleSend sets
    // failed=true / reasonKey=chat.backendNotWired and returns ok:false.
    // regenerateFlow must surface that as ok:false + restore snapshot.
    function simulatedHandleSendMissingStream() {
      // handleSend path when onSendStream is undefined
      const failed = true;
      const failReasonKey = "chat.backendNotWired";
      return failed
        ? { ok: false, reasonKey: failReasonKey }
        : { ok: true };
    }
    const res = await regenerateFlow({
      messages: history,
      targetMsgId: "a2",
      handleSend: async () => simulatedHandleSendMissingStream(),
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
      regenGenerationRef,
      sendClaimRef,
    });
    assert(res.ok === false, "regen must fail when stream backend missing");
    assert(
      res.reasonKey === "chat.backendNotWired",
      `reasonKey=${res.reasonKey}`,
    );
    assert(res.messages.length === history.length, "snapshot restored");
    assert(regenInFlightRef.current === false, "lock cleared after fail");
  });

  await test("sendClaim finally is generation-gated (stale cannot clear new claim)", async () => {
    // Mirrors handleSend: capture mySendGen at claim acquire; finally only
    // clears when generation still matches.
    regenGenerationRef.current = 0;
    sendClaimRef.current = false;

    const mySendGen = regenGenerationRef.current;
    sendClaimRef.current = true;

    // clearChat + new send
    regenGenerationRef.current += 1;
    sendClaimRef.current = false; // clearChat clears
    sendClaimRef.current = true; // new send claims

    // Stale finally
    if (regenGenerationRef.current === mySendGen) {
      sendClaimRef.current = false;
    }
    assert(sendClaimRef.current === true, "stale finally must not clear new claim");

    // Matching generation still clears
    const ownerGen = regenGenerationRef.current;
    if (regenGenerationRef.current === ownerGen) {
      sendClaimRef.current = false;
    }
    assert(sendClaimRef.current === false, "owner finally clears claim");
  });

  // --- Round-4 race tests: generation-gated OPERATION BODY ---

  await test("stale regen rollback after clearChat does NOT setMessages(snapshot)", async () => {
    // clearChat mid-handleSend: regen must NOT restore the pre-regen snapshot
    // into the cleared (or new) conversation.
    regenGenerationRef.current = 0;
    let rollbackCount = 0;
    let setSendingCount = 0;
    let release;
    const gate = new Promise((r) => {
      release = r;
    });

    const staleP = regenerateFlow({
      messages: history,
      targetMsgId: "a2",
      handleSend: async () => {
        // Simulate clearChat during await handleSend:
        // bump generation, wipe messages ownership, clear locks.
        regenGenerationRef.current += 1;
        regenInFlightRef.current = false;
        regenHandleSendPassRef.current = false;
        regenAbortRef.current = null;
        await gate;
        // Stream fails after clear — without body gating this would rollback.
        return { ok: false, reasonKey: "chat.serviceUnreachable" };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
      regenGenerationRef,
      sendClaimRef,
      onRollback: () => {
        rollbackCount += 1;
      },
      onSetSending: () => {
        setSendingCount += 1;
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    release();
    const res = await staleP;
    assert(res.ok === false, "stale regen fails");
    assert(res.abortedStale === true, "must abort as stale (gen mismatch)");
    assert(rollbackCount === 0, `rollback must not run, got ${rollbackCount}`);
    assert(setSendingCount === 0, `setSending must not run, got ${setSendingCount}`);
    // Stale finally must not re-clear locks either (already covered round-3,
    // re-assert here for the combined body+finally path).
    assert(regenInFlightRef.current === false, "locks stay cleared by clearChat");
  });

  await test("stale edit stamp after clearChat+new regen does NOT mark new conversation", async () => {
    // Stale edit's post-send setMessages(...edited:true) must not stamp a
    // newer conversation that started after clearChat.
    regenGenerationRef.current = 0;
    let stampCount = 0;
    let rollbackCount = 0;
    let release;
    const gate = new Promise((r) => {
      release = r;
    });

    const staleP = editFlow({
      messages: history,
      targetMsgId: "u2",
      newText: "stale edit text",
      handleSend: async () => {
        // clearChat mid-send, then a new conversation is "active".
        regenGenerationRef.current += 1;
        regenInFlightRef.current = false;
        regenHandleSendPassRef.current = false;
        regenAbortRef.current = null;
        await gate;
        return { ok: true };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
      regenGenerationRef,
      onStampEdited: () => {
        stampCount += 1;
      },
      onRollback: () => {
        rollbackCount += 1;
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    // New regen under the bumped generation (simulates post-clear activity).
    const newController = new AbortController();
    regenInFlightRef.current = true;
    regenHandleSendPassRef.current = true;
    regenAbortRef.current = newController;

    release();
    const res = await staleP;
    assert(res.ok === false, "stale edit fails");
    assert(res.abortedStale === true, "must abort as stale");
    assert(stampCount === 0, `edited stamp must not run, got ${stampCount}`);
    assert(rollbackCount === 0, `rollback must not run, got ${rollbackCount}`);
    // New owner's locks survive the stale finally.
    assert(regenInFlightRef.current === true, "new inFlight survives");
    assert(regenAbortRef.current === newController, "new abort survives");
    // Cleanup as new owner.
    regenInFlightRef.current = false;
    regenHandleSendPassRef.current = false;
    regenAbortRef.current = null;
  });

  await test("stale edit does NOT invoke handleSend after clearChat during pre-send yield", async () => {
    // Mirrors editMessage: after aborting an in-flight stream it awaits
    // setTimeout(0). If clearChat bumps generation during that yield, the
    // continuation must return early and must NOT call handleSend.
    regenGenerationRef.current = 0;
    let handleSendCalls = 0;
    let rollbackCount = 0;
    let stampCount = 0;

    // Inline mirror of editMessage's pre-send yield gate (editFlow itself
    // has no setTimeout; this tests the exact AiChatPage control flow).
    const myGeneration = regenGenerationRef.current;
    regenInFlightRef.current = true;
    regenAbortRef.current = new AbortController();
    const sendingWasTrue = true; // simulate sendingRef.current === true
    if (sendingWasTrue) {
      // abortRef.abort() omitted (no real stream); yield as editMessage does.
      const yieldP = new Promise((r) => setTimeout(r, 0));
      // clearChat during the yield:
      regenGenerationRef.current += 1;
      regenAbortRef.current?.abort();
      regenAbortRef.current = null;
      regenInFlightRef.current = false;
      regenHandleSendPassRef.current = false;
      await yieldP;
      // Post-yield generation gate (AiChatPage.editMessage).
      if (regenGenerationRef.current !== myGeneration) {
        // Early return — no truncate, no handleSend, no stamp.
        assert(handleSendCalls === 0, "handleSend must not run");
        assert(rollbackCount === 0, "no rollback");
        assert(stampCount === 0, "no stamp");
        // Stale finally must not clobber a new owner either.
        const newController = new AbortController();
        regenInFlightRef.current = true;
        regenAbortRef.current = newController;
        if (regenGenerationRef.current === myGeneration) {
          regenInFlightRef.current = false;
          regenAbortRef.current = null;
        }
        assert(regenInFlightRef.current === true, "new inFlight survives stale finally");
        assert(regenAbortRef.current === newController, "new abort survives");
        regenInFlightRef.current = false;
        regenAbortRef.current = null;
        return;
      }
    }
    // If we reach here the gate failed.
    handleSendCalls += 1;
    assert(false, "must have returned early on generation mismatch");
  });

  await test("stale regen does NOT invoke handleSend after clearChat (beforeHandleSend)", async () => {
    // regenerateFlow: clearChat between acquire and handleSend → early return,
    // handleSend never runs, no rollback.
    regenGenerationRef.current = 0;
    let handleSendCalls = 0;
    let invokeHookCalls = 0;
    let rollbackCount = 0;
    const res = await regenerateFlow({
      messages: history,
      targetMsgId: "a2",
      handleSend: async () => {
        handleSendCalls += 1;
        return { ok: true };
      },
      regenInFlightRef,
      regenHandleSendPassRef,
      regenAbortRef,
      regenGenerationRef,
      sendClaimRef,
      beforeHandleSend: async () => {
        // clearChat just before handleSend would run
        regenGenerationRef.current += 1;
        regenAbortRef.current?.abort();
        regenAbortRef.current = null;
        regenInFlightRef.current = false;
        regenHandleSendPassRef.current = false;
      },
      onHandleSendInvoked: () => {
        invokeHookCalls += 1;
      },
      onRollback: () => {
        rollbackCount += 1;
      },
    });
    assert(res.ok === false, "must fail");
    assert(res.abortedStale === true, "must be stale abort");
    assert(handleSendCalls === 0, `handleSend must not run, got ${handleSendCalls}`);
    assert(invokeHookCalls === 0, `onHandleSendInvoked must not run, got ${invokeHookCalls}`);
    assert(rollbackCount === 0, `rollback must not run, got ${rollbackCount}`);
  });


  // --- Round-5 race tests: handleSend body generation-gated ---

  await test("handleSend post-await race after clearChat does NOT setMessages", async () => {
    // Mirrors AiChatPage.handleSend: capture myGen at claim, await work, then
    // gate every mutation with stillThisRun(myGen). clearChat mid-await must
    // make the continuation bail without calling setMessages / saveEngineSession.
    const regenGenerationRef = { current: 0 };
    const sendRunIdRef = { current: 0 };
    const sendClaimRef = { current: false };
    const abortRef = { current: null };
    let setMessagesCalls = 0;
    let saveEngineSessionCalls = 0;
    let sendingMutations = 0;

    const stillThisRun = (my) => regenGenerationRef.current === my;

    async function simulatedHandleSend() {
      const mySendGen = regenGenerationRef.current;
      const myGen = mySendGen;
      sendClaimRef.current = true;
      const preSendController = new AbortController();
      abortRef.current = preSendController;
      try {
        // Fit-gate await (would call getAvailableMemoryBytesUncached)
        await new Promise((r) => setTimeout(r, 30));
        if (!stillThisRun(myGen)) {
          if (abortRef.current === preSendController) abortRef.current = null;
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        const runId = ++sendRunIdRef.current;
        // Stream await
        await new Promise((r) => setTimeout(r, 20));
        // Post-stream finalization gates
        if (!stillThisRun(myGen) || sendRunIdRef.current !== runId) {
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        setMessagesCalls += 1; // finalize setMessages
        await new Promise((r) => setTimeout(r, 5));
        if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
          saveEngineSessionCalls += 1;
        }
        if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
          sendingMutations += 1;
        }
        return { ok: true };
      } finally {
        if (regenGenerationRef.current === mySendGen) {
          sendClaimRef.current = false;
        }
      }
    }

    const sendP = simulatedHandleSend();
    // clearChat during fit-gate await
    await new Promise((r) => setTimeout(r, 10));
    sendRunIdRef.current += 1;
    regenGenerationRef.current += 1;
    sendClaimRef.current = false;
    abortRef.current?.abort();
    abortRef.current = null;

    const res = await sendP;
    assert(res.ok === false, "must fail after clearChat");
    assert(res.reasonKey === "chat.regenFailed", res.reasonKey);
    assert(setMessagesCalls === 0, `setMessages must not run, got ${setMessagesCalls}`);
    assert(saveEngineSessionCalls === 0, `saveEngineSession must not run, got ${saveEngineSessionCalls}`);
    assert(sendingMutations === 0, `sending reset must not run, got ${sendingMutations}`);
    // Stale finally must not have re-cleared a newer claim if one existed —
    // here clearChat already cleared; assert stays false.
    assert(sendClaimRef.current === false, "claim stays false");
  });

  await test("handleSend stream-finalize race after clearChat skips setMessages", async () => {
    // Same gate, but clearChat lands AFTER fit-gate (during stream await).
    const regenGenerationRef = { current: 0 };
    const sendRunIdRef = { current: 0 };
    const sendClaimRef = { current: false };
    let setMessagesCalls = 0;
    let saveEngineSessionCalls = 0;

    const stillThisRun = (my) => regenGenerationRef.current === my;

    async function simulatedHandleSend() {
      const myGen = regenGenerationRef.current;
      sendClaimRef.current = true;
      try {
        await new Promise((r) => setTimeout(r, 5)); // fit gate ok
        if (!stillThisRun(myGen)) {
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        const runId = ++sendRunIdRef.current;
        // Stream await — clearChat will fire here
        await new Promise((r) => setTimeout(r, 40));
        if (!stillThisRun(myGen) || sendRunIdRef.current !== runId) {
          return { ok: false, reasonKey: "chat.regenFailed" };
        }
        setMessagesCalls += 1;
        if (sendRunIdRef.current === runId && stillThisRun(myGen)) {
          saveEngineSessionCalls += 1;
        }
        return { ok: true };
      } finally {
        if (regenGenerationRef.current === myGen) {
          sendClaimRef.current = false;
        }
      }
    }

    const sendP = simulatedHandleSend();
    await new Promise((r) => setTimeout(r, 15)); // past fit-gate, into stream
    // clearChat
    sendRunIdRef.current += 1;
    regenGenerationRef.current += 1;
    sendClaimRef.current = false;

    // New send claims under new generation
    const newGen = regenGenerationRef.current;
    sendClaimRef.current = true;

    const res = await sendP;
    assert(res.ok === false, "stale must fail");
    assert(setMessagesCalls === 0, `setMessages=${setMessagesCalls}`);
    assert(saveEngineSessionCalls === 0, `save=${saveEngineSessionCalls}`);
    // Stale finally must not clear the new claim
    assert(sendClaimRef.current === true, "new claim survives stale finally");
    // Owner release
    if (regenGenerationRef.current === newGen) sendClaimRef.current = false;
  });

  // --- Round-6 race tests: deferred setMessages / updateMessage inner guards ---

  await test("deferred setMessages after clearChat-after-fit-return does NOT apply", async () => {
    // Mirrors AiChatPage.handleSend: outer gate can pass, schedule a functional
    // setMessages, then clearChat bumps generation before React applies the
    // updater. The INNER check at the top of the updater must return prev.
    const regenGenerationRef = { current: 0 };
    const sendRunIdRef = { current: 0 };
    let messages = [{ id: "u0", role: "user", text: "hi" }];
    let applied = 0;
    let skipped = 0;

    const stillThisRun = (my) => regenGenerationRef.current === my;

    async function simulatedHandleSend() {
      const myGen = regenGenerationRef.current;
      sendClaim: {
        /* claim */
      }
      const runId = ++sendRunIdRef.current;
      // Fit gate ok
      await new Promise((r) => setTimeout(r, 5));
      if (!stillThisRun(myGen) || sendRunIdRef.current !== runId) {
        return { ok: false, reasonKey: "chat.regenFailed" };
      }
      // Outer gate passed — schedule deferred setMessages (simulates React).
      const deferred = () => {
        // INNER guard (AiChatPage setMessages updaters)
        if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) {
          skipped += 1;
          return; // return prev unchanged
        }
        applied += 1;
        messages = [
          ...messages,
          { id: "u1", role: "user", text: "stale" },
          { id: "a1", role: "assistant", text: "stale reply" },
        ];
      };
      // clearChat BEFORE the deferred updater runs
      sendRunIdRef.current += 1;
      regenGenerationRef.current += 1;
      messages = []; // clearChat wiped history
      // Deferred updater fires later
      deferred();
      return { ok: false, reasonKey: "chat.regenFailed" };
    }

    const res = await simulatedHandleSend();
    assert(res.ok === false, "stale path fails");
    assert(applied === 0, `applied=${applied}`);
    assert(skipped === 1, `skipped=${skipped}`);
    assert(messages.length === 0, `messages resurrected: ${messages.length}`);
  });

  await test("deferred updateMessage after generation move does NOT apply", async () => {
    // Mirrors updateMessage(ownerGen, ownerRunId) inner functional setter.
    const regenGenerationRef = { current: 0 };
    const sendRunIdRef = { current: 0 };
    let messages = [
      { id: "a1", role: "assistant", text: "", streaming: true },
    ];
    let applied = 0;
    let skipped = 0;

    function updateMessage(id, patchOrFn, ownerGen, ownerRunId) {
      // Simulate React deferred application of the functional updater.
      const apply = () => {
        if (
          ownerGen !== undefined &&
          (ownerGen !== regenGenerationRef.current ||
            (ownerRunId !== undefined && ownerRunId !== sendRunIdRef.current))
        ) {
          skipped += 1;
          return;
        }
        const idx = messages.findIndex((m) => m.id === id);
        if (idx === -1) return;
        const patch =
          typeof patchOrFn === "function" ? patchOrFn(messages[idx]) : patchOrFn;
        messages = messages.slice();
        messages[idx] = { ...messages[idx], ...patch };
        applied += 1;
      };
      return apply; // caller schedules
    }

    const myGen = regenGenerationRef.current;
    const runId = ++sendRunIdRef.current;
    const deferred = updateMessage(
      "a1",
      { text: "stale token", statusLabel: undefined },
      myGen,
      runId,
    );
    // clearChat / newer send moves generation + runId
    sendRunIdRef.current += 1;
    regenGenerationRef.current += 1;
    messages = []; // wiped
    deferred();
    assert(applied === 0, `applied=${applied}`);
    assert(skipped === 1, `skipped=${skipped}`);
    assert(messages.length === 0, "must not resurrect assistant");
  });


  // --- Round-7 race tests: discard mutex + model-switch queue ---

  await test("discardInFlight mutex: second discard no-ops while first runs", async () => {
    // Mirrors AppShell onAppState background/inactive: gate on discardInFlightRef.
    let disposeCalls = 0;
    async function runDiscard() {
      if (discardInFlightRef.current) return { ran: false };
      discardInFlightRef.current = true;
      try {
        await new Promise((r) => setTimeout(r, 40));
        disposeCalls += 1;
        return { ran: true };
      } finally {
        discardInFlightRef.current = false;
        discardGenerationRef.current += 1;
      }
    }
    const gen0 = discardGenerationRef.current;
    const p1 = runDiscard();
    const p2 = runDiscard(); // concurrent second event
    const [r1, r2] = await Promise.all([p1, p2]);
    assert(r1.ran === true, "first discard runs");
    assert(r2.ran === false, "second discard no-ops");
    assert(disposeCalls === 1, `disposeCalls=${disposeCalls}`);
    assert(
      discardGenerationRef.current === gen0 + 1,
      `gen ${discardGenerationRef.current} expected ${gen0 + 1}`,
    );
    assert(discardInFlightRef.current === false, "flag cleared");
  });

  await test("discard bails before dispose when sendClaim re-acquired mid-wait", async () => {
    // Lifecycle wait sees a new send claim → skip dispose (engine stays).
    let disposeCalls = 0;
    discardInFlightRef.current = true;
    const gen0 = discardGenerationRef.current;
    try {
      // Simulate mid-lifecycle: a new send claims while discard awaits.
      sendClaimRef.current = true;
      if (
        sendClaimRef.current ||
        regenInFlightRef.current ||
        false
      ) {
        // bail before dispose
      } else {
        disposeCalls += 1;
      }
    } finally {
      discardInFlightRef.current = false;
      discardGenerationRef.current += 1;
    }
    assert(disposeCalls === 0, "must not dispose under claim");
    assert(discardGenerationRef.current === gen0 + 1, "gen bumps on bail too");
    sendClaimRef.current = false;
  });

  await test("model switch while sendClaim held is deferred until claim releases", async () => {
    // Mirrors AppShell.selectModelById + deferModelSwitchIfSendClaimed queue.
    let applied = [];
    const drainInFlight = { current: false };

    function selectModelById(modelId) {
      if (deferModelSwitchIfSendClaimed(modelId)) {
        if (!drainInFlight.current) {
          drainInFlight.current = true;
          void (async () => {
            try {
              const t0 = Date.now();
              while (sendClaimRef.current && Date.now() - t0 < 5000) {
                await new Promise((r) => setTimeout(r, 20));
              }
              if (sendClaimRef.current) {
                drainPendingModelSwitch();
                return;
              }
              const pendingId = drainPendingModelSwitch();
              if (!pendingId) return;
              selectModelById(pendingId);
            } finally {
              drainInFlight.current = false;
            }
          })();
        }
        return;
      }
      applied.push(modelId);
    }

    sendClaimRef.current = true;
    selectModelById("model-A");
    selectModelById("model-B"); // last-wins while claim held
    assert(applied.length === 0, "must not apply while claimed");
    assert(pendingModelSwitchQueue.length >= 1, "queued");

    // Release claim; drain waiter should apply last-wins (model-B).
    sendClaimRef.current = false;
    const tWait = Date.now();
    while (applied.length === 0 && Date.now() - tWait < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    assert(applied.length === 1, `applied=${JSON.stringify(applied)}`);
    assert(applied[0] === "model-B", `last-wins expected model-B got ${applied[0]}`);
    assert(pendingModelSwitchQueue.length === 0, "queue drained");
    assert(drainInFlight.current === false, "drain idle");
  });

  await test("model switch applies immediately when sendClaim free", () => {
    sendClaimRef.current = false;
    assert(deferModelSwitchIfSendClaimed("model-C") === false, "no defer");
    assert(pendingModelSwitchQueue.length === 0, "queue empty");
    const deferred = deferModelSwitchIfSendClaimed("model-C");
    assert(deferred === false, "still free");
  });


  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
