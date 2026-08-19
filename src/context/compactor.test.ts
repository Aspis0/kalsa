/**
 * Unit tests for context mode parsing and ciswire assembly contract.
 * Pure Node — no React Native.
 */

import {
  assembleEngineHistory,
  legacyWindowForContext,
  LEGACY_MAX_HISTORY_LARGE_CTX,
  parseBenchDigestCadence,
  shouldInjectOperativeBlock,
  LEGACY_MAX_HISTORY,
  LEGACY_MAX_HISTORY_IMAGES,
  legacyWindowStartIndex,
  parseContextMode,
  splitAtBoundary,
  type HistoryRoleMessage,
} from "./compactor";

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
  test("null → off", () => {
    expect(parseContextMode(null)).toBe("off");
  });

  test('"0" → off', () => {
    expect(parseContextMode("0")).toBe("off");
  });

  test("unrecognised → off", () => {
    expect(parseContextMode("yes")).toBe("off");
    expect(parseContextMode("")).toBe("off");
    expect(parseContextMode("v42")).toBe("off");
  });

  test('"1" → v42', () => {
    expect(parseContextMode("1")).toBe("v42");
  });

  test('"true" → v42', () => {
    expect(parseContextMode("true")).toBe("v42");
  });

  test('"ciswire" → ciswire', () => {
    expect(parseContextMode("ciswire")).toBe("ciswire");
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

    // v42 with a tight boundary must differ (proves the flag still matters).
    const v42 = assembleEngineHistory(history, {
      compactionEnabled: true,
      hasImages: false,
      boundaryIndex: 24,
    });
    expect(v42).not.toEqual(assembled);
    expect(v42).toHaveLength(6);
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

describe("compactor legacyWindowForContext", () => {
  test("16384+ context gets the 20-exchange window", () => {
    expect(legacyWindowForContext(16384, false)).toBe(LEGACY_MAX_HISTORY_LARGE_CTX);
    expect(legacyWindowForContext(32768, false)).toBe(LEGACY_MAX_HISTORY_LARGE_CTX);
  });

  test("8192 keeps 20 messages — 40 would not fit ~9500 prompt tokens", () => {
    expect(legacyWindowForContext(8192, false)).toBe(LEGACY_MAX_HISTORY);
    expect(legacyWindowForContext(4096, false)).toBe(LEGACY_MAX_HISTORY);
  });

  test("no engine loaded (0) or unknown falls back to the default window", () => {
    expect(legacyWindowForContext(0, false)).toBe(LEGACY_MAX_HISTORY);
    expect(legacyWindowForContext(null, false)).toBe(LEGACY_MAX_HISTORY);
    expect(legacyWindowForContext(undefined, false)).toBe(LEGACY_MAX_HISTORY);
    expect(legacyWindowForContext(Number.NaN, false)).toBe(LEGACY_MAX_HISTORY);
  });

  test("images keep their own cap at every context size", () => {
    expect(legacyWindowForContext(8192, true)).toBe(LEGACY_MAX_HISTORY_IMAGES);
    expect(legacyWindowForContext(16384, true)).toBe(LEGACY_MAX_HISTORY_IMAGES);
  });

  test("the value is usable as a legacyWindowStartIndex override", () => {
    // An override below BENCH_LEGACY_WINDOW_FLOOR would be silently ignored and
    // the caller would get the default instead of the window it asked for.
    expect(legacyWindowForContext(16384, false)).toBeGreaterThanOrEqual(4);
    expect(legacyWindowForContext(8192, true)).toBeGreaterThanOrEqual(4);
  });
});
