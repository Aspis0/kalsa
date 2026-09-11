import {
  assembleBoundaryForAlign,
  assembleStartForLiveKv,
  decideAssembleWindowAction,
  shouldSlideAssembleBoundary,
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

  test("ciswire never discards chat KV", () => {
    expect(
      decideAssembleWindowAction({
        budgetRebuild: true,
        forceRebuild: false,
        kvHoldsChatSession: true,
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
  test("off + live KV uses loadedB even when the computed window slid", () => {
    expect(
      assembleStartForLiveKv({
        mode: "off",
        kvHeld: true,
        loadedB: 0,
        computedStart: 23,
      }),
    ).toBe(0);
  });

  test("off + cold keeps the computed start", () => {
    expect(
      assembleStartForLiveKv({
        mode: "off",
        kvHeld: false,
        loadedB: null,
        computedStart: 23,
      }),
    ).toBe(23);
  });

  test("anchored leaves computedStart unchanged", () => {
    expect(
      assembleStartForLiveKv({
        mode: "anchored",
        kvHeld: true,
        loadedB: 0,
        computedStart: 12,
      }),
    ).toBe(12);
  });

  test("off + conv mismatch (loadedB null) does not stamp a foreign window", () => {
    expect(
      assembleStartForLiveKv({
        mode: "off",
        kvHeld: true,
        loadedB: null,
        computedStart: 23,
      }),
    ).toBe(23);
  });
});

describe("windowSlideDiscardModelId", () => {
  test("empty id is skipped (discardChatKvForWindowSlide returns false)", () => {
    expect(windowSlideDiscardModelId("")).toBeNull();
    expect(windowSlideDiscardModelId("lfm2.5-2.6b")).toBe("lfm2.5-2.6b");
  });
});
