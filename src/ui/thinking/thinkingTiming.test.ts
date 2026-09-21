import {
  BASE_PERIOD_S,
  MAX_PERIOD_S,
  MIN_PERIOD_S,
  SETTLE_MS,
  TICKER_MAX_CHARS,
  bubblePeriodSeconds,
  createTimingState,
  lastLine,
  onMode,
  onToken,
  phaseAt,
  recordArrival,
  risingIn,
  shouldWriteTempo,
  thinkingSummary,
  tickerText,
  tokenRatePerSecond,
  type TimingState,
} from "./thinkingTiming";

const tokens = (timeline: readonly number[]): { state: TimingState; periods: number[] } => {
  let state = createTimingState();
  const periods: number[] = [];
  for (const now of timeline) {
    const tick = onToken(state, now);
    state = tick.state;
    if (tick.wrote) periods.push(tick.state.period);
  }
  return { state, periods };
};

describe("bubble period", () => {
  it("keeps the period inside its clamp for any rate", () => {
    for (const rate of [0, 0.01, 0.6, 1, 2, 2.6, 5, 40, 1000]) {
      const period = bubblePeriodSeconds(rate);
      expect(period).toBeGreaterThanOrEqual(MIN_PERIOD_S);
      expect(period).toBeLessThanOrEqual(MAX_PERIOD_S);
    }
    expect(bubblePeriodSeconds(0)).toBe(2.4);
    expect(bubblePeriodSeconds(0.6)).toBe(2.4);
    expect(bubblePeriodSeconds(0.5)).toBe(2.4);
    expect(bubblePeriodSeconds(BASE_PERIOD_S / MIN_PERIOD_S)).toBe(0.7);
    expect(bubblePeriodSeconds(1000)).toBe(0.7);
  });

  it("shortens the period as the rate rises", () => {
    const rates = [1, 1.3, 2, 2.4, 2.5714];
    const periods = rates.map(bubblePeriodSeconds);
    expect(periods).toEqual([1.8, 1.38, 0.9, 0.75, 0.7]);
    for (let i = 1; i < periods.length; i++) expect(periods[i]).toBeLessThan(periods[i - 1]);
  });

  it("lengthens the period as the rate falls", () => {
    expect(bubblePeriodSeconds(1.3)).toBeGreaterThan(bubblePeriodSeconds(2));
    expect(bubblePeriodSeconds(1)).toBeGreaterThan(bubblePeriodSeconds(2.5714));
    expect(bubblePeriodSeconds(0.6)).toBeGreaterThan(bubblePeriodSeconds(1));
  });

  it("quantises to two decimals, as the desktop's toFixed(2) does", () => {
    expect(bubblePeriodSeconds(1.3)).toBe(1.38);
    expect(bubblePeriodSeconds(1.6)).toBe(1.13);
  });

  it("treats a non-finite rate as no measurable rate rather than putting NaN in a transform", () => {
    expect(bubblePeriodSeconds(Number.NaN)).toBe(2.4);
    expect(bubblePeriodSeconds(Number.POSITIVE_INFINITY)).toBe(2.4);
  });
});

describe("token arrivals", () => {
  it("drops arrivals at the window edge and keeps the rest", () => {
    expect(recordArrival([0], 1999)).toEqual([0, 1999]);
    expect(recordArrival([0], 2000)).toEqual([2000]);
    expect(recordArrival([0, 100], 2000)).toEqual([100, 2000]);
    expect(recordArrival([100, 500], 2000)).toEqual([100, 500, 2000]);
  });

  it("counts the window as two seconds", () => {
    expect(tokenRatePerSecond([])).toBe(0);
    expect(tokenRatePerSecond([1, 2, 3])).toBe(1.5);
    expect(tokenRatePerSecond([1, 2, 3, 4, 5])).toBe(2.5);
  });

  it("lets a write through at 350 ms and not before", () => {
    expect(shouldWriteTempo(0, 349)).toBe(false);
    expect(shouldWriteTempo(0, 350)).toBe(true);
    expect(shouldWriteTempo(0, 351)).toBe(true);
  });

  it("writes the first sample even when the clock starts at zero", () => {
    const first = onToken(createTimingState(), 0);
    expect(first.wrote).toBe(true);
    expect(first.state.lastWrite).toBe(0);
    expect(first.state.period).toBe(2.4);
  });

  it("keeps extending the window while the write is throttled", () => {
    const first = onToken(createTimingState(), 0);
    const early = onToken(first.state, 100);
    expect(early.wrote).toBe(false);
    expect(early.state.arrivals).toEqual([0, 100]);
    expect(early.state.period).toBe(2.4);
    expect(early.state.lastWrite).toBe(0);
  });

  it("drives the period from the measured rate over the window", () => {
    // One token a second, then a 300 ms burst, then a 2.8 s stall.
    const { state, periods } = tokens([
      0, 1000, 2000, 3000, 4000, 4300, 4600, 4900, 5200, 8000,
    ]);
    expect(periods).toEqual([2.4, 1.8, 1.8, 1.8, 1.8, 0.9, 0.72, 2.4]);
    // The burst shortens the period, the stall lengthens it again.
    expect(periods[6]).toBeLessThan(periods[4]);
    expect(periods[7]).toBeGreaterThan(periods[6]);
    expect(state.arrivals).toEqual([8000]);
    expect(state.lastWrite).toBe(8000);
    expect(state.period).toBe(2.4);
  });
});

describe("phase machine", () => {
  const mode = (working: boolean, answered: boolean) => ({ working, answered });

  it("starts at rest with nothing to settle", () => {
    const state = createTimingState();
    expect(phaseAt(state, 0)).toBe("rest");
    expect(state.settlingUntil).toBeNull();
  });

  it("rises while reasoning and holds there", () => {
    const start = createTimingState();
    const rising = onMode(start, 0, mode(true, false));
    expect(phaseAt(rising, 0)).toBe("rise");
    expect(phaseAt(rising, 5000)).toBe("rise");
    expect(rising.rose).toBe(true);
    expect(onMode(rising, 6000, mode(true, false))).toBe(rising);
  });

  it("settles once on the transition and is at rest after the deadline", () => {
    const rising = onMode(createTimingState(), 2000, mode(true, false));
    const settled = onMode(rising, 2000, mode(false, true));
    expect(settled.settlingUntil).toBe(2000 + SETTLE_MS);
    expect(phaseAt(settled, 2000)).toBe("settle");
    expect(phaseAt(settled, 3499)).toBe("settle");
    expect(phaseAt(settled, 3500)).toBe("rest");
    // Re-armed exactly once: replaying the same mode is a no-op, so the window
    // cannot be restarted by a later render.
    expect(onMode(settled, 9000, mode(false, true))).toBe(settled);
    expect(settled.settlingUntil).toBe(3500);
  });

  it("settles again after a second rise", () => {
    const first = onMode(
      onMode(onMode(createTimingState(), 0, mode(true, false)), 1000, mode(false, true)),
      2000,
      mode(true, false),
    );
    expect(phaseAt(first, 2000)).toBe("rise");
    const second = onMode(first, 4000, mode(false, true));
    expect(second.settlingUntil).toBe(4000 + SETTLE_MS);
    expect(phaseAt(second, 4000)).toBe("settle");
  });

  it("never settles when reasoning never started", () => {
    const straightToAnswer = onMode(createTimingState(), 0, mode(false, true));
    expect(straightToAnswer.settlingUntil).toBeNull();
    expect(phaseAt(straightToAnswer, 0)).toBe("rest");
    expect(phaseAt(straightToAnswer, 10000)).toBe("rest");
    expect(risingIn(mode(false, true))).toBe(false);
  });

  it("does not settle when the rise is called off without an answer", () => {
    const rising = onMode(createTimingState(), 0, mode(true, false));
    const cancelled = onMode(rising, 1000, mode(false, false));
    expect(cancelled.settlingUntil).toBeNull();
    expect(cancelled.rose).toBe(false);
    expect(phaseAt(cancelled, 1000)).toBe("rest");
    expect(phaseAt(onMode(cancelled, 2000, mode(false, true)), 2000)).toBe("rest");
  });

  it("lets a new rise take the phase over from a settle still running", () => {
    const settled = onMode(onMode(createTimingState(), 0, mode(true, false)), 1000, mode(false, true));
    const risen = onMode(settled, 1200, mode(true, false));
    expect(risen.settlingUntil).toBeNull();
    expect(phaseAt(risen, 1200)).toBe("rise");
  });
});

describe("collapsed face", () => {
  it("takes the last non-empty line, trimmed", () => {
    expect(lastLine("a\nb\nc")).toBe("c");
    expect(lastLine("a\n\n   b   \n")).toBe("b");
    expect(lastLine("\n\n")).toBe("");
    expect(lastLine("")).toBe("");
    expect(lastLine("only line")).toBe("only line");
  });

  it("caps the line at the ticker width", () => {
    const long = "x".repeat(200);
    expect(lastLine(long)).toHaveLength(TICKER_MAX_CHARS);
    expect(lastLine(long)).toBe("x".repeat(TICKER_MAX_CHARS));
    expect(lastLine(`a\n${long}`)).toBe("x".repeat(TICKER_MAX_CHARS));
  });

  it("prefers the upstream tail and falls back to the reasoning", () => {
    expect(tickerText("streaming tail", "a\nb")).toBe("streaming tail");
    expect(tickerText(undefined, "a\nb")).toBe("b");
    expect(tickerText("trailing spaces   ", "")).toBe("trailing spaces");
  });

  it("falls back to the placeholder when there is nothing to show", () => {
    expect(tickerText(undefined, "")).toBe("Thinking…");
    expect(tickerText("   ", "")).toBe("Thinking…");
    expect(tickerText("", "\n \n")).toBe("Thinking…");
  });
});

describe("summary", () => {
  it("has no duration when none was measured", () => {
    expect(thinkingSummary(undefined)).toBe("Thinking");
  });

  it("does not round a sub-second thought up to a second", () => {
    expect(thinkingSummary(0)).toBe("Thought for less than a second");
    expect(thinkingSummary(999)).toBe("Thought for less than a second");
  });

  it("rounds to the nearest 100 ms at the boundaries", () => {
    expect(thinkingSummary(1000)).toBe("Thought for 1 s");
    expect(thinkingSummary(1049)).toBe("Thought for 1 s");
    expect(thinkingSummary(1050)).toBe("Thought for 1.1 s");
    expect(thinkingSummary(1234)).toBe("Thought for 1.2 s");
    expect(thinkingSummary(1249)).toBe("Thought for 1.2 s");
    expect(thinkingSummary(1250)).toBe("Thought for 1.3 s");
    expect(thinkingSummary(9950)).toBe("Thought for 10 s");
    expect(thinkingSummary(10640)).toBe("Thought for 10.6 s");
  });
});
