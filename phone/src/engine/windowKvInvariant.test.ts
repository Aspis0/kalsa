import {
  assembleBoundaryAfterTurn,
  assembleBoundaryForAlign,
  assembleStartForLiveKv,
  completionAdoptedAssembleStart,
  decideAssembleWindowAction,
  kvHeldForAssembleWindow,
  markAssembleOutcome,
  operativeContextForLiveKv,
  shouldApplySlideAdvance,
  shouldDiscardKvForSlide,
  shouldReconcileAssembleStart,
  shouldSlideAssembleBoundary,
  toolRoundsAdoptedPrompt,
  windowHasDigest,
  windowSlideDiscardModelId,
  type AssembleBoundaryOutcome,
} from "./windowKvInvariant";

describe("shouldSlideAssembleBoundary", () => {
  test("char-budget pressure does not slide while chat KV is live", () => {
    expect(
      shouldSlideAssembleBoundary({
        budgetRebuild: true,
        forceRebuild: false,
        kvHoldsChatSession: true,
      }),
    ).toBe(false);
  });

  test("context_full forceRebuild slides even when KV is live", () => {
    expect(
      shouldSlideAssembleBoundary({
        budgetRebuild: false,
        forceRebuild: true,
        kvHoldsChatSession: true,
      }),
    ).toBe(true);
  });

  test("budget rebuild may slide when KV is not held", () => {
    expect(
      shouldSlideAssembleBoundary({
        budgetRebuild: true,
        forceRebuild: false,
        kvHoldsChatSession: false,
      }),
    ).toBe(true);
  });

  test("ceiling crossed slides even when KV is live (deliberate reset)", () => {
    expect(
      shouldSlideAssembleBoundary({
        budgetRebuild: false,
        forceRebuild: false,
        kvHoldsChatSession: true,
        ceilingCrossed: true,
      }),
    ).toBe(true);
  });
});

describe("decideAssembleWindowAction", () => {
  test("anchored: live KV + budget → no slide, no discard", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: true,
        forceRebuild: false,
        kvHoldsChatSession: true,
        anchored: true,
      }),
    ).toEqual({ slide: false, discard: false });
  });

  test("anchored: forceRebuild → slide and discard", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: false,
        forceRebuild: true,
        kvHoldsChatSession: true,
        anchored: true,
      }),
    ).toEqual({ slide: true, discard: true });
  });

  test("anchored: ceiling crossed → clear the live KV and advance", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: false,
        forceRebuild: false,
        kvHoldsChatSession: true,
        anchored: true,
        ceilingCrossed: true,
      }),
    ).toEqual({ slide: true, discard: true });
  });

  test("ciswire live KV does not slide or discard", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: true,
        forceRebuild: false,
        kvHoldsChatSession: true,
        anchored: false,
      }),
    ).toEqual({ slide: false, discard: false });
  });

  test("ciswire cold budget slide does not discard", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: true,
        forceRebuild: false,
        kvHoldsChatSession: false,
        anchored: false,
      }),
    ).toEqual({ slide: true, discard: false });
  });

  test("ciswire: live KV + ceiling crossed slides and discards", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: false,
        forceRebuild: false,
        kvHoldsChatSession: true,
        anchored: false,
        ceilingCrossed: true,
      }),
    ).toEqual({ slide: true, discard: true });
  });

  test("ciswire: cold ceiling slide slides without discarding", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: false,
        forceRebuild: false,
        kvHoldsChatSession: false,
        anchored: false,
        ceilingCrossed: true,
      }),
    ).toEqual({ slide: true, discard: false });
  });

  test("anchored cold budget slide does not delete a kept .kvs", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: true,
        forceRebuild: false,
        kvHoldsChatSession: false,
        anchored: true,
      }),
    ).toEqual({ slide: true, discard: false });
  });
});

describe("shouldDiscardKvForSlide", () => {
  test("clears the live KV only when the boundary actually moves", () => {
    expect(
      shouldDiscardKvForSlide({
        discard: true,
        previousBoundaryIndex: 4,
        nextBoundaryIndex: 4,
      }),
    ).toBe(false);
    // Infinity charBudget: the rebuild is a no-op, so the destructive clear
    // must not run and leave the prompt unchanged above the ceiling.
    expect(
      shouldDiscardKvForSlide({
        discard: true,
        previousBoundaryIndex: 4,
        nextBoundaryIndex: 0,
      }),
    ).toBe(false);
    expect(
      shouldDiscardKvForSlide({
        discard: true,
        previousBoundaryIndex: 4,
        nextBoundaryIndex: 5,
      }),
    ).toBe(true);
  });

  test("no discard requested → never clears", () => {
    expect(
      shouldDiscardKvForSlide({
        discard: false,
        previousBoundaryIndex: 4,
        nextBoundaryIndex: 9,
      }),
    ).toBe(false);
  });
});

describe("shouldApplySlideAdvance", () => {
  test("a failed clear leaves the boundary untouched", () => {
    expect(
      shouldApplySlideAdvance({ clearRequested: true, clearSucceeded: false }),
    ).toBe(false);
  });

  test("a successful clear, or no clear at all, applies the advance", () => {
    expect(
      shouldApplySlideAdvance({ clearRequested: true, clearSucceeded: true }),
    ).toBe(true);
    // Cold slide (KV not held): no clear was needed.
    expect(
      shouldApplySlideAdvance({ clearRequested: false, clearSucceeded: true }),
    ).toBe(true);
  });
});

describe("assembleBoundaryForAlign", () => {
  test("returns the boundary only for the live conversation's KV", () => {
    expect(
      assembleBoundaryForAlign({
        kvHeld: true,
        storedConv: "a",
        activeConv: "a",
        boundary: 12,
      }),
    ).toBe(12);
    // Switch race: UI chat is B, session bind still A → do not stamp B_A on B.
    expect(
      assembleBoundaryForAlign({
        kvHeld: true,
        storedConv: "a",
        activeConv: "b",
        boundary: 12,
      }),
    ).toBeNull();
    expect(
      assembleBoundaryForAlign({
        kvHeld: false,
        storedConv: "a",
        activeConv: "a",
        boundary: 12,
      }),
    ).toBeNull();
    expect(
      assembleBoundaryForAlign({
        kvHeld: true,
        storedConv: "a",
        activeConv: "a",
        boundary: undefined,
      }),
    ).toBeNull();
  });

  test("an invalidated identity (no conv, no boundary) is rejected", () => {
    // streamAssistantTurn drops both on any non-completion outcome, so the
    // next held send sees null and assembleStartForLiveKv falls back to 0.
    expect(
      assembleBoundaryForAlign({
        kvHeld: true,
        storedConv: "",
        activeConv: "chat",
        boundary: undefined,
      }),
    ).toBeNull();
  });
});

describe("assembleStartForLiveKv", () => {
  test("off + live KV start=0 even when computed window slid", () => {
    expect(
      assembleStartForLiveKv({
        mode: "off",
        loadedB: 0,
        computedStart: 23,
        kvHeld: true,
      }),
    ).toBe(0);
  });

  test("off + cold keeps the computed start", () => {
    expect(
      assembleStartForLiveKv({
        mode: "off",
        loadedB: null,
        computedStart: 23,
        kvHeld: false,
      }),
    ).toBe(23);
  });

  test("anchored leaves computedStart unchanged", () => {
    expect(
      assembleStartForLiveKv({
        mode: "anchored",
        loadedB: 0,
        computedStart: 12,
        kvHeld: true,
      }),
    ).toBe(12);
  });

  test("ciswire + held uses the saved boundary; validation rejects a stale one", () => {
    // The boundary is validated by assembleBoundaryForAlign before it reaches
    // here. A leftover digest B for a different conversation comes back null,
    // and the held path then falls to the attempted/computed start — never a
    // fabricated 0 against an unknown-start KV.
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: 20,
        computedStart: 20,
        kvHeld: true,
      }),
    ).toBe(20);
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: assembleBoundaryForAlign({
          kvHeld: true,
          storedConv: "native-a",
          activeConv: "js-b",
          boundary: 20,
        }),
        computedStart: 20,
        kvHeld: true,
      }),
    ).toBe(20);
  });

  test("ciswire + cold keeps the computed start", () => {
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: null,
        computedStart: 23,
        kvHeld: false,
      }),
    ).toBe(23);
  });

  test("ciswire + held uses the boundary saved with the .kvs (any clear path)", () => {
    // No flag: the boundary travels in the .kvs metadata, so a clear from the
    // ceiling slide, context_full or the bake heal all read back the same way.
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: 36,
        computedStart: 0,
        kvHeld: true,
      }),
    ).toBe(36);
  });

  test("ciswire + held factless: attempted start wins over computedStart", () => {
    // Post-clear reconcile: the attempted start pins which start a killed
    // re-prefill resumes from (never a native-KV claim; the clear is still
    // required per send by shouldReconcileAssembleStart).
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: null,
        computedStart: 23,
        kvHeld: true,
        attemptedStart: 11,
      }),
    ).toBe(11);
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: null,
        computedStart: 23,
        kvHeld: true,
        attemptedStart: null,
      }),
    ).toBe(23);
    // A factual boundary outranks the attempt.
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: 36,
        computedStart: 0,
        kvHeld: true,
        attemptedStart: 11,
      }),
    ).toBe(36);
  });

  test("ciswire + held factless without an attempt keeps the computed start", () => {
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: null,
        computedStart: 23,
        kvHeld: true,
      }),
    ).toBe(23);
  });

  test("off while held keeps the c7801f9 full-history clamp", () => {
    expect(
      assembleStartForLiveKv({
        mode: "off",
        loadedB: 12,
        computedStart: 23,
        kvHeld: true,
      }),
    ).toBe(0);
  });

  test("hold false + nPast>0 + loadedB null does not clamp to 0", () => {
    const loadedB = assembleBoundaryForAlign({
      kvHeld: true,
      storedConv: "native-a",
      activeConv: "js-b",
      boundary: 12,
    });
    expect(loadedB).toBeNull();
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB,
        computedStart: 23,
        kvHeld: false,
      }),
    ).toBe(23);
  });
});

describe("assembleBoundaryAfterTurn (adoption protocol)", () => {
  test("adoption installs the attempted start", () => {
    expect(
      assembleBoundaryAfterTurn({ prior: 11, pending: 11, adopted: true }),
    ).toBe(11);
    expect(
      assembleBoundaryAfterTurn({ prior: 0, pending: 36, adopted: true }),
    ).toBe(36);
  });

  test("no adoption retains the prior factual boundary", () => {
    // Turn 7/12 shape: round 0 adopted, round 1 hit the tool ceiling — the
    // absolute start is still true, so the next send must append from it.
    expect(
      assembleBoundaryAfterTurn({ prior: 11, pending: 11, adopted: false }),
    ).toBe(11);
  });

  test("no adoption with no prior stays unknown (never fabricated)", () => {
    // Post-clear killed turn: the clear already erased the fact in place;
    // retention must not resurrect a pre-clear boundary.
    expect(
      assembleBoundaryAfterTurn({ prior: undefined, pending: 36, adopted: false }),
    ).toBeUndefined();
  });
});

describe("completionAdoptedAssembleStart", () => {
  test("any token callback adopts — even on an interrupted result", () => {
    expect(
      completionAdoptedAssembleStart({
        tokenCallbackFired: true,
        tokensCached: undefined,
      }),
    ).toBe(true);
    expect(
      completionAdoptedAssembleStart({
        tokenCallbackFired: true,
        tokensCached: 0,
      }),
    ).toBe(true);
  });

  test("a returned result with tokens_cached (n_past) > 0 adopts", () => {
    // Turn-12 shape: round 0 returned with the full cache before round 1
    // hit the tool ceiling — the start was adopted by the native.
    expect(
      completionAdoptedAssembleStart({
        tokenCallbackFired: false,
        tokensCached: 6500,
      }),
    ).toBe(true);
  });

  test("tokens_evaluated alone never adopts", () => {
    // llama.rn populates tokens_evaluated from the PLANNED prompt length
    // (RNLlamaJSI.cpp num_prompt_tokens) — it is not decode evidence and is
    // deliberately not an input here.
    expect(
      completionAdoptedAssembleStart({
        tokenCallbackFired: false,
      }),
    ).toBe(false);
  });

  test("context_full evidence is rejected", () => {
    expect(
      completionAdoptedAssembleStart({
        tokenCallbackFired: false,
        tokensCached: 8191,
        contextFull: true,
      }),
    ).toBe(false);
  });

  test("error evidence is rejected", () => {
    expect(
      completionAdoptedAssembleStart({
        tokenCallbackFired: false,
        tokensCached: 4096,
        error: "loadPrompt failed",
      }),
    ).toBe(false);
    expect(
      completionAdoptedAssembleStart({
        tokenCallbackFired: true,
        tokensCached: 4096,
        error: "loadPrompt failed",
      }),
    ).toBe(false);
  });

  test("no evidence at all does not adopt", () => {
    expect(
      completionAdoptedAssembleStart({
        tokenCallbackFired: false,
        tokensCached: 0,
      }),
    ).toBe(false);
    expect(
      completionAdoptedAssembleStart({ tokenCallbackFired: false }),
    ).toBe(false);
  });
});

describe("shouldReconcileAssembleStart", () => {
  test("held KV without a same-chat start fact must clear first", () => {
    expect(shouldReconcileAssembleStart({ kvHeld: true, loadedB: null })).toBe(
      true,
    );
  });

  test("a factual boundary appends without a clear", () => {
    expect(shouldReconcileAssembleStart({ kvHeld: true, loadedB: 11 })).toBe(
      false,
    );
    expect(shouldReconcileAssembleStart({ kvHeld: true, loadedB: 0 })).toBe(
      false,
    );
  });

  test("cold KV never reconciles", () => {
    expect(
      shouldReconcileAssembleStart({ kvHeld: false, loadedB: null }),
    ).toBe(false);
  });
});

describe("markAssembleOutcome", () => {
  test("completed promotes a neutral outcome", () => {
    expect(markAssembleOutcome("early_return", "completed")).toBe("completed");
    expect(markAssembleOutcome("invalidated", "completed")).toBe("completed");
  });

  test("a terminal outcome is never overwritten by completed", () => {
    for (const terminal of [
      "aborted",
      "context_full",
      "tool_ceiling",
    ] as const) {
      expect(markAssembleOutcome(terminal, "completed")).toBe(terminal);
    }
  });

  test("abort during post-tool telemetry keeps the monotone outcome", () => {
    // The outcome no longer governs the boundary (adoption does) — it stays
    // monotone for telemetry and the fallback decision. `completed` is
    // non-terminal, so a later terminal outcome still overwrites it.
    let outcome: AssembleBoundaryOutcome = "early_return";
    outcome = markAssembleOutcome(outcome, "completed");
    outcome = markAssembleOutcome(outcome, "aborted");
    expect(outcome).toBe("aborted");
  });

  test("context_full in a tool turn stays terminal even if completed is attempted", () => {
    let outcome: AssembleBoundaryOutcome = "early_return";
    outcome = markAssembleOutcome(outcome, "context_full");
    outcome = markAssembleOutcome(outcome, "completed");
    expect(outcome).toBe("context_full");
  });
});

describe("toolRoundsAdoptedPrompt", () => {
  test("streamed text without fallback adopted", () => {
    expect(
      toolRoundsAdoptedPrompt({
        ceilingReached: false,
        fallbackNeeded: false,
        fallbackOk: false,
      }),
    ).toBe(true);
  });

  test("successful fallback adopted", () => {
    expect(
      toolRoundsAdoptedPrompt({
        ceilingReached: false,
        fallbackNeeded: true,
        fallbackOk: true,
      }),
    ).toBe(true);
  });

  test("failed or empty fallback not adopted → boundary decided by evidence", () => {
    expect(
      toolRoundsAdoptedPrompt({
        ceilingReached: false,
        fallbackNeeded: true,
        fallbackOk: false,
      }),
    ).toBe(false);
    // The outcome no longer drops the boundary by itself: without token
    // callbacks or a cached-prompt result there is no adoption, so the prior
    // factual boundary is retained instead.
    expect(
      assembleBoundaryAfterTurn({ prior: 11, pending: 11, adopted: false }),
    ).toBe(11);
  });

  test("ceiling break not adopted even with a fallback available", () => {
    expect(
      toolRoundsAdoptedPrompt({
        ceilingReached: true,
        fallbackNeeded: true,
        fallbackOk: true,
      }),
    ).toBe(false);
    expect(
      toolRoundsAdoptedPrompt({
        ceilingReached: true,
        fallbackNeeded: false,
        fallbackOk: false,
      }),
    ).toBe(false);
  });

  test("happy path (no tool and tool) keeps the boundary installed", () => {
    // No tool: emitFinalText sets completed directly; this is the same outcome.
    // Tool rounds streamed text: toolRoundsAdoptedPrompt → completed.
    const adopted = toolRoundsAdoptedPrompt({
      ceilingReached: false,
      fallbackNeeded: false,
      fallbackOk: false,
    });
    expect(adopted).toBe(true);
    expect(
      assembleBoundaryAfterTurn({ prior: 11, pending: 11, adopted: true }),
    ).toBe(11);
  });
});

describe("kvHeldForAssembleWindow", () => {
  test("nPast>0 counts as live even when the hold flag lagged", () => {
    expect(
      kvHeldForAssembleWindow({
        kvHoldsChatSession: false,
        nPast: 7840,
      }),
    ).toBe(true);
    expect(
      kvHeldForAssembleWindow({
        kvHoldsChatSession: true,
        nPast: undefined,
      }),
    ).toBe(true);
    expect(
      kvHeldForAssembleWindow({
        kvHoldsChatSession: false,
        nPast: 0,
      }),
    ).toBe(false);
  });

  test("last save tokens count as live when flag and nPast both dropped", () => {
    expect(
      kvHeldForAssembleWindow({
        kvHoldsChatSession: false,
        nPast: undefined,
        lastSaveTokens: 7189,
      }),
    ).toBe(true);
    expect(
      kvHeldForAssembleWindow({
        kvHoldsChatSession: false,
        nPast: 0,
        lastSaveTokens: 0,
      }),
    ).toBe(false);
    expect(
      kvHeldForAssembleWindow({
        kvHoldsChatSession: false,
        nPast: undefined,
        lastSaveTokens: null,
      }),
    ).toBe(false);
  });
});

describe("windowHasDigest", () => {
  test("hasDigest is false when kvHeld or nPast (or last save tokens)", () => {
    expect(
      windowHasDigest({
        retrievalOn: true,
        kvHeld: kvHeldForAssembleWindow({
          kvHoldsChatSession: true,
          nPast: undefined,
        }),
      }),
    ).toBe(false);
    expect(
      windowHasDigest({
        retrievalOn: true,
        kvHeld: kvHeldForAssembleWindow({
          kvHoldsChatSession: false,
          nPast: 7101,
        }),
      }),
    ).toBe(false);
    expect(
      windowHasDigest({
        retrievalOn: true,
        kvHeld: kvHeldForAssembleWindow({
          kvHoldsChatSession: false,
          nPast: undefined,
          lastSaveTokens: 7189,
        }),
      }),
    ).toBe(false);
    expect(
      windowHasDigest({
        retrievalOn: true,
        kvHeld: kvHeldForAssembleWindow({
          kvHoldsChatSession: false,
          nPast: 0,
        }),
      }),
    ).toBe(true);
    expect(
      windowHasDigest({
        retrievalOn: false,
        kvHeld: false,
      }),
    ).toBe(false);
  });
});

describe("operativeContextForLiveKv", () => {
  test("same-chat live KV does not inject digest/summary", () => {
    expect(
      operativeContextForLiveKv({
        kvHeld: true,
        digest: "old turn",
        summary: "rolling",
      }),
    ).toBeNull();
  });

  test("cold window may inject a non-empty digest", () => {
    expect(
      operativeContextForLiveKv({
        kvHeld: false,
        digest: "old turn",
      }),
    ).toEqual({ digest: "old turn" });
    expect(operativeContextForLiveKv({ kvHeld: false, digest: "  " })).toBeNull();
  });
});

describe("windowSlideDiscardModelId", () => {
  test("empty id is skipped (discardChatKvForWindowSlide returns false)", () => {
    expect(windowSlideDiscardModelId("")).toBeNull();
    expect(windowSlideDiscardModelId("lfm2.5-2.6b")).toBe("lfm2.5-2.6b");
  });
});
