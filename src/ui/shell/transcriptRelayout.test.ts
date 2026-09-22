/**
 * The keyboard must not throw the reader's place away — and the FIRST layout
 * must still open the conversation where it opens.
 *
 * Both halves are pinned here rather than in `transcriptScroll.test.ts` because
 * they are one rule with two edges: React Native's `onLayout` fires for the
 * band's first layout AND for every re-layout after it (the keyboard opening
 * moves the band's top edge from 116 to 105 and shrinks it to 130 dp), and
 * before this slice the view reported both as `first-layout`. The welcome
 * guard answers `first-layout` with `scrollTo: 0`, so a reader at offset 338
 * went back to the top of the block — measured, not guessed (device capture,
 * this slice). The fix is one reported fact, `placedBefore`, and the tests
 * below hold each direction of it:
 *
 *  - a RE-layout of the same conversation moves nothing (338 stays 338),
 *  - a GENUINE first layout still opens at the block's top (0),
 *  - with messages present the same event no longer slams an unpinned reader
 *    to the end (the identical defect in the other branch — `first-layout`
 *    used to return `scrollTo: end` unconditionally), while a pinned reader is
 *    still followed to the newest message, and
 *  - the fact is inert for every other cause, so nothing else changed.
 *
 * The numbers are the capture's where the capture made them (offset 338, the
 * 130 dp keyboard band) and the file's own where it did not (the 607 dp block,
 * the 443/195 dp conversation bands).
 */
import { transcriptScroll, type ScrollInput } from "./transcriptScroll";

/** The band with the keyboard open, as the capture measured it. */
const KEYBOARD_BAND = 130;
/** Where the reader had scrolled the welcome block to. */
const READER_AT = 338;
/** The welcome block with its bottom clearance (~607 dp, see the scroll file). */
const BLOCK = 607;
/** A conversation taller than the band — the Jelly's full-height band. */
const JELLY_BAND = 443;
const CONTENT = 900;

function input(partial: Partial<ScrollInput>): ScrollInput {
  return {
    cause: "first-layout",
    contentHeight: BLOCK,
    viewportHeight: KEYBOARD_BAND,
    offsetY: READER_AT,
    pinned: true,
    messageCount: 0,
    placedBefore: false,
    ...partial,
  };
}

describe("a re-layout of the same conversation is not a first layout", () => {
  it("leaves the welcome block's reader at 338 when the keyboard opens", () => {
    // The exact failure: same event (`onLayout` -> `first-layout`), band down
    // to 130 dp, and the guard that used to answer `scrollTo: 0`.
    expect(
      transcriptScroll(
        input({ placedBefore: true, pinned: true, messageCount: 0, offsetY: READER_AT }),
      ),
    ).toEqual({ pinned: true, scrollTo: null });
  });

  it("leaves an unpinned reader at 338 when MESSAGES are present", () => {
    // The same bug in the other branch: with messages, `first-layout` returned
    // `{ pinned: true, scrollTo: end }` unconditionally, so the keyboard would
    // have slammed a reader mid-conversation to the bottom AND re-pinned them.
    expect(
      transcriptScroll(
        input({
          placedBefore: true,
          contentHeight: CONTENT,
          viewportHeight: KEYBOARD_BAND,
          offsetY: READER_AT,
          pinned: false,
          messageCount: 3,
        }),
      ),
    ).toEqual({ pinned: false, scrollTo: null });
  });

  it("still follows a PINNED reader to the end — the resize rule, unchanged", () => {
    // The re-layout folds into `resize`, whose pinned half exists so the newest
    // message stays visible when the band shrinks. Same numbers as the resize
    // case in `transcriptScroll.test.ts`, one different event.
    expect(
      transcriptScroll(
        input({
          placedBefore: true,
          contentHeight: CONTENT,
          viewportHeight: 195,
          offsetY: CONTENT - JELLY_BAND,
          pinned: true,
          messageCount: 3,
        }),
      ),
    ).toEqual({ pinned: true, scrollTo: CONTENT - 195 });
  });
});

describe("a genuine first layout still opens at the opening offset", () => {
  it("takes the welcome block to its first line, whatever offset the view reports", () => {
    // The offset is meaningless before anything is placed — so a stale 338
    // (the half a blunt fix would have kept) is ignored, not obeyed.
    expect(
      transcriptScroll(
        input({ placedBefore: false, messageCount: 0, offsetY: READER_AT, pinned: true }),
      ),
    ).toEqual({ pinned: true, scrollTo: 0 });
  });

  it("takes a conversation to its end, even reporting a stale offset", () => {
    expect(
      transcriptScroll(
        input({
          placedBefore: false,
          contentHeight: CONTENT,
          viewportHeight: JELLY_BAND,
          offsetY: READER_AT,
          pinned: false,
          messageCount: 3,
        }),
      ),
    ).toEqual({ pinned: true, scrollTo: CONTENT - JELLY_BAND });
  });
});

describe("the fact speaks only for the first-layout event", () => {
  it("leaves every other cause's decision identical with or without it", () => {
    // Guards the fix from over-reach: `placedBefore` must not become a second
    // opinion on append, growth, scroll, jump or resize.
    for (const cause of ["user-scroll", "growth", "append", "resize", "jump-to-end"] as const) {
      for (const messageCount of [0, 3]) {
        const base = {
          cause,
          contentHeight: CONTENT,
          viewportHeight: KEYBOARD_BAND,
          offsetY: READER_AT,
          pinned: false,
          messageCount,
        } as const;
        expect(transcriptScroll(input({ ...base, placedBefore: true }))).toEqual(
          transcriptScroll(input({ ...base, placedBefore: false })),
        );
      }
    }
  });
});
