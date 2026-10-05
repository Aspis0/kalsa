import {
  TRANSCRIPT_WINDOW_PAGE,
  TRANSCRIPT_WINDOW_TAIL,
  prependPage,
  tailWindow,
  windowIsAnchored,
} from "./transcriptWindow";

function rows(count: number): Array<{ id: string }> {
  return Array.from({ length: count }, (_, index) => ({ id: `row-${index}` }));
}

describe("tailWindow arms at the conversation's last tail", () => {
  it("holds everything at or under the tail, anchored at the first row", () => {
    expect(tailWindow([])).toEqual({ anchorId: null, start: 0 });
    expect(tailWindow(rows(5))).toEqual({ anchorId: "row-0", start: 0 });
    expect(tailWindow(rows(TRANSCRIPT_WINDOW_TAIL))).toEqual({
      anchorId: "row-0",
      start: 0,
    });
  });

  it("holds the last tail rows of a longer conversation", () => {
    const settled = rows(TRANSCRIPT_WINDOW_TAIL + 1);
    const armed = tailWindow(settled);
    expect(armed.start).toBe(1);
    expect(armed.anchorId).toBe("row-1");

    const fifty = tailWindow(rows(50));
    expect(fifty.start).toBe(50 - TRANSCRIPT_WINDOW_TAIL);
    expect(fifty.anchorId).toBe(`row-${50 - TRANSCRIPT_WINDOW_TAIL}`);
  });
});

describe("windowIsAnchored detects a conversation replaced under a stale window", () => {
  it("holds for the window the list armed", () => {
    const settled = rows(40);
    expect(windowIsAnchored(tailWindow(settled), settled)).toBe(true);
  });

  it("fails when another conversation now sits at the anchor, or a shorter one", () => {
    const settled = rows(40);
    const armed = tailWindow(settled);
    expect(windowIsAnchored(armed, rows(40).map((row) => ({ id: `${row.id}-other` })))).toBe(false);
    expect(windowIsAnchored(armed, settled.slice(0, 3))).toBe(false);
  });

  it("holds an empty conversation armed at nothing", () => {
    expect(windowIsAnchored(tailWindow([]), [])).toBe(true);
  });
});

describe("prependPage steps one page back and never past the first row", () => {
  it("moves the anchor to the page's new first row", () => {
    const settled = rows(200);
    const armed = tailWindow(settled);
    const paged = prependPage(armed, settled);
    expect(paged.start).toBe(armed.start - TRANSCRIPT_WINDOW_PAGE);
    expect(paged.anchorId).toBe(`row-${paged.start}`);
  });

  it("clamps at the conversation's first row and is inert there", () => {
    const settled = rows(TRANSCRIPT_WINDOW_TAIL + 3);
    const armed = tailWindow(settled);
    const paged = prependPage(armed, settled);
    expect(paged.start).toBe(0);
    expect(prependPage(paged, settled)).toBe(paged);
  });
});
