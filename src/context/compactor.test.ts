/**
 * Unit tests for context mode parsing and ciswire assembly contract.
 * Pure Node — no React Native.
 */

import {
  advanceAnchoredBoundary,
  advanceCompactionBoundary,
  anchoredHistoryDropReason,
  assembleEngineHistory,
  computeAnchoredBoundary,
  emptyCompactorState,
  lastCompleteExchangeStart,
  LEGACY_MAX_CHARS,
  parseBenchDigestCadence,
  shouldRebuildAnchored,
  shouldInjectOperativeBlock,
  LEGACY_MAX_HISTORY,
  LEGACY_MAX_HISTORY_IMAGES,
  legacyWindowStartIndex,
  parseContextMode,
  parseCiswireToolHelp,
  resolveBoundaryIndex,
  splitAtBoundary,
  type HistoryRoleMessage,
} from "./compactor";
import { resolveWindowProfile, anchoredWindowChars } from "./windowProfile";

function makeHistory(n: number): HistoryRoleMessage[] {
  const out: HistoryRoleMessage[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `msg-${i}`,
    });
  }
  return out;
}

describe("compactor parseContextMode", () => {
  test('"0" / "false" / "off" → off', () => {
    expect(parseContextMode("0")).toBe("off");
    expect(parseContextMode("false")).toBe("off");
    expect(parseContextMode("off")).toBe("off");
  });

  test("null / unrecognised / boolean-on → anchored", () => {
    expect(parseContextMode(null)).toBe("anchored");
    expect(parseContextMode("")).toBe("anchored");
    expect(parseContextMode("yes")).toBe("anchored");
    expect(parseContextMode("1")).toBe("anchored");
    expect(parseContextMode("true")).toBe("anchored");
    expect(parseContextMode("compact")).toBe("anchored");
  });

  test('"ciswire" → ciswire', () => {
    expect(parseContextMode("ciswire")).toBe("ciswire");
  });

  test('"anchored" → anchored', () => {
    expect(parseContextMode("anchored")).toBe("anchored");
  });
});

describe("parseCiswireToolHelp", () => {
  test('"1" / "true" → on', () => {
    expect(parseCiswireToolHelp("1")).toBe(true);
    expect(parseCiswireToolHelp("true")).toBe(true);
  });

  test("absent / garbage / explicit off values → off", () => {
    expect(parseCiswireToolHelp(null)).toBe(false);
    expect(parseCiswireToolHelp(undefined)).toBe(false);
    expect(parseCiswireToolHelp("")).toBe(false);
    expect(parseCiswireToolHelp("0")).toBe(false);
    expect(parseCiswireToolHelp("false")).toBe(false);
    expect(parseCiswireToolHelp("off")).toBe(false);
    expect(parseCiswireToolHelp("yes")).toBe(false);
  });
});

describe("compactor legacy window / ciswire partition", () => {
  test("legacyWindowStartIndex for lengths below, equal, above window", () => {
    // Below window → start at 0
    expect(legacyWindowStartIndex(5, false)).toBe(0);
    expect(legacyWindowStartIndex(LEGACY_MAX_HISTORY, false)).toBe(0);
    // Above window → start = len - LEGACY_MAX_HISTORY
    expect(legacyWindowStartIndex(30, false)).toBe(10);
    // hasImages uses the shorter window
    expect(legacyWindowStartIndex(5, true)).toBe(0);
    expect(legacyWindowStartIndex(LEGACY_MAX_HISTORY_IMAGES, true)).toBe(0);
    expect(legacyWindowStartIndex(20, true)).toBe(
      20 - LEGACY_MAX_HISTORY_IMAGES,
    );
  });

  test("legacyWindowStartIndex is exactly assembleEngineHistory off start", () => {
    for (const len of [5, LEGACY_MAX_HISTORY, 30]) {
      const history = makeHistory(len);
      const start = legacyWindowStartIndex(len, false);
      const assembled = assembleEngineHistory(history, {
        compactionEnabled: false,
        hasImages: false,
      });
      expect(assembled.map((m) => m.content)).toEqual(
        history.slice(start).map((m) => m.text),
      );
    }
    const histImg = makeHistory(20);
    const startImg = legacyWindowStartIndex(20, true);
    const assembledImg = assembleEngineHistory(histImg, {
      compactionEnabled: false,
      hasImages: true,
    });
    expect(assembledImg.map((m) => m.content)).toEqual(
      histImg.slice(startImg).map((m) => m.text),
    );
  });

  test("30-message: older ∩ recent = ∅ and older ∪ recent = history", () => {
    const history = makeHistory(30);
    const start = legacyWindowStartIndex(30, false);
    const { older, recent } = splitAtBoundary(history, start);
    const assembled = assembleEngineHistory(history, {
      compactionEnabled: false,
      hasImages: false,
    });

    // Disjoint: no message text appears in both older and the assembled window
    const olderTexts = new Set(older.map((m) => m.text));
    const assembledTexts = new Set(assembled.map((m) => m.content));
    for (const t of assembledTexts) {
      expect(olderTexts.has(t)).toBe(false);
    }
    // Cover: older ∪ assembled texts == full history texts
    const union = new Set([...olderTexts, ...assembledTexts]);
    expect(union.size).toBe(history.length);
    for (const m of history) {
      expect(union.has(m.text)).toBe(true);
    }
    // recent from split matches assembled content (same boundary)
    expect(recent.map((m) => m.text)).toEqual(assembled.map((m) => m.content));

    // Window length + first/last (value-bearing assertions kept)
    expect(assembled).toHaveLength(LEGACY_MAX_HISTORY);
    expect(assembled[0].content).toBe("msg-10");
    expect(assembled[assembled.length - 1].content).toBe("msg-29");

    // Anchored with a tight boundary must differ (proves the flag still matters).
    const anchored = assembleEngineHistory(history, {
      compactionEnabled: true,
      hasImages: false,
      boundaryIndex: 24,
    });
    expect(anchored).not.toEqual(assembled);
    expect(anchored).toHaveLength(6);
  });
});

describe("compactor parseBenchDigestCadence", () => {
  test("absent / empty / non-integer / below 1 → null (production every turn)", () => {
    expect(parseBenchDigestCadence(null)).toBeNull();
    expect(parseBenchDigestCadence(undefined)).toBeNull();
    expect(parseBenchDigestCadence("")).toBeNull();
    expect(parseBenchDigestCadence("  ")).toBeNull();
    expect(parseBenchDigestCadence("abc")).toBeNull();
    expect(parseBenchDigestCadence("2.5")).toBeNull();
    expect(parseBenchDigestCadence("0")).toBeNull();
    expect(parseBenchDigestCadence("-3")).toBeNull();
  });

  test("integer ≥ 1 survives, whitespace trimmed", () => {
    expect(parseBenchDigestCadence("1")).toBe(1);
    expect(parseBenchDigestCadence(" 3 ")).toBe(3);
  });
});

describe("compactor shouldInjectOperativeBlock", () => {
  test("no cadence → every turn injects (production default)", () => {
    for (let i = 0; i < 6; i++) {
      expect(shouldInjectOperativeBlock(i, null)).toBe(true);
      expect(shouldInjectOperativeBlock(i, 1)).toBe(true);
    }
  });

  test("cadence 3 → turns 0 and 3 only", () => {
    const injected = [0, 1, 2, 3, 4, 5].filter((i) =>
      shouldInjectOperativeBlock(i, 3),
    );
    expect(injected).toEqual([0, 3]);
  });

  test("first turn always injects — no earlier reply for it to invalidate", () => {
    expect(shouldInjectOperativeBlock(0, 5)).toBe(true);
  });

  test("nonsense index falls back to injecting, never silently skips", () => {
    expect(shouldInjectOperativeBlock(-1, 3)).toBe(true);
    expect(shouldInjectOperativeBlock(Number.NaN, 3)).toBe(true);
  });
});

describe("ciswire advanceCompactionBoundary ceiling slide", () => {
  test("ceilingBudgetChars picks the window start by char budget", () => {
    const lengths = Array.from({ length: 100 }, () => 20);
    const state = advanceCompactionBoundary(
      { ...emptyCompactorState("chat"), boundaryIndex: 0 },
      {
        chatId: "chat",
        userTurnCount: 5,
        historyLength: lengths.length,
        hasImages: false,
        ceilingBudgetChars: 1000,
        historyLengths: lengths,
        maxCharsPerMessage: 4000,
      },
    );
    // 1000 chars / 20 per message = 50 verbatim messages.
    expect(state.boundaryIndex).toBe(50);
  });

  test("the current turn is charged against the same budget", () => {
    const lengths = Array.from({ length: 100 }, () => 20);
    const state = advanceCompactionBoundary(
      { ...emptyCompactorState("chat"), boundaryIndex: 0 },
      {
        chatId: "chat",
        userTurnCount: 5,
        historyLength: lengths.length,
        hasImages: false,
        ceilingBudgetChars: 1000,
        historyLengths: lengths,
        maxCharsPerMessage: 4000,
        currentTurnLength: 100,
      },
    );
    // 900 chars of history + the 100-char turn = the 1000-char budget.
    expect(state.boundaryIndex).toBe(55);
  });

  test("without a ceiling budget the last-R rebuild is unchanged", () => {
    const state = advanceCompactionBoundary(null, {
      chatId: "chat",
      userTurnCount: 5,
      historyLength: 100,
      hasImages: false,
    });
    // Default recentWindow is 6 → 100 - 6.
    expect(state.boundaryIndex).toBe(94);
  });

  test("a saved boundary longer than the history clamps, never slices past it", () => {
    expect(resolveBoundaryIndex({ boundaryIndex: 999 }, 10)).toBe(10);
    expect(resolveBoundaryIndex({ boundaryIndex: 4 }, 10)).toBe(4);
    expect(resolveBoundaryIndex({ boundaryIndex: -1 }, 10)).toBe(0);
  });
});

describe("anchored no-digest window", () => {
  const profile = { maxMessages: 40, charBudget: 1000, source: "test" };

  test("keeps the stored boundary across consecutive turns under budget", () => {
    const lengths = Array.from({ length: 55 }, () => 20);
    let state = advanceAnchoredBoundary(null, {
      chatId: "chat",
      userTurnCount: 1,
      historyLengths: lengths,
      currentTurnLength: 20,
      profile,
      maxCharsPerMessage: 4000,
    });
    const boundary = state.boundaryIndex;

    for (let turn = 0; turn < 6; turn++) {
      const historyLengths = lengths.concat(Array(turn * 2).fill(20));
      const rebuild = shouldRebuildAnchored(state, {
        historyLengths,
        currentTurnLength: 20,
        profile,
        maxCharsPerMessage: 4000,
      });
      expect(rebuild).toBe(false);
      if (rebuild) {
        state = advanceAnchoredBoundary(state, {
          chatId: "chat",
          userTurnCount: turn + 2,
          historyLengths,
          currentTurnLength: 20,
          profile,
          maxCharsPerMessage: 4000,
        });
      }
      expect(state.boundaryIndex).toBe(boundary);
    }
  });

  test("rebuild leaves hysteresis before the next pressure rebuild", () => {
    const lengths = Array.from({ length: 55 }, () => 20);
    const state = advanceAnchoredBoundary(null, {
      chatId: "chat",
      userTurnCount: 1,
      historyLengths: lengths,
      currentTurnLength: 20,
      profile,
      maxCharsPerMessage: 4000,
    });
    const rebuildWindow = anchoredWindowChars(
      lengths,
      state.boundaryIndex,
      4000,
      20,
    );
    expect(rebuildWindow).toBeLessThanOrEqual(1000 * 0.625);

    let underBudgetTurns = 0;
    for (; underBudgetTurns < 6; underBudgetTurns++) {
      expect(
        shouldRebuildAnchored(state, {
          historyLengths: lengths.concat(
            Array((underBudgetTurns + 1) * 2).fill(20),
          ),
          currentTurnLength: 20,
          profile,
          maxCharsPerMessage: 4000,
        }),
      ).toBe(false);
    }
    expect(underBudgetTurns).toBe(6);
  });

  test("an oversized single message does not cause an every-turn rebuild", () => {
    const longMessage = [10_000];
    const state = advanceAnchoredBoundary(null, {
      chatId: "chat",
      userTurnCount: 1,
      historyLengths: longMessage,
      currentTurnLength: 10,
      profile: { ...profile, charBudget: 100 },
      maxCharsPerMessage: 4000,
    });
    expect(state.boundaryIndex).toBe(1);
    expect(
      shouldRebuildAnchored(state, {
        historyLengths: longMessage,
        currentTurnLength: 10_000,
        profile: { ...profile, charBudget: 100 },
        maxCharsPerMessage: 4000,
      }),
    ).toBe(false);
    expect(computeAnchoredBoundary(longMessage, profile, 4000, 10, 1)).toBe(1);
  });
});

describe("anchored boundary under a token ceiling", () => {
  // Attachment turns and bench overrides resolve charBudget to Infinity, so
  // the ordinary anchored rebuild is a no-op. A deliberate ceiling slide must
  // still advance: its target comes from n_ctx, not from the profile.
  const infinityProfile = {
    maxMessages: 8,
    charBudget: Number.POSITIVE_INFINITY,
    source: "images",
  };
  const lengths = Array.from({ length: 30 }, () => 100);

  test("Infinity charBudget without a ceiling budget stays put", () => {
    expect(computeAnchoredBoundary(lengths, infinityProfile, 4000, 0, 4)).toBe(
      4,
    );
    expect(
      advanceAnchoredBoundary(null, {
        chatId: "chat",
        userTurnCount: 1,
        historyLengths: lengths,
        currentTurnLength: 0,
        profile: infinityProfile,
        maxCharsPerMessage: 4000,
      }).boundaryIndex,
    ).toBe(0);
  });

  test("a ceiling budget advances the boundary despite Infinity", () => {
    // 1000 chars * 0.625 target = 625 → six 100-char messages fit.
    const next = computeAnchoredBoundary(
      lengths,
      infinityProfile,
      4000,
      0,
      4,
      1000,
    );
    expect(next).toBe(24);
  });

  test("a ceiling budget never moves the boundary backwards", () => {
    expect(
      computeAnchoredBoundary(lengths, infinityProfile, 4000, 0, 28, 100_000),
    ).toBe(28);
  });

  test("a ceiling slide keeps the floor as well", () => {
    // ceilingBudget 1000 → target 625; candidate i = 29 charges the 700-char
    // turn plus the 100-char message = 800 > 625, so the walk keeps nothing
    // unless the floor does.
    const floor = 28;
    expect(
      computeAnchoredBoundary(lengths, infinityProfile, 4000, 700, 0, 1000, floor),
    ).toBe(floor);
    // Same call without the floor: 30, i.e. the whole history gone.
    expect(computeAnchoredBoundary(lengths, infinityProfile, 4000, 700, 0, 1000)).toBe(
      lengths.length,
    );
  });
});

describe("lastCompleteExchangeStart", () => {
  test("returns the user message that opens the last complete exchange", () => {
    expect(
      lastCompleteExchangeStart(["user", "assistant", "user", "assistant"]),
    ).toBe(2);
  });

  test("keeps the exchange, not the orphan turn, when the newest user is unanswered", () => {
    // [u, a, u]: the newest user message has no reply, so the last exchange
    // with an answer is the previous one and the floor opens at 0 — not at the
    // orphan at index 2, which would keep a question the model never answered.
    expect(lastCompleteExchangeStart(["user", "assistant", "user"])).toBe(0);
    expect(
      lastCompleteExchangeStart(["user", "assistant", "user", "assistant", "user"]),
    ).toBe(2);
  });

  test("falls back to the newest user message when no exchange was answered", () => {
    expect(lastCompleteExchangeStart(["assistant", "user"])).toBe(1);
    expect(lastCompleteExchangeStart(["user"])).toBe(0);
  });

  test("returns the length when the history holds no user message", () => {
    expect(lastCompleteExchangeStart([])).toBe(0);
    expect(lastCompleteExchangeStart(["assistant", "assistant"])).toBe(2);
  });
});

describe("anchored boundary floor", () => {
  // Hand arithmetic. Constants: WINDOW_RESERVE_TOKENS 2048,
  // WINDOW_CHARS_PER_TOKEN 3, WINDOW_SHARE_NO_DIGEST 0.75,
  // ANCHORED_REBUILD_TARGET_SHARE 0.625; reserve = min(2048, floor(nCtx / 2));
  // charBudget = floor((nCtx - reserve) * 0.75 * 3); target = charBudget * 0.625.
  //
  //   nCtx   reserve   charBudget        target    turn = target + 60
  //   2048    1024    1024*0.75*3 = 2304   1440    1500
  //   3072    1536    1536*0.75*3 = 3456   2160    2220
  //   4096    2048    2048*0.75*3 = 4608   2880    2940
  //   6144    2048    4096*0.75*3 = 9216   5760    5820
  //   8192    2048    6144*0.75*3 = 13824  8640    8700
  //
  // `turn` is one 60-char user message over the target, so the capped turn is
  // by itself larger than the rebuild target — the shape that used to return n.
  // The history is 1300 chars: 24 messages of 50 plus the last exchange
  // [60 user, 40 assistant]. Deliberately well under every budget in the
  // table, so "the exchange survives" is a claim and not an accident of a
  // history that could never have overflowed.
  //
  // maxCharsPerMessage is set above every length here so the cap never binds
  // and each row charges the turn itself. The production cap (4000, 2000 with
  // images) is smaller than the 6144/8192 targets, so on those contexts no
  // single capped turn can exceed the target: the defect is confined to
  // contexts whose target is under the cap, and the drop case below uses the
  // 2048 profile for that reason.
  const rows = [
    { nCtx: 2048, charBudget: 2304, turn: 1500 },
    { nCtx: 3072, charBudget: 3456, turn: 2220 },
    { nCtx: 4096, charBudget: 4608, turn: 2940 },
    { nCtx: 6144, charBudget: 9216, turn: 5820 },
    { nCtx: 8192, charBudget: 13824, turn: 8700 },
  ];
  const historyLengths = [...new Array(24).fill(50), 60, 40];
  // 13 complete exchanges: the last one opens at index 24, its user message.
  const roles = new Array(26)
    .fill(null)
    .map((_, i) => (i % 2 === 0 ? "user" : "assistant"));
  const floorIndex = 24;
  const maxCharsPerMessage = 20_000;

  const profileAt = (nCtx: number) =>
    resolveWindowProfile({ nCtx, hasImages: false, hasDigest: false });

  test("keeps the last exchange in every context the app can load", () => {
    expect(lastCompleteExchangeStart(roles)).toBe(floorIndex);
    expect(historyLengths.reduce((sum, n) => sum + n, 0)).toBe(1300);

    const kept = rows.map((row) => {
      const profile = profileAt(row.nCtx);
      // The real profile, but its budget must be the hand-computed one or this
      // row is not testing what it claims to test.
      expect(profile.charBudget).toBe(row.charBudget);
      return computeAnchoredBoundary(
        historyLengths,
        profile,
        maxCharsPerMessage,
        row.turn,
        0,
        undefined,
        floorIndex,
      );
    });
    expect(kept).toEqual(rows.map(() => floorIndex));
  });

  test("the same walk without a floor keeps nothing — the defect this pins", () => {
    // No floor index: the loop stops on its first candidate and the whole
    // conversation is dropped, which is why the floor exists.
    const dropped = rows.map((row) =>
      computeAnchoredBoundary(
        historyLengths,
        profileAt(row.nCtx),
        maxCharsPerMessage,
        row.turn,
        0,
      ),
    );
    expect(dropped).toEqual(rows.map(() => historyLengths.length));
  });

  test("names the drop when even the floor does not fit the budget", () => {
    const profile = profileAt(2048);
    // 2400 > charBudget 2304, so the floor window is 2400 + 100 as well.
    const boundary = computeAnchoredBoundary(
      historyLengths,
      profile,
      maxCharsPerMessage,
      2400,
      0,
      undefined,
      floorIndex,
    );
    expect(boundary).toBe(historyLengths.length);
    expect(
      anchoredHistoryDropReason(boundary, historyLengths.length, floorIndex),
    ).toBe("history_dropped_window_exceeds_budget");
  });

  test("names a drop for a floor it cannot read only when there was one", () => {
    // computeAnchoredBoundary treats a non-finite floor index as "no floor"
    // (it guards with Number.isFinite), so this must not blame a floor for a
    // wipe that no floor was measured against.
    expect(
      anchoredHistoryDropReason(
        historyLengths.length,
        historyLengths.length,
        Number.NaN,
      ),
    ).toBeUndefined();
    expect(
      anchoredHistoryDropReason(
        historyLengths.length,
        historyLengths.length,
        undefined,
      ),
    ).toBeUndefined();
  });

  test("names no drop when the floor survives", () => {
    const boundary = computeAnchoredBoundary(
      historyLengths,
      profileAt(2048),
      maxCharsPerMessage,
      1500,
      0,
      undefined,
      floorIndex,
    );
    expect(boundary).toBe(floorIndex);
    expect(
      anchoredHistoryDropReason(boundary, historyLengths.length, floorIndex),
    ).toBeUndefined();
    // No floor to apply (no user message) or no history at all: not a drop.
    expect(anchoredHistoryDropReason(0, 0, 0)).toBeUndefined();
    expect(anchoredHistoryDropReason(historyLengths.length, historyLengths.length, historyLengths.length)).toBeUndefined();
  });

  test("keeps a floor whose window is exactly the budget", () => {
    const profile = profileAt(2048);
    // Floor window = the turn 2204 + the last exchange [60 user, 40 assistant]
    // = 2304, exactly charBudget at 2048 (the turn is under the per-message cap
    // so it is charged whole). Fitting the budget on the nose is fitting it: a
    // `<=` here is the difference between keeping the exchange and wiping it.
    expect(profile.charBudget).toBe(2304);
    expect(
      computeAnchoredBoundary(
        historyLengths,
        profile,
        maxCharsPerMessage,
        2204,
        0,
        undefined,
        floorIndex,
      ),
    ).toBe(floorIndex);
  });

  test("at a consumed ceiling the floor cannot be honoured and the whole history is dropped", () => {
    // ceilingBudgetChars = 0 is a real budget, not an absent one: at nCtx 2048
    // with a 1832-token system prompt windowCeilingTokens is 0, so every send
    // from turn two crosses the ceiling and arrives here. Target 0 and any
    // nonempty window over it, the floor's own window included, so the
    // conversation goes. This is the limit of the floor, not an intention.
    expect(
      computeAnchoredBoundary(
        historyLengths,
        profileAt(2048),
        maxCharsPerMessage,
        1500,
        0,
        0,
        floorIndex,
      ),
    ).toBe(historyLengths.length);
  });

  test("monotonicity leaves a boundary already past the floor where it is", () => {
    // previousIndex 26 is past the floor: an earlier rebuild already evicted
    // the exchange, and the destructive half of a window slide is gated on an
    // advance, so the floor cannot walk the boundary back to re-admit it.
    expect(
      computeAnchoredBoundary(
        historyLengths,
        profileAt(2048),
        maxCharsPerMessage,
        1500,
        26,
        undefined,
        floorIndex,
      ),
    ).toBe(26);
  });
});

describe("anchored boundary floor at the production per-message cap", () => {
  // LEGACY_MAX_CHARS is the FLOOR of the cap the send actually uses: AppShell
  // passes baseMessageCap + userTailChars (persona instructions + memory
  // facts), so a configured app charges more per message, never less.
  //
  // The loop's first candidate charges the turn being sent PLUS the newest
  // history message, i.e. two messages at the cap: 2 * 4000 = 8000. So the
  // wipe needs 8000 > target, with charBudget = floor((nCtx - reserve) * share
  // * 3) and target = 0.625 * charBudget:
  //
  //   nCtx / share   reserve   charBudget   target       8000 > target?
  //   6144 bare       2048      9216         5760         yes → wipes
  //   8192 digest     2048     11059         6911.875     yes → wipes
  //   8192 bare       2048     13824         8640         no
  //
  // History: 24 * 40 = 960, then the last exchange [1000 user, 4000 assistant]
  // = 5960 with its floor at index 24. The floor window charges 4000 (the
  // turn, capped down from an 8000-char paste) + 1000 + 4000 = 9000, which fits
  // 9216 and 11059 with 216 and 2059 chars to spare.
  const historyLengths = [...new Array(24).fill(40), 1000, 4000];
  const floorIndex = 24;
  const currentTurnLength = 8000;
  const profileAt = (nCtx: number, hasDigest: boolean) =>
    resolveWindowProfile({ nCtx, hasImages: false, hasDigest });
  const rows = [
    { nCtx: 6144, hasDigest: false, charBudget: 9216 },
    { nCtx: 8192, hasDigest: true, charBudget: 11059 },
  ];

  test("two capped messages wipe the history without the floor", () => {
    const wiped = rows.map((row) =>
      computeAnchoredBoundary(
        historyLengths,
        profileAt(row.nCtx, row.hasDigest),
        LEGACY_MAX_CHARS,
        currentTurnLength,
        0,
      ),
    );
    expect(wiped).toEqual(rows.map(() => historyLengths.length));
  });

  test("the floor keeps the last exchange on the same rows", () => {
    const kept = rows.map((row) => {
      const profile = profileAt(row.nCtx, row.hasDigest);
      // The real profile must carry the hand-computed budget or the row is not
      // testing what it claims to.
      expect(profile.charBudget).toBe(row.charBudget);
      return computeAnchoredBoundary(
        historyLengths,
        profile,
        LEGACY_MAX_CHARS,
        currentTurnLength,
        0,
        undefined,
        floorIndex,
      );
    });
    expect(kept).toEqual(rows.map(() => floorIndex));
  });
});
