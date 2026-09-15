import {
  assembleBoundaryAfterTurn,
  assembleBoundaryForAlign,
  assembleStartForLiveKv,
  decideAssembleWindowAction,
  kvHeldForAssembleWindow,
  markAssembleOutcome,
  operativeContextForLiveKv,
  shouldApplySlideAdvance,
  shouldDiscardKvForSlide,
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

  test("ciswire: pending re-anchor clears live KV even below the ceiling", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: false,
        forceRebuild: false,
        kvHoldsChatSession: true,
        anchored: false,
        pendingWindowSlide: true,
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
    ).toBe(0);
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
    // and only then does the held path fall back to 0 (the a21746e shape).
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
    ).toBe(0);
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

  test("ciswire + held after an abort (empty KV, no saved boundary) → 0", () => {
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: null,
        computedStart: 23,
        kvHeld: true,
      }),
    ).toBe(0);
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

describe("assembleBoundaryAfterTurn", () => {
  const outcomes: AssembleBoundaryOutcome[] = [
    "aborted",
    "tool_ceiling",
    "context_full",
    "early_return",
    "invalidated",
  ];

  test("a clean completion commits the pending boundary", () => {
    expect(
      assembleBoundaryAfterTurn({ outcome: "completed", pending: 36 }),
    ).toBe(36);
  });

  test("every non-completion outcome drops the boundary", () => {
    for (const outcome of outcomes) {
      expect(assembleBoundaryAfterTurn({ outcome, pending: 36 })).toBeUndefined();
    }
  });

  test("abort mid-prefill → dropped boundary → ciswire held start 0", () => {
    const loadedB = assembleBoundaryAfterTurn({
      outcome: "aborted",
      pending: 36,
    });
    expect(loadedB).toBeUndefined();
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        // getLoadedAssembleBoundary turns an undefined boundary into null/0.
        loadedB: loadedB ?? null,
        computedStart: 0,
        kvHeld: true,
      }),
    ).toBe(0);
  });

  test("tool-round ceiling break → dropped boundary → ciswire held start 0", () => {
    const loadedB = assembleBoundaryAfterTurn({
      outcome: "tool_ceiling",
      pending: 36,
    });
    expect(loadedB).toBeUndefined();
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: loadedB ?? null,
        computedStart: 0,
        kvHeld: true,
      }),
    ).toBe(0);
  });

  test("a completed slide turn is reused on the next held send", () => {
    const nextBoundary = assembleBoundaryAfterTurn({
      outcome: "completed",
      pending: 36,
    });
    expect(nextBoundary).toBe(36);
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: nextBoundary ?? null,
        computedStart: 0,
        kvHeld: true,
      }),
    ).toBe(36);
  });

  test("off and anchored ignore the committed boundary as before", () => {
    const loadedB = assembleBoundaryAfterTurn({
      outcome: "completed",
      pending: 36,
    });
    expect(
      assembleStartForLiveKv({
        mode: "off",
        loadedB: loadedB ?? null,
        computedStart: 23,
        kvHeld: true,
      }),
    ).toBe(0);
    expect(
      assembleStartForLiveKv({
        mode: "anchored",
        loadedB: loadedB ?? null,
        computedStart: 23,
        kvHeld: true,
      }),
    ).toBe(23);
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

  test("abort during post-tool telemetry drops the boundary", () => {
    // Tool rounds adopted, then emitGovernorTelemetry aborts.
    let outcome: AssembleBoundaryOutcome = "early_return";
    outcome = markAssembleOutcome(outcome, "completed");
    outcome = markAssembleOutcome(outcome, "aborted");
    expect(assembleBoundaryAfterTurn({ outcome, pending: 36 })).toBeUndefined();
  });

  test("context_full in a tool turn drops even if completed is attempted", () => {
    let outcome: AssembleBoundaryOutcome = "early_return";
    outcome = markAssembleOutcome(outcome, "context_full");
    outcome = markAssembleOutcome(outcome, "completed");
    expect(outcome).toBe("context_full");
    expect(assembleBoundaryAfterTurn({ outcome, pending: 36 })).toBeUndefined();
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

  test("failed or empty fallback not adopted → boundary dropped", () => {
    expect(
      toolRoundsAdoptedPrompt({
        ceilingReached: false,
        fallbackNeeded: true,
        fallbackOk: false,
      }),
    ).toBe(false);
    // The canned-message path never sets completed, so the outcome stays
    // neutral and assembleBoundaryAfterTurn drops it.
    expect(
      assembleBoundaryAfterTurn({ outcome: "early_return", pending: 36 }),
    ).toBeUndefined();
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

  test("happy path (no tool and tool) commits the boundary", () => {
    // No tool: emitFinalText sets completed directly; this is the same outcome.
    expect(assembleBoundaryAfterTurn({ outcome: "completed", pending: 36 })).toBe(36);
    // Tool rounds streamed text: toolRoundsAdoptedPrompt → completed.
    const adopted = toolRoundsAdoptedPrompt({
      ceilingReached: false,
      fallbackNeeded: false,
      fallbackOk: false,
    });
    expect(adopted).toBe(true);
    expect(
      assembleBoundaryAfterTurn({ outcome: "completed", pending: 36 }),
    ).toBe(36);
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

describe("shouldDiscardKvForSlide", () => {
  test("a pending marker re-anchors even when the target did not advance", () => {
    expect(
      shouldDiscardKvForSlide({
        discard: true,
        previousBoundaryIndex: 8,
        nextBoundaryIndex: 8,
        reanchor: true,
      }),
    ).toBe(true);
  });
});
