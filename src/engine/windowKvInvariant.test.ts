import {
  assembleBoundaryForAlign,
  assembleStartForLiveKv,
  decideAssembleWindowAction,
  kvHeldForAssembleWindow,
  operativeContextForLiveKv,
  shouldApplySlideAdvance,
  shouldDiscardKvForSlide,
  shouldSlideAssembleBoundary,
  windowHasDigest,
  windowSlideDiscardModelId,
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

  test("ciswire + live KV ignores leftover digest B=20", () => {
    expect(
      assembleStartForLiveKv({
        mode: "ciswire",
        loadedB: 20,
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
