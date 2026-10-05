import {
  TRANSCRIPT_WINDOW_PAGE,
  TRANSCRIPT_WINDOW_TAIL,
  advanceToTail,
  prependPage,
  reanchor,
  tailWindow,
} from "./transcriptWindow";

function rows(count: number, prefix = "row"): Array<{ id: string }> {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }));
}

describe("tailWindow arms at the conversation's last tail", () => {
  it("holds everything at or under the tail, anchored at the first row", () => {
    expect(tailWindow([])).toEqual({ anchorId: null, firstId: null, start: 0 });
    expect(tailWindow(rows(5))).toEqual({ anchorId: "row-0", firstId: "row-0", start: 0 });
    expect(tailWindow(rows(TRANSCRIPT_WINDOW_TAIL))).toEqual({
      anchorId: "row-0",
      firstId: "row-0",
      start: 0,
    });
  });

  it("holds the last tail rows of a longer conversation", () => {
    const armed = tailWindow(rows(50));
    expect(armed.start).toBe(50 - TRANSCRIPT_WINDOW_TAIL);
    expect(armed.anchorId).toBe(`row-${50 - TRANSCRIPT_WINDOW_TAIL}`);
    expect(armed.firstId).toBe("row-0");
  });
});

describe("reanchor keeps a reader's rows under deletions", () => {
  it("returns the window unchanged while its anchor still starts the slice", () => {
    const settled = rows(40);
    const armed = tailWindow(settled);
    expect(reanchor(armed, settled)).toBe(armed);
    // A settle or append does not move it either.
    expect(reanchor(armed, rows(41))).toBe(armed);
  });

  it("follows the anchor when rows ABOVE the window were deleted", () => {
    const settled = rows(60);
    const armed = tailWindow(settled); // start 30, anchor row-30
    const afterDeletingTenAbove = settled.slice(10); // row-30 now at 20
    expect(reanchor(armed, afterDeletingTenAbove)).toEqual({
      anchorId: "row-30",
      firstId: "row-0",
      start: 20,
    });
  });

  it("clamps to the nearest surviving row when the anchor itself is deleted", () => {
    const settled = rows(60);
    const armed = tailWindow(settled); // start 30
    // row-30 gone: the survivor that now sits at the slice's start is row-31.
    const withoutAnchor = settled.filter((row) => row.id !== "row-30");
    expect(reanchor(armed, withoutAnchor)).toEqual({
      anchorId: "row-31",
      firstId: "row-0",
      start: 30,
    });
    // The whole tail from the anchor cut: the last surviving row holds.
    const cutToTwenty = settled.slice(0, 20);
    expect(reanchor(armed, cutToTwenty)).toEqual({
      anchorId: "row-19",
      firstId: "row-0",
      start: 19,
    });
  });

  it("falls back to the tail only for a different conversation", () => {
    const settled = rows(60);
    const armed = tailWindow(settled);
    const other = rows(60, "other");
    expect(reanchor(armed, other)).toEqual(tailWindow(other));
    // And an empty conversation is the welcome block again.
    expect(reanchor(armed, [])).toEqual(tailWindow([]));
  });
});

describe("advanceToTail holds the tail while the reader is pinned", () => {
  it("re-arms at the tail when the conversation grows past the slice", () => {
    const settled = rows(TRANSCRIPT_WINDOW_TAIL + 10);
    const armed = tailWindow(rows(TRANSCRIPT_WINDOW_TAIL)); // start 0
    const advanced = advanceToTail(armed, settled);
    expect(advanced).toEqual(tailWindow(settled));
    // Chatting on: still the tail, never wider.
    const longer = rows(TRANSCRIPT_WINDOW_TAIL + 90);
    expect(advanceToTail(advanced, longer)).toEqual(tailWindow(longer));
  });

  it("leaves a short conversation alone, and releases a paged-up top when pinned", () => {
    const short = tailWindow(rows(5));
    expect(advanceToTail(short, rows(9))).toBe(short);
    // A reader who paged up holds a WIDER window — but pinned means they are
    // back at the bottom, so the wide top is invisible and returns to the tail.
    const settled = rows(100);
    const pagedUp = prependPage(tailWindow(settled), settled);
    expect(advanceToTail(pagedUp, settled)).toEqual(tailWindow(settled));
  });
});

describe("prependPage steps one page back and never past the first row", () => {
  it("moves the anchor to the page's new first row, keeping the conversation's", () => {
    const settled = rows(200);
    const armed = tailWindow(settled);
    const paged = prependPage(armed, settled);
    expect(paged.start).toBe(armed.start - TRANSCRIPT_WINDOW_PAGE);
    expect(paged.anchorId).toBe(`row-${paged.start}`);
    expect(paged.firstId).toBe("row-0");
  });

  it("clamps at the conversation's first row and is inert there", () => {
    const settled = rows(TRANSCRIPT_WINDOW_TAIL + 3);
    const armed = tailWindow(settled);
    const paged = prependPage(armed, settled);
    expect(paged.start).toBe(0);
    expect(prependPage(paged, settled)).toBe(paged);
  });
});
