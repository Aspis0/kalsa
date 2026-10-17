/**
 * The UI coalescer's cadence contract: one flush per window, the LAST push
 * always lands, and a push equal to what the UI already shows costs nothing
 * (the thinking span re-pushes itself at the first visible token of a round).
 */
import { createStreamCoalescer } from "./streamCoalescer";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function collector(): { flushed: string[]; push: (t: string) => void; } {
  const flushed: string[] = [];
  const coalescer = createStreamCoalescer((text) => flushed.push(text));
  return { flushed, push: (text) => coalescer.push(text) };
}

describe("the ~33 ms trailing flush", () => {
  it("paints the first push immediately", () => {
    const { flushed, push } = collector();
    push("a");
    expect(flushed).toEqual(["a"]);
  });

  it("collapses a burst into the latest text, which always lands", () => {
    const { flushed, push } = collector();
    push("a");
    push("ab");
    push("abc");
    expect(flushed).toEqual(["a"]);
    jest.advanceTimersByTime(33);
    expect(flushed).toEqual(["a", "abc"]);
  });

  it("drops a push that repeats the pending or the flushed text", () => {
    const { flushed, push } = collector();
    push("a");
    push("ab");
    push("ab");
    jest.advanceTimersByTime(33);
    expect(flushed).toEqual(["a", "ab"]);
    // The round's finished span, re-pushed by the first visible token.
    push("ab");
    jest.advanceTimersByTime(33);
    expect(flushed).toEqual(["a", "ab"]);
  });

  it("paints again once the text changes again", () => {
    const { flushed, push } = collector();
    push("a");
    push("a");
    push("ab");
    jest.advanceTimersByTime(33);
    expect(flushed).toEqual(["a", "ab"]);
  });

  it("finalize paints what is pending; cancel drops it", () => {
    const painted: string[] = [];
    const finalized = createStreamCoalescer((text) => painted.push(text));
    finalized.push("a");
    finalized.push("ab");
    finalized.finalize();
    expect(painted).toEqual(["a", "ab"]);

    const dropped: string[] = [];
    const cancelled = createStreamCoalescer((text) => dropped.push(text));
    // The first push paints on the leading edge; the second is pending.
    cancelled.push("x");
    cancelled.push("xy");
    cancelled.cancel();
    jest.advanceTimersByTime(100);
    expect(dropped).toEqual(["x"]);
  });
});