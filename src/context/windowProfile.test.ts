/**
 * Unit tests for the derived engine window.
 *
 * The defect this replaces was a window sized against a context the device
 * never got, so the cases that matter are the ones where n_ctx is small and
 * where the budget — not the message count — is what binds.
 */

import {
  WINDOW_CHARS_PER_TOKEN,
  WINDOW_MAX_MESSAGES,
  WINDOW_MAX_MESSAGES_IMAGES,
  WINDOW_MIN_MESSAGES,
  WINDOW_RESERVE_TOKENS,
  resolveWindowProfile,
  windowStartIndex,
} from "./windowProfile";

describe("resolveWindowProfile", () => {
  it("gives an 8192 context a real budget instead of the old inert branch", () => {
    const p = resolveWindowProfile({ nCtx: 8192, hasImages: false, hasDigest: false });
    // (8192 - 2048) * 0.75 * 3
    expect(p.charBudget).toBe(
      Math.floor((8192 - WINDOW_RESERVE_TOKENS) * 0.75 * WINDOW_CHARS_PER_TOKEN),
    );
    expect(p.maxMessages).toBe(WINDOW_MAX_MESSAGES);
    expect(p.source).toBe("nctx:8192/bare");
  });

  it("scales with the context the engine actually loaded", () => {
    const small = resolveWindowProfile({ nCtx: 8192, hasImages: false, hasDigest: false });
    const large = resolveWindowProfile({ nCtx: 16384, hasImages: false, hasDigest: false });
    expect(large.charBudget).toBeGreaterThan(small.charBudget);
  });

  it("leaves the digest room in the prompt it also has to share", () => {
    const bare = resolveWindowProfile({ nCtx: 8192, hasImages: false, hasDigest: false });
    const digest = resolveWindowProfile({ nCtx: 8192, hasImages: false, hasDigest: true });
    expect(digest.charBudget).toBeLessThan(bare.charBudget);
    expect(digest.source).toBe("nctx:8192/digest");
  });

  it("keeps the tight image cap and does not try to budget image tokens", () => {
    const p = resolveWindowProfile({ nCtx: 16384, hasImages: true, hasDigest: true });
    expect(p.maxMessages).toBe(WINDOW_MAX_MESSAGES_IMAGES);
    expect(p.charBudget).toBe(Number.POSITIVE_INFINITY);
    expect(p.source).toBe("images");
  });

  it("does not invent a budget when no engine has loaded yet", () => {
    for (const nCtx of [0, null, undefined, NaN, -1]) {
      const p = resolveWindowProfile({ nCtx, hasImages: false, hasDigest: false });
      expect(p.source).toBe("no-engine");
      expect(p.charBudget).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it("never returns a negative budget for a context smaller than the reserve", () => {
    const p = resolveWindowProfile({ nCtx: 512, hasImages: false, hasDigest: false });
    expect(p.charBudget).toBe(0);
  });
});

describe("windowStartIndex", () => {
  const profile = { maxMessages: 40, charBudget: 1000, source: "test" };

  it("returns 0 for an empty history", () => {
    expect(windowStartIndex([], profile, 4000)).toBe(0);
  });

  it("keeps everything when the whole history fits the budget", () => {
    expect(windowStartIndex([100, 100, 100], profile, 4000)).toBe(0);
  });

  it("stops at the budget, not at the message count", () => {
    // 10 messages of 200 chars = 2000, budget 1000 → last 5 fit.
    const lengths = Array.from({ length: 10 }, () => 200);
    expect(windowStartIndex(lengths, profile, 4000)).toBe(5);
  });

  it("counts each message at the cap assembly will apply, not its stored size", () => {
    // Stored 10 000 chars each, capped to 500 → budget 1000 holds two.
    const lengths = [10_000, 10_000, 10_000, 10_000];
    expect(windowStartIndex(lengths, profile, 500)).toBe(2);
  });

  it("keeps the minimum even when one message blows the whole budget", () => {
    const lengths = [50, 50, 50, 999_999];
    const start = windowStartIndex(lengths, profile, 4000);
    expect(lengths.length - start).toBeGreaterThanOrEqual(
      Math.min(WINDOW_MIN_MESSAGES, lengths.length),
    );
  });

  it("survives a history shorter than the minimum", () => {
    expect(windowStartIndex([999_999], profile, 4000)).toBe(0);
  });

  it("still honours the message cap when the budget is infinite", () => {
    const lengths = Array.from({ length: 30 }, () => 10);
    const imageProfile = { maxMessages: 8, charBudget: Infinity, source: "images" };
    expect(windowStartIndex(lengths, imageProfile, 2000)).toBe(22);
  });

  // Everything below was added after a hostile audit found each case unbounded.
  it("charges a NaN length as zero instead of voiding the whole budget", () => {
    // A propagated NaN makes every later `used + cost > budget` false, so the
    // budget stops binding for the REST of the walk — one bad row silently
    // disables the bound.
    const lengths = [200, 200, Number.NaN, 200, 200, 200, 200, 200];
    const start = windowStartIndex(lengths, { ...profile, charBudget: 600 }, 4000);
    expect(Number.isInteger(start)).toBe(true);
    expect(start).toBeGreaterThan(0);
  });

  it("survives holes, undefined and negative lengths", () => {
    const lengths = [100, undefined, -50, 100] as unknown as number[];
    const start = windowStartIndex(lengths, profile, 4000);
    expect(Number.isInteger(start)).toBe(true);
    expect(start).toBeGreaterThanOrEqual(0);
  });

  it("never returns more messages than maxMessages, even below the minimum", () => {
    // The floor guarantees a minimum; it must not override an explicit cap.
    const lengths = [10, 10, 10];
    for (const maxMessages of [0, 1, 2]) {
      const start = windowStartIndex(lengths, { ...profile, maxMessages }, 4000);
      expect(lengths.length - start).toBeLessThanOrEqual(maxMessages);
    }
  });

  it("shrinks when the caller pre-charges the turn being sent", () => {
    const lengths = Array.from({ length: 10 }, () => 200);
    const full = windowStartIndex(lengths, { ...profile, charBudget: 1000 }, 4000);
    const charged = windowStartIndex(lengths, { ...profile, charBudget: 400 }, 4000);
    expect(charged).toBeGreaterThan(full);
  });

  it("treats a zero budget as 'the minimum and nothing more'", () => {
    const lengths = Array.from({ length: 10 }, () => 100);
    const zero = { maxMessages: 40, charBudget: 0, source: "tiny" };
    expect(lengths.length - windowStartIndex(lengths, zero, 4000)).toBe(
      WINDOW_MIN_MESSAGES,
    );
  });
});
