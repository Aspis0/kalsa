/**
 * The thinking card, while the model is still thinking.
 *
 * `onThinkingText` used to fire only on abort, on a round's finalize and on
 * the tool fallback — so a turn that reasoned for a minute showed one
 * Thinking card at the end, with the label claiming otherwise the whole time.
 * The token path now pushes the round's joined span through the same ~33 ms
 * coalescer the answer uses.
 *
 * LlamaService.ts value-imports llama.rn, so no Jest test can import it. What
 * is exercised here is the real composition the token path performs —
 * `thinkStream`'s cleaner, `streamCoalescer`'s cadence and `joinThinking` —
 * over a fake token stream; the wiring itself is pinned by source below.
 */
import fs from "fs";
import path from "path";

import { createStreamCoalescer } from "./streamCoalescer";
import { createThinkStreamCleaner } from "./thinkStream";

/** LlamaService's own closure, copied so the oracle is the real thing. */
const joinThinking = (acc: string, next: string): string => {
  if (next.trim().length === 0) return acc;
  return acc.length > 0 ? `${acc}\n\n${next}` : next;
};

const THINK_TOKENS = ["<think>", "Let me ", "look at ", "the numbers ", "first", "</think>"];
const ANSWER_TOKENS = ["They ", "are ", "in ", "the readme"];

type Stream = ReturnType<typeof fakeStream>;

/** One round of the token callback, in LlamaService's order. */
function fakeStream(opts: { templateOpensThink?: boolean } = {}) {
  let cleaner = createThinkStreamCleaner({ templateOpensThink: opts.templateOpensThink });
  const emitted: string[] = [];
  const deltas: string[] = [];
  const thinkingAccum = { current: "" };
  let roundWritingEmitted = false;
  const coalescer = createStreamCoalescer((text: string) => emitted.push(text));

  const push = (raw: string): void => {
    const delta = cleaner.cleanDelta(raw);
    if (!roundWritingEmitted) {
      const liveThinking = cleaner.thinkingText();
      if (liveThinking.trim().length > 0) {
        coalescer.push(joinThinking(thinkingAccum.current, liveThinking));
      }
    }
    if (delta) {
      roundWritingEmitted = true;
      deltas.push(delta);
    }
  };
  const feed = (tokens: string[]): void => {
    for (const token of tokens) push(token);
  };
  /** The round transition, as the loop does it: the outgoing span joins the
   *  accumulator, then a FRESH cleaner takes the new round's tokens. */
  const endRound = (round: { templateOpensThink?: boolean } = {}): void => {
    thinkingAccum.current = joinThinking(thinkingAccum.current, cleaner.thinkingText());
    cleaner = createThinkStreamCleaner({ templateOpensThink: round.templateOpensThink });
    roundWritingEmitted = false;
  };
  /** The authoritative round end: reconcile, cancel the pending flush, emit. */
  const finish = (): string => {
    const finalThinking = joinThinking(thinkingAccum.current, cleaner.thinkingText());
    coalescer.cancel();
    emitted.push(finalThinking);
    return finalThinking;
  };
  /** The terminal path that is not finalize: drop the timer, emit nothing. */
  const cancel = (): void => coalescer.cancel();
  const status = (): boolean => roundWritingEmitted;
  return { push, feed, endRound, finish, cancel, emitted, deltas, status };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("a turn that reasons before it answers", () => {
  it("streams the thinking while it is written, not once at the end", () => {
    const stream = fakeStream();
    stream.feed(THINK_TOKENS);
    // Nothing is visible yet: the think block is stripped, so the label (and
    // the card) must come from these calls alone.
    expect(stream.deltas).toEqual([]);

    jest.advanceTimersByTime(50);
    expect(stream.emitted.length).toBeGreaterThanOrEqual(2);
    // Every streamed span is a real prefix of the reasoning, never a rewrote.
    for (const span of stream.emitted) {
      expect("Let me look at the numbers first").toContain(span.trim());
    }

    const finalThinking = stream.finish();
    expect(stream.emitted[stream.emitted.length - 1]).toBe(finalThinking);
    expect(finalThinking).toBe("Let me look at the numbers first");
  });

  it("keeps the answer byte-for-byte what the stream produced", () => {
    const stream = fakeStream();
    stream.feed(THINK_TOKENS);
    jest.advanceTimersByTime(50);
    stream.feed(ANSWER_TOKENS);
    stream.finish();

    expect(stream.deltas.join("")).toBe(ANSWER_TOKENS.join(""));
    expect(stream.status()).toBe(true);
  });

  it("stops streaming thinking once the round is writing", () => {
    const stream = fakeStream();
    stream.feed(THINK_TOKENS);
    jest.advanceTimersByTime(50);
    const afterThinking = stream.emitted.length;

    stream.feed(ANSWER_TOKENS);
    jest.advanceTimersByTime(50);
    // The answer's own deltas do not restate a span that cannot change
    // until the round edge; the label already flipped to writing.
    expect(stream.emitted.length).toBe(afterThinking);
  });

  it("cannot land a pending flush over the reconciled final span", () => {
    const stream = fakeStream();
    stream.feed(THINK_TOKENS.slice(0, 3));
    // A trailing flush is pending when the round ends mid-think.
    const finalThinking = stream.finish();
    const emittedAtEnd = stream.emitted.length;

    jest.advanceTimersByTime(500);
    expect(stream.emitted.length).toBe(emittedAtEnd);
    expect(stream.emitted[emittedAtEnd - 1]).toBe(finalThinking);
  });

  it("a second round's thinking joins the first round's span", () => {
    const stream = fakeStream();
    stream.feed(THINK_TOKENS);
    stream.endRound();
    jest.advanceTimersByTime(50);
    // Round two reasons on a fresh cleaner; the card shows both spans.
    stream.feed(["<think>", "now ", "the second ", "part", "</think>"]);
    jest.advanceTimersByTime(50);
    const finalThinking = stream.finish();

    expect(finalThinking).toBe("Let me look at the numbers first\n\nnow the second part");
    expect(stream.emitted.length).toBeGreaterThanOrEqual(3);
    expect(stream.emitted[stream.emitted.length - 1]).toBe(finalThinking);
  });

  it("a terminal error drops the pending flush, whatever the reason", () => {
    const stream = fakeStream();
    stream.feed(THINK_TOKENS);
    jest.advanceTimersByTime(50);
    const before = stream.emitted.length;

    // The turn ends on an error instead of finalize: same cancel, no emit.
    stream.cancel();
    stream.feed(ANSWER_TOKENS);
    jest.advanceTimersByTime(500);
    expect(stream.emitted.length).toBe(before);
  });

  it("a template-opened block streams the same way", () => {
    const stream = fakeStream({ templateOpensThink: true });
    stream.feed(["Let me ", "check ", "the log", "</think>", "Done"]);
    jest.advanceTimersByTime(50);
    expect(stream.emitted.length).toBeGreaterThanOrEqual(2);

    stream.finish();
    expect(stream.deltas.join("")).toBe("Done");
  });
});

describe("the token paths in LlamaService", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "LlamaService.ts"), "utf8");
  const count = (needle: string): number => source.split(needle).length - 1;

  it("push the thinking from every token callback", () => {
    // Two completions stream tokens: the main round and the tool fallback.
    expect(count("thinkingCoalescer.push(")).toBe(2);
    expect(source).toContain("const thinkingCoalescer = createStreamCoalescer(");
  });

  it("cancel the pending flush before each authoritative emit", () => {
    // Abort, round finalize, tool fallback: each cancels first, so a stale
    // trailing flush can never overwrite the reconciled span.
    const beforeEmit = [...source.matchAll(/thinkingCoalescer\.cancel\(\);/g)].filter((at) =>
      source.slice(at.index, at.index + 120).includes("callbacks.onThinkingText?."),
    );
    expect(beforeEmit.length).toBe(3);
  });

  it("cancel on the terminal error paths, so nothing paints after onError", () => {
    // The coalescer owns a real timer. Any turn that ends WITHOUT one of the
    // three authoritative emits — a throw, the context_full refusal, an
    // invalidation, a governor pause — used to leave that timer armed, and it
    // fired onThinkingText after onError, into a message the host had already
    // rolled back. The turn's finally cancels for every one of them.
    const finallyIndex = source.indexOf("} finally {", source.indexOf("return withEngineJob(async () => {"));
    const finallyBlock = source.slice(finallyIndex, finallyIndex + 400);
    expect(finallyBlock).toContain("thinkingCoalescer.cancel();");

    // And the thrown path cancels BEFORE it reports, so the error and the
    // silence arrive in that order.
    const catchIndex = source.lastIndexOf("} catch (error) {", finallyIndex);
    const catchBlock = source.slice(catchIndex, finallyIndex + 40);
    const cancelAt = catchBlock.indexOf("thinkingCoalescer.cancel();");
    const emitAt = catchBlock.indexOf("emitEngineError(");
    expect(cancelAt).toBeGreaterThan(-1);
    expect(emitAt).toBeGreaterThan(-1);
    expect(cancelAt).toBeLessThan(emitAt);
  });
});