/**
 * The three failures bottom-anchoring is known for, as tests.
 *
 * None of them can be seen in a screenshot, which is why they are asserted here
 * rather than checked by looking: a test that only proved "the last message is
 * visible in this one frame" would pass while the view jumped under the reader.
 * The sizes are the real ones: the Jelly's transcript band is 443 dp at 349x621
 * and 195 dp with the keyboard open.
 */
import {
  PIN_THRESHOLD_DP,
  PROGRAMMATIC_SCROLL_GRACE_MS,
  duplicateMessageIds,
  endOffset,
  transcriptScroll,
  type ScrollInput,
} from "./transcriptScroll";

/** The Jelly's full-height transcript band, from the shell geometry. */
const JELLY_VIEWPORT = 443;
/** A conversation taller than the band, which is the case that scrolls. */
const CONTENT = 900;

function input(partial: Partial<ScrollInput>): ScrollInput {
  return {
    cause: "growth",
    contentHeight: CONTENT,
    viewportHeight: JELLY_VIEWPORT,
    offsetY: 0,
    pinned: true,
    // BEFORE this field existed the machine could not tell a conversation from
    // the welcome block, which is the defect the empty-state block below pins.
    // The default here is 1 — a conversation WITH messages — so every existing
    // assertion keeps exactly the meaning (and the expected value) it had; the
    // empty case is only ever reached where a test opts in with `messageCount: 0`.
    messageCount: 1,
    ...partial,
  };
}

describe("endOffset: a short conversation begins at the top", () => {
  it("is zero when everything already fits, which is the same as the top", () => {
    expect(endOffset(300, JELLY_VIEWPORT)).toBe(0);
  });

  it("is the overflowing amount when the content is taller than the band", () => {
    expect(endOffset(CONTENT, JELLY_VIEWPORT)).toBe(CONTENT - JELLY_VIEWPORT);
  });

  it("never goes negative, whatever it is handed", () => {
    expect(endOffset(-100, JELLY_VIEWPORT)).toBe(0);
    expect(endOffset(100, -5)).toBe(100);
    expect(endOffset(0, 0)).toBe(0);
  });
});

describe("failure 1 — whose is the last message", () => {
  it("shows the end on first layout when the conversation overflows", () => {
    // The offset is zero at this moment and means nothing: nothing is placed yet.
    expect(transcriptScroll(input({ cause: "first-layout", offsetY: 0, pinned: false }))).toEqual({
      pinned: true,
      scrollTo: CONTENT - JELLY_VIEWPORT,
    });
  });

  it("leaves a conversation that fits exactly at the top", () => {
    expect(transcriptScroll(input({ cause: "first-layout", contentHeight: 300, offsetY: 0 }))).toEqual({
      pinned: true,
      scrollTo: 0,
    });
  });

  it("keeps the end in view when the keyboard opens while pinned", () => {
    // The band shrinks to the keyboard case; the newest message must stay visible.
    const decision = transcriptScroll(
      input({ cause: "resize", contentHeight: CONTENT, viewportHeight: 195, offsetY: CONTENT - JELLY_VIEWPORT, pinned: true }),
    );
    expect(decision).toEqual({ pinned: true, scrollTo: CONTENT - 195 });
  });

  it("does not throw a reader who scrolled away to the bottom when the band resizes", () => {
    expect(
      transcriptScroll(input({ cause: "resize", contentHeight: CONTENT, viewportHeight: 195, offsetY: 120, pinned: false })),
    ).toEqual({ pinned: false, scrollTo: null });
  });

  it("follows an append while pinned, even though the old offset is now far from the end", () => {
    // The offset still points at the previous end; the content grew by 100. A pin
    // derived from the offset would read 100 > threshold and stop following.
    const decision = transcriptScroll(
      input({ cause: "append", contentHeight: CONTENT + 100, offsetY: CONTENT - JELLY_VIEWPORT, pinned: true }),
    );
    expect(decision).toEqual({ pinned: true, scrollTo: CONTENT + 100 - JELLY_VIEWPORT });
  });
});

describe("failure 2 — the answer above itself and then below", () => {
  it("sees no duplicate when each message appears once", () => {
    expect(duplicateMessageIds([{ id: "u1" }, { id: "a1" }, { id: "u2" }])).toEqual([]);
  });

  it("catches the placeholder and the real answer as two entries", () => {
    expect(duplicateMessageIds([{ id: "a1" }, { id: "a1" }])).toEqual(["a1"]);
  });

  it("reports a repeated id once, however many times it repeats", () => {
    expect(duplicateMessageIds([{ id: "a1" }, { id: "a1" }, { id: "b" }, { id: "a1" }])).toEqual(["a1"]);
  });

  it("reports each duplicated id in the order it is first repeated", () => {
    expect(duplicateMessageIds([{ id: "a" }, { id: "b" }, { id: "b" }, { id: "a" }])).toEqual(["b", "a"]);
  });
});

describe("failure 3 — the view fighting the reader", () => {
  it("does not move for the reader's own scroll, at the end or away from it", () => {
    const atEnd = transcriptScroll(
      input({ cause: "user-scroll", offsetY: CONTENT - JELLY_VIEWPORT, pinned: true }),
    );
    expect(atEnd).toEqual({ pinned: true, scrollTo: null });

    const away = transcriptScroll(input({ cause: "user-scroll", offsetY: 100, pinned: false }));
    expect(away).toEqual({ pinned: false, scrollTo: null });
  });

  it("unpins as soon as the reader is further than the threshold from the end", () => {
    const end = CONTENT - JELLY_VIEWPORT;
    expect(transcriptScroll(input({ cause: "user-scroll", offsetY: end - PIN_THRESHOLD_DP })).pinned).toBe(true);
    expect(transcriptScroll(input({ cause: "user-scroll", offsetY: end - PIN_THRESHOLD_DP - 1 })).pinned).toBe(false);
  });

  it("never moves a reader who is away from the end, whatever arrives", () => {
    expect(transcriptScroll(input({ cause: "append", contentHeight: CONTENT + 100, offsetY: 100, pinned: false }))).toEqual(
      { pinned: false, scrollTo: null },
    );
    expect(transcriptScroll(input({ cause: "growth", contentHeight: CONTENT + 400, offsetY: 100, pinned: false }))).toEqual(
      { pinned: false, scrollTo: null },
    );
  });

  it("returns to the end and pins when the reader asks to", () => {
    expect(transcriptScroll(input({ cause: "jump-to-end", offsetY: 100, pinned: false }))).toEqual({
      pinned: true,
      scrollTo: CONTENT - JELLY_VIEWPORT,
    });
  });

  it("pins again by itself when the reader scrolls back to the end", () => {
    expect(transcriptScroll(input({ cause: "user-scroll", offsetY: CONTENT - JELLY_VIEWPORT })).pinned).toBe(true);
  });
});

describe("an empty conversation reads from its top (the welcome block)", () => {
  // The two real numbers the device capture measured (`host3-firstopen.png`):
  // the block with its bottom clearance is ~607 dp of content (24 top + a
  // 240.75 dp plate + the prompt + 4 cards of 61 + their gaps + the 24 dp
  // clearance) against a 357 dp band — 621 minus the 48 dp of insets, the
  // 60 dp strip, the 78 dp composer, the 48 dp toolbar and the 30 dp hold line.
  const WELCOME = 607;
  const BAND = 357;
  /** Deep inside the block, where the old first layout parked the reader. */
  const PARKED_AT = WELCOME - BAND; // 250 dp in

  it("opens at the first line, not at the bottom of the block", () => {
    expect(
      transcriptScroll(
        input({
          cause: "first-layout",
          contentHeight: WELCOME,
          viewportHeight: BAND,
          offsetY: 0,
          pinned: false,
          messageCount: 0,
        }),
      ),
    ).toEqual({ pinned: true, scrollTo: 0 });
  });

  it("keeps the pin armed while the block is shown, wherever the reader scrolls", () => {
    // The top of the block is 250 dp from the block's end; the distance rule
    // would unpin here, and the first message would then never be followed to.
    expect(
      transcriptScroll(
        input({
          cause: "user-scroll",
          contentHeight: WELCOME,
          viewportHeight: BAND,
          offsetY: 0,
          pinned: true,
          messageCount: 0,
        }),
      ),
    ).toEqual({ pinned: true, scrollTo: null });
    expect(
      transcriptScroll(
        input({
          cause: "user-scroll",
          contentHeight: WELCOME,
          viewportHeight: BAND,
          offsetY: PARKED_AT,
          pinned: true,
          messageCount: 0,
        }),
      ),
    ).toEqual({ pinned: true, scrollTo: null });
  });

  it("never moves the reader when the block itself changes size", () => {
    for (const cause of ["growth", "resize"] as const) {
      expect(
        transcriptScroll(
          input({
            cause,
            contentHeight: WELCOME + 40,
            viewportHeight: BAND,
            offsetY: 60,
            pinned: true,
            messageCount: 0,
          }),
        ),
      ).toEqual({ pinned: true, scrollTo: null });
    }
  });

  it("offers no jump to the block's end — there is no conversation to jump to", () => {
    expect(
      transcriptScroll(
        input({
          cause: "jump-to-end",
          contentHeight: WELCOME,
          viewportHeight: BAND,
          offsetY: 60,
          pinned: true,
          messageCount: 0,
        }),
      ),
    ).toEqual({ pinned: true, scrollTo: 0 });
  });

  it("follows the first message to the end of the conversation it starts", () => {
    // The transition the whole rule exists for: armed while empty, so the
    // append that creates the first message lands the reader at the end of the
    // grown conversation instead of at the top of it.
    const grown = 700;
    expect(
      transcriptScroll(
        input({
          cause: "append",
          contentHeight: grown,
          viewportHeight: BAND,
          offsetY: 0,
          pinned: true,
          messageCount: 1,
        }),
      ),
    ).toEqual({ pinned: true, scrollTo: grown - BAND });
  });

  it("returns to the block's first line when the conversation is wiped back to empty", () => {
    expect(
      transcriptScroll(
        input({
          cause: "append",
          contentHeight: WELCOME,
          viewportHeight: BAND,
          offsetY: PARKED_AT,
          pinned: false,
          messageCount: 0,
        }),
      ),
    ).toEqual({ pinned: true, scrollTo: 0 });
  });

  it("with messages present, first layout still opens at the end (nothing moved)", () => {
    expect(
      transcriptScroll(
        input({
          cause: "first-layout",
          contentHeight: WELCOME,
          viewportHeight: BAND,
          offsetY: 0,
          pinned: false,
          messageCount: 1,
        }),
      ),
    ).toEqual({ pinned: true, scrollTo: PARKED_AT });
  });
});

describe("the programmatic-scroll grace", () => {
  it("outlasts the longest scroll animation the design names", () => {
    // DESIGN.md §2.11: the sheet is 250-300 ms, the longest scroll motion in the
    // table. A programmatic scroll must be allowed to finish before its own
    // events are read as the reader's, so the grace is asserted against that
    // value. Keeping the literal here — rather than importing a constant — is
    // deliberate: the test must fail if the design's longest animation grows
    // past the grace, whatever the motion table is called.
    const LONGEST_DESIGNED_SCROLL_ANIMATION_MS = 300;
    expect(PROGRAMMATIC_SCROLL_GRACE_MS).toBeGreaterThan(LONGEST_DESIGNED_SCROLL_ANIMATION_MS);
  });
});
