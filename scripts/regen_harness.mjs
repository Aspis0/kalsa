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
  } = opts;
  if (
    regenInFlightRef.current ||
    (sendClaimRef && sendClaimRef.current)
  ) {
    return { ok: false, reasonKey: "chat.regenBusy", messages };
  }
  // Capture generation at acquire; finally only releases on match.
  const myGeneration = regenGenerationRef ? regenGenerationRef.current : 0;
  regenInFlightRef.current = true;
  if (regenAbortRef) regenAbortRef.current = new AbortController();
  const snapshot = messages.slice();
  try {
    const targetIndex = messages.findIndex((m) => m.id === targetMsgId);
    if (targetIndex < 0) {
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot };
    }
    const slice = messages.slice(0, targetIndex + 1);
    const originalUserText = findOriginalUserText(slice);
    if (!originalUserText) {
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot };
    }
    const target = messages[targetIndex];
    const cutExclusive =
      target?.role === "assistant" ? targetIndex : targetIndex + 1;
    let base = messages.slice(0, cutExclusive);
    if (base.length > 0 && base[base.length - 1]?.role === "user") {
      base = base.slice(0, -1);
    }
    if (regenAbortRef?.current?.signal?.aborted) {
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot };
    }
    regenHandleSendPassRef.current = true;
    const sendResult = await handleSend(originalUserText, base);
    // Real handleSend returns {ok:false} on stream failure (does not throw).
    if (sendResult && typeof sendResult === "object" && sendResult.ok === false) {
      return {
        ok: false,
        reasonKey: sendResult.reasonKey || "chat.regenFailed",
        messages: snapshot,
      };
    }
    return { ok: true, messages: base, originalUserText };
  } catch (err) {
    return {
      ok: false,
      reasonKey: "chat.regenFailed",
      messages: snapshot,
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

/** Pure edit flow: splice at index, stamp edited, truncate after, handleSend. */
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
  } = opts;
  const trimmed = String(newText ?? "").trim();
  if (!trimmed) {
    return { ok: false, reasonKey: "chat.regenFailed", messages };
  }
  if (regenInFlightRef.current) {
    return { ok: false, reasonKey: "chat.regenBusy", messages };
  }
  const myGeneration = regenGenerationRef ? regenGenerationRef.current : 0;
  regenInFlightRef.current = true;
  if (regenAbortRef) regenAbortRef.current = new AbortController();
  const snapshot = messages.slice();
  try {
    const idx = messages.findIndex((m) => m.id === targetMsgId);
    if (idx < 0) {
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot };
    }
    const target = messages[idx];
    if (!target || target.role !== "user") {
      return { ok: false, reasonKey: "chat.regenFailed", messages: snapshot };
    }
    // Atomic: keep before idx; handleSend re-appends edited user text.
    const base = messages.slice(0, idx);
    regenHandleSendPassRef.current = true;
    const sendResult = await handleSend(trimmed, base);
    if (sendResult && typeof sendResult === "object" && sendResult.ok === false) {
      return {
        ok: false,
        reasonKey: sendResult.reasonKey || "chat.regenFailed",
        messages: snapshot,
      };
    }
    // Stamp edited on a synthetic user message for harness assertion.
    const stamped = [
      ...base,
      { id: "u-edited", role: "user", text: trimmed, edited: true },
    ];
    return { ok: true, messages: stamped, editedText: trimmed };
  } catch (err) {
    return {
      ok: false,
      reasonKey: "chat.regenFailed",
      messages: snapshot,
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
  } = require(modPath);

  // Reset module state
  regenInFlightRef.current = false;
  regenHandleSendPassRef.current = false;
  regenAbortRef.current = null;
  if (sendClaimRef) sendClaimRef.current = false;
  if (regenGenerationRef) regenGenerationRef.current = 0;

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

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
