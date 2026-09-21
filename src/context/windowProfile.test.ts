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
  charBudgetReserveTokens,
  conservativeWindowTokens,
  projectedWindowTokens,
  promptTokensExceedNCtx,
  resolveWindowProfile,
  shouldSlideWindowAtCeiling,
  windowCeilingTokens,
  windowStartIndex,
} from "./windowProfile";

describe("shouldSlideWindowAtCeiling", () => {
  it("ceiling is n_ctx - WINDOW_RESERVE_TOKENS, 6144 at 8192", () => {
    expect(windowCeilingTokens(8192)).toBe(8192 - WINDOW_RESERVE_TOKENS);
    expect(windowCeilingTokens(8192)).toBe(6144);
    // No engine / bogus n_ctx is never a reason to slide.
    expect(windowCeilingTokens(0)).toBe(0);
    expect(windowCeilingTokens(null)).toBe(0);
    expect(windowCeilingTokens(Number.NaN)).toBe(0);
  });

  it("prices non-window prompt tokens (the system prompt) into the ceiling", () => {
    // The S23 run of 2026-09-14: 1832 system tokens invisible to the guard.
    expect(windowCeilingTokens(8192, 1832)).toBe(8192 - WINDOW_RESERVE_TOKENS - 1832);
    // A reserve that eats the whole ceiling clamps at 0 — never negative, and
    // the window minimum is windowStartIndex's job, not an underflowed budget.
    expect(windowCeilingTokens(8192, 100_000)).toBe(0);
    // A bogus reserve must not raise the ceiling.
    expect(windowCeilingTokens(8192, -5)).toBe(6144);
    expect(windowCeilingTokens(8192, Number.NaN)).toBe(6144);
  });

  it("only slides the pinned window, and only above the ceiling", () => {
    const charsAtCeiling = 6144 * WINDOW_CHARS_PER_TOKEN;
    expect(projectedWindowTokens(charsAtCeiling)).toBe(6144);
    // Exactly at the ceiling is still allowed; it is the NEXT send that must
    // not cross it.
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling,
        kvHeld: true,
      }),
    ).toBe(false);
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling + 1,
        kvHeld: true,
      }),
    ).toBe(true);
    // Not held: the normal budget slide already applies — do not force one.
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling + 1,
        kvHeld: false,
      }),
    ).toBe(false);
  });

  it("never slides without a usable ceiling", () => {
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 0,
        windowChars: 10_000_000,
        kvHeld: true,
      }),
    ).toBe(false);
  });

  it("slides when a valid n_ctx is fully consumed by reserve + prefix", () => {
    // Ceiling 0 used to switch the guard OFF (`ceiling <= 0 → false`) —
    // standing down at exactly the worst case. A valid engine there means
    // every prompt crosses: slide (the advance clamps to the minimum window).
    expect(
      shouldSlideWindowAtCeiling({ nCtx: 2048, windowChars: 30, kvHeld: true }),
    ).toBe(true);
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: 30,
        kvHeld: true,
        // Reserve + prefix eat the whole ceiling: 8192 - 2048 - 6144 = 0.
        reservedPromptTokens: 6144,
      }),
    ).toBe(true);
    // The tool-loop sibling must stop too, not run through a consumed ceiling.
    expect(promptTokensExceedNCtx({ nCtx: 2048, promptChars: 3 })).toBe(true);
  });

  it("slides a window the un-reduced ceiling would have let pass", () => {
    // The defect: textEst 5760 < 6144 passed the guard, but the prompt the
    // native prefilled was 5760 + 1832 system tokens on n_ctx 8192.
    const charsFor = (tokens: number) => tokens * WINDOW_CHARS_PER_TOKEN;
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsFor(5760),
        kvHeld: true,
      }),
    ).toBe(false);
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsFor(5760),
        kvHeld: true,
        reservedPromptTokens: 1832,
      }),
    ).toBe(true);
  });
});

describe("promptTokensExceedNCtx", () => {
  it("flags only a full prompt above n_ctx - reserve", () => {
    const ceiling = windowCeilingTokens(8192);
    const charsAtCeiling = ceiling * WINDOW_CHARS_PER_TOKEN;
    expect(
      promptTokensExceedNCtx({ nCtx: 8192, promptChars: charsAtCeiling }),
    ).toBe(false);
    expect(
      promptTokensExceedNCtx({ nCtx: 8192, promptChars: charsAtCeiling + 1 }),
    ).toBe(true);
    // No engine → the guard is inert, not wrong.
    expect(
      promptTokensExceedNCtx({ nCtx: 0, promptChars: 10_000_000 }),
    ).toBe(false);
  });

  it("honours a reserve only when promptChars does not already carry it", () => {
    // Tool-loop convention: promptChars covers the whole message list, so the
    // default 0 must not subtract the system twice — a full-prompt 6144 tokens
    // (system included) sits exactly at the ceiling and is allowed.
    const fullPromptChars = 6144 * WINDOW_CHARS_PER_TOKEN;
    expect(
      promptTokensExceedNCtx({ nCtx: 8192, promptChars: fullPromptChars }),
    ).toBe(false);
    // The same chars charged AGAIN for the system would flag — which is why
    // only the AppShell window guard (chars without system) passes a reserve.
    expect(
      promptTokensExceedNCtx({
        nCtx: 8192,
        promptChars: fullPromptChars,
        reservedPromptTokens: 1832,
      }),
    ).toBe(true);
  });
});

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
    // 512 is below CTX_FLOOR (8192), so this is unreachable in production. The
    // reserve is min(2048, floor(512 * 0.5)) = 256, so the budget is
    // floor((512 - 256) * 0.75 * 3) = floor(576) = 576 — non-negative, which is
    // the property this case exists to pin.
    const p = resolveWindowProfile({ nCtx: 512, hasImages: false, hasDigest: false });
    expect(p.charBudget).toBe(576);
  });
});

describe("charBudgetReserveTokens", () => {
  it("halves the reserve below the constant's knee", () => {
    // 2048 is below CTX_FLOOR (engine/deviceTuning.ts, now 8192), so this row is
    // unreachable from the chat path; the halving still guards any context
    // under the 4096 knee. At the floor itself the reserve is the constant —
    // see the next case.
    expect(charBudgetReserveTokens(2048)).toBe(1024);
  });

  it("returns the constant once half the context reaches it", () => {
    // min(2048, floor(nCtx / 2)) = 2048 for every nCtx >= 4096.
    expect(charBudgetReserveTokens(3072)).toBe(1536);
    expect(charBudgetReserveTokens(4096)).toBe(WINDOW_RESERVE_TOKENS);
    expect(charBudgetReserveTokens(6144)).toBe(WINDOW_RESERVE_TOKENS);
    expect(charBudgetReserveTokens(8192)).toBe(WINDOW_RESERVE_TOKENS);
  });

  it("falls back to the constant when there is no usable context", () => {
    for (const nCtx of [0, null, undefined, Number.NaN, -1]) {
      expect(charBudgetReserveTokens(nCtx)).toBe(WINDOW_RESERVE_TOKENS);
    }
  });
});

describe("char budget across the contexts the app can load", () => {
  // Hand arithmetic. Constants: WINDOW_RESERVE_TOKENS 2048,
  // WINDOW_CHARS_PER_TOKEN 3, WINDOW_SHARE_NO_DIGEST 0.75,
  // WINDOW_SHARE_WITH_DIGEST 0.6. reserve = min(2048, floor(nCtx * 0.5));
  // budgetTokens = (nCtx - reserve) * share; charBudget = floor(budgetTokens * 3).
  //
  //   nCtx   reserve   nCtx-reserve   bare 0.75               digest 0.6
  //   2048    1024        1024        768 * 3   = 2304         614.4 * 3 = 1843
  //   3072    1536        1536        1152 * 3  = 3456         921.6 * 3 = 2764
  //   4096    2048        2048        1536 * 3  = 4608         1228.8* 3 = 3686
  //   6144    2048        4096        3072 * 3  = 9216         2457.6* 3 = 7372
  //   8192    2048        6144        4608 * 3  = 13824        3686.4* 3 = 11059
  //
  // The 4096+ rows are the pre-change budgets: before the reserve was derived
  // from nCtx, bare was (nCtx - 2048) * 0.75 * 3, i.e. the same 4608 / 9216 /
  // 13824. Only the two rows below 4096 move.
  it("2048, below the context floor, still gets a non-empty window", () => {
    const bare = resolveWindowProfile({
      nCtx: 2048,
      hasImages: false,
      hasDigest: false,
    });
    // (2048 - 1024) * 0.75 * 3 = 2304. With the bare constant this was
    // (2048 - 2048) * 0.75 * 3 = 0: no anchored history at all.
    expect(bare.charBudget).toBe(2304);

    const digest = resolveWindowProfile({
      nCtx: 2048,
      hasImages: false,
      hasDigest: true,
    });
    // (2048 - 1024) * 0.6 * 3 = 1843.2, floored.
    expect(digest.charBudget).toBe(1843);
  });

  it("matches the hand-computed table at 3072, 4096, 6144 and 8192", () => {
    const table = [
      { nCtx: 3072, bare: 3456, digest: 2764 },
      { nCtx: 4096, bare: 4608, digest: 3686 },
      { nCtx: 6144, bare: 9216, digest: 7372 },
      { nCtx: 8192, bare: 13824, digest: 11059 },
    ];
    const got = table.map((row) => ({
      nCtx: row.nCtx,
      bare: resolveWindowProfile({
        nCtx: row.nCtx,
        hasImages: false,
        hasDigest: false,
      }).charBudget,
      digest: resolveWindowProfile({
        nCtx: row.nCtx,
        hasImages: false,
        hasDigest: true,
      }).charBudget,
    }));
    expect(got).toEqual(table);
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

describe("shouldSlideWindowAtCeiling with a real token count", () => {
  // Ceiling at 8192 is 6144. The same 18432 chars is 6144 tokens at the
  // chars/3 projection but ~16 458 tokens at the measured dense ratio.
  const CEILING = windowCeilingTokens(8192);
  const charsAtCeiling = CEILING * WINDOW_CHARS_PER_TOKEN;
  const denseTokens = conservativeWindowTokens(charsAtCeiling, 1.12);

  it("slides a dense window chars/3 would have let pass (measured 1.12 chars/token)", () => {
    // Qwen@16384 with dense Latin filler measured ~1.12 chars/token; code and
    // JSON run in the same band. chars/3 sees exactly the ceiling and stays
    // put; the real prefills do not fit.
    expect(projectedWindowTokens(charsAtCeiling)).toBe(CEILING);
    expect(denseTokens).toBeGreaterThan(CEILING);
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling,
        kvHeld: true,
      }),
    ).toBe(false);
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling,
        kvHeld: true,
        windowTokens: denseTokens,
      }),
    ).toBe(true);
  });

  it("does not slide when the measured count is at or below the ceiling", () => {
    // chars/3 would flag this send; the real count says it fits.
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling + 3,
        kvHeld: true,
      }),
    ).toBe(true);
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling + 3,
        kvHeld: true,
        windowTokens: CEILING,
      }),
    ).toBe(false);
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling + 3,
        kvHeld: true,
        windowTokens: 0,
      }),
    ).toBe(false);
  });

  it("is identical to the chars/3 path when windowTokens is absent", () => {
    // The concrete booleans come first: without them this test only compares
    // two calls of the same function and would still pass if the projection
    // were reverted to a different ratio.
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling + 3,
        kvHeld: true,
      }),
    ).toBe(true);
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling,
        kvHeld: true,
      }),
    ).toBe(false);
    for (const windowChars of [0, 1, charsAtCeiling, charsAtCeiling + 1, 1_000_000]) {
      expect(
        shouldSlideWindowAtCeiling({
          nCtx: 8192,
          windowChars,
          kvHeld: true,
          windowTokens: undefined,
        }),
      ).toBe(
        shouldSlideWindowAtCeiling({ nCtx: 8192, windowChars, kvHeld: true }),
      );
    }
  });

  it("falls back to chars/3 for a non-finite or negative windowTokens", () => {
    const fallback = projectedWindowTokens(charsAtCeiling + 3) > CEILING;
    for (const windowTokens of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      "6144",
    ] as unknown as number[]) {
      expect(
        shouldSlideWindowAtCeiling({
          nCtx: 8192,
          windowChars: charsAtCeiling + 3,
          kvHeld: true,
          windowTokens,
        }),
      ).toBe(fallback);
    }
  });

  it("never slides when the KV is not held, whatever the token count", () => {
    expect(
      shouldSlideWindowAtCeiling({
        nCtx: 8192,
        windowChars: charsAtCeiling,
        kvHeld: false,
        windowTokens: denseTokens,
      }),
    ).toBe(false);
  });
});

describe("promptTokensExceedNCtx with a real token count", () => {
  const CEILING = windowCeilingTokens(8192);
  const charsAtCeiling = CEILING * WINDOW_CHARS_PER_TOKEN;
  const denseTokens = conservativeWindowTokens(charsAtCeiling, 1.12);

  it("flags a dense prompt chars/3 would have let through", () => {
    expect(
      promptTokensExceedNCtx({ nCtx: 8192, promptChars: charsAtCeiling }),
    ).toBe(false);
    expect(
      promptTokensExceedNCtx({
        nCtx: 8192,
        promptChars: charsAtCeiling,
        promptTokens: denseTokens,
      }),
    ).toBe(true);
  });

  it("stands down when the real count fits", () => {
    expect(
      promptTokensExceedNCtx({
        nCtx: 8192,
        promptChars: charsAtCeiling + 3,
        promptTokens: CEILING,
      }),
    ).toBe(false);
  });

  it("is identical to the chars/3 path when promptTokens is absent", () => {
    for (const promptChars of [0, 1, charsAtCeiling, charsAtCeiling + 1, 1_000_000]) {
      expect(
        promptTokensExceedNCtx({
          nCtx: 8192,
          promptChars,
          promptTokens: undefined,
        }),
      ).toBe(promptTokensExceedNCtx({ nCtx: 8192, promptChars }));
    }
  });

  it("falls back to chars/3 for an invalid promptTokens", () => {
    const fallback = projectedWindowTokens(charsAtCeiling + 3) > CEILING;
    for (const promptTokens of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      "6144",
    ] as unknown as number[]) {
      expect(
        promptTokensExceedNCtx({
          nCtx: 8192,
          promptChars: charsAtCeiling + 3,
          promptTokens,
        }),
      ).toBe(fallback);
    }
  });
});

describe("conservativeWindowTokens", () => {
  it("caps a sparse measured ratio at the chars/3 default", () => {
    // 3.5 chars/token is the multilingual band; using it would project FEWER
    // tokens than chars/3, which is the direction that loses the bound.
    expect(conservativeWindowTokens(1000, 3.5)).toBe(
      projectedWindowTokens(1000),
    );
    expect(conservativeWindowTokens(1000, 3.5)).toBe(Math.ceil(1000 / 3));
  });

  it("uses a dense measured ratio and projects strictly more than chars/3", () => {
    const dense = conservativeWindowTokens(1000, 1.12);
    expect(dense).toBe(Math.ceil(1000 / 1.12));
    expect(dense).toBeGreaterThan(projectedWindowTokens(1000));
  });

  it("caps at one token per char instead of overflowing to Infinity", () => {
    // MAX_VALUE / 0.0001 is Infinity in doubles; tokens never exceed chars.
    const huge = conservativeWindowTokens(Number.MAX_VALUE, 0.0001);
    expect(Number.isFinite(huge)).toBe(true);
    expect(huge).toBe(Number.MAX_VALUE);
  });

  it("caps a sub-1 ratio at the char count", () => {
    // 100 / 0.5 would project 200 tokens from 100 chars, which no tokenizer
    // can emit.
    expect(conservativeWindowTokens(100, 0.5)).toBe(100);
  });

  it("falls back to chars/3 without a usable measured ratio", () => {
    for (const measured of [
      undefined,
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(conservativeWindowTokens(1000, measured)).toBe(
        projectedWindowTokens(1000),
      );
    }
    expect(conservativeWindowTokens(1000)).toBe(projectedWindowTokens(1000));
  });

  it("returns 0 for an unusable window size", () => {
    for (const windowChars of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(conservativeWindowTokens(windowChars, 1.12)).toBe(0);
      expect(conservativeWindowTokens(windowChars)).toBe(0);
    }
  });
});
